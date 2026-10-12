import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDotCandidates,dotPostKey,makeDotCandidate,validateDotCandidateRecords,validateDotItem,createDotFeaturedExport,DOT_IMPORT_MAX_BYTES,isCandidateCollector,isCandidateImport,candidateSource} from './src/dotCandidates.js';

const date='2026-10-09T09:05:22Z';
const item=()=>({category:'tutorial',original_url:'https://x.com/example/status/2108148604447883464',author_handle:'example',published_at:null,
  title_zh:'【检查示例】把视频字幕整理成文章',summary_zh:'【检查示例，非真实体验】作者给了三步操作。',bookmark_count:380,like_count:251,view_count:null,
  metric_display:'收藏380；点赞251；浏览7.3万',metrics_checked_at:'2026-10-09T03:28:17Z',metrics_source_url:'https://x.com/example/status/2108148604447883464',
  read_scope:'main_post',selection_reason:'有明确操作步骤，值得亲自试用。',my_angle:'先用自己的视频做一次对照。',unknowns:['未观看视频','未实测','发布时间时区未知']});
const envelope=(items=[item()],alternatives=[])=>({format:'woyun-feed:candidates',version:1,collector:'Dot',collected_at:date,items,alternatives});

test('valid intake preserves collector metrics, unknown publication date, reading scope and original text without guessing views',()=>{
  const raw=envelope(),before=structuredClone(raw),parsed=parseDotCandidates(JSON.stringify(raw));
  assert.deepEqual(raw,before);assert.deepEqual(parsed.items[0],raw.items[0]);assert.equal(parsed.items[0].view_count,null);assert.equal(parsed.items[0].published_at,null);
  parsed.items[0].unknowns.push('新想法');assert.equal(raw.items[0].unknowns.length,3);
});

test('canonical deduplication ignores X handle case, renames, URL trackers and legacy Twitter hostname',()=>{
  const key=dotPostKey(item().original_url);
  for (const url of ['https://twitter.com/RENAMED/status/2108148604447883464?utm_source=dot#thread','https://www.x.com/example/status/2108148604447883464/','https://mobile.twitter.com/other/status/2108148604447883464']) assert.equal(dotPostKey(url),key);
  assert.notEqual(dotPostKey('https://x.com/example/status/2108148604447883465'),key);
});

test('bad envelopes, missing required evidence and unknown fields are rejected as a whole',()=>{
  for (const change of [value=>value.version=2,value=>value.format='different',value=>delete value.items,value=>value.alternatives={},value=>value.collected_at='2026-10-09',value=>value.collector='',value=>delete value.items[0].metrics_source_url,value=>value.items[0].verification='verified']) {
    const value=envelope();change(value);assert.throws(()=>parseDotCandidates(JSON.stringify(value)));
  }
  assert.throws(()=>parseDotCandidates('not JSON'),/有效的 JSON/);
  assert.throws(()=>parseDotCandidates('x'.repeat(DOT_IMPORT_MAX_BYTES+1)),/2 MB/);
  assert.throws(()=>parseDotCandidates(JSON.stringify(envelope(Array.from({length:101},item)))),/100 条/);
});

test('unsafe links, author mismatch, other metrics source and shortened or private URLs are rejected',()=>{
  for (const url of ['http://x.com/example/status/2108148604447883464','https://x.com.evil.test/example/status/2108148604447883464','https://user:password@x.com/example/status/2108148604447883464','javascript:alert(1)','https://127.0.0.1/example/status/2108148604447883464','https://x.com/example/status/2108148604447883464?access_token=example','https://x.com/example','https://t.co/example']) {
    const value=envelope();value.items[0].original_url=url;assert.throws(()=>parseDotCandidates(JSON.stringify(value)));assert.equal(dotPostKey(url),null);
  }
  const author=envelope();author.items[0].author_handle='other';assert.throws(()=>parseDotCandidates(JSON.stringify(author)),/作者账号/);
  const metrics=envelope();metrics.items[0].metrics_source_url='https://x.com/example/status/2108148604447883465';assert.throws(()=>parseDotCandidates(JSON.stringify(metrics)),/同一条/);
});

test('non-integer, negative, missing or imprecise metric counts are never silently repaired',()=>{
  for (const field of ['bookmark_count','like_count','view_count']) for (const invalid of [-1,1.3,'7.3万',undefined,Number.MAX_SAFE_INTEGER+1]) {
    const value=envelope();value.items[0][field]=invalid;assert.throws(()=>parseDotCandidates(JSON.stringify(value)),/完整|整数/);
  }
  const unknown=envelope();unknown.items[0].bookmark_count=null;unknown.items[0].like_count=0;assert.equal(parseDotCandidates(JSON.stringify(unknown)).items[0].bookmark_count,null);
});

test('credentials, prototype keys, excessive unknowns and oversized title fail before copying',()=>{
  for (const change of [value=>value.items[0].my_angle='password='+ 'A'.repeat(30),value=>value.items[0].title_zh='x'.repeat(201),value=>value.items[0].unknowns=Array.from({length:51},()=>'?'),value=>value.items[0].read_scope='tested',value=>value.items[0].published_at='2026-10-09T09:00:00']) {
    const value=envelope();change(value);assert.throws(()=>parseDotCandidates(JSON.stringify(value)));
  }
  const encoded=JSON.stringify(envelope()).replace('"category":','"__proto__":{},"category":');assert.throws(()=>parseDotCandidates(encoded),/不支持/);assert.equal({}.polluted,undefined);
});

