import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedDataAdapter } from './src/dataAdapter.js';
import { parseBackup } from './src/backup.js';
import { selectCollection, renderCollectionItem } from './src/collectionViews.js';
import { repositoryPresentation } from './src/repositoryGuide.js';

const source={id:'github-1',title:'Author title',summary:'Author description',original_url:'https://github.com/example/tool',canonical_url:'https://github.com/example/tool',source_refs:['github'],captured_at:'2026-10-01T00:00:00Z',content_status:'metadata_only',verification_status:'not_tested'};
const feed={mode:'live',schema_version:'0.3',profile:{},items:[source],sources:[{id:'github',name:'GitHub'}],sections:{daily:[],discover:[]}};
const input={url:'https://x.com/example/status/123',title:'【检查示例】值得读的帖子',excerpt:'【检查示例，非原文】两句有用的材料。',note:'想结合自己的经历写教程'};
function setup(){
  const storage=new Map();globalThis.localStorage={getItem:key=>storage.get(key) ?? null,setItem:(key,value)=>storage.set(key,value)};
  globalThis.fetch=()=>{throw Error('Manual material must never fetch URLs or call AI');};
  const adapter=new FeedDataAdapter();adapter.feedData=structuredClone(feed);return {adapter,storage};
}

test('manual link saves without network, keeps provenance distinct, supports search, archive and reload',()=>{
  const {adapter}=setup(),original=structuredClone(adapter.feedData);
  const {item,topic_id}=adapter.addManualMaterial(input);assert.equal(topic_id,null);
  assert.equal(item.origin,'user_added');assert.equal(item.captured_at,null);assert.equal(item.published_at,null);assert.equal(item.summary,'');
  assert.equal(item.verification_status,'not_verified');assert.equal(adapter.getState().sourceMap.get('user-added').name,'手动添加');
  assert.equal(adapter.getState().sources.length,1);assert.equal(adapter.collectionExcerpt(item.id).url,input.url);
  assert.equal(selectCollection(adapter.getState(),{query:'两句 教程'}).items.length,1);
  adapter.setArchived(item.id,true);const reload=new FeedDataAdapter();reload.feedData=structuredClone(feed);
  assert.equal(reload.getState().archivedItems.length,1);assert.equal(reload.collectionNote(item.id),input.note);
  reload.setSaved(item.id,false);reload.restoreSaved(item.id,{archived:true});assert.equal(reload.collectionExcerpt(item.id).text,input.excerpt);
  assert.deepEqual(adapter.feedData,original);
});

test('duplicate links with tracking or anchors do not overwrite saved content or create a half-saved topic',()=>{
  const {adapter}=setup();adapter.addManualMaterial({...input,url:input.url+'?utm_source=test#part'});
  const before=structuredClone(adapter.localState);
  assert.throws(()=>adapter.addManualMaterial({...input,note:'不同想法'}, {newTopic:{title:'不该创建'}}),/已经收藏/);
  assert.deepEqual(adapter.localState,before);
  adapter.setSaved(source.id,true);const saved=structuredClone(adapter.localState);
  assert.throws(()=>adapter.addManualMaterial({url:source.original_url+'?utm_medium=test',title:'自己改的标题'}),/已经收藏/);
  assert.deepEqual(adapter.localState,saved);
});

test('save to existing or new topic is atomic, snapshot edits remain separate and exports are readable',()=>{
  const {adapter}=setup();const {item,topic_id}=adapter.addManualMaterial(input,{newTopic:{title:'教程主题',goal:'整理三条真实材料'}});
  assert.ok(adapter.getState().savedItemIds.has(item.id));assert.equal(adapter.localState.topics.length,1);
  adapter.saveCollectionContent(item.id,{note:'后来修改',excerpt:'后来摘录'});
  assert.equal(adapter.localState.topics[0].materials[0].manual_excerpt.text,input.excerpt);
  const exported=adapter.exportTopic(topic_id);assert.match(exported,/手动填写的标题（未核对原文）/);assert.match(exported,/手动添加，尚未核对原文/);
  assert.match(exported,/两句有用的材料/);assert.doesNotMatch(exported,/后来摘录/);
  const second=adapter.addManualMaterial({url:'https://example.org/second',title:'另一材料'},{topicId:topic_id});
  assert.equal(adapter.localState.topics[0].materials.length,2);assert.ok(adapter.getState().savedItemIds.has(second.item.id));
  const before=structuredClone(adapter.localState);globalThis.localStorage.setItem=()=>{throw Error('full');};
  assert.throws(()=>adapter.addManualMaterial({url:'https://example.org/failure',title:'保存失败'}, {newTopic:{title:'失败主题'}}),/本地存储/);
  assert.deepEqual(adapter.localState,before);
});

