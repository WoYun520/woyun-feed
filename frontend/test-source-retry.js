import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSourceFetch, createRetryBudget, publicRetryBudget, publicRequestPlan } from './source-retry.js';
import { FeedService } from './feed-service.js';
import { MultiFeedService } from './multi-feed-service.js';
import { refreshPublicFeed } from './cloud-feed-service.js';
import { FEED_CHANNELS, normalizeSubscription, parseSubscription, mergeSourceItems } from './feed-sources.js';
import { normalizeRepositories } from './repository-normalize.js';
import { makePublicFeed } from './public-feed-data.js';

const beforeAt = '2026-10-01T01:00:00.000Z', afterAt = '2026-10-03T01:00:00.000Z';
const now = () => new Date(afterAt);
const sspai = FEED_CHANNELS.find(source => source.id === 'sspai'), v2ex = FEED_CHANNELS.find(source => source.id === 'v2ex-share');
const repo = id => ({id,full_name:`example/tool-${id}`,description:'Public utility',stargazers_count:200,archived:false,fork:false,pushed_at:afterAt});
const repositoryResponse = id => new Response(JSON.stringify({items:[repo(id)],incomplete_results:false}));
const rss = id => `<rss><channel><item><title>公开教程</title><link>https://sspai.com/post/${id}</link><description>公开摘要</description></item></channel></rss>`;
const atom = id => `<feed><entry><title>公开经验</title><link rel="alternate" href="https://www.v2ex.com/t/${id}"/></entry></feed>`;
const makeFetch = (impl, options = {}) => createSourceFetch(impl, {deadline:Date.now()+1000,attemptTimeoutMs:400,retryDelayMs:0,...options});
const seed = () => makePublicFeed({schema_version:'0.3',mode:'live',
  sources:[{id:'github',status:'ok',last_success_at:beforeAt},{id:'sspai',status:'ok',last_success_at:beforeAt}],
  items:mergeSourceItems({github:normalizeRepositories([repo(1)],beforeAt,'old-gh'),
    sspai:normalizeSubscription(parseSubscription(rss(10001),sspai),sspai,beforeAt,'old-rss').items})}, {publishedAt:beforeAt});
async function directory(t) {const dir=await fs.mkdtemp(path.join(os.tmpdir(),'feed-retry-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}

function delayedResponse(body, {signal, stage, delayMs = 120}) {
  if (stage === 'body') {
    let timer;
    return Promise.resolve(new Response(new ReadableStream({
      start(controller) {timer=setTimeout(()=>{controller.enqueue(new TextEncoder().encode(body));controller.close();},delayMs);},
      cancel() {clearTimeout(timer);},
    })));
  }
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason);};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve(new Response(body));},delayMs);
    if(signal.aborted) abort();else signal.addEventListener('abort',abort,{once:true});
  });
}

test('transient HTTP statuses get exactly one additional request and cancel the failed body', async () => {
  for (const status of [429,500,501,502,503,504,599]) {
    let calls=0,cancelled=false;
    const fetchSource=makeFetch(async () => ++calls === 1
      ? new Response(new ReadableStream({cancel(){cancelled=true;}}),{status,headers:{'Retry-After':'0'}})
      : new Response('recovered'));
    assert.equal(await (await fetchSource('https://example.com/feed')).text(),'recovered');
    assert.equal(calls,2);assert.equal(cancelled,true);
  }
  let calls=0;
  assert.equal((await makeFetch(async()=>{calls++;return new Response('',{status:503});})('https://example.com/feed')).status,503);
  assert.equal(calls,2,'a persistently failed source never starts a third request');
});

test('access failures, redirects and long Retry-After values never get an immediate retry', async () => {
  for (const status of [301,401,403,404,422,429]) {
    let calls=0;
    const fetchSource=makeFetch(async()=>{calls++;return new Response('',{status,headers:{'Retry-After':'60'}});});
    assert.equal((await fetchSource('https://example.com/feed')).status,status);assert.equal(calls,1);
  }
});

