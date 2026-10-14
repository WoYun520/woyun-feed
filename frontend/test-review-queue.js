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
import { normalizeCoverUrl } from './src/postMedia.js';
import { renderHomeShowcase } from './src/homeShowcaseView.js';
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
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const renderFeed = (feed, homeView = 'latest') => renderHomeShowcase({
  homeView, escapeHtml, formatTime:value => value,
  safeUrl(value) { try { const url = new URL(value); return ['http:','https:'].includes(url.protocol) ? url.href : '#'; } catch { return '#'; } },
}, {sources:feed.sources, allItems:feed.items, items:feed.items, profile:feed.profile || {}, generated_at:feed.generated_at,
  hiddenItemIds:new Set(), savedItemIds:new Set(), archivedItemIds:new Set(), savedItems:[], dotFeaturedItems:[]});

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
  assert.equal(duplicate.like_count, 8);
  assert.equal(duplicate.text, '避坑：别再把密钥写进仓库。');
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
    [{url:'https://x.com/example/status/2108148604447884016', cover_url:'http://cdn.example.com/covers/a.jpg'}, 'invalid_cover'],
    [{url:'https://x.com/example/status/2108148604447884017', cover_url:'https://user:pass@cdn.example.com/covers/a.jpg'}, 'invalid_cover'],
    [{url:'https://x.com/example/status/2108148604447884018', cover_url:'https://cdn.example.com/covers/a.jpg?token=abcdefghijklmnop'}, 'invalid_cover'],
    [{url:'https://x.com/example/status/2108148604447884019', cover_url:'https://127.0.0.1/covers/a.jpg'}, 'invalid_cover'],
    [{url:'https://x.com/example/status/2108148604447884021', cover_url:''}, 'invalid_cover'],
    [{url:'https://x.com/example/status/2108148604447884022', cover_url:'not a url'}, 'invalid_cover'],
    [{url:'https://x.com/example/status/2108148604447884023', cover_url:`https://cdn.example.com/${'a'.repeat(1600)}`}, 'invalid_cover'],
    [{url:'https://x.com/example/status/2108148604447884024', cover_url:'https://cdn.example.com/covers/a.jpg#part'}, 'invalid_cover'],
    [{url:'https://x.com/example/status/2108148604447884025', cover_url:'javascript:alert(1)'}, 'invalid_cover'],
  ]) {
    const response = await submit(env, body);
    assert.equal(response.status, 400, code);
    assert.equal((await response.json()).error, code);
  }
  assert.equal(env.DOT_INBOX.writes.filter(entry => entry.key.startsWith(DOT_PENDING_PREFIX)).length, 1);
  assert.equal(env.PUBLIC_FEED.writes.length, 0);
  const pasted = await submit(env, {url:'https://x.com/example/status/2108148604447884020', cover_url:'https://cdn.example.com/covers/article.jpg'}, null);
  assert.equal(pasted.status, 401);
  assert.equal(env.DOT_INBOX.writes.filter(entry => entry.key.startsWith(DOT_PENDING_PREFIX)).length, 1);
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
  assert.equal(again.has_article, true);
  assert.equal(again.review_type, '文章');

  const bad = await submit(env, {url:'https://x.com/example/status/2108148604447884107', published_at:'2026-10-08'});
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'invalid_time');
  const pasted = await submit(env, {url:'https://x.com/example/status/2108148604447884108', created_at:posted}, null);
  assert.equal(pasted.status, 401);
  const rewritten = env.PUBLIC_FEED.json().items.find(item => item.original_url === highUrl);
  assert.equal(rewritten.published_at, corrected);
  assert.equal(rewritten.bookmark_count, 250);
  assert.equal(rewritten.like_count, 0);
  assert.equal(rewritten.has_article, true);
  assert.equal(rewritten.review_type, '文章');
  assert.equal(rewritten.source_item_time, highDecision.reviewed_at);
  assert.equal(rewritten.captured_at, highDecision.reviewed_at);
});

