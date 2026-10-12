import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTopicSyncBaseline, validateTopicSyncBaseline, planTopicSync, applyTopicSync } from './src/topicSync.js';

const oldTime = '2026-10-01T01:00:00.000Z', newTime = '2026-10-03T01:00:00.000Z';
const item = {id:'github-1', title:'字幕工具', summary:'作者提供的简介，未实测',
  original_url:'https://github.com/example/subtitle', canonical_url:'https://github.com/example/subtitle',
  source_refs:['github'], evidence_ref:'evidence-1', captured_at:oldTime};
const excerpt = (text = '原摘录', url = item.original_url, recorded_at = oldTime) => ({text, url, recorded_at,
  origin:'user_pasted', verification:'not_verified'});
function fixture({tracked = true} = {}) {
  const material = {item:structuredClone(item), note:'原想法', manual_excerpt:excerpt(), added_at:oldTime};
  if (tracked) material.collection_sync = makeTopicSyncBaseline(item, material.note, material.manual_excerpt);
  return {saved_item_ids:[item.id], archived_item_ids:[], item_snapshots:{[item.id]:structuredClone(item)},
    saved_item_notes:{[item.id]:{note:'新想法', updated_at:newTime}}, saved_item_excerpts:{[item.id]:excerpt('新摘录', item.original_url, newTime)},
    topics:[{id:'topic-1', title:'字幕教程', thoughts:'独立判断', goal:'做一次实测', status:'collecting',
      created_at:oldTime, updated_at:oldTime, materials:[material]}],
    followups:[], hidden_item_ids:[], profile_override:null};
}
const row = state => planTopicSync(state)[0];

test('tracked copies report separate note and excerpt changes without mutating either source', () => {
  const state = fixture(), before = structuredClone(state);
  const rows = planTopicSync(state);
  assert.equal(rows.length, 1); assert.equal(rows[0].collection_item_id, item.id);
  assert.deepEqual(rows[0].fields.map(field => [field.key, field.kind, field.canReplace]),
    [['note','stale',true],['manual_excerpt','stale',true]]);
  assert.deepEqual(state, before);
  rows[0].fields[1].collectionValue.text = '改预览不能修改原数据';
  assert.deepEqual(state, before);
});

test('only selected fields and their baselines change; evidence, added time and independent thoughts stay intact', () => {
  const state = fixture(), before = structuredClone(state);
  const result = applyTopicSync(state, row(state), {fields:['note'], now:newTime});
  const material = result.state.topics[0].materials[0];
  assert.equal(material.note, '新想法'); assert.equal(material.collection_sync.fields.note, '新想法');
  assert.deepEqual(material.manual_excerpt, before.topics[0].materials[0].manual_excerpt);
  assert.deepEqual(material.collection_sync.fields.manual_excerpt, before.topics[0].materials[0].collection_sync.fields.manual_excerpt);
  assert.deepEqual(material.item, before.topics[0].materials[0].item); assert.equal(material.added_at, oldTime);
  assert.equal(result.state.topics[0].thoughts, '独立判断');
  assert.deepEqual(row(result.state).fields.map(field => field.key), ['manual_excerpt']);
  assert.deepEqual(result.summary, {topic_id:'topic-1',item_id:item.id,updated:1,kept:0,fields:['note']});
  assert.deepEqual(state, before);
});

test('a custom topic note is protected while an unchanged excerpt can still be updated', () => {
  const state = fixture(); state.topics[0].materials[0].note = '主题里自己改过的判断';
  const preview = row(state);
  assert.deepEqual(preview.fields.map(field => field.kind), ['custom','stale']);
  assert.throws(() => applyTopicSync(state, preview, {fields:['note']}), /明确选择替换/);
  const result = applyTopicSync(state, preview, {fields:['manual_excerpt'], now:newTime});
  assert.equal(result.state.topics[0].materials[0].note, '主题里自己改过的判断');
  assert.equal(result.state.topics[0].materials[0].manual_excerpt.text, '新摘录');
  assert.equal(row(result.state).fields[0].kind, 'custom');
  const replaced = applyTopicSync(result.state, row(result.state), {fields:['note'], explicitReplace:true});
  assert.equal(replaced.state.topics[0].materials[0].note, '新想法'); assert.deepEqual(planTopicSync(replaced.state), []);
});

