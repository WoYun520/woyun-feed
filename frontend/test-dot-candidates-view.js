import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDotCandidatesView, bindDotCandidatesEvents, renderDotInboxPanel, bindDotInboxEvents } from './src/dotCandidatesView.js';

function record(id = '2102240170473042026', status = 'pending') {
  return {
    id: `dot-x-${id}`, key: `x:${id}`, status,
    imported_at: '2026-10-10T01:00:00Z',
    batch: { collector: 'Dot', collected_at: '2026-10-09T09:05:22Z', group: 'items' },
    material: {
      category: 'tutorial', original_url: `https://x.com/someone/status/${id}`,
      author_handle: 'someone', published_at: null,
      title_zh: '把播客变成可读文章', summary_zh: '下载公开字幕，分段整理成可读的文章。',
      bookmark_count: 199, like_count: 156, view_count: 12750,
      metric_display: '199 收藏；156 赞；1.2 万次浏览', metrics_checked_at: '2026-10-09T03:28:17Z',
      metrics_source_url: `https://x.com/someone/status/${id}`, read_scope: 'main_post',
      selection_reason: '适合把公开长视频整理成读书材料。', my_angle: '先用一个公开视频试跑，核对字幕准确性。',
      unknowns: ['没有运行仓库', '未观看视频'],
    }, item: { id: 'unused-item' },
  };
}

test('empty view has one-step file input, clear local boundary and useful next action', () => {
  const html = renderDotCandidatesView();
  assert.match(html, /id="dot-candidates-file"[^>]*type="file"[^>]*accept="\.json,application\/json"/);
  assert.match(html, /for="dot-candidates-file"/);
  assert.match(html, /一键导入素材/);
  assert.match(html, /一键导入 Dot 或 feedgrab 素材/);
  assert.match(html, /当前浏览器/);
  assert.match(html, /导入文件不会上传/);
  assert.match(html, /不会直接发布到公开首页/);
  assert.match(html, /还没有待筛选材料/);
  assert.doesNotMatch(html, /data-dot-bulk-status|data-dot-export/);
});

test('status tabs count all records but the list and selection show only the chosen status', () => {
  const candidates = [record('100001'), record('100002', 'featured'), record('100003', 'dismissed')];
  const html = renderDotCandidatesView({ candidates, selectedIds: ['dot-x-100001', 'dot-x-100002'] });
  assert.match(html, /data-dot-view="pending" aria-pressed="true"[^>]*>待筛选<span>1<\/span>/);
  assert.match(html, /我的精选<span>1<\/span>/);
  assert.match(html, /已略过<span>1<\/span>/);
  assert.match(html, /data-dot-candidate="dot-x-100001"/);
  assert.doesNotMatch(html, /data-dot-candidate="dot-x-100002"|data-dot-candidate="dot-x-100003"/);
  assert.match(html, /已选 1 条/);
  assert.match(html, /data-dot-select-all[^>]* checked/);
  assert.match(html, /data-dot-bulk-status="featured">选入精选/);
  assert.equal(candidates[0].status, 'pending');
});

test('cards preserve reason, creator angle, source metrics and unknowns without implying execution', () => {
  const html = renderDotCandidatesView({ candidates: [record()] });
  for (const value of ['把播客变成可读文章', '199', '12,750', '适合把公开长视频', '先用一个公开视频试跑', '没有运行仓库', '未观看视频']) assert.ok(html.includes(value));
  assert.match(html, /Dot 整理 · 未实测/);
  assert.match(html, /Dot 只读主帖/);
  assert.match(html, /由 Dot 记录/);
  assert.match(html, /看原帖核对/);
  assert.match(html, /未知；采集时间不代表发布时间/);
  assert.match(html, /北京时间/);
  assert.doesNotMatch(html, /测试通过|用户验收|内容已核验/);
});

