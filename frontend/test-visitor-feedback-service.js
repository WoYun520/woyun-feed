import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { dotInboxHash } from '../dot-inbox-service.js';
import {
  VISITOR_FEEDBACK_PATH,
  VISITOR_FEEDBACK_RATE_LIMIT,
  VISITOR_FEEDBACK_READ_PATH,
  handleVisitorFeedbackRequest,
} from '../visitor-feedback-service.js';
import worker from '../worker.js';

if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

const delivery = 'test-delivery-credential-1234567890';
const review = 'test-review-credential-0987654321';
const base = 'https://feed.example.test';
const feedbackId = '11111111-1111-4111-8111-111111111111';
const newerId = '22222222-2222-4222-8222-222222222222';

class FakeKV {
  constructor() { this.values = new Map(); this.writes = []; }
  async get(key) { return this.values.get(key)?.raw ?? null; }
  async put(key, raw, options = {}) { this.writes.push({key, raw, options}); this.values.set(key, {raw, metadata: options.metadata || {}}); }
  async list(options) {
    const keys = [...this.values.entries()]
      .filter(([key]) => key.startsWith(options.prefix))
      .map(([name, value]) => ({name, metadata: value.metadata || {}}));
    return {keys, list_complete: true};
  }
}

const environment = async ({reviewHash = true} = {}) => ({
  DOT_INBOX: new FakeKV(),
  DOT_DELIVERY_TOKEN_HASH: await dotInboxHash(delivery),
  ...(reviewHash ? {DOT_REVIEW_TOKEN_HASH: await dotInboxHash(review)} : {}),
});

function request(method, {token = null, path = VISITOR_FEEDBACK_PATH, body, headers = {}} = {}) {
  return new Request(`${base}${path}`, {
    method,
    headers: {
      ...(token ? {Authorization: `Bearer ${token}`} : {}),
      ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
      ...headers,
    },
    ...(body === undefined ? {} : {body: typeof body === 'string' ? body : JSON.stringify(body)}),
  });
}

function seed(env, record) {
  const reverse = String(9_007_199_254_740_991 - Date.parse(record.created_at)).padStart(16, '0');
  const key = `visitor-feedback:item:${reverse}:${record.id}`;
  env.DOT_INBOX.values.set(key, {raw: JSON.stringify(record), metadata: {id: record.id, created_at: record.created_at, read: record.read ? '1' : '0'}});
  env.DOT_INBOX.values.set(`visitor-feedback:id:${record.id}`, {raw: key, metadata: {}});
  return key;
}

test('a visitor can leave feedback without a review token, and only the host can read it', async () => {
  const env = await environment();
  env.PUBLIC_FEED = {get() { throw Error('must not read public storage'); }, put() { throw Error('must not write public storage'); }};
  const created = await handleVisitorFeedbackRequest(request('POST', {
    token: delivery,
    body: {text: '  首页有点挤\n\n\n想安静一点  ', contact: ' levi@example.com '},
    headers: {'User-Agent': 'LeviFlowTest/1.0', 'CF-Connecting-IP': '203.0.113.8'},
  }), env);
  assert.equal(created.status, 201);
  const receipt = await created.json();
  assert.match(receipt.id, /^[0-9a-f-]{36}$/);
  assert.match(receipt.created_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(JSON.stringify(receipt).includes('首页有点挤'), false);
  const stored = [...env.DOT_INBOX.values.keys()].filter(key => key.startsWith('visitor-feedback:item:'));
  assert.equal(stored.length, 1);
  const record = JSON.parse(env.DOT_INBOX.values.get(stored[0]).raw);
  assert.equal(record.text, '首页有点挤\n\n想安静一点');
  assert.equal(record.contact, 'levi@example.com');
  assert.equal(record.user_agent, 'LeviFlowTest/1.0');
  assert.equal(record.read, false);
  assert.equal(stored[0].endsWith(`:${record.id}`), true);
  assert.equal([...env.DOT_INBOX.values.keys()].some(key => key.startsWith('pending:')), false);
  assert.equal(JSON.stringify(record).includes(delivery), false);
  assert.equal(JSON.stringify(record).includes(review), false);
  const anonymous = await handleVisitorFeedbackRequest(request('GET'), env);
  const wrong = await handleVisitorFeedbackRequest(request('GET', {token: delivery}), env);
  assert.equal(anonymous.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal(anonymous.headers.get('WWW-Authenticate'), 'Bearer realm="visitor-feedback"');
  const listed = await handleVisitorFeedbackRequest(request('GET', {token: review}), env);
  assert.equal(listed.status, 200);
  const page = await listed.json();
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].text, '首页有点挤\n\n想安静一点');
  assert.equal(page.truncated, false);
  const config = await fs.readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(config, /\/api\/visitor-feedback/);
});

