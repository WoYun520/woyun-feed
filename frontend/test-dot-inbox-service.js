import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { DOT_IMPORT_MAX_BYTES } from './src/dotCandidates.js';
import { DOT_INBOX_PATH,DOT_INBOX_TTL_SECONDS,canonicalDotPayload,dotInboxHash,handleDotInboxRequest } from '../dot-inbox-service.js';
import worker from '../worker.js';

if (!globalThis.crypto) globalThis.crypto=webcrypto;
const delivery='test-delivery-credential-1234567890',review='test-review-credential-0987654321';
const base='https://feed.example.test';
const date='2026-10-09T09:05:22Z';
const item=()=>({category:'tutorial',original_url:'https://x.com/example/status/2108148604447883464',author_handle:'example',published_at:null,
  title_zh:'检查用素材标题',summary_zh:'检查用摘要，不是真实使用报告。',bookmark_count:380,like_count:251,view_count:null,
  metric_display:'收藏380；点赞251；浏览7.3万',metrics_checked_at:'2026-10-09T03:28:17Z',metrics_source_url:'https://x.com/example/status/2108148604447883464',
  read_scope:'main_post',selection_reason:'检查收件箱投递。',my_angle:'先试用再判断。',unknowns:['未实测','发布时间时区未知']});
const batch=()=>({format:'woyun-feed:candidates',version:1,collector:'Dot',collected_at:date,items:[item()],alternatives:[]});

class FakeKV {
  constructor() {this.values=new Map();this.writes=[];this.lists=[];this.reads=[];this.nextPage=null;}
  async get(key) {this.reads.push(key);return this.values.get(key)?.raw ?? null;}
  async put(key,raw,options) {this.writes.push({key,raw,options});this.values.set(key,{raw,metadata:options.metadata});}
  async list(options) {
    this.lists.push(options);
    if (options.cursor==='broken-cursor') throw Error('Invalid cursor: 400');
    if (this.nextPage) return this.nextPage;
    return {keys:[...this.values].filter(([key])=>key.startsWith(options.prefix)).map(([name,value])=>({name,metadata:value.metadata})),list_complete:true};
  }
}
const environment=async()=>({DOT_INBOX:new FakeKV(),DOT_DELIVERY_TOKEN_HASH:await dotInboxHash(delivery),DOT_REVIEW_TOKEN_HASH:await dotInboxHash(review)});
function request(method='GET',{token=method==='POST' ? delivery : review,path=DOT_INBOX_PATH,body,headers={}}={}) {
  return new Request(`${base}${path}`,{method,headers:{...(token===null ? {} : {Authorization:`Bearer ${token}`}),...(body!==undefined ? {'Content-Type':'application/json'} : {}),...headers},...(body===undefined ? {} : {body:typeof body==='string' ? body : JSON.stringify(body)})});
}
const submit=(env,payload=batch(),options={})=>handleDotInboxRequest(request('POST',{body:payload,...options}),env);

test('inbox fails closed for missing configuration and identical read/write credentials',async()=>{
  for (const edit of [env=>delete env.DOT_INBOX,env=>delete env.DOT_DELIVERY_TOKEN_HASH,env=>delete env.DOT_REVIEW_TOKEN_HASH,env=>env.DOT_DELIVERY_TOKEN_HASH=env.DOT_REVIEW_TOKEN_HASH,env=>env.DOT_REVIEW_TOKEN_HASH='not-a-hash']) {
    const env=await environment();edit(env);
    const response=await handleDotInboxRequest(request(),env);
    assert.equal(response.status,503);assert.equal((await response.json()).error,'inbox_unavailable');
  }
});

test('anonymous, query-key and wrong-scope requests cannot read or write private data',async()=>{
  const env=await environment();
  for (const [method,token] of [['GET',null],['GET',delivery],['POST',review],['POST','wrong-private-credential-123456']]) {
    const response=await handleDotInboxRequest(request(method,{token,...(method==='POST' ? {body:batch()} : {})}),env);
    assert.equal(response.status,401);assert.equal(response.headers.get('WWW-Authenticate'),'Bearer realm="dot-inbox"');
    const result=await response.text();assert.equal(result.includes(delivery),false);assert.equal(result.includes(review),false);
  }
  assert.equal((await handleDotInboxRequest(request('GET',{token:null,path:`${DOT_INBOX_PATH}?token=${review}`}),env)).status,401);
  assert.equal((await handleDotInboxRequest(request('GET',{path:`${DOT_INBOX_PATH}?token=provided`}),env)).status,400);
  assert.equal(env.DOT_INBOX.reads.length,0);assert.equal(env.DOT_INBOX.writes.length,0);
});