test('mixed collectors keep legacy Dot attribution and label feedgrab as collection without fabricated analysis or thread reading',()=>{
  const legacy=record('2102240170473042026'),collected=record('2102240170473042027');
  collected.batch.collector='feedgrab';collected.material.title_zh='【采集示例】一条工具教程';
  collected.material.bookmark_count=null;collected.material.view_count=null;collected.material.my_angle='';
  collected.material.unknowns=['尚未进行 AI 分析','没有读取完整线程','没有观看附带视频'];
  const options={candidates:[legacy,collected],selectedIds:[legacy.id,collected.id]};
  const html=renderDotCandidatesView({...options,activeCandidateId:legacy.id})+renderDotCandidatesView({...options,activeCandidateId:collected.id});
  assert.match(html,/Dot 整理 · 未实测/);assert.match(html,/Dot 只读主帖/);
  assert.match(html,/feedgrab 采集 · 未实测 · 尚未进行 AI 分析/);
  assert.match(html,/feedgrab 采集主帖内容/);assert.match(html,/由 feedgrab 记录/);
  assert.match(html,/这批是谁采集的/);assert.match(html,/收藏数未知/);assert.match(html,/已选 2 条/);
  assert.doesNotMatch(html,/feedgrab 整理|feedgrab 选题建议|feedgrab 记录已读完整线程|AI 已分析|内容已核验/);
  assert.match(html,/素材自动接收/);assert.match(html,/Dot 或 feedgrab 的投递/);
});

test('long feedgrab text previews 240 characters safely and retains every original character in native details while Dot stays unchanged',()=>{
  const row=record();row.batch.collector='feedgrab';row.material.summary_zh='开'.repeat(239)+'😀'+'<script>原文尾部</script>\n完整的后半部分。';
  const original=row.material.summary_zh,html=renderDotCandidatesView({candidates:[row]});
  assert.match(html,/<p class="dot-candidate-summary">开{239}😀…<\/p>/);
  assert.match(html,/<details class="dot-candidate-fulltext" open><summary>展开采集原文<\/summary>/);
  assert.match(html,/未进行 AI 总结/);assert.match(html,/😀&lt;script&gt;原文尾部&lt;\/script&gt;\n完整的后半部分。/);
  assert.match(html,/<details class="dot-candidate-details" open>/);assert.doesNotMatch(html,/<script>/);
  assert.equal(row.material.summary_zh,original);
  row.batch.collector='Dot';const legacy=renderDotCandidatesView({candidates:[row]});
  assert.doesNotMatch(legacy,/dot-candidate-fulltext/);assert.ok(legacy.includes('完整的后半部分。'));
  row.batch.collector='feedgrab';row.material.summary_zh='短原文';
  const short=renderDotCandidatesView({candidates:[row]});assert.doesNotMatch(short,/dot-candidate-fulltext/);assert.match(short,/>短原文<\/p>/);
});

test('unknown bookmarks remain unknown and alternatives are visibly distinct from main materials', () => {
  const row = record(); row.material.bookmark_count = null; row.material.view_count = null;
  row.batch.group = 'alternatives';
  const html = renderDotCandidatesView({ candidates: [row] });
  assert.match(html, /收藏数未知/);
  assert.match(html, /备选材料/);
  assert.doesNotMatch(html, /高收藏|收藏 0|浏览 0/);
  row.material.bookmark_count = 0;
  assert.match(renderDotCandidatesView({ candidates: [row] }), /收藏 0/);
  row.material.bookmark_count = '999';
  assert.match(renderDotCandidatesView({ candidates: [row] }), /收藏数未知/);
});

test('featured and dismissed records can return to pending; export exists only for nonempty featured', () => {
  const rows = [record('100001', 'featured'), record('100002', 'dismissed')];
  const featured = renderDotCandidatesView({ candidates: rows, view: 'featured', selectedIds: ['dot-x-100001'] });
  assert.match(featured, /data-dot-export/);
  assert.match(featured, /你已选入精选，仍需核对原文/);
  assert.match(featured, /data-dot-status="pending" data-dot-id="dot-x-100001"/);
  assert.doesNotMatch(featured, /data-dot-select=|data-dot-bulk-status/);
  const dismissed = renderDotCandidatesView({ candidates: rows, view: 'dismissed' });
  assert.match(dismissed, /data-dot-status="pending" data-dot-id="dot-x-100002"/);
  assert.doesNotMatch(dismissed, /data-dot-export/);
  assert.match(renderDotCandidatesView({ view: 'featured' }), /先到待筛选区/);
});

