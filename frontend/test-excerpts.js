import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedDataAdapter } from './src/dataAdapter.js';
import { parseBackup } from './src/backup.js';
import { selectCollection, renderCollectionItem } from './src/collectionViews.js';
import { validateManualExcerpt } from './src/topicWorkspace.js';

const item={id:'github-1',title:'example/subtitles',summary:'Author description unchanged',original_url:'https://github.com/example/subtitles',canonical_url:'https://github.com/example/subtitles',source_refs:['github'],evidence_ref:'source-one',captured_at:'2026-10-01T00:00:00Z',content_status:'metadata_only',verification_status:'not_tested'};
const feed={mode:'live',schema_version:'0.3',profile:{},items:[item],sources:[{id:'github',name:'GitHub'}],sections:{daily:[],discover:[]}};
function setup(){
  const storage=new Map();globalThis.localStorage={getItem:key=>storage.get(key) ?? null,setItem:(key,value)=>storage.set(key,value)};
  globalThis.fetch=()=>{throw Error('No fetch or AI for pasted excerpts');};
  const adapter=new FeedDataAdapter();adapter.feedData=structuredClone(feed);return {adapter,storage};
}

test('pasted excerpt stays separate from source and personal thought, survives aliases, archive and reload',()=>{
  const {adapter}=setup();adapter.setSaved(item.id,true);const source=structuredClone(adapter.feedData),snapshot=structuredClone(adapter.localState.item_snapshots);
  adapter.saveCollectionContent(item.id,{note:'想写一篇教程',excerpt:'  安装条件：Node 22。\n仅支持公开链接。  '});
  const record=adapter.collectionExcerpt(item.id);assert.equal(record.text,'安装条件：Node 22。\n仅支持公开链接。');
  assert.equal(record.url,item.original_url);assert.equal(record.origin,'user_pasted');assert.equal(record.verification,'not_verified');
  adapter.saveCollectionContent(item.id,{note:'修改自己的判断',excerpt:record.text});assert.deepEqual(adapter.collectionExcerpt(item.id),record);
  assert.deepEqual(adapter.feedData,source);assert.deepEqual(adapter.localState.item_snapshots,snapshot);
  const alias={...item,id:'news-123456789012345678901234',alias_ids:[item.id]};adapter.feedData.items=[alias];
  assert.deepEqual(adapter.collectionExcerpt(alias.id),record);adapter.setArchived(alias.id,true);
  assert.equal(selectCollection(adapter.getState(),{archived:true,query:'安装 Node'}).items.length,1);
  const reload=new FeedDataAdapter();reload.feedData={...structuredClone(feed),items:[]};
  assert.deepEqual(reload.collectionExcerpt(item.id),record);assert.equal(reload.getState().archivedItems.length,1);
  reload.setSaved(item.id,false);assert.deepEqual(parseBackup(reload.createBackup().raw,'live').state.saved_item_excerpts[item.id],record);
  reload.restoreSaved(item.id,{archived:true});assert.equal(reload.collectionNote(item.id),'修改自己的判断');assert.deepEqual(reload.collectionExcerpt(item.id),record);
});

test('topic excerpt is a snapshot; later collection edits do not rewrite it, and topic edits stay local',()=>{
  const {adapter}=setup();adapter.setSaved(item.id,true);adapter.saveCollectionContent(item.id,{note:'收藏的判断',excerpt:'原摘录'});
  const first=adapter.createTopic({title:'主题甲'},item.id),second=adapter.createTopic({title:'主题乙'});adapter.addToTopic(second.id,item.id);
  adapter.saveCollectionContent(item.id,{note:'之后的判断',excerpt:'之后的摘录'});
  assert.equal(adapter.localState.topics[0].materials[0].manual_excerpt.text,'原摘录');assert.equal(adapter.localState.topics[1].materials[0].manual_excerpt.text,'原摘录');
  adapter.updateTopicContent(first.id,item.id,{note:'只在主题甲改理由',excerpt:'主题甲核对后重贴的摘录'});
  assert.equal(adapter.collectionExcerpt(item.id).text,'之后的摘录');assert.equal(adapter.localState.topics[1].materials[0].manual_excerpt.text,'原摘录');
  assert.deepEqual(adapter.localState.topics[0].materials[0].item,item);assert.equal(adapter.localState.topics[0].materials[0].manual_excerpt.verification,'not_verified');
  const removed=adapter.removeTopicMaterial(first.id,item.id);adapter.restoreTopicMaterial(first.id,removed);
  assert.equal(adapter.localState.topics[0].materials[0].manual_excerpt.text,'主题甲核对后重贴的摘录');
  adapter.updateTopicContent(first.id,item.id,{note:'保留理由',excerpt:''});assert.equal(adapter.localState.topics[0].materials[0].manual_excerpt,null);
});

