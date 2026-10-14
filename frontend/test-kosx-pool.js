import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { dotInboxHash } from '../dot-inbox-service.js';
import { DOT_PENDING_DECISION_PATH, DOT_PENDING_PATH, handleDotPendingRequest } from '../dot-pending-service.js';
import { handlesFromRoster, renderPoolModule } from './refresh-kosx-pool.mjs';
import { isKosxPoolHandle, KOSX_POOL_HANDLES } from './kosx-pool.js';
import { kosxPublicItem, kosxPublicSource, originalPostInstant, X_SNOWFLAKE_EPOCH_MS } from './kosx-public-posts.js';
import { DOT_UNDERRATED_PATH, handleDotUnderratedRequest } from '../dot-underrated-service.js';
import { makePublicFeed } from './public-feed-data.js';
import { normalizeRepositories } from './repository-normalize.js';
import { validCachedFeed } from './src/feedCache.js';
import { addCalendarDays, beijingDateKey, selectHomeShowcase, wouldEnterUnderrated } from './src/homeShowcase.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const delivery = 'test-delivery-credential-1234567890';
const review = 'test-review-credential-0987654321';
const base = 'https://feed.example.test';
const poolHandle = KOSX_POOL_HANDLES[0];
const otherPoolHandle = KOSX_POOL_HANDLES[1];
const poolStatusId = '2108148604447883555';
const poolUrl = `https://x.com/${poolHandle}/status/${poolStatusId}`;
const snowflakeAt = new Date(Number((BigInt(poolStatusId) >> 22n) + BigInt(X_SNOWFLAKE_EPOCH_MS))).toISOString();
const secondPoolUrl = `https://x.com/${otherPoolHandle}/status/2108148604447883556`;
const outsiderUrl = 'https://x.com/example/status/2108148604447883666';
const when = '2026-10-10T13:01:27.954Z';

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
  async get() { return this.raw; }
  async put(key, raw) { this.writes.push({key, raw}); this.raw = raw; }
  json() { return JSON.parse(this.raw); }
}

const environment = async (feed) => ({
  DOT_INBOX:new FakeKV(),
  PUBLIC_FEED:new FeedKV(feed || baseFeed()),
  DOT_DELIVERY_TOKEN_HASH:await dotInboxHash(delivery),
  DOT_REVIEW_TOKEN_HASH:await dotInboxHash(review),
});

function baseFeed() {
  return makePublicFeed({
    schema_version:'0.3', mode:'live',
    sources:[{id:'github', status:'ok', last_success_at:when}],
    items:normalizeRepositories([{
      id:123, full_name:'example/utility', description:'Public workflow utility', stargazers_count:500,
      pushed_at:'2026-09-30T01:00:00Z', created_at:'2026-09-01T01:00:00Z', archived:false, fork:false,
    }], when, 'old-repository-evidence'),
  }, {publishedAt:when});
}

function request(method, {token = null, path = DOT_PENDING_PATH, body} = {}) {
  return new Request(`${base}${path}`, {
    method,
    headers:{...(token === null ? {} : {Authorization:`Bearer ${token}`}), ...(body !== undefined ? {'Content-Type':'application/json'} : {})},
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
  });
}
const submit = (env, body, options = {}) => handleDotPendingRequest(request('POST', {body, ...options}), env);
const decide = (env, body) => handleDotPendingRequest(request('POST', {path:DOT_PENDING_DECISION_PATH, token:review, body}), env);
const showcase = feed => selectHomeShowcase({sources:feed.sources, allItems:feed.items, profile:feed.profile, generated_at:feed.generated_at});

function nextBeijingInstant(from = Date.now()) {
  const next = addCalendarDays(beijingDateKey(from), 1);
  const [year, month, day] = next.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 4, 0, 0)).toISOString();
}

