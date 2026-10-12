import test from 'node:test';
import assert from 'node:assert/strict';
import { FEED_CHANNELS, mergeSourceItems, normalizeSubscription, parseSubscription } from './feed-sources.js';
import { normalizeRepositories } from './repository-normalize.js';
import { makePublicFeed } from './public-feed-data.js';
import { mergePublicSourceResults, refreshPublicFeed } from './cloud-feed-service.js';

const oldTime='2026-10-01T01:00:00.000Z';
const failureTime='2026-10-02T01:00:00.000Z';
const secondFailureTime='2026-10-02T13:00:00.000Z';
const recoveryTime='2026-10-03T01:00:00.000Z';
const sspai=FEED_CHANNELS.find(source=>source.id==='sspai');
const rss=id=>`<rss><channel><item><title>公开操作教程</title><link>https://sspai.com/post/${id}</link><description>公开订阅摘要</description></item></channel></rss>`;
const repository={id:123,full_name:'example/utility',description:'Public utility',stargazers_count:500,
  pushed_at:oldTime,created_at:oldTime,archived:false,fork:false};
const repositoryResponse=()=>new Response(JSON.stringify({items:[repository],incomplete_results:false}));
const seed=()=>makePublicFeed({schema_version:'0.3',mode:'live',
  sources:[{id:'github',status:'ok',last_success_at:oldTime},{id:sspai.id,status:'ok',last_success_at:oldTime}],
  items:mergeSourceItems({github:normalizeRepositories([repository],oldTime,'old-github-evidence'),
    sspai:normalizeSubscription(parseSubscription(rss(10001),sspai),sspai,oldTime,'old-rss-evidence').items}),
}, {publishedAt:oldTime});
const sourceOf=feed=>feed.sources.find(source=>source.id===sspai.id);
const sourceItems=feed=>feed.items.filter(item=>item.source_refs.includes(sspai.id));
const refresh=(previous,at,sourceRead,options={})=>refreshPublicFeed(previous,{definitions:[sspai],
  now:()=>new Date(at),retryDelayMs:0,
  fetchImpl:async(url,request)=>new URL(url).hostname==='api.github.com' ? repositoryResponse() : sourceRead(url,request),
  ...options});

test('consecutive failures keep exact evidence and dates, then genuine recovery resets the streak',async()=>{
  const previous=seed(), copy=structuredClone(previous), oldItems=sourceItems(previous);
  delete sourceOf(previous).consecutive_failures;
  delete sourceOf(previous).last_failure_at;
  const original=structuredClone(previous);
  const first=await refresh(previous,failureTime,async()=>new Response('',{status:404}));
  assert.equal(sourceOf(first).status,'failed');
  assert.equal(sourceOf(first).consecutive_failures,1);
  assert.equal(sourceOf(first).last_failure_at,failureTime);
  assert.equal(sourceOf(first).last_attempt_at,failureTime);
  assert.equal(sourceOf(first).last_success_at,oldTime);
  assert.equal(sourceOf(first).read_error,'upstream 404');
  assert.deepEqual(sourceItems(first),oldItems);
  assert.deepEqual(previous,original,'reading never rewrites the previous packet');

  const second=await refresh(first,secondFailureTime,async()=>new Response('<html>Unavailable</html>'));
  assert.equal(sourceOf(second).consecutive_failures,2);
  assert.equal(sourceOf(second).last_failure_at,secondFailureTime);
  assert.equal(sourceOf(second).last_success_at,oldTime);
  assert.equal(sourceOf(second).read_error,'source_format');
  assert.match(sourceOf(second).message,/订阅格式/);
  assert.deepEqual(sourceItems(second),oldItems);

  const recovered=await refresh(second,recoveryTime,async()=>new Response(rss(10002)));
  assert.equal(sourceOf(recovered).status,'ok');
  assert.equal(sourceOf(recovered).consecutive_failures,0);
  assert.equal(sourceOf(recovered).last_failure_at,secondFailureTime);
  assert.equal(sourceOf(recovered).last_success_at,recoveryTime);
  assert.ok(!('read_error' in sourceOf(recovered)),'old failure reason cannot survive a successful read');
  assert.equal(sourceItems(recovered)[0].original_url,'https://sspai.com/post/10002');
  assert.equal(sourceItems(recovered)[0].captured_at,recoveryTime);
  assert.equal(sourceItems(recovered)[0].source_links[0].captured_at,recoveryTime);

  const failedAgain=await refresh(recovered,'2026-10-03T13:00:00.000Z',async()=>new Response('',{status:404}));
  assert.equal(sourceOf(failedAgain).consecutive_failures,1,'recovery starts a new observed streak');
  assert.equal(sourceOf(failedAgain).last_success_at,recoveryTime);
  assert.deepEqual(sourceItems(failedAgain),sourceItems(recovered));
  assert.equal(sourceOf(copy).last_success_at,oldTime);
});

