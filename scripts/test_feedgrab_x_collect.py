#!/usr/bin/env python3
"""Isolated collector checks: only stdlib fixtures, no feedgrab or network."""

import contextlib
from copy import deepcopy
import importlib.util
import io
import json
from pathlib import Path
import signal
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock


SCRIPT = Path(__file__).with_name("feedgrab-x-collect.py")
SPEC = importlib.util.spec_from_file_location("feedgrab_x_collect", SCRIPT)
collector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(collector)

POST_ID = "2108148604447883464"
URL = f"https://x.com/sample/status/{POST_ID}"
TIME = "2026-10-10T04:05:06Z"
CANDIDATE_KEYS = {"category", "original_url", "author_handle", "published_at", "title_zh", "summary_zh", "bookmark_count", "like_count", "view_count", "metric_display", "metrics_checked_at", "metrics_source_url", "read_scope", "selection_reason", "my_angle", "unknowns"}


def discovery(url=URL):
    return {"url": url, "published_at": None, "text": "搜索页面发现的公开候选；不是已测试结论。", "metric_display": "页面显示 1.2万；不还原整数。", "discovered_at": TIME, "discovery_source_url": "https://x.com/search?q=tutorial&f=live"}


def raw_tweet(post_id=POST_ID):
    return {"code": 200, "tweet": {"id": post_id, "author": {"screen_name": "Sample", "name": "Example"}, "text": "怎样保存原始依据\n下面是主帖第二行。", "likes": 0, "bookmarks": 380, "created_at": "Fri Oct 09 03:33:33 +0000 2026", "quote": {"text": "别的作者被引用的内容，不应混成当前作者正文。", "author": {"screen_name": "Other"}, "likes": 9000}}}


def normalized_tweet(raw):
    tweet = raw["tweet"]
    return {"text": tweet["text"], "likes": tweet.get("likes", 0), "bookmarks": tweet.get("bookmarks", 0), "views": str(tweet.get("views", 0)), "has_thread": False, "thread_tweets": [{"id": tweet["id"], "text": tweet["text"], "quoted_tweet": tweet.get("quote")}], "images": [], "videos": []}


class FakeResponse:
    def __init__(self, payload=None, *, status=200, content_type="application/json", body=None):
        self.status_code, self.headers, self.closed = status, {"Content-Type": content_type}, False
        self.body = body if body is not None else json.dumps(payload).encode("utf-8")
        self.read_count = 0

    def iter_content(self, chunk_size):
        self.read_count += 1
        for offset in range(0, len(self.body), chunk_size):
            yield self.body[offset:offset + chunk_size]

    def close(self):
        self.closed = True


class FakeSession:
    def __init__(self, responses):
        self.responses, self.calls, self.closed = list(responses), [], False
        # Deliberately dirty fixture demonstrates that existing session state
        # cannot reach the anonymous public request.
        self.trust_env, self.auth, self.cert = True, ("private", "credentials"), "private-cert"
        self.cookies, self.headers = {"auth_token": "fixture-session"}, {"Authorization": "fixture-session"}
        self.proxies, self.params = {"https": "http://private-proxy.invalid"}, {"token": "fixture-session"}

    def get(self, url, **kwargs):
        assert self.trust_env is False and self.auth is None and self.cert is None
        assert not self.cookies and not self.headers and not self.proxies and not self.params
        self.calls.append((url, kwargs))
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response

    def close(self):
        self.closed = True


def fake_fetcher(http_module):
    def fetch(url, post_id):
        _, handle, _ = collector.canonical_post(url)
        response = http_module.get(f"https://api.fxtwitter.com/{handle}/status/{post_id}", headers={"User-Agent": "public-fixture", "Accept": "application/json"}, timeout=15)
        if response.status_code != 200:
            raise RuntimeError("upstream response may contain private data; never print it")
        return normalized_tweet(response.json())
    return fetch


