import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CREATOR_CATALOG,CREATOR_MATERIALS} from './src/creatorCatalog.js';
import {selectCreatorCandidates,selectCreatorTutorials} from './src/creatorTutorials.js';
import {CREATOR_BLOG_SOURCES} from './creator-sources.js';
import {makePublicFeed} from './public-feed-data.js';
import {FeedDataAdapter} from './src/dataAdapter.js';
const creator=CREATOR_CATALOG.find(c=>c.id==='creator-esorhuang');
const source=CREATOR_BLOG_SOURCES.find(s=>s.creator_id===creator.id);
const at='2026-10-03T14:00:00.000Z';
const summary='這篇教學說明如何整理筆記與資料。\n1. 打開筆記頁面，選擇要整理的檔案，然後建立分類。\n2. 輸入自己的想法，最後儲存到資料夾。完整步驟、設定條件與操作範例請在原文查看，未提供完整費用說明。';
const item=(id,patch={})=>({id,title:'如何整理筆記：不靠熱門關鍵字的操作教學',summary,
  creator_id:creator.id,author_name:creator.name,source_refs:[source.id],source_links:[],
  original_url:'https://www.playpcesor.com/2026/01/'+id+'.html',link_kind:'article',
  content_status:'excerpt_only',read_scope:'author-blog-feed',blog_method_hint:'steps-and-example',
  captured_at:at,published_at:'2026-01-02T00:00:00.000Z',verification_status:'not_tested',recommendation_kind:'rule',evidence_ref:'public-reading:'+id,...patch});
const refresh=ids=>({status:'ok',new_item_ids:ids});
test('non-X traditional Chinese practical subscription has a guarded candidate and narrow note',()=>{
 const original=item('news-practice');const before=structuredClone(original);
 const [entry]=selectCreatorCandidates([original],{refresh:refresh([original.id])});
 assert.equal(entry.creator.id,creator.id);assert.equal(entry.candidateNew,true);
 assert.match(entry.purpose,/笔记/);assert.match(entry.guide.requirements,/确认/);
 assert.equal(entry.guide.read_at,undefined);assert.equal(entry.guide.trial_url,undefined);
 assert.equal(entry.item.published_at,'2026-01-02T00:00:00.000Z');assert.deepEqual(original,before);
 assert.ok(!original.title.includes('AI'));assert.equal(original.author_handle,undefined);
});
test('wrong creator, source, domain and forged handle cannot become non-X candidates',()=>{
 const good=item('news-identity');
 for(const patch of [{creator_id:'creator-raymondhouch'},{source_refs:['creator-blog-raymondhouch']},
  {source_refs:[]},{creator_id:'creator-unknown'},{author_handle:'esorhuang'},
  {original_url:'https://www.playpcesor.com.attacker.invalid/tutorial'},
  {original_url:'https://www.playpcesor.com:8443/tutorial'},{origin:'user_added'}])
  assert.equal(selectCreatorCandidates([{...good,...patch}]).length,0,JSON.stringify(patch));
});
test('old articles newly discovered sort before latest retained articles without changing publication dates',()=>{
 const older=item('news-old',{published_at:'2020-01-02T00:00:00.000Z',captured_at:'2026-09-01T00:00:00.000Z'});
 const latest=item('news-recent',{published_at:'2026-10-02T00:00:00.000Z'});
 const selected=selectCreatorCandidates([latest,older],{refresh:refresh([older.id])});
 assert.deepEqual(selected.map(e=>e.item.id),[older.id,latest.id]);assert.equal(selected[0].item.published_at,older.published_at);
 assert.equal(selectCreatorCandidates([older],{refresh:{status:'failed',new_item_ids:[older.id]}})[0].candidateNew,false);
 assert.equal(selectCreatorCandidates([older],{refresh:{status:'partial',new_item_ids:[older.id]}})[0].candidateNew,true);
 const alias={...older,alias_ids:['old-alias']};assert.equal(selectCreatorCandidates([alias],{refresh:refresh(['old-alias'])})[0].candidateNew,true);
});
test('tracking links merge, real query differences remain, and fixed read notes are excluded',()=>{
 const good=item('news-first'),tracking={...good,id:'news-tracking',original_url:good.original_url+'?utm_source=example#heading'};
 assert.equal(selectCreatorCandidates([good,tracking]).length,1);
 assert.equal(selectCreatorCandidates([good,{...tracking,original_url:good.original_url+'?page=2'}]).length,2);
 const fixed=CREATOR_MATERIALS.find(i=>i.creator_id==='creator-vikingmute');
 const rss={...good,id:'news-fixed-excerpt',creator_id:undefined,author_handle:'vikingmute',source_refs:['creator-blog-vikingmute'],original_url:fixed.original_url};
 assert.equal(selectCreatorCandidates([rss,fixed]).length,0);
});
test('author pause, hidden and use search intersect without deleting saved data',()=>{
 const good=item('news-query');
 assert.equal(selectCreatorCandidates([good],{query:'笔记 确认'}).length,1);
 assert.equal(selectCreatorCandidates([good],{query:'字幕'}).length,0);
 assert.equal(selectCreatorCandidates([good],{author:'creator-fqzlr'}).length,0);
 assert.equal(selectCreatorCandidates([good],{preferences:{[creator.id]:{enabled:false}}}).length,0);
 assert.equal(selectCreatorCandidates([good],{hiddenItemIds:[good.id]}).length,0);
});
test('locked tests, change logs and platform comparisons do not become follow-along candidates',()=>{
 for(const title of ['🔒 测试1234：笔记教程','站点更新：背景视频、公告板与音乐播放器的一批打磨','Zeabur 漲價後值得用嗎？部署平台比較'])
  assert.equal(selectCreatorCandidates([item('news-not-tutorial',{title})]).length,0,title);
});
test('real creator metadata survives collection, topic export, backup and refresh',async()=>{
 const data=new Map();globalThis.localStorage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
 const original=item('news-persistence');original.id='news-'+createHash('sha256').update(original.original_url).digest('hex').slice(0,24);
 const published=makePublicFeed({schema_version:'0.3',mode:'live',sources:[{...source,status:'ok',last_success_at:at}],items:[original],refresh:refresh([original.id])},{publishedAt:at});
 assert.equal(published.items[0].creator_id,creator.id);
 globalThis.fetch=async()=>({ok:true,json:async()=>structuredClone(published)});
 const adapter=new FeedDataAdapter({publicPreview:true});await adapter.loadFeed();
 const captured=adapter.getState().allItems.find(i=>i.id===original.id);adapter.setDisplayedItems([captured]);adapter.setSaved(captured.id,true);
 const topic=adapter.createTopic({title:'教程候选资料',goal:'阅读实际步骤'},captured.id);
 const exported=adapter.exportTopic(topic.id);assert.ok(exported.includes(original.original_url));assert.ok(exported.includes('2026-01-02'));
 assert.ok(!exported.includes('用户已实测'));assert.ok(adapter.createBackup().raw.includes(creator.id));
 await adapter.refreshFeed();assert.equal(adapter.getState().savedItems[0].summary,original.summary);
 const reload=new FeedDataAdapter({publicPreview:true});await reload.loadFeed();assert.equal(reload.getState().topics[0].materials[0].item.creator_id,creator.id);
 assert.equal(selectCreatorTutorials([captured]).length,1);
});
