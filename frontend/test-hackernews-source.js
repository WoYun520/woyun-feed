import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FEED_CHANNELS, normalizeSubscription, parseSubscription } from './feed-sources.js';
import { HN_TOP_URL, parseHackerNewsApi, readHackerNewsApi } from './hackernews-source-reader.js';
import { MultiFeedService } from './multi-feed-service.js';
import { refreshPublicFeed } from './cloud-feed-service.js';
const source = FEED_CHANNELS.find(s => s.id === 'hackernews'), AT='2026-10-02T11:00:00.000Z';
const ids=Array.from({length:30},(_,i)=>1000+i);
const story=(id,extra={})=>({id,type:'story',title:`Synthetic story ${id}`,time:1790883185,score:12,...extra});
const snapshot=(overrides={})=>({topstories:ids,items:ids.slice(0,10).map(id=>story(id)),...overrides});
const response=value=>new Response(JSON.stringify(value));

test('official top-10 snapshot preserves ranks, genuine creation time and discussion URL; jobs are supported',()=>{
 const data=snapshot(); data.items[1]=story(ids[1],{type:'job',score:undefined,text:'<p>A public job excerpt</p>'});
 data.items[2]=story(ids[2],{deleted:true}); data.items[3]=story(ids[3],{dead:true});
 const body=parseSubscription(JSON.stringify(data),source),items=normalizeSubscription(body,source,AT,'synthetic-evidence').items;
 assert.equal(items.length,8); assert.deepEqual(items.map(x=>x.source_rank),[1,2,5,6,7,8,9,10]);
 assert.equal(items[0].original_url,'https://news.ycombinator.com/item?id=1000'); assert.equal(items[0].published_at,'2026-10-01T19:33:05.000Z');
 assert.equal(items[0].heat_label,'12 分（HN）'); assert.equal(items[1].heat_label,null); assert.equal(items[1].summary,'A public job excerpt');
 assert.ok(items.every(x=>x.captured_at===AT && x.updated_at===null && x.source_item_time===null));
});

test('malformed IDs, partial snapshots, wrong item identity/type, ads/scripts and empty survivors fail closed',()=>{
 for(const data of [snapshot({topstories:[]}),snapshot({topstories:[ids[0],ids[0]]}),snapshot({topstories:['1000']}),
  snapshot({items:snapshot().items.slice(0,2)}),snapshot({items:snapshot().items.map(()=>null)}),
  snapshot({items:snapshot().items.map(row=>({...row,deleted:true}))})]) assert.throws(()=>parseHackerNewsApi(data,source));
 for(const change of [{id:9999},{type:'comment'},{title:''},{title:'<script>malicious()</script>'}]) {
  const data=snapshot();data.items[0]={...data.items[0],...change};assert.throws(()=>parseHackerNewsApi(data,source));
 }
 const data=snapshot();data.items[0]=story(ids[0],{text:'<style>ad CSS</style><script>malicious()</script><p>Actual excerpt &amp; note</p>',score:null,time:null});
 const item=parseHackerNewsApi(data,source).items[0];assert.equal(item.summary,'Actual excerpt & note');assert.equal(item.heat_label,null);assert.equal(item.published_at,null);
 assert.throws(()=>parseHackerNewsApi(snapshot(),{...source,feed_url:'https://other.example/api'}));
});

test('reader fetches exactly topstories plus first 10 items sequentially and uses no third-party URLs',async()=>{
 const calls=[];let active=0,maxActive=0;
 const body=await readHackerNewsApi(source,{headers:{'User-Agent':'Synthetic-test'},fetchImpl:async(url,opts)=>{
  calls.push(String(url));maxActive=Math.max(maxActive,++active);
  assert.equal(opts.redirect,'manual');assert.ok(opts.signal);assert.equal(opts.headers.Authorization,undefined);
  await new Promise(resolve=>setTimeout(resolve,1));active--;
  return response(url===HN_TOP_URL?ids:story(Number(new URL(url).pathname.match(/(\d+)\.json$/)[1])));
 }});
 assert.equal(calls.length,11);assert.equal(maxActive,1);assert.deepEqual(body.items.map(x=>x.source_rank),[1,2,3,4,5,6,7,8,9,10]);
 assert.ok(calls.every(url=>new URL(url).hostname==='hacker-news.firebaseio.com'));
});

