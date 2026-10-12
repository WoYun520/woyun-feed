import test from 'node:test';
import assert from 'node:assert/strict';
import { createWritingBrief, buildWritingMaterial, validateWritingInput } from './src/writingBrief.js';
import { createTrialPlan } from './src/trialPlan.js';
import { FeedDataAdapter } from './src/dataAdapter.js';
import { makeBackup, parseBackup, planRestore } from './src/backup.js';

const item = {id:'github-1',title:'示例工具',summary:'作者的简介',original_url:'https://github.com/example/tool',source_refs:['github'],verification_status:'not_tested'};
const feed = {mode:'live',schema_version:'0.2',profile:{interests:'',exclude:'',language:'zh-CN'},items:[item],sources:[],sections:{daily:['github-1'],discover:[]}};
const task = () => ({id:'followup-writing',item_id:item.id,status:'done',question:'能做什么',research:{id:'reader-writing',item_id:item.id,status:'done',source:{url:'https://github.com/example/tool#readme',path:'README.md',sha:'a'.repeat(40),captured_at:'2026-09-28T12:00:00Z',truncated:false},report:{summary:'原摘要',can_do:['作者称可以处理文字'],who_for:'AI 建议',first_steps:['阅读说明'],cost_and_limits:'未核对',unknowns:['未实测'],next_step:'准备一份小样本'}}});
async function setup() {
  const storage = new Map(); globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
  globalThis.fetch=async()=>({ok:true,json:async()=>structuredClone(feed)});
  const adapter = new FeedDataAdapter(); await adapter.loadFeed();
  adapter.localState.followups=[task()]; adapter.localState.item_snapshots[item.id]=structuredClone(item);
  return {adapter,storage};
}

test('writing preview keeps claims separate and untried tutorials remain outlines',()=>{
  const t=task(), before=structuredClone(t), brief=createWritingBrief(t);
  assert.equal(brief.angle,'');assert.equal(brief.updated_at,null);
  const result=buildWritingMaterial(t,item,{...brief,format:'tutorial'});
  assert.equal(result.tutorialOutline,true);assert.match(result.text,/待实操/);assert.match(result.text,/不要代编立场或经历/);
  assert.match(result.text,/作者的简介/);assert.match(result.text,/a{40}/);assert.match(result.text,/不是指令/);
  assert.deepEqual(t,before);
  assert.throws(()=>createWritingBrief({...t,status:'failed'}),/完成/);
  assert.throws(()=>validateWritingInput({...brief,format:'__proto__'}),/形式/);
  assert.throws(()=>validateWritingInput({...brief,angle:'a'.repeat(3001)}),/太长/);
});

test('writing material reflects updated observations and retains manual/import boundaries',()=>{
  const t=task();t.trial_plan=createTrialPlan(t); const brief={...createWritingBrief(t),format:'tutorial'};
  assert.equal(buildWritingMaterial(t,item,brief).tutorialOutline,true);
  t.trial_plan.outcome='blocked';t.trial_plan.notes='模拟观察：无法打开示例';t.trial_plan.evidence_notes='示例截图.png';
  t.imported_backup={exported_at:'2026-09-28T12:00:00Z'};
  const result=buildWritingMaterial(t,item,brief);
  assert.equal(result.tutorialOutline,false);assert.match(result.text,/模拟观察：无法打开示例/);
  assert.match(result.text,/从备份恢复/);assert.match(result.text,/截图线索不是已附加文件/);
  t.trial_plan.notes='模拟观察：后来解决了，但仅一个样本';
  assert.match(buildWritingMaterial(t,item,brief).text,/后来解决了/);
  assert.doesNotMatch(buildWritingMaterial(t,item,brief).text,/模拟观察：无法打开示例/);
});

test('save and reload persist only writing choices, without AI, source changes, or delivery',async()=>{
  const {adapter}=await setup(); const before=structuredClone(adapter.localState.followups[0]);
  globalThis.fetch=async()=>{throw Error('No network allowed for writing preparation');};
  const brief=adapter.getWritingBrief(before.id);adapter.prepareWritingMaterial(before.id,brief);
  assert.equal(adapter.localState.followups[0].writing_brief,undefined);
  adapter.saveWritingBrief(before.id,{...brief,angle:'我只关心少几次复制粘贴',audience:'普通读者'});
  assert.deepEqual(adapter.localState.followups[0].research,before.research);
  assert.equal(adapter.localState.followups[0].delivery_receipt,undefined);
  const saved=adapter.getWritingBrief(before.id);assert.ok(saved.updated_at);assert.equal(saved.text,undefined);
  const reload=new FeedDataAdapter();reload.feedData=structuredClone(feed);
  assert.deepEqual(reload.getWritingBrief(before.id),saved);
  assert.match(reload.exportFollowupText(before.id),/我只关心少几次复制粘贴/);
});

