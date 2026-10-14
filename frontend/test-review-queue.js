import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { dotInboxHash } from '../dot-inbox-service.js';
import { DOT_PENDING_DECISION_PATH, DOT_PENDING_PATH, DOT_PENDING_PREFIX, handleDotPendingRequest } from '../dot-pending-service.js';
import { UNDERRATED_PIN_KEY, handleDotUnderratedRequest, overlayPublicUnderratedPins } from '../dot-underrated-service.js';
import { PUBLIC_FEED_KEY } from './cloud-feed-service.js';
import { makePublicFeed } from './public-feed-data.js';
import { normalizeRepositories } from './repository-normalize.js';
import { HOME_WEEK_BOOKMARK_MIN, beijingDateKey, selectHomeShowcase } from './src/homeShowcase.js';
import { KOSX_POOL_HANDLES } from './kosx-pool.js';
import { kosxPublicItem } from './kosx-public-posts.js';
import { DotInboxClient } from './src/dotInboxClient.js';
import { classifyReviewItem, presentReviewItem, sortReviewQueue } from './src/reviewQueue.js';
import { renderReviewQueue, bindReviewQueueEvents } from './src/reviewQueueView.js';
import { renderDotCandidatesView } from './src/dotCandidatesView.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const delivery = 'test-delivery-credential-1234567890';
const review = 'test-review-credential-0987654321';
const base = 'https://feed.example.test';
const statusId = '2108148604447883999';
const postUrl = `https://x.com/example/status/${statusId}`;
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

const environment = async () => ({
  DOT_INBOX:new FakeKV(),
  PUBLIC_FEED:new FeedKV(makePublicFeed({
    schema_version:'0.3', mode:'live',
    sources:[{id:'github', status:'ok', last_success_at:when}],
    items:normalizeRepositories([{
      id:123, full_name:'example/utility', description:'Public workflow utility', stargazers_count:500,
      pushed_at:'2026-09-30T01:00:00Z', created_at:'2026-09-01T01:00:00Z', archived:false, fork:false,
    }], when, 'old-repository-evidence'),
  }, {publishedAt:when})),
  DOT_DELIVERY_TOKEN_HASH:await dotInboxHash(delivery),
  DOT_REVIEW_TOKEN_HASH:await dotInboxHash(review),
});

function request(method, {token = null, path = DOT_PENDING_PATH, body} = {}) {
  return new Request(`${base}${path}`, {
    method,
    headers:{...(token === null ? {} : {Authorization:`Bearer ${token}`}), ...(body !== undefined ? {'Content-Type':'application/json'} : {})},
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
  });
}

const submit = (env, body, token = delivery) => handleDotPendingRequest(request('POST', {body, token}), env);
const decide = (env, body) => handleDotPendingRequest(request('POST', {path:DOT_PENDING_DECISION_PATH, token:review, body}), env);
const stored = env => [...env.DOT_INBOX.values.values()].map(entry => JSON.parse(entry.raw));
const showcase = feed => selectHomeShowcase({sources:feed.sources, allItems:feed.items, items:feed.items, profile:feed.profile || {}, generated_at:feed.generated_at});

