import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedDataAdapter } from './src/dataAdapter.js';
import { parseBackup } from './src/backup.js';
import { makePublicFeed } from './public-feed-data.js';

const time='2026-10-09T09:05:22Z';
const material=(n='2108148604447883464')=>({category:'tutorial',original_url:`https://x.com/example/status/${n}`,author_handle:'example',published_at:null,title_zh:'【检查示例】把视频字幕整理成文章',summary_zh:'【检查示例】作者给了三步操作，尚未实测。',bookmark_count:380,like_count:251,view_count:null,metric_display:'收藏380；点赞251；浏览7.3万',metrics_checked_at:time,metrics_source_url:`https://x.com/example/status/${n}`,read_scope:'main_post',selection_reason:'有明确步骤。',my_angle:'用自己的材料对照。',unknowns:['未观看视频','尚未实测']});
const raw=(items=[material()],alternatives=[])=>JSON.stringify({format:'woyun-feed:candidates',version:1,collector:'Dot',collected_at:time,items,alternatives});
const feed={mode:'live',schema_version:'0.3',profile:{},items:[],sources:[],sections:{daily:[],discover:[]}};
function setup() {
  const storage=new Map();globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key),key:index=>[...storage.keys()][index]??null,get length(){return storage.size;}};
  globalThis.fetch=()=>{throw Error('Dot intake must not use network, AI, public writes or real user storage');};
  const adapter=new FeedDataAdapter();adapter.feedData=structuredClone(feed);return {adapter,storage};
}

test('import stores only a pending review record, changes no source feed and survives reload',()=>{
  const {adapter}=setup(),before=structuredClone(adapter.feedData),result=adapter.importDotCandidates(raw()),state=adapter.getState();
  assert.equal(result.added,1);assert.equal(state.dotPendingCandidates.length,1);assert.equal(state.dotFeaturedItems.length,0);assert.equal(state.allItems.length,0);assert.equal(state.dailyItems.length,0);assert.equal(state.savedItems.length,0);
  assert.equal(state.itemMap.has(result.importedIds[0]),false);assert.deepEqual(adapter.feedData,before);assert.equal(adapter.localState.dot_candidates[0].item.verification_status,'not_verified');
  const reload=new FeedDataAdapter();reload.feedData=structuredClone(feed);assert.deepEqual(reload.getState().dotCandidates,state.dotCandidates);
  state.dotCandidates[0].material.summary_zh='outside mutation';assert.notEqual(adapter.localState.dot_candidates[0].material.summary_zh,'outside mutation');
});

test('duplicates are identified by post ID within file, across files, upstream feed and saved snapshots',()=>{
  const {adapter}=setup();const known=material('2108148604447883465'),saved=material('2108148604447883466');
  adapter.feedData.items.push({id:'news-'+'a'.repeat(24),title:'旧来源',summary:'',source_refs:[],original_url:known.original_url});
  adapter.localState.item_snapshots['news-'+'b'.repeat(24)]={id:'news-'+'b'.repeat(24),title:'旧收藏',summary:'',source_refs:[],original_url:saved.original_url};
  const one=material(),renamed={...one,author_handle:'RENAMED',original_url:one.original_url.replace('example','RENAMED').replace('x.com','twitter.com')};
  const result=adapter.importDotCandidates(raw([one,renamed,known,saved]));assert.deepEqual({added:result.added,duplicates:result.duplicates,existing:result.existing,total:result.total},{added:1,duplicates:1,existing:2,total:4});
  const id=result.importedIds[0];adapter.setDotCandidateStatus([id],'dismissed');const before=structuredClone(adapter.localState.dot_candidates);
  const repeated=adapter.importDotCandidates(raw());assert.equal(repeated.added,0);assert.equal(repeated.duplicates,1);assert.deepEqual(adapter.localState.dot_candidates,before);
});

test('manual feature selection exposes searchable normal materials and source identity without automatic source ranking',()=>{
  const {adapter}=setup(),result=adapter.importDotCandidates(raw([material()], [material('2108148604447883465')])),ids=result.importedIds;
  assert.equal(result.added,2);assert.equal(adapter.localState.dot_candidates[1].batch.group,'alternatives');
  const changed=adapter.setDotCandidateStatus(ids,'featured');assert.equal(changed.changed,2);assert.equal(adapter.getState().dotPendingCandidates.length,0);assert.equal(adapter.getState().dotFeaturedItems.length,2);assert.equal(adapter.getState().allItems.length,2);assert.equal(adapter.getState().dailyItems.length,0);
  assert.equal(adapter.getState().sourceMap.get('dot-import').name,'Dot 素材');assert.equal(adapter.getState().itemMap.get(ids[0]).origin,'dot_import');
  assert.equal(adapter.topicItem(ids[0]).verification_status,'not_verified');adapter.rememberItem(ids[1]);assert.ok(adapter.localState.item_snapshots[ids[1]]);
  assert.equal(adapter.setDotCandidateStatus(ids,'featured').changed,0);assert.equal(adapter.createDotFeaturedExport().count,2);
});

