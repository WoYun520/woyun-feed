import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedDataAdapter } from './src/dataAdapter.js';
import { parseBackup } from './src/backup.js';
import { renderCollectionItem, selectCollection } from './src/collectionViews.js';
import { renderSourceBoard } from './src/sourceBoard.js';

const item={id:'github-1',title:'tool',summary:'Original description',original_url:'https://github.com/example/tool',canonical_url:'https://github.com/example/tool',source_refs:['github'],captured_at:'2026-10-01T00:00:00Z',content_status:'metadata_only',repository_guide:{summary:'整理视频字幕。',basis:'description',source_url:'https://github.com/example/tool',recorded_at:'2026-10-01T00:00:00Z',verification:'not_tested'}};
const second={...item,id:'github-2',original_url:'https://github.com/example/another',canonical_url:'https://github.com/example/another'};
const feed={mode:'live',schema_version:'0.3',profile:{},items:[item,second],sources:[{id:'github',name:'GitHub 小型工具',kind:'repository',group:'tech',home_url:'https://github.com/'}],sections:{daily:[],discover:[]}};
const setup=()=>{
  const storage=new Map();globalThis.localStorage={getItem:key=>storage.get(key) ?? null,setItem:(key,value)=>storage.set(key,value)};
  globalThis.fetch=()=>{throw Error('Collection must not call AI or fetch');};
  const adapter=new FeedDataAdapter();adapter.feedData=structuredClone(feed);return {adapter,storage};
};

test('one-click saves are idempotent and preserve the collected source after updates and rotation',()=>{
  const {adapter}=setup(),original=structuredClone(adapter.feedData);
  adapter.setSaved(item.id,true);adapter.setSaved(item.id,true);
  assert.equal(adapter.getState().savedItems.length,1);assert.equal(adapter.localState.topics.length,0);assert.equal(adapter.localState.followups.length,0);
  assert.deepEqual(adapter.feedData,original);
  adapter.feedData.items[0].summary='New author description';adapter.feedData.items[0].repository_guide.summary='新的介绍';
  adapter.setSaved(item.id,true);assert.deepEqual(adapter.getState().savedItems[0],item);
  adapter.rememberItem(item.id);assert.deepEqual(adapter.localState.item_snapshots[item.id],item);
  adapter.feedData.items=[];const reload=new FeedDataAdapter();reload.feedData={...structuredClone(feed),items:[]};
  assert.deepEqual(reload.getState().savedItems[0],item);
});

test('merged source aliases share one bookmark and cancelling never removes topic materials or notes',()=>{
  const {adapter}=setup();adapter.setSaved(item.id,true);adapter.saveCollectionNote(item.id,'想做一次真实试用');
  const topic=adapter.createTopic({title:'试用教程'},item.id);
  const merged={...item,id:'news-123456789012345678901234',alias_ids:[item.id],summary:'Updated merged source'};
  adapter.feedData.items=[merged];adapter.setSaved(merged.id,true);
  assert.equal(adapter.getState().savedItems.length,1);assert.ok(adapter.getState().savedItemIds.has(merged.id));
  assert.equal(adapter.collectionNote(merged.id),'想做一次真实试用');
  adapter.setSaved(merged.id,false);assert.equal(adapter.getState().savedItems.length,0);
  assert.equal(adapter.localState.topics[0].materials.length,1);assert.equal(adapter.localState.saved_item_notes[item.id].note,'想做一次真实试用');
  adapter.setSaved(item.id,true);assert.equal(adapter.getState().savedItems.length,1);
  assert.match(adapter.exportTopic(topic.id),/想做一次真实试用/);
});

test('personal notes carry into new topic material while preserving source and existing topic notes',()=>{
  const {adapter}=setup();adapter.setSaved(item.id,true);adapter.saveCollectionNote(item.id,'收藏时的想法');
  adapter.feedData.items[0].summary='Changed later';
  const one=adapter.createTopic({title:'主题一'},item.id);
  assert.equal(one.materials[0].note,'收藏时的想法');assert.equal(one.materials[0].item.summary,item.summary);
  adapter.saveCollectionNote(item.id,'之后的新想法');assert.equal(adapter.localState.topics[0].materials[0].note,'收藏时的想法');
  const two=adapter.createTopic({title:'主题二'});adapter.addToTopic(two.id,item.id);
  assert.equal(adapter.localState.topics.find(t=>t.id===two.id).materials[0].note,'之后的新想法');
  const three=adapter.createTopic({title:'主题三'},item.id,'单独写的理由');assert.equal(three.materials[0].note,'单独写的理由');
  assert.match(adapter.exportTopic(two.id),/\*\*收藏时的来源简介或摘要\*\*\n\n> Original description/);assert.match(adapter.exportTopic(two.id),/\*\*我为什么留下它\*\*\n\n> 之后的新想法/);
  assert.throws(()=>adapter.saveCollectionNote(item.id,'api_key='+'A'.repeat(30)),/密钥/);
  assert.throws(()=>adapter.saveCollectionNote(item.id,'x'.repeat(2001)),/2000/);
  assert.deepEqual(adapter.localState.item_snapshots[item.id],item);
});

