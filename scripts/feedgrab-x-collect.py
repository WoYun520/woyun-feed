#!/usr/bin/env python3
"""Read supplied public X post URLs through feedgrab's anonymous FxTwitter tier.

This module does not import feedgrab at import time. It does not discover URLs,
load .env files, load sessions, use a browser, download media, or submit drafts.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import importlib
import json
import os
from pathlib import Path
import re
import signal
import sys
import threading
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import parse_qsl, urlsplit

PINNED_COMMIT = "04291bafbb65bb78f729c46da0a5ac8ebbfae4a6"
PINNED_VERSION = "0.26.2"
RUNTIME_ROOT = Path.home() / "Library/Application Support/WoYun Feed/feedgrab"
MAX_ITEMS = 30
MAX_BYTES = 2 * 1024 * 1024
MAX_SAFE_INTEGER = 9007199254740991
INPUT_FIELDS = {"url", "published_at", "text", "metric_display", "discovered_at", "discovery_source_url"}
SECRET_KEYS = {"auth_token", "ct0", "authorization", "cookie", "password", "passwd", "api_key", "access_token", "refresh_token"}
SECRET_TEXT = re.compile(r"-----BEGIN .*PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})|\bBearer\s+[A-Za-z0-9_.-]{25,}|(?:密码|password|api[_ -]?key|token)\s*[:=：]\s*[^\s,;，；]{12,}", re.I)
SECRET_QUERY = re.compile(r"^(?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|password|passwd|secret|authorization|x-amz-signature|x-goog-signature)$", re.I)


class CollectionError(ValueError):
    """A safe, predefined diagnostic; never an upstream response or secret."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def safe_json(value: Any, depth: int = 0) -> None:
    if depth > 30:
        raise CollectionError("response_structure_too_deep")
    if isinstance(value, str):
        if SECRET_TEXT.search(value):
            raise CollectionError("suspected_credential_excluded")
    elif isinstance(value, dict):
        for key, child in value.items():
            if str(key).lower() in SECRET_KEYS and child not in (None, "", False):
                raise CollectionError("suspected_credential_excluded")
            safe_json(child, depth + 1)
    elif isinstance(value, list):
        for child in value:
            safe_json(child, depth + 1)


def public_url(value: str) -> Any:
    if not isinstance(value, str) or len(value) > 4000 or re.search(r"[\x00-\x20\x7f]", value):
        raise CollectionError("invalid_public_url")
    try:
        parsed = urlsplit(value)
        if parsed.scheme != "https" or parsed.hostname not in {"x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"} or parsed.username or parsed.password or parsed.port:
            raise CollectionError("invalid_public_url")
    except (ValueError, TypeError) as exc:
        raise CollectionError("invalid_public_url") from exc
    if any(SECRET_QUERY.match(key) for key, _ in parse_qsl(parsed.query)):
        raise CollectionError("credential_query_excluded")
    safe_json(value)
    return parsed


def canonical_post(value: str) -> tuple[str, str, str]:
    parsed = public_url(value)
    match = re.fullmatch(r"/([A-Za-z0-9_]{1,15})/status/([1-9][0-9]{7,24})/?", parsed.path)
    if not match:
        raise CollectionError("input_must_be_public_status_url")
    handle, post_id = match.groups()
    return f"https://x.com/{handle.lower()}/status/{post_id}", handle.lower(), post_id


def aware_timestamp(value: Any, *, allow_rfc: bool = False) -> str | None:
    if not isinstance(value, str) or len(value) > 100:
        return None
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})", value):
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        elif allow_rfc:
            parsed = parsedate_to_datetime(value)
        else:
            return None
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            return None
        return parsed.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    except (ValueError, TypeError, OverflowError):
        return None


