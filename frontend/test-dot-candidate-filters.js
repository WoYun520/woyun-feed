import test from 'node:test';
import assert from 'node:assert/strict';
import { DOT_FILTER_DEFAULTS, normalizeDotFilters, hasDotFilters, filterDotCandidates } from './src/dotCandidateFilters.js';
import { renderDotCandidatesView, bindDotCandidatesEvents, renderDotInboxFeedback, bindDotInboxFeedbackEvents } from './src/dotCandidatesView.js';

function row(id, overrides={}) {
  return {id:`dot-x-${id}`,status:'pending',imported_at:'2026-10-10T01:00:00Z',batch:{collector:'Dot',group:'items',collected_at:'2026-10-09T01:00:00Z'},material:{category:'tutorial',title_zh:'视频转笔记教程',summary_zh:'把公开字幕整理成可读文字。',author_handle:'Maker',selection_reason:'方便做一期字幕教程。',my_angle:'先试一个公开短视频。',bookmark_count:200,like_count:20,original_url:`https://x.com/Maker/status/${id}`,unknowns:[]},...overrides};
}
const ids=rows=>rows.map(record=>record.id);

test('filter normalization discards unsupported state and bounds Unicode query without turning missing counts into zero',()=>{
  assert.deepEqual(normalizeDotFilters({query:'  😀'.repeat(250),category:'__proto__',collector:'Other',sort:'constructor',minBookmarks:500}),{...DOT_FILTER_DEFAULTS,query:Array.from('😀  '.repeat(250).trim()).slice(0,200).join('')});
  assert.deepEqual(normalizeDotFilters(null),DOT_FILTER_DEFAULTS);
  assert.deepEqual(normalizeDotFilters('not filters'),DOT_FILTER_DEFAULTS);
  assert.equal(hasDotFilters(),false);assert.equal(hasDotFilters({query:'  '}),false);
  assert.equal(hasDotFilters({sort:'bookmarks'}),true);assert.equal(hasDotFilters({minBookmarks:'200'}),true);
});

test('search matches literal AND words across source title, body, author and notes without changing original text',()=>{
  const first=row('100001'),second=row('100002');second.material={...second.material,title_zh:'网站搭建',summary_zh:'整理网站教程',author_handle:'other',selection_reason:'网站搭建',my_angle:'先试搭个网站'};
  const before=structuredClone([first,second]);
  assert.deepEqual(ids(filterDotCandidates([first,second],{filters:{query:'MAKER 字幕'}})),[first.id]);
  assert.deepEqual(ids(filterDotCandidates([first,second],{filters:{query:'公开 短视频'}})),[first.id]);
  assert.deepEqual(filterDotCandidates([first,second],{filters:{query:'[a-z]*'}}),[]);
  assert.deepEqual([first,second],before);
});

test('search normalizes full width characters and accepts displayed at-prefixed author handles',()=>{
  const first=row('100001');first.material.summary_zh='使用 MCP 建流程';first.material.author_handle='Maker';
  assert.deepEqual(ids(filterDotCandidates([first],{filters:{query:'ｍｃｐ @maker'}})),[first.id]);
});

test('category and collector can combine while other tabs and invalid rows stay outside visible scope',()=>{
  const dot=row('100001'),feedgrab=row('100002',{batch:{collector:'feedgrab'}}),cognition=row('100003');cognition.material={...cognition.material,category:'cognition'};
  const featured=row('100004',{status:'featured'});
  assert.deepEqual(ids(filterDotCandidates([dot,feedgrab,cognition,featured,null],{filters:{category:'tutorial',collector:'feedgrab'}})),[feedgrab.id]);
  assert.deepEqual(ids(filterDotCandidates([dot,feedgrab,cognition,featured],{view:'featured'})),[featured.id]);
  assert.deepEqual(ids(filterDotCandidates([dot,featured],{view:'__proto__'})),[dot.id]);
  assert.deepEqual(filterDotCandidates(undefined),[]);
});

