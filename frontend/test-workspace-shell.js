import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderWorkspaceNavigation,renderWorkspaceResume,recentWorkspaceTopic,renderWorkspaceStorageNotice} from './src/workspaceShell.js';
import {submitVisitorFeedback} from './src/visitorFeedback.js';

test('navigation preserves existing actions with one explicit current page and real counters',()=>{
  const state={publicPreview:true,mode:'live',savedItems:[{}],followups:[{}],dotPendingCandidates:[{},{}]};
  const html=renderWorkspaceNavigation('candidates',state);
  for(const key of ['today','candidates','saved','topics','profile'])assert.equal((html.match(new RegExp(`id="nav-${key}"`,'g')) || []).length,1);
  assert.equal((html.match(/id="nav-tutorials"/g)||[]).length,0);
  assert.equal((html.match(/aria-current="page"/g)||[]).length,1);
  assert.match(html,/id="nav-candidates" aria-current="page"/);
  assert.match(html,/发现/);assert.match(html,/整理/);
  assert.equal(html.includes('实用教程'),false);assert.equal(html.includes('怎么用'),false);assert.equal(html.includes('id="open-guide"'),false);
  assert.match(html,/assets\/woyun-guides.png/);assert.ok(!html.includes('登录'));
});

test('resume uses actual latest unfinished topic without changing source order or inventing work',()=>{
  const topics=[{id:'new-done',title:'完成',status:'done',updated_at:'2026-10-10T09:00:00Z'},
    {id:'old',title:'旧主题',status:'working',updated_at:'2026-10-09T01:00:00Z'},
    {id:'current',title:'<新的主题>',status:'collecting',updated_at:'2026-10-10T01:00:00Z',next_step:'核对 <来源>'}];
  const previous=structuredClone(topics);
  assert.equal(recentWorkspaceTopic(topics).id,'current');assert.deepEqual(topics,previous);
  const html=renderWorkspaceResume({topics},v=>v);
  assert.match(html,/data-topic-open="current"/);assert.match(html,/&lt;新的主题&gt;/);assert.match(html,/核对 &lt;来源&gt;/);assert.ok(!html.includes('new-done'));
  assert.equal(renderWorkspaceResume({topics:[]},v=>v),'');
  assert.equal(recentWorkspaceTopic([{id:'done',title:'已做',status:'done'}]).id,'done');
});

test('public homepage nav has no pending-review entry',()=>{
  const state={publicPreview:true,mode:'live',savedItems:[],followups:[],dotPendingCandidates:[{},{}]};
  const html=renderWorkspaceNavigation('today',state,{homeView:'latest'});
  assert.doesNotMatch(html,/待过审|待筛选|home-review|lift-review|#review|\?review=/);
  assert.match(html,/id="home-feedback"/);
  assert.match(html,/意见反馈/);
  assert.ok(html.indexOf('id="home-cats"') < html.indexOf('id="home-feedback"'));
  assert.doesNotMatch(renderWorkspaceNavigation('today',{...state,publicPreview:false},{homeView:'latest'}),/意见反馈|home-feedback/);
  assert.doesNotMatch(html,/id="nav-|实用教程|收藏与跟进|主题工作台|我的关注|整理/);
  const open=renderWorkspaceNavigation('today',state,{homeView:'week',catsOpen:true});
  assert.match(open,/lift-cats is-open|is-open/);
  assert.doesNotMatch(open,/待过审|待筛选|home-review|lift-review|#review|\?review=/);
  assert.doesNotMatch(open,/id="nav-|实用教程|收藏与跟进|主题工作台/);
  const sidebar=renderWorkspaceNavigation('candidates',state);
  assert.match(sidebar,/id="nav-candidates"/);
  assert.doesNotMatch(sidebar,/待过审|home-review|#review|公开待过审/);
});

test('public app does not open a review flow from the address bar',()=>{
  const source=readFileSync(new URL('./src/app.js',import.meta.url),'utf8');
  const shell=readFileSync(new URL('./src/workspaceShell.js',import.meta.url),'utf8');
  const candidates=readFileSync(new URL('./src/dotCandidatesView.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/home-review|openReviewQueue|reviewRouteRequested|loadReviewQueue|decideReviewItem|#review|hash\s*=\s*'review'/);
  assert.doesNotMatch(shell,/home-review|reviewRouteRequested|#review|待过审/);
  assert.doesNotMatch(candidates,/renderReviewQueue|公开待过审|连接接收码后/);
  assert.doesNotMatch(`${source}\n${shell}`,/review=1/);
});

test('public feedback submits the note without a review token',async()=>{
  const calls=[];
  const result=await submitVisitorFeedback({text:'  首页有点挤  ',contact:'  @levi  '},async(url,options)=>{
    calls.push({url,options});
    return new Response(JSON.stringify({id:'11111111-1111-4111-8111-111111111111',created_at:'2026-10-17T02:30:00.000Z'}),{status:201,headers:{'Content-Type':'application/json'}});
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'/api/visitor-feedback');
  assert.equal(calls[0].options.method,'POST');
  assert.equal(calls[0].options.headers.Authorization,undefined);
  assert.deepEqual(JSON.parse(calls[0].options.body),{text:'首页有点挤',contact:'@levi'});
  assert.equal(result.id,'11111111-1111-4111-8111-111111111111');
  await assert.rejects(submitVisitorFeedback({text:'   '},async()=>{throw Error('should not send');}),/请写下想说的话/);
});

test('storage notice states actual local boundary and never auto-publication',()=>{
  assert.equal(renderWorkspaceStorageNotice({publicPreview:false}),'');
  const html=renderWorkspaceStorageNotice({publicPreview:true});
  assert.match(html,/只存在当前浏览器/);assert.match(html,/不会自动公开/);assert.match(html,/<details/);assert.ok(!html.includes(' open'));
  const visitor=renderWorkspaceStorageNotice({publicPreview:true},{audience:'visitor'});
  assert.equal(visitor,'');
  assert.doesNotMatch(visitor,/不会自动出现在公开首页|换设备前请自行备份|home-local-note/);
});