test('deleting collection notes and excerpts is an explicit replaceable change, never an automatic topic deletion', () => {
  const state = fixture(), before = structuredClone(state);
  delete state.saved_item_notes[item.id]; delete state.saved_item_excerpts[item.id];
  const preview = row(state); assert.equal(preview.fields[0].collectionValue, ''); assert.equal(preview.fields[1].collectionValue, null);
  assert.equal(state.topics[0].materials[0].note, before.topics[0].materials[0].note);
  const result = applyTopicSync(state, preview, {fields:['note','manual_excerpt']});
  assert.equal(result.state.topics[0].materials[0].note, ''); assert.equal(result.state.topics[0].materials[0].manual_excerpt, null);
  assert.deepEqual(result.state.topics[0].materials[0].item, item);
});

test('independent topic edits alone do not imply that the collection changed', () => {
  const state = fixture(); state.saved_item_notes[item.id].note = '原想法'; state.saved_item_excerpts[item.id] = excerpt();
  state.topics[0].materials[0].note = '只用于此主题的分析'; state.topics[0].materials[0].manual_excerpt = excerpt('主题另选摘录');
  assert.deepEqual(planTopicSync(state), []);
});

test('old themes and partial baselines remain untracked and require explicit replacement', () => {
  const state = fixture({tracked:false}), before = structuredClone(state);
  assert.deepEqual(row(state).fields.map(field => field.kind), ['untracked','untracked']);
  assert.throws(() => applyTopicSync(state, row(state), {fields:['note']}), /明确选择替换/);
  const result = applyTopicSync(state, row(state), {fields:['note'], explicitReplace:true});
  assert.deepEqual(Object.keys(result.state.topics[0].materials[0].collection_sync.fields), ['note']);
  assert.equal(row(result.state).fields[0].kind, 'untracked'); assert.deepEqual(state, before);
  const aligned = fixture({tracked:false}); aligned.topics[0].materials[0].note = '新想法';
  aligned.topics[0].materials[0].manual_excerpt = excerpt('新摘录');
  assert.deepEqual(planTopicSync(aligned), []); assert.equal(aligned.topics[0].materials[0].collection_sync, undefined);
});

test('keepAll preserves custom content, acknowledges this difference, and warns again on the next actual collection change', () => {
  const state = fixture(); state.topics[0].materials[0].note = '请保留我的主题判断';
  const previous = structuredClone(state.topics[0].materials[0]);
  const result = applyTopicSync(state, row(state), {keepAll:true, now:newTime});
  assert.equal(result.state.topics[0].materials[0].note, previous.note);
  assert.deepEqual(result.state.topics[0].materials[0].manual_excerpt, previous.manual_excerpt);
  assert.deepEqual(planTopicSync(result.state), []); assert.equal(result.summary.updated, 0); assert.equal(result.summary.kept, 2);
  result.state.saved_item_notes[item.id] = {note:'又补充了一条想法', updated_at:'2026-10-04T01:00:00Z'};
  assert.equal(row(result.state).fields[0].kind, 'custom');
});

test('uncollected material and cancelling a bookmark do not treat retained old notes as active collection updates', () => {
  const state = fixture(), preview = row(state), before = structuredClone(state.topics);
  state.saved_item_ids = [];
  assert.deepEqual(planTopicSync(state), []);
  assert.throws(() => applyTopicSync(state, preview, {fields:['note']}), /预览后有更新/);
  assert.deepEqual(state.topics, before);
});

test('archived collections remain linked, and aliases match without changing topic source identity', () => {
  const state = fixture(), alias = 'news-123456789012345678901234';
  state.saved_item_ids = [alias]; state.archived_item_ids = [alias];
  state.item_snapshots = {[alias]:{...structuredClone(item), id:alias, alias_ids:[item.id]}};
  state.saved_item_notes = {[alias]:{note:'新想法', updated_at:newTime}};
  state.saved_item_excerpts = {[alias]:excerpt('新摘录', item.original_url, newTime)};
  const preview = row(state); assert.equal(preview.collection_item_id, alias);
  const result = applyTopicSync(state, preview, {fields:['note','manual_excerpt']});
  assert.equal(result.state.topics[0].materials[0].item.id, item.id);
  assert.deepEqual(result.state.topics[0].materials[0].item, item);
  assert.equal(result.state.topics[0].materials[0].collection_sync.source_item_id, alias);
});

test('ambiguous restored alias copies are not silently resolved to one users notes', () => {
  const state = fixture(), alias = 'news-123456789012345678901234';
  state.saved_item_ids.push(alias); state.item_snapshots[alias] = {...structuredClone(item), id:alias, alias_ids:[item.id]};
  state.saved_item_notes[alias] = {note:'另一个收藏副本的判断', updated_at:newTime};
  assert.deepEqual(planTopicSync(state), []);
});