test('explicit bookmark minimum includes the threshold but unknown, numeric strings and values below are excluded',()=>{
  const counts=[null,0,199,200,499,500,'900'];const rows=counts.map((count,index)=>{const result=row(String(100000+index));result.material={...result.material,bookmark_count:count};return result;});
  assert.deepEqual(ids(filterDotCandidates(rows,{filters:{minBookmarks:'200'}})),[rows[3].id,rows[4].id,rows[5].id]);
  assert.deepEqual(ids(filterDotCandidates(rows,{filters:{minBookmarks:'500'}})),[rows[5].id]);
  assert.equal(filterDotCandidates(rows).length,7);
  assert.equal(rows[0].material.bookmark_count,null);
});

test('popularity sort keeps known zero ahead of unknown, uses received time as a tie break and never mutates input order',()=>{
  const counts=[null,0,500,200,'1000',500];const rows=counts.map((count,index)=>{const result=row(String(100000+index),{imported_at:`2026-10-10T0${index}:00:00Z`});result.material={...result.material,bookmark_count:count};return result;});
  const before=structuredClone(rows);
  assert.deepEqual(ids(filterDotCandidates(rows,{filters:{sort:'bookmarks'}})),[rows[5].id,rows[2].id,rows[3].id,rows[1].id,rows[4].id,rows[0].id]);
  assert.deepEqual(rows,before);
});

test('likes sort ignores bookmark amounts and unknown likes stay last',()=>{
  const first=row('100001'),second=row('100002'),unknown=row('100003');
  first.material.like_count=0;first.material.bookmark_count=900;
  second.material.like_count=10;second.material.bookmark_count=0;
  unknown.material.like_count=null;
  assert.deepEqual(ids(filterDotCandidates([first,unknown,second],{filters:{sort:'likes'}})),[second.id,first.id,unknown.id]);
});

test('recent sort means received date and tied or invalid dates remain stable with valid dates first',()=>{
  const old=row('100001'),recent=row('100002',{imported_at:'2026-10-10T02:00:00Z'}),tied=row('100003'),bad=row('100004',{imported_at:'invalid'});
  old.batch.collected_at='2026-10-11T02:00:00Z';
  assert.deepEqual(ids(filterDotCandidates([old,bad,recent,tied])),[recent.id,old.id,tied.id,bad.id]);
});

test('filtered pending renderer preserves full tab count but only visible choices, batch scope and selected count',()=>{
  const first=row('100001'),second=row('100002');second.material={...second.material,title_zh:'另一篇网站教程',summary_zh:'建一个网站',selection_reason:'完成建站',my_angle:'试建站'};
  const html=renderDotCandidatesView({candidates:[first,second],selectedIds:[first.id,second.id],filters:{query:'字幕'}});
  assert.match(html,/待筛选<span>2<\/span>/);assert.match(html,/当前显示 1 条 \/ 本栏共 2 条/);
  assert.match(html,/data-dot-candidate="dot-x-100001"/);assert.doesNotMatch(html,/data-dot-candidate="dot-x-100002"/);
  assert.match(html,/已选 1 条/);assert.match(html,/全选当前显示/);assert.match(html,/选择当前显示的待筛选材料/);
  assert.match(html,/当前勾选会清空/);
});

test('no matches gives reversible empty action and never implies materials were deleted',()=>{
  const html=renderDotCandidatesView({candidates:[row('100001')],filters:{query:'没有匹配的内容'}});
  assert.match(html,/当前显示 0 条 \/ 本栏共 1 条/);assert.match(html,/没有符合这组筛选的材料/);
  assert.match(html,/原有材料仍在，不会被删除/);assert.match(html,/清除筛选，查看全部/);
  assert.doesNotMatch(html,/data-dot-bulk-status/);
});