test('classification prefers an article card, then tutorials, pitfalls, and short or promo posts', () => {
  assert.equal(classifyReviewItem({has_article:true, text:'短'}).review_type, '文章');
  assert.equal(classifyReviewItem({text:'第一步：安装模板，再看架构。'}).review_type, '教程指南');
  assert.equal(classifyReviewItem({text:'这是避坑：别再这样配置。'}).review_type, '避坑');
  assert.equal(classifyReviewItem({text:'安利这个产品，限时优惠'}).review_type, '产品安利');
  assert.equal(classifyReviewItem({text:'绝了'}).review_type, '短帖');
  assert.equal(classifyReviewItem({text:'震惊！崩了'}).skip_cue, true);
  assert.equal(classifyReviewItem({text:'x'.repeat(140)}).review_type, '文章');
  assert.equal(classifyReviewItem({review_type:'避坑', text:'第一步：安装模板'}).review_type, '避坑');
  assert.equal(classifyReviewItem({review_type:'避坑', text:'第一步：安装模板'}).type_source, 'given');
  assert.equal(classifyReviewItem({note:'类型：教程指南', text:'随便写'}).review_type, '教程指南');
  assert.equal(classifyReviewItem({note:'教程指南'}).type_source, 'note');
  const slogan = classifyReviewItem({text:'绝了', bookmark_count:10, like_count:4});
  assert.equal(slogan.review_type, '短帖');
  assert.equal(slogan.bookmark_signal, true);
  assert.equal(classifyReviewItem({bookmark_count:5, like_count:10}).bookmark_signal, true);
  assert.equal(classifyReviewItem({bookmark_count:4, like_count:10}).bookmark_signal, false);
  assert.equal(classifyReviewItem({bookmark_count:0, like_count:0}).bookmark_signal, false);
  assert.equal(presentReviewItem({note:'如何写一份清单'}).review_type, '教程指南');
  assert.equal(presentReviewItem({}).article_known, false);
  const ordered = sortReviewQueue([
    {status:'pending', review_type:'产品安利', submitted_at:'2026-10-14T00:00:04.000Z'},
    {status:'pending', has_article:true, text:'卡', submitted_at:'2026-10-14T00:00:01.000Z'},
    {status:'pending', text:'步骤和模板', submitted_at:'2026-10-14T00:00:02.000Z'},
    {status:'pending', text:'避坑拆解', submitted_at:'2026-10-14T00:00:03.000Z'},
    {status:'pending', text:'一句口号', bookmark_count:3, like_count:1, submitted_at:'2026-10-14T00:00:05.000Z'},
  ]).map(item => item.review_type);
  assert.deepEqual(ordered, ['文章', '教程指南', '避坑', '短帖', '产品安利']);
});

test('delivery can store type, counts and an article flag; a homepage paste cannot send them', async () => {
  const env = await environment();
  const text = '第一步：按模板搭好架构，再核对配置。';
  const created = await submit(env, {url:postUrl, note:'类型先看教程', review_type:'教程指南', bookmark_count:12, like_count:30, has_article:true, text});
  const body = await created.json();
  assert.equal(created.status, 201);
  assert.equal(body.review_type, '教程指南');
  assert.equal(body.bookmark_count, 12);
  assert.equal(body.like_count, 30);
  assert.equal(body.has_article, true);
  assert.equal(body.text, text);
  assert.equal(body.underrated_candidate, undefined);
  const quiet = await submit(env, {url:'https://x.com/example/status/2108148604447884008', review_type:'文章'}, null);
  assert.equal(quiet.status, 401);
  assert.equal(env.DOT_INBOX.writes.length, 1);
  const listed = await (await handleDotPendingRequest(request('GET', {token:review}), env)).json();
  assert.equal(listed.items[0].review_type, '教程指南');
  assert.equal(listed.items[0].bookmark_count, 12);
  assert.equal(listed.items[0].has_article, true);
});

test('missing type is classified from the note or text, and a later duplicate does not overwrite it', async () => {
  const env = await environment();
  const created = await submit(env, {url:postUrl, text:'避坑：别再把密钥写进仓库。', bookmark_count:8, like_count:8});
  assert.equal((await created.json()).review_type, '避坑');
  const again = await submit(env, {url:postUrl, review_type:'短帖', bookmark_count:1, like_count:99, text:'安利'});
  const duplicate = await again.json();
  assert.equal(again.status, 200);
  assert.equal(duplicate.existing, true);
  assert.equal(duplicate.review_type, '避坑');
  assert.equal(duplicate.bookmark_count, 8);
  const fromNote = await submit(env, {url:'https://x.com/example/status/2108148604447884011', note:'类型：文章'});
  assert.equal((await fromNote.json()).review_type, '文章');
});

