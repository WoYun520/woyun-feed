import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { dotInboxHash, handleDotInboxRequest } from '../dot-inbox-service.js';
import { DOT_PENDING_BATCH_MAX, DOT_PENDING_MAX, DOT_PENDING_PATH, DOT_PENDING_PREFIX, handleDotPendingRequest } from '../dot-pending-service.js';
import worker from '../worker.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const delivery = 'test-delivery-credential-1234567890';
const review = 'test-review-credential-0987654321';
const base = 'https://feed.example.test';
const statusId = '2108148604447883999';
const postUrl = `https://x.com/example/status/${statusId}`;

class FakeKV {
  constructor() { this.values = new Map(); this.writes = []; this.lists = []; this.reads = []; }
  async get(key) { this.reads.push(key); return this.values.get(key)?.raw ?? null; }
  async put(key, raw, options = {}) { this.writes.push({key, raw, options}); this.values.set(key, {raw, metadata:options.metadata}); }
  async list(options = {}) {
    this.lists.push(options);
    if (options.cursor === 'broken-cursor') throw Error('Invalid cursor: 400');
    const keys = [...this.values].filter(([key]) => key.startsWith(options.prefix || '')).map(([name, value]) => ({name, metadata:value.metadata}));
    const start = options.cursor ? Number(options.cursor) : 0;
    if (!Number.isInteger(start) || start < 0 || start > keys.length) throw Error('Invalid cursor: 400');
    const limit = Number.isInteger(options.limit) ? options.limit : keys.length;
    const slice = keys.slice(start, start + limit);
    const list_complete = start + limit >= keys.length;
    return {keys:slice, list_complete, ...(list_complete ? {} : {cursor:String(start + limit)})};
  }
}

const environment = async () => ({
  DOT_INBOX: new FakeKV(),
  DOT_DELIVERY_TOKEN_HASH: await dotInboxHash(delivery),
  DOT_REVIEW_TOKEN_HASH: await dotInboxHash(review),
  PUBLIC_FEED: {get() { throw Error('must not read public storage'); }, put() { throw Error('must not write public storage'); }},
  kosxPoolFetch: async () => { throw Error('roster offline'); },
});

function request(method = 'POST', {token = null, path = DOT_PENDING_PATH, body, headers = {}} = {}) {
  return new Request(`${base}${path}`, {
    method,
    headers: {...(token === null ? {} : {Authorization:`Bearer ${token}`}), ...(body !== undefined ? {'Content-Type':'application/json'} : {}), ...headers},
    ...(body === undefined ? {} : {body: typeof body === 'string' ? body : JSON.stringify(body)}),
  });
}

const submit = (env, body = {url:postUrl}, options = {}) => handleDotPendingRequest(request('POST', {body, ...options}), env);
const stored = env => [...env.DOT_INBOX.values.values()].map(entry => JSON.parse(entry.raw));

test('pending intake fails closed without distinct delivery and review hashes', async () => {
  for (const edit of [env => delete env.DOT_INBOX, env => delete env.DOT_DELIVERY_TOKEN_HASH, env => delete env.DOT_REVIEW_TOKEN_HASH, env => { env.DOT_DELIVERY_TOKEN_HASH = env.DOT_REVIEW_TOKEN_HASH; }, env => { env.DOT_REVIEW_TOKEN_HASH = 'not-a-hash'; }]) {
    const env = await environment();
    edit(env);
    const response = await submit(env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'pending_unavailable');
    assert.equal(env.DOT_INBOX?.writes?.length || 0, 0);
  }
});

