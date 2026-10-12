import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedDataAdapter } from './src/dataAdapter.js';
import { parseBackup } from './src/backup.js';

const item = {id:'github-1', title:'字幕工具', summary:'作者简介，尚未实测',
  original_url:'https://github.com/example/subtitles', canonical_url:'https://github.com/example/subtitles',
  source_refs:['github'], evidence_ref:'source-one', captured_at:'2026-10-01T00:00:00Z',
  content_status:'metadata_only', verification_status:'not_tested'};
const feed = {mode:'live',schema_version:'0.3',profile:{},items:[item],sources:[{id:'github',name:'GitHub'}],sections:{daily:[],discover:[]}};
function setup() {
  const storage = new Map();
  globalThis.localStorage = {getItem:key => storage.get(key) ?? null, setItem:(key,value) => storage.set(key,value),
    removeItem:key => storage.delete(key)};
  globalThis.fetch = () => {throw Error('No network, AI, or formal data for topic sync checks');};
  const adapter = new FeedDataAdapter(); adapter.feedData = structuredClone(feed);
  return {adapter,storage};
}
function linked() {
  const result = setup(), {adapter} = result;
  adapter.setSaved(item.id,true); adapter.saveCollectionContent(item.id,{note:'收藏原想法',excerpt:'收藏原摘录'});
  const topic = adapter.createTopic({title:'字幕教程'},item.id);
  adapter.saveCollectionContent(item.id,{note:'收藏新想法',excerpt:'收藏新摘录'});
  return {...result,topic};
}
const material = (adapter,topic) => adapter.localState.topics.find(value => value.id === topic.id).materials[0];
const preview = (adapter,topic) => adapter.previewTopicSync(topic.id,item.id);

test('new linked themes capture collection baselines, expose read-only reminders, and update only selected fields', () => {
  const {adapter,topic,storage} = linked(), before = structuredClone(adapter.localState);
  assert.equal(material(adapter,topic).collection_sync.fields.note,'收藏原想法');
  const copy = adapter.getState().topicSyncRows; assert.equal(copy.length,1);
  copy[0].fields[0].topicValue = '改页面数据不能改正式主题'; assert.deepEqual(adapter.localState,before);
  const result = adapter.applyTopicSync(preview(adapter,topic),{fields:['note']});
  assert.equal(material(adapter,topic).note,'收藏新想法'); assert.equal(material(adapter,topic).manual_excerpt.text,'收藏原摘录');
  assert.deepEqual(adapter.getState().topicSyncRows[0].fields.map(field => field.key),['manual_excerpt']);
  assert.deepEqual(material(adapter,topic).item,item); assert.equal(material(adapter,topic).added_at,before.topics[0].materials[0].added_at);
  assert.equal(result.updated,1);
  const reloaded = new FeedDataAdapter(); reloaded.feedData = {...structuredClone(feed),items:[]};
  assert.equal(reloaded.localState.topics[0].materials[0].note,'收藏新想法');
  assert.equal(reloaded.getState().topicSyncRows.length,1);
  assert.equal(JSON.parse(storage.get(adapter.storageKey)).topics[0].materials[0].collection_sync.fields.note,'收藏新想法');
});

test('a user customizes the add-to-theme form without changing its collection baseline or enabling a direct overwrite', () => {
  const {adapter} = setup(); adapter.setSaved(item.id,true);
  adapter.saveCollectionContent(item.id,{note:'收藏 A',excerpt:'收藏摘录 A'});
  const created = adapter.createTopic({title:'新主题'},item.id,'主题自己写 B','主题摘录 B');
  const added = adapter.createTopic({title:'已有主题'}); adapter.addToTopic(added.id,item.id,'另一个主题自己写 B','另一个主题摘录 B');
  for (const topic of [created,added]) {
    assert.equal(material(adapter,topic).collection_sync.fields.note,'收藏 A');
    assert.equal(material(adapter,topic).collection_sync.fields.manual_excerpt.text,'收藏摘录 A');
  }
  adapter.saveCollectionContent(item.id,{note:'收藏 C',excerpt:'收藏摘录 C'});
  for (const topic of [created,added]) {
    const row = preview(adapter,topic); assert.deepEqual(row.fields.map(field => field.kind),['custom','custom']);
    const before = structuredClone(adapter.localState);
    assert.throws(() => adapter.applyTopicSync(row,{fields:['note']}),/明确选择替换/);
    assert.deepEqual(adapter.localState,before);
  }
  adapter.applyTopicSync(preview(adapter,created),{fields:['note'],explicitReplace:true});
  assert.equal(material(adapter,created).note,'收藏 C'); assert.equal(material(adapter,added).note,'另一个主题自己写 B');
});