class InputChecks(unittest.TestCase):
    def test_normalizes_only_public_post_ids_and_deduplicates_aliases(self):
        alias = f"https://twitter.com/SAMPLE/status/{POST_ID}?s=20"
        items, duplicates = collector.validate_input([discovery(URL), discovery(alias)])
        self.assertEqual(len(items), 1)
        self.assertEqual(duplicates, [{"url": URL, "reason": "duplicate_post_id"}])
        self.assertEqual(collector.canonical_post(alias), (URL, "sample", POST_ID))

    def test_rejects_private_hosts_credentials_ports_and_non_post_urls(self):
        bad = ["http://x.com/sample/status/12345678", "https://127.0.0.1/status/12345678", "https://x.com.evil.invalid/sample/status/12345678", "https://x.com@evil.invalid/sample/status/12345678", "https://person:secret@x.com/sample/status/12345678", "https://x.com:443/sample/status/12345678", "https://x.com/sample", "https://x.com/sample/status/12345678/photo/1", "https://x.com/sample/status/12345678?%74oken=fixture", "https://x.com/sample/status/12345678\n"]
        for url in bad:
            with self.subTest(url=url), self.assertRaises(collector.CollectionError):
                collector.validate_input([discovery(url)])

    def test_requires_exact_input_fields(self):
        for change in [lambda row: row.pop("text"), lambda row: row.update(authorization="not accepted"), lambda row: row.update(url=2)]:
            row = discovery()
            change(row)
            with self.assertRaises(collector.CollectionError):
                collector.validate_input([row])

    def test_input_limit_is_checked_before_deduplication(self):
        for rows in [[], [discovery()] * 31, {"items": [discovery()]}]:
            with self.assertRaises(collector.CollectionError):
                collector.validate_input(rows)
        self.assertEqual(len(collector.validate_input([discovery()] * 30)[0]), 1)

    def test_requires_timezone_and_does_not_guess_missing_dates(self):
        row = discovery()
        row["discovered_at"] = "2026-10-10T12:00:00"
        with self.assertRaises(collector.CollectionError):
            collector.validate_input([row])
        row = discovery()
        row["published_at"] = "昨天"
        with self.assertRaises(collector.CollectionError):
            collector.validate_input([row])
        self.assertEqual(collector.aware_timestamp("2026-10-10T12:00:00+08:00"), "2026-10-10T04:00:00Z")
        self.assertIsNone(collector.aware_timestamp("2026-10-10T12:00:00"))

    def test_detected_credentials_are_excluded_from_discovery(self):
        row = discovery()
        row["text"] = "Bearer " + "A" * 32
        with self.assertRaisesRegex(collector.CollectionError, "suspected_credential"):
            collector.validate_input([row])


