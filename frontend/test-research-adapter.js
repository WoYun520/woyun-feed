import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedDataAdapter } from './src/dataAdapter.js';

const feed = { schema_version:'0.2', mode:'live', profile:{}, sources:[], items:[{id:'github-1',title:'Tool', original_url:'https://github.com/example/tool',source_refs:[]}], sections:{daily:['github-1'],discover:[]} };
const report = { summary:'文档说明用途',can_do:['作者宣称的能力'],who_for:'AI 建议',first_steps:['先读说明'],cost_and_limits:'未说明',unknowns:['未实测'],next_step:'人工核对' };
async function setup() {
  const store = new Map();
  globalThis.localStorage = {getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
  globalThis.fetch = async()=>({ok:true,json:async()=>structuredClone(feed)});
  const a = new FeedDataAdapter(); await a.loadFeed();
  const task = a.saveFollowupDraft('github-1','这个工具能做什么？');
  return {a,task,store};
}
const response = data=>({ok:true,json:async()=>structuredClone(data)});
test('lost POST response uses same request id on retry and completed results survive reload',async()=>{
  const {a,task,store}=await setup();
  const ids=[]; let job;
  globalThis.fetch=async(_url,opts)=>{const input=JSON.parse(opts.body);ids.push(input.request_id);job={id:input.request_id,item_id:input.item_id,status:'analyzing',updated_at:'2026-09-28T12:00:00Z',report:null};if(ids.length===1)throw Error('lost response');return response(job);};
  await assert.rejects(a.startResearch(task.id),/无法确认/);
  assert.equal(task.status,'requesting');
  await a.startResearch(task.id);
  assert.equal(ids[0],ids[1]);assert.equal(task.status,'analyzing');
  assert.throws(()=>a.removeFollowup(task.id),/进行/);
  assert.throws(()=>a.saveFollowupDraft('github-1','不同问题'),/进行/);
  job={...job,status:'done',report,source:{url:'https://github.com/example/tool#readme',sha:'a'.repeat(40)}};
  globalThis.fetch=async()=>response(job);await a.syncResearch();
  assert.equal(task.status,'done'); assert.match(a.exportFollowupText(task.id),/文档说明用途/);
  await a.startResearch(task.id); // no new POST on a finished task
  assert.equal(ids.length,2);
  globalThis.fetch=async()=>response(feed);const restored=new FeedDataAdapter();await restored.loadFeed();
  assert.equal(restored.getState().followups[0].research.report.summary,report.summary);
  const next=restored.saveFollowupDraft('github-1','如何开始用？');
  assert.notEqual(next.id,task.id);assert.equal(restored.getState().followups.length,2);
  assert.equal(restored.getState().followups[1].status,'done');
  assert.ok(store.has('personal-feed:live:v1'));
});
test('unavailable status keeps in-flight state; failed jobs can only retry explicitly',async()=>{
  const {a,task}=await setup();let job;
  globalThis.fetch=async(_u,opts)=>{const b=JSON.parse(opts.body);job={id:b.request_id,item_id:b.item_id,status:'reading',report:null};return response(job);};
  await a.startResearch(task.id);
  globalThis.fetch=async()=>{throw Error('offline');}; await a.syncResearch();
  assert.equal(task.status,'reading');assert.ok(a.getState().researchNotice);
  const oldId=task.research_request_id;
  globalThis.fetch=async()=>response({...job,status:'failed',error:'读取失败'});await a.syncResearch();
  assert.equal(task.status,'failed');assert.equal(task.error_message,'读取失败');
  let calls=0;globalThis.fetch=async(_u,opts)=>{calls++;const b=JSON.parse(opts.body);return response({...job,id:b.request_id});};
  await a.syncResearch();assert.equal(calls,0);
  await a.startResearch(task.id);assert.notEqual(task.research_request_id,oldId);assert.equal(calls,1);
});
test('local storage failure never reports a result as persisted',async()=>{
  const {a,task}=await setup();
  const before=structuredClone(task);globalThis.localStorage.setItem=()=>{throw Error('full');};
  await assert.rejects(a.startResearch(task.id),/本地存储/);
  assert.equal(task.status,before.status);
  globalThis.localStorage.setItem=()=>{};
  task.research_request_id='11223344-1122-1122-1122-112233445566';task.status='analyzing';
  globalThis.localStorage.setItem=()=>{throw Error('full');};
  assert.throws(()=>a.applyResearchJob(task,{id:task.research_request_id,item_id:'github-1',status:'done',report}),/本地存储/);
  assert.equal(task.status,'analyzing');assert.equal(task.research,undefined);
});
