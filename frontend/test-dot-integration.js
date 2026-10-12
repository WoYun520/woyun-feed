import test from 'node:test';
import assert from 'node:assert/strict';
import { dotMaterialItem } from './src/dotCandidates.js';
import { blankTopic, buildTopicMaterial, postReadingContext } from './src/topicWorkspace.js';
import { selectDailyHighlights } from './src/dailyHighlights.js';
import { makePublicFeed } from './public-feed-data.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { renderWorkspaceNavigation, renderWorkspaceResume, renderWorkspaceStorageNotice } from './src/workspaceShell.js';
import { DOT_FILTER_DEFAULTS } from './src/dotCandidateFilters.js';
import { bindDotCandidatesEvents } from './src/dotCandidatesView.js';
import { bindPostMediaEvents } from './src/postMediaView.js';
import { bindSourceBoardActions } from './src/sourceBoard.js';
import { bindTopicActions } from './src/topicViews.js';
import { bindCollectionActions } from './src/collectionViews.js';

const workspaceContext={renderWorkspaceNavigation,renderWorkspaceResume,renderWorkspaceStorageNotice,DOT_FILTER_DEFAULTS};

// A small replaceable DOM fixture exercises the production class and event
// binders. Every simulated render creates fresh controls, restores the reader
// markup to its default-open details and resets both scrolling panes. Deliberate
// collapse and scroll restoration must be performed by production code.
async function withCandidateEditing(run) {
  const originals=['document','window'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]);
  const ids=['dot-x-2102240170473042026','dot-x-2102240170473042027'];
  const fieldIds={query:'dot-filter-query',category:'dot-filter-category',collector:'dot-filter-collector',sort:'dot-filter-sort',minBookmarks:'dot-filter-bookmarks'};
  let fields,checks,all,form,intake,fulltext,evidence,subscription,reader,list,advanced,readerPane,openButtons,closeButton;
  const renders=[],statusPatches=[],statusCalls=[],downloads=[],downloadLinks=[],timers=[],revokedUrls=[];
  const behavior={statusError:null,downloadError:null,mobile:false,emptyCandidates:false};
  const paneScrolls=[];
  const nodes=new Map(),body={id:'body',closest:()=>null,matches:()=>false},badge={textContent:''},homeExcerpt={open:false};
  const document={activeElement:body,visibilityState:'visible',addEventListener(){},contains:node=>node?.isConnected!==false};
  const window={scrollX:12,scrollY:1450,scrollTo(options){this.scrollX=options.left ?? this.scrollX;this.scrollY=options.top ?? this.scrollY;},addEventListener(){},matchMedia:()=>({matches:behavior.mobile})};
  const control=(id,extra={})=>({id,isConnected:true,value:'',checked:false,disabled:false,dataset:{},listeners:{},
    addEventListener(type,handler){(this.listeners[type] ||= []).push(handler);},
    focus(options){this.lastFocus=options;document.activeElement=this;},
    setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},
    closest(selector){return selector==='#dot-filter-form' && this.name ? form : selector==='.dot-candidates-page' ? {id:'dot-candidates-page'} : null;},
    matches:()=>false,toggleAttribute(name,value){assert.equal(name,'open');this.open=Boolean(value);},...extra});
  function replaceDom(app) {
    for(const node of nodes.values())node.isConnected=false;
    nodes.clear();
    fields=Object.fromEntries(Object.entries(fieldIds).map(([name,id])=>[name,control(id,{name,type:name==='query'?'search':'select-one',value:app.dotFilters[name]})]));
    for(const field of Object.values(fields))nodes.set(field.id,field);
    form=control('dot-filter-form',{querySelector(selector){if(selector==='[type="submit"]')return {disabled:false};return fields[selector.match(/name="([^"]+)"/)?.[1]] || null;},querySelectorAll:()=>Object.values(fields)});
    nodes.set(form.id,form);
    const visibleIds=behavior.emptyCandidates ? [] : ids;
    checks=visibleIds.map(id=>control('',{type:'checkbox',dataset:{dotSelect:id},checked:app.dotSelectedIds.has(id)}));
    all=control('',{type:'checkbox',checked:visibleIds.length>0 && visibleIds.every(id=>app.dotSelectedIds.has(id))});
    intake=control('dot-candidates-intake',{open:!!app.dotIntakeOpen});nodes.set(intake.id,intake);
    advanced=control('',{open:false});list=visibleIds.length ? control('',{scrollTop:0}) : null;
    const readerId=visibleIds.includes(app.activeCandidateId) ? app.activeCandidateId : visibleIds[0];
    reader=readerId ? control('',{dataset:{dotReaderId:readerId},scrollTop:0}) : null;
    readerPane=reader ? control('',{scrollIntoView(options){paneScrolls.push({...options});window.scrollY=312;}}) : null;
    const detail=className=>({open:true,isConnected:true,classList:{contains:name=>name===className},closest:selector=>selector==='[data-dot-reader-id]' ? reader : null,
      setAttribute(name){assert.equal(name,'open');this.open=true;},toggleAttribute(name,value){assert.equal(name,'open');this.open=Boolean(value);}});
    fulltext=reader ? detail('dot-candidate-fulltext') : null;evidence=reader ? detail('dot-candidate-details') : null;
    openButtons=visibleIds.map(id=>control('',{dataset:{dotOpen:id}}));closeButton=reader ? control('',{}) : null;
    if(reader) nodes.set('dot-reader-title',control('dot-reader-title'));
    if(app.dotMessage) nodes.set('dot-candidates-message',control('dot-candidates-message'));
    if(app.dotError) nodes.set('dot-candidates-error',control('dot-candidates-error'));
  }
  document.getElementById=id=>nodes.get(id) || null;
  document.createElement=tag=>{
    assert.equal(tag,'a');const link={click(){this.clicked=true;}};downloadLinks.push(link);return link;
  };
  document.querySelectorAll=selector=>{
    if(selector==='[data-dot-candidate] details[open]')return [fulltext,evidence].filter(detail=>detail?.open);
    if(selector==='[data-dot-candidate] details, [data-dot-reader-id] details')return [fulltext,evidence].filter(Boolean);
    if(selector.includes('#dot-filter-form') && (selector.includes('input') || selector.includes('select') || selector.includes('[name]')))return Object.values(fields);
    return {'#dot-filter-form':[form],'[data-dot-select]':checks,'[data-dot-select-all]':[all],'#dot-candidates-intake':[intake],'[data-dot-open]':openButtons,'[data-dot-close]':closeButton ? [closeButton] : []}[selector] || [];
  };
  document.querySelector=selector=>{
    if(selector==='.item-full-summary[open]')return homeExcerpt.open ? homeExcerpt : null;
    if(selector==='.dot-candidate-details[open], .dot-candidate-fulltext[open]')return [evidence,fulltext].find(detail=>detail?.open) || null;
    if(selector.includes('details[open]') && selector.includes('dot-candidate'))return [evidence,fulltext].find(detail=>detail?.open) || null;
    const readingId=selector.match(/data-dot-(?:candidate|reader-id)="([^"]+)"/)?.[1];
    if(readingId && readingId!==reader?.dataset.dotReaderId)return null;
    if(selector.includes('.dot-candidate-fulltext'))return fulltext;
    if(selector.includes('.dot-candidate-details'))return evidence;
    if(selector==='[data-dot-select-all]')return all;
    if(selector==='#nav-candidates .nav-badge')return badge;
    if(selector==='.dot-filter-advanced')return advanced;
    if(selector==='.dot-candidates-grid')return list;
    if(selector==='[data-dot-reader-id]')return reader;
    if(selector==='.dot-reader-pane')return readerPane;
    if(selector==='.dot-reader-layout.is-reader-open')return app.activeCandidateId && reader ? {} : null;
    if(selector.startsWith('[data-dot-select="'))return checks.find(check=>check.dataset.dotSelect===selector.match(/data-dot-select="([^"]+)"/)?.[1]) || null;
    if(selector.startsWith('[data-dot-open="'))return openButtons.find(button=>button.dataset.dotOpen===selector.match(/data-dot-open="([^"]+)"/)?.[1]) || null;
    if(selector==='#dot-filter-form')return form;
    return null;
  };
  const state={mode:'live',sources:[],topics:[],dotPendingCandidates:ids.map(id=>({id})),loadStatus:{phase:'ready'}};
  const adapter={getState:()=>state,subscribe(handler){subscription=handler;return ()=>{};},importDotCandidates:()=>({added:1,duplicates:0,existing:0}),
    setDotCandidateStatus(ids,status){statusCalls.push({ids:[...ids],status});if(behavior.statusError)throw new Error(behavior.statusError);return {changed:ids.length,status};},
    createDotFeaturedExport(){if(behavior.downloadError)throw new Error(behavior.downloadError);return {raw:'{"format":"isolated-test-export"}',filename:'isolated-test-export.json',count:1};},
  };
  const source=readFileSync(new URL('./src/app.js',import.meta.url),'utf8').split('// 页面加载完成后启动应用')[0].replace(/^import [^\n]*\n/gm,'')+'\nthis.App=PersonalFeedApp;';
  const sandbox={...workspaceContext,document,window,feedAdapter:adapter,bindDotCandidatesEvents,bindPostMediaEvents,bindSourceBoardActions,bindTopicActions,bindCollectionActions,
    Blob,URL:{createObjectURL(blob){downloads.push(blob);return 'blob:isolated-test-export';},revokeObjectURL(url){revokedUrls.push(url);}},
    setTimeout(callback,delay){timers.push({callback,delay});return timers.length;},
  };
  vm.runInNewContext(source,sandbox);
  const app=Object.assign(Object.create(sandbox.App.prototype),{currentTab:'candidates',dotView:'pending',activeCandidateId:'',dotFilters:{...DOT_FILTER_DEFAULTS},dotSelectedIds:new Set(),dotIntakeOpen:false,dotBusy:false,dotInboxBusy:false,dotInboxPendingNew:0,activeModal:null,sourceManagerOpen:false,feedSearchComposing:false,welcomeVisible:false,pendingRender:false,
    render(){renders.push(true);this.pendingRender=false;replaceDom(this);window.scrollY=0;this.bindContentActions(state);},
    updateFeedStatus(){statusPatches.push(true);},updateDotInboxPanel(){},
    dotInbox:{reload(){},getState:()=>({connected:true}),async sync(save){save('{}');return {added:1,batches:1};}},
  });
  for(const [key,value]of Object.entries({document,window}))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  replaceDom(app);app.bindContentActions(state);
  const fixture={app,state,document,window,renders,statusPatches,ids,body,badge,homeExcerpt,behavior,statusCalls,downloads,downloadLinks,timers,revokedUrls,
    get fields(){return fields;},get checks(){return checks;},get all(){return all;},get form(){return form;},get fulltext(){return fulltext;},get evidence(){return evidence;},get intake(){return intake;},get reader(){return reader;},get list(){return list;},get advanced(){return advanced;},get openButtons(){return openButtons;},get closeButton(){return closeButton;},paneScrolls,
    emit(){if(!subscription)app.setupFeedSubscription();subscription(state,{reason:'feed'});},
    fire(node,type,event={}){for(const handler of node.listeners[type] || [])handler(event);},
  };
  try {return await run(fixture);}finally {for(const[key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
}

const unappliedFilters={query:'播客 文字',category:'tutorial',collector:'feedgrab',sort:'bookmarks',minBookmarks:'500'};
const fieldValues=fixture=>Object.fromEntries(Object.entries(fixture.fields).map(([key,field])=>[key,field.value]));
function draftCandidateFilters(fixture,filters=unappliedFilters) {
  for(const [key,value]of Object.entries(filters))fixture.fields[key].value=value;
}
function beginCandidateReview(fixture) {
  draftCandidateFilters(fixture);fixture.fulltext.open=true;fixture.evidence.open=true;fixture.intake.open=true;
  fixture.document.activeElement=fixture.body;
  return fixture.fields.query;
}
function assertReviewPreserved(fixture,previousQuery) {
  assert.notEqual(fixture.fields.query,previousQuery,'the actual helper rerenders fresh filter controls');
  assert.deepEqual(fieldValues(fixture),unappliedFilters);assert.deepEqual(fixture.app.dotFilters,{...DOT_FILTER_DEFAULTS});
  assert.equal(fixture.fulltext.open,true);assert.equal(fixture.evidence.open,true);assert.equal(fixture.intake.open,true);
  assert.equal(fixture.window.scrollX,12);assert.equal(fixture.window.scrollY,1450);
}

test('successful candidate review keeps unapplied filters and expanded reading through the actual refresh helper',async()=>{
  for(const status of ['featured','dismissed']) await withCandidateEditing(fixture=>{
    const before=beginCandidateReview(fixture);fixture.app.dotSelectedIds.add(fixture.ids[0]);
    fixture.app.updateDotStatus([fixture.ids[0]],status);
    assert.equal(fixture.renders.length,1);assertReviewPreserved(fixture,before);
    assert.deepEqual(fixture.statusCalls,[{ids:[fixture.ids[0]],status}]);assert.equal(fixture.app.dotSelectedIds.size,0);
    assert.equal(fixture.app.dotError,'');assert.ok(fixture.app.dotMessage.includes('1 条'));
  });
});

test('failed candidate review retains selection, draft filters, reading and scroll so the user can retry',async()=>{
  await withCandidateEditing(fixture=>{
    const before=beginCandidateReview(fixture);fixture.app.dotSelectedIds.add(fixture.ids[0]);
    fixture.behavior.statusError='【隔离检查】保存失败，原记录保留';
    fixture.app.updateDotStatus([fixture.ids[0]],'featured');
    assert.equal(fixture.renders.length,1);assertReviewPreserved(fixture,before);
    assert.equal(fixture.app.dotError,fixture.behavior.statusError);assert.deepEqual([...fixture.app.dotSelectedIds],[fixture.ids[0]]);
    assert.deepEqual(fixture.statusCalls,[{ids:[fixture.ids[0]],status:'featured'}]);
  });
});

test('featured JSON download preserves review drafts and reading while issuing one accurate download and cleanup',async()=>{
  await withCandidateEditing(async fixture=>{
    const before=beginCandidateReview(fixture);fixture.app.dotSelectedIds.add(fixture.ids[0]);
    fixture.app.downloadDotFeatured();
    assert.equal(fixture.renders.length,1);assertReviewPreserved(fixture,before);
    assert.equal(fixture.downloads.length,1);assert.equal(await fixture.downloads[0].text(),'{"format":"isolated-test-export"}');
    assert.equal(fixture.downloads[0].type,'application/json;charset=utf-8');
    assert.equal(fixture.downloadLinks.length,1);assert.equal(fixture.downloadLinks[0].clicked,true);
    assert.equal(fixture.downloadLinks[0].download,'isolated-test-export.json');assert.equal(fixture.downloadLinks[0].href,'blob:isolated-test-export');
    assert.equal(fixture.timers.length,1);assert.equal(fixture.timers[0].delay,1000);fixture.timers[0].callback();
    assert.deepEqual(fixture.revokedUrls,['blob:isolated-test-export']);
    assert.deepEqual([...fixture.app.dotSelectedIds],[fixture.ids[0]]);assert.deepEqual(fixture.statusCalls,[],'export does not approve or publish records');
    assert.match(fixture.app.dotMessage,/已发起 1 条精选的下载/);assert.match(fixture.app.dotMessage,/导出不等于公开发布/);
  });
});

test('failed featured JSON export leaves draft filters and reading intact without claiming a download',async()=>{
  await withCandidateEditing(fixture=>{
    const before=beginCandidateReview(fixture);fixture.behavior.downloadError='【隔离检查】导出校验失败';
    fixture.app.downloadDotFeatured();
    assert.equal(fixture.renders.length,1);assertReviewPreserved(fixture,before);
    assert.equal(fixture.app.dotError,fixture.behavior.downloadError);
    assert.deepEqual(fixture.downloads,[]);assert.deepEqual(fixture.downloadLinks,[]);assert.deepEqual(fixture.timers,[]);
    assert.deepEqual(fixture.statusCalls,[]);
  });
});

test('real background feed update waits while the home full excerpt is open and can render after it closes',async()=>{
  await withCandidateEditing(fixture=>{
    fixture.app.currentTab='today';fixture.document.activeElement=fixture.body;fixture.homeExcerpt.open=true;
    assert.equal(fixture.app.shouldDeferBackgroundRender(),true);fixture.emit();
    assert.equal(fixture.renders.length,0);assert.equal(fixture.app.pendingRender,true);assert.equal(fixture.statusPatches.length,1);
    assert.equal(fixture.homeExcerpt.open,true);assert.equal(fixture.window.scrollY,1450);
    fixture.homeExcerpt.open=false;assert.equal(fixture.app.shouldDeferBackgroundRender(),false);fixture.emit();
    assert.equal(fixture.renders.length,1);assert.equal(fixture.app.pendingRender,false);
  });
});

test('actual candidate checkbox binding preserves unapplied filters, expanded reading, intake and scroll',async()=>{
  await withCandidateEditing(fixture=>{
    const {app,document,window,ids}=fixture;
    draftCandidateFilters(fixture);
    fixture.fulltext.open=true;fixture.evidence.open=true;fixture.intake.open=true;
    const originalQuery=fixture.fields.query,checkbox=fixture.checks[0];
    document.activeElement=checkbox;checkbox.checked=true;fixture.fire(checkbox,'change');
    assert.equal(fixture.renders.length,1);
    assert.notEqual(fixture.fields.query,originalQuery,'render really replaced the filter controls');
    assert.deepEqual(fieldValues(fixture),unappliedFilters,'all five unapplied field values survive');
    assert.deepEqual(app.dotFilters,{...DOT_FILTER_DEFAULTS},'selecting a record does not apply the draft');
    assert.deepEqual([...app.dotSelectedIds],[ids[0]]);assert.equal(fixture.checks[0].checked,true);
    assert.equal(fixture.fulltext.open,true);assert.equal(fixture.evidence.open,true);assert.equal(fixture.intake.open,true);
    assert.equal(app.dotIntakeOpen,true);assert.equal(window.scrollX,12);assert.equal(window.scrollY,1450);
    assert.equal(document.activeElement,fixture.checks[0]);assert.equal(document.activeElement.lastFocus.preventScroll,true);
    fixture.checks[0].checked=false;fixture.fire(fixture.checks[0],'change');
    assert.equal(app.dotSelectedIds.size,0);assert.deepEqual(fieldValues(fixture),unappliedFilters);
    assert.equal(fixture.fulltext.open,true);assert.equal(fixture.evidence.open,true);assert.equal(window.scrollY,1450);
  });
});

test('actual select-all binding preserves open reading and drafts while choosing only rendered controls',async()=>{
  await withCandidateEditing(fixture=>{
    draftCandidateFilters(fixture);fixture.fulltext.open=true;fixture.evidence.open=true;fixture.intake.open=true;
    const before=fixture.all;fixture.document.activeElement=before;before.checked=true;fixture.fire(before,'change');
    assert.notEqual(fixture.all,before);assert.deepEqual([...fixture.app.dotSelectedIds],fixture.ids);
    assert.equal(fixture.all.checked,true);assert.deepEqual(fieldValues(fixture),unappliedFilters);
    assert.deepEqual(fixture.app.dotFilters,{...DOT_FILTER_DEFAULTS});
    assert.equal(fixture.fulltext.open,true);assert.equal(fixture.evidence.open,true);assert.equal(fixture.intake.open,true);
    assert.equal(fixture.document.activeElement,fixture.all);assert.equal(fixture.all.lastFocus.preventScroll,true);
    assert.equal(fixture.window.scrollY,1450);
  });
});

test('candidate result refresh restores search selection and every unapplied dropdown without applying them',async()=>{
  await withCandidateEditing(fixture=>{
    draftCandidateFilters(fixture);const before=fixture.fields.query;
    before.selectionStart=1;before.selectionEnd=4;fixture.document.activeElement=before;
    fixture.app.renderDotInboxResults();
    assert.notEqual(fixture.fields.query,before);assert.deepEqual(fieldValues(fixture),unappliedFilters);
    assert.equal(fixture.document.activeElement,fixture.fields.query);assert.equal(fixture.fields.query.lastFocus.preventScroll,true);
    assert.equal(fixture.fields.query.selectionStart,1);assert.equal(fixture.fields.query.selectionEnd,4);
    assert.equal(fixture.window.scrollX,12);assert.equal(fixture.window.scrollY,1450);
    assert.deepEqual(fixture.app.dotFilters,{...DOT_FILTER_DEFAULTS});assert.equal(fixture.app.hasDotFilterDraft(),true);
  });
});

test('candidate background guard protects selection, open sources and blurred drafts without blocking another page',async()=>{
  await withCandidateEditing(fixture=>{
    const {app}=fixture;fixture.document.activeElement=fixture.body;fixture.fulltext.open=false;fixture.evidence.open=false;
    assert.equal(app.shouldDeferBackgroundRender(),false);
    app.dotSelectedIds.add(fixture.ids[0]);assert.equal(app.shouldDeferBackgroundRender(),true);app.dotSelectedIds.clear();
    assert.equal(app.shouldDeferBackgroundRender(),false);
    for(const detail of [fixture.fulltext,fixture.evidence]) {
      detail.open=true;assert.equal(app.shouldDeferBackgroundRender(),true);detail.open=false;
      assert.equal(app.shouldDeferBackgroundRender(),false);
    }
    fixture.fields.query.value='还未应用的关键词';assert.equal(app.shouldDeferBackgroundRender(),true);
    fixture.fields.query.value='';assert.equal(app.shouldDeferBackgroundRender(),false);
    fixture.fields.collector.value='Dot';assert.equal(app.shouldDeferBackgroundRender(),true,'dropdown-only draft is also protected after blur');
    app.currentTab='today';app.dotSelectedIds.add(fixture.ids[0]);fixture.fulltext.open=true;
    assert.equal(app.shouldDeferBackgroundRender(),false,'hidden candidate state does not lock another page');
    app.currentTab='candidates';assert.equal(app.shouldDeferBackgroundRender(),true);
  });
});

test('real feed subscription defers updates after a draft loses focus and resumes after the draft is cleared',async()=>{
  await withCandidateEditing(fixture=>{
    const {app}=fixture;fixture.fulltext.open=false;fixture.evidence.open=false;draftCandidateFilters(fixture);fixture.document.activeElement=fixture.body;
    const before=fixture.fields.query;fixture.emit();
    assert.equal(fixture.renders.length,0);assert.equal(app.pendingRender,true);assert.equal(fixture.statusPatches.length,1);
    assert.equal(fixture.fields.query,before);assert.deepEqual(fieldValues(fixture),unappliedFilters);
    assert.deepEqual(app.dotFilters,{...DOT_FILTER_DEFAULTS});
    draftCandidateFilters(fixture,DOT_FILTER_DEFAULTS);fixture.emit();
    assert.equal(fixture.renders.length,1);assert.equal(app.pendingRender,false);
    assert.notEqual(fixture.fields.query,before);assert.deepEqual(fieldValues(fixture),{...DOT_FILTER_DEFAULTS});
  });
});

test('automatic new candidate receipt keeps a blurred unapplied filter draft and reports pending material',async()=>{
  await withCandidateEditing(async fixture=>{
    draftCandidateFilters(fixture);fixture.document.activeElement=fixture.body;
    const before=fixture.fields.query;await fixture.app.syncDotInbox();
    assert.equal(fixture.renders.length,0);assert.equal(fixture.fields.query,before);
    assert.deepEqual(fieldValues(fixture),unappliedFilters);assert.deepEqual(fixture.app.dotFilters,{...DOT_FILTER_DEFAULTS});
    assert.equal(fixture.app.dotInboxPendingNew,1);assert.equal(fixture.app.dotInboxBusy,false);
    assert.match(fixture.app.dotInboxMessage,/收到 1 条新材料/);assert.equal(fixture.badge.textContent,'2');
  });
});

test('only submitting the actual filter form applies the draft and clears prior batch selection',async()=>{
  await withCandidateEditing(fixture=>{
    fixture.app.dotSelectedIds.add(fixture.ids[0]);draftCandidateFilters(fixture);
    assert.equal(fixture.app.hasDotFilterDraft(),true);assert.equal(fixture.renders.length,0);
    let prevented=false;fixture.fire(fixture.form,'submit',{preventDefault(){prevented=true;}});
    assert.equal(prevented,true);assert.equal(fixture.renders.length,1);
    assert.deepEqual({...fixture.app.dotFilters},unappliedFilters);assert.equal(fixture.app.dotSelectedIds.size,0);
    assert.deepEqual(fieldValues(fixture),unappliedFilters);assert.equal(fixture.app.hasDotFilterDraft(),false);
    assert.equal(fixture.document.activeElement,fixture.fields.query);assert.equal(fixture.fields.query.lastFocus.preventScroll,true);
  });
});

const time='2026-10-09T03:28:17Z';
const material={category:'tutorial',original_url:'https://x.com/example/status/2108148604447883464',author_handle:'example',published_at:null,
  title_zh:'把播客变成阅读材料',summary_zh:'作者展示先导出播客文字，再整理重点。效果尚未实际检查。',bookmark_count:null,like_count:251,view_count:null,
  metric_display:'点赞251；收藏不可见',metrics_checked_at:time,metrics_source_url:'https://x.com/example/status/2108148604447883464',
  read_scope:'main_post',selection_reason:'可先试跑一段播客来判断是否适合长内容。',my_angle:'建议先对比文字与音频，不代表我已使用。',
  unknowns:['没有观看视频','原帖发布时间未知','未试跑作者流程']};
const batch={collector:'Dot',collected_at:time,group:'items'};

test('topic handoff keeps collector scope, original heat observation and every unknown without turning them into user experience',()=>{
  const item=dotMaterialItem(material,batch),before=structuredClone(item);
  const topic={...blankTopic(),id:'topic-dot-check',title:'尝试把播客变成阅读材料',created_at:time,updated_at:time,
    materials:[{item,note:'先对比一小段。',added_at:time}]};
  const output=buildTopicMaterial(topic);
  for (const value of [...material.unknowns,material.my_angle,material.selection_reason,time,'采集者 Dot','收藏：未知','点赞：251','浏览：未知']) assert.ok(output.includes(value),value);
  assert.match(output,/采集者整理的中文标题/);assert.match(output,/采集者整理的摘要，非原帖全文/);
  assert.match(output,/不是我的经历/);assert.match(output,/不是用户确认/);
  assert.match(output,/采集者记录为只读主帖/);assert.doesNotMatch(output,/收藏时的来源帖子摘录/);
  assert.deepEqual(item,before);
});

test('collector full-thread claim remains attributed and never implies site independently verified it',()=>{
  const item=dotMaterialItem({...material,read_scope:'full_thread'},batch),context=postReadingContext(item);
  assert.match(context.scope,/采集者记录为已读完整线程/);
  assert.match(context.scope,/本站未独立核验/);assert.match(context.scope,/手动选入不等于实测/);
});

test('Dot selected material is separate from automatic daily recommendations',()=>{
  const item=dotMaterialItem(material,batch),result=selectDailyHighlights([item],[{id:'dot-import',name:'Dot',status:'ok',group:'creators',last_success_at:time}],{now:Date.parse(time)});
  assert.equal(result.items.length,0);
});

test('publishing upstream sources cannot accidentally publish local Dot candidate or selected records',()=>{
  const ordinary={id:'news-aaaaaaaaaaaaaaaaaaaaaaaa',title:'来源文章',summary:'来源提供的公开摘要',original_url:'https://example.com/article',source_refs:['github'],captured_at:time};
  const dot={...dotMaterialItem(material,batch),id:'news-bbbbbbbbbbbbbbbbbbbbbbbb',source_refs:['github']};
  const input={schema_version:'0.3',mode:'live',sources:[{id:'github',name:'公开来源',home_url:'https://github.com',status:'ok',last_success_at:time}],items:[ordinary,dot],dot_candidates:[{material}],profile:{interests:'',exclude:''}};
  const output=makePublicFeed(input,{publishedAt:time});
  assert.deepEqual(output.items.map(item=>item.id),[ordinary.id]);
  assert.ok(!('dot_candidates' in output));assert.doesNotMatch(JSON.stringify(output),/把播客变成阅读材料/);
});

test('feedgrab handoff preserves collected text, heat unknowns and source without inventing AI analysis or personal experience',()=>{
  const collected={...material,my_angle:'',summary_zh:'【采集示例】这是原帖提供的公开操作内容。',unknowns:['没有读取完整线程','没有观看附带视频','尚未进行 AI 分析']};
  const item=dotMaterialItem(collected,{...batch,collector:'feedgrab'}),before=structuredClone(item);
  const topic={...blankTopic(),id:'topic-feedgrab-check',title:'看看采集的操作说明',created_at:time,updated_at:time,materials:[{item,note:'我选入后再核对。',added_at:time}]};
  const output=buildTopicMaterial(topic),context=postReadingContext(item);
  for(const value of [...collected.unknowns,collected.summary_zh,collected.selection_reason,'采集者 feedgrab','收藏：未知','浏览：未知',time]) assert.ok(output.includes(value),value);
  assert.match(context.source,/feedgrab 采集/);assert.match(context.scope,/主帖内容，未读完整线程/);
  assert.match(output,/feedgrab 提供的标题（采集字段，未独立核验）/);
  assert.match(output,/feedgrab 采集的正文摘录/);assert.match(output,/未进行 AI 分析/);
  assert.match(output,/采集规则与入池原因（不是 AI 建议）/);
  assert.match(output,/不是我的经历/);assert.match(output,/不是用户确认/);
  assert.doesNotMatch(output,/采集者 feedgrab 整理|采集者记录为已读完整线程|AI 阅读作者说明并整理/);
  assert.deepEqual(item,before);
});

test('feedgrab manual material is excluded from automatic picks and public publishing with legacy Dot remaining compatible',()=>{
  const feedgrab=dotMaterialItem(material,{...batch,collector:'feedgrab'});
  assert.equal(feedgrab.origin,'feedgrab_import');assert.deepEqual(feedgrab.source_refs,['feedgrab-import']);assert.equal(feedgrab.summary_label,'feedgrab 采集');
  const legacy=dotMaterialItem(material,batch);assert.equal(legacy.origin,'dot_import');assert.deepEqual(legacy.source_refs,['dot-import']);assert.equal(legacy.summary_label,'Dot 整理');
  const sources=[{id:'feedgrab-import',name:'feedgrab采集',status:'ok',group:'creators',last_success_at:time}];
  assert.equal(selectDailyHighlights([feedgrab],sources,{now:Date.parse(time)}).items.length,0);
  const forgedSource={...feedgrab,id:'news-'+'c'.repeat(24),source_refs:['github']};
  const ordinary={id:'news-'+'d'.repeat(24),title:'原来的公开内容',summary:'公开来源的已有摘要。',original_url:'https://example.com/public',source_refs:['github'],captured_at:time};
  const published=makePublicFeed({schema_version:'0.3',mode:'live',sources:[{id:'github',name:'公开来源',home_url:'https://github.com',status:'ok',last_success_at:time}],items:[forgedSource,ordinary]},{publishedAt:time});
  assert.deepEqual(published.items.map(item=>item.id),[ordinary.id]);assert.ok(!JSON.stringify(published).includes('feedgrab'));
});

test('featured feedgrab card clearly names the collector and does not imply an AI recommendation',()=>{
  const source=readFileSync(new URL('./src/app.js',import.meta.url),'utf8').split('// 页面加载完成后启动应用')[0].replace(/^import [^\n]*\n/gm,'')+'\nthis.App=PersonalFeedApp;';
  const sandbox={...workspaceContext,feedAdapter:{getFollowupForItem:()=>null}};vm.runInNewContext(source,sandbox);
  const app=Object.create(sandbox.App.prototype);
  const item=dotMaterialItem(material,{...batch,collector:'feedgrab'}),state={savedItemIds:new Set(),archivedItemIds:new Set(),sourceMap:new Map([['feedgrab-import',{name:'feedgrab采集',home_url:'https://x.com'}]]),followups:[],topics:[],refresh:{new_item_ids:[]}};
  const html=app.renderFeedItem(item,state);
  assert.match(html,/feedgrab 采集依据 · 手动选入/);assert.match(html,/feedgrab 采集 · 尚未 AI 分析/);
  assert.match(html,/未实测/);assert.doesNotMatch(html,/Dot 选题建议|AI 已分析|内容已核验/);
});

test('compact featured cards fold only long text, retain the exact escaped full excerpt and never change saved material',()=>{
  const source=readFileSync(new URL('./src/app.js',import.meta.url),'utf8').split('// 页面加载完成后启动应用')[0].replace(/^import [^\n]*\n/gm,'')+'\nthis.App=PersonalFeedApp;';
  const sandbox={...workspaceContext,feedAdapter:{getFollowupForItem:()=>null}};vm.runInNewContext(source,sandbox);
  const app=Object.create(sandbox.App.prototype);
  const item={...dotMaterialItem(material,{...batch,collector:'feedgrab'}),summary:'这是一段采集材料🙂 <script>不是指令</script> & 保留原文。'.repeat(15)};
  const state={savedItemIds:new Set([item.id]),archivedItemIds:new Set(),sourceMap:new Map([['feedgrab-import',{name:'feedgrab采集',home_url:'https://x.com'}]]),followups:[],topics:[],refresh:{new_item_ids:[]}};
  const beforeItem=structuredClone(item),beforeState=structuredClone(state);
  const compact=app.renderFeedItem(item,state,{compact:true});
  const summary=compact.match(/<p class="item-summary">([\s\S]*?)<\/p>/)?.[1];
  const full=compact.match(/<details class="item-full-summary"([^>]*)>([\s\S]*?)<\/details>/);
  assert.ok(Array.from(item.summary).length>240);assert.ok(full,'a native details disclosure keeps the full text available');
  assert.doesNotMatch(full[1],/\bopen\b/,'long text starts folded');
  assert.ok(summary.endsWith(app.escapeHtml(Array.from(item.summary).slice(0,240).join('')+'…')));
  assert.match(full[2],/<summary>[^<]+<\/summary>/);
  assert.equal(full[2].match(/<div>([\s\S]*?)<\/div>/)?.[1],app.escapeHtml(item.summary),'every saved character is retained in the full excerpt');
  assert.doesNotMatch(compact,/<script>/,'folding never introduces executable source markup');
  const normal=app.renderFeedItem(item,state),explicitNormal=app.renderFeedItem(item,state,{compact:false});
  assert.equal(normal,explicitNormal,'the original rendering path remains the default');
  assert.doesNotMatch(normal,/class="item-full-summary"/);
  assert.ok(normal.match(/<p class="item-summary">([\s\S]*?)<\/p>/)?.[1].endsWith(app.escapeHtml(item.summary)));
  for(const shortText of ['简短的说明','字'.repeat(239)+'🙂']) {
    const short=app.renderFeedItem({...item,summary:shortText},state,{compact:true});
    assert.doesNotMatch(short,/class="item-full-summary"/,'up to 240 Unicode characters do not need folding');
    assert.ok(short.match(/<p class="item-summary">([\s\S]*?)<\/p>/)?.[1].endsWith(app.escapeHtml(shortText)));
  }
  const at241=app.renderFeedItem({...item,summary:'字'.repeat(240)+'🙂'},state,{compact:true});
  assert.match(at241,/class="item-full-summary"/,'241 Unicode characters cross the folding boundary');
  assert.deepEqual(item,beforeItem);assert.deepEqual(state,beforeState,'display folding does not edit saved records or selection state');
});

test('refreshing the candidate reader retains both expanded original text and evidence, checked IDs, focus and scroll position',async()=>{
  await withCandidateEditing(fixture=>{
    fixture.app.dotSelectedIds.add(fixture.ids[0]);fixture.fulltext.open=true;fixture.evidence.open=true;
    fixture.window.scrollY=1536;fixture.list.scrollTop=225;fixture.reader.scrollTop=620;
    fixture.document.activeElement=fixture.checks[0];fixture.app.renderDotInboxResults();
    assert.equal(fixture.fulltext.open,true);assert.equal(fixture.evidence.open,true);
    assert.deepEqual([...fixture.app.dotSelectedIds],[fixture.ids[0]]);
    assert.equal(fixture.document.activeElement,fixture.checks[0]);assert.equal(fixture.checks[0].lastFocus.preventScroll,true);
    assert.equal(fixture.window.scrollY,1536);assert.equal(fixture.list.scrollTop,225);assert.equal(fixture.reader.scrollTop,620);
  });
});

test('new automatic material is deferred while collected original text is expanded even without a selected checkbox or focused card',async()=>{
  const source=readFileSync(new URL('./src/app.js',import.meta.url),'utf8').split('// 页面加载完成后启动应用')[0].replace(/^import [^\n]*\n/gm,'')+'\nthis.App=PersonalFeedApp;';
  const fulltext={open:true},badge={textContent:''};let renders=0;
  const document={visibilityState:'visible',activeElement:{},getElementById:()=>null,
    querySelector:selector=>selector==='.dot-candidate-details[open], .dot-candidate-fulltext[open]' ? fulltext : selector==='#nav-candidates .nav-badge' ? badge : null,
  };
  const state={mode:'live',dotPendingCandidates:[{id:'new'}]},feedAdapter={getState:()=>state,importDotCandidates:()=>({added:1,duplicates:0,existing:0})};
  const sandbox={...workspaceContext,document,window:{},feedAdapter};vm.runInNewContext(source,sandbox);
  const app=Object.assign(Object.create(sandbox.App.prototype),{currentTab:'candidates',dotSelectedIds:new Set(),dotInboxBusy:false,dotBusy:false,dotInboxPendingNew:0,
    dotInbox:{reload(){},getState:()=>({connected:true}),sync:async save=>{save('{}');return {added:1,batches:1};}},
    updateDotInboxPanel(){},renderDotInboxResults:()=>renders++,shouldDeferBackgroundRender:()=>false,
  });
  await app.syncDotInbox();assert.equal(renders,0);assert.equal(fulltext.open,true);assert.equal(app.dotInboxPendingNew,1);assert.equal(badge.textContent,'1');
});

test('actual reader open and return bindings retain an unapplied query and advanced choices without applying or reviewing them',async()=>{
  await withCandidateEditing(fixture=>{
    fixture.behavior.mobile=true;draftCandidateFilters(fixture);fixture.advanced.open=true;
    const beforeQuery=fixture.fields.query;fixture.fire(fixture.openButtons[1],'click');
    assert.notEqual(fixture.fields.query,beforeQuery);assert.deepEqual(fieldValues(fixture),unappliedFilters);
    assert.deepEqual(fixture.app.dotFilters,{...DOT_FILTER_DEFAULTS});assert.equal(fixture.advanced.open,true);
    assert.equal(fixture.reader.dataset.dotReaderId,fixture.ids[1]);assert.equal(fixture.app.activeCandidateId,fixture.ids[1]);
    assert.equal(fixture.document.activeElement,fixture.document.getElementById('dot-reader-title'));
    fixture.fire(fixture.closeButton,'click');
    assert.deepEqual(fieldValues(fixture),unappliedFilters);assert.deepEqual(fixture.app.dotFilters,{...DOT_FILTER_DEFAULTS});
    assert.equal(fixture.advanced.open,true);assert.equal(fixture.app.activeCandidateId,'');
    assert.equal(fixture.document.activeElement.dataset.dotOpen,fixture.ids[1]);
    assert.deepEqual(fixture.statusCalls,[]);assert.equal(fixture.app.dotSelectedIds.size,0);
  });
});

test('empty candidate refresh preserves a query draft and window position without requiring a reader or scroll pane',async()=>{
  await withCandidateEditing(fixture=>{
    fixture.behavior.emptyCandidates=true;fixture.app.render();
    draftCandidateFilters(fixture);fixture.window.scrollY=123;fixture.advanced.open=true;
    assert.equal(fixture.reader,null);assert.equal(fixture.list,null);
    assert.doesNotThrow(()=>fixture.app.renderDotInboxResults());
    assert.equal(fixture.reader,null);assert.equal(fixture.list,null);assert.equal(fixture.window.scrollY,123);
    assert.deepEqual(fieldValues(fixture),unappliedFilters);assert.equal(fixture.advanced.open,true);
    assert.deepEqual(fixture.statusCalls,[]);
  });
});

test('checking the same reader preserves a closed full-text disclosure, open evidence and both internal scroll positions',async()=>{
  await withCandidateEditing(fixture=>{
    fixture.fulltext.open=false;fixture.evidence.open=true;fixture.advanced.open=true;
    fixture.list.scrollTop=315;fixture.reader.scrollTop=740;const readerId=fixture.reader.dataset.dotReaderId;
    const previousReader=fixture.reader,checkbox=fixture.checks[1];checkbox.checked=true;fixture.document.activeElement=checkbox;
    fixture.fire(checkbox,'change');
    assert.notEqual(fixture.reader,previousReader);assert.equal(fixture.reader.dataset.dotReaderId,readerId);
    assert.equal(fixture.fulltext.open,false,'default-open markup must not undo a deliberate collapse');
    assert.equal(fixture.evidence.open,true);assert.equal(fixture.advanced.open,true);
    assert.equal(fixture.list.scrollTop,315);assert.equal(fixture.reader.scrollTop,740);
    assert.equal(fixture.document.activeElement,fixture.checks[1]);assert.deepEqual([...fixture.app.dotSelectedIds],[fixture.ids[1]]);
  });
});

test('mobile reader starts at its own top and returning restores the list position even after moving to another material',async()=>{
  await withCandidateEditing(fixture=>{
    fixture.behavior.mobile=true;fixture.window.scrollY=1840;
    fixture.fire(fixture.openButtons[1],'click');
    assert.equal(fixture.app.dotListWindowScroll,1840);assert.equal(fixture.window.scrollY,312);
    assert.deepEqual(fixture.paneScrolls,[{block:'start',behavior:'instant'}]);
    assert.equal(fixture.document.activeElement,fixture.document.getElementById('dot-reader-title'));
    fixture.window.scrollY=975;fixture.fire(fixture.openButtons[0],'click');
    assert.equal(fixture.app.dotListWindowScroll,1840,'moving between readings must retain the original list position');
    assert.equal(fixture.window.scrollY,312);assert.equal(fixture.paneScrolls.length,2);
    fixture.fire(fixture.closeButton,'click');
    assert.equal(fixture.window.scrollY,1840);assert.equal(fixture.app.activeCandidateId,'');
    assert.equal(fixture.document.activeElement.dataset.dotOpen,fixture.ids[0]);
    assert.deepEqual(fixture.statusCalls,[]);
  });
});

test('returning after a removed reading selection focuses the actual fallback material rather than a stale ID',async()=>{
  await withCandidateEditing(fixture=>{
    fixture.behavior.mobile=true;fixture.app.activeCandidateId='dot-x-removed';fixture.app.dotListWindowScroll=680;fixture.app.render();
    assert.equal(fixture.reader.dataset.dotReaderId,fixture.ids[0]);
    fixture.fire(fixture.closeButton,'click');
    assert.equal(fixture.app.activeCandidateId,'');assert.equal(fixture.document.activeElement.dataset.dotOpen,fixture.ids[0]);
    assert.equal(fixture.window.scrollY,680);assert.deepEqual(fixture.statusCalls,[]);
  });
});