def validate_input(value: Any) -> tuple[list[dict], list[dict]]:
    if not isinstance(value, list) or not 1 <= len(value) <= MAX_ITEMS:
        raise CollectionError("input_requires_one_to_thirty_items")
    safe_json(value)
    items, duplicates, seen = [], [], set()
    for row in value:
        if not isinstance(row, dict) or set(row) != INPUT_FIELDS:
            raise CollectionError("invalid_input_fields")
        canonical, _, post_id = canonical_post(row["url"])
        if row["published_at"] is not None and aware_timestamp(row["published_at"]) is None:
            raise CollectionError("input_publication_time_requires_timezone")
        if aware_timestamp(row["discovered_at"]) is None:
            raise CollectionError("discovery_time_requires_timezone")
        source = public_url(row["discovery_source_url"])
        if source.path != "/search" and "/status/" not in source.path and not re.fullmatch(r"/[A-Za-z0-9_]{1,15}/?", source.path):
            raise CollectionError("invalid_discovery_source")
        for field, maximum in [("text", 20000), ("metric_display", 2000)]:
            if not isinstance(row[field], str) or len(row[field]) > maximum or re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", row[field]):
                raise CollectionError("invalid_input_text")
        if post_id in seen:
            duplicates.append({"url": canonical, "reason": "duplicate_post_id"})
            continue
        seen.add(post_id)
        items.append(dict(row))
    return items, duplicates


def metric(tweet: dict, key: str) -> int | None:
    value = tweet.get(key)
    if isinstance(value, bool):
        return None
    if isinstance(value, str) and re.fullmatch(r"[0-9]+", value):
        if len(value) > 16:
            return None
        value = int(value)
    return value if isinstance(value, int) and 0 <= value <= MAX_SAFE_INTEGER else None


def clip_text(value: str, limit: int) -> str:
    """Match the browser contract's UTF-16 length without splitting emoji."""
    used = 0
    for index, character in enumerate(value):
        used += 2 if ord(character) > 0xFFFF else 1
        if used > limit:
            return value[:index]
    return value


def build_candidate(raw: dict, normalized: dict, source: dict, checked_at: str) -> dict:
    """Only source-present metrics count; normalized defaults do not fill gaps."""
    safe_json(raw)
    safe_json(normalized)
    _, _, post_id = canonical_post(source["url"])
    if raw.get("code") != 200 or not isinstance(raw.get("tweet"), dict):
        raise CollectionError("no_public_tweet_returned")
    tweet = raw["tweet"]
    if str(tweet.get("id", "")) != post_id:
        raise CollectionError("response_post_id_mismatch")
    author = tweet.get("author") or {}
    handle = author.get("screen_name") if isinstance(author, dict) else None
    if not isinstance(handle, str) or not re.fullmatch(r"[A-Za-z0-9_]{1,15}", handle):
        raise CollectionError("response_author_missing")
    body = normalized.get("text")
    if not isinstance(body, str) or not body.strip():
        raise CollectionError("public_main_post_body_missing")
    if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", body):
        raise CollectionError("invalid_public_body")
    body = body.strip()
    title = clip_text(next((line.strip() for line in body.splitlines() if line.strip()), ""), 180)
    url = f"https://x.com/{handle.lower()}/status/{post_id}"
    counts = {"bookmark_count": metric(tweet, "bookmarks"), "like_count": metric(tweet, "likes"), "view_count": metric(tweet, "views")}
    unknowns = [
        "正文及热度来自 FxTwitter 第三方公开接口，未打开原帖独立核验。",
        "只采集主帖；未展开或核对完整线程。",
        "未观看视频、读取图片内容或打开正文外链。",
        "未安装或试用作者介绍的工具，也未验证其效果。",
        "本轮读取给定的公开链接，不代表完成 X 站内关键词搜索或发现全部高质量帖子。",
        "未使用搜索页面观察的热度补齐接口缺失的指标；页面记录另存为发现依据。",
    ]
    prefix = "原文摘录（未翻译、未实测）：\n"
    available = 8000 - len(prefix)
    excerpt = clip_text(body, available)
    if excerpt != body:
        unknowns.append("正文摘录超过长度限制，已截断；完整接口响应和主帖文字另存，不能据摘要认定读完。")
    for key, label in [("bookmark_count", "收藏"), ("like_count", "点赞"), ("view_count", "浏览")]:
        if counts[key] is None:
            unknowns.append(f"接口没有提供可确认的{label}整数，保留 null，不把默认 0 当作实际观察。")
    published = aware_timestamp(tweet.get("created_at"), allow_rfc=True)
    if published is None:
        unknowns.append("接口未提供带时区的有效发布时间，保留 null，采集时间不代替发布时间。")
    article = tweet.get("article")
    if isinstance(article, dict) and article.get("content"):
        unknowns.append("接口包含文章内容；是否为完整文章仍需回到原帖核对。")
    if source["url"] != url:
        unknowns.append("作者以接口实际账号记录，规范链接保持同一帖子编号；发现时链接另存。")
    if aware_timestamp(checked_at) is None:
        raise CollectionError("observation_time_requires_timezone")
    display = "FxTwitter JSON：" + "；".join(f"{label} {counts[key] if counts[key] is not None else '未知'}" for key, label in [("bookmark_count", "收藏"), ("like_count", "点赞"), ("view_count", "浏览")])
    return {
        "category": "tutorial", "original_url": url, "author_handle": handle,
        "published_at": published, "title_zh": title, "summary_zh": prefix + excerpt,
        **counts, "metric_display": display, "metrics_checked_at": checked_at,
        "metrics_source_url": url, "read_scope": "main_post",
        "selection_reason": "本轮公开搜索候选，采集成功待人工审核；不代表已被评为优质教程。",
        "my_angle": "", "unknowns": unknowns,
    }


