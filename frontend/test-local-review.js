import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { createFeedServer } from './serve.js';
import { PUBLIC_FILES } from './public-build.mjs';
import { decidePendingForLocalReview, launchOpenPath, listFeedbackForLocalReview, listPendingForLocalReview, loadReviewToken, markFeedbackReadForLocalReview } from './local-review.js';

const token = 'r'.repeat(40);
const postUrl = 'https://x.com/example/status/2108148604447883999';
const origin = 'https://review.example.test';

test('the local review credential comes from the environment or the gitignored file', () => {
  assert.equal(loadReviewToken({env:{DOT_REVIEW_TOKEN:token}, root:'/none', readFileSync() { throw Object.assign(Error('missing'), {code:'ENOENT'}); }}), token);
  assert.equal(loadReviewToken({env:{}, root:'/proj', readFileSync(file) {
    assert.match(String(file), /\.local[/\\]dot-review-token$/);
    return `\n${token}\n`;
  }}), token);
  assert.equal(loadReviewToken({env:{DOT_REVIEW_TOKEN:'short'}, root:'/proj', readFileSync() { return token; }}), token);
  assert.equal(loadReviewToken({env:{DOT_REVIEW_TOKEN:'not a token'}, root:'/proj', readFileSync() { return 'still bad'; }}), '');
  assert.equal(launchOpenPath('/review-admin'), '/review-admin');
  assert.equal(launchOpenPath('https://evil.example/review-admin'), '/');
  assert.equal(launchOpenPath('/review-admin?token=secret'), '/');
});

test('the local proxy sends the server review code and never returns it', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({url, authorization:options.headers.Authorization, method:options.method, body:options.body});
    assert.equal(String(url).includes(token), false);
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    if (options.method === 'POST') {
      return new Response(JSON.stringify({url:postUrl, status:'approved', published:true}), {status:200, headers:{'Content-Type':'application/json'}});
    }
    const cursor = new URL(url).searchParams.get('cursor');
    if (!cursor) {
      return new Response(JSON.stringify({items:[{id:'kosx-1', url:postUrl, status:'pending', note:'文章卡·收藏5/点赞18·Levi样例·收藏偏低但类型优先'}], next_cursor:'page-2'}), {status:200, headers:{'Content-Type':'application/json'}});
    }
    return new Response(JSON.stringify({items:[{id:'kosx-2', url:'https://x.com/example/status/2108148604447884002', status:'pending', text:'教程·可执行提示词·互动尚低'}], next_cursor:null}), {status:200, headers:{'Content-Type':'application/json'}});
  };
  const listed = await listPendingForLocalReview({token, origin, fetchImpl});
  assert.equal(listed.status, 200);
  assert.equal(listed.body.items.length, 2);
  assert.equal(JSON.stringify(listed).includes(token), false);
  assert.deepEqual(calls.map(call => call.url), [`${origin}/api/dot/pending`, `${origin}/api/dot/pending?cursor=page-2`]);
  const missing = await listPendingForLocalReview({token:'', origin, fetchImpl});
  assert.equal(missing.status, 503);
  assert.match(missing.body.message, /不会让你在浏览器里粘贴接收码/);
  assert.equal(calls.length, 2);
  const rejected = await decidePendingForLocalReview({token, origin, fetchImpl, input:{url:postUrl, status:'approved', leaked:token}});
  assert.equal(rejected.status, 400);
  assert.equal(calls.length, 2);
  const decided = await decidePendingForLocalReview({token, origin, fetchImpl, input:{url:postUrl, status:'rejected'}});
  assert.equal(decided.body.status, 'approved');
  assert.equal(JSON.stringify(decided).includes(token), false);
  assert.equal(calls.at(-1).url, `${origin}/api/dot/pending/decision`);
  assert.deepEqual(JSON.parse(calls.at(-1).body), {url:postUrl, status:'rejected'});
  const leaked = await listPendingForLocalReview({token, origin, fetchImpl:async () => new Response(JSON.stringify({items:[], next_cursor:null, echo:token}), {status:200, headers:{'Content-Type':'application/json'}})});
  assert.equal(leaked.status, 502);
  assert.equal(JSON.stringify(leaked).includes(token), false);
});