test('only recognized network failures are retried; parser, captcha, identity and private errors are not', async () => {
  for (const error of [new TypeError('fetch failed'),Object.assign(new Error('socket closed'),{code:'ECONNRESET'}),new Error('offline')]) {
    let calls=0;const fetchSource=makeFetch(async()=>{if(++calls===1)throw error;return new Response('ok');});
    assert.equal(await(await fetchSource('https://example.com/feed')).text(),'ok');assert.equal(calls,2);
  }
  for (const error of [new TypeError('invalid URL'),new SyntaxError('bad JSON'),new Error('captcha'),new Error('invalid author'),new Error('unsafe source text'),new Error('/Users/private/PRIVATE_CANARY')]) {
    let calls=0;await assert.rejects(makeFetch(async()=>{calls++;throw error;})('https://example.com/feed'),error);
    assert.equal(calls,1);
  }
});

test('a per-attempt timeout retries once within the original source deadline, including a body stall', async () => {
  for (const stage of ['headers','body']) {
    let calls=0,cancelled=false;
    const fetchSource=makeFetch(async()=>{
      if(++calls>1)return new Response('recovered');
      return stage==='headers' ? new Promise(()=>{})
        : new Response(new ReadableStream({cancel(){cancelled=true;}}));
    },{attemptTimeoutMs:15});
    assert.equal(await(await fetchSource('https://example.com/feed')).text(),'recovered');assert.equal(calls,2);
    if(stage==='body')assert.equal(cancelled,true);
  }
  let calls=0;const start=Date.now();
  await assert.rejects(makeFetch(async()=>{calls++;return new Promise(()=>{});},
    {deadline:Date.now()+25,attemptTimeoutMs:15})('https://example.com/feed'),error=>error.name==='TimeoutError');
  assert.equal(calls,2);assert.ok(Date.now()-start<150,'the deadline is not restarted for the second attempt');
});

test('outer cancellation stops backoff and pre-aborted or exhausted deadlines make zero requests', async () => {
  const controller=new AbortController();let calls=0;
  const pending=makeFetch(async()=>{calls++;setTimeout(()=>controller.abort(),5);return new Response('',{status:503});},
    {retryDelayMs:500})('https://example.com/feed',{signal:controller.signal});
  await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(calls,1);
  const stopped=new AbortController();stopped.abort();calls=0;
  await assert.rejects(makeFetch(async()=>{calls++;return new Response('no');})('https://example.com/feed',{signal:stopped.signal}),{name:'AbortError'});
  await assert.rejects(makeFetch(async()=>{calls++;return new Response('no');},{deadline:Date.now()-1})('https://example.com/feed'),{name:'TimeoutError'});
  assert.equal(calls,0);
  calls=0;
  assert.equal((await makeFetch(async()=>{calls++;return new Response('',{status:503});},
    {deadline:Date.now()+100,retryDelayMs:200})('https://example.com/feed')).status,503);assert.equal(calls,1);
});

test('response identity remains intact and oversized bodies are cancelled without retries', async () => {
  const redirected=new Response('public');Object.defineProperty(redirected,'redirected',{value:true});
  Object.defineProperty(redirected,'url',{value:'https://example.com/login'});
  const response=await makeFetch(async()=>redirected)('https://example.com/feed');
  assert.equal(response.redirected,true);assert.equal(response.url,'https://example.com/login');assert.equal(await response.text(),'public');
  let calls=0,cancelled=false;
  await assert.rejects(makeFetch(async()=>{calls++;return new Response(new ReadableStream({cancel(){cancelled=true;}}),
    {headers:{'Content-Length':String(2*1024*1024+1)}});})('https://example.com/feed'),/oversize/);
  assert.equal(calls,1);assert.equal(cancelled,true);
});

test('a shared retry budget limits extra requests while preserving every independent first read', async () => {
  const budget=createRetryBudget(2),calls=new Map();
  const fetchSource=makeFetch(async url=>{const count=(calls.get(url)||0)+1;calls.set(url,count);return new Response('',{status:count===1?503:200});},{retryBudget:budget});
  const results=await Promise.all(Array.from({length:6},(_,index)=>fetchSource('https://example.com/'+index)));
  assert.equal(calls.size,6);assert.equal([...calls.values()].reduce((n,v)=>n+v,0),8);assert.equal(budget.remaining,0);
  assert.equal(results.filter(response=>response.ok).length,2);
  assert.equal(publicRetryBudget([{format:'hackernews-api'},...Array.from({length:4},()=>({sopilot_category:'AI'})),...Array.from({length:27},()=>({format:'rss'}))]).remaining,2);
  assert.throws(()=>publicRetryBudget(Array.from({length:49},()=>({format:'rss'}))),/request budget exceeded/);
});

