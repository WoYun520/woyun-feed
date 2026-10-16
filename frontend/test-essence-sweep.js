import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { dotInboxHash } from '../dot-inbox-service.js';
import { DOT_PENDING_PREFIX, handleDotPendingRequest } from '../dot-pending-service.js';
import { UNDERRATED_PIN_KEY } from '../dot-underrated-service.js';
import { makePublicFeed } from './public-feed-data.js';
import { normalizeRepositories } from './repository-normalize.js';
import { KOSX_POOL_HANDLES } from './kosx-pool.js';
import { HOME_LATEST_WINDOW_DAYS } from './src/homeShowcase.js';
import {
  ESSENCE_INTAKE_CAP, ESSENCE_SWEEP_BUDGET, ESSENCE_SWEEP_CRON, ESSENCE_SWEEP_INTERVAL_MS,
  ESSENCE_SWEEP_STATE_KEY, PENDING_AUTO_APPROVE_MS, PUBLIC_REFRESH_CRON,
  backoffActive, fillMissingCounts, shouldAutoApprove, sweepWaitMs,
} from './essence-schedule.js';
import { selectSweepIntake, runEssenceSweep, backfillEssenceHeat } from './essence-sweep.js';
import { autoApproveStalePending } from '../dot-pending-service.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const delivery = 'test-delivery-credential-1234567890';
const review = 'test-review-credential-0987654321';
const when = '2026-10-10T13:01:27.954Z';
const now = Date.parse(when);
const pool = KOSX_POOL_HANDLES[0];

class FakeKV {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key)?.raw ?? null; }
  async put(key, raw, options = {}) { this.values.set(key, {raw, metadata:options.metadata || {}}); }
  async list(options = {}) {
    const keys = [...this.values].filter(([key]) => key.startsWith(options.prefix || '')).map(([name, value]) => ({name, metadata:value.metadata}));
    return {keys, list_complete:true};
  }
}

class FeedKV {
  constructor(feed) { this.raw = JSON.stringify(feed); }
  async get() { return this.raw; }
  async put(key, raw) { this.raw = raw; }
  json() { return JSON.parse(this.raw); }
}

function seedFeed(items = []) {
  const feed = makePublicFeed({
    schema_version:'0.3', mode:'live',
    sources:[{id:'github', status:'ok', last_success_at:when}],
    items:normalizeRepositories([{
      id:123, full_name:'example/utility', description:'Public workflow utility', stargazers_count:500,
      pushed_at:'2026-09-30T01:00:00Z', created_at:'2026-09-01T01:00:00Z', archived:false, fork:false,
    }], when, 'old-repository-evidence'),
  }, {publishedAt:when});
  feed.items.push(...items);
  feed.generated_at = when;
  return feed;
}

const environment = async (items) => ({
  DOT_INBOX:new FakeKV(),
  PUBLIC_FEED:new FeedKV(seedFeed(items)),
  DOT_DELIVERY_TOKEN_HASH:await dotInboxHash(delivery),
  DOT_REVIEW_TOKEN_HASH:await dotInboxHash(review),
  kosxPoolFetch:async () => { throw Error('roster offline'); },
});

function request(method, {token = null, path = '/api/dot/pending', body} = {}) {
  return new Request(`https://feed.example.test${path}`, {
    method,
    headers:{...(token ? {Authorization:`Bearer ${token}`} : {}), ...(body ? {'Content-Type':'application/json'} : {})},
    ...(body ? {body:JSON.stringify(body)} : {}),
  });
}

const postItem = (handle, id, published_at, extra = {}) => ({
  id:`stream-${id}`, title:`公开帖 ${id}`, summary:'摘录', source_refs:['sopilot-all'], link_kind:'post',
  original_url:`https://x.com/${handle}/status/${id}`, canonical_url:`https://x.com/${handle}/status/${id}`,
  published_at, author_handle:handle, ...extra,
});

function age(env, url, iso) {
  const row = [...env.DOT_INBOX.values.values()].map(entry => JSON.parse(entry.raw)).find(record => record.url === url);
  row.submitted_at = iso;
  env.DOT_INBOX.values.set(`${DOT_PENDING_PREFIX}${row.key}`, {raw:JSON.stringify(row), metadata:{status:row.status, submitted_at:iso}});
}