test('feedback is listed newest first and stays out of the pending queue', async () => {
  const env = await environment();
  seed(env, {id: feedbackId, created_at: '2026-10-16T01:00:00.000Z', text: '较早的一句', contact: '', user_agent: '', read: false});
  seed(env, {id: newerId, created_at: '2026-10-17T02:00:00.000Z', text: '较新的一句', contact: '@levi', user_agent: 'Agent', read: false});
  env.DOT_INBOX.values.set('visitor-feedback:rate:abc', {raw: '{"count":1,"reset":1}', metadata: {}});
  env.DOT_INBOX.values.set('pending:example', {raw: '{"url":"https://x.com/example/status/1","status":"pending"}', metadata: {}});
  const listed = await (await handleVisitorFeedbackRequest(request('GET', {token: review}), env)).json();
  assert.deepEqual(listed.items.map(item => item.text), ['较新的一句', '较早的一句']);
  assert.equal(JSON.stringify(listed).includes('pending'), false);
  assert.equal(JSON.stringify(listed).includes('rate'), false);
  const read = await handleVisitorFeedbackRequest(request('POST', {token: review, path: VISITOR_FEEDBACK_READ_PATH, body: {id: newerId}}), env);
  assert.equal(read.status, 200);
  assert.equal((await read.json()).read, true);
  const again = await (await handleVisitorFeedbackRequest(request('GET', {token: review}), env)).json();
  assert.equal(again.items[0].read, true);
  assert.equal(again.items[1].read, false);
  const missing = await handleVisitorFeedbackRequest(request('POST', {token: review, path: VISITOR_FEEDBACK_READ_PATH, body: {id: '33333333-3333-4333-8333-333333333333'}}), env);
  assert.equal(missing.status, 404);
});

test('public submit is limited, same-origin, and does not require the review secret', async () => {
  const open = await environment({reviewHash: false});
  const accepted = await handleVisitorFeedbackRequest(request('POST', {body: {text: '只要正文'}, headers: {'CF-Connecting-IP': '203.0.113.9'}}), open);
  assert.equal(accepted.status, 201);
  assert.equal((await handleVisitorFeedbackRequest(request('GET', {token: review}), open)).status, 503);
  const env = await environment();
  const before = env.DOT_INBOX.writes.length;
  for (const [path, body, headers, status] of [
    [VISITOR_FEEDBACK_PATH, {text: ''}, {}, 400],
    [VISITOR_FEEDBACK_PATH, {text: '好', extra: true}, {}, 400],
    [VISITOR_FEEDBACK_PATH, {text: '好'.repeat(1001)}, {}, 400],
    [VISITOR_FEEDBACK_PATH, {text: '好', contact: '换行\n不行'}, {}, 400],
    [`${VISITOR_FEEDBACK_PATH}?token=${review}`, {text: '好'}, {}, 400],
  ]) {
    const response = await handleVisitorFeedbackRequest(request('POST', {path, body, headers}), env);
    assert.equal(response.status, status, path);
  }
  const cross = await handleVisitorFeedbackRequest(request('POST', {body: {text: '别站'}, headers: {Origin: 'https://evil.example'}}), env);
  assert.equal(cross.status, 403);
  const fetched = await handleVisitorFeedbackRequest(request('POST', {body: {text: '跨站'}, headers: {'Sec-Fetch-Site': 'cross-site'}}), env);
  assert.equal(fetched.status, 403);
  assert.equal(env.DOT_INBOX.writes.length, before);
  for (let count = 0; count < VISITOR_FEEDBACK_RATE_LIMIT; count += 1) {
    const response = await handleVisitorFeedbackRequest(request('POST', {body: {text: `第${count}条`}, headers: {'CF-Connecting-IP': '203.0.113.10'}}), env);
    assert.equal(response.status, 201);
  }
  const limited = await handleVisitorFeedbackRequest(request('POST', {body: {text: '太多了'}, headers: {'CF-Connecting-IP': '203.0.113.10'}}), env);
  assert.equal(limited.status, 429);
  assert.match(limited.headers.get('Retry-After'), /^\d+$/);
  const other = await handleVisitorFeedbackRequest(request('POST', {body: {text: '换一个地址'}, headers: {'CF-Connecting-IP': '203.0.113.11'}}), env);
  assert.equal(other.status, 201);
  assert.equal((await handleVisitorFeedbackRequest(request('DELETE'), env)).status, 405);
});

test('the preview worker accepts feedback before static assets', async () => {
  const env = await environment();
  env.ASSETS = {fetch: async () => { throw Error('assets must not see feedback'); }};
  const response = await worker.fetch(request('POST', {body: {text: '从公开页发来'}}), env);
  assert.equal(response.status, 201);
  const listed = await worker.fetch(request('GET', {token: review}), env);
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).items[0].text, '从公开页发来');
  assert.equal(await handleVisitorFeedbackRequest(new Request(`${base}/other`), env), null);
});
