import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedDataAdapter } from './src/dataAdapter.js';
import { PRACTICAL_ITEMS } from './src/practicalMaterials.js';
import { renderCollectionItem } from './src/collectionViews.js';
import { renderTopicWorkspace } from './src/topicViews.js';

const base = () => ({schema_version:'0.3',mode:'live',profile:{},sources:[],items:[],sections:{daily:[],discover:[]},generated_at:'2026-10-01T01:00:00Z',publication:{automatic_update:true,version:'old'},refresh:{new_item_ids:[],new_count:0},update_notice:'旧内容包'});
const prepare = feed => {
  const store=new Map();
  globalThis.localStorage={getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value)};
  const calls=[];
  globalThis.fetch=async (url,opts) => {calls.push({url,opts});return {ok:true,json:async()=>structuredClone(feed)};};
  return {store,calls};
};
test('both real adapters expose the supplement without changing upstream times, new IDs or requesting an extra service', async()=>{
  for(const publicPreview of [false,true]) {
    const original=base(),{calls}=prepare(original),adapter=new FeedDataAdapter({publicPreview});
    const state=await adapter.loadFeed();
    assert.equal(state.allItems.length,8);assert.equal(state.sources.length,1);
    assert.equal(state.generated_at,original.generated_at);assert.deepEqual(state.publication,original.publication);
    assert.deepEqual(state.refresh,original.refresh);assert.equal(state.dailyItems.length,0);
    assert.match(state.update_notice,/另附 8 条官方说明整理/);assert.match(state.update_notice,/不随云端定时更新/);
    assert.equal(calls.length,1);assert.equal(calls[0].url,publicPreview ? '/data/public-feed.json' : '/api/feed');
    await adapter.refreshFeed();assert.equal(adapter.getState().allItems.length,8);
    assert.equal(calls.length,2);
    assert.equal(JSON.stringify(original),JSON.stringify(base()));
  }
});
test('a curated tool survives save, refresh, topic, backup and reload with its complete scope', async()=>{
  const upstream=base(),{store}=prepare(upstream),adapter=new FeedDataAdapter({publicPreview:true});
  await adapter.loadFeed();const item=PRACTICAL_ITEMS[1];adapter.setSaved(item.id,true);
  const topic=adapter.createTopic({title:'字幕工具检查',goal:'对照官方操作'},item.id);
  const task=adapter.saveFollowupDraft(item.id,'只整理，不安装');
  await adapter.refreshFeed();
  const text=adapter.exportTopic(topic.id),taskText=adapter.exportFollowupText(task.id);
  for(const content of [text,taskText]) {
    for(const token of ['开始：','限制：','费用：',item.original_url,'AI 按官方说明整理','未实测']) assert.ok(content.includes(token),token);
  }
  assert.match(text,/本站整理的中文标题（非官方原始标题）/);
  assert.match(text,/AI 阅读官方说明时间/);assert.match(text,/不代表用户核验/);
  const backup=adapter.createBackup();assert.ok(backup.raw.includes(item.summary.split('\n')[0]));
  const reload=new FeedDataAdapter({publicPreview:true});await reload.loadFeed();
  assert.equal(reload.getState().savedItems[0].summary,item.summary);assert.equal(reload.getState().topics[0].materials[0].item.summary,item.summary);
  assert.ok(store.size>0);
  const app={escapeHtml:v=>String(v||''),safeUrl:v=>v,formatTime:v=>v,selectedTopicId:topic.id};
  assert.match(renderCollectionItem(app,reload.getState().savedItems[0],reload.getState()),/本站整理的中文标题/);
  assert.match(renderTopicWorkspace(app,reload.getState()),/AI 按官方说明整理，未实测/);
});
test('demo mode and failed loading never receive real curated material', async()=>{
  const feed={...base(),mode:'demo'};prepare(feed);
  const adapter=new FeedDataAdapter({mode:'demo'});await adapter.loadFeed();assert.equal(adapter.getState().allItems.length,0);
  globalThis.fetch=async()=>{throw Error('offline');};
  const offline=new FeedDataAdapter();await assert.rejects(offline.loadFeed(),/offline/);assert.equal(offline.getState(),null);
});
