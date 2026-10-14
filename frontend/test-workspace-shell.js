import test from 'node:test';
import assert from 'node:assert/strict';
import {renderWorkspaceNavigation,renderWorkspaceResume,recentWorkspaceTopic,renderWorkspaceStorageNotice} from './src/workspaceShell.js';

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

test('storage notice states actual local boundary and never auto-publication',()=>{
  assert.equal(renderWorkspaceStorageNotice({publicPreview:false}),'');
  const html=renderWorkspaceStorageNotice({publicPreview:true});
  assert.match(html,/只存在当前浏览器/);assert.match(html,/不会自动公开/);assert.match(html,/<details/);assert.ok(!html.includes(' open'));
  const visitor=renderWorkspaceStorageNotice({publicPreview:true},{audience:'visitor'});
  assert.equal(visitor,'');
  assert.doesNotMatch(visitor,/不会自动出现在公开首页|换设备前请自行备份|home-local-note/);
});