test('the roster is handles only, sourced from impact, and matches case-insensitively', () => {
  const text = readFileSync(new URL('./kosx-pool.js', import.meta.url), 'utf8');
  assert.equal(text.includes('latest_followers'), false);
  assert.equal(text.includes('display_name'), false);
  assert.ok(KOSX_POOL_HANDLES.length >= 100);
  assert.equal(isKosxPoolHandle(poolHandle.toUpperCase()), true);
  assert.equal(isKosxPoolHandle('example'), false);
  assert.equal(isKosxPoolHandle(''), false);
  const rendered = renderPoolModule(handlesFromRoster({members:[
    {handle:'AbC_1', display_name:'某人', latest_followers:863701},
    {handle:'second'},
  ]}), '2026-10-14T00:00:00.000Z');
  assert.equal(rendered.includes('863701'), false);
  assert.equal(rendered.includes('latest_followers'), false);
  assert.equal(rendered.includes('display_name'), false);
  assert.match(rendered, /'abc_1'/);
  assert.throws(() => handlesFromRoster({members:[{handle:'has space'}]}), /handle/);
});

test('pool cover order is chronological and pool posts never enter the underrated shelf', () => {
  const older = kosxPublicItem({id:'kosx-1', key:'x:1', url:'https://x.com/aaa/status/1', author_handle:'aaa', note:'', status:'approved', reviewed_at:'2026-10-13T01:00:00.000Z', approval:'pool', source:'delivery', submitted_at:when});
  const newer = kosxPublicItem({id:'kosx-2', key:'x:2', url:'https://x.com/bbb/status/2', author_handle:'bbb', note:'', status:'approved', reviewed_at:'2026-10-14T01:00:00.000Z', approval:'pool', source:'delivery', submitted_at:when});
  older.latest_followers = 900000;
  newer.latest_followers = 10;
  const state = {sources:[kosxPublicSource()], allItems:[older, newer], generated_at:'2026-10-14T12:00:00.000Z', profile:{}};
  const home = selectHomeShowcase(state);
  assert.deepEqual(home.latest.map(entry => entry.post.item.id), ['kosx-2', 'kosx-1']);
  assert.equal(home.yesterday.some(entry => entry.post.item.id === 'kosx-1'), true);
  assert.equal(home.underrated.some(entry => entry.post.item.id === 'kosx-1'), false);
  assert.equal(wouldEnterUnderrated(state, 'kosx-1'), false);
  assert.match(home.underratedNote, /昨日最被低估必须人工过审/);
  const humanOlder = kosxPublicItem({id:'kosx-1', key:'x:1', url:'https://x.com/aaa/status/1', author_handle:'aaa', note:'', status:'approved', reviewed_at:'2026-10-13T01:00:00.000Z', approval:'review', source:'delivery', submitted_at:when});
  const humanState = {...state, allItems:[humanOlder, newer]};
  const reviewed = selectHomeShowcase(humanState);
  assert.equal(humanOlder.kosx_review, undefined);
  assert.equal(reviewed.yesterday.some(entry => entry.post.item.id === 'kosx-1'), true);
  assert.equal(reviewed.underrated.some(entry => entry.post.item.id === 'kosx-1'), false);
  assert.equal(reviewed.underratedRule, 'empty');
  assert.equal(wouldEnterUnderrated(humanState, 'kosx-1'), true);
});

test('a pool delivery publishes onto the homepage and a repeat keeps the same time', async () => {
  const env = await environment();
  const created = await submit(env, {url:`https://twitter.com/${poolHandle.toUpperCase()}/status/2108148604447883555`, note:'池内这条'}, {token:delivery});
  const body = await created.json();
  assert.equal(created.status, 201);
  assert.equal(body.status, 'approved');
  assert.equal(body.published, true);
  assert.equal(body.pool, true);
  assert.equal(body.approval, 'pool');
  assert.equal(body.existing, false);
  assert.equal(body.author_handle.toLowerCase(), poolHandle);
  const feed = env.PUBLIC_FEED.json();
  assert.equal(validCachedFeed(feed), true);
  const item = feed.items.find(entry => entry.original_url.toLowerCase() === poolUrl);
  assert.equal(item.kosx_review, 'pool');
  assert.equal(item.published_at, snowflakeAt);
  assert.notEqual(item.published_at, body.reviewed_at);
  assert.equal(item.source_item_time, body.reviewed_at);
  assert.equal(item.captured_at, body.reviewed_at);
  assert.equal(Object.hasOwn(item, 'latest_followers'), false);
  assert.equal(feed.sources.find(source => source.id === 'sopilot-kosx').ranked, false);
  assert.equal(showcase(feed).latest.some(entry => entry.post.originalUrl.toLowerCase() === poolUrl), true);
  const again = await (await submit(env, {url:poolUrl}, {token:delivery})).json();
  assert.equal(again.existing, true);
  assert.equal(again.status, 'approved');
  assert.equal(again.reviewed_at, body.reviewed_at);
  assert.equal(env.PUBLIC_FEED.json().items.find(entry => entry.original_url.toLowerCase() === poolUrl).published_at, snowflakeAt);
});