test('the local admin page lists and decides without a browser token, and the public worker has no such route', async t => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({url:String(url), authorization:options.headers.Authorization, method:options.method, body:options.body});
    if (options.method === 'POST') {
      return new Response(JSON.stringify({url:postUrl, status:'approved', published:true}), {status:200, headers:{'Content-Type':'application/json'}});
    }
    return new Response(JSON.stringify({items:[{id:'kosx-1', url:postUrl, status:'pending', author_handle:'example'}], next_cursor:null}), {status:200, headers:{'Content-Type':'application/json'}});
  };
  const server = createFeedServer({
    service:{current:async () => ({mode:'live', items:[]}), refresh:async () => ({mode:'live', items:[]})},
    review:{token, origin, fetch:fetchImpl},
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const request = (path, method = 'GET', headers = {}, body) => new Promise((resolve, reject) => {
    const req = http.request({hostname:'127.0.0.1', port, path, method, headers, agent:false}, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => resolve({status:res.statusCode, body:raw, type:res.headers['content-type'] || ''}));
    });
    req.on('error', reject);
    if (body) req.end(body); else req.end();
  });
  const page = await request('/review-admin');
  assert.equal(page.status, 200);
  assert.match(page.type, /text\/html/);
  assert.match(page.body, /本机过审/);
  assert.match(page.body, /提交日/);
  assert.match(page.body, /北京时间今天或昨天/);
  assert.match(page.body, /\/src\/reviewAdminPage\.js/);
  assert.match(page.body, /data-review-refresh/);
  assert.match(page.body, /约每 30 秒自动更新/);
  assert.match(page.body, /id="visitor-feedback"/);
  assert.match(page.body, /不进待过审队列/);
  assert.ok(page.body.indexOf('正在读取本机过审') < page.body.indexOf('id="visitor-feedback"'));
  assert.doesNotMatch(page.body, /type="password"|文章卡·收藏|互动尚低|DOT_REVIEW_TOKEN|只列出原帖日期|正在读取公开待过审/);
  const pending = await request('/api/local-review/pending', 'GET', {Authorization:`Bearer ${'a'.repeat(40)}`});
  assert.equal(pending.status, 200);
  assert.equal(JSON.parse(pending.body).items[0].url, postUrl);
  assert.equal(pending.body.includes(token), false);
  assert.equal(calls[0].authorization, `Bearer ${token}`);
  assert.equal(calls[0].authorization.includes('a'.repeat(40)), false);
  const blocked = await request('/api/local-review/decision', 'POST', {'Content-Type':'application/json'}, JSON.stringify({url:postUrl, status:'approved'}));
  assert.equal(blocked.status, 403);
  assert.equal(calls.length, 1);
  const decision = await request('/api/local-review/decision', 'POST', {
    'Content-Type':'application/json', 'X-Personal-Feed':'1', Origin:`http://127.0.0.1:${port}`,
  }, JSON.stringify({url:postUrl, status:'approved', review_type:'文章'}));
  assert.equal(decision.status, 200);
  assert.equal(JSON.parse(decision.body).published, true);
  assert.equal(decision.body.includes(token), false);
  assert.deepEqual(JSON.parse(calls[1].body), {url:postUrl, status:'approved', review_type:'文章'});
  assert.equal((await request('/api/local-review/pending?token=secret')).status, 400);
  assert.equal((await request('/api/local-review/pending', 'GET', {Host:'attacker.invalid'})).status, 403);
  assert.equal((await request('/api/local-review/decision', 'POST', {Origin:'https://outside.invalid', 'Content-Type':'application/json', 'X-Personal-Feed':'1'})).status, 403);
  const closed = createFeedServer({
    service:{current:async () => ({mode:'live', items:[]}), refresh:async () => ({mode:'live', items:[]})},
    review:{token:'', origin, fetch:fetchImpl},
  });
  await new Promise(resolve => closed.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => closed.close(resolve)));
  const closedPort = closed.address().port;
  const unavailable = await new Promise((resolve, reject) => {
    const req = http.request({hostname:'127.0.0.1', port:closedPort, path:'/api/local-review/pending', agent:false}, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => resolve({status:res.statusCode, body:raw}));
    });
    req.on('error', reject); req.end();
  });
  assert.equal(unavailable.status, 503);
  assert.match(unavailable.body, /review_credential_missing/);
  assert.equal(unavailable.body.includes(token), false);
  assert.equal(calls.length, 2);
  const worker = await fs.readFile(new URL('../worker.js', import.meta.url), 'utf8');
  assert.equal(worker.includes('review-admin'), false);
  assert.equal(worker.includes('local-review'), false);
  assert.equal(PUBLIC_FILES.includes('review-admin.html'), false);
  assert.equal(PUBLIC_FILES.includes('src/reviewAdminPage.js'), false);
  assert.equal(PUBLIC_FILES.includes('local-review.js'), false);
  const adminScript = await fs.readFile(new URL('./src/reviewAdminPage.js', import.meta.url), 'utf8');
  assert.match(adminScript, /mode:'local'/);
  assert.doesNotMatch(adminScript, /Authorization|Bearer|type="password"|只列出原帖日期/);
  const publicQueue = await fs.readFile(new URL('./src/reviewQueueView.js', import.meta.url), 'utf8');
  assert.match(publicQueue, /连接接收码后/);
  assert.match(publicQueue, /pendingReviewItems/);
  assert.match(publicQueue, /pendingLocalReviewItems/);
  assert.doesNotMatch(publicQueue, /review-queue-heat|收藏信号强|文章卡/);
});