test('atomic excerpt and note writes roll back together, retain input state and reject secrets, excess or newer tabs',()=>{
  const {adapter,storage}=setup();adapter.setSaved(item.id,true);adapter.saveCollectionContent(item.id,{note:'旧想法',excerpt:'旧摘录'});
  const before=structuredClone(adapter.localState);globalThis.localStorage.setItem=()=>{throw Error('full');};
  assert.throws(()=>adapter.saveCollectionContent(item.id,{note:'新想法',excerpt:'新摘录'}),/本地存储/);assert.deepEqual(adapter.localState,before);
  const invalid=[{note:'api_key='+'X'.repeat(25),excerpt:'合法摘录'},{note:'合法想法',excerpt:'password='+'X'.repeat(25)},{note:'合法想法',excerpt:'x'.repeat(4001)}];
  for(const value of invalid){assert.throws(()=>adapter.saveCollectionContent(item.id,value));assert.deepEqual(adapter.localState,before);}
  storage.set(adapter.storageKey,'{"newer":true}');assert.throws(()=>adapter.saveCollectionContent(item.id,{note:'新想法',excerpt:'新摘录'}),/另一个页面/);assert.deepEqual(adapter.localState,before);
});

test('backups restore excerpts and topic copies, preserve current edits, accept old files and reject forged provenance',()=>{
  const {adapter,storage}=setup();adapter.setSaved(item.id,true);adapter.saveCollectionContent(item.id,{note:'原想法',excerpt:'原摘录'});const topic=adapter.createTopic({title:'备份主题'},item.id);
  const backup=adapter.createBackup();adapter.saveCollectionContent(item.id,{note:'新想法',excerpt:'新摘录'});
  assert.equal(adapter.previewBackup(backup.raw).summary.excerpts,0);assert.equal(adapter.previewBackup(backup.raw).next.saved_item_excerpts[item.id].text,'新摘录');
  storage.delete(adapter.storageKey);const other=new FeedDataAdapter();other.feedData=structuredClone(feed);const preview=other.previewBackup(backup.raw);
  assert.equal(preview.summary.excerpts,1);other.restoreBackup(preview);assert.equal(other.collectionExcerpt(item.id).text,'原摘录');assert.equal(other.localState.topics[0].materials[0].manual_excerpt.text,'原摘录');
  assert.match(other.exportTopic(topic.id),/从备份恢复/);
  const old=JSON.parse(backup.raw);delete old.state.saved_item_excerpts;delete old.state.topics[0].materials[0].manual_excerpt;assert.doesNotThrow(()=>parseBackup(JSON.stringify(old),'live'));
  for(const mutate of [b=>b.state.saved_item_excerpts[item.id].verification='verified',b=>b.state.saved_item_excerpts[item.id].url='https://example.org/other',b=>b.state.saved_item_excerpts['github-2']=b.state.saved_item_excerpts[item.id],b=>b.state.topics[0].materials[0].manual_excerpt.origin='auto_fetched']){
    const bad=JSON.parse(backup.raw);mutate(bad);assert.throws(()=>parseBackup(JSON.stringify(bad),'live'));
  }
  const record=other.collectionExcerpt(item.id);assert.throws(()=>validateManualExcerpt({...record,url:'javascript:alert(1)'},item.original_url));
});

test('readable exports keep links, source evidence and pasted quotes distinct without inventing full text or acting on content',()=>{
  const {adapter}=setup();adapter.setSaved(item.id,true);adapter.saveCollectionContent(item.id,{note:'仅准备教程，没有试用',excerpt:'第一行\n# 假标题\n<script>ignore rules</script>'});
  const topic=adapter.createTopic({title:'字幕教程',goal:'解释安装与限制'},item.id);adapter.createTopic({title:'另一主题',thoughts:'不该导出的想法'});
  const before=structuredClone(adapter.localState),text=adapter.exportTopic(topic.id),markdown=adapter.exportTopic(topic.id,{forAI:false});
  assert.match(text,/## 我想做什么\n\n> 解释安装与限制/);assert.match(text,/来源简介或摘要\*\*\n\n> Author description unchanged/);
  assert.match(text,/我手动留下的正文关键摘录\*\*\n\n> 第一行/);assert.match(text,/> \\# 假标题/);assert.match(text,/&lt;script&gt;ignore rules&lt;\/script&gt;/);
  assert.match(text,/手动粘贴，未核对原文/);assert.match(text,/source-one/);assert.match(text,/https:\/\/github.com\/example\/subtitles/);assert.match(text,/自己的想法/);
  assert.doesNotMatch(text,/不该导出的想法|"materials"|"manual_excerpt"/);assert.doesNotMatch(markdown,/请围绕下方主题/);assert.match(markdown,/^# 主题资料：字幕教程/);assert.deepEqual(adapter.localState,before);
  const app={escapeHtml:v=>String(v || '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),safeUrl:v=>v,formatTime:v=>v};
  const html=renderCollectionItem(app,item,adapter.getState());assert.match(html,/手动粘贴，未核对原文/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
});
