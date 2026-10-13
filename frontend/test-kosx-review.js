import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { dotInboxHash } from '../dot-inbox-service.js';
import { DOT_PENDING_DECISION_PATH, DOT_PENDING_PATH, handleDotPendingRequest } from '../dot-pending-service.js';
import { PUBLIC_FEED_KEY, runScheduledUpdate } from './cloud-feed-service.js';
import { makePublicFeed } from './public-feed-data.js';
import { normalizeRepositories } from './repository-normalize.js';
import { validCachedFeed } from './src/feedCache.js';
import { selectHomeShowcase } from './src/homeShowcase.js';
import { FeedDataAdapter } from './src/dataAdapter.js';
import worker from '../worker.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const delivery = 'test-delivery-credential-1234567890';
const review = 'test-review-credential-0987654321';
const base = 'https://feed.example.test';
const statusId = '2108148604447883999';
const postUrl = `https://x.com/example/status/${statusId}`;
const otherUrl = 'https://x.com/other/status/2108148604447884000';
const when = '2026-10-10T13:01:27.954Z';

class FakeKV {
  constructor() { this.values = new Map(); this.writes = []; }
  async get(key) { return this.values.get(key)?.raw ?? null; }
  async put(key, raw, options = {}) { this.writes.push({key, raw, options}); this.values.set(key, {raw, metadata:options.metadata}); }
  async list(options = {}) {
    const keys = [...this.values].filter(([key]) => key.startsWith(options.prefix || '')).map(([name, value]) => ({name, metadata:value.metadata}));
    return {keys:keys.slice(0, options.limit || keys.length), list_complete:true};
  }
}

class FeedKV {
  constructor(feed) { this.raw = JSON.stringify(feed); this.writes = []; }
  async get() { return this.raw; }
  async put(key, raw) { this.writes.push({key, raw}); this.raw = raw; }
  json() { return JSON.parse(this.raw); }
}

const repository = () => ({
  id:123, full_name:'example/utility', description:'Public workflow utility', stargazers_count:500,
  pushed_at:'2026-09-30T01:00:00Z', created_at:'2026-09-01T01:00:00Z', archived:false, fork:false,
});
const baseFeed = () => makePublicFeed({
  schema_version:'0.3', mode:'live',
  sources:[{id:'github', status:'ok', last_success_at:when}],
  items:normalizeRepositories([repository()], when, 'old-repository-evidence'),
}, {publishedAt:when});

const environment = async () => ({
  DOT_INBOX:new FakeKV(),
  PUBLIC_FEED:new FeedKV(baseFeed()),
  DOT_DELIVERY_TOKEN_HASH:await dotInboxHash(delivery),
  DOT_REVIEW_TOKEN_HASH:await dotInboxHash(review),
});

function request(method, {token = null, path = DOT_PENDING_PATH, body, headers = {}} = {}) {
  return new Request(`${base}${path}`, {
    method,
    headers:{...(token === null ? {} : {Authorization:`Bearer ${token}`}), ...(body !== undefined ? {'Content-Type':'application/json'} : {}), ...headers},
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
  });
}
const submit = (env, body, options = {}) => handleDotPendingRequest(request('POST', {body, ...options}), env);
const decide = (env, body, options = {}) => handleDotPendingRequest(request('POST', {path:DOT_PENDING_DECISION_PATH, token:review, body, ...options}), env);

function showcase(feed) {
  return selectHomeShowcase({sources:feed.sources, allItems:feed.items, profile:feed.profile, generated_at:feed.generated_at});
}

test('approval publishes one pending link onto the public homepage and rejection takes it back', async () => {
  const env = await environment();
  const note = '群里这条值得放上首页';
  assert.equal((await submit(env, {url:postUrl, note}, {token:delivery})).status, 201);
  assert.equal(env.PUBLIC_FEED.writes.length, 0);
  assert.equal(env.PUBLIC_FEED.json().items.some(item => item.original_url === postUrl), false);
  const created = await decide(env, {url:`https://twitter.com/example/status/${statusId}?s=20`, status:'approved'});
  const decision = await created.json();
  assert.equal(created.status, 200);
  assert.equal(decision.status, 'approved');
  assert.equal(decision.existing, false);
  assert.equal(decision.published, true);
  assert.equal(decision.note, note);
  const feed = env.PUBLIC_FEED.json();
  assert.equal(validCachedFeed(feed), true);
  const published = feed.items.find(item => item.original_url === postUrl);
  assert.equal(published.origin, 'kosx_approved');
  assert.equal(published.title, note);
  assert.deepEqual(published.source_refs, ['sopilot-kosx']);
  assert.equal(feed.sources.some(source => source.id === 'sopilot-kosx'), true);
  assert.equal(feed.items.some(item => item.id.startsWith('github-')), true);
  const home = showcase(feed);
  assert.equal(home.latest.some(entry => entry.post.originalUrl === postUrl), true);
  assert.equal(home.latest.some(entry => String(entry.post.item?.title || '').includes('待筛选')), false);
  const again = await (await decide(env, {url:postUrl, status:'approved'})).json();
  assert.equal(again.existing, true);
  assert.equal(again.reviewed_at, decision.reviewed_at);
  await submit(env, {url:otherUrl});
  assert.equal(env.PUBLIC_FEED.json().items.some(item => item.original_url === otherUrl), false);
  const removed = await decide(env, {url:postUrl, status:'rejected'});
  assert.equal((await removed.json()).published, false);
  const after = env.PUBLIC_FEED.json();
  assert.equal(after.items.some(item => item.original_url === postUrl), false);
  assert.equal(after.sources.some(source => source.id === 'sopilot-kosx'), false);
  assert.equal(showcase(after).latest.some(entry => entry.post.originalUrl === postUrl), false);
});