test('approval can record an underrated candidate without pinning, and omitting it leaves that path empty', async () => {
  const env = await environment();
  const before = showcase(env.PUBLIC_FEED.json());
  await submit(env, {url:postUrl, note:'一篇教程', review_type:'教程指南', bookmark_count:9, like_count:4, has_article:false});
  const plain = await decide(env, {url:postUrl, status:'approved'});
  const plainBody = await plain.json();
  assert.equal(plain.status, 200);
  assert.equal(plainBody.published, true);
  assert.equal(plainBody.underrated_candidate, undefined);
  assert.equal(stored(env).some(row => row.underrated_candidate), false);
  assert.equal(env.DOT_INBOX.writes.some(entry => entry.key === UNDERRATED_PIN_KEY), false);
  const pins = await handleDotUnderratedRequest(request('GET', {token:review, path:'/api/dot/underrated'}), env);
  assert.deepEqual((await pins.json()).items, []);
  const feed = env.PUBLIC_FEED.json();
  assert.equal(JSON.stringify(feed).includes('underrated_candidate'), false);
  assert.equal(feed.items.find(item => item.original_url === postUrl).origin, 'kosx_approved');
  const after = showcase(feed);
  assert.deepEqual(after.underrated.map(entry => entry.post.item.id), before.underrated.map(entry => entry.post.item.id));
  assert.notEqual(after.underratedRule, 'pinned');
  assert.equal(await overlayPublicUnderratedPins(env.PUBLIC_FEED.raw, env), env.PUBLIC_FEED.raw);

  const second = 'https://x.com/example/status/2108148604447884012';
  await submit(env, {url:second, has_article:true, bookmark_count:20, like_count:10, text:'长文'});
  const marked = await decide(env, {url:second, status:'approved', underrated_candidate:true, review_type:'文章'});
  const markedBody = await marked.json();
  assert.equal(markedBody.underrated_candidate, true);
  assert.equal(typeof markedBody.underrated_candidate_at, 'string');
  assert.equal(markedBody.review_type, '文章');
  assert.equal(markedBody.published, true);
  const row = stored(env).find(item => item.url === second);
  assert.equal(row.underrated_candidate, true);
  assert.equal(env.DOT_INBOX.values.has(UNDERRATED_PIN_KEY), false);
  const still = await handleDotUnderratedRequest(request('GET', {token:review, path:'/api/dot/underrated'}), env);
  assert.deepEqual((await still.json()).items, []);
  const published = env.PUBLIC_FEED.json();
  assert.equal(JSON.stringify(published).includes('underrated_candidate'), false);
  assert.equal(showcase(published).underratedRule === 'pinned', false);
  assert.deepEqual(showcase(published).underrated.map(entry => entry.post.item.id), before.underrated.map(entry => entry.post.item.id));
  const repeat = await (await decide(env, {url:second, status:'approved'})).json();
  assert.equal(repeat.existing, true);
  assert.equal(repeat.underrated_candidate, true);
  assert.equal(repeat.underrated_candidate_at, markedBody.underrated_candidate_at);
});

test('a candidate flag cannot be set while rejecting, and bad signals are refused before storage', async () => {
  const env = await environment();
  await submit(env, {url:postUrl});
  const rejected = await decide(env, {url:postUrl, status:'rejected', underrated_candidate:true});
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error, 'invalid_candidate');
  assert.equal(stored(env)[0].status, 'pending');
  assert.equal(env.DOT_INBOX.values.has(UNDERRATED_PIN_KEY), false);
  for (const [body, code] of [
    [{url:postUrl, review_type:'长文'}, 'invalid_type'],
    [{url:'https://x.com/example/status/2108148604447884013', bookmark_count:-1}, 'invalid_metrics'],
    [{url:'https://x.com/example/status/2108148604447884014', has_article:'yes'}, 'invalid_article'],
    [{url:'https://x.com/example/status/2108148604447884015', underrated_candidate:true}, 'invalid_body'],
  ]) {
    const response = await submit(env, body);
    assert.equal(response.status, 400, code);
    assert.equal((await response.json()).error, code);
  }
  assert.equal(env.DOT_INBOX.writes.filter(entry => entry.key.startsWith(DOT_PENDING_PREFIX)).length, 1);
  assert.equal(env.PUBLIC_FEED.writes.length, 0);
});