test('homepage paste and outsiders stay pending, and a rejected pool post stays rejected', async () => {
  const env = await environment();
  const pasted = await submit(env, {url:`https://x.com/${poolHandle}/status/2108148604447883777`});
  const pasteBody = await pasted.json();
  assert.equal(pasted.status, 201);
  assert.equal(pasteBody.status, 'pending');
  assert.equal(Object.hasOwn(pasteBody, 'pool'), false);
  assert.equal(Object.hasOwn(pasteBody, 'published'), false);
  assert.equal(JSON.stringify(pasteBody).includes('公开'), false);
  const pastedAgain = await (await submit(env, {url:`https://x.com/${poolHandle}/status/2108148604447883777`, note:'不要自动过审'}, {token:delivery})).json();
  assert.equal(pastedAgain.status, 'pending');
  assert.equal(pastedAgain.existing, true);
  assert.equal(pastedAgain.published, false);
  assert.equal(pastedAgain.source, 'homepage');
  const outsider = await submit(env, {url:outsiderUrl, note:'圈外'}, {token:delivery});
  const outside = await outsider.json();
  assert.equal(outsider.status, 201);
  assert.equal(outside.status, 'pending');
  assert.equal(outside.pool, false);
  assert.equal(outside.published, false);
  assert.equal(env.PUBLIC_FEED.json().items.some(item => item.original_url === outsiderUrl || item.author_handle === poolHandle && item.original_url.endsWith('2108148604447883777')), false);
  await submit(env, {url:poolUrl}, {token:delivery});
  assert.equal((await decide(env, {url:poolUrl, status:'rejected'})).status, 200);
  const retry = await (await submit(env, {url:poolUrl}, {token:delivery})).json();
  assert.equal(retry.status, 'rejected');
  assert.equal(retry.existing, true);
  assert.equal(retry.published, false);
  assert.equal(env.PUBLIC_FEED.json().items.some(item => item.original_url === poolUrl), false);
});

test('a post that would enter yesterday underrated stays pending until the review code', async () => {
  const feed = baseFeed();
  // Snapshot day is the Beijing day after the status snowflake, while the
  // review clock is "now". Only the snowflake puts this post on yesterday.
  feed.generated_at = '2026-10-09T04:00:00.000Z';
  const env = await environment(feed);
  const held = await submit(env, {url:poolUrl, note:'昨天这条'}, {token:delivery});
  const body = await held.json();
  assert.equal(held.status, 201);
  assert.equal(body.status, 'pending');
  assert.equal(body.published, false);
  assert.equal(body.pool, true);
  assert.match(body.message, /昨日最被低估/);
  assert.match(body.message, /人工过审/);
  assert.equal(env.PUBLIC_FEED.writes.length, 0);
  assert.equal(env.PUBLIC_FEED.json().items.some(item => item.original_url === poolUrl), false);
  const approved = await decide(env, {url:poolUrl, status:'approved'});
  const decision = await approved.json();
  assert.equal(approved.status, 200);
  assert.equal(decision.approval, 'review');
  assert.equal(decision.published, true);
  const published = env.PUBLIC_FEED.json();
  const item = published.items.find(entry => entry.original_url === poolUrl);
  assert.equal(item.kosx_review, undefined);
  assert.equal(item.published_at, snowflakeAt);
  assert.equal(item.source_item_time, decision.reviewed_at);
  assert.equal(beijingDateKey(Date.parse(item.published_at)), '2026-10-08');
  assert.equal(showcase(published).yesterday.some(entry => entry.post.originalUrl === poolUrl), true);
  assert.equal(showcase(published).underrated.some(entry => entry.post.originalUrl === poolUrl), false);
});