class ProvenanceChecks(unittest.TestCase):
    def test_keeps_explicit_zero_and_missing_metric_unknown_despite_normalizer_defaults(self):
        raw = raw_tweet()
        candidate = collector.build_candidate(raw, normalized_tweet(raw), discovery(), TIME)
        self.assertEqual(candidate["like_count"], 0)
        self.assertEqual(candidate["bookmark_count"], 380)
        self.assertIsNone(candidate["view_count"])
        self.assertIn("浏览 未知", candidate["metric_display"])
        self.assertNotIn("1.2万", candidate["metric_display"])

    def test_abbreviated_bool_negative_fraction_and_unsafe_metrics_are_unknown(self):
        for value in ["1.2万", True, -1, 1.5, "9" * 5000, 9007199254740992, None]:
            with self.subTest(value=str(value)[:20]):
                self.assertIsNone(collector.metric({"likes": value}, "likes"))
        self.assertEqual(collector.metric({"likes": "123"}, "likes"), 123)

    def test_current_author_rename_keeps_post_id_and_original_discovery(self):
        raw = raw_tweet()
        raw["tweet"]["author"]["screen_name"] = "RenamedAuthor"
        candidate = collector.build_candidate(raw, normalized_tweet(raw), discovery(), TIME)
        self.assertEqual(candidate["original_url"], f"https://x.com/renamedauthor/status/{POST_ID}")
        self.assertEqual(candidate["author_handle"], "RenamedAuthor")
        self.assertTrue(any("发现时链接另存" in row for row in candidate["unknowns"]))

    def test_requires_actual_returned_post_id_and_author(self):
        for raw in [raw_tweet("2108148604447883465"), {"code": 200, "tweet": {"id": POST_ID, "author": {}}}, {"code": 404, "tweet": raw_tweet()["tweet"]}]:
            with self.assertRaises(collector.CollectionError):
                collector.build_candidate(raw, {"text": "fixture"}, discovery(), TIME)

    def test_records_main_body_without_mixing_quote_or_claiming_thread_or_tool_test(self):
        raw = raw_tweet()
        candidate = collector.build_candidate(raw, normalized_tweet(raw), discovery(), TIME)
        self.assertEqual(set(candidate), CANDIDATE_KEYS)
        self.assertEqual(candidate["read_scope"], "main_post")
        self.assertNotIn(raw["tweet"]["quote"]["text"], candidate["summary_zh"])
        self.assertIn(raw["tweet"]["text"], candidate["summary_zh"])
        self.assertEqual(candidate["my_angle"], "")
        self.assertTrue(any("未安装或试用" in row for row in candidate["unknowns"]))
        self.assertIn("不代表已被评为优质教程", candidate["selection_reason"])

    def test_unknown_publication_does_not_fall_back_to_capture_or_input(self):
        raw, source = raw_tweet(), discovery()
        raw["tweet"]["created_at"] = "2026-10-09 03:33:33"
        source["published_at"] = TIME
        candidate = collector.build_candidate(raw, normalized_tweet(raw), source, TIME)
        self.assertIsNone(candidate["published_at"])
        raw["tweet"]["created_at"] = "Fri Oct 09 03:33:33 +0000 2026"
        self.assertEqual(collector.build_candidate(raw, normalized_tweet(raw), source, TIME)["published_at"], "2026-10-09T03:33:33Z")

    def test_long_summary_is_explicitly_truncated_and_title_bounded(self):
        raw = raw_tweet()
        raw["tweet"]["text"] = "主" * 9000
        candidate = collector.build_candidate(raw, normalized_tweet(raw), discovery(), TIME)
        self.assertEqual(len(candidate["title_zh"]), 180)
        self.assertEqual(len(candidate["summary_zh"]), 8000)
        self.assertTrue(any("已截断" in row for row in candidate["unknowns"]))

    def test_article_is_not_claimed_complete(self):
        raw = raw_tweet()
        raw["tweet"]["article"] = {"content": {"blocks": [{"text": "article paragraph"}]}}
        candidate = collector.build_candidate(raw, normalized_tweet(raw), discovery(), TIME)
        self.assertTrue(any("完整文章仍需" in row for row in candidate["unknowns"]))

    def test_emoji_lengths_match_browser_contract_without_splitting_characters(self):
        raw = raw_tweet()
        raw["tweet"]["text"] = "😀" * 5000
        candidate = collector.build_candidate(raw, normalized_tweet(raw), discovery(), TIME)
        self.assertEqual(len(candidate["title_zh"].encode("utf-16-le")) // 2, 180)
        self.assertLessEqual(len(candidate["summary_zh"].encode("utf-16-le")) // 2, 8000)
        self.assertTrue(any("已截断" in row for row in candidate["unknowns"]))

    def test_credentials_in_raw_or_normalized_evidence_fail_closed(self):
        for field in ["raw", "normalized"]:
            raw = raw_tweet()
            normalized = normalized_tweet(raw)
            target = raw if field == "raw" else normalized
            target["authorization"] = "fixture-private-secret"
            with self.assertRaisesRegex(collector.CollectionError, "suspected_credential"):
                collector.build_candidate(raw, normalized, discovery(), TIME)


class TransportChecks(unittest.TestCase):
    def test_fixed_anonymous_request_clears_env_cookie_auth_proxy_and_cert(self):
        response = FakeResponse(raw_tweet())
        session = FakeSession([response])
        transport = collector.AnonymousFxTransport(session)
        transport.begin(URL)
        result = transport.get(f"https://api.fxtwitter.com/sample/status/{POST_ID}", headers={"Accept": "application/json"}, timeout=100)
        self.assertEqual(result.json(), raw_tweet())
        self.assertEqual(session.calls[0][1], {"headers": {"Accept": "application/json"}, "timeout": 15, "allow_redirects": False, "stream": True})
        self.assertTrue(response.closed)
        self.assertEqual(transport.requests, 1)

    def test_blocks_other_hosts_ids_extra_keywords_and_credentials_before_http(self):
        for url, kwargs in [("https://evil.invalid/", {}), (f"https://api.fxtwitter.com/sample/status/{POST_ID}?token=fixture", {}), (f"https://api.fxtwitter.com/other/status/{POST_ID}", {}), (f"https://api.fxtwitter.com/sample/status/{POST_ID}", {"cookies": {"auth_token": "fixture"}}), (f"https://api.fxtwitter.com/sample/status/{POST_ID}", {"headers": {"Cookie": "fixture"}}), (f"https://api.fxtwitter.com/sample/status/{POST_ID}", {"headers": {"Authorization": "fixture"}})]:
            session = FakeSession([])
            transport = collector.AnonymousFxTransport(session)
            transport.begin(URL)
            with self.subTest(url=url, kwargs=kwargs), self.assertRaises(collector.CollectionError):
                transport.get(url, **kwargs)
            self.assertFalse(session.calls)

    def test_blocks_second_request_per_post_without_retry(self):
        session = FakeSession([FakeResponse(raw_tweet())])
        transport = collector.AnonymousFxTransport(session)
        transport.begin(URL)
        api = f"https://api.fxtwitter.com/sample/status/{POST_ID}"
        transport.get(api)
        with self.assertRaisesRegex(collector.CollectionError, "budget"):
            transport.get(api)
        self.assertEqual(len(session.calls), 1)

    def test_caps_total_requests_at_thirty(self):
        session = FakeSession([FakeResponse(raw_tweet()) for _ in range(30)])
        transport = collector.AnonymousFxTransport(session)
        api = f"https://api.fxtwitter.com/sample/status/{POST_ID}"
        for _ in range(30):
            transport.begin(URL)
            transport.get(api)
        transport.begin(URL)
        with self.assertRaisesRegex(collector.CollectionError, "budget"):
            transport.get(api)
        self.assertEqual(len(session.calls), 30)

    def test_redirects_and_non_200_bodies_are_not_followed_or_stored(self):
        response = FakeResponse(status=302, body=b"fixture-private-upstream-body")
        session = FakeSession([response])
        transport = collector.AnonymousFxTransport(session)
        transport.begin(URL)
        self.assertEqual(transport.get(f"https://api.fxtwitter.com/sample/status/{POST_ID}").status_code, 302)
        self.assertIsNone(transport.latest_raw)
        self.assertEqual(response.read_count, 0)
        self.assertFalse(session.calls[0][1]["allow_redirects"])

    def test_invalid_large_or_non_json_response_is_rejected_and_closed(self):
        bad = [FakeResponse(content_type="text/html", body=b"<script>fixture</script>"), FakeResponse(body=b"not JSON"), FakeResponse(body=b'{"value": NaN}'), FakeResponse(body=b"x" * (collector.MAX_BYTES + 1)), FakeResponse(body=b"[]")]
        for response in bad:
            transport = collector.AnonymousFxTransport(FakeSession([response]))
            transport.begin(URL)
            with self.subTest(body_length=len(response.body)), self.assertRaises(collector.CollectionError):
                transport.get(f"https://api.fxtwitter.com/sample/status/{POST_ID}")
            self.assertTrue(response.closed)
            self.assertIsNone(transport.latest_raw)

    def test_whole_response_deadline_restores_existing_alarm_handler(self):
        previous = signal.getsignal(signal.SIGALRM)
        with self.assertRaisesRegex(collector.CollectionError, "deadline_exceeded"):
            with collector.request_deadline():
                self.assertGreater(signal.getitimer(signal.ITIMER_REAL)[0], 0)
                signal.getsignal(signal.SIGALRM)(signal.SIGALRM, None)
        self.assertEqual(signal.getsignal(signal.SIGALRM), previous)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))

    def test_existing_process_timer_is_not_overridden(self):
        with mock.patch.object(signal, "getitimer", return_value=(1.0, 0.0)), mock.patch.object(signal, "setitimer") as timer:
            with self.assertRaisesRegex(collector.CollectionError, "timer_conflict"):
                with collector.request_deadline():
                    self.fail("must fail before request")
            timer.assert_not_called()