test('featured export label accurately names all records even when filtering hides most and topic action exists only for featured',()=>{
  const first=row('100001',{status:'featured'}),second=row('100002',{status:'featured'});second.material={...second.material,title_zh:'另一个网站教程',summary_zh:'建一个网站',selection_reason:'完成建站',my_angle:'试建站'};
  const html=renderDotCandidatesView({candidates:[first,second],view:'featured',filters:{query:'字幕'}});
  assert.match(html,/导出全部精选 JSON（2 条）/);assert.match(html,/data-action="topic-save" data-item-id="dot-x-100001"/);
  assert.doesNotMatch(html,/data-item-id="dot-x-100002"/);
  for(const status of ['pending','dismissed']) assert.doesNotMatch(renderDotCandidatesView({candidates:[row('100003',{status})],view:status}),/data-action="topic-save"/);
  assert.match(renderDotCandidatesView({candidates:[first],view:'featured',filters:{query:'无匹配'}}),/导出全部精选 JSON（1 条）/);
});

test('untrusted filter query is escaped and busy form controls are disabled',()=>{
  const query='"><img src=x onerror="bad">';
  const html=renderDotCandidatesView({candidates:[row('100001')],filters:{query},busy:true});
  assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|onerror="bad"/);
  assert.match(html,/id="dot-filter-query"[^>]* disabled/);assert.match(html,/id="dot-filter-category"[^>]* disabled/);
  assert.match(html,/<button type="submit" class="btn-secondary-quiet" disabled>应用筛选/);
});

