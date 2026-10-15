import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {renderWorkspaceNavigation,renderWorkspaceResume,recentWorkspaceTopic,renderWorkspaceStorageNotice,reviewRouteRequested} from './src/workspaceShell.js';

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

test('public homepage offers a quiet review entry without the workspace sidebar',()=>{
  const state={publicPreview:true,mode:'live',savedItems:[],followups:[],dotPendingCandidates:[{},{}]};
  const html=renderWorkspaceNavigation('today',state,{homeView:'latest'});
  assert.match(html,/id="home-review" href="#review"/);
  assert.match(html,/>待过审</);
  assert.doesNotMatch(html,/id="nav-|实用教程|收藏与跟进|主题工作台|我的关注|待筛选|整理/);
  const open=renderWorkspaceNavigation('today',state,{homeView:'week',catsOpen:true});
  assert.match(open,/id="home-review"/);
  assert.match(open,/lift-cats is-open|is-open/);
  assert.doesNotMatch(open,/id="nav-|实用教程|收藏与跟进|主题工作台/);
  const sidebar=renderWorkspaceNavigation('candidates',state);
  assert.match(sidebar,/id="nav-candidates"/);
  assert.match(sidebar,/待筛选/);
  assert.doesNotMatch(sidebar,/id="home-review"/);
  assert.equal(reviewRouteRequested({hash:'#review',search:''}),true);
  assert.equal(reviewRouteRequested({hash:'#Review',search:''}),true);
  assert.equal(reviewRouteRequested({hash:'#/review',search:''}),true);
  assert.equal(reviewRouteRequested({hash:'',search:'?review=1'}),true);
  assert.equal(reviewRouteRequested({hash:'#latest',search:'?review=1&home=week'}),true);
  assert.equal(reviewRouteRequested({searchParams:{get:key=>key==='review'?'1':null}}),true);
  assert.equal(reviewRouteRequested({hash:'',search:''}),false);
  assert.equal(reviewRouteRequested({hash:'#review-queue',search:''}),false);
  assert.equal(reviewRouteRequested({hash:'',search:'?review=0'}),false);
  assert.equal(reviewRouteRequested({hash:'',search:'?review=true'}),false);
  assert.equal(reviewRouteRequested(null),false);
});

test('review route opens the existing queue and still requires a connected review code',async()=>{
  const source=readFileSync(new URL('./src/app.js',import.meta.url),'utf8').split('// 页面加载完成后启动应用')[0].replace(/^import [^\n]*\n/gm,'')+'\nthis.PersonalFeedApp=PersonalFeedApp;';
  const calls=[];
  const location={hash:'',search:'',href:'https://preview.example/',pathname:'/'};
  const history={state:null,replaceState(_state,_title,next){
    const url=new URL(next,location.href);
    location.href=url.href;location.hash=url.hash;location.search=url.search;location.pathname=url.pathname;
  }};
  const listeners={};
  const sandbox={
    reviewRouteRequested,location,history,URL,
    document:{getElementById:()=>null,addEventListener(){}},
    window:{
      addEventListener(type,handler){(listeners[type] ||= []).push(handler);},
      scrollTo(){},
    },
  };
  assert.match(source,/getElementById\('home-review'\)/);
  assert.match(source,/openReviewQueue\(\)/);
  assert.match(source,/!this\.dotInbox\.getState\(\)\.connected/);
  vm.runInNewContext(source,sandbox,{filename:'src/app.js'});
  const app=Object.assign(Object.create(sandbox.PersonalFeedApp.prototype),{
    currentTab:'today',openedFromReviewRoute:false,dotIntakeOpen:false,homeMenuOpen:false,
    reviewQueue:{items:[],error:'',loading:false,busy:false},
    dotInbox:{getState:()=>({connected:false}),listPendingQueue(){calls.push('list');return Promise.resolve([]);},decidePending(){calls.push('decide');}},
    render(){calls.push(`render:${this.currentTab}`);},
  });
  app.bindGlobalEvents();
  location.hash='#review';
  for (const handler of listeners.hashchange) handler();
  assert.equal(app.currentTab,'candidates');
  assert.equal(app.openedFromReviewRoute,true);
  assert.equal(app.dotIntakeOpen,true);
  assert.match(calls.join(','),/render:candidates/);
  assert.deepEqual(calls.filter(call=>call==='list' || call==='decide'),[]);
  location.hash='';
  for (const handler of listeners.hashchange) handler();
  assert.equal(app.currentTab,'today');
  assert.equal(app.openedFromReviewRoute,false);
  location.search='?review=1';
  location.href='https://preview.example/?review=1';
  for (const handler of listeners.popstate) handler();
  assert.equal(app.currentTab,'candidates');
  app.switchTab('today');
  assert.equal(app.currentTab,'today');
  assert.equal(location.search,'');
  assert.equal(location.hash,'');
  app.dotInbox.getState=()=>({connected:true});
  app.currentTab='candidates';
  await app.loadReviewQueue();
  assert.deepEqual(calls.filter(call=>call==='list'),['list']);
  assert.deepEqual(calls.filter(call=>call==='decide'),[]);
});

test('storage notice states actual local boundary and never auto-publication',()=>{
  assert.equal(renderWorkspaceStorageNotice({publicPreview:false}),'');
  const html=renderWorkspaceStorageNotice({publicPreview:true});
  assert.match(html,/只存在当前浏览器/);assert.match(html,/不会自动公开/);assert.match(html,/<details/);assert.ok(!html.includes(' open'));
  const visitor=renderWorkspaceStorageNotice({publicPreview:true},{audience:'visitor'});
  assert.equal(visitor,'');
  assert.doesNotMatch(visitor,/不会自动出现在公开首页|换设备前请自行备份|home-local-note/);
});