test('all configured subscriptions fit the schedule by bounding HN details while reserving retry and platform room',()=>{
  const plan=publicRequestPlan(FEED_CHANNELS);
  assert.equal(FEED_CHANNELS.filter(source=>source.creator_scope==='blog-feed').length,5);
  assert.deepEqual(plan,{hnMaxItems:9,normalRequests:48,retryRequests:1});
  assert.equal(publicRetryBudget(FEED_CHANNELS).remaining,1);
  assert.ok(plan.normalRequests+plan.retryRequests<=49);
  const small=publicRequestPlan([FEED_CHANNELS.find(source=>source.id==='hackernews')]);
  assert.equal(small.hnMaxItems,10,'smaller and local reads retain the established top-ten default');
  assert.throws(()=>publicRequestPlan(Array.from({length:48},()=>({format:'rss'}))),/request budget exceeded/);
});

test('full cloud batch attempts every configured source and at most 49 external requests including a retry',async()=>{
  const calls=[],topIds=Array.from({length:20},(_,index)=>1000+index),counts=new Map();
  const next=await refreshPublicFeed(seed(),{now,retryDelayMs:0,fetchImpl:async value=>{
    const url=new URL(value),key=url.href;calls.push(key);counts.set(key,(counts.get(key)||0)+1);
    if(url.hostname==='api.github.com') return counts.get(key)===1 ? new Response('',{status:503}) : repositoryResponse(2);
    if(url.hostname==='hacker-news.firebaseio.com') return new Response(JSON.stringify(url.pathname.endsWith('/topstories.json') ? topIds
      : {id:Number(url.pathname.match(/(\d+)\.json$/)[1]),type:'story',title:'Synthetic public HN item',score:1}));
    if(url.hostname==='sopilot.net' && url.pathname==='/zh/rank/tweets') {
      const category=url.searchParams.get('category') || 'all',page=Number(url.searchParams.get('page') || 1),index=page===1 ? 1 : 51;
      const props={locale:'zh',range:'24h',category,page,totalPages:2,hotTweets:[],risingTweets:[{
        id:'21056140239413169'+index,rank:index,text:'Synthetic public excerpt',authorName:'Synthetic author',screenName:'demo_author',
        sourceUrl:'https://x.com/demo_author/status/21056140239413169'+index,velocityScore:1}]};
      const packet=`6:${JSON.stringify(['$','$L39',null,props])}\n`;
      return new Response(`<main data-rank-page="true"></main><script>self.__next_f.push(${JSON.stringify([1,packet])})</script>`);
    }
    return new Response('',{status:403});
  }});
  assert.equal(calls.length,49,'48 normal requests and one bounded retry');
  assert.equal(calls.filter(url=>new URL(url).hostname==='hacker-news.firebaseio.com').length,10);
  assert.equal(next.items.filter(item=>item.source_refs.includes('hackernews')).length,9);
  assert.equal(next.sources.length,FEED_CHANNELS.length+1);
  for(const def of FEED_CHANNELS) assert.ok(calls.some(value=>{
    const called=new URL(value),configured=new URL(def.feed_url);
    return def.sopilot_category ? called.hostname===configured.hostname && called.pathname===configured.pathname
      && (called.searchParams.get('category') || 'all')===def.sopilot_category && Number(called.searchParams.get('page') || 1)===1
      : called.href===configured.href;
  }),def.id+' gets its first attempt');
  for(const def of FEED_CHANNELS.filter(source=>source.sopilot_category)) {
    const source=next.sources.find(row=>row.id===def.id);assert.equal(source.status,'ok');
    assert.equal(next.items.filter(item=>item.source_refs.includes(def.id)).length,2);
  }
});