test('new delivery preserves exact source values, stores only private KV and gets 30-day expiry',async()=>{
  const env=await environment(),payload=batch(),before=structuredClone(payload);
  env.PUBLIC_FEED={get:()=>{throw Error('must not read public storage');},put:()=>{throw Error('must not write public storage');}};
  const response=await submit(env,payload),receipt=await response.json();
  assert.equal(response.status,201);assert.equal(receipt.existing,false);assert.equal(receipt.item_count,1);
  assert.match(receipt.id,/^[a-f0-9]{64}$/);assert.equal(receipt.id,await dotInboxHash(canonicalDotPayload(payload)));
  const [write]=env.DOT_INBOX.writes;
  assert.equal(write.key,`batch:${receipt.id}`);assert.equal(write.options.expirationTtl,DOT_INBOX_TTL_SECONDS);
  assert.deepEqual(write.options.metadata,{id:receipt.id,received_at:receipt.received_at,item_count:1,collector:'Dot',collected_at:date});
  assert.deepEqual(JSON.parse(write.raw),{id:receipt.id,received_at:receipt.received_at,payload:before});
  assert.deepEqual(payload,before);assert.equal(write.raw.includes(delivery),false);assert.equal(write.raw.includes(review),false);
  assert.equal(JSON.parse(write.raw).payload.items[0].view_count,null);assert.equal(JSON.parse(write.raw).payload.items[0].published_at,null);
});

test('same content with reordered keys and whitespace is idempotent and does not extend expiry',async()=>{
  const env=await environment(),payload=batch(),first=await (await submit(env,payload)).json();
  const reordered=Object.fromEntries(Object.entries(payload).reverse());
  reordered.items=payload.items.map(entry=>Object.fromEntries(Object.entries(entry).reverse()));
  const response=await submit(env,JSON.stringify(reordered,null,4)),retry=await response.json();
  assert.equal(response.status,200);assert.equal(retry.id,first.id);assert.equal(retry.received_at,first.received_at);
  assert.equal(retry.existing,true);assert.equal(env.DOT_INBOX.values.size,1);assert.equal(env.DOT_INBOX.writes.length,1);
  const changed=batch();changed.items[0].unknowns.push('新增来源未知项');
  assert.equal((await submit(env,changed)).status,201);assert.equal(env.DOT_INBOX.values.size,2);
});

test('review lists metadata and reads one validated payload without write capability',async()=>{
  const env=await environment(),receipt=await (await submit(env)).json();
  const listResponse=await handleDotInboxRequest(request(),env),page=await listResponse.json();
  assert.equal(listResponse.status,200);assert.deepEqual(page,{batches:[env.DOT_INBOX.writes[0].options.metadata],next_cursor:null});
  assert.deepEqual(env.DOT_INBOX.lists[0],{prefix:'batch:',limit:50});assert.equal(JSON.stringify(page).includes('summary_zh'),false);
  const response=await handleDotInboxRequest(request('GET',{path:`${DOT_INBOX_PATH}/${receipt.id}`}),env),stored=await response.json();
  assert.equal(response.status,200);assert.deepEqual(stored.payload,batch());
  assert.equal((await handleDotInboxRequest(request('GET',{token:delivery,path:`${DOT_INBOX_PATH}/${receipt.id}`}),env)).status,401);
  assert.equal(env.DOT_INBOX.writes.length,1);
});

test('bounded cursor pagination returns next cursor and rejects malformed, duplicate and invalid cursor requests',async()=>{
  const env=await environment();env.DOT_INBOX.nextPage={keys:[],list_complete:false,cursor:'opaque-page-2'};
  assert.deepEqual(await (await handleDotInboxRequest(request(),env)).json(),{batches:[],next_cursor:'opaque-page-2'});
  await handleDotInboxRequest(request('GET',{path:`${DOT_INBOX_PATH}?cursor=opaque-page-2`}),env);
  assert.deepEqual(env.DOT_INBOX.lists[1],{prefix:'batch:',limit:50,cursor:'opaque-page-2'});
  for (const suffix of ['?cursor=','?cursor=first&cursor=second','?cursor=a%20b','?cursor='+ 'x'.repeat(2049),'?cursor=broken-cursor']) {
    const response=await handleDotInboxRequest(request('GET',{path:DOT_INBOX_PATH+suffix}),env);
    assert.equal(response.status,400,suffix.slice(0,40));
  }
});