test('only the review code can publish, and a missing queue entry stays off the homepage', async () => {
  const env = await environment();
  await submit(env, {url:postUrl});
  for (const token of [null, delivery]) {
    const response = await decide(env, {url:postUrl, status:'approved'}, {token});
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('WWW-Authenticate'), 'Bearer realm="dot-pending"');
  }
  assert.equal((await decide(env, {url:otherUrl, status:'approved'})).status, 404);
  assert.equal((await decide(env, {url:postUrl, status:'featured'})).status, 400);
  assert.equal((await handleDotPendingRequest(request('GET', {path:DOT_PENDING_DECISION_PATH, token:review}), env)).status, 405);
  assert.equal(env.PUBLIC_FEED.writes.length, 0);
  const home = showcase(env.PUBLIC_FEED.json());
  assert.equal(home.latest.some(entry => entry.post.originalUrl === postUrl), false);
});

test('a scheduled rebuild keeps approved links and still omits pending ones', async () => {
  const env = await environment();
  await submit(env, {url:postUrl, note:'留下'}, {token:delivery});
  await submit(env, {url:otherUrl});
  assert.equal((await decide(env, {url:postUrl, status:'approved'})).status, 200);
  const writes = [];
  const feed = env.PUBLIC_FEED;
  const scheduled = {
    ...env,
    PUBLIC_FEED:{
      async get() { return feed.json(); },
      async put(key, raw) { writes.push({key, raw}); feed.raw = raw; },
    },
  };
  const originalLog = console.log;
  console.log = () => {};
  try {
    const next = await runScheduledUpdate(scheduled, {
      definitions:[],
      now:() => new Date('2026-10-13T03:00:00.000Z'),
      fetchImpl:async url => {
        if (new URL(url).hostname !== 'api.github.com') throw new Error('unexpected source');
        return new Response(JSON.stringify({items:[repository()], incomplete_results:false}), {headers:{'Content-Type':'application/json'}});
      },
    });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].key, PUBLIC_FEED_KEY);
    assert.equal(next.items.some(item => item.original_url === postUrl && item.origin === 'kosx_approved'), true);
    assert.equal(next.items.some(item => item.original_url === otherUrl), false);
    assert.equal(validCachedFeed(next), true);
  } finally { console.log = originalLog; }
});

test('homepage paste does not claim success for an approved link', async () => {
  const previousStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;
  const bag = new Map();
  globalThis.localStorage = {getItem:key => bag.get(key) ?? null, setItem:(key, value) => bag.set(key, value), removeItem:key => bag.delete(key), key:index => [...bag.keys()][index] ?? null, get length() { return bag.size; }};
  globalThis.fetch = async () => new Response(JSON.stringify({status:'approved', existing:true, message:'这条已经在公开首页。'}), {status:200, headers:{'Content-Type':'application/json'}});
  try {
    const adapter = new FeedDataAdapter();
    adapter.feedData = {mode:'live', schema_version:'0.3', profile:{}, items:[], sources:[], sections:{daily:[], discover:[]}, generated_at:when};
    await assert.rejects(() => adapter.submitKosxLink(postUrl), /已经在公开首页/);
    assert.equal(adapter.localState.kosx_pending.length, 0);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});

test('worker leaves the decision route unavailable without secrets and does not publish through assets', async () => {
  const assetCalls = [];
  const env = {ASSETS:{fetch:async request => { assetCalls.push(new URL(request.url).pathname); return new Response('asset'); }}};
  const response = await worker.fetch(new Request(`${base}${DOT_PENDING_DECISION_PATH}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url:postUrl, status:'approved'})}), env);
  assert.equal(response.status, 503);
  assert.deepEqual(assetCalls, []);
});