test('failed writes and newer tabs protect bookmarks and the personal note being edited',()=>{
  const {adapter,storage}=setup();adapter.setSaved(item.id,true);adapter.saveCollectionNote(item.id,'原想法');
  const previous=structuredClone(adapter.localState),encoded=storage.get(adapter.storageKey);
  globalThis.localStorage.setItem=()=>{throw Error('Full');};
  assert.throws(()=>adapter.setSaved(second.id,true),/本地存储/);assert.deepEqual(adapter.localState,previous);
  assert.throws(()=>adapter.setSaved(item.id,false),/本地存储/);assert.deepEqual(adapter.localState,previous);
  assert.throws(()=>adapter.saveCollectionNote(item.id,'新想法'),/本地存储/);assert.deepEqual(adapter.localState,previous);assert.equal(storage.get(adapter.storageKey),encoded);
  storage.set(adapter.storageKey,'{"newer":true}');
  assert.throws(()=>adapter.setSaved(item.id,false),/另一个页面/);assert.throws(()=>adapter.saveCollectionNote(item.id,'新想法'),/另一个页面/);
  assert.deepEqual(adapter.localState,previous);
});

test('backup restores notes and snapshots, supports old files and keeps current personal edits',()=>{
  const {adapter,storage}=setup();adapter.setSaved(item.id,true);adapter.saveCollectionNote(item.id,'旧想法');
  const backup=adapter.createBackup();adapter.saveCollectionNote(item.id,'更新后的想法');
  assert.equal(adapter.previewBackup(backup.raw).summary.hasChanges,false);assert.equal(adapter.previewBackup(backup.raw).next.saved_item_notes[item.id].note,'更新后的想法');
  storage.delete(adapter.storageKey);const other=new FeedDataAdapter();other.feedData=structuredClone(feed);const preview=other.previewBackup(backup.raw);
  assert.equal(preview.summary.notes,1);other.restoreBackup(preview);assert.equal(other.collectionNote(item.id),'旧想法');assert.deepEqual(other.getState().savedItems[0],item);
  other.setSaved(item.id,false);assert.ok(parseBackup(other.createBackup().raw,'live').state.item_snapshots[item.id]);
  const old=JSON.parse(backup.raw);delete old.state.saved_item_notes;assert.doesNotThrow(()=>parseBackup(JSON.stringify(old),'live'));
  const bad=JSON.parse(backup.raw);bad.state.saved_item_notes[item.id].note='password='+'X'.repeat(25);assert.throws(()=>parseBackup(JSON.stringify(bad),'live'),/密码|密钥/);
});

test('boards expose one-click bookmarks and saved cards distinguish escaped personal notes from sources',()=>{
  const {adapter}=setup();adapter.setSaved(item.id,true);adapter.saveCollectionNote(item.id,'<b>我的想法</b>');
  const state=adapter.getState(),app={escapeHtml:v=>String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),safeUrl:v=>v || '#',formatTime:v=>v,sourceLimits:{},boardGroup:'all',openRepositoryDetails:new Set()};
  const board=renderSourceBoard(app,state),card=renderCollectionItem(app,state.savedItems[0],state);
  assert.match(board,/data-action="toggle-save"/);assert.doesNotMatch(board,/data-action="topic-save"/);assert.match(board,/aria-pressed="true"/);
  assert.match(card,/整理视频字幕/);assert.match(card,/Original description/);assert.match(card,/&lt;b&gt;我的想法&lt;\/b&gt;/);
  assert.match(card,/放进主题/);assert.match(card,/尚未实测/);assert.match(card,/稍后整理/);
});

test('collection search uses saved sources, Chinese purposes and personal notes with literal AND keywords',()=>{
  const {adapter}=setup();adapter.setSaved(item.id,true);adapter.setSaved(second.id,true);adapter.saveCollectionNote(item.id,'想试 C++，先核对费用');
  const state=adapter.getState(),before=structuredClone(adapter.localState);
  assert.deepEqual(selectCollection(state,{query:'字幕 费用'}).items.map(i=>i.id),[item.id]);
  assert.deepEqual(selectCollection(state,{query:'c++'}).items.map(i=>i.id),[item.id]);
  assert.equal(selectCollection(state,{query:'ＯＲＩＧＩＮＡＬ'}).items.length,2);
  assert.equal(selectCollection(state,{query:'github'}).items.length,2);
  assert.equal(selectCollection(state,{query:'只有网页全文中才有的句子'}).items.length,0);
  assert.deepEqual(adapter.localState,before);
  adapter.setArchived(item.id,true);
  assert.equal(selectCollection(adapter.getState(),{query:'费用'}).items.length,0);
  assert.deepEqual(selectCollection(adapter.getState(),{archived:true,query:'费用'}).items.map(i=>i.id),[item.id]);
});

