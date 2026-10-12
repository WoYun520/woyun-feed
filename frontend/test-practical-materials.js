import test from 'node:test';
import assert from 'node:assert/strict';
import {PRACTICAL_SOURCE,PRACTICAL_ITEMS,practicalMaterialKind,withPracticalMaterials} from './src/practicalMaterials.js';
import {makeBackup,parseBackup} from './src/backup.js';
import {blankTopic,buildTopicMaterial} from './src/topicWorkspace.js';

const old = {id:'news-'+ 'a'.repeat(24),title:'以前的公开材料',summary:'原摘要',source_refs:['news'],original_url:'https://example.com/old'};
const fixture = () => ({mode:'live',items:[structuredClone(old)],sources:[{id:'news',name:'原信息源',status:'failed',last_success_at:'2026-09-01T00:00:00Z'}],
  generated_at:'2026-09-01T00:00:00Z',publication:{version:'0.22.0',published_at:'2026-09-01T00:00:01Z'},
  refresh:{changed_item_ids:[old.id],message:'来源暂时失败，保留旧材料'},sections:{daily:[old.id],discover:[]},other_preserved:{example:true}});
function deepFreeze(value) { if(value && typeof value==='object') { Object.freeze(value);Object.values(value).forEach(deepFreeze); }return value; }
const empty = () => ({saved_item_ids:[],hidden_item_ids:[],followups:[],profile_override:null,item_snapshots:{}});

test('eight official notes carry traceable links, known capture time and untested boundaries',()=>{
  assert.equal(PRACTICAL_ITEMS.length,8);
  assert.equal(new Set(PRACTICAL_ITEMS.map(item=>item.id)).size,8);
  assert.equal(new Set(PRACTICAL_ITEMS.map(item=>item.original_url)).size,8);
  const officialHosts=new Set(['subtitleedit.github.io','chidiwilliams.github.io','support.google.com','flameshot.org','getsharex.com','support.apple.com','learn.microsoft.com','localsend.org','github.com']);
  const fields=new Set(['id','title','summary','summary_label','source_refs','original_url','canonical_url','published_at','updated_at','source_updated_at','captured_at','origin','link_kind','content_status','verification_status','unknowns','evidence_ref','evidence_refs','source_links']);
  for(const item of PRACTICAL_ITEMS) {
    assert.match(item.id,/^news-[a-f0-9]{24}$/);
    assert.deepEqual(item.source_refs,[PRACTICAL_SOURCE.id]);
    assert.equal(item.verification_status,'not_tested');
    assert.equal(item.published_at,null);assert.equal(item.updated_at,null);assert.equal(item.source_updated_at,null);
    assert.equal(item.captured_at,'2026-10-03T04:18:51.000Z');
    assert.ok(item.summary.length<=1000);assert.equal(item.summary.split('\n').length,5);
    for(const label of ['用途：','开始：','限制：','费用：','依据：']) assert.ok(item.summary.includes(label),`${item.title} missing ${label}`);
    assert.match(item.summary,/AI 按/);assert.match(item.summary,/未实测|未实际下载|未操作你的电脑实测|未执行文件改名/);
    assert.equal(item.source_links[0].url,item.original_url);
    assert.equal(item.evidence_refs.length,item.source_links.length);
    for(const link of item.source_links) {
      assert.equal(link.source_id,PRACTICAL_SOURCE.id);
      assert.ok(officialHosts.has(new URL(link.url).hostname));
      assert.equal(new URL(link.url).protocol,'https:');
      assert.ok(item.evidence_refs.includes(link.evidence_ref));
      assert.equal(link.captured_at,item.captured_at);assert.equal(link.source_updated_at,null);
      assert.equal(link.source_rank,null);assert.equal(link.heat_label,'');
    }
    assert.ok(Object.keys(item).every(key=>fields.has(key)),'no custom item fields');
  }
  assert.equal(PRACTICAL_SOURCE.kind,'curated');
  assert.equal(PRACTICAL_SOURCE.last_success_at,null);assert.equal(PRACTICAL_SOURCE.last_attempt_at,null);
  assert.match(PRACTICAL_SOURCE.reading_note,/AI/);assert.match(PRACTICAL_SOURCE.reading_note,/不是用户核验/);assert.match(PRACTICAL_SOURCE.reading_note,/不自动/);
});

test('types require exact known identity and unchanged words, never keyword guesses',()=>{
  assert.equal(PRACTICAL_ITEMS.filter(item=>practicalMaterialKind(item)==='tool').length,6);
  assert.equal(PRACTICAL_ITEMS.filter(item=>practicalMaterialKind(item)==='tutorial').length,2);
  for(const item of PRACTICAL_ITEMS) {
    assert.ok(practicalMaterialKind(structuredClone(item)));
    assert.equal(practicalMaterialKind({...item,id:old.id}),null);
    assert.equal(practicalMaterialKind({...item,original_url:'https://example.com/copied'}),null);
    assert.equal(practicalMaterialKind({...item,title:item.title+' 我实测通过了'}),null);
    assert.equal(practicalMaterialKind({...item,summary:'伪造官方整理'}),null);
    assert.equal(practicalMaterialKind({...item,origin:'restored'}),practicalMaterialKind(item));
  }
  assert.equal(practicalMaterialKind({id:old.id,title:'字幕截图工具',summary:'开始：下载',original_url:PRACTICAL_ITEMS[0].original_url}),null);
  assert.equal(practicalMaterialKind(null),null);
});

