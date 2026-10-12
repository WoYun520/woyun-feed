import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CREATOR_CATALOG,CREATOR_MATERIAL_SOURCE,CREATOR_MATERIALS,creatorMaterialKind,withCreatorMaterials} from './src/creatorCatalog.js';
import {makeBackup,parseBackup} from './src/backup.js';
import {blankTopic,buildTopicMaterial} from './src/topicWorkspace.js';

const old = {id:'news-'+ 'a'.repeat(24),title:'以前的公开材料',summary:'原摘要',source_refs:['news'],original_url:'https://example.com/old'};
const fixture = () => ({mode:'live',items:[structuredClone(old)],sources:[{id:'news',name:'原来源',status:'failed',last_success_at:'2026-09-01T00:00:00Z'}],generated_at:'2026-09-01T00:00:00Z',publication:{version:'0.28.0'},sections:{daily:[old.id]}});
const empty = () => ({saved_item_ids:[],hidden_item_ids:[],followups:[],profile_override:null,item_snapshots:{}});

test('catalog distinguishes fixed reading notes, enabled subscriptions and paused leads',()=>{
  assert.equal(CREATOR_CATALOG.length,13);
  assert.deepEqual(CREATOR_CATALOG.filter(author=>author.enabled_by_default).map(author=>author.id),['creator-ambertreelet','creator-vikingmute','creator-vista8','creator-ruanyifeng','creator-gera2ld','creator-esorhuang','creator-raymondhouch','creator-fqzlr']);
  assert.equal(new Set(CREATOR_CATALOG.map(author=>author.id)).size,13);
  for(const author of CREATOR_CATALOG) {
    if(author.handle) {
      assert.match(author.handle,/^[a-zA-Z0-9_]{1,15}$/);
      assert.equal(author.profile_url,`https://x.com/${author.handle}`);
    } else {
      assert.ok(author.profile_label);assert.equal(new URL(author.profile_url).protocol,'https:');
      assert.notEqual(new URL(author.profile_url).hostname,'x.com');
    }
    assert.ok(author.reason && author.reading_scope && author.category_label);
    assert.ok(['tool-practice','personal-projects','workflow'].includes(author.category));
    for(const url of author.material_urls) assert.equal(new URL(url).protocol,'https:');
    if(author.enabled_by_default) assert.ok(CREATOR_MATERIALS.some(item=>item.creator_id===author.id) || author.blog_source_ids?.length);
    else assert.equal(CREATOR_MATERIALS.some(item=>item.creator_id===author.id),false);
  }
});

test('eight original-material notes retain precise reading scope and never invent post time or trial evidence',()=>{
  assert.equal(CREATOR_MATERIALS.length,8);
  assert.equal(new Set(CREATOR_MATERIALS.map(item=>item.original_url)).size,8);
  for(const [index,item] of CREATOR_MATERIALS.entries()) {
    assert.equal(item.id,'news-'+createHash('sha256').update(item.original_url).digest('hex').slice(0,24));
    const author=CREATOR_CATALOG.find(author=>author.id===item.creator_id);
    assert.ok(author?.enabled_by_default);
    assert.equal(item.author_handle,author.handle);assert.equal(item.author_name,author.name);
    assert.equal(item.evidence_scope,'author_document_reading');assert.equal(item.verification_status,'not_tested');
    assert.equal(item.checked_at,item.captured_at);assert.equal(item.captured_at,index<6 ? '2026-10-03T07:45:31.000Z' : '2026-10-03T12:22:25.000Z');
    assert.equal(item.published_at,item.creator_id==='creator-ruanyifeng' ? '2020-01-14T04:59:12.000Z' : null);assert.equal(item.updated_at,null);assert.equal(item.source_updated_at,null);
    assert.deepEqual(item.source_refs,[CREATOR_MATERIAL_SOURCE.id]);
    assert.equal(item.summary.split('\n').length,5);assert.ok(item.summary.length<=1000);
    for(const label of ['用途：','开始：','适合：','限制与费用：','依据：'])assert.ok(item.summary.includes(label));
    assert.match(item.summary,/未下载|未运行|未安装|未复现/);
    assert.equal(item.source_links[0].url,item.original_url);
    assert.equal(item.source_links[0].source_rank,null);assert.equal(item.source_links[0].heat_label,'');
    assert.ok(item.evidence_refs.includes(item.source_links[0].evidence_ref));
  }
  assert.equal(CREATOR_MATERIAL_SOURCE.last_success_at,null);assert.equal(CREATOR_MATERIAL_SOURCE.last_attempt_at,null);
  assert.match(CREATOR_MATERIAL_SOURCE.reading_note,/不是完整 X 时间线/);
});

test('an actionable non-AI original sample remains eligible without keyword or popularity gates',()=>{
  const example=CREATOR_MATERIALS.find(item=>item.creator_id==='creator-ambertreelet');
  assert.doesNotMatch(example.title+' '+example.summary,/\bAI\b|人工智能/i);
  assert.match(example.summary,/Settings → Pages/);
  assert.equal(creatorMaterialKind(example),'tool');
  assert.equal(example.heat_label,undefined);
  assert.equal(CREATOR_MATERIALS.some(item=>/赚了|收入|融资|利润/.test(item.title)),false);
});