test('pool auto-publish stays off the underrated shelf until a review code marks it reviewed', async () => {
  const env = await environment();
  const created = await (await submit(env, {url:poolUrl}, {token:delivery})).json();
  assert.equal(created.approval, 'pool');
  const shifted = env.PUBLIC_FEED.json();
  const posted = shifted.items.find(entry => entry.original_url === poolUrl);
  shifted.generated_at = nextBeijingInstant(Date.parse(posted.published_at));
  const blocked = showcase(shifted);
  assert.equal(blocked.yesterday.some(entry => entry.post.originalUrl === poolUrl), true);
  assert.equal(blocked.underrated.some(entry => entry.post.originalUrl === poolUrl), false);
  const reviewed = await (await decide(env, {url:poolUrl, status:'approved'})).json();
  assert.equal(reviewed.existing, true);
  assert.equal(reviewed.approval, 'review');
  assert.equal(reviewed.reviewed_at, created.reviewed_at);
  const after = env.PUBLIC_FEED.json();
  after.generated_at = shifted.generated_at;
  assert.equal(after.items.find(item => item.original_url === poolUrl).kosx_review, undefined);
  assert.equal(showcase(after).yesterday.some(entry => entry.post.originalUrl === poolUrl), true);
  assert.equal(showcase(after).underrated.some(entry => entry.post.originalUrl === poolUrl), false);
  assert.equal(wouldEnterUnderrated({sources:after.sources, allItems:after.items, profile:after.profile, generated_at:after.generated_at}, after.items.find(item => item.original_url === poolUrl).id), true);
});

test('a mixed delivery publishes only pool handles and does not rank them', async () => {
  const env = await environment();
  const batch = await submit(env, {items:[{url:poolUrl}, {url:outsiderUrl}, {url:secondPoolUrl}]}, {token:delivery});
  const page = await batch.json();
  assert.equal(batch.status, 201);
  assert.equal(page.status, 'partial');
  assert.deepEqual(page.results.map(row => [row.author_handle, row.status, row.published]), [
    [poolHandle, 'approved', true],
    ['example', 'pending', false],
    [otherPoolHandle, 'approved', true],
  ]);
  const feed = env.PUBLIC_FEED.json();
  assert.equal(feed.items.some(item => item.original_url === outsiderUrl), false);
  const home = showcase(feed);
  const ids = home.latest.map(entry => entry.post.item.id);
  const first = feed.items.find(item => item.original_url === poolUrl);
  const second = feed.items.find(item => item.original_url === secondPoolUrl);
  assert.ok(ids.indexOf(first.id) >= 0 && ids.indexOf(second.id) >= 0);
  assert.equal(first.published_at, second.published_at);
  assert.equal(first.published_at, snowflakeAt);
  assert.equal(feed.items.filter(item => item.kosx_review === 'pool').length, 2);
});

