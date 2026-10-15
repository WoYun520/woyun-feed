import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { dotInboxHash } from '../dot-inbox-service.js';
import { DOT_PENDING_PATH, handleDotPendingRequest } from '../dot-pending-service.js';
import { PUBLIC_FEED_KEY, runScheduledUpdate } from './cloud-feed-service.js';
import { KOSX_POOL_CACHE_KEY, KOSX_POOL_MAX_AGE_MS, loadKosxPoolHandles, parsePoolCache, poolCacheFresh, serializePoolCache } from './kosx-pool-cache.js';
import { handlesFromRoster as sharedHandles } from './kosx-pool-roster.js';
import { handlesFromRoster, renderPoolModule } from './refresh-kosx-pool.mjs';
import { KOSX_POOL_HANDLES } from './kosx-pool.js';
import { makePublicFeed } from './public-feed-data.js';
import { normalizeRepositories } from './repository-normalize.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const delivery = 'test-delivery-credential-1234567890';
const review = 'test-review-credential-0987654321';
const base = 'https://feed.example.test';
const when = '2026-10-10T13:01:27.954Z';
const statusId = '2108148604447883555';
const member = KOSX_POOL_HANDLES[0];
const rosterWithFollowers = {members:[
  {handle:'PoolNewbie1', display_name:'新人', latest_followers:863701},
]};

class FakeKV {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key)?.raw ?? null; }
  async put(key, raw, options = {}) { this.values.set(key, {raw, metadata:options.metadata}); }
  async list(options = {}) {
    const keys = [...this.values].filter(([key]) => key.startsWith(options.prefix || '')).map(([name, value]) => ({name, metadata:value.metadata}));
    return {keys:keys.slice(0, options.limit || keys.length), list_complete:true};
  }
}

class FeedKV {
  constructor(feed) { this.raw = JSON.stringify(feed); this.writes = []; }
  async get() { return JSON.parse(this.raw); }
  async put(key, raw) { this.writes.push({key, raw}); this.raw = raw; }
  json() { return JSON.parse(this.raw); }
}

const repository = () => ({
  id:123, full_name:'example/utility', description:'Public workflow utility', stargazers_count:500,
  pushed_at:'2026-09-30T01:00:00Z', created_at:'2026-09-01T01:00:00Z', archived:false, fork:false,
});

function baseFeed() {
  return makePublicFeed({
    schema_version:'0.3', mode:'live',
    sources:[{id:'github', status:'ok', last_success_at:when}],
    items:normalizeRepositories([repository()], when, 'old-repository-evidence'),
  }, {publishedAt:when});
}

const environment = async (kosxPoolFetch) => ({
  DOT_INBOX:new FakeKV(),
  PUBLIC_FEED:new FeedKV(baseFeed()),
  DOT_DELIVERY_TOKEN_HASH:await dotInboxHash(delivery),
  DOT_REVIEW_TOKEN_HASH:await dotInboxHash(review),
  kosxPoolFetch,
});

function request(body, {token = delivery} = {}) {
  return new Request(`${base}${DOT_PENDING_PATH}`, {
    method:'POST',
    headers:{...(token === null ? {} : {Authorization:`Bearer ${token}`}), 'Content-Type':'application/json'},
    body:JSON.stringify(body),
  });
}
const submit = (env, body, options) => handleDotPendingRequest(request(body, options), env);
const post = (handle, id = statusId) => ({url:`https://x.com/${handle}/status/${id}`});
const cacheRaw = env => env.DOT_INBOX.values.get(KOSX_POOL_CACHE_KEY)?.raw;