test('known reading classification cannot be forged by identity, source URL or edited words',()=>{
  for(const item of CREATOR_MATERIALS) {
    assert.equal(creatorMaterialKind(structuredClone(item)),item.material_kind);
    for(const patch of [{id:old.id},{original_url:'https://example.com/copy'},{creator_id:'creator-abskoop'},{author_handle:'abskoop'},
      {author_name:'未经核对的作者'},{summary:item.summary+'我实测通过'},{title:item.title+'已验证'},
      {summary_label:'用户已实测通过'},{checked_at:'2026-10-04T00:00:00.000Z'},{captured_at:'2026-10-04T00:00:00.000Z'},
      {canonical_url:'https://example.com/copy'},{material_kind:'tutorial'},{evidence_scope:'user_verified'},
      {verification_status:'verified'},{content_status:'full_text'},{evidence_ref:'edited'},
      {source_refs:['news']},{evidence_refs:['edited']},{source_links:[{...item.source_links[0],url:'https://example.com/copy'}]},
      {unknowns:[]}])assert.equal(creatorMaterialKind({...item,...patch}),null);
  }
  assert.equal(creatorMaterialKind(null),null);
  assert.equal(creatorMaterialKind({title:'安装教程',summary:'开始：下载'}),null);
});

test('material augmentation is live-only, preserves old data and does not update source freshness',()=>{
  for(const input of [null,undefined,{mode:'demo',items:[],sources:[]},{mode:'live',items:[],sources:null}])assert.equal(withCreatorMaterials(input),input);
  const input=fixture(),before=structuredClone(input),result=withCreatorMaterials(input);
  assert.deepEqual(input,before);assert.equal(result.items[0],input.items[0]);assert.equal(result.sources[0],input.sources[0]);
  for(const key of ['generated_at','publication','sections'])assert.equal(result[key],input[key]);
  assert.equal(result.items.length,9);assert.equal(result.sources.length,2);
  assert.equal(withCreatorMaterials(result),result);
});

test('same URL or item ID retains existing content; caller edits do not corrupt future notes',()=>{
  const input=fixture();input.items.push({...old,id:CREATOR_MATERIALS[0].id},{...old,id:'news-'+ 'b'.repeat(24),original_url:CREATOR_MATERIALS[1].original_url+'#step'});
  const result=withCreatorMaterials(input);
  assert.equal(result.items.length,9);assert.equal(result.items[1],input.items[1]);assert.equal(result.items[2],input.items[2]);
  assert.equal(result.items[1].summary,'原摘要');assert.equal(creatorMaterialKind(result.items[1]),null);
  result.items[3].summary='调用者修改';result.items[3].source_links[0].url='https://example.com/changed';
  assert.deepEqual(withCreatorMaterials(fixture()).items.slice(1),CREATOR_MATERIALS);
});

test('backup round-trip keeps author identity, notes, source links and reading boundaries',()=>{
  const feed=withCreatorMaterials(fixture()),state=empty();state.saved_item_ids=CREATOR_MATERIALS.map(item=>item.id);
  const parsed=parseBackup(makeBackup(state,feed,'live').raw,'live');
  for(const item of CREATOR_MATERIALS) {
    assert.deepEqual(parsed.state.item_snapshots[item.id],item);
    assert.equal(creatorMaterialKind(parsed.state.item_snapshots[item.id]),item.material_kind);
  }
});

test('topic and AI exports retain original steps and explicit untested boundary',()=>{
  const at='2026-10-03T08:00:00.000Z';
  const topic={...blankTopic(),id:'topic-creator-test',title:'值得跟着做的公开材料',goal:'先看步骤与边界',created_at:at,updated_at:at,materials:CREATOR_MATERIALS.map(item=>({item:structuredClone(item),added_at:at,note:'只读未试用'}))};
  for(const forAI of [false,true]) {
    const output=buildTopicMaterial(topic,{forAI});
    for(const item of CREATOR_MATERIALS){assert.ok(output.includes(item.original_url));assert.ok(output.includes(item.evidence_ref));}
    assert.equal((output.match(/> 开始：/g)||[]).length,8);
    assert.equal((output.match(/> 依据：/g)||[]).length,8);
    assert.match(output,/未下载、安装或实测/);
  }
});


test('new tutorial dates and trials never refresh or relabel six older reading notes',()=>{
  for(const item of CREATOR_MATERIALS.slice(0,6)) {
    assert.equal(item.captured_at,'2026-10-03T07:45:31.000Z');assert.equal(item.checked_at,item.captured_at);
    assert.equal(item.published_at,null);assert.equal(item.verification_status,'not_tested');
    assert.equal(item.source_links[0].captured_at,item.captured_at);
  }
  const frame=CREATOR_MATERIALS.find(item=>item.creator_id==='creator-ruanyifeng');
  assert.equal(frame.published_at,'2020-01-14T04:59:12.000Z');assert.notEqual(frame.published_at,frame.captured_at);
  const output=buildTopicMaterial({...blankTopic(),id:'topic-new-trial',title:'视频截图',created_at:'2026-10-03T12:25:00Z',updated_at:'2026-10-03T12:25:00Z',materials:[{item:frame,note:'只关注截图流程',added_at:'2026-10-03T12:25:00Z'}]});
  assert.match(output,/本站独立实测记录 · AI 本机观察/);assert.match(output,/合成视频/);assert.match(output,/原始材料的未实测状态与范围仍保留/);
  assert.equal(frame.verification_status,'not_tested');assert.doesNotMatch(JSON.stringify(frame),/\/Users\/|trial_url|user_verified/);
});
