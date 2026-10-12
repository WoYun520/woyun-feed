import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RepositoryGuideService, validateGuides, guideInputs } from './repository-guide-service.js';
import { repositoryPresentation, repositoryName } from './src/repositoryGuide.js';
import { parseObservationCatalog } from './import-observation-catalog.mjs';
import { createFeedServer } from './serve.js';
import { ResearchService } from './research-service.js';
import { randomUUID } from 'node:crypto';
import { blankTopic, buildTopicMaterial } from './src/topicWorkspace.js';
import { makeBackup, parseBackup } from './src/backup.js';

const item={id:'github-1',title:'tool',summary:'Local clipboard history for Mac',original_url:'https://github.com/example/tool',source_refs:['github']};
async function setup(t,runner) {
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'feed-guides-'));
  t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));
  const feed={items:[structuredClone(item)]};
  const service=new RepositoryGuideService({dataDir,feed:{current:async()=>feed},runner:runner || (async({entries})=>({report:{entries:entries.map(entry=>({repository:entry.repository,summary:'在 Mac 上找回之前复制的文字。'}))}}))});
  return {dataDir,feed,service};
}

test('Chinese uses survive restart, keep original evidence, and changed descriptions invalidate cache',async t=>{
  const {service,feed,dataDir}=await setup(t);
  const before=structuredClone(feed);
  await service.start();await service.work;
  const output=await service.decorate(feed);
  assert.equal(output.items[0].repository_guide.basis,'description');
  assert.equal(output.items[0].summary,item.summary);
  assert.match(repositoryPresentation(output.items[0]).title,/找回/);
  assert.deepEqual(feed,before);
  const restarted=new RepositoryGuideService({dataDir,feed:{current:async()=>feed}});
  assert.equal((await restarted.decorate(feed)).items[0].repository_guide.summary,output.items[0].repository_guide.summary);
  feed.items[0].summary='A completely different app';
  assert.equal((await restarted.decorate(feed)).items[0].repository_guide,undefined);
  assert.equal(repositoryPresentation((await restarted.decorate(feed)).items[0]).missing,true);
});

test('double clicks share one job; completed introductions are not billed again',async t=>{
  let finish,calls=0;const wait=new Promise(resolve=>{finish=resolve;});
  const {service}=await setup(t,async({entries})=>{calls++;await wait;return {report:{entries:entries.map(entry=>({repository:entry.repository,summary:'在 Mac 上整理复制记录。'}))}};});
  const [a,b]=await Promise.all([service.start(),service.start()]);
  assert.equal(a.status,'working');assert.equal(b.status,'working');
  finish();await service.work;
  await service.start();assert.equal(calls,1);
  assert.match((await service.status()).message,/没有重复/);
});

test('invalid or failed AI output never becomes a Chinese fact and previous cache is retained',async t=>{
  const {service,feed}=await setup(t);
  await service.start();await service.work;
  feed.items.push({...item,id:'github-2',original_url:'https://github.com/example/new'});
  service.runner=async()=>({report:{entries:[{repository:'attacker/other',summary:'凭空捏造'}]}});
  await service.start();await service.work;
  assert.equal((await service.status()).status,'failed');
  const output=await service.decorate(feed);
  assert.ok(output.items[0].repository_guide);
  assert.equal(output.items[1].repository_guide,undefined);
  assert.throws(()=>validateGuides({entries:[{repository:'example/tool',summary:'English only'}]},guideInputs({items:[item]})),/不一致/);
});

test('observation catalog is parsed as data, reused by repository identity, and labeled separately',async t=>{
  const {service,dataDir,feed}=await setup(t);
  const text='window.REPOSITORIES=[{fullName:"example/tool", capability:"整理复制记录。", example:"例如：找回复制的地址。", audience:"经常复制文字的人"}]; throw new Error("must not execute");';
  const entries=parseObservationCatalog(text);assert.equal(entries.length,1);
  assert.equal(parseObservationCatalog('window.REPOSITORIES.push(...[{"fullName":"example/quoted","capability":"整理文字。"}]);')[0].repository,'example/quoted');
  await fs.writeFile(path.join(dataDir,'observation-catalog.json'),JSON.stringify({version:1,imported_at:'2026-10-01T00:00:00Z',entries}));
  const output=await service.decorate(feed);
  assert.equal(output.items[0].repository_guide.basis,'observation');
  assert.equal(output.items[0].repository_guide.verification,'not_tested');
  assert.equal(repositoryPresentation(output.items[0]).basis,'观察仓库整理');
  assert.equal(repositoryName({...item,original_url:'https://example.com/example/tool'}),null);
  assert.equal(repositoryName({...item,original_url:'https://github.com/example/tool/issues/1'}),null);
});

