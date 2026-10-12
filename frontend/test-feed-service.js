import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FeedService, normalizeRepositories } from './feed-service.js';

const NOW = new Date('2026-09-28T12:00:00Z');
const repo = (id = 1, extra = {}) => ({ id, full_name: `example/tool-${id}`, description: 'Bookmarks and RSS', topics: ['productivity'], stargazers_count: 200, archived: false, fork: false, created_at: '2025-01-01T00:00:00Z', pushed_at: '2026-09-28T08:00:00Z', ...extra });
const ok = (items, extra = {}) => new Response(JSON.stringify({ items, incomplete_results: false, ...extra }), { status: 200 });
async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'personal-feed-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('normalize: stable IDs, deduplication, limits, source links and distinct timestamps', () => {
  const items = normalizeRepositories([repo(), repo(), null, repo(2, { fork: true }), repo(3, { archived: true }), repo(4, { stargazers_count: 5001 }), repo(5, { full_name: 'javascript:alert(1)' }), repo(6, { pushed_at: '2020-01-01' }), repo(7, { stargazers_count: 99 })], NOW.toISOString(), 'snapshot-1');
  assert.equal(items.length, 1);
  assert.equal(items[0].original_url, 'https://github.com/example/tool-1');
  assert.equal(items[0].published_at, null);
  assert.notEqual(items[0].updated_at, items[0].captured_at);
  assert.equal(items[0].summary, 'Bookmarks and RSS');
  assert.equal(items[0].verification_status, 'not_tested');
  assert.equal(items[0].recommendation_kind, 'rule');
});

test('refresh writes source extracts, 5+2 unique items and restartable cache', async t => {
  const dataDir = await directory(t);
  let calls = 0;
  const service = new FeedService({ dataDir, now: () => NOW, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url.origin, 'https://api.github.com');
    assert.equal(url.searchParams.get('per_page'), '30');
    assert.match(url.searchParams.get('q'), /stars:100\.\.5000/);
    assert.equal(options.headers.Authorization, undefined);
    return ok(Array.from({ length: 9 }, (_, i) => repo(i + 1)));
  } });
  assert.equal((await service.current()).items.length, 0);
  assert.equal(calls, 0, 'Reading must not fetch implicitly');
  const feed = await service.refresh();
  assert.equal(feed.refresh.status, 'ok');
  assert.equal(feed.sections.daily.length, 5);
  assert.equal(feed.sections.discover.length, 2);
  assert.equal(new Set([...feed.sections.daily, ...feed.sections.discover]).size, 7);
  const evidence = JSON.parse(await fs.readFile(path.join(dataDir, 'source-snapshots', `${feed.items[0].evidence_ref}.json`), 'utf8'));
  assert.equal(evidence.items[0].description, 'Bookmarks and RSS');
  assert.equal(evidence.items.length, 9);
  assert.deepEqual(await new FeedService({ dataDir }).current(), feed);
  assert.match((await service.refresh()).update_notice, /分钟后/);
  assert.equal(calls, 1);
});

for (const failure of ['network', 'incomplete', 'invalid', 'rate-limit', 'timeout']) {
  test(`${failure}: keep last successful data and source snapshot`, async t => {
    const dataDir = await directory(t);
    let fail = false;
    const service = new FeedService({ dataDir, now: () => NOW, cooldownMs: 0, timeoutMs: 20, fetchImpl: async (_url, options) => {
      if (!fail) return ok([repo()]);
      if (failure === 'network') throw new Error('offline');
      if (failure === 'incomplete') return ok([], { incomplete_results: true });
      if (failure === 'invalid') return ok([{}]);
      if (failure === 'timeout') return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
      return new Response('', { status: 429, headers: { 'retry-after': '60' } });
    } });
    const good = await service.refresh();
    fail = true;
    const bad = await service.refresh();
    assert.equal(bad.refresh.status, 'failed');
    assert.deepEqual(bad.items, good.items);
    assert.equal(bad.generated_at, good.generated_at);
    assert.match(bad.refresh.message, /保留上次/);
    assert.deepEqual((await new FeedService({ dataDir }).current()).items, good.items);
    assert.equal((await fs.readdir(path.join(dataDir, 'source-snapshots'))).length, 1);
  });
}

test('concurrent refreshes share one request; empty search is successful', async t => {
  const dataDir = await directory(t);
  let calls = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const service = new FeedService({ dataDir, now: () => NOW, cooldownMs: 0, fetchImpl: async () => { calls++; await pending; return ok([]); } });
  const requests = [service.refresh(), service.refresh()];
  release();
  const [one, two] = await Promise.all(requests);
  assert.equal(calls, 1);
  assert.deepEqual(one, two);
  assert.equal(one.refresh.status, 'ok');
  assert.equal(one.items.length, 0);
});

test('failed cache write preserves previous successful disk data', async t => {
  const dataDir = await directory(t);
  let counter = 0;
  const service = new FeedService({ dataDir, now: () => NOW, cooldownMs: 0, fetchImpl: async () => ok([repo(++counter)]) });
  const original = await service.refresh();
  const before = await fs.readFile(path.join(dataDir, 'live-feed.json'), 'utf8');
  service.writeFeed = async () => { throw Object.assign(new Error('No space'), { code: 'ENOSPC' }); };
  const result = await service.refresh();
  assert.equal(result.refresh.status, 'failed');
  assert.deepEqual(result.items, original.items);
  assert.equal(await fs.readFile(path.join(dataDir, 'live-feed.json'), 'utf8'), before);
});