test('untrusted text is escaped across all fields and links are restricted to canonical X posts', () => {
  const row = record();
  const payload = '<img src=x onerror="bad"><script>bad</script>';
  for (const key of ['title_zh', 'summary_zh', 'author_handle', 'selection_reason', 'my_angle', 'metric_display']) row.material[key] = payload;
  row.material.unknowns = [payload]; row.batch.collector = payload;
  row.material.original_url = 'javascript:alert(1)'; row.material.metrics_source_url = 'https://x.com.evil.test/person/status/2102240170473042026';
  row.material.metrics_checked_at = '" onmouseover="bad'; row.id = '" onclick="bad';
  let html = renderDotCandidatesView({ candidates: [row], message: payload, error: payload });
  assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'));
  assert.match(html, /原帖链接不可用/);
  assert.match(html, /时间未提供/);
  assert.doesNotMatch(html, /<script>|<img|href="javascript:|href="https:\/\/x\.com\.evil| onclick="bad| onmouseover="bad/);
  row.material.original_url = 'https://twitter.com/person/status/2102240170473042026?secret=abc#fragment';
  html = renderDotCandidatesView({ candidates: [row] });
  assert.match(html, /href="https:\/\/x\.com\/person\/status\/2102240170473042026"/);
  assert.doesNotMatch(html, /secret=abc|#fragment/);
  for (const value of ['http://x.com/person/status/2102240170473042026', 'https://x.com@evil.test/person/status/2102240170473042026', 'https://x.com/person/status/2102240170473042026/photo/1']) {
    row.material.original_url = value;
    assert.doesNotMatch(renderDotCandidatesView({ candidates: [row] }), /href=/);
  }
});

test('invalid view safely defaults and busy state disables mutations with accessible feedback', () => {
  const html = renderDotCandidatesView({ candidates: [record(), null, { id: 'bad', status: 'unknown' }], view: '__proto__', selectedIds: new Set([record().id]), busy: true, message: '导入 1 条', error: '文件格式不支持' });
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /data-dot-view="pending" aria-pressed="true" disabled/);
  assert.match(html, /id="dot-candidates-message"[^>]*role="status" tabindex="-1"/);
  assert.match(html, /id="dot-candidates-error"[^>]*role="alert" tabindex="-1"/);
  assert.match(html, /data-dot-bulk-status="featured" disabled/);
  assert.match(html, /正在导入/);
  assert.doesNotMatch(html, /data-dot-candidate="bad"/);
});

function controlsFixture() {
  const nodes = new Map();
  const node = (name, dataset = {}, props = {}) => {
    const element = { dataset, disabled: false, checked: false, value: '', listeners: {}, addEventListener(type, handler) { this.listeners[type] = handler; }, ...props };
    nodes.set(name, element); return element;
  };
  const file = node('file', {}, { files: [{ name: 'dot.json' }], value: '/fake/path/dot.json' });
  const view = node('view', { dotView: 'featured' });
  const first = node('first', { dotSelect: 'dot-x-100001' }, { checked: true });
  const second = node('second', { dotSelect: 'dot-x-100002' });
  const all = node('all');
  const status = node('status', { dotStatus: 'dismissed', dotId: 'dot-x-100001' });
  const bulk = node('bulk', { dotBulkStatus: 'featured' });
  const exportButton = node('export');
  const cards = [{ dataset: { dotCandidate: 'dot-x-100001' } }, { dataset: { dotCandidate: 'dot-x-100002' } }];
  const selectors = { '#dot-candidates-file': [file], '[data-dot-view]': [view], '[data-dot-select]': [first, second], '[data-dot-select-all]': [all], '[data-dot-status]': [status], '[data-dot-bulk-status]': [bulk], '[data-dot-export]': [exportButton], '[data-dot-candidate]': cards };
  const calls = [];
  const callbacks = Object.fromEntries(['onFile', 'onView', 'onSelect', 'onSelectAll', 'onSetStatus', 'onExport'].map(name => [name, (...args) => calls.push([name, ...args])]));
  const root = { querySelectorAll(selector) { return selectors[selector] || []; } };
  bindDotCandidatesEvents(root, callbacks);
  return { nodes, calls, fire(name, type) { nodes.get(name).listeners[type](); } };
}

test('file binding immediately imports selected file and resets input to allow another copy of it', () => {
  const { nodes, calls, fire } = controlsFixture();
  fire('file', 'change');
  assert.deepEqual(calls, [['onFile', { name: 'dot.json' }]]);
  assert.equal(nodes.get('file').value, '');
  nodes.get('file').files = []; fire('file', 'change'); assert.equal(calls.length, 1);
  nodes.get('file').files = [{ name: 'dot.json' }]; fire('file', 'change'); assert.equal(calls.length, 2);
});

