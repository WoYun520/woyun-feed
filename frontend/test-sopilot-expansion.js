import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FEED_CHANNELS, normalizeSubscription, mergeSourceItems, sourceBucketFromItems } from './feed-sources.js';
import { refreshPublicFeed, mergePublicSourceResults } from './cloud-feed-service.js';
import { MultiFeedService } from './multi-feed-service.js';
import { renderSourceBoard, sourceRows } from './src/sourceBoard.js';

const oldTime='2026-10-02T01:00:00.000Z', newTime='2026-10-03T05:00:00.000Z';
const creator=FEED_CHANNELS.find(s=>s.id==='sopilot-creators');
const post=(rank,category='Creator')=>{
  const id=String(2100000000000000000n+BigInt(rank));
  return {id,rank,text:`检查用帖子 ${rank}，不是实际作者文章。`,authorName:'检查作者',screenName:'test_author',
    sourceUrl:`https://x.com/test_author/status/${id}`,velocityScore:10000-rank,tweetCreatedAt:oldTime};
};
const page=(source,number,total=2)=>{
  const data={locale:'zh',range:'24h',category:source.sopilot_category,page:number,totalPages:total,
    risingTweets:Array.from({length:50},(_,i)=>post((number-1)*50+i+1)),hotTweets:[]};
  return `<main data-rank-page="true"></main><script>self.__next_f.push(${JSON.stringify([1,`6:${JSON.stringify(['$','$L39',null,data])}\n`])})</script>`;
};
const body=(source,amount)=>({id:source.id,status:'success',items:Array.from({length:amount},(_,i)=>{
  const row=post(i+1);return {title:row.text,url:row.sourceUrl,summary:row.text,author_name:row.authorName,
    author_handle:row.screenName,source_rank:row.rank,published_at:row.tweetCreatedAt};
})});
const seed=()=>({schema_version:'0.3',mode:'live',sources:[{...creator,status:'ok',last_success_at:oldTime}],
  items:normalizeSubscription(body(creator,100),creator,oldTime,'old-captured').items,publication:{automatic_update:true}});
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

test('all four public tweet categories remain discoverable after the official X placeholder is retired',()=>{
  const sources=FEED_CHANNELS.filter(s=>s.sopilot_category);
  assert.deepEqual(sources.map(s=>s.sopilot_category),['AI','Creator','all','Finance']);
  assert.ok(sources.every(s=>s.group==='posts'&&s.link_kind==='post'&&s.ranked));
  assert.equal(FEED_CHANNELS.some(s=>s.id==='x'),false);
});

test('normalization preserves 100 tweet posts and their later-page ranks without increasing other source limits',()=>{
  const items=normalizeSubscription(body(creator,110),creator,newTime,'read-expanded').items;
  assert.equal(items.length,100);assert.equal(items.at(-1).source_rank,100);
  const rss=FEED_CHANNELS.find(s=>s.id==='sspai');
  assert.equal(normalizeSubscription(body(rss,110),rss,newTime,'read-rss').items.length,30);
});

test('one post on several leaderboards merges by status ID while preserving both original links and ranks',()=>{
  const ai=FEED_CHANNELS.find(s=>s.id==='sopilot-ai');
  const first=normalizeSubscription(body(creator,1),creator,oldTime,'creator-evidence').items[0];
  const second=normalizeSubscription({...body(ai,1),items:body(ai,1).items.map(row=>({...row,
    url:row.url.replace('x.com/test_author','twitter.com/TEST_AUTHOR'),source_rank:9}))},ai,newTime,'ai-evidence').items[0];
  const merged=mergeSourceItems({[creator.id]:[first],[ai.id]:[second]});assert.equal(merged.length,1);
  assert.equal(merged[0].id,first.id);assert.ok(merged[0].alias_ids.includes(second.id));
  assert.equal(merged[0].original_url,first.original_url);assert.ok(merged[0].canonical_url.startsWith('https://'));
  assert.deepEqual(merged[0].source_links.map(link=>[link.source_id,link.source_rank,link.url]),
    [[creator.id,1,first.original_url],[ai.id,9,second.original_url]]);
});