test('returning a feature to review keeps existing bookmarks, excerpts and topic copies usable',()=>{
  const {adapter}=setup(),id=adapter.importDotCandidates(raw()).importedIds[0];adapter.setDotCandidateStatus([id],'featured');adapter.setSaved(id,true);
  adapter.saveCollectionContent(id,{note:'我自己的切入点',excerpt:'我手动留下的关键句。'});const topic=adapter.createTopic({title:'教程候选'},id);
  const before=structuredClone(adapter.localState.item_snapshots[id]);adapter.setDotCandidateStatus([id],'pending');
  assert.equal(adapter.getState().dotFeaturedItems.length,0);assert.equal(adapter.getState().savedItems.length,1);assert.deepEqual(adapter.topicItem(id),before);assert.equal(adapter.localState.topics[0].materials[0].item.summary,before.summary);
  assert.equal(adapter.collectionNote(id),'我自己的切入点');assert.equal(adapter.collectionExcerpt(id).text,'我手动留下的关键句。');assert.match(adapter.exportTopic(topic.id),/教程候选/);
});

test('followup exports distinguish Dot recommendations, observed heat and unknown counts from user experience',()=>{
  const {adapter}=setup(),id=adapter.importDotCandidates(raw()).importedIds[0];adapter.setDotCandidateStatus([id],'featured');
  const task=adapter.saveFollowupDraft(id,'只比较流程，不安装或发布'),output=adapter.exportFollowupText(task.id);
  assert.match(output,/Dot 整理摘要，尚未独立核验/);assert.match(output,/采集者建议，不是用户经历或已执行任务/);
  assert.match(output,/收藏 380；点赞 251；浏览 未知/);assert.match(output,/Dot 报告的热度观察时间：2026-10-09T09:05:22Z/);
  assert.match(output,/核实状态：未核验、未实测/);assert.match(output,/选入精选不代表实测、用户验收或公开发布/);
  assert.doesNotMatch(output,/浏览 73000|核实状态：verified|用户已经使用/);
});

test('invalid imports and unknown selections leave all state and storage unchanged',()=>{
  const {adapter,storage}=setup(),before=structuredClone(adapter.localState);
  const invalid=JSON.parse(raw());invalid.items.push({...material('2108148604447883465'),bookmark_count:-1});
  assert.throws(()=>adapter.importDotCandidates(JSON.stringify(invalid)));assert.deepEqual(adapter.localState,before);assert.equal(storage.size,0);
  assert.throws(()=>adapter.setDotCandidateStatus(['dot-x-2108148604447883464'],'featured'),/已变化/);assert.deepEqual(adapter.localState,before);
  for (const [ids,status] of [[[],'featured'],[['missing'],'verified'],[['missing','missing'],'pending']]) assert.throws(()=>adapter.setDotCandidateStatus(ids,status));
});

test('storage failure rolls back import and bulk selection, then retry saves once',()=>{
  const {adapter,storage}=setup(),before=structuredClone(adapter.localState);let notifications=0;adapter.subscribe(()=>notifications++);
  const setItem=globalThis.localStorage.setItem;globalThis.localStorage.setItem=()=>{throw Error('isolated full storage');};
  assert.throws(()=>adapter.importDotCandidates(raw()),/本地存储/);assert.deepEqual(adapter.localState,before);assert.equal(storage.size,0);assert.equal(notifications,0);
  globalThis.localStorage.setItem=setItem;const result=adapter.importDotCandidates(raw());const pending=structuredClone(adapter.localState),encoded=storage.get(adapter.storageKey);
  globalThis.localStorage.setItem=()=>{throw Error('isolated full storage');};assert.throws(()=>adapter.setDotCandidateStatus(result.importedIds,'featured'),/本地存储/);assert.deepEqual(adapter.localState,pending);assert.equal(storage.get(adapter.storageKey),encoded);
  globalThis.localStorage.setItem=setItem;adapter.setDotCandidateStatus(result.importedIds,'featured');assert.equal(adapter.getState().dotFeaturedItems.length,1);assert.equal(notifications,2);
});