test('the review queue shows type, heat and the article card, and the candidate box starts unchecked', () => {
  assert.doesNotMatch(renderDotCandidatesView(), /进低估栏候选/);
  const html = renderReviewQueue({connected:true, items:[
    {id:'kosx-1', key:'x:1', url:postUrl, author_handle:'example', status:'pending', note:'步骤模板', submitted_at:'2026-10-14T00:00:00.000Z', bookmark_count:12, like_count:4, has_article:true},
    {id:'kosx-2', key:'x:2', url:'https://x.com/example/status/2108148604447884002', status:'approved', review_type:'短帖'},
    {id:'kosx-3', key:'x:3', url:'https://x.com/example/status/2108148604447884003', author_handle:'example', status:'pending', text:'安利一下，限时优惠', submitted_at:'2026-10-14T00:00:01.000Z'},
  ]});
  assert.match(html, /data-review-type="教程指南"/);
  assert.match(html, /有 X Article 卡/);
  assert.match(html, /收藏 12/);
  assert.match(html, /点赞 4/);
  assert.match(html, /收藏\/点赞 3\.00/);
  assert.match(html, /收藏信号强/);
  assert.match(html, /产品安利/);
  assert.match(html, /进低估栏候选/);
  assert.doesNotMatch(html, /data-review-underrated[^>]*checked/);
  assert.deepEqual([...html.matchAll(/data-review-type="([^"]+)"/g)].map(match => match[1]), ['教程指南', '产品安利']);
  assert.doesNotMatch(html, /data-review-url="https:\/\/x.com\/example\/status\/2108148604447884002"/);
  const disconnected = renderReviewQueue({connected:false, items:[{status:'pending', url:postUrl}]});
  assert.match(disconnected, /连接接收码后/);
  assert.doesNotMatch(disconnected, /进低估栏候选|过审上首页/);
});

test('approve sends the candidate flag only when the box is checked', () => {
  const calls = [];
  const box = {checked:false, disabled:false};
  const select = {value:'避坑', disabled:false};
  const button = {
    disabled:false, dataset:{reviewDecision:'approved'},
    closest() { return article; },
    addEventListener(type, handler) { this.listeners[type] = handler; },
    listeners:{},
  };
  const article = {
    dataset:{reviewUrl:postUrl},
    getAttribute(name) { return name === 'data-review-url' ? postUrl : ''; },
    querySelector(selector) { return selector === '[data-review-type-select]' ? select : selector === '[data-review-underrated]' ? box : null; },
  };
  const root = {querySelectorAll(selector) { return selector === '[data-review-decision]' ? [button] : []; }};
  bindReviewQueueEvents(root, {onReviewDecision:payload => calls.push(payload)});
  button.listeners.click();
  box.checked = true;
  button.listeners.click();
  assert.deepEqual(calls, [
    {url:postUrl, status:'approved', underrated_candidate:false, review_type:'避坑'},
    {url:postUrl, status:'approved', underrated_candidate:true, review_type:'避坑'},
  ]);
});

test('the review client reads and decides with the stored code without putting that code in the url', async () => {
  const code = 'a'.repeat(40);
  const storage = new Map([['personal-feed:dot-inbox:v1', JSON.stringify({version:1, review_code:code, seen_batch_ids:[], last_synced_at:null, scan_cursor:null})]]);
  const calls = [];
  const client = new DotInboxClient({
    storage:{getItem:key => storage.get(key) || null, setItem:(key, value) => storage.set(key, value), removeItem:key => storage.delete(key)},
    fetcher:async (path, options) => {
      calls.push({path, authorization:options.headers.Authorization, method:options.method, body:options.body});
      assert.equal(path.includes(code), false);
      assert.equal(options.headers.Authorization, `Bearer ${code}`);
      if (options.method === 'POST') {
        return new Response(JSON.stringify({url:postUrl, status:'approved', underrated_candidate:true, published:true}), {status:200, headers:{'Content-Type':'application/json'}});
      }
      return new Response(JSON.stringify({items:[{id:'kosx-1', url:postUrl, status:'pending', review_type:'文章'}], next_cursor:null}), {status:200, headers:{'Content-Type':'application/json'}});
    },
  });
  const items = await client.listPendingQueue();
  assert.equal(items[0].review_type, '文章');
  const decision = await client.decidePending({url:postUrl, status:'approved', underrated_candidate:true, review_type:'文章'});
  assert.equal(decision.underrated_candidate, true);
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].path, DOT_PENDING_DECISION_PATH);
  assert.deepEqual(JSON.parse(calls[1].body), {url:postUrl, status:'approved', underrated_candidate:true, review_type:'文章'});
  assert.equal(JSON.stringify(client.getState()).includes(code), false);
  assert.equal(calls.some(entry => entry.path === '/api/dot/underrated'), false);
});