test('reconstructed old merged source buckets never borrow another source unknown rank or heat',()=>{
  const original=normalizeSubscription(body(creator,1),creator,oldTime,'old-evidence').items[0];
  const merged={...original,source_refs:[creator.id,'sopilot-ai'],source_links:[
    {source_id:creator.id,source_rank:1,heat_label:'1万 曝光/小时',captured_at:oldTime,evidence_ref:'creator-evidence'},
    {source_id:'sopilot-ai',source_rank:null,heat_label:null,captured_at:newTime,evidence_ref:'ai-evidence'}]};
  const [restored]=sourceBucketFromItems([merged],'sopilot-ai');
  assert.equal(restored.source_rank,null);assert.equal(restored.heat_label,null);
  assert.equal(restored.captured_at,newTime);assert.equal(restored.evidence_ref,'ai-evidence');
  const [unknown]=sourceBucketFromItems([{...merged,source_links:[]}],'sopilot-ai');
  assert.equal(unknown.source_rank,null);assert.equal(unknown.heat_label,null);
});

test('scheduled reader obtains both public pages and publishes later-page posts with original author/rank',async()=>{
  const calls=[];
  const next=await refreshPublicFeed(seed(),{definitions:[creator],now:()=>new Date(newTime),fetchImpl:async (url,options)=>{
    const u=new URL(url);assert.equal(options.headers.Authorization,undefined);
    if(u.hostname==='api.github.com')return new Response('{"items":[],"incomplete_results":false}');
    calls.push(u.href);return new Response(page(creator,Number(u.searchParams.get('page')||1)));
  }});
  const items=next.items.filter(i=>i.source_refs.includes(creator.id));
  assert.equal(items.length,100);assert.equal(calls.length,2);assert.match(calls[1],/page=2/);
  const last=items.find(i=>i.source_rank===100);assert.ok(last);assert.equal(last.author_handle,'test_author');
  assert.equal(last.captured_at,newTime);assert.equal(next.sources.find(s=>s.id===creator.id).status,'ok');
});

test('a failed later page retains the entire previous source and its successful capture time',async()=>{
  const previous=mergePublicSourceResults(seed(),[{source:{...creator,status:'ok',last_success_at:oldTime},items:seed().items}],{publishedAt:oldTime});
  const oldPosts=previous.items.filter(i=>i.source_refs.includes(creator.id)),copy=structuredClone(previous);
  const next=await refreshPublicFeed(previous,{definitions:[creator],now:()=>new Date(newTime),fetchImpl:async url=>{
    const u=new URL(url);if(u.hostname==='api.github.com')return new Response('{"items":[],"incomplete_results":false}');
    return u.searchParams.get('page')==='2' ? new Response('blocked',{status:403}) : new Response(page(creator,1));
  }});
  assert.deepEqual(next.items.filter(i=>i.source_refs.includes(creator.id)),oldPosts);
  assert.equal(next.sources.find(s=>s.id===creator.id).status,'failed');
  assert.equal(next.sources.find(s=>s.id===creator.id).last_success_at,oldTime);assert.deepEqual(previous,copy);
});