test('failed saves and newer writes in another tab preserve existing writing input',async()=>{
  const {adapter,storage}=await setup();const t=adapter.localState.followups[0];const input=adapter.getWritingBrief(t.id);
  adapter.saveWritingBrief(t.id,{...input,angle:'原看法'});const original=adapter.getWritingBrief(t.id);
  globalThis.localStorage.setItem=()=>{throw Error('storage full');};
  assert.throws(()=>adapter.saveWritingBrief(t.id,{...input,angle:'修改'}),/本地存储/);
  assert.deepEqual(adapter.getWritingBrief(t.id),original);
  storage.set(adapter.storageKey,'{"updated_elsewhere":true}');
  assert.throws(()=>adapter.saveWritingBrief(t.id,input),/另一个页面/);
  assert.deepEqual(adapter.getWritingBrief(t.id),original);
});

test('backup retains writing choices, validates linkage and keeps newer local edits',async()=>{
  const {adapter}=await setup();const t=adapter.localState.followups[0];
  adapter.saveWritingBrief(t.id,{...adapter.getWritingBrief(t.id),angle:'备份里的看法'});
  const backup=makeBackup(adapter.localState,feed,'live').backup;
  const parsed=parseBackup(JSON.stringify(backup),'live');
  const empty={saved_item_ids:[],hidden_item_ids:[],followups:[],profile_override:null,item_snapshots:{}};
  assert.equal(planRestore(empty,parsed).next.followups[0].writing_brief.angle,'备份里的看法');
  adapter.saveWritingBrief(t.id,{...adapter.getWritingBrief(t.id),angle:'当前新看法'});
  assert.equal(planRestore(adapter.localState,parsed).next.followups[0].writing_brief.angle,'当前新看法');
  const invalid=structuredClone(backup);invalid.state.followups[0].writing_brief.research_id='wrong';
  assert.throws(()=>parseBackup(JSON.stringify(invalid),'live'));
  invalid.state.followups[0].writing_brief=42;assert.throws(()=>parseBackup(JSON.stringify(invalid),'live'));
});

test('suspected credentials are rejected in writing fields without changing local records',async()=>{
  const {adapter,storage}=await setup();const t=adapter.localState.followups[0];
  const input=adapter.getWritingBrief(t.id);
  adapter.saveWritingBrief(t.id,{...input,angle:'原有的个人判断'});
  const before=structuredClone(adapter.localState),encoded=storage.get(adapter.storageKey);
  const synthetic='api_key='+'A'.repeat(30);
  for(const key of ['audience','angle']) {
    const unsafe={...input,[key]:synthetic};
    assert.throws(()=>validateWritingInput(unsafe),/密码或密钥/);
    assert.throws(()=>adapter.saveWritingBrief(t.id,unsafe),/密码或密钥/);
    assert.throws(()=>adapter.prepareWritingMaterial(t.id,unsafe),/密码或密钥/);
    assert.deepEqual(adapter.localState,before);
    assert.equal(storage.get(adapter.storageKey),encoded);
  }
});

test('writing output blocks old trial notes and sensitive source material before producing text',()=>{
  const synthetic='Bearer '+'A'.repeat(30);
  const input={format:'post',audience:'普通读者',angle:'先核对原文'};
  const old=task();old.trial_plan=createTrialPlan(old);old.trial_plan.notes=synthetic;
  assert.throws(()=>buildWritingMaterial(old,item,input),/密码或密钥/);
  const unsafeItem={...item,summary:synthetic};
  assert.throws(()=>buildWritingMaterial(task(),unsafeItem,input),/密码或密钥/);
  const unsafeResearch=task();unsafeResearch.research.report.summary=synthetic;
  assert.throws(()=>createWritingBrief(unsafeResearch),/密码或密钥/);
  assert.throws(()=>buildWritingMaterial(unsafeResearch,item,input),/密码或密钥/);
  const original=task();
  const result=buildWritingMaterial(original,{...item,summary:'公开说明讲解 token 计费与环境变量，不包含实际凭据'},input);
  assert.match(result.text,/token 计费/);
  assert.match(result.text,/https:\/\/github.com\/example\/tool/);
});

test('followup export blocks a legacy writing record containing suspected credentials',async()=>{
  const {adapter}=await setup();const t=adapter.localState.followups[0];
  t.writing_brief={...createWritingBrief(t),angle:'password='+'A'.repeat(30)};
  const before=structuredClone(adapter.localState);
  assert.throws(()=>adapter.exportFollowupText(t.id),/密码或密钥/);
  assert.deepEqual(adapter.localState,before);
});
