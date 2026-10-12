import test from 'node:test';
import assert from 'node:assert/strict';
import { needsWelcome, rememberWelcome, renderWelcome, renderGuide } from './src/welcome.js';
import { renderDotCandidatesView } from './src/dotCandidatesView.js';
import { renderTopicWorkspace } from './src/topicViews.js';
import { blankTopic } from './src/topicWorkspace.js';

function withGuide(run) {
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');
  const ids=['modal-close-btn','modal-backdrop','guide-start','guide-add'];
  const nodes=new Map(ids.map(id=>[id,{id,focus(){this.focused=true;}}]));
  const heading={focus(){this.focused=true;}};
  const document={getElementById:id=>nodes.get(id),querySelector:selector=>selector==='.page-headline'?heading:null};
  const calls=[];
  const app={feedView:'selected',closeModal(){calls.push('close');},dismissWelcome(){calls.push('dismiss');},switchTab(tab){calls.push(['tab',tab]);},addFromGuide(){calls.push('add');}};
  const root={innerHTML:''};Object.defineProperty(globalThis,'document',{configurable:true,writable:true,value:document});
  try {renderGuide(app,root);return run({app,root,nodes,heading,calls});}
  finally {if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document;}
}

test('welcome preference is independent from real collections, backup content and demo mode',()=>{
  const entries=new Map([['personal-feed:live:v1','untouched']]);
  const storage={getItem:key=>entries.get(key),setItem:(key,value)=>entries.set(key,value)};
  const state={mode:'live',topics:[],savedItems:[],archivedItems:[],followups:[]};
  assert.equal(needsWelcome(storage,state),true);assert.equal(rememberWelcome(storage,'live'),true);
  assert.equal(needsWelcome(storage,state),false);assert.equal(entries.get('personal-feed:live:v1'),'untouched');
  assert.equal(needsWelcome(storage,{...state,mode:'demo'}),true);
  for(const field of ['topics','savedItems','archivedItems','followups']) assert.equal(needsWelcome(storage,{...state,mode:'demo',[field]:[{}]}),false);
});

test('unavailable storage keeps the help usable and does not pretend to remember dismissal',()=>{
  const storage={getItem(){throw Error('blocked');},setItem(){throw Error('full');}};
  assert.equal(needsWelcome(storage,{mode:'live'}),true);assert.equal(rememberWelcome(storage,'live'),false);
});

test('compact welcome explains choosing materials, personal judgment and handoff without opening or collecting anything',()=>{
  const html=renderWelcome();
  assert.match(html,/<details class="welcome-card welcome-compact">/);
  const steps=['看原文，自己挑','放进主题，补判断','带给常用 AI'];
  const indexes=steps.map(text=>html.indexOf(`<h3>${text}</h3>`));
  assert.ok(indexes.every(index=>index>=0));assert.ok(indexes[0]<indexes[1] && indexes[1]<indexes[2]);
  assert.match(html,/“待筛选”检查，再点“选入精选”/);
  assert.match(html,/下一步做什么/);assert.match(html,/到自己的 AI 里粘贴并发送/);
  assert.match(html,/精选由你选；选入不等于已实测/);assert.match(html,/当前浏览器/);
  assert.match(html,/id="welcome-start">先挑一条材料/);assert.match(html,/id="welcome-example">看完整示例/);
});

test('guide describes the actual review and AI handoff route with honest collection and storage limits',()=>{
  withGuide(({root,nodes,calls})=>{
    const html=root.innerHTML;
    const steps=['1. 发现值得看的材料','2. 采集来的材料，先由你挑','3. 放进主题，留下自己的判断','4. 带去你熟悉的 AI'];
    const indexes=steps.map(text=>html.indexOf(`<h3>${text}</h3>`));
    assert.ok(indexes.every(index=>index>=0));assert.deepEqual([...indexes].sort((a,b)=>a-b),indexes);
    assert.match(html,/接收箱连通且对方实际投递后/);assert.match(html,/Dot、feedgrab 需要另行配置采集与投递/);
    assert.match(html,/点“应用筛选”才生效/);assert.match(html,/结果等实际做过再填/);
    assert.match(html,/选入精选不会自动公开，复制不会自动发送/);
    assert.match(html,/不会自动替你抓取 X/);assert.match(html,/添加链接不会自动读完原文/);
    assert.match(html,/当前浏览器/);assert.match(html,/备份与恢复/);assert.match(html,/不要放入密码、密钥或私人材料/);
    assert.match(html,/下面只是填写示例，没有保存、抓取或实测/);
    assert.deepEqual(calls,[],'reading help never starts collection, a task or a publication');
    assert.equal(nodes.get('modal-close-btn').focused,true);
  });
});

test('guide start action only dismisses help and returns to browsing sources',()=>{
  withGuide(({app,nodes,heading,calls})=>{
    nodes.get('guide-start').onclick();
    assert.deepEqual(calls,['close','dismiss',['tab','today']]);
    assert.equal(app.feedView,'sources');assert.equal(heading.focused,true);
  });
});

test('guide add action waits for an explicit click and opens the existing manual-add path',()=>{
  withGuide(({nodes,calls})=>{
    assert.deepEqual(calls,[]);nodes.get('guide-add').onclick();
    assert.deepEqual(calls,['close','dismiss','add']);
  });
});

test('guide action names stay aligned with real candidate and topic controls, including personal judgment fields',()=>{
  withGuide(({root})=>{
    const candidate={id:'dot-x-2102240170473042026',status:'pending',imported_at:'2026-10-10T01:00:00Z',batch:{collector:'Dot',collected_at:'2026-10-09T09:05:22Z'},
      material:{category:'tutorial',original_url:'https://x.com/example/status/2102240170473042026',author_handle:'example',title_zh:'【检查示例】视频转笔记',summary_zh:'【检查示例】作者提供的公开步骤，未实测。',unknowns:['未运行工具']},item:{id:'dot-x-2102240170473042026'}};
    const pending=renderDotCandidatesView({candidates:[candidate],selectedIds:[candidate.id]});
    const featured=renderDotCandidatesView({candidates:[{...candidate,status:'featured'}],view:'featured'});
    assert.match(pending,/data-dot-bulk-status="featured">选入精选/);assert.ok(root.innerHTML.includes('“选入精选”'));
    assert.match(pending,/<button type="submit"[^>]*>应用筛选/);assert.ok(root.innerHTML.includes('“应用筛选”'));
    assert.match(featured,/data-action="topic-save"[^>]*>放进主题/);assert.ok(root.innerHTML.includes('“放进主题”'));
    const topic={...blankTopic(),id:'guide-check',title:'【检查示例】视频转笔记',materials:[]};
    const html=renderTopicWorkspace({selectedTopicId:topic.id,escapeHtml:value=>String(value),formatTime:()=>''},{topics:[topic]});
    assert.match(html,/id="topic-edit">编辑想法与进度/);assert.ok(root.innerHTML.includes('“编辑想法与进度”'));
    assert.match(html,/id="topic-export">带走这份材料/);assert.ok(root.innerHTML.includes('“带走这份材料”'));
    for(const label of ['我自己的想法','还缺什么','接下来做什么','结果与收获'])assert.ok(html.includes(`<h3>${label}</h3>`));
    assert.match(html,/还没有结果，不会把收藏或想法当成已经完成/);
  });
});