test('newer changes in another tab block import and selection without clobbering pending records',()=>{
  const {adapter,storage}=setup(),other=new FeedDataAdapter();other.feedData=structuredClone(feed);const result=other.importDotCandidates(raw()),encoded=storage.get(other.storageKey);
  assert.throws(()=>adapter.importDotCandidates(raw()),/另一个页面/);assert.throws(()=>adapter.setDotCandidateStatus(result.importedIds,'featured'),/另一个页面/);assert.equal(storage.get(other.storageKey),encoded);
});

test('backup preserves pending, featured, ignored records and originals; older backup cannot overwrite newer user selections',()=>{
  const {adapter,storage}=setup(),ids=adapter.importDotCandidates(raw([material(),material('2108148604447883465'),material('2108148604447883466')])).importedIds;
  adapter.setDotCandidateStatus([ids[0]],'featured');adapter.setDotCandidateStatus([ids[1]],'dismissed');adapter.setSaved(ids[0],true);
  const backup=adapter.createBackup();assert.doesNotThrow(()=>parseBackup(backup.raw,'live'));adapter.setDotCandidateStatus([ids[0]],'pending');
  const old=adapter.previewBackup(backup.raw);assert.equal(old.summary.candidates,0);assert.equal(old.summary.skippedCandidates,3);assert.equal(old.next.dot_candidates[0].status,'pending');
  storage.delete(adapter.storageKey);const restored=new FeedDataAdapter();restored.feedData=structuredClone(feed);const preview=restored.previewBackup(backup.raw);assert.equal(preview.summary.candidates,3);assert.equal(preview.summary.hasChanges,true);restored.restoreBackup(preview);
  assert.deepEqual(restored.localState.dot_candidates,JSON.parse(backup.raw).state.dot_candidates);assert.equal(restored.getState().dotFeaturedItems.length,1);assert.equal(restored.getState().savedItems.length,1);assert.equal(restored.previewBackup(backup.raw).summary.hasChanges,false);
  const forged=JSON.parse(backup.raw);forged.state.dot_candidates[0].item.verification_status='verified';assert.throws(()=>parseBackup(JSON.stringify(forged),'live'));
  const snapshot=JSON.parse(backup.raw);snapshot.state.item_snapshots[ids[0]].summary='改写成原文';assert.throws(()=>parseBackup(JSON.stringify(snapshot),'live'));
});

test('invalid Dot state cannot erase unrelated existing user bookmarks on reload',()=>{
  const {adapter,storage}=setup(),item={id:'github-1',title:'原收藏',summary:'原内容',source_refs:['github'],original_url:'https://github.com/example/tool'};
  const saved=structuredClone(adapter.localState);saved.saved_item_ids=[item.id];saved.item_snapshots[item.id]=item;saved.dot_candidates=[{bad:true}];storage.set(adapter.storageKey,JSON.stringify(saved));
  const loaded=new FeedDataAdapter();loaded.feedData=structuredClone(feed);assert.equal(loaded.getState().savedItems[0].title,'原收藏');assert.equal(loaded.getState().dotCandidates.length,0);
  const encoded=storage.get(adapter.storageKey);assert.match(loaded.getState().dotStorageWarning,/原存储没有被覆盖/);
  assert.throws(()=>loaded.importDotCandidates(raw()),/暂停保存/);assert.equal(storage.get(adapter.storageKey),encoded);
  assert.throws(()=>loaded.setSaved(item.id,false),/暂停保存/);assert.equal(storage.get(adapter.storageKey),encoded);
  assert.throws(()=>loaded._persistLocalState(),/暂停保存/);assert.equal(storage.get(adapter.storageKey),encoded);
});

test('feedgrab imports only pending records and requires manual selection with its real source',()=>{
  const {adapter}=setup(),payload=JSON.parse(raw());payload.collector='feedgrab';
  Object.assign(payload.items[0],{bookmark_count:null,like_count:null,view_count:null});
  const result=adapter.importDotCandidates(JSON.stringify(payload)),id=result.importedIds[0];
  assert.equal(adapter.getState().dotPendingCandidates.length,1);assert.equal(adapter.getState().dotFeaturedItems.length,0);assert.equal(adapter.getState().allItems.length,0);
  assert.equal(adapter.getState().sourceMap.get('feedgrab-import').name,'feedgrab 素材');assert.equal(adapter.getState().sourceMap.has('dot-import'),false);
  adapter.setDotCandidateStatus([id],'featured');assert.equal(adapter.getState().itemMap.get(id).origin,'feedgrab_import');
  const task=adapter.saveFollowupDraft(id,'核对原帖再决定'),output=adapter.exportFollowupText(task.id);
  assert.match(output,/feedgrab 采集材料，尚未独立核验/);assert.match(output,/feedgrab 报告热度：收藏 未知；点赞 未知；浏览 未知/);
  assert.doesNotMatch(output,/Dot|用户已经使用|核实状态：verified/);
  const reload=new FeedDataAdapter();reload.feedData=structuredClone(feed);assert.equal(reload.getState().dotFeaturedItems[0].collector,'feedgrab');
});

