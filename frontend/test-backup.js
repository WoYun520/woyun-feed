import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBackup, parseBackup, planRestore, BACKUP_LIMIT } from './src/backup.js';
import { createTrialPlan } from './src/trialPlan.js';
import { FeedDataAdapter } from './src/dataAdapter.js';
const item={id:'github-1',title:'示例工具',summary:'用途',source_refs:['github'],original_url:'https://github.com/example/tool',verification_status:'not_tested'};
const feed={mode:'live',schema_version:'0.2',profile:{interests:'',exclude:'',language:'zh-CN'},items:[item],sources:[],sections:{daily:['github-1'],discover:[]}};
const empty=()=>({saved_item_ids:[],hidden_item_ids:[],followups:[],profile_override:null,item_snapshots:{}});
function fixture() {
 const task={id:'followup-example',item_id:'github-1',question:'有什么用？',status:'done',created_at:'2026-09-28T12:00:00Z',updated_at:'2026-09-28T12:00:00Z',research_request_id:'reader-example',research:{id:'reader-example',item_id:'github-1',status:'done',source:{url:'https://github.com/example/tool#readme',api_url:'https://api.github.com/repos/example/tool/readme',path:'README.md',sha:'a'.repeat(40),captured_at:'2026-09-28T12:00:00Z',truncated:false},report:{summary:'原摘要',can_do:['文字处理'],who_for:'建议写作者',first_steps:['阅读官方说明'],cost_and_limits:'未知',unknowns:['未实测'],next_step:'做一次对照'}}};
 task.trial_plan=createTrialPlan(task);
 return {...empty(),saved_item_ids:['github-1'],followups:[task],profile_override:{interests:'AI 工具',exclude:'融资',language:'zh-CN'},item_snapshots:{'github-1':structuredClone(item)}};
}
async function setup() {
 const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 globalThis.fetch=async()=>({ok:true,json:async()=>structuredClone(feed)});
 const adapter=new FeedDataAdapter();await adapter.loadFeed();return {adapter,storage};
}
test('backup round trip retains result, trial and sources while excluding unreferenced feed data',()=>{
 const original=fixture(); const before=structuredClone(original);
 const out=makeBackup(original,{...feed,items:[item,{...item,id:'github-2'}]},'live');const parsed=parseBackup(out.raw,'live');
 assert.deepEqual(parsed.state,original); assert.deepEqual(original,before);
 assert.equal(parsed.state.item_snapshots['github-2'],undefined);
 const restored=planRestore(empty(),parsed,{restoreProfile:true});
 assert.equal(restored.summary.tasks,1);assert.equal(restored.summary.trials,1);assert.equal(restored.summary.saved,1);
 assert.deepEqual(restored.next.followups[0].research.report,original.followups[0].research.report);
 assert.deepEqual(restored.next.followups[0].trial_plan,original.followups[0].trial_plan);
 assert.ok(restored.next.followups[0].imported_backup); assert.equal(restored.next.followups[0].research_request_id,undefined);
 assert.equal(restored.next.item_snapshots['github-1'].verification_status,'not_tested');
});
test('merge keeps current edits and preferences by default, repeated import is a no-op',()=>{
 const incoming=fixture();const current=fixture();current.followups[0].trial_plan.notes='当前新写的观察';current.profile_override.interests='当前偏好';
 const backup=makeBackup(incoming,feed,'live').backup;const merged=planRestore(current,backup);
 assert.equal(merged.summary.skipped,1);assert.equal(merged.summary.hasChanges,false);
 assert.equal(merged.next.followups[0].trial_plan.notes,'当前新写的观察');assert.equal(merged.next.profile_override.interests,'当前偏好');
 const explicit=planRestore(current,backup,{restoreProfile:true});assert.equal(explicit.next.profile_override.interests,'AI 工具');assert.equal(explicit.summary.profileChanged,true);
 const once=planRestore(empty(),backup).next;assert.equal(planRestore(once,backup).summary.tasks,0);
});
test('restored active tasks do not resume, poll, or call AI',async()=>{
 const source=fixture();delete source.followups[0].trial_plan;
 source.followups[0].status='analyzing';source.followups[0].research.status='analyzing';source.followups[0].research.report=null;
 const {adapter}=await setup();const raw=makeBackup(source,feed,'live').raw;
 globalThis.fetch=async()=>{throw Error('Import must not use network');};
 const p=adapter.previewBackup(raw);assert.equal(p.summary.paused,1);assert.equal(adapter.getState().followups.length,0);
 adapter.restoreBackup(p);await adapter.syncResearch();
 const restored=adapter.getState().followups[0];assert.equal(restored.status,'failed');assert.equal(restored.research_request_id,undefined);assert.match(restored.error_message,/未自动/);
});
test('invalid backups are rejected before mutation',()=>{
 const backup=makeBackup(fixture(),feed,'live').backup;
 const reject=edit=>{const b=structuredClone(backup);edit(b);assert.throws(()=>parseBackup(JSON.stringify(b),'live'));};
 assert.throws(()=>parseBackup('not JSON','live'),/有效/);
 assert.throws(()=>parseBackup('x'.repeat(BACKUP_LIMIT+1),'live'),/4 MB/);
 reject(b=>{b.version=99;});reject(b=>{b.mode='demo';});
 reject(b=>{b.state.followups[0].id='x" onclick="';});
 reject(b=>{b.state.item_snapshots['github-1'].original_url='javascript:alert(1)';});
 reject(b=>{b.state.followups.push(b.state.followups[0]);});
 reject(b=>{b.state.followups[0].research.report.can_do={bad:true};});
 reject(b=>{b.state.followups[0].trial_plan.source.sha='b'.repeat(40);});
 reject(b=>{b.state.followups[0].trial_plan.outcome='worked';});
 reject(b=>{b.state.followups[0].question='password: example-test-only-not-real';});
 reject(b=>{delete b.state.item_snapshots['github-1'];});
 assert.throws(()=>parseBackup(JSON.stringify(backup).replace('"state":{','"state":{"__proto__":{},'),'live'),/字段/);
});
test('preview is read-only; restore survives reload and refuses stale preview',async()=>{
 const {adapter}=await setup();const raw=makeBackup(fixture(),feed,'live').raw;
 const preview=adapter.previewBackup(raw);assert.equal(adapter.getState().followups.length,0);
 adapter.saveProfile({interests:'updated',exclude:''});assert.throws(()=>adapter.restoreBackup(preview),/预览后/);
 const current=adapter.previewBackup(raw);adapter.restoreBackup(current);
 const reloaded=new FeedDataAdapter();await reloaded.loadFeed();assert.equal(reloaded.getState().followups.length,1);
 assert.match(reloaded.exportFollowupText('followup-example'),/从备份恢复的历史记录/);
 assert.match(reloaded.exportTrialText('followup-example'),/从备份恢复的历史记录/);
 assert.equal(reloaded.getState().profile.interests,'updated');
 assert.equal(reloaded.previewBackup(raw).summary.hasChanges,false);
});
test('merge rejects combined limits before changing current data',()=>{
 const incoming=makeBackup(fixture(),feed,'live').backup;
 const current=fixture();current.followups=Array.from({length:500},(_,i)=>({...structuredClone(current.followups[0]),id:`followup-current-${i}`}));
 const before=structuredClone(current);
 assert.throws(()=>planRestore(current,incoming));assert.deepEqual(current,before);
});
test('storage failure rolls back everything; edits in another tab prevent clobbering',async()=>{
 const {adapter,storage}=await setup();const raw=makeBackup(fixture(),feed,'live').raw;
 const preview=adapter.previewBackup(raw);const before=structuredClone(adapter.localState);
 globalThis.localStorage.setItem=()=>{throw Error('full');};
 assert.throws(()=>adapter.restoreBackup(preview),/本地存储/);assert.deepEqual(adapter.localState,before);assert.equal(storage.size,0);
 storage.set(adapter.storageKey,JSON.stringify(fixture()));
 assert.throws(()=>adapter.restoreBackup(preview),/另一个页面/);assert.throws(()=>adapter.createBackup(),/另一个页面/);
});