test('approved public items keep intake signals and the original post time for the week shelf', async () => {
  const direct = kosxPublicItem({
    id:'kosx-1', status:'approved', reviewed_at:'2026-10-14T01:00:00.000Z', author_handle:'example',
    url:'https://x.com/example/status/1', note:'',
    published_at:'2026-10-08T04:00:00.000Z', created_at:'2026-10-01T00:00:00.000Z',
    bookmark_count:HOME_WEEK_BOOKMARK_MIN, like_count:1, has_article:false, review_type:'文章',
  });
  assert.equal(direct.published_at, '2026-10-08T04:00:00.000Z');
  assert.equal(direct.bookmark_count, HOME_WEEK_BOOKMARK_MIN);
  const fromCreated = kosxPublicItem({
    id:'kosx-2', status:'approved', reviewed_at:'2026-10-14T01:00:00.000Z', author_handle:'example',
    url:'https://x.com/example/status/2', note:'', created_at:'2026-10-07T08:00:00.000Z', bookmark_count:0,
  });
  assert.equal(fromCreated.published_at, '2026-10-07T08:00:00.000Z');
  assert.equal(fromCreated.bookmark_count, 0);
  assert.equal(Object.hasOwn(fromCreated, 'like_count'), false);
  const fallback = kosxPublicItem({
    id:'kosx-3', status:'approved', reviewed_at:'2026-10-14T01:00:00.000Z', author_handle:'example',
    url:'https://x.com/example/status/2108148604447884104', note:'',
    bookmark_count:'200', review_type:'不是类型', has_article:'yes',
  });
  const snowflake = new Date(Number((BigInt('2108148604447884104') >> 22n) + 1288834974657n)).toISOString();
  assert.equal(fallback.published_at, snowflake);
  assert.equal(fallback.source_item_time, '2026-10-14T01:00:00.000Z');
  assert.equal(fallback.captured_at, '2026-10-14T01:00:00.000Z');
  assert.equal(Object.hasOwn(fallback, 'bookmark_count'), false);
  assert.equal(Object.hasOwn(fallback, 'review_type'), false);
  assert.equal(Object.hasOwn(fallback, 'has_article'), false);

  const env = await environment();
  const posted = '2026-10-08T04:00:00.000Z';
  const highUrl = 'https://x.com/example/status/2108148604447884101';
  const floorUrl = 'https://x.com/example/status/2108148604447884102';
  const lowUrl = 'https://x.com/example/status/2108148604447884103';
  const bareUrl = 'https://x.com/example/status/2108148604447884104';
  const poolHandle = KOSX_POOL_HANDLES[0];
  const poolPost = `https://x.com/${poolHandle}/status/2108148604447884105`;
  const yesterdayPool = `https://x.com/${poolHandle}/status/2108148604447884106`;

  assert.equal((await submit(env, {url:highUrl, review_type:'文章', bookmark_count:250, like_count:0, has_article:true, published_at:posted, created_at:'2026-10-01T00:00:00.000Z'})).status, 201);
  const highDecision = await (await decide(env, {url:highUrl, status:'approved'})).json();
  const high = env.PUBLIC_FEED.json().items.find(item => item.original_url === highUrl);
  assert.equal(high.origin, 'kosx_approved');
  assert.equal(high.published_at, posted);
  assert.notEqual(high.published_at, highDecision.reviewed_at);
  assert.equal(high.source_item_time, highDecision.reviewed_at);
  assert.equal(high.bookmark_count, 250);
  assert.equal(high.like_count, 0);
  assert.equal(high.has_article, true);
  assert.equal(high.review_type, '文章');

  await submit(env, {url:floorUrl, bookmark_count:HOME_WEEK_BOOKMARK_MIN, like_count:4, has_article:true, created_at:'2026-10-07T16:00:00+08:00'});
  await decide(env, {url:floorUrl, status:'approved'});
  const floor = env.PUBLIC_FEED.json().items.find(item => item.original_url === floorUrl);
  assert.equal(floor.published_at, '2026-10-07T08:00:00.000Z');
  assert.equal(floor.bookmark_count, HOME_WEEK_BOOKMARK_MIN);
  assert.equal(floor.like_count, 4);
  assert.equal(floor.has_article, true);
  assert.equal(floor.review_type, '文章');

  await submit(env, {url:lowUrl, review_type:'教程指南', bookmark_count:HOME_WEEK_BOOKMARK_MIN - 1, like_count:9, has_article:false, published_at:posted});
  await decide(env, {url:lowUrl, status:'approved'});
  const low = env.PUBLIC_FEED.json().items.find(item => item.original_url === lowUrl);
  assert.equal(low.bookmark_count, HOME_WEEK_BOOKMARK_MIN - 1);
  assert.equal(low.has_article, false);
  assert.equal(low.review_type, '教程指南');

  await submit(env, {url:bareUrl, review_type:'文章', bookmark_count:900, has_article:false});
  const bareDecision = await (await decide(env, {url:bareUrl, status:'approved'})).json();
  const bare = env.PUBLIC_FEED.json().items.find(item => item.original_url === bareUrl);
  const bareSnowflake = new Date(Number((BigInt('2108148604447884104') >> 22n) + 1288834974657n)).toISOString();
  assert.equal(bare.published_at, bareSnowflake);
  assert.equal(bare.source_item_time, bareDecision.reviewed_at);
  assert.notEqual(bare.published_at, bareDecision.reviewed_at);
  assert.equal(bare.bookmark_count, 900);
  assert.equal(bare.has_article, false);
  assert.equal(Object.hasOwn(bare, 'like_count'), false);

  const pooled = await (await submit(env, {url:poolPost, review_type:'教程指南', bookmark_count:320, like_count:11, has_article:false, published_at:posted})).json();
  assert.equal(pooled.status, 'approved');
  assert.equal(pooled.approval, 'pool');
  assert.equal(pooled.published, true);
  const poolItem = env.PUBLIC_FEED.json().items.find(item => item.original_url === poolPost);
  assert.equal(poolItem.kosx_review, 'pool');
  assert.equal(poolItem.published_at, posted);
  assert.notEqual(poolItem.published_at, pooled.reviewed_at);
  assert.equal(poolItem.bookmark_count, 320);
  assert.equal(poolItem.like_count, 11);
  assert.equal(poolItem.review_type, '教程指南');
  assert.equal(poolItem.has_article, false);

  const held = await (await submit(env, {url:yesterdayPool, review_type:'文章', bookmark_count:500, has_article:true, published_at:'2026-10-09T02:00:00.000Z'})).json();
  assert.equal(held.status, 'pending');
  assert.equal(held.published, false);
  assert.match(held.message, /昨日最被低估/);
  assert.equal(env.PUBLIC_FEED.json().items.some(item => item.original_url === yesterdayPool), false);

  const home = showcase(env.PUBLIC_FEED.json());
  const kept = [
    {id:'kosx-2108148604447884105', bookmarks:320},
    {id:'kosx-2108148604447884101', bookmarks:250},
    {id:'kosx-2108148604447884102', bookmarks:HOME_WEEK_BOOKMARK_MIN},
  ];
  if (home.reference.weekKeys.includes(beijingDateKey(Date.parse(bare.published_at)))) kept.push({id:bare.id, bookmarks:900});
  kept.sort((left, right) => right.bookmarks - left.bookmarks);
  assert.equal(home.weekRule, 'bookmarks');
  assert.deepEqual(home.week.map(entry => entry.post.item.id), kept.map(entry => entry.id));
  assert.equal(home.week.some(entry => entry.post.item.bookmark_count < HOME_WEEK_BOOKMARK_MIN), false);
  assert.equal(home.week.some(entry => entry.post.originalUrl === lowUrl), false);

  const corrected = '2026-10-01T00:00:00.000Z';
  const again = await (await submit(env, {url:highUrl, published_at:corrected, bookmark_count:1, like_count:99})).json();
  assert.equal(again.existing, true);
  assert.equal(again.published_at, corrected);
  assert.equal(again.bookmark_count, 250);
  assert.equal(again.like_count, 0);

  const bad = await submit(env, {url:'https://x.com/example/status/2108148604447884107', published_at:'2026-10-08'});
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'invalid_time');
  const pasted = await submit(env, {url:'https://x.com/example/status/2108148604447884108', created_at:posted}, null);
  assert.equal(pasted.status, 401);
  assert.equal(env.PUBLIC_FEED.json().items.find(item => item.original_url === highUrl).published_at, corrected);
});

test('worker public feed reads do not grow an underrated pin just because a candidate flag exists', async () => {
  const env = await environment();
  await submit(env, {url:postUrl, has_article:true});
  assert.equal((await decide(env, {url:postUrl, status:'approved', underrated_candidate:true})).status, 200);
  const raw = await env.PUBLIC_FEED.get(PUBLIC_FEED_KEY);
  assert.equal(await overlayPublicUnderratedPins(raw, env), raw);
  assert.equal(raw.includes('underrated_pins'), false);
  assert.equal(raw.includes('underrated_candidate'), false);
});