test('local GitHub and RSS retry transport failures, write only final success, and retain old cache after exhausted attempts', async t => {
  const dataDir=await directory(t);let failed=false;const calls=new Map();
  const service=new MultiFeedService({dataDir,newsChannels:[sspai],now,cooldownMs:0,newsCooldownMs:0,retryDelayMs:0,
    fetchImpl:async url=>{const id=new URL(url).hostname,count=(calls.get(id)||0)+1;calls.set(id,count);
      if(failed || count===1)return new Response('',{status:503});
      return id==='api.github.com'?repositoryResponse(2):new Response(rss(10002));}});
  const good=await service.refresh();assert.equal(good.refresh.status,'ok');assert.deepEqual([...calls.values()],[2,2]);
  assert.equal((await fs.readdir(path.join(dataDir,'source-snapshots'))).length,2,'only successful final bodies become evidence');
  failed=true;calls.clear();const bad=await service.refresh();
  assert.equal(bad.refresh.status,'failed');assert.deepEqual(bad.items,good.items);assert.deepEqual([...calls.values()],[2,2]);
  assert.equal(bad.generated_at,good.generated_at);assert.equal((await fs.readdir(path.join(dataDir,'source-snapshots'))).length,2);
  assert.deepEqual((await new MultiFeedService({dataDir,newsChannels:[sspai]}).current()).items,good.items);
});

test('a malformed local GitHub response is not retried or written over previous successful evidence', async t => {
  const dataDir=await directory(t);let malformed=false,calls=0;
  const service=new FeedService({dataDir,now,cooldownMs:0,retryDelayMs:0,fetchImpl:async()=>{calls++;return malformed?new Response('invalid JSON'):repositoryResponse(1);}});
  const before=await service.refresh();malformed=true;calls=0;
  const after=await service.refresh();assert.equal(calls,1);assert.equal(after.refresh.status,'failed');assert.deepEqual(after.items,before.items);
});

test('cloud source retries are independent and failed sources keep their exact public evidence and success date', async () => {
  const previous=seed(),copy=structuredClone(previous),calls=new Map();
  const next=await refreshPublicFeed(previous,{definitions:[sspai,v2ex],now,retryDelayMs:0,fetchImpl:async url=>{
    const host=new URL(url).hostname,count=(calls.get(host)||0)+1;calls.set(host,count);
    if(host==='sspai.com')return new Response('',{status:503});
    if(host==='api.github.com')return count===1?new Response('',{status:502}):repositoryResponse(2);
    return new Response(atom(3));}});
  assert.equal(calls.get('sspai.com'),2);assert.equal(calls.get('api.github.com'),2);assert.equal(calls.get('www.v2ex.com'),1);
  const source=next.sources.find(row=>row.id==='sspai');assert.equal(source.status,'failed');assert.equal(source.last_success_at,beforeAt);
  assert.deepEqual(next.items.find(item=>item.source_refs.includes('sspai')),previous.items.find(item=>item.source_refs.includes('sspai')));
  assert.equal(next.sources.find(row=>row.id==='v2ex-share').status,'ok');assert.deepEqual(previous,copy);
});

test('a transient second SoPilot page retries only that page and publishes the complete source transaction', async () => {
  const source=FEED_CHANNELS.find(row=>row.id==='sopilot-ai'),calls=new Map();
  const page=number=>{
    const id=String(2105614023941316930n+BigInt(number));
    const props={locale:'zh',range:'24h',category:'AI',page:number,totalPages:2,hotTweets:[],
      risingTweets:[{id,rank:number,text:'一个工具的部署步骤。',authorName:'测试作者',screenName:'demo_author',
        sourceUrl:`https://x.com/demo_author/status/${id}`,tweetCreatedAt:afterAt,velocityScore:20}]};
    return `<main data-rank-page="true"></main><script>self.__next_f.push(${JSON.stringify([1,`6:${JSON.stringify(['$','$L39',null,props])}\n`])})</script>`;
  };
  const next=await refreshPublicFeed(seed(),{definitions:[source],now,retryDelayMs:0,fetchImpl:async url=>{
    const endpoint=new URL(url);if(endpoint.hostname==='api.github.com')return repositoryResponse(1);
    const number=Number(endpoint.searchParams.get('page')||1),count=(calls.get(number)||0)+1;calls.set(number,count);
    return number===2 && count===1 ? new Response('',{status:502}) : new Response(page(number));
  }});
  assert.equal(calls.get(1),1);assert.equal(calls.get(2),2);
  assert.equal(next.sources.find(row=>row.id===source.id).status,'ok');
  assert.equal(next.items.filter(item=>item.source_refs.includes(source.id)).length,2);
});

