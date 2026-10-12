import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MultiFeedService } from './multi-feed-service.js';
import { FEED_CHANNELS, canonicalUrl, normalizeSubscription, parseSubscription, mergeSourceItems } from './feed-sources.js';
import { FeedDataAdapter } from './src/dataAdapter.js';
import { parseBackup } from './src/backup.js';

const NOW='2026-09-28T12:00:00Z';
const repo=(id=1)=>({id,full_name:`example/tool-${id}`,description:'AI writing helper',topics:['productivity'],stargazers_count:200,archived:false,fork:false,pushed_at:NOW});
const rss=(id=1)=>`<rss version="2.0"><channel><item><title><![CDATA[AI 工具 &amp; 笔记]]></title><link>https://sspai.com/post/${id}</link><pubDate>Mon, 28 Sep 2026 08:00:00 GMT</pubDate><description><![CDATA[<p>写作摘要</p><script>bad()</script>]]></description></item></channel></rss>`;
const atom=(id=1)=>`<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>AI &#x5DE5;具</title><link href="https://www.v2ex.com/t/${id}#reply" rel="alternate"/><published>2026-09-28T09:00:00Z</published><updated>2026-09-28T10:00:00Z</updated><content>Do not copy full body</content></entry></feed>`;
const response=url=>new Response(url.hostname==='api.github.com' ? JSON.stringify({items:[repo()],incomplete_results:false}) : url.hostname==='sspai.com' ? rss() : atom());
async function directory(t) {const dir=await fs.mkdtemp(path.join(os.tmpdir(),'multi-feed-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}

test('publisher feeds preserve provenance and separate publication, source update and capture times',()=>{
  const parsed=parseSubscription(rss(),FEED_CHANNELS[0]);
  const [item]=normalizeSubscription(parsed,FEED_CHANNELS[0],NOW,'extract-1').items;
  assert.equal(item.title,'AI 工具 & 笔记');assert.equal(item.summary,'写作摘要');assert.equal(item.content_status,'excerpt_only');
  assert.notEqual(item.published_at,item.captured_at);assert.equal(item.updated_at,null);assert.equal(item.verification_status,'not_tested');
  const v=normalizeSubscription(parseSubscription(atom(),FEED_CHANNELS[1]),FEED_CHANNELS[1],NOW,'extract-2').items[0];
  assert.equal(v.title,'AI 工具');assert.equal(v.content_status,'headline_only');assert.equal(v.source_item_time,'2026-09-28T10:00:00.000Z');
  assert.ok(!JSON.stringify(v).includes('Do not copy full body'));
  for (const body of ['<html>error</html>','<!DOCTYPE rss><rss><channel></channel></rss>',rss().replace('</rss>','')]) assert.throws(()=>parseSubscription(body,FEED_CHANNELS[0]));
  assert.throws(()=>normalizeSubscription({id:'other',status:'success',items:[]},FEED_CHANNELS[0],NOW,'e'));
  assert.throws(()=>normalizeSubscription({id:'sspai',status:'success',items:[{title:'bad',url:'javascript:alert(1)'}]},FEED_CHANNELS[0],NOW,'e'));
});

test('same URL merges sources and aliases; similar titles and different query values remain separate',()=>{
  const news=(url)=>normalizeSubscription({id:'sspai',status:'success',items:[{title:'same title',url}]},FEED_CHANNELS[0],NOW,'news-e').items[0];
  const n=news('https://www.github.com/Example/Tool.git?utm_source=x#readme');
  const gh={id:'github-123',title:'Repo',original_url:'https://github.com/example/tool',source_refs:['github'],captured_at:NOW,evidence_ref:'gh-e'};
  const out=mergeSourceItems({sspai:[n,news('https://example.com/page?a=1'),news('https://example.com/page?a=2')],github:[gh]});
  assert.equal(out.length,3);assert.equal(out[0].id,'github-123');assert.deepEqual(out[0].source_refs,['github','sspai']);
  assert.ok(out[0].alias_ids.includes(n.id));assert.deepEqual(out[0].evidence_refs,['gh-e','news-e']);assert.equal(out[0].source_links.length,2);
  assert.equal(canonicalUrl('https://example.com/path?utm_source=a&b=1#x'),'https://example.com/path?b=1');
  assert.equal(canonicalUrl('https://user:secret@example.com'),null);
});

test('three independent sources refresh concurrently, persist extracts, deduplicate repeat updates and survive restart',async t=>{
  const dataDir=await directory(t);let calls=0;
  const service=new MultiFeedService({dataDir,newsChannels:FEED_CHANNELS.slice(0,2),now:()=>new Date(NOW),cooldownMs:0,newsCooldownMs:0,fetchImpl:async(url,options)=>{calls++;assert.equal(options.headers.Authorization,undefined);return response(url);}});
  assert.equal((await service.current()).sources.length,3);assert.equal(calls,0);
  const [one,two]=await Promise.all([service.refresh(),service.refresh()]);assert.deepEqual(one,two);assert.equal(calls,3);
  assert.equal(one.items.length,3);assert.equal(one.refresh.new_count,3);assert.equal(one.refresh.new_item_ids.length,3);
  const again=await service.refresh();assert.equal(again.refresh.new_count,0);assert.deepEqual(again.refresh.new_item_ids,[]);
  assert.deepEqual(await new MultiFeedService({dataDir,newsChannels:FEED_CHANNELS.slice(0,2)}).current(),again);
  const snapshots=await fs.readdir(path.join(dataDir,'source-snapshots'));assert.equal(snapshots.length,6);
  const v=JSON.parse(await fs.readFile(path.join(dataDir,'source-snapshots',snapshots.find(x=>x.startsWith('v2ex'))),'utf8'));
  assert.equal(v.items[0].summary,null);assert.ok(!JSON.stringify(v).includes('Do not copy full body'));
});

test('partial failures retain that source cache and successful timestamp while other sources advance',async t=>{
  const dataDir=await directory(t);let now=new Date(NOW),round=0;
  const service=new MultiFeedService({dataDir,newsChannels:FEED_CHANNELS.slice(0,2),now:()=>now,cooldownMs:0,newsCooldownMs:0,fetchImpl:async url=> round===0 ? response(url) : url.hostname==='sspai.com' ? new Response('Denied',{status:403}) : url.hostname==='www.v2ex.com' ? new Response(atom(2)) : response(url)});
  const before=await service.refresh();round++;now=new Date(now.getTime()+600000);
  const after=await service.refresh();assert.equal(after.refresh.status,'partial');assert.equal(after.refresh.new_count,1);
  assert.deepEqual(after.source_buckets.sspai,before.source_buckets.sspai);
  assert.equal(after.sources.find(x=>x.id==='sspai').last_success_at,new Date(NOW).toISOString());
  assert.match(after.sources.find(x=>x.id==='sspai').message,/保留上次/);
  service.fetchImpl=async()=>{throw new Error('offline');};now=new Date(now.getTime()+600000);
  const allFailed=await service.refresh();assert.equal(allFailed.refresh.status,'failed');assert.deepEqual(allFailed.items,after.items);assert.equal(allFailed.generated_at,after.generated_at);assert.equal(allFailed.refresh.new_count,0);
});

test('separate cooldowns skip recently read sources; migration does not mark existing links as new',async t=>{
  const dataDir=await directory(t);let now=new Date(NOW),calls=[];
  const service=new MultiFeedService({dataDir,newsChannels:FEED_CHANNELS.slice(0,2),now:()=>now,fetchImpl:async url=>{calls.push(url.hostname);return response(url);}});
  const first=await service.refresh();await service.refresh();assert.equal(calls.length,3);
  now=new Date(now.getTime()+300001);const next=await service.refresh();assert.equal(calls.length,4);assert.equal(calls[3],'api.github.com');assert.match(next.refresh.message,/其余来源/);
  const old={...first,schema_version:'0.2',items:first.source_buckets.github,sources:first.sources.filter(x=>x.id==='github')};delete old.source_buckets;delete old.seen_links;delete old.sources[0].next_allowed_at;
  await fs.writeFile(path.join(dataDir,'live-feed.json'),JSON.stringify(old));
  const migrated=new MultiFeedService({dataDir,newsChannels:FEED_CHANNELS.slice(0,2),now:()=>now,fetchImpl:async url=>response(url)});
  assert.equal((await migrated.current()).items.length,1);
  assert.equal(JSON.parse(await fs.readFile(path.join(dataDir,'live-feed.json'))).schema_version,'0.2');
  assert.equal((await migrated.refresh()).refresh.new_count,2);
});

test('failed final cache write leaves disk and source success times untouched',async t=>{
  const dataDir=await directory(t);let now=new Date(NOW);
  const service=new MultiFeedService({dataDir,newsChannels:FEED_CHANNELS.slice(0,2),now:()=>now,cooldownMs:0,newsCooldownMs:0,fetchImpl:async url=>response(url)});
  const before=await service.refresh();const raw=await fs.readFile(path.join(dataDir,'live-feed.json'),'utf8');
  service.writeFeed=async()=>{throw Object.assign(new Error('full'),{code:'ENOSPC'});};now=new Date(now.getTime()+600000);
  const after=await service.refresh();assert.equal(after.refresh.status,'failed');assert.equal(after.refresh.new_count,0);assert.deepEqual(after.sources,before.sources);assert.deepEqual(after.items,before.items);
  assert.equal(await fs.readFile(path.join(dataDir,'live-feed.json'),'utf8'),raw);
});

test('article collections and questions round-trip through backup, and never start repository research',async()=>{
  const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
  const item=mergeSourceItems({sspai:normalizeSubscription(parseSubscription(rss(),FEED_CHANNELS[0]),FEED_CHANNELS[0],NOW,'extract-1').items})[0];
  const feed={mode:'live',schema_version:'0.3',items:[item],sources:FEED_CHANNELS,profile:{},sections:{daily:[item.id],discover:[]}};
  globalThis.fetch=async()=>({ok:true,json:async()=>structuredClone(feed)});
  const adapter=new FeedDataAdapter();await adapter.loadFeed();adapter.setSaved(item.id,true);const task=adapter.saveFollowupDraft(item.id,'【自动检查】原文适合什么人？');
  const backup=adapter.createBackup();const parsed=parseBackup(backup.raw,'live');assert.deepEqual(parsed.state.item_snapshots[item.id].source_links,item.source_links);
  const invalid=JSON.parse(backup.raw);invalid.state.item_snapshots[item.id].source_links[0].url='javascript:alert(1)';assert.throws(()=>parseBackup(JSON.stringify(invalid),'live'));
  globalThis.fetch=async()=>{throw new Error('must not fetch');};await assert.rejects(adapter.startResearch(task.id),/仅支持 GitHub/);
  assert.match(adapter.exportFollowupText(task.id),/读过来源摘要/);assert.match(adapter.exportFollowupText(task.id),/https:\/\/sspai.com\/post\/1/);
  globalThis.fetch=async()=>({ok:true,json:async()=>({...feed,items:[]})});const reloaded=new FeedDataAdapter();await reloaded.loadFeed();assert.equal(reloaded.getState().savedItems.length,1);
});

test('old aliases keep bookmarks, hidden state and questions after a cross-source merge, and can be removed',async()=>{
  const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
  const n=normalizeSubscription({id:'sspai',status:'success',items:[{title:'AI 工具',url:'https://github.com/example/tool'}]},FEED_CHANNELS[0],NOW,'extract-1').items[0];
  let feed={mode:'live',schema_version:'0.3',items:[n],sources:FEED_CHANNELS,profile:{},refresh:{status:'ok'},sections:{daily:[n.id],discover:[]}};
  globalThis.fetch=async()=>({ok:true,json:async()=>structuredClone(feed)});
  const adapter=new FeedDataAdapter();await adapter.loadFeed();adapter.setSaved(n.id,true);adapter.setHidden(n.id,true);const task=adapter.saveFollowupDraft(n.id,'【自动检查】问题');
  const merged=mergeSourceItems({sspai:[n],github:[{...n,id:'github-5',source_refs:['github'],evidence_ref:'gh-e'}]});feed={...feed,items:merged};await adapter.refreshFeed();
  assert.equal(adapter.getState().savedItems.length,1);assert.equal(adapter.getState().selection.candidates.length,0);assert.equal(adapter.getState().selection.hiddenCount,1);
  assert.equal(adapter.getFollowupForItem('github-5').id,task.id);
  adapter.setHidden('github-5',false);adapter.setSaved('github-5',false);
  assert.equal(adapter.getState().hiddenItems.length,0);assert.equal(adapter.getState().savedItems.length,0);assert.equal(adapter.getState().selection.candidates.length,1);
});