test('re-delivery fills absent signals on an approved row and republishes them without replacing values already stored', async () => {
  const env = await environment();
  const url = 'https://x.com/example/status/2108148604447884301';
  const created = await (await submit(env, {url, note:'文章候选', review_type:'文章'})).json();
  assert.equal(created.status, 'pending');
  assert.equal(Object.hasOwn(created, 'bookmark_count'), false);
  assert.equal(Object.hasOwn(created, 'like_count'), false);
  assert.equal(Object.hasOwn(created, 'has_article'), false);
  assert.equal(Object.hasOwn(created, 'text'), false);
  const approved = await (await decide(env, {url, status:'approved'})).json();
  const before = env.PUBLIC_FEED.json().items.find(item => item.original_url === url);
  assert.equal(Object.hasOwn(before, 'bookmark_count'), false);
  assert.equal(before.review_type, '文章');
  assert.equal(before.source_item_time, approved.reviewed_at);
  assert.equal(before.captured_at, approved.reviewed_at);
  const feedWrites = env.PUBLIC_FEED.writes.length;

  const excerpt = '补上的摘录，说明这是一篇可以对照的文章。';
  const filled = await (await submit(env, {
    url, bookmark_count:240, like_count:12, review_type:'短帖', has_article:true, text:excerpt,
  })).json();
  assert.equal(filled.status, 'approved');
  assert.equal(filled.existing, true);
  assert.equal(filled.reviewed_at, approved.reviewed_at);
  assert.equal(filled.note, '文章候选');
  assert.equal(filled.bookmark_count, 240);
  assert.equal(filled.like_count, 12);
  assert.equal(filled.has_article, true);
  assert.equal(filled.text, excerpt);
  assert.equal(filled.review_type, '文章');
  const after = env.PUBLIC_FEED.json().items.find(item => item.original_url === url);
  assert.equal(after.bookmark_count, 240);
  assert.equal(after.like_count, 12);
  assert.equal(after.has_article, true);
  assert.equal(after.review_type, '文章');
  assert.equal(after.source_item_time, approved.reviewed_at);
  assert.equal(after.captured_at, approved.reviewed_at);
  assert.equal(after.published_at, before.published_at);
  assert.ok(env.PUBLIC_FEED.writes.length > feedWrites);

  const keptWrites = env.PUBLIC_FEED.writes.length;
  const kept = await (await submit(env, {
    url, bookmark_count:1, like_count:99, review_type:'产品安利', has_article:false, text:'后来的摘录不应覆盖',
  })).json();
  assert.equal(kept.bookmark_count, 240);
  assert.equal(kept.like_count, 12);
  assert.equal(kept.has_article, true);
  assert.equal(kept.review_type, '文章');
  assert.equal(kept.text, excerpt);
  assert.equal(kept.reviewed_at, approved.reviewed_at);
  assert.equal(env.PUBLIC_FEED.writes.length, keptWrites);
  const still = env.PUBLIC_FEED.json().items.find(item => item.original_url === url);
  assert.equal(still.bookmark_count, 240);
  assert.equal(still.review_type, '文章');
  assert.equal(still.has_article, true);
  assert.equal(still.source_item_time, approved.reviewed_at);

  const legacyUrl = 'https://x.com/example/status/2108148604447884302';
  const legacyCreated = await (await submit(env, {url:legacyUrl, note:'旧记录'})).json();
  const legacyApproved = await (await decide(env, {url:legacyUrl, status:'approved'})).json();
  const legacyKey = `${DOT_PENDING_PREFIX}${legacyCreated.key}`;
  const legacyRow = JSON.parse(env.DOT_INBOX.values.get(legacyKey).raw);
  delete legacyRow.review_type;
  env.DOT_INBOX.values.set(legacyKey, {raw:JSON.stringify(legacyRow), metadata:env.DOT_INBOX.values.get(legacyKey).metadata});
  const legacyFilled = await (await submit(env, {
    url:legacyUrl, review_type:'教程指南', bookmark_count:210, has_article:false, text:'旧行补上的摘录',
  })).json();
  assert.equal(legacyFilled.review_type, '教程指南');
  assert.equal(legacyFilled.bookmark_count, 210);
  assert.equal(legacyFilled.has_article, false);
  assert.equal(legacyFilled.text, '旧行补上的摘录');
  assert.equal(legacyFilled.reviewed_at, legacyApproved.reviewed_at);
  const legacyItem = env.PUBLIC_FEED.json().items.find(item => item.original_url === legacyUrl);
  assert.equal(legacyItem.review_type, '教程指南');
  assert.equal(legacyItem.bookmark_count, 210);
  assert.equal(legacyItem.has_article, false);
  assert.equal(legacyItem.source_item_time, legacyApproved.reviewed_at);
  assert.equal(legacyItem.captured_at, legacyApproved.reviewed_at);

  const zeroUrl = 'https://x.com/example/status/2108148604447884303';
  await submit(env, {url:zeroUrl, bookmark_count:0, like_count:0, has_article:false, review_type:'教程指南', text:'已有摘录'});
  const zeroApproved = await (await decide(env, {url:zeroUrl, status:'approved'})).json();
  const zeroAgain = await (await submit(env, {
    url:zeroUrl, bookmark_count:500, like_count:8, has_article:true, review_type:'文章', text:'新摘录',
  })).json();
  assert.equal(zeroAgain.bookmark_count, 0);
  assert.equal(zeroAgain.like_count, 0);
  assert.equal(zeroAgain.has_article, false);
  assert.equal(zeroAgain.review_type, '教程指南');
  assert.equal(zeroAgain.text, '已有摘录');
  assert.equal(zeroAgain.reviewed_at, zeroApproved.reviewed_at);
  const zeroItem = env.PUBLIC_FEED.json().items.find(item => item.original_url === zeroUrl);
  assert.equal(zeroItem.bookmark_count, 0);
  assert.equal(zeroItem.like_count, 0);
  assert.equal(zeroItem.has_article, false);
  assert.equal(zeroItem.review_type, '教程指南');
  assert.equal(zeroItem.source_item_time, zeroApproved.reviewed_at);

  const rejectedUrl = 'https://x.com/example/status/2108148604447884304';
  const rejectedCreated = await (await submit(env, {url:rejectedUrl, note:'略过'})).json();
  const rejected = await (await decide(env, {url:rejectedUrl, status:'rejected'})).json();
  const rejectedKey = `${DOT_PENDING_PREFIX}${rejectedCreated.key}`;
  const rejectedRaw = env.DOT_INBOX.values.get(rejectedKey).raw;
  const againRejected = await (await submit(env, {
    url:rejectedUrl, bookmark_count:300, review_type:'文章', has_article:true, published_at:'2026-10-08T04:00:00.000Z', text:'不应写回',
  })).json();
  assert.equal(againRejected.status, 'rejected');
  assert.equal(againRejected.reviewed_at, rejected.reviewed_at);
  assert.equal(Object.hasOwn(againRejected, 'bookmark_count'), false);
  assert.equal(env.DOT_INBOX.values.get(rejectedKey).raw, rejectedRaw);
  assert.equal(env.PUBLIC_FEED.json().items.some(item => item.original_url === rejectedUrl), false);

  const pendingUrl = 'https://x.com/example/status/2108148604447884305';
  const pendingCreated = await (await submit(env, {url:pendingUrl})).json();
  assert.equal(pendingCreated.review_type, '短帖');
  const pendingWrites = env.PUBLIC_FEED.writes.length;
  const pendingFilled = await (await submit(env, {
    url:pendingUrl, bookmark_count:180, like_count:2, has_article:true, review_type:'教程指南', text:'待筛选也能补热度',
  })).json();
  assert.equal(pendingFilled.status, 'pending');
  assert.equal(pendingFilled.published, false);
  assert.equal(pendingFilled.bookmark_count, 180);
  assert.equal(pendingFilled.like_count, 2);
  assert.equal(pendingFilled.has_article, true);
  assert.equal(pendingFilled.text, '待筛选也能补热度');
  assert.equal(pendingFilled.review_type, '短帖');
  assert.equal(env.PUBLIC_FEED.writes.length, pendingWrites);
  assert.equal(env.PUBLIC_FEED.json().items.some(item => item.original_url === pendingUrl), false);
});

