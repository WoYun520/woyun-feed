import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { dotInboxHash } from '../dot-inbox-service.js';
import { DOT_PENDING_DECISION_PATH, handleDotPendingRequest } from '../dot-pending-service.js';
import { PUBLIC_FEED_KEY } from './cloud-feed-service.js';
import { addCalendarDays, beijingDateKey } from './src/homeShowcase.js';
import {
  DOT_UNDERRATED_PATH, UNDERRATED_PIN_KEY, UNDERRATED_PIN_STORE_MAX, UNDERRATED_REVIEWER,
  handleDotUnderratedRequest,
} from '../dot-underrated-service.js';
import worker from '../worker.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const delivery = 'test-delivery-credential-1234567890';
const review = 'test-review-credential-0987654321';
const base = 'https://feed.example.test';
const statusId = '2108148604447883999';
const postUrl = `https://x.com/example/status/${statusId}`;
const otherId = '2108148604447884000';
const otherUrl = `https://x.com/example/status/${otherId}`;
const when = '2026-10-09T02:00:00.000Z';
// Beijing 2026-10-10, so the homepage clock's yesterday is 2026-10-09.
const snapshotAt = '2026-10-10T02:00:00.000Z';

class FakeKV {
  constructor() { this.values = new Map(); this.writes = []; }
  async get(key) { return this.values.get(key)?.raw ?? null; }
  async put(key, raw, options = {}) { this.writes.push({key, raw, options}); this.values.set(key, {raw, metadata:options.metadata}); }
  async list(options = {}) {
    const keys = [...this.values].filter(([key]) => key.startsWith(options.prefix || '')).map(([name, value]) => ({name, metadata:value.metadata}));
    return {keys, list_complete:true};
  }
}

class FeedKV {
  constructor(items, generated_at = snapshotAt) {
    this.raw = JSON.stringify({schema_version:'0.3', mode:'live', generated_at, items, sources:[], profile:{}, sections:{daily:[], discover:[]}});
    this.writes = [];
  }
  async get(key) { assert.equal(key, PUBLIC_FEED_KEY); return this.raw; }
  async put(key, raw) { this.writes.push({key, raw}); this.raw = raw; }
}

const item = (url, extra = {}) => ({
  id:extra.id || `news-${url.slice(-8)}`,
  title:extra.title || '公开帖',
  summary:'来源摘录',
  source_refs:['sopilot-all'],
  original_url:url,
  canonical_url:url,
  published_at:Object.hasOwn(extra, 'published_at') ? extra.published_at : when,
  source_item_time:Object.hasOwn(extra, 'published_at') ? extra.published_at : when,
  captured_at:Object.hasOwn(extra, 'published_at') ? extra.published_at : when,
  link_kind:'post',
  ...(extra.kosx_review ? {kosx_review:extra.kosx_review} : {}),
});

const environment = async (items = [item(postUrl), item(otherUrl, {id:'news-other'})], {generated_at = snapshotAt} = {}) => ({
  DOT_INBOX:new FakeKV(),
  PUBLIC_FEED:new FeedKV(items, generated_at),
  DOT_DELIVERY_TOKEN_HASH:await dotInboxHash(delivery),
  DOT_REVIEW_TOKEN_HASH:await dotInboxHash(review),
  kosxPoolFetch:async () => { throw Error('roster offline'); },
});

function request(method, {token = review, path = DOT_UNDERRATED_PATH, body, headers = {}} = {}) {
  return new Request(`${base}${path}`, {
    method,
    headers:{...(token === null ? {} : {Authorization:`Bearer ${token}`}), ...(body !== undefined ? {'Content-Type':'application/json'} : {}), ...headers},
    ...(body === undefined ? {} : {body:typeof body === 'string' ? body : JSON.stringify(body)}),
  });
}

const call = (env, method, body, options = {}) => handleDotUnderratedRequest(request(method, {body, ...options}), env);

test('review token pins a public post without approving, and delivery token cannot pin', async () => {
  const env = await environment();
  for (const token of [null, delivery]) {
    const denied = await call(env, 'POST', {url:postUrl, note:'Levi 已看过'}, {token});
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get('WWW-Authenticate'), 'Bearer realm="dot-underrated"');
    assert.match((await denied.json()).message, token === delivery ? /投递密钥不能钉选/ : /接收码/);
  }
  assert.equal(env.DOT_INBOX.writes.length, 0);
  assert.equal(env.PUBLIC_FEED.writes.length, 0);
  const created = await call(env, 'POST', {url:`https://twitter.com/example/status/${statusId}?s=20`, note:'Levi 已看过'});
  const pin = await created.json();
  assert.equal(created.status, 201);
  assert.equal(pin.status, 'pinned');
  assert.equal(pin.existing, false);
  assert.equal(pin.url, postUrl);
  assert.equal(pin.key, `x:${statusId}`);
  assert.equal(pin.day, '2026-10-09');
  assert.equal(pin.note, 'Levi 已看过');
  assert.equal(pin.reviewer, UNDERRATED_REVIEWER);
  assert.equal(pin.id, `news-${statusId.slice(-8)}`);
  const again = await (await call(env, 'POST', {url:postUrl, note:'后来的备注'})).json();
  assert.equal(again.existing, true);
  assert.equal(again.pinned_at, pin.pinned_at);
  assert.equal(again.note, 'Levi 已看过');
  assert.equal(env.DOT_INBOX.writes.length, 1);
  assert.equal(env.DOT_INBOX.writes[0].key, UNDERRATED_PIN_KEY);
  assert.equal(env.PUBLIC_FEED.writes.length, 0);
  const listed = await (await call(env, 'GET')).json();
  assert.equal(listed.limit, 2);
  assert.equal(listed.store_limit, UNDERRATED_PIN_STORE_MAX);
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].note, 'Levi 已看过');
});