test('completed README reports are reused; later repository changes prevent old report promotion',async t=>{
  const {service,dataDir,feed}=await setup(t);const dir=path.join(dataDir,'research','jobs');
  await fs.mkdir(dir,{recursive:true});
  const captured_at=new Date().toISOString();
  await fs.writeFile(path.join(dir,randomUUID()+'.json'),JSON.stringify({status:'done',repository:'example/tool',report:{summary:'在 Mac 中管理复制记录。'},source:{captured_at,sha:'a'.repeat(40),url:item.original_url+'#readme'}}));
  let output=await service.decorate(feed);assert.equal(output.items[0].repository_guide.basis,'readme');
  feed.items[0].pushed_at=new Date(Date.parse(captured_at)+1000).toISOString();
  output=await service.decorate(feed);assert.equal(output.items[0].repository_guide,undefined);
});

test('fixed summary HTTP endpoint protects mutations and serves persisted Chinese descriptions',async t=>{
  const {service,feed}=await setup(t);
  const server=createFeedServer({service:{current:async()=>feed},guides:service,research:{}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(url+'/api/repository-guides',{method:'POST'})).status,403);
  const headers={'X-Personal-Feed':'1'};
  assert.equal((await fetch(url+'/api/repository-guides',{method:'POST',headers:{...headers,Origin:'https://other.example'}})).status,403);
  assert.equal((await fetch(url+'/api/repository-guides',{method:'POST',headers})).status,202);
  await service.work;
  const output=await (await fetch(url+'/api/feed')).json();
  assert.equal(output.items[0].repository_guide.basis,'description');
  assert.equal((await (await fetch(url+'/api/repository-guides')).json()).status,'done');
});

test('trending GitHub repositories use the README reader while news links remain rejected',async t=>{
  const {dataDir}=await setup(t);
  const trending={...item,id:'news-'+'a'.repeat(24),repository_name:undefined,source_refs:['github-trending']};
  const news={...item,id:'news-'+'b'.repeat(24),repository_name:undefined,original_url:'https://news.example/story'};
  let called=0;
  const service=new ResearchService({dataDir,feed:{current:async()=>({items:[trending,news]})},
    fetchImpl:async()=>new Response(JSON.stringify({encoding:'base64',sha:'a'.repeat(40),content:Buffer.from('# Clipboard history').toString('base64')})),
    runner:async()=>{called++;return {report:{summary:'管理复制记录',can_do:['保存文字'],who_for:'写作者',first_steps:['读说明'],cost_and_limits:'未说明',unknowns:['未实测'],next_step:'试用'}};}});
  await service.start({request_id:randomUUID(),item_id:trending.id,question:'说明用途'});
  await service.work;assert.equal(called,1);
  await assert.rejects(service.start({request_id:randomUUID(),item_id:news.id,question:'说明用途'}),/没有找到/);
});

test('collected Chinese purpose stays distinct from raw description in export and backup',async t=>{
  const {service,feed}=await setup(t);
  await service.start();await service.work;
  const {items}=await service.decorate(feed),now=new Date().toISOString();
  const topic={...blankTopic(),id:'topic-test',title:'选一个复制工具',created_at:now,updated_at:now,materials:[{item:items[0],note:'留着比较',added_at:now}]};
  const exported=buildTopicMaterial(topic);
  assert.match(exported,/中文用途/);assert.match(exported,/Local clipboard history/);assert.match(exported,/尚未实测/);
  const state={saved_item_ids:[],hidden_item_ids:[],followups:[],profile_override:null,item_snapshots:{},topics:[topic]};
  const saved=makeBackup(state,{items,sources:[],mode:'live'},'live');
  const restored=parseBackup(saved.raw,'live');
  assert.equal(restored.state.topics[0].materials[0].item.repository_guide.summary,items[0].repository_guide.summary);
  const altered=JSON.parse(saved.raw);altered.state.topics[0].materials[0].item.repository_guide.verification='tested';
  assert.throws(()=>parseBackup(JSON.stringify(altered),'live'),/中文用途/);
});