test('a homepage paste accepts one X url, dedupes, and never publishes', async () => {
  const env = await environment();
  const created = await submit(env, {url:`https://twitter.com/example/status/${statusId}?s=20`});
  const body = await created.json();
  assert.equal(created.status, 201);
  assert.equal(body.status, 'pending');
  assert.equal(body.existing, false);
  assert.equal(body.id, `kosx-${statusId}`);
  assert.equal(body.key, `x:${statusId}`);
  assert.equal(body.url, postUrl);
  assert.equal(body.author_handle, 'example');
  assert.equal(Object.hasOwn(body, 'note'), false);
  assert.equal(Object.hasOwn(body, 'source'), false);
  assert.equal(JSON.stringify(body).includes('公开'), false);
  const [write] = env.DOT_INBOX.writes;
  assert.equal(write.key, `${DOT_PENDING_PREFIX}x:${statusId}`);
  assert.equal(write.options.expirationTtl, undefined);
  assert.deepEqual(write.options.metadata, {id:body.id, key:body.key, status:'pending', submitted_at:body.submitted_at});
  assert.equal(Object.hasOwn(write.options.metadata, 'note'), false);
  const record = JSON.parse(write.raw);
  assert.equal(record.status, 'pending');
  assert.equal(record.source, 'homepage');
  assert.equal(record.note, '');
  const duplicate = await submit(env, {url:postUrl});
  const again = await duplicate.json();
  assert.equal(duplicate.status, 200);
  assert.equal(again.existing, true);
  assert.equal(again.submitted_at, body.submitted_at);
  assert.equal(env.DOT_INBOX.writes.length, 1);
  assert.equal(env.PUBLIC_FEED.puts || 0, 0);
});

test('delivery keeps a multiline or overlong excerpt, and body or summary aliases, instead of dropping the post', async () => {
  const env = await environment();
  const text = '第一行是正文。\n第二行仍是摘录，不应该被整段丢掉。';
  const created = await submit(env, {url:postUrl, text, note:'全X中文≥1k补仓 | 非池 | 待人工过审 | rank13'}, {token:delivery});
  assert.equal(created.status, 201);
  assert.equal(stored(env)[0].text, text);
  assert.equal(stored(env)[0].note, '全X中文≥1k补仓 | 非池 | 待人工过审 | rank13');
  const longEnv = await environment();
  const long = `${'摘录正文'.repeat(200)}收尾`;
  const clipped = await submit(longEnv, {url:postUrl, text:long}, {token:delivery});
  assert.equal(clipped.status, 201);
  assert.equal(stored(longEnv)[0].text.length, 800);
  assert.equal(long.startsWith(stored(longEnv)[0].text), true);
  const aliasEnv = await environment();
  const body = '文章预览：跟着操作就能跑通本地字幕。'.repeat(3);
  const alias = await submit(aliasEnv, {url:postUrl, summary:'短备注', body, excerpt:'一句'}, {token:delivery});
  assert.equal(alias.status, 201);
  assert.equal(stored(aliasEnv)[0].text, body);
  const secret = await submit(await environment(), {url:postUrl, text:'token: abcdefghijklmnop'}, {token:delivery});
  assert.equal(secret.status, 400);
  assert.equal((await secret.json()).error, 'invalid_text');
});

test('delivery can attach a note or a batch, and a later duplicate keeps the first record', async () => {
  const env = await environment();
  const note = '群里候选，尚未过审';
  const first = await submit(env, {url:postUrl, author_handle:'Example', note}, {token:delivery});
  const saved = await first.json();
  assert.equal(first.status, 201);
  assert.equal(saved.note, note);
  assert.equal(saved.source, 'delivery');
  assert.equal(saved.author_handle, 'example');
  const secondUrl = 'https://x.com/other/status/2108148604447884000';
  const batch = await submit(env, {items:[{url:postUrl, note:'不要覆盖'}, {url:secondUrl, author_handle:'other'}]}, {token:delivery});
  const page = await batch.json();
  assert.equal(batch.status, 201);
  assert.equal(page.status, 'pending');
  assert.equal(page.results.length, 2);
  assert.equal(page.results[0].existing, true);
  assert.equal(page.results[0].note, note);
  assert.equal(page.results[1].existing, false);
  assert.equal(page.results[1].status, 'pending');
  assert.equal(stored(env)[0].note, note);
  assert.equal(stored(env)[0].submitted_at, saved.submitted_at);
  const quiet = await submit(env);
  const hidden = await quiet.json();
  assert.equal(quiet.status, 200);
  assert.equal(hidden.existing, true);
  assert.equal(Object.hasOwn(hidden, 'note'), false);
  assert.equal(stored(env).find(row => row.key === 'x:2108148604447883999').note, note);
});