function filterBindingFixture() {
  const fields=Object.fromEntries(Object.entries({query:'字幕',category:'tutorial',collector:'feedgrab',sort:'bookmarks',minBookmarks:'500'}).map(([name,value])=>[name,{value,listeners:{},addEventListener(type,handler){this.listeners[type]=handler;}}]));
  const submit={disabled:false},calls=[];
  const form={listeners:{},addEventListener(type,handler){this.listeners[type]=handler;},querySelector(selector){if(selector==='[type="submit"]')return submit;const name=selector.match(/name="([^"]+)"/)?.[1];return fields[name];}};
  const clear={disabled:false,listeners:{},addEventListener(type,handler){this.listeners[type]=handler;}};
  const root={querySelectorAll(selector){return selector==='#dot-filter-form' ? [form] : selector==='[data-dot-filter-clear]' ? [clear] : [];}};
  bindDotCandidatesEvents(root,{onFilters:value=>calls.push(value)});
  return {fields,form,submit,clear,calls};
}

test('typing never triggers a render callback; explicit submit supplies normalized filters',()=>{
  const fixture=filterBindingFixture();fixture.fields.query.value=' 新词 ';
  assert.deepEqual(fixture.fields.query.listeners,{});assert.equal(fixture.calls.length,0);
  let prevented=false;fixture.form.listeners.submit({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.deepEqual(fixture.calls,[{query:'新词',category:'tutorial',collector:'feedgrab',sort:'bookmarks',minBookmarks:'500'}]);
});

test('clear supplies defaults and disabled apply/clear never call mutation callbacks',()=>{
  const fixture=filterBindingFixture();fixture.clear.listeners.click();assert.deepEqual(fixture.calls,[DOT_FILTER_DEFAULTS]);
  fixture.clear.disabled=true;fixture.clear.listeners.click();
  fixture.submit.disabled=true;fixture.form.listeners.submit({preventDefault(){}});
  assert.equal(fixture.calls.length,1);
});

test('candidate page keeps the review path before the list and intake settings after it, closed by default',()=>{
  const html=renderDotCandidatesView({candidates:[row('100001')],inbox:{connected:true}});
  assert.match(html,/先看内容有没有用，再决定留下什么/);assert.doesNotMatch(html,/外部素材 · 由你挑选/);
  assert.match(html,/aria-label="从材料到行动的三步"/);assert.match(html,/精选由你决定；原文与个人判断分开保留/);
  assert.ok(html.indexOf('dot-review-path')<html.indexOf('dot-candidates-grid'));
  assert.ok(html.indexOf('dot-candidates-grid')<html.indexOf('id="dot-candidates-intake"'));
  assert.match(html,/<details id="dot-candidates-intake" class="dot-candidates-intake">/);
  assert.ok(html.indexOf('id="dot-candidates-intake"')<html.indexOf('id="dot-inbox-panel"'));
  assert.ok(html.indexOf('id="dot-candidates-intake"')<html.indexOf('手动导入文件不会上传'));
  assert.match(html,/素材自动接收与导入说明/);assert.match(html,/已连接 · 自动接收/);
});

test('import feedback remains ahead of review controls while errors in receipt settings are visible before the folded area',()=>{
  const html=renderDotCandidatesView({candidates:[row('100001')],message:'导入 1 条',error:'文件不能读取',inbox:{error:'接收暂时失败'}});
  assert.ok(html.indexOf('id="dot-candidates-message"')<html.indexOf('dot-review-path'));
  assert.ok(html.indexOf('id="dot-candidates-error"')<html.indexOf('dot-review-path'));
  assert.ok(html.indexOf('素材接收需要处理：接收暂时失败')<html.indexOf('dot-review-path'));
  assert.match(html,/<details id="dot-candidates-intake" class="dot-candidates-intake" open>/);
  assert.match(html,/id="dot-inbox-error"/);assert.match(html,/data-dot-intake-open>查看接收设置/);
});

test('receipt settings open state can be restored explicitly and missing connection offers setup without taking over the first screen',()=>{
  const html=renderDotCandidatesView({candidates:[row('100001')],intakeOpen:true});
  assert.match(html,/<details id="dot-candidates-intake" class="dot-candidates-intake" open>/);
  assert.match(html,/未连接 · 可展开设置/);assert.match(html,/id="dot-inbox-connect-form"/);
  const defaults=renderDotCandidatesView({candidates:[row('100001')]});
  assert.match(defaults,/<details id="dot-candidates-intake" class="dot-candidates-intake">/);
  assert.ok(defaults.indexOf('dot-candidates-grid')<defaults.indexOf('id="dot-inbox-connect-form"'));
});

test('receipt fold toggle reports state without redraw and error shortcut opens the existing settings element',()=>{
  const calls=[];let focused=false,scrolled=false;
  const details={open:false,listeners:{},addEventListener(name,handler){this.listeners[name]=handler;},scrollIntoView(){scrolled=true;},querySelector(){return {focus(){focused=true;}};}};
  const open={disabled:false,listeners:{},addEventListener(name,handler){this.listeners[name]=handler;}};
  const root={querySelectorAll(selector){return selector==='#dot-candidates-intake' ? [details] : selector==='[data-dot-intake-open]' ? [open] : [];}};
  bindDotCandidatesEvents(root,{onIntakeToggle:value=>calls.push(value)});
  details.open=true;details.listeners.toggle();details.open=false;details.listeners.toggle();
  assert.deepEqual(calls,[true,false]);
  open.listeners.click();assert.equal(details.open,true);assert.equal(scrolled,true);assert.equal(focused,true);
  assert.deepEqual(calls,[true,false,true]);open.disabled=true;open.listeners.click();assert.equal(calls.length,3);
});

test('isolated receipt feedback escapes source text, prioritizes errors and can clear the slot without rendering forms or cards',()=>{
  assert.equal(renderDotInboxFeedback(), '');
  const html=renderDotInboxFeedback({message:'同步已检查',error:'<script>不能连接</script>',warning:'较早的提醒'});
  assert.match(html,/role="alert"/);assert.match(html,/&lt;script&gt;不能连接&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>|同步已检查|较早的提醒|<form|dot-candidate-card|接收码/);
  const message=renderDotInboxFeedback({message:'没有新材料'});assert.match(message,/role="status"/);assert.match(message,/没有新材料/);
  assert.match(renderDotCandidatesView(),/id="dot-inbox-feedback"><\/div>/);
});

test('feedback-only rebinding dispatches just an intake-open request and cannot submit filters or review decisions',()=>{
  const calls=[],button={disabled:false,listener:null,addEventListener(type,handler){assert.equal(type,'click');this.listener=handler;}};
  const root={querySelectorAll(selector){assert.equal(selector,'[data-dot-intake-open]');return [button];}};
  bindDotInboxFeedbackEvents(root,{onIntakeOpen:()=>calls.push('open')});
  button.listener();assert.deepEqual(calls,['open']);button.disabled=true;button.listener();assert.deepEqual(calls,['open']);
});
