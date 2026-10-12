import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDotCandidatesView, bindDotCandidatesEvents, renderDotInboxFeedback, bindDotInboxFeedbackEvents } from './src/dotCandidatesView.js';

function row(id, overrides={}) {
  return { id:`dot-x-${id}`,status:'pending',imported_at:'2026-10-10T01:00:00Z',batch:{collector:'Dot',collected_at:'2026-10-09T01:00:00Z',group:'items'},material:{title_zh:`材料 ${id}`,summary_zh:`这篇材料 ${id} 的完整内容。`,category:'tutorial',author_handle:'someone',original_url:`https://x.com/someone/status/${id}`,bookmark_count:null,like_count:0,view_count:null,selection_reason:`依据 ${id}`,my_angle:'整理者建议，不是用户经验',read_scope:'main_post',unknowns:[`未知项 ${id}`]},...overrides };
}
const page=(rows,options={})=>renderDotCandidatesView({candidates:rows,...options});

test('one queue row per ID preserves export scope while one reader displays only the selected full evidence',()=>{
  const rows=[row('100001'),row('100002')],before=JSON.stringify(rows),html=page(rows,{activeCandidateId:rows[1].id});
  const ids=[...html.matchAll(/data-dot-candidate="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(ids,rows.map(record=>record.id));
  assert.equal((html.match(/class="dot-candidate-reader"/g)||[]).length,1);
  assert.match(html,/data-dot-reader-id="dot-x-100002"/);
  assert.match(html,/is-active" data-dot-candidate="dot-x-100002"/);
  assert.ok(html.includes('依据 100002'));assert.ok(html.includes('未知项 100002'));
  assert.ok(!html.includes('依据 100001'));assert.ok(!html.includes('未知项 100001'));
  assert.match(html,/收藏数未知/);assert.match(html,/点赞 0/);assert.doesNotMatch(html,/收藏 0|浏览 0/);
  assert.equal(JSON.stringify(rows),before);
});

test('filtered, removed and wrong-status reading selections fall back to first visible item without exposing hidden evidence',()=>{
  const rows=[row('100001'),row('100002'),row('100003',{status:'featured'})];
  for(const activeCandidateId of ['dot-x-no-longer-here',rows[2].id,rows[0].id]){
    const html=page(rows,{activeCandidateId,filters:{query:'100002'}});
    assert.match(html,/data-dot-reader-id="dot-x-100002"/);
    assert.doesNotMatch(html,/data-dot-candidate="dot-x-100001"|data-dot-reader-id="dot-x-100003"/);
    assert.match(html,/阅读 1 \/ 1/);
  }
  const removed=page(rows.slice(1),{activeCandidateId:rows[0].id});
  assert.match(removed,/data-dot-reader-id="dot-x-100002"/);
  assert.equal(rows[0].status,'pending');
});

test('mobile reader opens only after an explicit reading choice and provides a return action; desktop keeps first preview',()=>{
  const rows=[row('100001'),row('100002')];
  const initial=page(rows);
  assert.match(initial,/class="dot-reader-layout"/);assert.match(initial,/data-dot-reader-id="dot-x-100001"/);
  assert.doesNotMatch(initial,/class="dot-reader-layout is-reader-open"/);
  const opened=page(rows,{activeCandidateId:rows[1].id});
  assert.match(opened,/class="dot-reader-layout is-reader-open"/);
  assert.match(opened,/data-dot-close/);assert.match(opened,/返回列表/);
  assert.match(opened,/id="dot-reader-title" tabindex="-1">材料 100002/);
});

test('previous and next reading controls follow filtered ordering and cannot cross the visible queue',()=>{
  const rows=[row('100001'),row('100002'),row('100003')],html=page(rows,{activeCandidateId:rows[1].id});
  assert.match(html,/data-dot-open="dot-x-100001" aria-label="上一篇材料"/);
  assert.match(html,/data-dot-open="dot-x-100003" aria-label="下一篇材料"/);
  assert.match(html,/阅读 2 \/ 3/);
  const first=page(rows);
  assert.match(first,/aria-label="上一篇材料" title="上一篇材料" disabled/);
  const last=page(rows,{activeCandidateId:rows[2].id});
  assert.match(last,/aria-label="下一篇材料" title="下一篇材料" disabled/);
});

test('opening and closing are UI-only callbacks, disabled reading controls cannot dispatch and review remains explicit',()=>{
  const open={dataset:{dotOpen:'dot-x-100001'},disabled:false,events:{},addEventListener(type,fn){this.events[type]=fn;}};
  const close={disabled:false,events:{},addEventListener(type,fn){this.events[type]=fn;}};
  const calls=[];const root={querySelectorAll(selector){return selector==='[data-dot-open]'?[open]:selector==='[data-dot-close]'?[close]:[];}};
  bindDotCandidatesEvents(root,{onOpenCandidate:id=>calls.push(['open',id]),onCloseCandidate:()=>calls.push(['close']),onSetStatus:()=>{throw new Error('Reading must not approve');}});
  open.events.click();close.events.click();assert.deepEqual(calls,[['open','dot-x-100001'],['close']]);
  open.disabled=true;close.disabled=true;open.events.click();close.events.click();assert.equal(calls.length,2);
  open.disabled=false;open.dataset.dotOpen='';open.events.click();assert.equal(calls.length,2);
});

test('feedgrab full text remains complete and escaped in the open reader, with collection and unknowns distinguished from approval',()=>{
  const record=row('100001');record.batch.collector='feedgrab';record.material.summary_zh='字'.repeat(400)+'\n<script>原始尾部</script>';record.material.unknowns=['未读取完整线程','没有观看视频'];
  const before=JSON.stringify(record),html=page([record],{activeCandidateId:record.id});
  assert.match(html,/<details class="dot-candidate-fulltext" open>/);
  assert.ok(html.includes('字'.repeat(400)+'\n&lt;script&gt;原始尾部&lt;/script&gt;'));
  assert.match(html,/feedgrab 采集 · 未实测 · 尚未进行 AI 分析/);
  assert.match(html,/没有观看视频/);assert.doesNotMatch(html,/<script>|内容已核验|用户已验收/);
  assert.equal(JSON.stringify(record),before);
});

test('empty or unmatched queue keeps import and reversible filters without a stale reader or review actions',()=>{
  for(const html of [page([],{activeCandidateId:'dot-x-removed'}),page([row('100001')],{activeCandidateId:'dot-x-100001',filters:{query:'不存在的词'}})]){
    assert.match(html,/id="dot-candidates-file"/);assert.match(html,/id="dot-candidates-intake"/);
    assert.doesNotMatch(html,/data-dot-reader-id|data-dot-status|data-dot-open|dot-reader-layout/);
  }
  assert.match(page([row('100001')],{filters:{query:'不存在的词'}}),/清除筛选，查看全部/);
});

test('open source reader is keyboard focusable without converting reading into an approval',()=>{
  const html=page([row('100001')]);
  assert.match(html,/data-dot-reader-id="dot-x-100001" aria-labelledby="dot-reader-title" tabindex="0"/);
  assert.match(html,/data-dot-status="featured"/);
  assert.doesNotMatch(html,/role="dialog"|aria-modal="true"/);
});

test('deferred new material gets a visible manual refresh action outside receipt settings, including partial receipt errors',()=>{
  const html=page([row('100001')],{inbox:{pendingNew:3,message:'自动收到 3 条新材料'}});
  assert.ok(html.indexOf('data-dot-inbox-show-new')<html.indexOf('id="dot-candidates-intake"'));
  assert.match(html,/显示新收到的 3 条材料/);
  assert.match(renderDotInboxFeedback({error:'部分投递失败',pendingNew:1}),/部分投递失败[\s\S]*显示新收到的 1 条材料/);
  assert.doesNotMatch(renderDotInboxFeedback({pendingNew:-1}),/data-dot-inbox-show-new/);
  assert.doesNotMatch(renderDotInboxFeedback({pendingNew:'3'}),/data-dot-inbox-show-new/);
});

test('feedback-only manual refresh uses the existing inbox callback exactly once and never reviews materials',()=>{
  const button={disabled:false,listener:null,addEventListener(type,fn){assert.equal(type,'click');this.listener=fn;}};
  const root={querySelectorAll(selector){return selector==='[data-dot-inbox-show-new]'?[button]:[];}};
  let calls=0;
  bindDotInboxFeedbackEvents(root,{onInboxShowNew:()=>calls++});
  button.listener();assert.equal(calls,1);button.disabled=true;button.listener();assert.equal(calls,1);
});

test('reader height follows its document position when filters expand and does not jump with restored window scroll',()=>{
  const view={scrollY:200},values=[];
  let viewportTop=150;
  const layout={ownerDocument:{defaultView:view},getBoundingClientRect:()=>({top:viewportTop}),style:{setProperty:(key,value)=>values.push([key,value])}};
  const advanced={listener:null,addEventListener(type,fn){assert.equal(type,'toggle');this.listener=fn;}};
  const root={querySelector:selector=>selector==='.dot-reader-layout'?layout:null,querySelectorAll:selector=>selector==='.dot-filter-advanced'?[advanced]:[]};
  bindDotCandidatesEvents(root,{onSetStatus:()=>{throw new Error('Viewport changes cannot review materials');}});
  assert.deepEqual(values.at(-1),['--dot-reader-top','350px']);
  viewportTop=270;advanced.listener();
  assert.deepEqual(values.at(-1),['--dot-reader-top','470px']);
  view.scrollY=100;viewportTop=370;advanced.listener();
  assert.deepEqual(values.at(-1),['--dot-reader-top','470px']);
});
