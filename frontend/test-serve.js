import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createFeedServer } from './serve.js';
import { installationId } from './installation.js';
import { fileURLToPath } from 'node:url';

test('real HTTP routes: current cache, protected refresh, static files and path boundaries', async t => {
  let refreshes = 0;
  const server = createFeedServer({ service: { current: async () => ({ mode: 'live', items: [] }), refresh: async () => { refreshes++; return { mode: 'live', items: [] }; } } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const request = (path, method = 'GET', headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers, agent: false }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject); req.end();
  });
  assert.equal((await request('/')).status, 200);
  const health=await request('/api/health');
  assert.equal(health.status,200);assert.deepEqual(JSON.parse(health.body),{
    app:'personal-feed',protocol:1,installation_id:installationId(fileURLToPath(new URL('.',import.meta.url)))
  });
  assert.equal(refreshes,0);
  assert.equal((await request('/src/app.js')).status, 200);
  assert.equal((await request('/data/demo-feed.json')).status, 200);
  assert.equal((await request('/data/live-feed.json')).status, 404);
  assert.equal((await request('/%E0%A4%A')).status, 400);
  for (const path of ['/../README.md', '/%2e%2e/README.md', '/../../etc/passwd']) assert.equal((await request(path)).status, 403);
  const current = await request('/api/feed');
  assert.equal(current.status, 200);
  assert.equal(JSON.parse(current.body).mode, 'live');
  assert.equal((await request('/api/feed/refresh')).status, 405);
  assert.equal((await request('/api/feed/refresh', 'POST')).status, 403);
  assert.equal((await request('/api/feed/refresh', 'POST', { Origin: 'https://example.com', 'X-Personal-Feed': '1' })).status, 403);
  assert.equal((await request('/api/feed', 'GET', { Host: 'attacker.invalid' })).status, 403);
  assert.equal((await request('/api/feed/refresh', 'POST', { Origin: `http://127.0.0.1:${port}`, 'X-Personal-Feed': '1' })).status, 200);
  assert.equal(refreshes, 1);
});

test('research HTTP API rejects cross-origin, malformed and oversized requests without starting work', async t => {
  let starts=0;
  const server=createFeedServer({service:{},research:{start:async input=>{starts++;return {id:input.request_id,status:'reading'};},get:async id=>({id,status:'done'})}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}`;
  const headers={'Content-Type':'application/json','X-Personal-Feed':'1'};
  assert.equal((await fetch(url+'/api/research',{method:'POST',body:'{}'})).status,403);
  assert.equal((await fetch(url+'/api/research',{method:'POST',headers:{...headers,Origin:'https://outside.invalid'},body:'{}'})).status,403);
  assert.equal((await fetch(url+'/api/research',{method:'POST',headers,body:'no json'})).status,400);
  assert.equal((await fetch(url+'/api/research',{method:'POST',headers,body:JSON.stringify({question:'x'.repeat(18000)})})).status,413);
  assert.equal(starts,0);
  const good=await fetch(url+'/api/research',{method:'POST',headers,body:JSON.stringify({request_id:'test-id'})});
  assert.equal(good.status,202);assert.equal(starts,1);
  assert.equal((await (await fetch(url+'/api/research/test-id')).json()).status,'done');
});