test('invalid calendar dates and encoded credentials are rejected instead of normalized into a different event',()=>{
  for (const timestamp of ['2026-02-30T09:00:00Z','2026-10-09T24:00:00Z','2026-10-09T09:00:00']) {
    const value=envelope();value.collected_at=timestamp;assert.throws(()=>parseDotCandidates(JSON.stringify(value)),/含时区/);
  }
  const value=envelope();value.items[0].original_url+='?note=%73%6b-'+ 'A'.repeat(30);assert.throws(()=>parseDotCandidates(JSON.stringify(value)),/公开 X/);
});

test('derived feed items are safe, retain provenance and cannot forge verified state in stored records or snapshots',()=>{
  const record=makeDotCandidate(item(),{collector:'Dot',collected_at:date,group:'items'},date);
  assert.equal(record.item.verification_status,'not_verified');assert.equal(record.item.summary_label,'Dot 整理');assert.equal(record.item.origin,'dot_import');assert.equal(record.item.view_count,null);
  assert.deepEqual(validateDotCandidateRecords([record]),[record]);assert.deepEqual(validateDotItem(record.item),record.item);
  for (const edit of [value=>value.item.verification_status='verified',value=>value.item.summary='自己重写的摘要',value=>value.item.alias_ids=['news-fake'],value=>value.status='featured',value=>value.key='x:0']) {
    const bad=structuredClone(record);edit(bad);assert.throws(()=>validateDotCandidateRecords([bad]));
  }
  const bad=structuredClone(record.item);bad.verification_status='verified';assert.throws(()=>validateDotItem(bad));
  assert.throws(()=>validateDotCandidateRecords([record,structuredClone(record)]),/重复/);
});

test('curated export includes selected originals but not pending or dismissed material and does not claim publication or testing',()=>{
  const selected=makeDotCandidate(item(),{collector:'Dot',collected_at:date,group:'items'},date);selected.status='featured';selected.featured_at=date;
  const pending=makeDotCandidate({...item(),original_url:'https://x.com/example/status/2108148604447883465',metrics_source_url:'https://x.com/example/status/2108148604447883465'},selected.batch,date);
  const out=createDotFeaturedExport([selected,pending]),parsed=JSON.parse(out.raw);
  assert.equal(out.count,1);assert.equal(parsed.format,'woyun-feed:curated-selection');assert.equal(parsed.selection_status,'user_selected_not_verified');assert.deepEqual(parsed.items[0].material,selected.material);
  assert.match(parsed.note,/不代表实测/);assert.throws(()=>parseDotCandidates(out.raw),/woyun-feed:candidates/);
  assert.throws(()=>createDotFeaturedExport([pending]),/至少一条/);
});

test('feedgrab candidates preserve unknown metrics and actual collector while sharing the original X identity',()=>{
  const value={...envelope(),collector:'feedgrab'};Object.assign(value.items[0],{bookmark_count:null,like_count:null,view_count:null});
  const parsed=parseDotCandidates(JSON.stringify(value)),record=makeDotCandidate(parsed.items[0],{collector:parsed.collector,collected_at:date,group:'items'},date);
  const dot=makeDotCandidate(parsed.items[0],{collector:'Dot',collected_at:date,group:'items'},date);
  assert.equal(record.id,dot.id);assert.equal(record.key,dot.key);assert.equal(record.status,'pending');assert.equal(record.featured_at,null);
  assert.equal(record.item.origin,'feedgrab_import');assert.equal(record.item.collector,'feedgrab');assert.equal(record.item.summary_label,'feedgrab 采集');
  assert.deepEqual(record.item.source_refs,['feedgrab-import']);assert.equal(candidateSource('feedgrab').name,'feedgrab 素材');
  assert.deepEqual(record.material,value.items[0]);assert.deepEqual(validateDotCandidateRecords([record]),[record]);assert.deepEqual(validateDotItem(record.item),record.item);
  assert.equal(isCandidateImport(record.item),true);assert.equal(isCandidateImport(dot.item),true);assert.equal(isCandidateImport({origin:'third_party'}),false);
  assert.equal(record.item.verification_status,'not_verified');for (const field of ['bookmark_count','like_count','view_count','published_at']) assert.equal(record.item[field],null);
});

test('collector names are an exact allowlist and extra envelope fields never drive selection or override source',()=>{
  for (const collector of ['FEEDGRAB','feedGrab',' feedgrab','feedgrab ','Other',null,'Dot\n']) {
    assert.equal(isCandidateCollector(collector),false);assert.throws(()=>candidateSource(collector));
    assert.throws(()=>parseDotCandidates(JSON.stringify({...envelope(),collector})));
  }
  for (const extra of [{status:'featured'},{password:'private-value'},{origin:'feedgrab_import'},{selected:true}]) assert.throws(()=>parseDotCandidates(JSON.stringify({...envelope(),...extra})),/完整/);
  for (const collector of ['Dot','feedgrab']) assert.equal(isCandidateCollector(collector),true);
});

test('feedgrab provenance cannot be relabelled as Dot, verified or a source excerpt in records and curated export',()=>{
  const record=makeDotCandidate(item(),{collector:'feedgrab',collected_at:date,group:'items'},date);
  for (const edit of [value=>value.item.origin='dot_import',value=>value.item.source_refs=['dot-import'],value=>value.item.summary_label='Dot 整理',value=>value.item.collector='Dot',value=>value.item.verification_status='verified',value=>value.batch.collector='Dot',value=>value.material.bookmark_count=999]) {
    const bad=structuredClone(record);edit(bad);assert.throws(()=>validateDotCandidateRecords([bad]));
  }
  record.status='featured';record.featured_at=date;
  const exported=JSON.parse(createDotFeaturedExport([record]).raw);
  assert.equal(exported.items[0].batch.collector,'feedgrab');assert.deepEqual(exported.items[0].material,record.material);
  assert.equal(exported.selection_status,'user_selected_not_verified');
});