test('notes, batches, review tokens and delivery reads stay on their own side of the door', async () => {
  const env = await environment();
  for (const [body, token] of [
    [{url:postUrl, note:'备注'}, null],
    [{items:[{url:postUrl}]}, null],
    [{url:postUrl, author_handle:'example'}, null],
    [{url:postUrl}, review],
  ]) {
    const response = await submit(env, body, {token});
    assert.equal(response.status, 401, JSON.stringify(body));
    assert.equal(response.headers.get('WWW-Authenticate'), 'Bearer realm="dot-pending"');
    const text = await response.text();
    assert.equal(text.includes(delivery), false);
    assert.equal(text.includes(review), false);
  }
  assert.equal((await handleDotPendingRequest(request('GET', {token:delivery}), env)).status, 401);
  assert.equal((await handleDotPendingRequest(request('GET', {token:null}), env)).status, 401);
  assert.equal((await handleDotPendingRequest(request('GET', {token:null, path:`${DOT_PENDING_PATH}?token=${review}`}), env)).status, 401);
  assert.equal(env.DOT_INBOX.writes.length, 0);
});

test('review lists only pending records and inbox batches stay on their own prefix', async () => {
  const env = await environment();
  await submit(env, {url:postUrl, note:'给审核看'}, {token:delivery});
  const response = await handleDotPendingRequest(request('GET', {token:review}), env);
  const page = await response.json();
  assert.equal(response.status, 200);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].note, '给审核看');
  assert.equal(page.items[0].source, 'delivery');
  assert.equal(page.items[0].status, 'pending');
  assert.equal(page.next_cursor, null);
  assert.deepEqual(env.DOT_INBOX.lists.filter(entry => entry.prefix === DOT_PENDING_PREFIX).at(-1), {prefix:DOT_PENDING_PREFIX, limit:50});
  const inbox = await handleDotInboxRequest(request('GET', {token:review, path:'/api/dot/inbox'}), env);
  assert.deepEqual(await inbox.json(), {batches:[], next_cursor:null});
  assert.equal(env.DOT_INBOX.lists.some(entry => entry.prefix === 'batch:'), true);
});

test('invalid urls, mismatched authors, duplicate batches and oversized notes are rejected before storage', async () => {
  const env = await environment();
  const cases = [
    [{url:'https://example.com/not-a-post'}, 'invalid_url'],
    [{url:postUrl, author_handle:'someoneelse'}, 'invalid_author'],
    [{items:[{url:postUrl}, {url:`https://twitter.com/example/status/${statusId}`}]}, 'duplicate_url'],
    [{url:postUrl, note:'x'.repeat(401)}, 'invalid_note'],
    [{url:postUrl, note:'密码：abcdefghijklm'}, 'invalid_note'],
    [{url:postUrl, note:'第一行\n第二行'}, 'invalid_note'],
    [{items:[]}, 'invalid_body'],
    [{items:Array.from({length:DOT_PENDING_BATCH_MAX + 1}, (_, index) => ({url:`https://x.com/example/status/${40000000 + index}`}))}, 'invalid_body'],
  ];
  for (const [body, code] of cases) {
    const response = await submit(env, body, {token:delivery});
    assert.equal(response.status, 400, code);
    assert.equal((await response.json()).error, code);
  }
  assert.equal((await submit(env, {url:postUrl}, {token:delivery, headers:{'Content-Type':'text/plain'}})).status, 415);
  assert.equal(env.DOT_INBOX.writes.length, 0);
});

