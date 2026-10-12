import test from 'node:test';
import assert from 'node:assert/strict';
import { sourcePreferenceKey, normalizeSourcePreferences, readSourcePreferences, writeSourcePreferences, orderVisibleSources } from './src/sourcePreferences.js';

const sources=[{id:'news'},{id:'community'},{id:'video'}];
const preferences=(hidden=[],pinned=[])=>({version:1,hidden_source_ids:hidden,pinned_source_ids:pinned});
const storage=()=>{const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};

test('all sources show by default and source preferences are independent for live and demo',()=>{
  const store=storage(),loaded=readSourcePreferences(store,sources,'live');
  assert.deepEqual(loaded.preferences,preferences());assert.equal(loaded.raw,null);assert.equal(loaded.notice,'');
  const saved=writeSourcePreferences(store,preferences(['community'],['video']),sources,{mode:'live',expectedRaw:loaded.raw});
  assert.deepEqual(readSourcePreferences(store,sources,'live').preferences,saved.preferences);
  assert.deepEqual(readSourcePreferences(store,sources,'demo').preferences,preferences());
  assert.notEqual(sourcePreferenceKey('demo'),sourcePreferenceKey('live'));
});

test('unknown and unsafe source IDs are ignored; new sources show and pin order does not alter original sources',()=>{
  const before=structuredClone(sources),value=preferences(['community','unknown','<img>','community'],['video','community','unknown','news','video']);
  const normalized=normalizeSourcePreferences(value,sources);
  assert.deepEqual(normalized,preferences(['community'],['video','news']));
  assert.deepEqual(orderVisibleSources(sources,normalized).map(source=>source.id),['video','news']);
  assert.deepEqual(orderVisibleSources([...sources,{id:'new-source'}],normalized).map(source=>source.id),['video','news','new-source']);
  assert.deepEqual(sources,before);assert.deepEqual(value.hidden_source_ids,['community','unknown','<img>','community']);
});

test('unreadable or malformed preferences show honest defaults and never claim old settings were loaded',()=>{
  const blocked=readSourcePreferences({getItem(){throw Error('blocked');}},sources);
  assert.equal(blocked.readable,false);assert.match(blocked.notice,/无法读取|未采用/);assert.deepEqual(blocked.preferences,preferences());
  const store=storage();
  for (const raw of ['not json','null',JSON.stringify({version:9,hidden_source_ids:[],pinned_source_ids:[]}),JSON.stringify({version:1,hidden_source_ids:'news',pinned_source_ids:[]})]) {
    store.values.set(sourcePreferenceKey(),raw);
    const loaded=readSourcePreferences(store,sources);
    assert.match(loaded.notice,/格式不正确/);assert.deepEqual(loaded.preferences,preferences());assert.equal(loaded.raw,raw);
  }
});

test('failed writes and newer browser tabs do not overwrite preferences or mutate the draft',()=>{
  const store=storage(),draft=preferences(['news'],['video']),before=structuredClone(draft);
  const loaded=readSourcePreferences(store,sources);
  store.values.set(loaded.key,JSON.stringify(preferences([],['community'])));
  assert.throws(()=>writeSourcePreferences(store,draft,sources,{expectedRaw:loaded.raw}),/另一个页面/);
  assert.deepEqual(readSourcePreferences(store,sources).preferences,preferences([],['community']));
  const latest=readSourcePreferences(store,sources),raw=latest.raw;
  store.setItem=()=>{throw Error('quota');};
  assert.throws(()=>writeSourcePreferences(store,draft,sources,{expectedRaw:raw}),/没有保存/);
  assert.equal(store.getItem(latest.key),raw);assert.deepEqual(draft,before);
  assert.throws(()=>writeSourcePreferences(store,draft,sources,{expectedRaw:raw,readable:false}),/暂时无法读取/);
});

test('all hidden sources can be explicitly restored and malformed settings can be corrected after review',()=>{
  const store=storage(),loaded=readSourcePreferences(store,sources);
  const hidden=writeSourcePreferences(store,preferences(sources.map(source=>source.id)),sources,{expectedRaw:loaded.raw});
  assert.deepEqual(orderVisibleSources(sources,hidden.preferences),[]);
  const restored=writeSourcePreferences(store,preferences(),sources,{expectedRaw:hidden.raw});
  assert.deepEqual(orderVisibleSources(sources,restored.preferences),sources);
  store.values.set(sourcePreferenceKey(),'broken');
  const bad=readSourcePreferences(store,sources);
  const corrected=writeSourcePreferences(store,preferences([],['news']),sources,{expectedRaw:bad.raw});
  assert.equal(corrected.notice,'');assert.deepEqual(readSourcePreferences(store,sources).preferences,preferences([],['news']));
});