class BatchChecks(unittest.TestCase):
    def run_batch(self, rows, responses, output, *, fetcher=None):
        old_get = object()
        http_module = SimpleNamespace(get=old_get)
        session = FakeSession(responses)
        with contextlib.redirect_stdout(io.StringIO()):
            manifest = collector.collect_batch(rows, output, fetcher=fetcher or fake_fetcher(http_module), http_module=http_module, session=session, source_info={"repository": "https://github.com/iBigQiang/feedgrab", "commit": collector.PINNED_COMMIT, "version": collector.PINNED_VERSION}, clock=lambda: TIME)
        self.assertIs(http_module.get, old_get)
        self.assertTrue(session.closed)
        return manifest, session

    def test_preserves_original_response_and_discovery_and_exact_import_envelope(self):
        raw = raw_tweet()
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "collection"
            manifest, session = self.run_batch([discovery(), discovery(f"https://twitter.com/SAMPLE/status/{POST_ID}")], [FakeResponse(raw)], output)
            envelope = json.loads((output / "candidate-envelope.json").read_text())
            self.assertEqual(set(envelope), {"format", "version", "collector", "collected_at", "items", "alternatives"})
            self.assertEqual(envelope["collector"], "feedgrab")
            self.assertEqual(envelope["alternatives"], [])
            self.assertEqual(len(envelope["items"]), 1)
            self.assertIsNone(envelope["items"][0]["view_count"])
            evidence = output / "evidence" / POST_ID
            self.assertEqual(json.loads((evidence / "fxtwitter.raw.json").read_text()), raw)
            self.assertEqual(json.loads((evidence / "discovery.json").read_text()), discovery())
            self.assertEqual(json.loads((evidence / "normalized.json").read_text())["views"], "0")
            self.assertIn(raw["tweet"]["text"], (evidence / "main-post.md").read_text())
            self.assertEqual(manifest["http_request_count"], 1)
            self.assertEqual(len(manifest["skipped_duplicates"]), 1)
            self.assertEqual(manifest["succeeded"], 1)
            self.assertEqual(len(session.calls), 1)

    def test_one_failed_request_does_not_fake_success_or_leak_exception_details(self):
        second_id = "2108148604447883465"
        rows = [discovery(), discovery(f"https://x.com/sample/status/{second_id}")]
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "collection"
            manifest, session = self.run_batch(rows, [RuntimeError("Bearer " + "A" * 40), FakeResponse(raw_tweet(second_id))], output)
            self.assertEqual((manifest["succeeded"], manifest["failed"], manifest["http_request_count"]), (1, 1, 2))
            self.assertEqual(len(session.calls), 2)
            results = json.loads((output / "results.json").read_text())
            self.assertEqual(results[0]["reason"], "public_fetch_failed")
            self.assertFalse((output / "evidence" / POST_ID).exists())
            self.assertNotIn("Bearer", "\n".join(path.read_text() for path in output.rglob("*") if path.is_file()))

    def test_secret_payload_is_not_saved_in_any_artifact(self):
        raw = raw_tweet()
        raw["tweet"]["auth_token"] = "fixture-private-session"
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "collection"
            manifest, _ = self.run_batch([discovery()], [FakeResponse(raw)], output)
            self.assertEqual(manifest["succeeded"], 0)
            self.assertEqual(manifest["failed"], 1)
            self.assertFalse((output / "evidence").exists())
            self.assertEqual(json.loads((output / "candidate-envelope.json").read_text())["items"], [])
            self.assertNotIn("fixture-private-session", "\n".join(path.read_text() for path in output.rglob("*") if path.is_file()))

    def test_observation_timestamp_is_taken_after_response(self):
        captured = []
        times = iter(["2026-10-10T04:00:00Z", "2026-10-10T04:00:02Z", "2026-10-10T04:00:03Z"])
        http_module = SimpleNamespace(get=object())
        fetch = fake_fetcher(http_module)

        def checked_fetch(url, post_id):
            captured.append("fetch")
            return fetch(url, post_id)

        def clock():
            captured.append("clock")
            return next(times)

        with tempfile.TemporaryDirectory() as temp, contextlib.redirect_stdout(io.StringIO()):
            output = Path(temp) / "collection"
            collector.collect_batch([discovery()], output, fetcher=checked_fetch, http_module=http_module, session=FakeSession([FakeResponse(raw_tweet())]), source_info={}, clock=clock)
            candidate = json.loads((output / "candidate-envelope.json").read_text())["items"][0]
        self.assertEqual(captured, ["clock", "fetch", "clock", "clock"])
        self.assertEqual(candidate["metrics_checked_at"], "2026-10-10T04:00:02Z")

    def test_existing_artifacts_are_never_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            (output / "keep.txt").write_text("existing evidence")
            with self.assertRaisesRegex(collector.CollectionError, "directory_not_empty"):
                self.run_batch([discovery()], [], output)
            self.assertEqual((output / "keep.txt").read_text(), "existing evidence")

    def test_output_writer_rejects_credential_object_before_creation(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "do-not-create.json"
            with self.assertRaises(collector.CollectionError):
                collector.write_json(path, {"cookie": "private fixture"})
            self.assertFalse(path.exists())

    def test_pinned_source_accepts_exact_head_and_rejects_new_revision(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp)
            (source / ".git").mkdir()
            head = source / ".git" / "HEAD"
            head.write_text(collector.PINNED_COMMIT)
            collector.pinned_source(source)
            head.write_text("a" * 40)
            with self.assertRaisesRegex(collector.CollectionError, "commit_mismatch"):
                collector.pinned_source(source)


if __name__ == "__main__":
    unittest.main()