test('only live feeds with real item/source arrays receive the supplement',()=>{
  for(const input of [null,undefined,{mode:'demo',items:[],sources:[]},{mode:'live',items:null,sources:[]},{mode:'live',items:[],sources:null}])
    assert.equal(withPracticalMaterials(input),input);
  const demo={...fixture(),mode:'demo'};assert.equal(withPracticalMaterials(demo),demo);assert.equal(demo.items.length,1);
});

test('append preserves every old object and timestamp, sections, refresh and publication',()=>{
  const input=deepFreeze(fixture()),before=JSON.stringify(input);
  const result=withPracticalMaterials(input);
  assert.notEqual(result,input);assert.equal(result.items.length,9);assert.equal(result.sources.length,2);
  assert.equal(result.items[0],input.items[0]);assert.equal(result.sources[0],input.sources[0]);
  for(const key of ['generated_at','sections','publication','refresh','other_preserved']) assert.equal(result[key],input[key]);
  assert.equal(JSON.stringify(input),before);
  assert.deepEqual(result.items.slice(1),PRACTICAL_ITEMS);
});

test('repeated augmentation is a no-op and same ID or link never replaces old content',()=>{
  const once=withPracticalMaterials(fixture());assert.equal(withPracticalMaterials(once),once);
  const current={...fixture(),items:[{...old,id:PRACTICAL_ITEMS[0].id},{...old,id:'news-'+ 'b'.repeat(24),original_url:PRACTICAL_ITEMS[1].original_url+'/#reader'}]};
  const result=withPracticalMaterials(current);
  assert.equal(result.items.length,8);assert.equal(result.items[0],current.items[0]);assert.equal(result.items[1],current.items[1]);
  assert.equal(result.items[0].summary,'原摘要');assert.equal(practicalMaterialKind(result.items[0]),null);
  assert.equal(result.items.filter(item=>item.id===PRACTICAL_ITEMS[0].id).length,1);
  assert.equal(result.items.some(item=>item.id===PRACTICAL_ITEMS[1].id),false);
});

test('an existing source object is kept and caller edits cannot alter future catalog additions',()=>{
  const input=fixture(),existing={...PRACTICAL_SOURCE,message:'原来源说明'};input.sources.push(existing);
  const result=withPracticalMaterials(input);assert.equal(result.sources,input.sources);assert.equal(result.sources[1],existing);
  result.items[1].summary='当前调用方修改';result.items[1].source_links[0].url='https://example.com/changed';
  const next=withPracticalMaterials(fixture());assert.equal(next.items[1].summary,PRACTICAL_ITEMS[0].summary);
  assert.equal(next.items[1].source_links[0].url,PRACTICAL_ITEMS[0].original_url);
});

test('backup round trip keeps all official notes, first steps, limits and evidence exactly',()=>{
  const feed=withPracticalMaterials(fixture()),state=empty();state.saved_item_ids=PRACTICAL_ITEMS.map(item=>item.id);
  const out=makeBackup(state,feed,'live'),parsed=parseBackup(out.raw,'live');
  for(const item of PRACTICAL_ITEMS) {
    assert.deepEqual(parsed.state.item_snapshots[item.id],item);
    assert.match(parsed.state.item_snapshots[item.id].summary,/开始：/);
    assert.match(parsed.state.item_snapshots[item.id].summary,/限制：/);
    assert.equal(practicalMaterialKind(parsed.state.item_snapshots[item.id]),practicalMaterialKind(item));
  }
  assert.equal(parsed.state.item_snapshots[old.id],undefined);
});

test('topic and AI exports retain complete five-line notes and linked official evidence',()=>{
  const feed=withPracticalMaterials(fixture()),state=empty(),at='2026-10-02T15:10:00.000Z';
  const topic={...blankTopic(),id:'topic-practical-test',title:'做教程要用的字幕、截图和文件工具',goal:'找适合自己电脑的工具',created_at:at,updated_at:at,
    materials:feed.items.slice(1).map(item=>({item,added_at:at,note:'先检查系统条件'}))};
  state.topics=[topic];const restored=parseBackup(makeBackup(state,feed,'live').raw,'live').state.topics[0];
  assert.deepEqual(restored.materials,topic.materials);
  for(const forAI of [false,true]) {
    const text=buildTopicMaterial(restored,{forAI});
    assert.equal((text.match(/> 开始：/g)||[]).length,8);assert.equal((text.match(/> 限制：/g)||[]).length,8);
    assert.equal((text.match(/> 费用：/g)||[]).length,8);assert.equal((text.match(/> 依据：/g)||[]).length,8);
    assert.ok(text.includes('未执行文件改名'));assert.ok(text.includes('这里指开源桌面版'));
    for(const item of PRACTICAL_ITEMS) {assert.ok(text.includes(item.original_url));for(const ref of item.evidence_refs) assert.ok(text.includes(ref));}
    assert.match(text,/不.*安装|未安装/);assert.match(text,/不能编造/);
  }
});