test('malformed, empty, extra, unsupported collectors and unsupported materials reject before storage',async()=>{
  const env=await environment();
  for (const invalid of ['not JSON','',JSON.stringify({}),JSON.stringify([])]) assert.equal((await submit(env,invalid)).status,400);
  for (const edit of [value=>value.status='featured',value=>value.password='private-value',value=>value.collector='Other',value=>value.version=2,value=>value.items[0].published_at='2026-10-09',value=>value.items[0].summary_zh='',value=>value.items[0].original_url+='?token=secret',value=>value.items[0].my_angle='sk-'+ 'a'.repeat(48),value=>value.items[0].verified=true]) {
    const payload=batch();edit(payload);assert.equal((await submit(env,payload)).status,400);
  }
  assert.equal(env.DOT_INBOX.writes.length,0);
  assert.equal((await submit(env,batch(),{headers:{'Content-Type':'text/plain'}})).status,415);
});

test('feedgrab delivery, retry and review retain real collector with the same private scoped permissions',async()=>{
  const env=await environment(),payload={...batch(),collector:'feedgrab'};
  Object.assign(payload.items[0],{bookmark_count:null,like_count:null,view_count:null});
  const response=await submit(env,payload),receipt=await response.json();assert.equal(response.status,201);
  assert.equal(env.DOT_INBOX.writes[0].options.metadata.collector,'feedgrab');
  const page=await (await handleDotInboxRequest(request(),env)).json();assert.equal(page.batches[0].collector,'feedgrab');
  const stored=await (await handleDotInboxRequest(request('GET',{path:`${DOT_INBOX_PATH}/${receipt.id}`}),env)).json();
  assert.deepEqual(stored.payload,payload);assert.equal(stored.payload.items[0].bookmark_count,null);
  const repeat=await submit(env,JSON.stringify(payload,null,2));assert.equal(repeat.status,200);assert.equal((await repeat.json()).existing,true);
  assert.equal((await handleDotInboxRequest(request('GET',{token:delivery,path:`${DOT_INBOX_PATH}/${receipt.id}`}),env)).status,401);
  assert.equal((await submit(env,payload,{token:review})).status,401);assert.equal(env.DOT_INBOX.writes.length,1);
});

test('different actual collectors remain distinct immutable batches and unknown names cannot bypass intake',async()=>{
  const env=await environment(),dot=await (await submit(env)).json(),feedgrab=await (await submit(env,{...batch(),collector:'feedgrab'})).json();
  assert.notEqual(dot.id,feedgrab.id);assert.equal(env.DOT_INBOX.values.size,2);
  for (const collector of ['FEEDGRAB','Feedgrab','Other','Dot ','feedgrab ']) assert.equal((await submit(env,{...batch(),collector})).status,400);
  assert.equal(env.DOT_INBOX.values.size,2);
});

test('content length and streaming bytes independently bound uploads to 2 MB',async()=>{
  const env=await environment();
  assert.equal((await submit(env,batch(),{headers:{'Content-Length':String(DOT_IMPORT_MAX_BYTES+1)}})).status,413);
  assert.equal((await submit(env,batch(),{headers:{'Content-Length':'unknown'}})).status,400);
  const body=new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(DOT_IMPORT_MAX_BYTES));controller.enqueue(new Uint8Array([32]));controller.close();}});
  const streamed=new Request(`${base}${DOT_INBOX_PATH}`,{method:'POST',headers:{Authorization:`Bearer ${delivery}`,'Content-Type':'application/json','Content-Length':'1'},body,duplex:'half'});
  const response=await handleDotInboxRequest(streamed,env);
  assert.equal(response.status,413);assert.equal(env.DOT_INBOX.writes.length,0);
});

test('invalid UTF-8 never silently replaces original bytes before preservation',async()=>{
  const env=await environment();
  const response=await handleDotInboxRequest(new Request(`${base}${DOT_INBOX_PATH}`,{method:'POST',headers:{Authorization:`Bearer ${delivery}`,'Content-Type':'application/json'},body:new Uint8Array([0xff,0xfe])}),env);
  assert.equal(response.status,400);assert.equal((await response.json()).error,'invalid_encoding');
});