test('view and selection callbacks pass precise IDs; bulk promotion only uses checked visible pending inputs', () => {
  const { nodes, calls, fire } = controlsFixture();
  assert.equal(nodes.get('all').indeterminate, true);
  fire('view', 'click'); fire('first', 'change');
  nodes.get('all').checked = true; fire('all', 'change');
  fire('status', 'click'); fire('bulk', 'click'); fire('export', 'click');
  assert.deepEqual(calls, [
    ['onView', 'featured'], ['onSelect', 'dot-x-100001', true],
    ['onSelectAll', ['dot-x-100001', 'dot-x-100002'], true],
    ['onSetStatus', ['dot-x-100001'], 'dismissed'], ['onSetStatus', ['dot-x-100001'], 'featured'],
    ['onExport', ['dot-x-100001', 'dot-x-100002']],
  ]);
  nodes.get('first').checked = false; const before = calls.length; fire('bulk', 'click'); assert.equal(calls.length, before);
});

test('disabled controls and invalid view or status values do not dispatch mutation callbacks', () => {
  const { nodes, calls, fire } = controlsFixture();
  for (const [name, type] of [['file', 'change'], ['view', 'click'], ['first', 'change'], ['all', 'change'], ['status', 'click'], ['bulk', 'click'], ['export', 'click']]) {
    nodes.get(name).disabled = true; fire(name, type);
  }
  assert.deepEqual(calls, []);
  nodes.get('view').disabled = false; nodes.get('view').dataset.dotView = '__proto__'; fire('view', 'click');
  nodes.get('status').disabled = false; nodes.get('status').dataset.dotStatus = 'published'; fire('status', 'click');
  assert.deepEqual(calls, []);
  bindDotCandidatesEvents(null); bindDotCandidatesEvents({});
});

test('one-time inbox setup masks credentials, omits all secret values and keeps manual selection separate',()=>{
  const secret='dot_read_'+'a'.repeat(64);
  const disconnected=renderDotCandidatesView({inbox:{review_code:secret}});
  assert.match(disconnected,/id="dot-inbox-code" type="password" autocomplete="off"/);
  assert.match(disconnected,/maxlength="256"/);assert.match(disconnected,/接收码不会放进备份或公开页面/);
  assert.match(disconnected,/自云端接收起保留 30 天/);assert.match(disconnected,/精选仍由你选/);
  assert.doesNotMatch(disconnected,new RegExp(secret));assert.doesNotMatch(disconnected,/id="dot-inbox-code"[^>]*value=/);
  const connected=renderDotInboxPanel({connected:true,lastSyncedAt:'2026-10-10T00:00:00Z',review_code:secret,pendingNew:2});
  assert.match(connected,/已连接 · 自动接收/);assert.match(connected,/页面打开时自动接收/);
  assert.match(connected,/data-dot-inbox-sync/);assert.match(connected,/data-dot-inbox-disconnect/);
  assert.match(connected,/显示新收到的 2 条材料/);assert.doesNotMatch(connected,/dot-inbox-code/);
  assert.doesNotMatch(connected,new RegExp(secret));
  const error=renderDotInboxPanel({warning:'<script>bad</script>',error:'连接失败'});
  assert.match(error,/&lt;script&gt;bad&lt;\/script&gt;/);assert.match(error,/自接收起保留 30 天，请及时重试/);
});

test('keyboard setup submit clears the password and moves focus before connecting; controls cannot promote materials',()=>{
  let handler,prevented=false,focused=false;const calls=[];
  const code='dot_read_'+'a'.repeat(64);
  const input={value:' '+code+' ',disabled:false},button={disabled:false,focus:()=>{focused=true;}};
  const form={querySelector:selector=>selector==='#dot-inbox-code' ? input : button,addEventListener:(_type,callback)=>{handler=callback;}};
  const controls={};
  for(const selector of ['[data-dot-inbox-sync]','[data-dot-inbox-disconnect]','[data-dot-inbox-show-new]']) controls[selector]={disabled:false,addEventListener(_type,callback){this.click=callback;}};
  const root={querySelectorAll:selector=>selector==='#dot-inbox-connect-form' ? [form] : controls[selector] ? [controls[selector]] : []};
  bindDotInboxEvents(root,{onInboxConnect:value=>{assert.equal(input.value,'');assert.equal(focused,true);calls.push(['connect',value]);},onInboxSync:()=>calls.push(['sync']),onInboxDisconnect:()=>calls.push(['disconnect']),onInboxShowNew:()=>calls.push(['show'])});
  handler({preventDefault:()=>{prevented=true;}});assert.equal(prevented,true);
  controls['[data-dot-inbox-sync]'].click();controls['[data-dot-inbox-disconnect]'].click();controls['[data-dot-inbox-show-new]'].click();
  assert.deepEqual(calls,[['connect',code],['sync'],['disconnect'],['show']]);
  input.value=code;button.disabled=true;handler({preventDefault(){}});assert.equal(calls.length,4);assert.equal(input.value,code);
});