test('local reader persists every expanded public post into its source evidence snapshot',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'feed-post-expansion-'));
  try{
    const before=seed();before.source_buckets={github:[],[creator.id]:before.items};
    before.sources.unshift({id:'github',status:'ok',last_success_at:oldTime,next_allowed_at:'2099-01-01T00:00:00Z'});
    before.profile={};before.sections={daily:[],discover:[]};before.refresh={};
    await fs.writeFile(path.join(dir,'live-feed.json'),JSON.stringify(before));
    const service=new MultiFeedService({dataDir:dir,newsChannels:[creator],now:()=>new Date(newTime),newsCooldownMs:0,
      fetchImpl:async url=>{const u=new URL(url);assert.equal(u.hostname,'sopilot.net');return new Response(page(creator,Number(u.searchParams.get('page')||1)));}});
    const next=await service.refresh();assert.equal(next.source_buckets[creator.id].length,100);
    const files=await fs.readdir(path.join(dir,'source-snapshots'));assert.equal(files.length,1);
    const evidence=JSON.parse(await fs.readFile(path.join(dir,'source-snapshots',files[0]),'utf8'));
    assert.equal(evidence.items.length,100);assert.equal(evidence.items.at(-1).source_rank,100);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('legacy cache without buckets keeps all failed-source posts when another source updates successfully',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'feed-post-legacy-'));
  try{
    const rss=FEED_CHANNELS.find(s=>s.id==='sspai'),before=seed();
    before.sources.unshift({id:'github',status:'ok',last_success_at:oldTime,next_allowed_at:'2099-01-01T00:00:00Z'});
    before.sections={daily:[],discover:[]};before.refresh={};
    await fs.writeFile(path.join(dir,'live-feed.json'),JSON.stringify(before));
    const service=new MultiFeedService({dataDir:dir,newsChannels:[creator,rss],now:()=>new Date(newTime),
      fetchImpl:async url=>new URL(url).hostname==='sopilot.net' ? new Response('blocked',{status:403})
        : new Response('<rss><channel><item><title>新的公开文章</title><link>https://sspai.com/post/10001</link></item></channel></rss>')});
    const current=await service.current();assert.equal(current.source_buckets[creator.id].length,100);
    const next=await service.refresh();assert.equal(next.source_buckets[creator.id].length,100);
    assert.equal(next.items.filter(i=>i.source_refs.includes(creator.id)).length,100);
    assert.equal(next.sources.find(s=>s.id===creator.id).last_success_at,oldTime);
    assert.equal(next.sources.find(s=>s.id===rss.id).status,'ok');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('unified post overview starts with five originals and expansion still reaches later fetched pages',()=>{
  const posts=normalizeSubscription(body(creator,100),creator,newTime,'post-evidence').items;
  const news={id:'news',name:'新闻来源',group:'tech',kind:'original',status:'ok',home_url:'https://news.example/'};
  const articles=posts.slice(0,30).map((i,n)=>({...i,id:'article-'+n,title:'其他文章',source_refs:['news'],link_kind:'article'}));
  const state={mode:'live',sources:[creator,news],allItems:[...posts,...articles],savedItemIds:new Set(),archivedItemIds:new Set(),hiddenItemIds:new Set(),topics:[],refresh:{}};
  const before=structuredClone(state.allItems);
  const app={postStreamView:'all',escapeHtml:escape,safeUrl:v=>v,formatTime:v=>v,sourceLimits:{},boardGroup:'posts'};
  let html=renderSourceBoard(app,state);assert.equal((html.match(/data-post-stream-item-id=/g)||[]).length,5);
  assert.equal((html.match(/id="post-stream"/g)||[]).length,1);
  assert.doesNotMatch(html,/data-source-panel="sopilot-creators"/);
  assert.match(html,/data-board-group="posts" aria-pressed="true">推特/);assert.doesNotMatch(html,/data-source-panel="news"/);
  assert.match(html,/data-post-stream-more/);assert.match(html,/再看 5 条线索/);
  app.postStreamLimit=10;html=renderSourceBoard(app,state);assert.equal((html.match(/data-post-stream-item-id=/g)||[]).length,10);
  app.postStreamLimit=40;html=renderSourceBoard(app,state);
  assert.equal((html.match(/data-post-stream-item-id=/g)||[]).length,40);assert.match(html,/检查用帖子 40/);
  app.postStreamLimit=100;html=renderSourceBoard(app,state);
  assert.equal((html.match(/data-post-stream-item-id=/g)||[]).length,100);
  const last=posts.find(item=>item.source_rank===100);
  assert.ok(html.includes(`data-post-stream-item-id="${last.id}"`));assert.ok(html.includes(`href="${last.original_url}"`));
  assert.ok(html.includes(`data-action="toggle-save" data-item-id="${last.id}"`));
  assert.doesNotMatch(html,/data-post-stream-more/);assert.deepEqual(state.allItems,before);
  assert.equal(sourceRows(state,creator).at(-1).rank,100);
  app.boardGroup='tech';html=renderSourceBoard(app,state);assert.equal((html.match(/class="source-headline /g)||[]).length,5);
  assert.doesNotMatch(html,/id="post-stream"/);
});