test('editing a theme separately stays local, and its excerpt can be updated without replacing the custom note', () => {
  const {adapter,topic} = linked();
  adapter.updateTopicContent(topic.id,item.id,{note:'主题专用判断',excerpt:'收藏原摘录'});
  const source = structuredClone(adapter.feedData), saved = structuredClone(adapter.localState.item_snapshots);
  const row = preview(adapter,topic); assert.deepEqual(row.fields.map(field => field.kind),['custom','stale']);
  adapter.applyTopicSync(row,{fields:['manual_excerpt']});
  assert.equal(material(adapter,topic).note,'主题专用判断'); assert.equal(material(adapter,topic).manual_excerpt.text,'收藏新摘录');
  assert.equal(adapter.collectionNote(item.id),'收藏新想法'); assert.deepEqual(adapter.feedData,source);
  assert.deepEqual(adapter.localState.item_snapshots,saved);
});

test('sync save failure rolls back all fields and baselines, sends no success notification, and can be retried once', () => {
  const {adapter,topic,storage} = linked(), row = preview(adapter,topic), before = structuredClone(adapter.localState);
  const encoded = storage.get(adapter.storageKey), lastPersisted = adapter.lastPersistedText;
  let notifications = 0; adapter.subscribe(() => {notifications++;});
  globalThis.localStorage.setItem = () => {throw Object.assign(Error('isolated storage full'),{name:'QuotaExceededError'});};
  assert.throws(() => adapter.applyTopicSync(row,{fields:['note','manual_excerpt']}),/本地存储/);
  assert.deepEqual(adapter.localState,before); assert.equal(storage.get(adapter.storageKey),encoded);
  assert.equal(adapter.lastPersistedText,lastPersisted); assert.equal(notifications,0);
  globalThis.localStorage.setItem = (key,value) => storage.set(key,value);
  adapter.applyTopicSync(row,{fields:['note','manual_excerpt']});
  assert.equal(notifications,1); assert.equal(adapter.getState().topicSyncRows.length,0);
  assert.equal(material(adapter,topic).manual_excerpt.verification,'not_verified');
});

test('actual second adapters cannot overwrite another tabs changed collection or theme', () => {
  const {adapter,topic,storage} = linked(), row = preview(adapter,topic), before = structuredClone(adapter.localState);
  const other = new FeedDataAdapter(); other.feedData = structuredClone(feed);
  other.saveCollectionContent(item.id,{note:'另一个标签页的新内容',excerpt:'另一个标签页的新摘录'});
  const newest = storage.get(adapter.storageKey);
  assert.throws(() => adapter.applyTopicSync(row,{fields:['note']}),/另一个页面/);
  assert.throws(() => adapter.previewTopicSync(topic.id,item.id),/另一个页面/);
  assert.deepEqual(adapter.localState,before); assert.equal(storage.get(adapter.storageKey),newest);
  const reloaded = new FeedDataAdapter(); reloaded.feedData = structuredClone(feed);
  assert.equal(reloaded.previewTopicSync(topic.id,item.id).fields[0].collectionValue,'另一个标签页的新内容');
});

test('a same-tab edit after preview rejects stale choices without altering the newer saved theme', () => {
  const {adapter,topic,storage} = linked(), row = preview(adapter,topic);
  adapter.updateTopicContent(topic.id,item.id,{note:'预览后主题改过',excerpt:'预览后另选摘录'});
  const before = structuredClone(adapter.localState), encoded = storage.get(adapter.storageKey);
  assert.throws(() => adapter.applyTopicSync(row,{fields:['note'],explicitReplace:true}),/预览后有更新/);
  assert.deepEqual(adapter.localState,before); assert.equal(storage.get(adapter.storageKey),encoded);
});

test('another tab changing only the theme is protected even when collection content still matches the preview', () => {
  const {adapter,topic,storage} = linked(), row = preview(adapter,topic), before = structuredClone(adapter.localState);
  const other = new FeedDataAdapter(); other.feedData = structuredClone(feed);
  other.updateTopicContent(topic.id,item.id,{note:'只在另一个标签页修改主题',excerpt:'主题另选的一段'});
  const latest = storage.get(adapter.storageKey);
  assert.throws(() => adapter.applyTopicSync(row,{fields:['note','manual_excerpt']}),/另一个页面/);
  assert.deepEqual(adapter.localState,before); assert.equal(storage.get(adapter.storageKey),latest);
});

