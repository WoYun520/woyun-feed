import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMaterialStart, materialStartDetails, topicStartSteps } from './src/materialStart.js';
import { PRACTICAL_ITEMS } from './src/practicalMaterials.js';
import { buildTopicMaterial } from './src/topicWorkspace.js';

const item={id:'material-a',title:'一个工具',summary:'来源未提供完整用法',original_url:'https://example.com/tool',source_refs:['source-a'],captured_at:'2026-10-07T00:00:00Z',content_status:'metadata_only',verification_status:'not_tested'};
test('generic start keeps unknown conditions and two distinct editable intentions without inventing outcomes',()=>{
  const before=structuredClone(item),trial=buildMaterialStart(item),idea=buildMaterialStart(item,'write');
  assert.match(trial.title,/^试用：/);assert.match(idea.title,/^选题：/);
  assert.match(trial.goal,/本站起步建议.*尚未执行/);assert.match(idea.goal,/自己的体验/);
  for(const key of ['thoughts','gaps','next_step','result'])assert.equal(trial[key],'');
  assert.match(materialStartDetails(item).preparation,/条件还不清楚/);
  assert.match(materialStartDetails(item).cost,/费用待确认/);
  assert.deepEqual(item,before);
});
test('known official material uses already-read conditions and source first step without modifying evidence',()=>{
  const tool=PRACTICAL_ITEMS.find(x=>x.summary.startsWith('用途：')),before=structuredClone(tool);
  const details=materialStartDetails(tool),topic=buildMaterialStart(tool);
  assert.match(details.preparation,/需要|支持|系统|适用/);
  assert.notEqual(details.firstStep,'先打开来源，确认具体用法，再选一个最小案例亲自试一次。');
  assert.match(topic.goal,/起步：/);assert.deepEqual(tool,before);
});
test('large titles and source text stay within the existing topic schema and invalid intent is rejected',()=>{
  const values=buildMaterialStart({...item,title:'工具'.repeat(2000),summary:'说明'.repeat(2000)},'write');
  assert.ok(values.title.length<=100);assert.ok(values.goal.length<=1000);
  assert.throws(()=>buildMaterialStart(item,'unknown'),/试用或选题/);
  assert.throws(()=>buildMaterialStart(null),/暂不可用/);
});
test('suggested checklist is separate from user fields and hides once the user records completion',()=>{
  const topic=buildMaterialStart(item,'write');
  assert.equal(topicStartSteps(topic).length,3);
  assert.match(topicStartSteps(topic)[1],/亲自跑/);
  assert.equal(topicStartSteps({...topic,status:'done',result:'我试过了'}).length,0);
  assert.deepEqual(topicStartSteps({...topic,goal:'我自行填写的目标'}),[]);
  assert.equal(topic.result,'');assert.equal(topic.next_step,'');
});
test('AI export marks prefilled goal and checklist separately from personal experience and original source',()=>{
  const topic={...buildMaterialStart(item),id:'topic-a',created_at:'2026-10-07T00:00:00Z',updated_at:'2026-10-07T00:00:00Z',materials:[{item:structuredClone(item),note:'',manual_excerpt:null,added_at:'2026-10-07T00:00:00Z'}]};
  const exported=buildTopicMaterial(topic);
  assert.match(exported,/起步清单（本站建议）/);assert.match(exported,/不是用户想法或已完成记录/);
  assert.match(exported,/尚未填写个人安排或结果/);assert.match(exported,/https:\/\/example.com\/tool/);
  assert.match(exported,/来源未提供完整用法/);
  assert.doesNotMatch(buildTopicMaterial({...topic,status:'done',result:'亲自测试后发现不适合'}),/## 起步清单/);
});