class JsonResponse:
    def __init__(self, status_code: int, payload: Any = None):
        self.status_code, self.payload = status_code, payload

    def json(self) -> Any:
        return self.payload


@contextmanager
def request_deadline():
    """The isolated macOS/Linux CLI must finish one HTTP read in 15 seconds.

    A socket timeout alone resets during streamed reads. This alarm bounds the
    complete call and fails closed if another timer or a worker thread is used.
    """
    if not hasattr(signal, "setitimer") or threading.current_thread() is not threading.main_thread():
        raise CollectionError("request_deadline_unavailable")
    if signal.getitimer(signal.ITIMER_REAL) != (0.0, 0.0):
        raise CollectionError("existing_request_timer_conflict")
    previous_handler = signal.getsignal(signal.SIGALRM)

    def expired(_number, _frame):
        raise CollectionError("public_request_deadline_exceeded")

    signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, 15)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)


class AnonymousFxTransport:
    """One bounded anonymous HTTP request per item, never any other host."""

    def __init__(self, session: Any):
        self.session, self.requests, self.expected, self.latest_raw = session, 0, None, None
        self.per_item_requests, self.last_http_status = 0, None

    def begin(self, url: str) -> None:
        _, handle, post_id = canonical_post(url)
        self.expected = f"https://api.fxtwitter.com/{handle}/status/{post_id}"
        self.per_item_requests, self.latest_raw, self.last_http_status = 0, None, None

    def get(self, url: str, **kwargs: Any) -> JsonResponse:
        if self.requests >= MAX_ITEMS or self.per_item_requests >= 1:
            raise CollectionError("request_budget_exhausted")
        if url != self.expected or set(kwargs) - {"headers", "timeout"}:
            raise CollectionError("unexpected_http_request_blocked")
        headers = kwargs.get("headers", {})
        if not isinstance(headers, dict) or any(key.lower() not in {"user-agent", "accept"} for key in headers):
            raise CollectionError("request_credentials_blocked")
        safe_json(headers)
        self.session.trust_env = False
        self.session.auth = None
        if hasattr(self.session, "cookies"):
            self.session.cookies.clear()
        if hasattr(self.session, "headers"):
            self.session.headers.clear()
        if hasattr(self.session, "proxies"):
            self.session.proxies.clear()
        if hasattr(self.session, "params"):
            self.session.params.clear()
        self.session.cert = None
        self.requests += 1
        self.per_item_requests += 1
        with request_deadline():
            response = self.session.get(url, headers=headers, timeout=15, allow_redirects=False, stream=True)
            try:
                self.last_http_status = response.status_code
                if response.status_code != 200:
                    return JsonResponse(response.status_code)
                if "application/json" not in response.headers.get("Content-Type", "").lower():
                    raise CollectionError("non_json_public_response")
                parts, size = [], 0
                for part in response.iter_content(chunk_size=16384):
                    size += len(part)
                    if size > MAX_BYTES:
                        raise CollectionError("public_response_too_large")
                    parts.append(part)
                try:
                    def reject_constant(_value):
                        raise ValueError("non-finite JSON number")

                    raw = json.loads(b"".join(parts).decode("utf-8"), parse_constant=reject_constant)
                except (UnicodeDecodeError, ValueError) as exc:
                    raise CollectionError("invalid_public_json") from exc
                if not isinstance(raw, dict):
                    raise CollectionError("invalid_public_json")
                safe_json(raw)
                self.latest_raw = raw
                return JsonResponse(200, raw)
            finally:
                response.close()