test('roster parsing is shared and keeps only handles', () => {
  assert.equal(handlesFromRoster, sharedHandles);
  assert.deepEqual(handlesFromRoster(rosterWithFollowers), ['poolnewbie1']);
  assert.throws(() => handlesFromRoster({members:[]}), /members/);
  assert.throws(() => handlesFromRoster({members:[{handle:'AbC'}, {handle:'abc'}]}), /重复/);
  const rendered = renderPoolModule(handlesFromRoster(rosterWithFollowers), '2026-10-15T00:00:00.000Z');
  assert.equal(rendered.includes('863701'), false);
  assert.equal(rendered.includes('latest_followers'), false);
  assert.equal(rendered.includes('display_name'), false);
  const now = Date.parse('2026-10-15T02:00:00.000Z');
  assert.equal(poolCacheFresh(new Date(now - KOSX_POOL_MAX_AGE_MS + 1).toISOString(), now), true);
  assert.equal(poolCacheFresh(new Date(now - KOSX_POOL_MAX_AGE_MS).toISOString(), now), false);
  assert.equal(parsePoolCache(serializePoolCache(['poolnewbie1'], '2026-10-15T00:00:00.000Z')).handles[0], 'poolnewbie1');
  assert.equal(parsePoolCache(JSON.stringify({handles:['poolnewbie1'], fetched_at:'2026-10-15T00:00:00.000Z', latest_followers:1})), null);
});

test('a stale delivery refreshes the pool, drops follower counts, and then trusts that cache', async () => {
  let calls = 0;
  const env = await environment(async () => {
    calls += 1;
    return new Response(JSON.stringify(rosterWithFollowers), {status:200, headers:{'Content-Type':'application/json'}});
  });
  await env.DOT_INBOX.put(KOSX_POOL_CACHE_KEY, JSON.stringify({handles:['oldcache1'], fetched_at:'2020-01-01T00:00:00.000Z'}));
  const created = await submit(env, post('PoolNewbie1'));
  const body = await created.json();
  assert.equal(created.status, 201);
  assert.equal(body.pool, true);
  assert.equal(body.published, true);
  assert.equal(body.approval, 'pool');
  assert.equal(calls, 1);
  const stored = cacheRaw(env);
  assert.equal(stored.includes('863701'), false);
  assert.equal(stored.includes('latest_followers'), false);
  assert.equal(stored.includes('display_name'), false);
  assert.equal(stored.includes('oldcache1'), false);
  assert.match(stored, /poolnewbie1/);
  const item = env.PUBLIC_FEED.json().items.find(entry => entry.original_url.toLowerCase() === 'https://x.com/poolnewbie1/status/2108148604447883555');
  assert.equal(JSON.stringify(item).includes('latest_followers'), false);
  assert.equal(JSON.stringify(item).includes('863701'), false);
  const left = await (await submit(env, post(member, '2108148604447883556'))).json();
  assert.equal(left.pool, false);
  assert.equal(left.status, 'pending');
  assert.equal(left.published, false);
  assert.equal(calls, 1);
});

test('a failed roster fetch keeps the last cache and still accepts the delivery', async () => {
  const env = await environment(async () => { throw Error('roster down'); });
  const previous = JSON.stringify({handles:['staleonly1'], fetched_at:'2020-01-01T00:00:00.000Z'});
  await env.DOT_INBOX.put(KOSX_POOL_CACHE_KEY, previous);
  const created = await submit(env, post('staleonly1'));
  const body = await created.json();
  assert.equal(created.status, 201);
  assert.equal(body.pool, true);
  assert.equal(body.published, true);
  assert.equal(body.approval, 'pool');
  const committed = await (await submit(env, post(member, '2108148604447883556'))).json();
  assert.equal(committed.pool, false);
  assert.equal(committed.published, false);
  assert.equal(cacheRaw(env), previous);
});