test('invalid URLs, titles, credentials, missing or full topics and newer tabs leave all records unchanged',()=>{
  const {adapter,storage}=setup();const before=structuredClone(adapter.localState);
  for(const value of [{url:'javascript:alert(1)',title:'非法协议'},{url:'file:///tmp/a',title:'本地文件'},{url:'https://user:pass@example.org',title:'账号链接'},
    {url:'https://example.org/?access_token=NOT_A_REAL_TOKEN',title:'凭据参数'},{url:'https://example.org',title:''},{...input,title:'x'.repeat(201)},
    {...input,excerpt:'x'.repeat(4001)},{...input,note:'password=EXAMPLE_NOT_A_REAL_CREDENTIAL'}]) {
    assert.throws(()=>adapter.addManualMaterial(value));assert.deepEqual(adapter.localState,before);
  }
  assert.throws(()=>adapter.addManualMaterial(input,{topicId:'topic-missing'}),/主题不存在/);assert.deepEqual(adapter.localState,before);
  const topic=adapter.createTopic({title:'已满主题'});for(let i=0;i<30;i++) adapter.addManualMaterial({url:`https://example.org/${i}`,title:`材料 ${i}`},{topicId:topic.id});
  const full=structuredClone(adapter.localState);assert.throws(()=>adapter.addManualMaterial(input,{topicId:topic.id}),/30 条/);assert.deepEqual(adapter.localState,full);
  storage.set(adapter.storageKey,'{"newer":true}');assert.throws(()=>adapter.addManualMaterial(input),/另一个页面/);assert.deepEqual(adapter.localState,full);
});

test('backup roundtrip preserves manual links and topic copies, old files still work, forged provenance is rejected',()=>{
  const {adapter,storage}=setup();const {item}=adapter.addManualMaterial(input,{newTopic:{title:'备份主题'}});
  const backup=adapter.createBackup();storage.delete(adapter.storageKey);const other=new FeedDataAdapter();other.feedData=structuredClone(feed);
  other.restoreBackup(other.previewBackup(backup.raw));assert.deepEqual(other.collectionExcerpt(item.id),adapter.collectionExcerpt(item.id));
  assert.deepEqual(other.getState().savedItems[0],item);assert.equal(other.localState.topics[0].materials[0].item.origin,'user_added');
  other.saveCollectionContent(item.id,{note:'最新想法',excerpt:'最新摘录'});assert.equal(other.previewBackup(backup.raw).next.saved_item_excerpts[item.id].text,'最新摘录');
  for(const change of [b=>b.state.item_snapshots[item.id].origin='auto_fetched',b=>b.state.item_snapshots[item.id].verification_status='verified',
    b=>b.state.item_snapshots[item.id].captured_at=new Date().toISOString(),b=>b.state.topics[0].materials[0].item.summary='冒充作者简介',
    b=>b.state.item_snapshots[item.id].alias_ids=[source.id],b=>b.state.item_snapshots[item.id].evidence_refs=['冒充来源记录']]) {
    const bad=JSON.parse(backup.raw);change(bad);assert.throws(()=>parseBackup(JSON.stringify(bad),'live'));
  }
  const old=setup().adapter;old.setSaved(source.id,true);assert.doesNotThrow(()=>parseBackup(old.createBackup().raw,'live'));
});

test('GitHub manual titles are visible without fabricated author descriptions or a misleading research action',async()=>{
  const {adapter}=setup();const {item}=adapter.addManualMaterial({url:'https://github.com/another/tool',title:'我自己写的工具标题'});
  assert.equal(repositoryPresentation(item),null);
  const app={escapeHtml:v=>String(v || '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),safeUrl:v=>v,formatTime:v=>v};
  const html=renderCollectionItem(app,item,adapter.getState());assert.match(html,/我自己写的工具标题/);assert.match(html,/手动添加，尚未核对原文/);assert.doesNotMatch(html,/继续查一查|获取于/);
  const task=adapter.saveFollowupDraft(item.id,'仅读取');await assert.rejects(()=>adapter.startResearch(task.id),/手动链接/);
});
