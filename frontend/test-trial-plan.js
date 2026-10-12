import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrialPlan, validateTrialInput, exportTrialPlan } from './src/trialPlan.js';
import { FeedDataAdapter } from './src/dataAdapter.js';
const task = () => ({id:'followup-example',item_id:'github-1',status:'done',question:'有什么用？',research:{id:'reader-example',status:'done',source:{url:'https://github.com/example/tool#readme',path:'README.md',sha:'a'.repeat(40),captured_at:'2026-09-28T12:00:00Z',truncated:false},report:{summary:'原来的摘要',can_do:['文字处理'],who_for:'建议写作者',cost_and_limits:'未知',unknowns:['未实测'],next_step:'用示例材料做一次对照',first_steps:['选择自己的系统','打开示例材料']}}});
const feed={mode:'live',schema_version:'0.2',profile:{},items:[{id:'github-1',title:'Tool',verification_status:'not_tested',source_refs:[]}],sources:[],sections:{daily:['github-1'],discover:[]}};
async function setup() {
 const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 globalThis.fetch=async()=>({ok:true,json:async()=>structuredClone(feed)});
 const adapter=new FeedDataAdapter();await adapter.loadFeed();adapter.localState.followups=[task()];return {adapter,storage};
}
test('draft uses existing suggestions without mutating source or inventing trial results',()=>{
 const original=task();const before=structuredClone(original);const draft=createTrialPlan(original);
 assert.equal(draft.outcome,'not_started');assert.equal(draft.notes,'');assert.equal(draft.evidence_notes,'');
 assert.equal(draft.goal,original.research.report.next_step);assert.match(draft.steps,/选择自己的系统/);
 assert.deepEqual(original,before);draft.source.sha='changed';assert.equal(original.research.source.sha,'a'.repeat(40));
 assert.throws(()=>createTrialPlan({...original,status:'analyzing'}),/完成/);
});
test('success and failure require observations; unknown state and missing plan are rejected',()=>{
 const draft=createTrialPlan(task());
 for (const outcome of ['worked','blocked']) assert.throws(()=>validateTrialInput({...draft,outcome}),/实际/);
 assert.throws(()=>validateTrialInput({...draft,outcome:'verified'}),/进度/);
 assert.throws(()=>validateTrialInput({...draft,goal:''}),/目标/);
 assert.throws(()=>validateTrialInput({...draft,steps:''}),/步骤/);
 assert.equal(validateTrialInput({...draft,outcome:'blocked',notes:'模拟：没有对应平台下载'}).outcome,'blocked');
});
test('save, edit and reload keep trial separate from AI and original verification',async()=>{
 const {adapter}=await setup();const original=structuredClone(adapter.localState.followups[0].research);
 globalThis.fetch=async()=>{throw Error('No network should be used for a checklist');};
 const draft=adapter.getTrialPlan('followup-example');assert.equal(adapter.localState.followups[0].trial_plan,undefined);
 draft.goal='我的试用目标';draft.outcome='worked';draft.notes='模拟：看到预期结果';
 adapter.saveTrialPlan('followup-example',draft);
 assert.deepEqual(adapter.localState.followups[0].research,original);
 assert.equal(adapter.getState().allItems[0].verification_status,'not_tested');
 assert.throws(()=>adapter.saveTrialPlan('followup-example',{...draft,goal:'一个新目标'}),/目标或步骤变了/);
 const saved=adapter.getTrialPlan('followup-example');assert.ok(saved.edited_fields.includes('goal'));
 const exported=adapter.exportTrialText('followup-example');assert.match(exported,/手动记录/);assert.match(exported,/模拟：看到预期结果/);assert.match(exported,/a{40}/);assert.match(exported,/不代表已执行/);
 assert.match(adapter.exportFollowupText('followup-example'),/我的试用目标/);
 globalThis.fetch=async()=>({ok:true,json:async()=>structuredClone(feed)});
 const reload=new FeedDataAdapter();await reload.loadFeed();assert.deepEqual(reload.getTrialPlan('followup-example'),saved);
});
test('storage failure restores previous checklist and preserves AI result',async()=>{
 const {adapter}=await setup();const draft=adapter.getTrialPlan('followup-example');
 const setter=globalThis.localStorage.setItem;
 globalThis.localStorage.setItem=()=>{throw Error('storage full');};
 assert.throws(()=>adapter.saveTrialPlan('followup-example',draft),/本地存储/);
 assert.equal(adapter.localState.followups[0].trial_plan,undefined);
 globalThis.localStorage.setItem=setter;adapter.saveTrialPlan('followup-example',draft);const before=adapter.getTrialPlan('followup-example');
 globalThis.localStorage.setItem=()=>{throw Error('storage full');};
 assert.throws(()=>adapter.saveTrialPlan('followup-example',{...draft,goal:'changed'}),/本地存储/);
 assert.deepEqual(adapter.getTrialPlan('followup-example'),before);
});
test('exports distinguish screenshot prompts and actual notes, including truncated sources',()=>{
 const draft=createTrialPlan(task());draft.source.truncated=true;
 const out=exportTrialPlan(draft,'Example');
 assert.match(out,/尚未填写；没有试用结果/);assert.match(out,/不代表已有截图/);assert.match(out,/前 28000 字符/);assert.match(out,/未读取文件/);
 assert.doesNotMatch(out,/已实测通过/);
});