test('archive and restore preserve snapshots, notes, topic evidence and bookmarked source aliases',()=>{
  const {adapter}=setup();adapter.setSaved(item.id,true);adapter.saveCollectionNote(item.id,'收藏想法');const topic=adapter.createTopic({title:'保留主题'},item.id);
  const before=structuredClone(adapter.localState.topics),snapshot=structuredClone(adapter.localState.item_snapshots);
  adapter.setArchived(item.id,true);adapter.setArchived(item.id,true);
  assert.equal(adapter.getState().activeSavedItems.length,0);assert.equal(adapter.getState().archivedItems.length,1);assert.equal(adapter.getState().savedItems.length,1);
  assert.deepEqual(adapter.localState.topics,before);assert.deepEqual(adapter.localState.item_snapshots,snapshot);assert.match(adapter.exportTopic(topic.id),/收藏想法/);
  const merged={...item,id:'news-123456789012345678901234',alias_ids:[item.id]};adapter.feedData.items=[merged,second];
  assert.ok(adapter.getState().archivedItemIds.has(merged.id));adapter.setArchived(merged.id,false);
  assert.equal(adapter.getState().activeSavedItems.length,1);assert.equal(adapter.collectionNote(item.id),'收藏想法');
  adapter.setArchived(merged.id,true);const reload=new FeedDataAdapter();reload.feedData=structuredClone(adapter.feedData);
  assert.equal(reload.getState().archivedItems[0].id,item.id);
  assert.throws(()=>adapter.setArchived(second.id,true),/请先收藏/);
});

test('archive failures and atomic undo retain the previous collection and block newer-tab overwrites',()=>{
  const {adapter,storage}=setup();adapter.setSaved(item.id,true);adapter.saveCollectionNote(item.id,'原想法');
  const saved=structuredClone(adapter.localState);globalThis.localStorage.setItem=()=>{throw Error('Full');};
  assert.throws(()=>adapter.setArchived(item.id,true),/本地存储/);assert.deepEqual(adapter.localState,saved);
  globalThis.localStorage.setItem=(key,value)=>storage.set(key,value);adapter.setArchived(item.id,true);adapter.setSaved(item.id,false);
  assert.equal(adapter.getState().archivedItems.length,0);
  const cancelled=structuredClone(adapter.localState);globalThis.localStorage.setItem=()=>{throw Error('Full');};
  assert.throws(()=>adapter.restoreSaved(item.id,{archived:true}),/本地存储/);assert.deepEqual(adapter.localState,cancelled);
  globalThis.localStorage.setItem=(key,value)=>storage.set(key,value);adapter.restoreSaved(item.id,{archived:true});
  assert.equal(adapter.getState().archivedItems.length,1);assert.equal(adapter.collectionNote(item.id),'原想法');
  const before=structuredClone(adapter.localState);storage.set(adapter.storageKey,'{"newer":true}');
  assert.throws(()=>adapter.setArchived(item.id,false),/另一个页面/);assert.deepEqual(adapter.localState,before);
});

test('backup restores archive for new material while preserving current active status and rejecting orphan flags',()=>{
  const {adapter,storage}=setup();adapter.setSaved(item.id,true);adapter.setArchived(item.id,true);const backup=adapter.createBackup();
  adapter.setArchived(item.id,false);assert.equal(adapter.previewBackup(backup.raw).summary.hasChanges,false);
  assert.deepEqual(adapter.previewBackup(backup.raw).next.archived_item_ids,[]);
  const incoming=JSON.parse(backup.raw),alias='news-123456789012345678901234';
  incoming.state.saved_item_ids=[alias];incoming.state.archived_item_ids=[alias];incoming.state.item_snapshots[alias]={...item,id:alias,alias_ids:[item.id]};
  assert.equal(adapter.previewBackup(JSON.stringify(incoming)).summary.archived,0);
  storage.delete(adapter.storageKey);const other=new FeedDataAdapter();other.feedData=structuredClone(feed);const preview=other.previewBackup(backup.raw);
  assert.equal(preview.summary.archived,1);other.restoreBackup(preview);assert.equal(other.getState().archivedItems.length,1);
  const old=JSON.parse(backup.raw);delete old.state.archived_item_ids;assert.doesNotThrow(()=>parseBackup(JSON.stringify(old),'live'));
  const bad=JSON.parse(backup.raw);bad.state.archived_item_ids=[second.id];assert.throws(()=>parseBackup(JSON.stringify(bad),'live'),/归档/);
});

test('archived source bookmarks offer restore and archive cards retain topic, note and original excerpt actions',()=>{
  const {adapter}=setup();adapter.setSaved(item.id,true);adapter.saveCollectionNote(item.id,'稍后继续');adapter.setArchived(item.id,true);
  const state=adapter.getState(),app={escapeHtml:v=>String(v || '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),safeUrl:v=>v || '#',formatTime:v=>v,sourceLimits:{},boardGroup:'all',openRepositoryDetails:new Set()};
  const board=renderSourceBoard(app,state),card=renderCollectionItem(app,state.archivedItems[0],state);
  assert.match(board,/data-action="restore-collection"/);assert.match(board,/恢复到收藏/);
  assert.match(card,/已归档/);assert.match(card,/稍后继续/);assert.match(card,/Original description/);assert.match(card,/放进主题/);
});