test('local feedback is a separate host read and never accepts a browser review token', async t => {
  const feedbackId = '11111111-1111-4111-8111-111111111111';
  const createdAt = '2026-10-17T02:30:00.000Z';
  const note = {id:feedbackId, created_at:createdAt, text:'首页有点挤', contact:'@levi', user_agent:'TestAgent', read:false};
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({url:String(url), authorization:options.headers.Authorization, method:options.method || 'GET', body:options.body});
    assert.equal(String(url).includes(token), false);
    if (options.method === 'POST') {
      return new Response(JSON.stringify({...note, read:true}), {status:200, headers:{'Content-Type':'application/json'}});
    }
    return new Response(JSON.stringify({items:[note], truncated:false}), {status:200, headers:{'Content-Type':'application/json'}});
  };
  const listed = await listFeedbackForLocalReview({token, origin, fetchImpl});
  assert.equal(listed.status, 200);
  assert.equal(listed.body.items[0].text, '首页有点挤');
  assert.equal(listed.body.items[0].read, false);
  assert.equal(JSON.stringify(listed).includes(token), false);
  assert.equal(calls[0].url, `${origin}/api/visitor-feedback`);
  assert.equal(calls[0].authorization, `Bearer ${token}`);
  const missing = await listFeedbackForLocalReview({token:'', origin, fetchImpl});
  assert.equal(missing.status, 503);
  assert.equal(calls.length, 1);
  const leaked = await listFeedbackForLocalReview({token, origin, fetchImpl:async () => new Response(JSON.stringify({items:[{...note, text:token}], truncated:false}), {status:200, headers:{'Content-Type':'application/json'}})});
  assert.equal(leaked.status, 502);
  assert.equal(JSON.stringify(leaked).includes(token), false);
  const marked = await markFeedbackReadForLocalReview({token, origin, fetchImpl, input:{id:feedbackId}});
  assert.equal(marked.status, 200);
  assert.equal(marked.body.read, true);
  assert.equal(calls.at(-1).url, `${origin}/api/visitor-feedback/read`);
  assert.deepEqual(JSON.parse(calls.at(-1).body), {id:feedbackId});
  const server = createFeedServer({
    service:{current:async () => ({mode:'live', items:[]}), refresh:async () => ({mode:'live', items:[]})},
    review:{token, origin, fetch:fetchImpl},
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const request = (path, method = 'GET', headers = {}, body) => new Promise((resolve, reject) => {
    const req = http.request({hostname:'127.0.0.1', port, path, method, headers, agent:false}, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => resolve({status:res.statusCode, body:raw}));
    });
    req.on('error', reject);
    if (body) req.end(body); else req.end();
  });
  const before = calls.length;
  const browserToken = 'a'.repeat(40);
  const page = await request('/api/local-review/feedback', 'GET', {Authorization:`Bearer ${browserToken}`});
  assert.equal(page.status, 200);
  assert.equal(JSON.parse(page.body).items[0].text, '首页有点挤');
  assert.equal(page.body.includes(token), false);
  assert.equal(page.body.includes(browserToken), false);
  assert.equal(calls.at(-1).authorization, `Bearer ${token}`);
  const blocked = await request('/api/local-review/feedback/read', 'POST', {'Content-Type':'application/json'}, JSON.stringify({id:feedbackId}));
  assert.equal(blocked.status, 403);
  assert.equal(calls.length, before + 1);
  const read = await request('/api/local-review/feedback/read', 'POST', {
    'Content-Type':'application/json', 'X-Personal-Feed':'1', Origin:`http://127.0.0.1:${port}`,
  }, JSON.stringify({id:feedbackId, status:'approved'}));
  assert.equal(read.status, 400);
  assert.equal(calls.length, before + 1);
  const done = await request('/api/local-review/feedback/read', 'POST', {
    'Content-Type':'application/json', 'X-Personal-Feed':'1', Origin:`http://127.0.0.1:${port}`,
  }, JSON.stringify({id:feedbackId}));
  assert.equal(done.status, 200);
  assert.equal(JSON.parse(done.body).read, true);
  assert.equal(done.body.includes(token), false);
  assert.equal((await request('/api/local-review/feedback?token=secret')).status, 400);
});
