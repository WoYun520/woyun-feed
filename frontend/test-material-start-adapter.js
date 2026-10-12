import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedDataAdapter } from './src/dataAdapter.js';
import { buildMaterialStart } from './src/materialStart.js';
import { parseBackup } from './src/backup.js';

const item = {
  id:'github-1', title:'字幕工具', summary:'作者称可以生成字幕；尚未实测',
  original_url:'https://github.com/example/subtitles', canonical_url:'https://github.com/example/subtitles',
  source_refs:['github'], evidence_ref:'source-subtitles', captured_at:'2026-10-07T01:00:00Z',
  content_status:'metadata_only', verification_status:'not_tested', link_kind:'repository',
};
const otherItem = {...item,id:'github-2',title:'录屏工具',original_url:'https://github.com/example/recorder',canonical_url:'https://github.com/example/recorder',evidence_ref:'source-recorder'};
const feed = {mode:'live',schema_version:'0.3',profile:{},items:[item,otherItem],sources:[{id:'github',name:'GitHub'}],sections:{daily:[],discover:[]}};

function setup() {
  const storage = new Map();
  globalThis.localStorage = {
    getItem:key => storage.get(key) ?? null,
    setItem:(key,value) => storage.set(key,value),
    removeItem:key => storage.delete(key),
    key:index => [...storage.keys()][index] ?? null,
    get length() {return storage.size;},
  };
  globalThis.fetch = () => {throw Error('No network, external AI, or real user storage in material start checks');};
  const adapter = new FeedDataAdapter(); adapter.feedData = structuredClone(feed);
  return {adapter,storage};
}

function start(adapter,itemId,intent='try') {
  const snapshot = adapter.topicItem(itemId);
  return adapter.createTopic(buildMaterialStart(snapshot,intent),snapshot.id,undefined,undefined,snapshot);
}

test('starting from a bookmarked material retains its original excerpt, thought and evidence without rewriting the collection', () => {
  const {adapter,storage} = setup();
  adapter.setSaved(item.id,true);
  adapter.saveCollectionContent(item.id,{note:'我想用自己的录屏试一次',excerpt:'作者提供的原文关键一句。'});
  const beforeCollection = structuredClone({snapshots:adapter.localState.item_snapshots,notes:adapter.localState.saved_item_notes,excerpts:adapter.localState.saved_item_excerpts});
  const topic = start(adapter,item.id);
  assert.match(topic.title,/试用/); assert.match(topic.goal,/本站起步建议/);
  for (const key of ['thoughts','gaps','next_step','result']) assert.equal(topic[key],'');
  assert.equal(topic.status,'collecting'); assert.equal(topic.materials.length,1);
  assert.equal(topic.materials[0].note,'我想用自己的录屏试一次');
  assert.deepEqual(topic.materials[0].manual_excerpt,beforeCollection.excerpts[item.id]);
  assert.deepEqual(topic.materials[0].item,item);
  assert.deepEqual({snapshots:adapter.localState.item_snapshots,notes:adapter.localState.saved_item_notes,excerpts:adapter.localState.saved_item_excerpts},beforeCollection);
  assert.equal(JSON.parse(storage.get(adapter.storageKey)).topics.length,1);
  const reloaded = new FeedDataAdapter(); reloaded.feedData = {...structuredClone(feed),items:[]};
  assert.deepEqual(reloaded.localState.topics[0],topic);
  assert.match(reloaded.exportTopic(topic.id),/本站起步建议/);
  assert.match(reloaded.exportTopic(topic.id),/source-subtitles/);
  assert.match(reloaded.exportTopic(topic.id),/手动粘贴，未核对原文/);
});

test('a topic idea is an editable proposal with no invented personal thought, result, source excerpt or AI delivery', () => {
  const {adapter} = setup(), beforeFeed = structuredClone(adapter.feedData);
  const topic = start(adapter,item.id,'write');
  assert.match(topic.title,/选题/); assert.match(topic.goal,/本站起步建议/);
  assert.equal(topic.thoughts,''); assert.equal(topic.result,'');
  assert.equal(topic.materials[0].note,''); assert.equal(topic.materials[0].manual_excerpt,null);
  assert.equal(adapter.localState.saved_item_ids.length,0);
  assert.equal(adapter.localState.followups.length,0);
  assert.deepEqual(adapter.feedData,beforeFeed);
  const exported = adapter.exportTopic(topic.id);
  assert.match(exported,/没有记录的经历、效果、收入、实测或用户认可不能编造/);
  assert.match(exported,/正文关键摘录\*\*：未填写/);
  assert.doesNotMatch(exported,/已实测通过|已发送给 AI|已经发布|用户已认可/);
});