test('the queue stops at 300 new links and still accepts a duplicate', async () => {
  const env = await environment();
  for (let index = 0; index < DOT_PENDING_MAX; index += 1) {
    const response = await submit(env, {url:`https://x.com/example/status/${30000000 + index}`});
    assert.equal(response.status, 201);
  }
  const full = await submit(env, {url:'https://x.com/example/status/30000300'});
  assert.equal(full.status, 409);
  assert.equal((await full.json()).error, 'queue_full');
  const duplicate = await submit(env, {url:'https://x.com/example/status/30000000'});
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).existing, true);
  assert.equal(env.DOT_INBOX.writes.length, DOT_PENDING_MAX);
});

test('foreign origins are refused and same-origin or server posts are accepted', async () => {
  const env = await environment();
  for (const origin of ['https://other.example.test', 'null', 'http://feed.example.test']) {
    const response = await submit(env, {url:postUrl}, {headers:{Origin:origin}});
    assert.equal(response.status, 403);
    assert.equal(response.headers.has('Access-Control-Allow-Origin'), false);
  }
  assert.equal((await submit(env, {url:postUrl}, {headers:{Origin:base}})).status, 201);
  assert.equal((await submit(env, {url:'https://x.com/example/status/2108148604447884002'})).status, 201);
  assert.equal(env.DOT_INBOX.writes.length, 2);
});

test('unsupported methods and query secrets cannot curate or publish', async () => {
  const env = await environment();
  for (const method of ['DELETE', 'PUT', 'PATCH', 'HEAD', 'OPTIONS']) {
    const response = await handleDotPendingRequest(request(method, {token:delivery}), env);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET, POST');
  }
  assert.equal((await handleDotPendingRequest(request('POST', {token:delivery, path:`${DOT_PENDING_PATH}?cursor=1`, body:{url:postUrl}}), env)).status, 400);
  assert.equal(env.DOT_INBOX.writes.length, 0);
  assert.equal(await handleDotPendingRequest(request('GET', {token:review, path:'/api/dot/inbox'}), env), null);
});

test('corrupt pending records fail closed instead of being returned or overwritten', async () => {
  const env = await environment();
  const created = await (await submit(env)).json();
  const key = `${DOT_PENDING_PREFIX}${created.key}`;
  env.DOT_INBOX.values.set(key, {raw:'{"status":"approved"}', metadata:{}});
  assert.equal((await handleDotPendingRequest(request('GET', {token:review}), env)).status, 503);
  assert.equal((await submit(env)).status, 503);
  assert.equal(env.DOT_INBOX.writes.length, 1);
});

test('private responses disable cache and do not echo secrets or stack traces', async () => {
  const env = await environment();
  env.DOT_INBOX.put = async () => { throw Error('secret internal private storage details'); };
  for (const response of [await submit(env), await handleDotPendingRequest(request('GET', {token:null}), env)]) {
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
    assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
    const raw = await response.text();
    assert.equal(raw.includes(delivery), false);
    assert.equal(raw.includes(review), false);
    assert.equal(raw.includes('secret internal'), false);
    assert.equal(raw.includes(' at '), false);
  }
});

test('worker routes pending intake before assets and leaves it unavailable without secrets', async () => {
  const assetCalls = [];
  const publicCalls = [];
  const env = {ASSETS:{fetch:async req => { assetCalls.push(new URL(req.url).pathname); return new Response('public asset'); }}, PUBLIC_FEED:{get:async key => { publicCalls.push(key); return '{"public":true}'; }}};
  const closed = await worker.fetch(new Request(`${base}${DOT_PENDING_PATH}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url:postUrl})}), env);
  assert.equal(closed.status, 503);
  assert.equal((await closed.json()).error, 'pending_unavailable');
  assert.deepEqual(assetCalls, []);
  assert.deepEqual(publicCalls, []);
  const asset = await worker.fetch(new Request(`${base}/index.html`), env);
  assert.equal(await asset.text(), 'public asset');
});