test('same-origin and server clients work, but foreign and opaque Origins cannot access inbox',async()=>{
  const env=await environment();
  assert.equal((await handleDotInboxRequest(request('GET',{headers:{Origin:base}}),env)).status,200);
  assert.equal((await handleDotInboxRequest(request(),env)).status,200);
  for (const origin of ['https://other.example.test',base+'.evil.test','null','http://feed.example.test']) {
    const response=await submit(env,batch(),{headers:{Origin:origin}});
    assert.equal(response.status,403);assert.equal(response.headers.has('Access-Control-Allow-Origin'),false);
  }
  assert.equal(env.DOT_INBOX.writes.length,0);
});

test('method and batch ID boundaries cannot delete, curate or expose an absent batch',async()=>{
  const env=await environment();
  for (const method of ['DELETE','PUT','PATCH','HEAD','OPTIONS']) {
    const response=await handleDotInboxRequest(request(method),env);
    assert.equal(response.status,405);assert.equal(response.headers.get('Allow'),'GET, POST');
  }
  assert.equal((await handleDotInboxRequest(request('POST',{path:`${DOT_INBOX_PATH}/${'0'.repeat(64)}`,body:batch()}),env)).status,405);
  assert.equal((await handleDotInboxRequest(request('GET',{path:`${DOT_INBOX_PATH}/broken`}),env)).status,400);
  assert.equal((await handleDotInboxRequest(request('GET',{path:`${DOT_INBOX_PATH}/${'0'.repeat(64)}`}),env)).status,404);
});

test('corrupt or tampered stored batch and metadata fail closed instead of returning unchecked content',async()=>{
  const env=await environment(),receipt=await (await submit(env)).json(),key=`batch:${receipt.id}`;
  const old=env.DOT_INBOX.values.get(key),stored=JSON.parse(old.raw);stored.payload.items[0].summary_zh='篡改后正文';
  env.DOT_INBOX.values.set(key,{...old,raw:JSON.stringify(stored)});
  assert.equal((await handleDotInboxRequest(request('GET',{path:`${DOT_INBOX_PATH}/${receipt.id}`}),env)).status,503);
  assert.equal((await submit(env)).status,503);assert.equal(env.DOT_INBOX.writes.length,1);
  env.DOT_INBOX.values.set(key,{...old,metadata:{...old.metadata,collector:'fake'}});
  assert.equal((await handleDotInboxRequest(request(),env)).status,503);
});

test('private responses always disable cache, framing and type guessing without secret values or stack output',async()=>{
  const env=await environment();
  for (const response of [await submit(env),await handleDotInboxRequest(request(),env),await handleDotInboxRequest(request('GET',{token:null}),env)]) {
    assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
    assert.equal(response.headers.get('X-Frame-Options'),'DENY');assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
    const raw=await response.text();assert.equal(raw.includes(delivery),false);assert.equal(raw.includes(review),false);assert.equal(raw.includes(' at '),false);
  }
});

test('storage failure returns a generic retryable error and does not leak private exception text',async()=>{
  const env=await environment();env.DOT_INBOX.put=async()=>{throw Error('secret internal private storage details');};
  const response=await submit(env);
  assert.equal(response.status,503);assert.equal((await response.text()).includes('secret internal'),false);
});

test('worker handles API before assets while preserving public feed and static asset routes',async()=>{
  const assetCalls=[],publicCalls=[];
  const env={ASSETS:{fetch:async req=>{assetCalls.push(new URL(req.url).pathname);return new Response('public asset');}},PUBLIC_FEED:{get:async key=>{publicCalls.push(key);return '{"public":true}';}}};
  const closed=await worker.fetch(new Request(`${base}${DOT_INBOX_PATH}`),env);
  assert.equal(closed.status,503);assert.deepEqual(assetCalls,[]);assert.deepEqual(publicCalls,[]);
  const feed=await worker.fetch(new Request(`${base}/data/public-feed.json`),env);
  assert.equal(await feed.text(),'{"public":true}');assert.equal(publicCalls.length,1);
  const asset=await worker.fetch(new Request(`${base}/index.html`),env);
  assert.equal(await asset.text(),'public asset');assert.deepEqual(assetCalls,['/index.html']);
  assert.equal(await handleDotInboxRequest(new Request(`${base}/other`),env),null);
});
