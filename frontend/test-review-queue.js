import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { dotInboxHash } from '../dot-inbox-service.js';
import { DOT_PENDING_DECISION_PATH, DOT_PENDING_PATH, DOT_PENDING_PREFIX, handleDotPendingRequest } from '../dot-pending-service.js';
import { UNDERRATED_PIN_KEY, handleDotUnderratedRequest, overlayPublicUnderratedPins } from '../dot-underrated-service.js';
import { PUBLIC_FEED_KEY } from './cloud-feed-service.js';
import { makePublicFeed } from './public-feed-data.js';
import { normalizeRepositories } from './repository-normalize.js';
import { selectHomeShowcase } from './src/homeShowcase.js';
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

test('worker public feed reads do not grow an underrated pin just because a candidate flag exists', async () => {
  const env = await environment();
  await submit(env, {url:postUrl, has_article:true});
  assert.equal((await decide(env, {url:postUrl, status:'approved', underrated_candidate:true})).status, 200);
  const raw = await env.PUBLIC_FEED.get(PUBLIC_FEED_KEY);
  assert.equal(await overlayPublicUnderratedPins(raw, env), raw);
  assert.equal(raw.includes('underrated_pins'), false);
  assert.equal(raw.includes('underrated_candidate'), false);
});