test('a new pin is accepted from yesterday public posts, including pool approvals on that line', async () => {
  const olderId = '2108148604447884011';
  const olderUrl = `https://x.com/example/status/${olderId}`;
  const todayId = '2108148604447884012';
  const todayUrl = `https://x.com/example/status/${todayId}`;
  const missingUrl = 'https://x.com/example/status/2108148604447884013';
  const env = await environment([
    item(postUrl),
    item(otherUrl, {id:'news-pool', kosx_review:'pool'}),
    item(olderUrl, {published_at:'2026-10-08T02:00:00.000Z', kosx_review:'pool'}),
    item(todayUrl, {published_at:'2026-10-10T02:00:00.000Z', kosx_review:'pool'}),
  ]);
  const missing = await call(env, 'POST', {url:missingUrl});
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'not_public');
  for (const url of [olderUrl, todayUrl]) {
    const rejected = await call(env, 'POST', {url});
    const body = await rejected.json();
    assert.equal(rejected.status, 409);
    assert.equal(body.error, 'not_yesterday');
    assert.match(body.message, /昨日全部/);
    assert.match(body.message, /2026-10-09/);
  }
  const mixed = await call(env, 'POST', {urls:[postUrl, olderUrl]});
  assert.equal(mixed.status, 409);
  assert.equal((await mixed.json()).error, 'not_yesterday');
  assert.equal(env.DOT_INBOX.writes.length, 0);
  const pooled = await call(env, 'POST', {url:otherUrl, note:'池内昨日'});
  const poolPin = await pooled.json();
  assert.equal(pooled.status, 201);
  assert.equal(poolPin.status, 'pinned');
  assert.equal(poolPin.day, '2026-10-09');
  assert.equal(poolPin.id, 'news-pool');
  assert.equal(poolPin.existing, false);
  const created = await call(env, 'POST', {url:postUrl, note:'昨日全部里的'});
  const pin = await created.json();
  assert.equal(created.status, 201);
  assert.equal(pin.status, 'pinned');
  assert.equal(pin.day, '2026-10-09');
  assert.equal(pin.existing, false);
  assert.equal(env.PUBLIC_FEED.writes.length, 0);
});

test('listing and unpin keep working for a pin that is no longer yesterday', async () => {
  const staleId = '2108148604447884020';
  const staleUrl = `https://x.com/example/status/${staleId}`;
  const env = await environment([item(staleUrl, {published_at:'2026-10-08T02:00:00.000Z'})]);
  const stale = {
    id:'news-stale', key:`x:${staleId}`, url:staleUrl, author_handle:'example',
    day:'2026-10-08', pinned_at:'2026-10-08T03:00:00.000Z', note:'旧钉选', reviewer:UNDERRATED_REVIEWER,
  };
  await env.DOT_INBOX.put(UNDERRATED_PIN_KEY, JSON.stringify({items:[stale]}));
  const listed = await (await call(env, 'GET')).json();
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].day, '2026-10-08');
  assert.equal(listed.items[0].note, '旧钉选');
  const again = await call(env, 'POST', {url:staleUrl, note:'后来的备注'});
  const repeat = await again.json();
  assert.equal(again.status, 200);
  assert.equal(repeat.existing, true);
  assert.equal(repeat.note, '旧钉选');
  const removed = await call(env, 'DELETE', {url:staleUrl});
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).status, 'unpinned');
  const rejected = await call(env, 'POST', {url:staleUrl});
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.json()).error, 'not_yesterday');
  assert.deepEqual((await (await call(env, 'GET')).json()).items, []);
});