test('the 3-hour essence sweep is configured beside the twice-daily public refresh', () => {
  const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  assert.equal(ESSENCE_SWEEP_CRON, '0 */3 * * *');
  assert.equal(PUBLIC_REFRESH_CRON, '0 1,13 * * *');
  assert.equal(ESSENCE_SWEEP_INTERVAL_MS, 3 * 60 * 60 * 1000);
  assert.equal(PENDING_AUTO_APPROVE_MS, 3 * 60 * 60 * 1000);
  assert.equal(HOME_LATEST_WINDOW_DAYS, 3);
  assert.equal(ESSENCE_SWEEP_BUDGET.x_api, 0);
  assert.equal(ESSENCE_SWEEP_BUDGET.llm_tokens, 0);
  assert.equal(ESSENCE_SWEEP_BUDGET.roster_gets, 1);
  assert.equal(ESSENCE_SWEEP_BUDGET.queue_writes, ESSENCE_INTAKE_CAP);
  assert.match(wrangler, /0 1,13 \* \* \*/);
  assert.match(wrangler, /0 \*\/3 \* \* \*/);
  assert.match(worker, /ESSENCE_SWEEP_CRON/);
  assert.match(worker, /runEssenceSweep/);
  assert.equal(sweepWaitMs(0), 0);
  assert.equal(sweepWaitMs(1), 6 * 60 * 60 * 1000);
  assert.equal(sweepWaitMs(2), 12 * 60 * 60 * 1000);
  assert.equal(sweepWaitMs(3), 24 * 60 * 60 * 1000);
  assert.equal(sweepWaitMs(8), 24 * 60 * 60 * 1000);
  assert.equal(backoffActive({failures:1, last_failure_at:new Date(now - 60 * 60 * 1000).toISOString()}, now), true);
  assert.equal(backoffActive({failures:1, last_failure_at:new Date(now - 7 * 60 * 60 * 1000).toISOString()}, now), false);
});

test('intake keeps pool posts from the last two Beijing days that are not queued yet', () => {
  const fresh = '2108148604447884801';
  const old = '2108148604447884802';
  const queued = '2108148604447884803';
  const outsider = '2108148604447884804';
  const duplicate = '2108148604447884805';
  const items = [
    postItem(pool, fresh, '2026-10-10T01:00:00.000Z', {bookmark_count:12, like_count:3}),
    postItem(pool, old, '2026-10-08T01:00:00.000Z'),
    postItem(pool, queued, '2026-10-10T02:00:00.000Z'),
    postItem('not-in-pool', outsider, '2026-10-10T03:00:00.000Z'),
    postItem(pool, duplicate, '2026-10-10T04:00:00.000Z'),
    postItem(pool, duplicate, '2026-10-10T04:00:00.000Z', {bookmark_count:9}),
    postItem(pool, '2108148604447884806', '2026-10-09T01:00:00.000Z'),
    {original_url:'not a url', author_handle:pool, published_at:'2026-10-10T01:00:00.000Z'},
    null,
  ];
  const selected = selectSweepIntake(items, {
    handles:new Set([pool]),
    queuedKeys:new Set([`x:${queued}`]),
    now,
    cap:ESSENCE_INTAKE_CAP,
  });
  assert.deepEqual(selected.map(post => post.key), [`x:${duplicate}`, `x:${fresh}`, 'x:2108148604447884806']);
  assert.equal(selected.find(post => post.key === `x:${fresh}`).bookmark_count, 12);
  assert.equal(selected.find(post => post.key === `x:${fresh}`).text, '摘录');
  assert.match(selected.find(post => post.key === `x:${fresh}`).note, /公开帖/);
  assert.equal(selected.find(post => post.key === `x:${fresh}`).like_count, 3);
  assert.equal(selectSweepIntake(items, {handles:new Set([pool]), queuedKeys:new Set(), now, cap:1}).length, 1);
});