test('a pool re-delivery fills a missing bookmark_count onto the public item for 七日精选', async () => {
  const env = await environment();
  const poolHandle = KOSX_POOL_HANDLES[0];
  const url = `https://x.com/${poolHandle}/status/2108148604447884306`;
  const created = await (await submit(env, {url, review_type:'文章', note:'池内文章，热度后补'})).json();
  assert.equal(created.status, 'approved');
  assert.equal(created.approval, 'pool');
  assert.equal(Object.hasOwn(created, 'bookmark_count'), false);
  const before = env.PUBLIC_FEED.json().items.find(item => item.original_url === url);
  assert.equal(Object.hasOwn(before, 'bookmark_count'), false);
  assert.equal(before.review_type, '文章');
  const homeBefore = showcase(env.PUBLIC_FEED.json());
  assert.equal(homeBefore.week.some(entry => entry.post.item.bookmark_count >= HOME_WEEK_BOOKMARK_MIN && entry.post.originalUrl === url), false);

  const posted = '2026-10-08T04:00:00.000Z';
  const again = await (await submit(env, {
    url, bookmark_count:260, like_count:4, review_type:'短帖', has_article:false, published_at:posted, created_at:'2026-10-01T00:00:00.000Z',
  })).json();
  assert.equal(again.existing, true);
  assert.equal(again.status, 'approved');
  assert.equal(again.reviewed_at, created.reviewed_at);
  assert.equal(again.bookmark_count, 260);
  assert.equal(again.like_count, 4);
  assert.equal(again.review_type, '文章');
  assert.equal(again.has_article, false);
  assert.equal(again.published_at, posted);
  assert.equal(again.created_at, '2026-10-01T00:00:00.000Z');
  const after = env.PUBLIC_FEED.json().items.find(item => item.original_url === url);
  assert.equal(after.bookmark_count, 260);
  assert.equal(after.like_count, 4);
  assert.equal(after.review_type, '文章');
  assert.equal(after.has_article, false);
  assert.equal(after.published_at, posted);
  assert.notEqual(after.published_at, before.published_at);
  assert.equal(after.source_item_time, created.reviewed_at);
  assert.equal(after.captured_at, created.reviewed_at);
  const home = showcase(env.PUBLIC_FEED.json());
  assert.equal(home.weekRule, 'bookmarks');
  assert.equal(home.week.some(entry => entry.post.originalUrl === url && entry.post.item.bookmark_count === 260), true);
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

test('delivery stores a cover, copies it onto the public item, and a later delivery only fills a missing cover', async () => {
  const env = await environment();
  const cover = 'https://cdn.example.com/covers/article.jpg?format=jpg&name=large';
  const storedCover = normalizeCoverUrl(cover);
  assert.equal(storedCover, cover);
  const url = 'https://x.com/example/status/2108148604447884401';
  const bareUrl = 'https://x.com/example/status/2108148604447884402';
  const created = await (await submit(env, {
    url, note:'一篇可以对照的文章', review_type:'文章', has_article:true, bookmark_count:240,
    cover_url:'https://CDN.Example.com/covers/article.jpg?format=jpg&name=large',
    published_at:'2026-10-08T04:00:00.000Z',
  })).json();
  assert.equal(created.cover_url, storedCover);
  assert.equal(created.status, 'pending');
  const listed = await (await handleDotPendingRequest(request('GET', {token:review}), env)).json();
  assert.equal(listed.items.find(item => item.url === url).cover_url, storedCover);
  const approved = await (await decide(env, {url, status:'approved'})).json();
  assert.equal(approved.cover_url, storedCover);
  const published = env.PUBLIC_FEED.json().items.find(item => item.original_url === url);
  assert.equal(published.cover_url, storedCover);
  assert.equal(published.review_type, '文章');
  assert.equal(published.has_article, true);
  const direct = kosxPublicItem({
    id:'kosx-9', status:'approved', reviewed_at:'2026-10-14T01:00:00.000Z', author_handle:'example',
    url:'https://x.com/example/status/9', note:'', review_type:'文章', cover_url:'http://cdn.example.com/covers/a.jpg',
  });
  assert.equal(Object.hasOwn(direct, 'cover_url'), false);

  await submit(env, {url:bareUrl, review_type:'文章', bookmark_count:220, published_at:'2026-10-08T05:00:00.000Z'});
  await decide(env, {url:bareUrl, status:'approved'});
  const bare = env.PUBLIC_FEED.json().items.find(item => item.original_url === bareUrl);
  assert.equal(Object.hasOwn(bare, 'cover_url'), false);
  const page = renderFeed(env.PUBLIC_FEED.json());
  const week = renderFeed(env.PUBLIC_FEED.json(), 'week');
  const shown = `src="${escapeHtml(storedCover)}"`;
  assert.match(page, new RegExp(shown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(week, new RegExp(shown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(page, /文章封面，未核对原帖/);
  const bareCard = page.slice(page.indexOf(`data-home-card="${bare.id}"`), page.indexOf('</article>', page.indexOf(`data-home-card="${bare.id}"`)));
  assert.match(bareCard, /data-cover="plain"/);
  assert.match(bareCard, /打开原帖/);
  assert.doesNotMatch(bareCard, /无来源附图|<img|cover-quote/);

  const other = 'https://cdn.example.com/covers/later.jpg';
  const keptWrites = env.PUBLIC_FEED.writes.length;
  const again = await (await submit(env, {url, cover_url:other, bookmark_count:1})).json();
  assert.equal(again.existing, true);
  assert.equal(again.cover_url, storedCover);
  assert.equal(again.bookmark_count, 240);
  assert.equal(again.reviewed_at, approved.reviewed_at);
  assert.equal(env.PUBLIC_FEED.writes.length, keptWrites);
  assert.equal(env.PUBLIC_FEED.json().items.find(item => item.original_url === url).cover_url, storedCover);

  const missingUrl = 'https://x.com/example/status/2108148604447884403';
  const missingCreated = await (await submit(env, {url:missingUrl, review_type:'文章', note:'封面后补'})).json();
  assert.equal(Object.hasOwn(missingCreated, 'cover_url'), false);
  const missingApproved = await (await decide(env, {url:missingUrl, status:'approved'})).json();
  assert.equal(Object.hasOwn(env.PUBLIC_FEED.json().items.find(item => item.original_url === missingUrl), 'cover_url'), false);
  const beforeWrites = env.PUBLIC_FEED.writes.length;
  const filled = await (await submit(env, {url:missingUrl, cover_url:other, review_type:'短帖'})).json();
  assert.equal(filled.cover_url, other);
  assert.equal(filled.review_type, '文章');
  assert.equal(filled.reviewed_at, missingApproved.reviewed_at);
  assert.equal(filled.status, 'approved');
  assert.ok(env.PUBLIC_FEED.writes.length > beforeWrites);
  const filledItem = env.PUBLIC_FEED.json().items.find(item => item.original_url === missingUrl);
  assert.equal(filledItem.cover_url, other);
  assert.equal(filledItem.source_item_time, missingApproved.reviewed_at);
  assert.match(renderFeed(env.PUBLIC_FEED.json()), new RegExp(escapeHtml(other).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const stillWrites = env.PUBLIC_FEED.writes.length;
  const keptCover = await (await submit(env, {url:missingUrl, cover_url:'https://cdn.example.com/covers/replace.jpg'})).json();
  assert.equal(keptCover.cover_url, other);
  assert.equal(env.PUBLIC_FEED.writes.length, stillWrites);

  const rejectedUrl = 'https://x.com/example/status/2108148604447884404';
  const rejectedCreated = await (await submit(env, {url:rejectedUrl, note:'略过'})).json();
  await decide(env, {url:rejectedUrl, status:'rejected'});
  const rejectedKey = `${DOT_PENDING_PREFIX}${rejectedCreated.key}`;
  const rejectedRaw = env.DOT_INBOX.values.get(rejectedKey).raw;
  const rejectedWrites = env.PUBLIC_FEED.writes.length;
  const againRejected = await (await submit(env, {url:rejectedUrl, cover_url:other, review_type:'文章'})).json();
  assert.equal(againRejected.status, 'rejected');
  assert.equal(Object.hasOwn(againRejected, 'cover_url'), false);
  assert.equal(env.DOT_INBOX.values.get(rejectedKey).raw, rejectedRaw);
  assert.equal(env.PUBLIC_FEED.writes.length, rejectedWrites);

  const pendingUrl = 'https://x.com/example/status/2108148604447884405';
  await submit(env, {url:pendingUrl, review_type:'教程指南'});
  const pendingWrites = env.PUBLIC_FEED.writes.length;
  const pendingFilled = await (await submit(env, {url:pendingUrl, cover_url:other})).json();
  assert.equal(pendingFilled.status, 'pending');
  assert.equal(pendingFilled.cover_url, other);
  assert.equal(env.PUBLIC_FEED.writes.length, pendingWrites);
  assert.equal(env.PUBLIC_FEED.json().items.some(item => item.original_url === pendingUrl), false);

  const poolHandle = KOSX_POOL_HANDLES[0];
  const poolUrl = `https://x.com/${poolHandle}/status/2108148604447884406`;
  const pooled = await (await submit(env, {
    url:poolUrl, review_type:'教程指南', bookmark_count:320, cover_url:cover, published_at:'2026-10-08T04:00:00.000Z',
  })).json();
  assert.equal(pooled.status, 'approved');
  assert.equal(pooled.approval, 'pool');
  assert.equal(pooled.cover_url, storedCover);
  assert.equal(env.PUBLIC_FEED.json().items.find(item => item.original_url === poolUrl).cover_url, storedCover);
});