test('without generated_at, yesterday follows the current Asia/Shanghai clock', async () => {
  const today = beijingDateKey(Date.now());
  const yesterday = addCalendarDays(today, -1);
  const older = addCalendarDays(yesterday, -1);
  const at = day => `${day}T04:00:00.000Z`;
  const yesterdayUrl = 'https://x.com/example/status/2108148604447884101';
  const olderUrl = 'https://x.com/example/status/2108148604447884102';
  const env = await environment([
    item(yesterdayUrl, {published_at:at(yesterday)}),
    item(olderUrl, {published_at:at(older)}),
  ], {generated_at:null});
  const rejected = await call(env, 'POST', {url:olderUrl});
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.json()).error, 'not_yesterday');
  const created = await call(env, 'POST', {url:yesterdayUrl});
  const pin = await created.json();
  assert.equal(created.status, 201);
  assert.equal(pin.day, yesterday);
});

test('a missing or undated public post is not pinned, a yesterday pool post is, and approval does not pin by itself', async () => {
  const env = await environment([
    item(postUrl, {kosx_review:'pool'}),
    item(otherUrl, {published_at:null}),
  ]);
  assert.equal((await call(env, 'POST', {url:'https://x.com/example/status/2108148604447884002'})).status, 404);
  const pooled = await call(env, 'POST', {url:postUrl});
  const poolPin = await pooled.json();
  assert.equal(pooled.status, 201);
  assert.equal(poolPin.status, 'pinned');
  assert.equal(poolPin.day, '2026-10-09');
  const undated = await call(env, 'POST', {url:otherUrl});
  assert.equal(undated.status, 400);
  assert.equal((await undated.json()).error, 'undated');
  assert.equal(env.DOT_INBOX.writes.length, 1);
  const pendingEnv = await environment([item(postUrl)]);
  const intake = await handleDotPendingRequest(request('POST', {path:'/api/dot/pending', token:delivery, body:{url:postUrl}}), pendingEnv);
  assert.equal(intake.status, 201);
  const approved = await handleDotPendingRequest(request('POST', {path:DOT_PENDING_DECISION_PATH, body:{url:postUrl, status:'approved'}}), pendingEnv);
  assert.equal(approved.status, 200);
  assert.equal((await (await call(pendingEnv, 'GET')).json()).items.length, 0);
});

test('batch pin keeps order, unpin accepts DELETE or status unpinned, and the public feed only receives the pin projection', async () => {
  const env = await environment();
  const pinned = await call(env, 'POST', {urls:[otherUrl, postUrl]});
  const body = await pinned.json();
  assert.equal(pinned.status, 201);
  assert.deepEqual(body.results.map(row => row.url), [otherUrl, postUrl]);
  assert.equal(body.results.every(row => row.reviewer === 'review' && row.existing === false), true);
  const removed = await call(env, 'DELETE', {url:otherUrl});
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).status, 'unpinned');
  const rest = await call(env, 'POST', {url:postUrl, status:'unpinned'});
  assert.equal(rest.status, 200);
  assert.equal((await rest.json()).status, 'unpinned');
  assert.deepEqual((await (await call(env, 'GET')).json()).items, []);
  assert.equal((await call(env, 'DELETE', {url:postUrl})).status, 404);
  await call(env, 'POST', {url:postUrl, note:'给首页的内部备注'});
  const snapshot = env.PUBLIC_FEED.raw;
  const response = await worker.fetch(new Request(`${base}/data/public-feed.json`), env);
  const feed = await response.json();
  assert.equal(env.PUBLIC_FEED.raw, snapshot);
  assert.equal(feed.underrated_pins.length, 1);
  assert.equal(feed.underrated_pins[0].url, postUrl);
  assert.equal(feed.underrated_pins[0].day, '2026-10-09');
  assert.equal(Object.hasOwn(feed.underrated_pins[0], 'note'), false);
  assert.equal(Object.hasOwn(feed.underrated_pins[0], 'reviewer'), false);
  assert.equal(JSON.stringify(feed.underrated_pins).includes('内部备注'), false);
});

test('the pin store stops at eight and a misconfigured worker does not publish through assets', async () => {
  const ids = Array.from({length:UNDERRATED_PIN_STORE_MAX + 1}, (_, index) => `2108148604447884${String(index).padStart(3, '0')}`);
  const env = await environment(ids.map(id => item(`https://x.com/example/status/${id}`)));
  const filled = await call(env, 'POST', {urls:ids.slice(0, UNDERRATED_PIN_STORE_MAX).map(id => `https://x.com/example/status/${id}`)});
  assert.equal(filled.status, 201);
  const overflow = await call(env, 'POST', {url:`https://x.com/example/status/${ids.at(-1)}`});
  assert.equal(overflow.status, 409);
  assert.equal((await overflow.json()).error, 'pin_full');
  assert.equal((await (await call(env, 'GET')).json()).items.length, UNDERRATED_PIN_STORE_MAX);
  const assetCalls = [];
  const closed = await worker.fetch(new Request(`${base}${DOT_UNDERRATED_PATH}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url:postUrl})}), {
    ASSETS:{fetch:async request => { assetCalls.push(new URL(request.url).pathname); return new Response('asset'); }},
  });
  assert.equal(closed.status, 503);
  assert.deepEqual(assetCalls, []);
});