test('trial input rejects suspected credentials before changing saved records',async()=>{
 const {adapter,storage}=await setup(),id='followup-example';
 const draft=adapter.getTrialPlan(id);adapter.saveTrialPlan(id,draft);
 const before=structuredClone(adapter.localState),encoded=storage.get(adapter.storageKey);
 const synthetic='api_key='+'A'.repeat(30);
 for(const key of ['goal','steps','shots','notes','evidence_notes']) {
  const unsafe={...draft,[key]:synthetic};
  assert.throws(()=>validateTrialInput(unsafe),/密码或密钥/);
  assert.throws(()=>adapter.saveTrialPlan(id,unsafe),/密码或密钥/);
  assert.deepEqual(adapter.localState,before);
  assert.equal(storage.get(adapter.storageKey),encoded);
 }
});

test('trial creation and export guard old notes and source fields without inventing redacted output',()=>{
 const synthetic='Bearer '+'A'.repeat(30);
 const unsafeTask=task();unsafeTask.research.report.first_steps=[synthetic];
 assert.throws(()=>createTrialPlan(unsafeTask),/密码或密钥/);
 const old=createTrialPlan(task());old.notes=synthetic;
 assert.throws(()=>exportTrialPlan(old,'示例'),/密码或密钥/);
 const source=createTrialPlan(task());source.source.url='https://example.org?token='+'A'.repeat(30);
 assert.throws(()=>exportTrialPlan(source,'示例'),/密码或密钥/);
 const publicPlan=createTrialPlan(task());publicPlan.notes='公开说明介绍 token 计费，实际凭据需自己保管。';
 assert.match(exportTrialPlan(publicPlan,'示例'),/token 计费/);
 assert.match(exportTrialPlan(publicPlan,'示例'),/https:\/\/github.com\/example\/tool#readme/);
});

test('adapter trial export blocks old sensitive notes without touching storage',async()=>{
 const {adapter,storage}=await setup(),id='followup-example';
 adapter.saveTrialPlan(id,adapter.getTrialPlan(id));
 adapter.localState.followups[0].trial_plan.evidence_notes='password='+'A'.repeat(30);
 const before=structuredClone(adapter.localState),encoded=storage.get(adapter.storageKey);
 assert.throws(()=>adapter.exportTrialText(id),/密码或密钥/);
 assert.deepEqual(adapter.localState,before);
 assert.equal(storage.get(adapter.storageKey),encoded);
});
