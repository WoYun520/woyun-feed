import test from 'node:test';
import assert from 'node:assert/strict';
import { CREATOR_SOURCES } from './creator-sources.js';
import { parseSubscription,normalizeSubscription,mergeSourceItems,sourceBucketFromItems } from './feed-sources.js';
import { makePublicFeed } from './public-feed-data.js';
import { mergePublicSourceResults,refreshPublicFeed } from './cloud-feed-service.js';
import { makeBackup,parseBackup } from './src/backup.js';
const source=CREATOR_SOURCES[0],at='2026-10-03T08:00:00.000Z';
const long='截图说明的具体步骤\n1. 打开截图工具，选择区域并保存，再选择箭头标出按钮。\n2. 最后导出图片，完整教程：https://example.com/screenshots\n'+ '继续核对截图边界。'.repeat(300);
function html({handle=source.creator_handle,text=long,empty=false}={}) {
  const props={locale:'zh',page:'1',query:'',backHref:'/zh/rank/creators',detail:{account:{screenName:handle},timeRange:'7d',posts:empty ? [] : [{id:'2105614023941316931',screenName:handle,authorName:'示例作者',text,sourceUrl:`https://x.com/${handle}/status/2105614023941316931`,tweetCreatedAt:'2026-10-02T00:00:00Z',viewsCount:12}]}};
  return '<main data-rank-page="true"></main><script>self.__next_f.push('+JSON.stringify([1,'6:'+JSON.stringify(['$','$L39',null,props])+'\n'])+')</script>';
}
const normalized=()=>normalizeSubscription(parseSubscription(html(),source),source,at,'author-reading').items;
const seed=()=>makePublicFeed({schema_version:'0.3',mode:'live',sources:[{...source,status:'ok',last_success_at:at}],items:normalized(),refresh:{new_item_ids:[]}}, {publishedAt:at});
test('public author normalization retains over-1000-character excerpt, metadata and backup/export scope',()=>{
  const items=normalized();assert.equal(items[0].summary,long);assert.ok(items[0].summary.length>1000);
  assert.equal(items[0].read_scope,'author-7d-top10');assert.equal(items[0].excerpt_truncated,false);
  const publicFeed=seed(),item=publicFeed.items[0];assert.equal(item.summary,long);assert.equal(item.read_scope,'author-7d-top10');
  assert.equal(publicFeed.sources[0].creator_handle,source.creator_handle);
  const state={saved_item_ids:[item.id],hidden_item_ids:[],followups:[],profile_override:null,item_snapshots:{[item.id]:item}};
  const backup=makeBackup(state,publicFeed,'live');assert.equal(parseBackup(backup.raw,'live').state.item_snapshots[item.id].summary,long);
});
test('same post chooses richer author excerpt without losing old source links and IDs',()=>{
  const item=normalized()[0],old={...item,id:'news-aaaaaaaaaaaaaaaaaaaaaaaa',summary:'较短的旧摘录',read_scope:undefined,source_refs:['sopilot-ai'],evidence_ref:'old-evidence'};
  const merged=mergeSourceItems({old:[old],author:[item]});assert.equal(merged.length,1);assert.equal(merged[0].summary,long);
  assert.ok(merged[0].alias_ids.includes(old.id));assert.ok(merged[0].source_links.some(link=>link.evidence_ref==='old-evidence'));
});
test('failed rank source cannot inherit author priority and override newly captured author text',()=>{
  const old=normalized()[0];
  const merged=mergeSourceItems({rank:[{...old,source_refs:['sopilot-ai'],read_scope:undefined}],author:[old]});
  const retainedRank=sourceBucketFromItems(merged,'sopilot-ai');
  assert.equal(retainedRank[0].read_scope,undefined);
  const fresh={...old,summary:'新作者教程：改为第二步',captured_at:'2026-10-03T09:00:00.000Z'};
  const next=mergeSourceItems({rank:retainedRank,author:[fresh]});
  assert.equal(next[0].summary,fresh.summary);assert.equal(next[0].captured_at,fresh.captured_at);
  assert.ok(next[0].source_links.some(link=>link.source_id==='sopilot-ai' && link.captured_at===at));
});
test('validated empty author read clears stale source list while other public materials remain',async()=>{
  const previous=seed();
  const oldSspai={...previous.items[0],id:'news-bbbbbbbbbbbbbbbbbbbbbbbb',original_url:'https://sspai.com/post/12345',source_refs:['sspai']};
  previous.items.push(oldSspai);previous.sources.push({id:'sspai',name:'少数派',status:'ok',last_success_at:at});
  const next=await refreshPublicFeed(previous,{definitions:[source,{id:'sspai',name:'少数派',feed_url:'https://sspai.com/feed',format:'rss',channel:'sspai'}],now:()=>new Date(at),fetchImpl:async url=>{
    if(String(url).includes('sopilot.net')) return new Response(html({empty:true}));
    throw Error('offline');
  }});
  assert.equal(next.sources.find(s=>s.id===source.id).status,'ok');assert.equal(next.items.filter(i=>i.source_refs.includes(source.id)).length,0);
  assert.ok(next.items.some(i=>i.source_refs.includes('sspai')));
});
test('foreign author read is failure and preserves old author excerpt, time and original URL',async()=>{
  const previous=seed(),item=previous.items[0];
  const next=await refreshPublicFeed(previous,{definitions:[source],now:()=>new Date('2026-10-03T09:00:00Z'),fetchImpl:async url=>{
    if(String(url).includes('sopilot.net')) return new Response(html({handle:'other_author'}));
    throw Error('offline');
  }});
  assert.equal(next.sources.find(s=>s.id===source.id).status,'failed');assert.equal(next.sources.find(s=>s.id===source.id).last_success_at,at);
  assert.equal(next.items.find(i=>i.id===item.id).summary,item.summary);
});
test('maintenance addition preserves every other source item, freshness and failed status',()=>{
  const previous=seed(),definition=CREATOR_SOURCES[1];
  const item={...normalized()[0],id:'news-cccccccccccccccccccccccc',original_url:'https://x.com/vista8/status/2105614023941316932',canonical_url:'https://x.com/vista8/status/2105614023941316932',author_handle:'vista8',source_refs:[definition.id]};
  const next=mergePublicSourceResults(previous,[{source:{...definition,status:'ok',last_success_at:at},items:[item]}],{publishedAt:at});
  assert.equal(next.sources.find(s=>s.id===source.id).last_success_at,previous.sources[0].last_success_at);
  assert.equal(next.items.find(i=>i.id===previous.items[0].id).summary,previous.items[0].summary);
  assert.equal(next.items.find(i=>i.id===item.id).read_scope,'author-7d-top10');
});