test('a failed first save leaves neither an empty orphan topic nor a material and can be retried once', () => {
  const {adapter,storage} = setup(), before = structuredClone(adapter.localState);
  let notifications = 0; adapter.subscribe(() => {notifications++;});
  globalThis.localStorage.setItem = () => {throw Object.assign(Error('isolated storage full'),{name:'QuotaExceededError'});};
  assert.throws(() => start(adapter,item.id),/本地存储/);
  assert.deepEqual(adapter.localState,before); assert.equal(storage.get(adapter.storageKey),undefined);
  assert.equal(notifications,0); assert.equal(adapter.lastPersistedText,null);
  globalThis.localStorage.setItem = (key,value) => storage.set(key,value);
  const topic = start(adapter,item.id);
  assert.equal(adapter.localState.topics.length,1); assert.equal(topic.materials.length,1);
  assert.equal(notifications,1);
});

test('a newer save from another page blocks quick start without discarding that page’s topic', () => {
  const {adapter,storage} = setup();
  const other = new FeedDataAdapter(); other.feedData = structuredClone(feed);
  const saved = start(other,otherItem.id,'write'), newest = storage.get(adapter.storageKey);
  assert.throws(() => start(adapter,item.id),/另一个页面/);
  assert.equal(adapter.localState.topics.length,0); assert.equal(storage.get(adapter.storageKey),newest);
  const reloaded = new FeedDataAdapter(); reloaded.feedData = structuredClone(feed);
  assert.equal(reloaded.localState.topics[0].id,saved.id);
});

test('starting from a merged feed alias preserves the bookmarked source version and does not lose its pasted excerpt', () => {
  const {adapter} = setup(); adapter.setSaved(item.id,true);
  adapter.saveCollectionContent(item.id,{note:'旧收藏里自己的判断',excerpt:'旧来源手动摘录'});
  const merged = {...item,id:'github-3',alias_ids:[item.id],summary:'新来源的新简介'};
  adapter.feedData.items = [merged,otherItem];
  const topic = start(adapter,merged.id);
  assert.equal(topic.materials[0].item.id,item.id);
  assert.equal(topic.materials[0].item.summary,item.summary);
  assert.equal(topic.materials[0].note,'旧收藏里自己的判断');
  assert.equal(topic.materials[0].manual_excerpt.text,'旧来源手动摘录');
  assert.equal(topic.materials[0].collection_sync.source_item_id,item.id);
});

test('adding a quick-start material to an existing topic rejects duplicate aliases without changing any prior contents', () => {
  const {adapter} = setup(), topic = start(adapter,item.id,'write');
  adapter.updateTopicNote(topic.id,item.id,'这条材料已有我的判断');
  const before = structuredClone(adapter.localState);
  const alias = {...item,id:'github-4',alias_ids:[item.id]}; adapter.feedData.items.push(alias);
  assert.throws(() => adapter.addToTopic(topic.id,alias.id,undefined,undefined),/已在主题/);
  assert.deepEqual(adapter.localState,before);
});

test('quick-start topics survive the existing backup format and keep newer edits when an old backup is restored', () => {
  const {adapter,storage} = setup(), topic = start(adapter,item.id,'write');
  const backup = adapter.createBackup(); assert.doesNotThrow(() => parseBackup(backup.raw,'live'));
  adapter.updateTopic(topic.id,{...topic,thoughts:'我自己补的切入点',gaps:'还没核对价格'});
  const preview = adapter.previewBackup(backup.raw);
  assert.equal(preview.summary.topics,0); assert.equal(preview.next.topics[0].thoughts,'我自己补的切入点');
  storage.delete(adapter.storageKey);
  const reloaded = new FeedDataAdapter(); reloaded.feedData = structuredClone(feed);
  reloaded.restoreBackup(reloaded.previewBackup(backup.raw));
  assert.deepEqual(reloaded.localState.topics[0].materials,topic.materials);
  assert.equal(reloaded.localState.topics[0].goal,topic.goal);
  assert.match(reloaded.exportTopic(topic.id),/从备份恢复/);
});

test('quick start enforces the existing topic capacity and rejects credentials before persisting an orphan topic', () => {
  const {adapter,storage} = setup();
  for (let index=0;index<60;index++) adapter.createTopic({title:`原主题 ${index+1}`});
  const before = structuredClone(adapter.localState), encoded = storage.get(adapter.storageKey);
  assert.throws(() => start(adapter,item.id),/60 个主题/);
  assert.deepEqual(adapter.localState,before); assert.equal(storage.get(adapter.storageKey),encoded);
  const isolated = setup();
  const input = buildMaterialStart(item); input.thoughts = 'api_key='+'A'.repeat(30);
  assert.throws(() => isolated.adapter.createTopic(input,item.id),/密钥/);
  assert.equal(isolated.adapter.localState.topics.length,0);
  assert.equal(isolated.storage.get(isolated.adapter.storageKey),undefined);
});
