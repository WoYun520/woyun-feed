import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { dotInboxHash } from '../dot-inbox-service.js';
import { DOT_PENDING_DECISION_PATH, handleDotPendingRequest } from '../dot-pending-service.js';
import { PUBLIC_FEED_KEY } from './cloud-feed-service.js';
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
  constructor(items) { this.raw = JSON.stringify({schema_version:'0.3', mode:'live', items, sources:[], profile:{}, sections:{daily:[], discover:[]}}); this.writes = []; }
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

const environment = async (items = [item(postUrl), item(otherUrl, {id:'news-other'})]) => ({
  DOT_INBOX:new FakeKV(),
  PUBLIC_FEED:new FeedKV(items),
  DOT_DELIVERY_TOKEN_HASH:await dotInboxHash(delivery),
  DOT_REVIEW_TOKEN_HASH:await dotInboxHash(review),
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

test('a missing, pooled, or undated public post is not pinned and approval does not pin by itself', async () => {
  const env = await environment([
    item(postUrl, {kosx_review:'pool'}),
    item(otherUrl, {published_at:null}),
  ]);
  assert.equal((await call(env, 'POST', {url:'https://x.com/example/status/2108148604447884002'})).status, 404);
  const pooled = await call(env, 'POST', {url:postUrl});
  assert.equal(pooled.status, 409);
  assert.equal((await pooled.json()).error, 'pool_not_pinnable');
  const undated = await call(env, 'POST', {url:otherUrl});
  assert.equal(undated.status, 400);
  assert.equal((await undated.json()).error, 'undated');
  assert.equal(env.DOT_INBOX.writes.length, 0);
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