def write_json(path: Path, value: Any) -> None:
    safe_json(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(encoded, encoding="utf-8")
    temporary.replace(path)


def collect_batch(items: list[dict], output_dir: Path, *, fetcher: Any, http_module: Any, session: Any, source_info: dict, clock=utc_now) -> dict:
    """Injected dependencies allow isolated tests without importing feedgrab."""
    items, duplicates = validate_input(items)
    safe_json(source_info)
    output_dir = Path(output_dir)
    if output_dir.exists() and any(output_dir.iterdir()):
        raise CollectionError("output_directory_not_empty")
    output_dir.mkdir(parents=True, exist_ok=True)
    started = clock()
    if aware_timestamp(started) is None:
        raise CollectionError("collection_time_requires_timezone")
    transport = AnonymousFxTransport(session)
    previous_get = http_module.get
    results, candidates = [], []
    http_module.get = transport.get
    try:
        for source in items:
            url, _, post_id = canonical_post(source["url"])
            transport.begin(url)
            record = {"url": url, "post_id": post_id, "discovery": source}
            try:
                normalized = fetcher(url, post_id)
                checked_at = clock()
                record["observed_at"] = checked_at
                if not isinstance(normalized, dict) or transport.latest_raw is None:
                    raise CollectionError("public_fetcher_returned_no_evidence")
                candidate = build_candidate(transport.latest_raw, normalized, source, checked_at)
                evidence = output_dir / "evidence" / post_id
                write_json(evidence / "fxtwitter.raw.json", transport.latest_raw)
                write_json(evidence / "normalized.json", normalized)
                write_json(evidence / "discovery.json", source)
                write_json(evidence / "request.json", {"provider": "FxTwitter", "api_url": transport.expected, "original_url": candidate["original_url"], "checked_at": checked_at, "http_status": transport.last_http_status, "anonymous": True})
                body = normalized["text"].strip()
                (evidence / "main-post.md").write_text(f"来源：{candidate['original_url']}\n\n采集：feedgrab / FxTwitter；主帖文字，未实测。\n\n{body}\n", encoding="utf-8")
                candidates.append(candidate)
                record.update(status="ok", canonical_url=candidate["original_url"], evidence=f"evidence/{post_id}", bookmark_count=candidate["bookmark_count"], like_count=candidate["like_count"], view_count=candidate["view_count"])
            except Exception as exc:
                # Never include raw exception text: HTTP errors can contain
                # response bodies, proxy settings, or caller-supplied secrets.
                reason = str(exc) if isinstance(exc, CollectionError) else "public_fetch_failed"
                record.update(status="failed", reason=reason, http_status=transport.last_http_status)
            results.append(record)
            print(f"[{len(results)}/{len(items)}] {record['status']} {url}", flush=True)
    finally:
        http_module.get = previous_get
        session.close()
    finished = clock()
    if aware_timestamp(finished) is None:
        raise CollectionError("collection_time_requires_timezone")
    envelope = {"format": "woyun-feed:candidates", "version": 1, "collector": "feedgrab", "collected_at": finished, "items": candidates, "alternatives": []}
    manifest = {"format": "woyun-feed:feedgrab-collection", "version": 1, "started_at": started, "finished_at": finished, "source": source_info, "unique_input_count": len(items), "skipped_duplicates": duplicates, "http_request_count": transport.requests, "succeeded": len(candidates), "failed": len(results) - len(candidates), "limits": {"posts": MAX_ITEMS, "requests": MAX_ITEMS, "request_timeout_seconds": 15, "response_bytes": MAX_BYTES}, "boundaries": ["public supplied URLs only; not X keyword search", "no browser, login or session discovery", "no media or linked-page download", "no automatic quality claim, curation or publication", "raw metrics absent or unusable remain null"], "candidate_envelope": "candidate-envelope.json"}
    write_json(output_dir / "results.json", results)
    write_json(output_dir / "manifest.json", manifest)
    write_json(output_dir / "candidate-envelope.json", envelope)
    return manifest


def pinned_source(source_root: Path) -> None:
    git_dir = source_root / ".git"
    if not git_dir.is_dir():
        raise CollectionError("isolated_pinned_source_required")
    head = (git_dir / "HEAD").read_text(encoding="ascii").strip()
    if head.startswith("ref: "):
        ref = head[5:]
        if not re.fullmatch(r"refs/[A-Za-z0-9_./-]+", ref) or ".." in ref:
            raise CollectionError("invalid_source_reference")
        reference = git_dir / ref
        if reference.exists():
            head = reference.read_text(encoding="ascii").strip()
        else:
            packed = (git_dir / "packed-refs").read_text(encoding="ascii")
            head = next((line.split()[0] for line in packed.splitlines() if line.endswith(" " + ref)), "")
    if head != PINNED_COMMIT:
        raise CollectionError("source_commit_mismatch")


def main() -> int:
    parser = argparse.ArgumentParser(description="匿名读取最多30条给定的公开X帖子；不搜索、不登录、不发布。")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, default=RUNTIME_ROOT / "source")
    args = parser.parse_args()
    try:
        if args.input.stat().st_size > MAX_BYTES:
            raise CollectionError("input_too_large")
        raw = args.input.read_bytes()
        inputs = json.loads(raw.decode("utf-8"))
        validate_input(inputs)
        pinned_source(args.source_root)
        # Only this anonymous submodule is imported, never CLI/load_dotenv,
        # UniversalReader, FetchService, a cookie loader, or browser fallback.
        for name in ["X_AUTH_TOKEN", "X_CT0", "JINA_API_KEY", "BROWSER_USER_AGENT"]:
            os.environ.pop(name, None)
        os.environ.update(X_GRAPHQL_ENABLED="false", CHROME_CDP_LOGIN="false", X_SEARCH_BROWSER_FALLBACK="false", X_DOWNLOAD_MEDIA="false", FEEDGRAB_PROXY_ENABLED="false")
        sys.path.insert(0, str(args.source_root.resolve()))
        public_fetcher = importlib.import_module("feedgrab.fetchers.twitter_fxtwitter")
        if Path(public_fetcher.__file__).resolve() != (args.source_root / "feedgrab/fetchers/twitter_fxtwitter.py").resolve():
            raise CollectionError("unexpected_feedgrab_module")
        http_module = importlib.import_module("feedgrab.utils.http_client")
        requests = importlib.import_module("requests")
        with requests.Session() as session:
            manifest = collect_batch(inputs, args.output_dir, fetcher=public_fetcher.fetch_via_fxtwitter, http_module=http_module, session=session, source_info={"repository": "https://github.com/iBigQiang/feedgrab", "commit": PINNED_COMMIT, "version": PINNED_VERSION, "reader": "feedgrab.fetchers.twitter_fxtwitter.fetch_via_fxtwitter", "input_sha256": hashlib.sha256(raw).hexdigest()})
        print(json.dumps({"succeeded": manifest["succeeded"], "failed": manifest["failed"], "requests": manifest["http_request_count"]}, ensure_ascii=False))
        return 0 if manifest["succeeded"] else 2
    except CollectionError as exc:
        print(f"采集未开始：{exc}", file=sys.stderr)
        return 2
    except Exception:
        print("采集未开始或未完整结束；请核对输入、隔离运行环境与输出目录。", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