test('a sweep enqueues from the snapshot without calling the X API', async () => {
  const id = '2108148604447884810';
  const env = await environment([postItem(pool, id, '2026-10-10T01:00:00.000Z', {bookmark_count:30, like_count:4})]);
  const calls = [];
  env.kosxPoolFetch = async url => {
    calls.push(String(url));
    if (/api\.x\.com|api\.twitter\.com/.test(String(url))) throw Error('paid');
    throw Error('roster offline');
  };
  const report = await runEssenceSweep(env, {now, fetchImpl:env.kosxPoolFetch});
  assert.equal(report.x_api, 0);
  assert.equal(report.llm_tokens, 0);
  assert.equal(report.enqueued, 1);
  assert.equal(calls.some(url => /api\.x\.com|api\.twitter\.com/.test(url)), false);
  const row = [...env.DOT_INBOX.values.values()].map(entry => JSON.parse(entry.raw)).find(record => record.url.endsWith(id));
  assert.equal(row.source, 'delivery');
  assert.equal(row.status, 'approved');
  assert.equal(row.approval, 'pool');
  assert.equal(env.PUBLIC_FEED.json().items.some(item => item.original_url === row.url && item.origin === 'kosx_approved'), true);
});

test('delivery pending older than 3 hours is auto-approved without a pin; paste and fresh rows stay pending', async () => {
  const env = await environment();
  const stale = 'https://x.com/example/status/2108148604447884821';
  const fresh = 'https://x.com/example/status/2108148604447884822';
  const pasted = 'https://x.com/example/status/2108148604447884823';
  const held = `https://x.com/${pool}/status/2108148604447884824`;
  assert.equal((await handleDotPendingRequest(request('POST', {token:delivery, body:{url:stale}}), env)).status, 201);
  assert.equal((await handleDotPendingRequest(request('POST', {token:delivery, body:{url:fresh}}), env)).status, 201);
  assert.equal((await handleDotPendingRequest(request('POST', {body:{url:pasted}}), env)).status, 201);
  const heldResponse = await (await handleDotPendingRequest(request('POST', {token:delivery, body:{url:held, published_at:'2026-10-09T02:00:00.000Z'}}), env)).json();
  assert.equal(heldResponse.status, 'pending');
  const old = new Date(now - PENDING_AUTO_APPROVE_MS - 1000).toISOString();
  const exact = new Date(now - PENDING_AUTO_APPROVE_MS).toISOString();
  age(env, stale, old);
  age(env, fresh, exact);
  age(env, pasted, old);
  age(env, held, old);
  assert.equal(shouldAutoApprove({status:'pending', source:'delivery', submitted_at:old}, now), true);
  assert.equal(shouldAutoApprove({status:'pending', source:'delivery', submitted_at:exact}, now), false);
  assert.equal(shouldAutoApprove({status:'pending', source:'homepage', submitted_at:old}, now), false);
  assert.equal(shouldAutoApprove({status:'pending', source:'delivery', created_at:old}, now), true);
  const done = await autoApproveStalePending(env, {now});
  assert.deepEqual(done.approved.sort(), ['x:2108148604447884821', 'x:2108148604447884824'].sort());
  const rows = [...env.DOT_INBOX.values.values()].map(entry => JSON.parse(entry.raw));
  assert.equal(rows.find(row => row.url === stale).approval, 'auto');
  assert.equal(rows.find(row => row.url === held).status, 'approved');
  assert.equal(rows.find(row => row.url === held).approval, 'auto');
  assert.equal(rows.find(row => row.url === fresh).status, 'pending');
  assert.equal(rows.find(row => row.url === pasted).status, 'pending');
  const feed = env.PUBLIC_FEED.json();
  assert.equal(feed.items.some(item => item.original_url === stale && item.origin === 'kosx_approved'), true);
  assert.equal(feed.items.some(item => item.original_url === held && item.origin === 'kosx_approved'), true);
  assert.equal(feed.items.some(item => item.original_url === pasted), false);
  assert.equal(env.DOT_INBOX.values.has(UNDERRATED_PIN_KEY), false);
});