test('with no usable cache, a failed roster fetch uses the committed list and does not fail intake', async () => {
  let calls = 0;
  const env = await environment(async () => { calls += 1; throw Error('roster down'); });
  await env.DOT_INBOX.put(KOSX_POOL_CACHE_KEY, JSON.stringify({handles:['poisoned1'], fetched_at:'2020-01-01T00:00:00.000Z', latest_followers:10}));
  const poisoned = await submit(env, post('poisoned1'));
  const poisonedBody = await poisoned.json();
  assert.equal(poisoned.status, 201);
  assert.equal(poisonedBody.pool, false);
  assert.equal(poisonedBody.published, false);
  const known = await submit(env, post(member, '2108148604447883556'));
  const knownBody = await known.json();
  assert.equal(known.status, 201);
  assert.equal(knownBody.pool, true);
  assert.equal(knownBody.published, true);
  assert.equal(knownBody.approval, 'pool');
  assert.equal(calls, 2);
  assert.equal(cacheRaw(env).includes('latest_followers'), true);
  const empty = await environment(async () => { throw Error('roster down'); });
  const outsider = await (await submit(empty, post('poolnewbie1'))).json();
  assert.equal(outsider.status, 'pending');
  assert.equal(outsider.pool, false);
  const fallback = await (await submit(empty, post(member, '2108148604447883556'))).json();
  assert.equal(fallback.pool, true);
  assert.equal(fallback.published, true);
  assert.equal(cacheRaw(empty), undefined);
});

test('homepage paste does not fetch the roster', async () => {
  let calls = 0;
  const env = await environment(async () => { calls += 1; throw Error('roster down'); });
  const pasted = await submit(env, post(member, '2108148604447883777'), {token:null});
  assert.equal(pasted.status, 201);
  assert.equal((await pasted.json()).status, 'pending');
  assert.equal(calls, 0);
});

test('the scheduled update refreshes a fresh cache and keeps the last cache when the roster fails', async () => {
  const env = await environment(async () => { throw Error('unused'); });
  const freshAt = new Date().toISOString();
  await env.DOT_INBOX.put(KOSX_POOL_CACHE_KEY, JSON.stringify({handles:['oldcache1'], fetched_at:freshAt}));
  let rosterCalls = 0;
  const fetchImpl = async url => {
    const href = String(url);
    if (href.includes('impact.kosx.ai/api/members')) {
      rosterCalls += 1;
      return new Response(JSON.stringify(rosterWithFollowers), {status:200, headers:{'Content-Type':'application/json'}});
    }
    if (new URL(href).hostname === 'api.github.com') {
      return new Response(JSON.stringify({items:[repository()], incomplete_results:false}), {headers:{'Content-Type':'application/json'}});
    }
    throw Error('unexpected source');
  };
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    await runScheduledUpdate(env, {definitions:[], fetchImpl, now:() => new Date('2026-10-15T03:00:00.000Z')});
    assert.equal(rosterCalls, 1);
    assert.equal(env.PUBLIC_FEED.writes[0].key, PUBLIC_FEED_KEY);
    const stored = cacheRaw(env);
    assert.match(stored, /poolnewbie1/);
    assert.equal(stored.includes('oldcache1'), false);
    assert.equal(stored.includes('latest_followers'), false);
    assert.equal(stored.includes('863701'), false);
    assert.match(stored, /2026-10-15T03:00:00.000Z/);
    const handles = await loadKosxPoolHandles(env, {now:'2026-10-15T03:30:00.000Z', fetchImpl:async () => { throw Error('must stay fresh'); }});
    assert.equal(handles.has('poolnewbie1'), true);
    assert.equal(handles.has(member), false);

    const kept = JSON.stringify({handles:['staleonly1'], fetched_at:'2020-01-01T00:00:00.000Z'});
    await env.DOT_INBOX.put(KOSX_POOL_CACHE_KEY, kept);
    const before = env.PUBLIC_FEED.writes.length;
    await runScheduledUpdate(env, {
      definitions:[],
      now:() => new Date('2026-10-15T04:00:00.000Z'),
      fetchImpl:async url => {
        if (String(url).includes('impact.kosx.ai')) throw Error('roster down');
        if (new URL(url).hostname === 'api.github.com') {
          return new Response(JSON.stringify({items:[repository()], incomplete_results:false}), {headers:{'Content-Type':'application/json'}});
        }
        throw Error('unexpected source');
      },
    });
    assert.equal(cacheRaw(env), kept);
    assert.equal(env.PUBLIC_FEED.writes.length, before + 1);
    const fallback = await loadKosxPoolHandles(env, {now:Date.now(), fetchImpl:async () => { throw Error('roster down'); }});
    assert.equal(fallback.has('staleonly1'), true);
    assert.equal(fallback.has('poolnewbie1'), false);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
});