test('cross-collector duplicate observations never overwrite older originals or manual review choices',()=>{
  const {adapter}=setup(),first=adapter.importDotCandidates(raw()),id=first.importedIds[0];adapter.setDotCandidateStatus([id],'featured');
  const before=structuredClone(adapter.localState.dot_candidates),payload=JSON.parse(raw());payload.collector='feedgrab';payload.items[0].bookmark_count=null;payload.items[0].summary_zh='另一采集者的新摘要';
  const result=adapter.importDotCandidates(JSON.stringify(payload));assert.equal(result.added,0);assert.equal(result.duplicates,1);assert.deepEqual(adapter.localState.dot_candidates,before);
  const fresh=material('2108148604447883465'),newRaw={...payload,items:[fresh]};adapter.importDotCandidates(JSON.stringify(newRaw));
  assert.deepEqual(adapter.getState().dotCandidates.map(record=>record.batch.collector),['Dot','feedgrab']);
  assert.equal(adapter.getState().sourceMap.get('dot-import').name,'Dot 素材');assert.equal(adapter.getState().sourceMap.get('feedgrab-import').name,'feedgrab 素材');
});

test('feedgrab backup and curated export preserve originals and reject forged source or verified labels',()=>{
  const {adapter,storage}=setup(),payload=JSON.parse(raw());payload.collector='feedgrab';const id=adapter.importDotCandidates(JSON.stringify(payload)).importedIds[0];
  adapter.setDotCandidateStatus([id],'featured');adapter.setSaved(id,true);const backup=adapter.createBackup(),original=JSON.parse(backup.raw);
  assert.doesNotThrow(()=>parseBackup(backup.raw,'live'));assert.equal(JSON.parse(adapter.createDotFeaturedExport().raw).items[0].batch.collector,'feedgrab');
  storage.delete(adapter.storageKey);const restored=new FeedDataAdapter();restored.feedData=structuredClone(feed);restored.restoreBackup(restored.previewBackup(backup.raw));
  assert.deepEqual(restored.localState.dot_candidates,original.state.dot_candidates);assert.equal(restored.getState().savedItems[0].summary_label,'feedgrab 采集');
  for (const edit of [value=>value.state.dot_candidates[0].item.origin='dot_import',value=>value.state.item_snapshots[id].verification_status='verified',value=>value.state.item_snapshots[id].collector='Dot']) {
    const bad=structuredClone(original);edit(bad);assert.throws(()=>parseBackup(JSON.stringify(bad),'live'));
  }
});

test('public source export cannot publish privately imported feedgrab materials even when IDs and refs imitate public records',()=>{
  const {adapter}=setup(),payload=JSON.parse(raw());payload.collector='feedgrab';const id=adapter.importDotCandidates(JSON.stringify(payload)).importedIds[0];adapter.setDotCandidateStatus([id],'featured');
  const ordinary={id:'news-aaaaaaaaaaaaaaaaaaaaaaaa',title:'公开来源文章',summary:'公开摘要',original_url:'https://example.com/public-article',source_refs:['github'],captured_at:time};
  const privateItem={...adapter.getState().dotFeaturedItems[0],id:'news-bbbbbbbbbbbbbbbbbbbbbbbb',source_refs:['github']};
  const input={schema_version:'0.3',mode:'live',sources:[{id:'github',name:'公开来源',home_url:'https://github.com',status:'ok',last_success_at:time}],items:[ordinary,privateItem],dot_candidates:adapter.localState.dot_candidates};
  const result=makePublicFeed(input,{publishedAt:time});
  assert.deepEqual(result.items.map(item=>item.id),[ordinary.id]);assert.equal(Object.hasOwn(result,'dot_candidates'),false);
  assert.doesNotMatch(JSON.stringify(result),/检查示例|feedgrab/);
});