test('heat backfill copies known counts and ignores empty fields', async () => {
  assert.deepEqual(fillMissingCounts(null, {bookmark_count:5}), {record:null, changed:false});
  assert.equal(fillMissingCounts(undefined, null).changed, false);
  assert.equal(fillMissingCounts({}, {bookmark_count:null, like_count:''}).changed, false);
  assert.equal(fillMissingCounts({}, {bookmark_count:-1, like_count:1.5}).changed, false);
  assert.equal(fillMissingCounts({bookmark_count:0}, {bookmark_count:9}).record.bookmark_count, 0);
  const filled = fillMissingCounts({like_count:null}, {bookmark_count:1000, like_count:4});
  assert.equal(filled.changed, true);
  assert.equal(filled.record.bookmark_count, 1000);
  assert.equal(filled.record.like_count, 4);
  assert.equal(fillMissingCounts({}, {}).changed, false);
  assert.equal(fillMissingCounts({bookmark_count:undefined, like_count:undefined}, {}).changed, false);

  const env = await environment();
  const url = 'https://x.com/example/status/2108148604447884830';
  await handleDotPendingRequest(request('POST', {token:delivery, body:{url, published_at:'2026-10-10T01:00:00.000Z'}}), env);
  await handleDotPendingRequest(request('POST', {token:review, path:'/api/dot/pending/decision', body:{url, status:'approved'}}), env);
  const key = `${DOT_PENDING_PREFIX}x:2108148604447884830`;
  const record = JSON.parse(env.DOT_INBOX.values.get(key).raw);
  assert.equal(Object.hasOwn(record, 'bookmark_count'), false);
  const feed = env.PUBLIC_FEED.json();
  feed.items.push({
    id:'donor-2108148604447884830', title:'榜单', summary:'摘录', source_refs:['sopilot-all'], link_kind:'post',
    original_url:url, canonical_url:url, published_at:'2026-10-10T01:00:00.000Z', bookmark_count:1200,
  });
  const bare = 'https://x.com/example/status/2108148604447884831';
  await handleDotPendingRequest(request('POST', {token:delivery, body:{url:bare, published_at:'2026-10-10T02:00:00.000Z'}}), env);
  await handleDotPendingRequest(request('POST', {token:review, path:'/api/dot/pending/decision', body:{url:bare, status:'approved'}}), env);
  feed.items.push({id:'bare', title:'空', summary:'摘录', source_refs:['sopilot-all'], original_url:bare, canonical_url:bare, published_at:'2026-10-10T02:00:00.000Z'});
  env.PUBLIC_FEED.raw = JSON.stringify(feed);
  const quiet = await backfillEssenceHeat(env);
  assert.equal(quiet.updated, 1);
  const next = JSON.parse(env.DOT_INBOX.values.get(key).raw);
  assert.equal(next.bookmark_count, 1200);
  assert.equal(Object.hasOwn(next, 'like_count'), false);
  const bareRecord = JSON.parse(env.DOT_INBOX.values.get(`${DOT_PENDING_PREFIX}x:2108148604447884831`).raw);
  assert.equal(Object.hasOwn(bareRecord, 'bookmark_count'), false);
  assert.equal(Object.hasOwn(bareRecord, 'like_count'), false);
  const published = env.PUBLIC_FEED.json().items.find(item => item.origin === 'kosx_approved' && item.original_url === url);
  assert.equal(published.bookmark_count, 1200);
  assert.equal(Object.hasOwn(published, 'like_count'), false);
});

test('a failed sweep backs off and the next attempt inside the window does not scan again', async () => {
  const env = await environment();
  env.PUBLIC_FEED.get = async () => { throw Error('down'); };
  const first = await runEssenceSweep(env, {now});
  assert.equal(first.scan_failed, true);
  assert.equal(first.x_api, 0);
  const state = JSON.parse(env.DOT_INBOX.values.get(ESSENCE_SWEEP_STATE_KEY).raw);
  assert.equal(state.failures, 1);
  const second = await runEssenceSweep(env, {now:now + 60 * 60 * 1000});
  assert.equal(second.scan_skipped, true);
  assert.equal(JSON.parse(env.DOT_INBOX.values.get(ESSENCE_SWEEP_STATE_KEY).raw).failures, 1);
});