test('pending differences do not change exported topic content or silently acknowledge the reminder', () => {
  const {adapter,topic,storage} = linked(), before = structuredClone(adapter.localState), encoded = storage.get(adapter.storageKey);
  const text = adapter.exportTopic(topic.id), markdown = adapter.exportTopic(topic.id,{forAI:false});
  for (const output of [text,markdown]) {
    assert.match(output,/收藏原想法/); assert.match(output,/收藏原摘录/);
    assert.doesNotMatch(output,/收藏新想法|收藏新摘录/); assert.match(output,/主题.*保留|保留.*主题/);
  }
  assert.deepEqual(adapter.localState,before); assert.equal(storage.get(adapter.storageKey),encoded);
  assert.equal(adapter.getState().topicSyncRows.length,1);
});

test('explicit keep preserves both theme fields and suppresses this reminder without hiding a later change', () => {
  const {adapter,topic} = linked(), before = structuredClone(material(adapter,topic));
  const result = adapter.applyTopicSync(preview(adapter,topic),{keepAll:true});
  assert.equal(result.updated,0); assert.equal(result.kept,2);
  assert.equal(material(adapter,topic).note,before.note); assert.deepEqual(material(adapter,topic).manual_excerpt,before.manual_excerpt);
  assert.equal(adapter.getState().topicSyncRows.length,0);
  adapter.saveCollectionContent(item.id,{note:'收藏再改一次',excerpt:'收藏新摘录'});
  assert.equal(preview(adapter,topic).fields[0].kind,'custom');
});

test('collection deletion and cancelled bookmark preserve theme content until an explicit update', () => {
  const {adapter,topic} = linked(); adapter.saveCollectionContent(item.id,{note:'',excerpt:''});
  const row = preview(adapter,topic); assert.equal(row.fields[0].collectionValue,''); assert.equal(row.fields[1].collectionValue,null);
  adapter.setSaved(item.id,false); const before = structuredClone(adapter.localState);
  assert.equal(adapter.getState().topicSyncRows.length,0);
  assert.throws(() => adapter.applyTopicSync(row,{fields:['note','manual_excerpt']})); assert.deepEqual(adapter.localState,before);
  assert.equal(material(adapter,topic).note,'收藏原想法'); assert.equal(material(adapter,topic).manual_excerpt.text,'收藏原摘录');
  adapter.restoreSaved(item.id); adapter.applyTopicSync(preview(adapter,topic),{fields:['note','manual_excerpt']});
  assert.equal(material(adapter,topic).note,''); assert.equal(material(adapter,topic).manual_excerpt,null);
});

test('uncollected themes have no invented baseline, but later bookmark edits offer explicit untracked review', () => {
  const {adapter} = setup(), topic = adapter.createTopic({title:'直接放入主题'},item.id,'主题理由','主题摘录');
  assert.equal(material(adapter,topic).collection_sync,undefined); assert.equal(adapter.getState().topicSyncRows.length,0);
  adapter.setSaved(item.id,true); adapter.saveCollectionContent(item.id,{note:'后来收藏的想法',excerpt:'后来收藏的摘录'});
  const row = preview(adapter,topic); assert.deepEqual(row.fields.map(field => field.kind),['untracked','untracked']);
  assert.throws(() => adapter.applyTopicSync(row,{fields:['note']}),/明确选择替换/);
  adapter.applyTopicSync(row,{fields:['note'],explicitReplace:true});
  assert.deepEqual(Object.keys(material(adapter,topic).collection_sync.fields),['note']);
});

test('baseline backups round-trip with partial updates, preserve current themes, and remain compatible with untracked old backups', () => {
  const {adapter,topic} = linked(); adapter.applyTopicSync(preview(adapter,topic),{fields:['note']});
  const backup = adapter.createBackup(), copy = parseBackup(backup.raw,'live');
  assert.equal(copy.state.topics[0].materials[0].collection_sync.fields.note,'收藏新想法');
  assert.equal(copy.state.topics[0].materials[0].collection_sync.fields.manual_excerpt.text,'收藏原摘录');
  const before = structuredClone(adapter.localState);
  adapter.previewBackup(backup.raw); assert.deepEqual(adapter.localState,before);
  const destination = setup().adapter; destination.restoreBackup(destination.previewBackup(backup.raw));
  assert.equal(destination.getState().topicSyncRows.length,1);
  assert.deepEqual(destination.getState().topicSyncRows[0].fields.map(field => field.key),['manual_excerpt']);
  destination.updateTopicContent(topic.id,item.id,{note:'本机的新主题判断',excerpt:'本机的新摘录'});
  const own = structuredClone(destination.localState); destination.restoreBackup(destination.previewBackup(backup.raw));
  assert.deepEqual(destination.localState,own);
  const legacy = JSON.parse(backup.raw); delete legacy.state.topics[0].materials[0].collection_sync;
  assert.doesNotThrow(() => parseBackup(JSON.stringify(legacy),'live'));
  const oldDestination = setup().adapter; oldDestination.restoreBackup(oldDestination.previewBackup(JSON.stringify(legacy)));
  assert.equal(oldDestination.localState.topics[0].materials[0].collection_sync,undefined);
  assert.equal(oldDestination.getState().topicSyncRows[0].fields[0].kind,'untracked');
});