test('all sources failing keep actual content time and never declare retained items new',async()=>{
  const previous=seed(),copy=structuredClone(previous);
  const next=await refreshPublicFeed(previous,{definitions:[sspai],now:()=>new Date(failureTime),retryDelayMs:0,
    fetchImpl:async()=>new Response('',{status:404})});
  assert.equal(next.generated_at,oldTime);
  assert.equal(next.refresh.status,'failed');
  assert.deepEqual(next.refresh.new_item_ids,[]);
  assert.equal(next.refresh.new_count,0);
  assert.deepEqual(next.items,previous.items);
  for(const source of next.sources) {
    assert.equal(source.status,'failed');
    assert.equal(source.consecutive_failures,1);
    assert.equal(source.last_success_at,oldTime);
    assert.equal(source.last_failure_at,failureTime);
  }
  assert.deepEqual(previous,copy);
});

test('transport retries count as one failed refresh and successful retry clears the observed streak',async()=>{
  const previous=seed();let calls=0;
  const failed=await refresh(previous,failureTime,async()=>{calls++;return new Response('',{status:503});});
  assert.equal(calls,2,'the configured transient retry remains available');
  assert.equal(sourceOf(failed).consecutive_failures,1,'two attempts are one failed source refresh');
  calls=0;
  const recovered=await refresh(failed,recoveryTime,async()=>++calls===1
    ? new Response('',{status:503}) : new Response(rss(10002)));
  assert.equal(calls,2);
  assert.equal(sourceOf(recovered).status,'ok');
  assert.equal(sourceOf(recovered).consecutive_failures,0);
  assert.equal(sourceOf(recovered).last_failure_at,failureTime);
});

test('a source deadline is recorded as a timeout even when the upstream rejects with generic AbortError',async()=>{
  const previous=seed();let aborted=false;
  const next=await refresh(previous,failureTime,async(url,{signal})=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('aborted','AbortError'));},{once:true});
  }),{timeoutMs:20});
  assert.equal(aborted,true);
  assert.equal(sourceOf(next).read_error,'TimeoutError');
  assert.match(sourceOf(next).message,/超时|等待时间/);
  assert.equal(sourceOf(next).consecutive_failures,1);
  assert.equal(sourceOf(next).last_failure_at,failureTime);
  assert.equal(sourceOf(next).last_success_at,oldTime);
  assert.deepEqual(sourceItems(next),sourceItems(previous));
});

test('empty RSS and GitHub responses cannot reset failure health or erase old material',async()=>{
  const previous=seed();
  Object.assign(sourceOf(previous),{status:'failed',consecutive_failures:2,last_failure_at:failureTime,read_error:'upstream 404'});
  const emptyRSS=await refresh(previous,secondFailureTime,async()=>new Response('<rss><channel></channel></rss>'));
  assert.equal(sourceOf(emptyRSS).status,'failed');
  assert.equal(sourceOf(emptyRSS).read_error,'empty public list');
  assert.equal(sourceOf(emptyRSS).consecutive_failures,3);
  assert.equal(sourceOf(emptyRSS).last_success_at,oldTime);
  assert.deepEqual(sourceItems(emptyRSS),sourceItems(previous));
  const emptyGitHub=await refreshPublicFeed(previous,{definitions:[],now:()=>new Date(secondFailureTime),retryDelayMs:0,
    fetchImpl:async()=>new Response(JSON.stringify({items:[],incomplete_results:false}))});
  assert.equal(emptyGitHub.sources[0].status,'failed');
  assert.equal(emptyGitHub.sources[0].read_error,'empty public list');
  assert.equal(emptyGitHub.sources[0].last_success_at,oldTime);
  assert.ok(emptyGitHub.items.some(item=>item.repository_name==='example/utility'));
});

test('invalid legacy counters start at one and arbitrary private errors are not published',async()=>{
  for(const counter of [undefined,-1,'4',NaN,Number.MAX_SAFE_INTEGER+1]) {
    const previous=seed();sourceOf(previous).consecutive_failures=counter;
    const next=await refresh(previous,failureTime,async()=>{throw new Error('/Users/private/PRIVATE_FAILURE_CANARY');});
    assert.equal(sourceOf(next).consecutive_failures,1);
    assert.equal(sourceOf(next).read_error,'Error');
    assert.ok(!JSON.stringify(next).includes('PRIVATE_FAILURE_CANARY'));
    assert.deepEqual(sourceItems(next),sourceItems(previous));
  }
});

test('targeted maintenance recovery resets only the captured source and keeps unrelated failure health',()=>{
  const previous=seed();
  Object.assign(sourceOf(previous),{status:'failed',consecutive_failures:3,last_failure_at:failureTime,read_error:'upstream 404'});
  Object.assign(previous.sources.find(source=>source.id==='github'),{status:'failed',consecutive_failures:2,
    last_failure_at:secondFailureTime,read_error:'upstream 403'});
  const copy=structuredClone(previous);
  const items=normalizeSubscription(parseSubscription(rss(10002),sspai),sspai,recoveryTime,'recovery-evidence').items;
  const next=mergePublicSourceResults(previous,[{source:{...sspai,status:'ok',last_success_at:recoveryTime},items}],{publishedAt:recoveryTime});
  assert.equal(sourceOf(next).status,'ok');
  assert.equal(sourceOf(next).consecutive_failures,0);
  assert.equal(sourceOf(next).last_failure_at,failureTime);
  assert.ok(!('read_error' in sourceOf(next)));
  for(const field of ['status','consecutive_failures','last_failure_at','last_success_at','read_error'])
    assert.equal(next.sources.find(source=>source.id==='github')[field],previous.sources.find(source=>source.id==='github')[field],field);
  assert.deepEqual(previous,copy);
});