test('an alias with a different original URL can update its note but cannot rebind an excerpt', () => {
  const state = fixture(), alias = 'news-123456789012345678901234', url = 'https://example.org/redirected-article';
  state.saved_item_ids = [alias]; state.item_snapshots = {[alias]:{...structuredClone(item), id:alias, original_url:url, alias_ids:[item.id]}};
  state.saved_item_notes = {[alias]:{note:'新想法', updated_at:newTime}};
  state.saved_item_excerpts = {[alias]:excerpt('来自另一个链接的摘录', url, newTime)};
  const preview = row(state); assert.equal(preview.fields.find(field => field.key === 'manual_excerpt').canReplace, false);
  assert.throws(() => applyTopicSync(state, preview, {fields:['manual_excerpt'], explicitReplace:true}), /原链接不同/);
  const result = applyTopicSync(state, preview, {fields:['note']});
  assert.equal(result.state.topics[0].materials[0].collection_sync.source_url, item.original_url);
  assert.doesNotThrow(() => validateTopicSyncBaseline(result.state.topics[0].materials[0].collection_sync));
  assert.deepEqual(result.state.topics[0].materials[0].manual_excerpt, excerpt());
  const kept = applyTopicSync(result.state, row(result.state), {keepAll:true});
  assert.equal(kept.state.topics[0].materials[0].collection_sync.source_url, url); assert.deepEqual(planTopicSync(kept.state), []);
});

test('source content, source timestamps, topic edits, baseline changes or removed material invalidate an old preview', () => {
  const changes = [
    state => {state.saved_item_notes[item.id].note = '再次改过';},
    state => {state.saved_item_notes[item.id].updated_at = '2026-10-04T01:00:00Z';},
    state => {state.saved_item_excerpts[item.id].recorded_at = '2026-10-04T01:00:00Z';},
    state => {state.item_snapshots[item.id].summary = '来源已换了一版';},
    state => {state.topics[0].materials[0].note = '预览后自己改过';},
    state => {state.topics[0].materials[0].collection_sync.fields.note = '基线发生变化';},
    state => {state.topics[0].materials = [];},
  ];
  for (const change of changes) {
    const state = fixture(), preview = row(state); change(state); const before = structuredClone(state);
    assert.throws(() => applyTopicSync(state, preview, {fields:['note'], explicitReplace:true}), /预览后有更新/);
    assert.deepEqual(state, before);
  }
});

test('a repeated paste date without a change in text or provenance does not claim new content', () => {
  const state = fixture(); state.saved_item_notes[item.id].note = '原想法';
  state.saved_item_excerpts[item.id] = excerpt('原摘录', item.original_url, newTime);
  assert.deepEqual(planTopicSync(state), []);
});

test('forged UI kinds and values cannot bypass replacement rules or write invented content', () => {
  const state = fixture(); state.topics[0].materials[0].note = '主题自有判断';
  const preview = row(state); preview.fields[0].kind = 'stale'; preview.fields[0].collectionValue = '伪造想法';
  assert.throws(() => applyTopicSync(state, preview, {fields:['note']}), /明确选择替换/);
  const result = applyTopicSync(state, preview, {fields:['note'], explicitReplace:true});
  assert.equal(result.state.topics[0].materials[0].note, '新想法');
});

test('baselines reject credentials, false provenance, malformed URLs and unsupported fields', () => {
  assert.throws(() => makeTopicSyncBaseline(item, 'api_key=' + 'X'.repeat(25)), /密钥/);
  const invalid = [
    value => {value.version = 2;}, value => {value.source_item_id = '../other';},
    value => {value.extra = '未支持的关联字段';},
    value => {value.source_url = 'https://user:password@example.org/';},
    value => {value.fields.extra = '未知字段';}, value => {value.fields.note = null;},
    value => {value.fields = new Map();}, value => {value.fields = new Date();},
    value => {value.fields.manual_excerpt.verification = 'verified';},
    value => {value.fields.manual_excerpt.url = 'https://example.org/other';},
  ];
  for (const mutate of invalid) {
    const baseline = makeTopicSyncBaseline(item, '原想法', excerpt()); mutate(baseline);
    assert.throws(() => validateTopicSyncBaseline(baseline));
  }
  assert.doesNotThrow(() => validateTopicSyncBaseline({...makeTopicSyncBaseline(item), fields:{}}));
});

test('invalid selections, empty replacement and unknown topics fail without changing input', () => {
  const state = fixture(), before = structuredClone(state), preview = row(state);
  for (const choice of [{fields:[]},{fields:['item']},{fields:['note','note']},{fields:['note'],now:'yesterday'}]) {
    assert.throws(() => applyTopicSync(state, preview, choice));
  }
  assert.deepEqual(planTopicSync(state, 'topic-other'), []); assert.deepEqual(state, before);
});