test('cloud parser or privacy failure never triggers retry or exposes raw private failure details', async () => {
  for(const body of ['<html>captcha</html>',rss(4).replace('公开摘要','/Users/private/PRIVATE_CANARY')]) {
    let calls=0;const next=await refreshPublicFeed(seed(),{definitions:[sspai],now,retryDelayMs:0,fetchImpl:async url=>{
      if(new URL(url).hostname==='api.github.com')return repositoryResponse(1);
      calls++;return new Response(body);}});
    assert.equal(calls,1);assert.equal(next.sources.find(row=>row.id==='sspai').status,'failed');
    if(body.startsWith('<html>')) {
      const source=next.sources.find(row=>row.id==='sspai');
      assert.equal(source.read_error,'source_format');
      assert.match(source.message,/没有返回可用的订阅格式/);
      assert.doesNotMatch(source.message,/超时|captcha/);
    }
    assert.ok(!JSON.stringify(next).includes('PRIVATE_CANARY'));
  }
});

test('concurrent cloud RSS reads accept slow headers and bodies within each complete source deadline', async () => {
  const calls=new Map();
  const next=await refreshPublicFeed(seed(),{definitions:[sspai,v2ex],now,timeoutMs:180,retryDelayMs:0,
    fetchImpl:async(value,{signal})=>{
      const host=new URL(value).hostname;calls.set(host,(calls.get(host)||0)+1);
      if(host==='api.github.com') return repositoryResponse(2);
      return delayedResponse(host==='sspai.com' ? rss(10002) : atom(3),
        {signal,stage:host==='sspai.com' ? 'headers' : 'body'});
    }});
  for(const source of [sspai,v2ex]) {
    assert.equal(next.sources.find(row=>row.id===source.id).status,'ok',source.id+' finishes inside its source deadline');
    assert.equal(calls.get(new URL(source.feed_url).hostname),1,'a slow valid source is not cancelled and restarted');
    assert.ok(next.items.some(item=>item.source_refs.includes(source.id)));
  }
  assert.equal(next.items.find(item=>item.source_refs.includes('sspai')).original_url,'https://sspai.com/post/10002');
  assert.equal(next.items.find(item=>item.source_refs.includes('v2ex-share')).original_url,'https://www.v2ex.com/t/3');
});

test('a cloud body that never completes stops at its source deadline and preserves exact previous evidence', async () => {
  const previous=seed(),expected=previous.items.find(item=>item.source_refs.includes('sspai')),copy=structuredClone(previous);
  let cancelled=0;const started=Date.now();
  const next=await refreshPublicFeed(previous,{definitions:[sspai],now,timeoutMs:120,retryDelayMs:0,
    fetchImpl:async value=>new URL(value).hostname==='api.github.com' ? repositoryResponse(2)
      : new Response(new ReadableStream({
        start(controller) {controller.enqueue(new TextEncoder().encode('<rss><channel>'));},
        cancel() {cancelled++;},
      }))});
  assert.ok(Date.now()-started<500,'a stalled body cannot hang the source batch indefinitely');
  assert.ok(cancelled>0,'the unfinished upstream body is cancelled');
  const source=next.sources.find(row=>row.id==='sspai');
  assert.equal(source.status,'failed');assert.equal(source.last_success_at,beforeAt);
  assert.equal(source.last_attempt_at,afterAt);
  assert.deepEqual(next.items.find(item=>item.id===expected.id),expected,'old text, dates and evidence remain unchanged');
  assert.deepEqual(previous,copy);
});

test('local RSS and GitHub accept slow headers and bodies within the original deadline without duplicate reads', async t => {
  for(const stage of ['headers','body']) await t.test(stage,async t=>{
    const dataDir=await directory(t),calls=new Map();
    const service=new MultiFeedService({dataDir,newsChannels:[sspai],now,cooldownMs:0,newsCooldownMs:0,
      timeoutMs:180,retryDelayMs:0,fetchImpl:async(value,{signal})=>{
        const host=new URL(value).hostname;calls.set(host,(calls.get(host)||0)+1);
        const body=host==='api.github.com' ? JSON.stringify({items:[repo(2)],incomplete_results:false}) : rss(10002);
        return delayedResponse(body,{signal,stage});
      }});
    const next=await service.refresh();
    assert.equal(next.refresh.status,'ok');
    for(const id of ['github','sspai']) {
      assert.equal(next.sources.find(source=>source.id===id).status,'ok');
      assert.equal(next.sources.find(source=>source.id===id).last_success_at,afterAt);
      assert.ok(next.items.some(item=>item.source_refs.includes(id)));
    }
    assert.deepEqual([...calls.values()],[1,1],'each valid source uses exactly one transport request');
  });
});