test('backup rejects malformed or fabricated association provenance before merging any user data', () => {
  const {adapter} = linked(), raw = adapter.createBackup().raw;
  for (const corrupt of [
    base => {base.version = 2;}, base => {base.source_item_id = '../other';},
    base => {base.source_url = 'javascript:alert(1)';}, base => {base.fields = [];},
    base => {base.fields.note = 'password=' + 'X'.repeat(25);},
    base => {base.fields.manual_excerpt.verification = 'verified';},
    base => {base.fields.manual_excerpt.url = 'https://example.org/changed';},
  ]) {
    const broken = JSON.parse(raw); corrupt(broken.state.topics[0].materials[0].collection_sync);
    const before = structuredClone(adapter.localState);
    assert.throws(() => adapter.previewBackup(JSON.stringify(broken))); assert.deepEqual(adapter.localState,before);
  }
});

test('source alias changes keep one collection link, and archival does not detach the theme reminder', () => {
  const {adapter,topic} = linked(), merged = {...structuredClone(item),id:'news-123456789012345678901234',alias_ids:[item.id]};
  adapter.feedData.items = [merged]; adapter.setArchived(merged.id,true);
  adapter.saveCollectionContent(merged.id,{note:'由归并后的入口补充',excerpt:'新摘录'});
  const row = preview(adapter,topic); assert.equal(row.collection_item_id,item.id);
  adapter.applyTopicSync(row,{fields:['note','manual_excerpt']});
  assert.equal(adapter.getState().topicSyncRows.length,0); assert.deepEqual(material(adapter,topic).item,item);
  assert.equal(adapter.getState().archivedItems.length,1); assert.equal(adapter.localState.saved_item_ids.length,1);
});

test('manual links added directly to a new or existing theme capture the actual initial collection, including empty fields', () => {
  for (const existing of [false,true]) for (const empty of [false,true]) {
    const {adapter} = setup(), prior = existing ? adapter.createTopic({title:'既有主题'}) : null;
    const input = {url:'https://example.org/manual-material',title:'自己留下的网页链接',
      note:empty ? '' : '手动收藏的原想法',excerpt:empty ? '' : '手动留下的原摘录'};
    const result = adapter.addManualMaterial(input,existing ? {topicId:prior.id} : {newTopic:{title:'新建主题'}});
    const topic = adapter.localState.topics.find(value => value.id === result.topic_id), initial = structuredClone(topic.materials[0]);
    assert.equal(initial.collection_sync.fields.note,input.note);
    assert.equal(initial.collection_sync.fields.manual_excerpt?.text ?? '',input.excerpt);
    assert.equal(initial.collection_sync.source_item_id,result.item.id); assert.equal(initial.collection_sync.source_url,input.url);
    assert.equal(adapter.getState().topicSyncRows.length,0);
    adapter.saveCollectionContent(result.item.id,{note:'后来补充的手动想法',excerpt:'后来补充的手动摘录'});
    const row = adapter.previewTopicSync(topic.id,result.item.id);
    assert.deepEqual(row.fields.map(field => field.kind),['stale','stale']);
    adapter.applyTopicSync(row,{fields:['note','manual_excerpt']});
    const updated = adapter.localState.topics.find(value => value.id === topic.id).materials[0];
    assert.equal(updated.note,'后来补充的手动想法'); assert.equal(updated.manual_excerpt.text,'后来补充的手动摘录');
    assert.deepEqual(updated.item,initial.item); assert.equal(updated.item.origin,'user_added');
    assert.equal(updated.manual_excerpt.verification,'not_verified');
    assert.doesNotThrow(() => parseBackup(adapter.createBackup().raw,'live'));
  }
});