test('original post time prefers intake published_at, then created_at, then the X snowflake', () => {
  const reviewed_at = '2026-10-14T01:00:00.000Z';
  const base = {id:`kosx-${poolStatusId}`, key:`x:${poolStatusId}`, url:poolUrl, author_handle:'aaa', note:'', status:'approved', reviewed_at, source:'delivery', submitted_at:when};
  const fromSnowflake = kosxPublicItem(base);
  assert.equal(originalPostInstant(base), snowflakeAt);
  assert.equal(fromSnowflake.published_at, snowflakeAt);
  assert.equal(fromSnowflake.source_item_time, reviewed_at);
  assert.equal(fromSnowflake.captured_at, reviewed_at);
  const intake = '2026-10-13T03:00:00.000Z';
  const created = '2026-10-12T03:00:00.000Z';
  const preferred = kosxPublicItem({...base, published_at:intake, created_at:created});
  assert.equal(preferred.published_at, intake);
  assert.equal(preferred.source_item_time, reviewed_at);
  const fromCreated = kosxPublicItem({...base, created_at:created});
  assert.equal(fromCreated.published_at, created);
  assert.equal(originalPostInstant({url:'https://github.com/example/tool', published_at:'', created_at:null}), '');
  assert.equal(originalPostInstant({key:'x:1', url:'https://x.com/aaa/status/1'}), '');
  const short = kosxPublicItem({...base, id:'kosx-1', key:'x:1', url:'https://x.com/aaa/status/1'});
  assert.equal(short.published_at, reviewed_at);
  assert.notEqual(short.published_at, '2010-11-04T01:42:54.657Z');
});

test('re-delivery with published_at overwrites PUBLIC_FEED and the pin day follows it', async () => {
  const feed = baseFeed();
  feed.generated_at = '2026-10-14T04:00:00.000Z';
  const env = await environment(feed);
  await submit(env, {url:outsiderUrl, note:'圈外'}, {token:delivery});
  const approved = await (await decide(env, {url:outsiderUrl, status:'approved'})).json();
  const before = env.PUBLIC_FEED.json().items.find(entry => entry.original_url === outsiderUrl);
  assert.equal(before.published_at, snowflakeAt);
  assert.equal(before.source_item_time, approved.reviewed_at);
  assert.equal(before.captured_at, approved.reviewed_at);
  const early = await handleDotUnderratedRequest(new Request(`${base}${DOT_UNDERRATED_PATH}`, {
    method:'POST',
    headers:{Authorization:`Bearer ${review}`, 'Content-Type':'application/json'},
    body:JSON.stringify({url:outsiderUrl}),
  }), env);
  assert.equal(early.status, 409);
  assert.equal((await early.json()).error, 'not_yesterday');
  const intake = '2026-10-13T03:00:00.000Z';
  const createdAt = '2026-10-12T03:00:00.000Z';
  const again = await submit(env, {url:outsiderUrl, published_at:intake, created_at:createdAt}, {token:delivery});
  const body = await again.json();
  assert.equal(again.status, 200);
  assert.equal(body.existing, true);
  assert.equal(body.reviewed_at, approved.reviewed_at);
  assert.equal(body.published_at, intake);
  assert.equal(body.created_at, createdAt);
  const stored = JSON.parse(env.DOT_INBOX.values.get(`pending:${body.key}`).raw);
  assert.equal(stored.published_at, intake);
  assert.equal(stored.created_at, createdAt);
  assert.equal(stored.reviewed_at, approved.reviewed_at);
  const after = env.PUBLIC_FEED.json().items.find(entry => entry.original_url === outsiderUrl);
  assert.equal(after.published_at, intake);
  assert.equal(after.source_item_time, approved.reviewed_at);
  assert.equal(after.captured_at, approved.reviewed_at);
  const rebuilt = await (await decide(env, {url:outsiderUrl, status:'approved', review_type:'教程指南'})).json();
  assert.equal(rebuilt.existing, true);
  assert.equal(rebuilt.reviewed_at, approved.reviewed_at);
  assert.equal(rebuilt.published_at, intake);
  const republished = env.PUBLIC_FEED.json().items.find(entry => entry.original_url === outsiderUrl);
  assert.equal(republished.published_at, intake);
  assert.equal(republished.review_type, '教程指南');
  assert.equal(republished.source_item_time, approved.reviewed_at);
  const pinned = await handleDotUnderratedRequest(new Request(`${base}${DOT_UNDERRATED_PATH}`, {
    method:'POST',
    headers:{Authorization:`Bearer ${review}`, 'Content-Type':'application/json'},
    body:JSON.stringify({url:outsiderUrl, note:'Levi 已看过'}),
  }), env);
  const pin = await pinned.json();
  assert.equal(pinned.status, 201);
  assert.equal(pin.day, '2026-10-13');
  assert.equal(pin.status, 'pinned');
});