test('explicit HN request room reads only eight complete detail records without claiming ranks nine and ten',async()=>{
 const calls=[];
 const body=await readHackerNewsApi(source,{maxItems:8,fetchImpl:async url=>{
  calls.push(String(url));return response(url===HN_TOP_URL?ids:story(Number(new URL(url).pathname.match(/(\d+)\.json$/)[1])));
 }});
 assert.equal(calls.length,9);assert.deepEqual(body.items.map(item=>item.source_rank),[1,2,3,4,5,6,7,8]);
 assert.equal(parseHackerNewsApi({topstories:ids,items:ids.slice(0,8).map(id=>story(id))},source,{maxItems:8}).items.length,8);
 assert.throws(()=>parseHackerNewsApi({topstories:ids,items:ids.slice(0,7).map(id=>story(id))},source,{maxItems:8}));
 for(const maxItems of [0,11,1.5,'8']) assert.throws(()=>parseHackerNewsApi(snapshot(),source,{maxItems}));
});

test('one failed item or redirect rejects the whole read, and parent cancellation stops requests',async()=>{
 for(const status of [403,429,302]) {
  let calls=0,cancelled=false;
  await assert.rejects(readHackerNewsApi(source,{fetchImpl:async()=>{calls++;return calls===1?response(ids)
   :new Response(new ReadableStream({cancel(){cancelled=true;}}),{status});}}),/upstream/);
  assert.equal(calls,2);assert.equal(cancelled,true);
 }
 const controller=new AbortController();let calls=0;
 const pending=readHackerNewsApi(source,{signal:controller.signal,fetchImpl:async(url,{signal})=>{
  calls++;if(url===HN_TOP_URL)return response(ids);
  return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new DOMException('stopped','AbortError')),{once:true});controller.abort();});
 }});
 await assert.rejects(pending,{name:'AbortError'});assert.equal(calls,2);
 const oversized=new Response('small',{headers:{'content-length':String(2*1024*1024+1)}});
 await assert.rejects(readHackerNewsApi(source,{fetchImpl:async()=>oversized}),/oversize/);
});

test('local service uses the official reader, persists one complete extract, and keeps old cache on item failure',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hn-source-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 let fail=false;
 const service=new MultiFeedService({dataDir:dir,newsChannels:[source],now:()=>new Date(AT),fetchImpl:async(url,opts)=>{
  assert.equal(opts.redirect,'error'); if(String(url)===HN_TOP_URL)return response(ids);
  if(fail)return new Response('',{status:500});return response(story(Number(new URL(url).pathname.match(/(\d+)\.json$/)[1])));
 }});
 const result=await service.readNews({id:source.id,last_success_at:null});assert.equal(result.source.status,'ok');assert.equal(result.items.length,10);
 const extracts=await fs.readdir(path.join(dir,'source-snapshots'));assert.equal(extracts.length,1);
 fail=true;const failed=await service.readNews(result.source);assert.equal(failed.source.status,'failed');assert.equal(failed.items,null);
 assert.equal(failed.source.last_success_at,AT);assert.match(failed.source.message,/保留上次内容/);
 assert.equal((await fs.readdir(path.join(dir,'source-snapshots'))).length,1);
});

test('cloud refresh uses official top-10 reading and retains the prior full source on partial item failure',async()=>{
 const old='2026-10-01T00:00:00.000Z',body=parseHackerNewsApi(snapshot(),source),items=normalizeSubscription(body,source,old,'old-evidence').items;
 const previous={schema_version:'0.3',mode:'live',generated_at:old,items,sources:[{...source,status:'ok',last_success_at:old}],refresh:{status:'ok'}};
 let fail=false;
 const fetchImpl=async(url,opts)=>{
  assert.equal(opts.redirect,'manual');
  if(new URL(url).hostname==='api.github.com')return response({items:[],incomplete_results:false});
  if(String(url)===HN_TOP_URL)return response(ids);
  if(fail)return new Response('',{status:500});return response(story(Number(new URL(url).pathname.match(/(\d+)\.json$/)[1])));
 };
 const next=await refreshPublicFeed(previous,{definitions:[source],now:()=>new Date(AT),fetchImpl});
 assert.equal(next.sources.find(s=>s.id===source.id).status,'ok');assert.equal(next.items.length,10);
 assert.ok(next.items.every(item=>item.captured_at===AT));
 fail=true;const failed=await refreshPublicFeed(previous,{definitions:[source],now:()=>new Date(AT),fetchImpl});
 assert.equal(failed.sources.find(s=>s.id===source.id).status,'failed');assert.equal(failed.sources.find(s=>s.id===source.id).last_success_at,old);
 assert.ok(failed.items.every(item=>item.captured_at===old));assert.equal(failed.items.length,10);
});
