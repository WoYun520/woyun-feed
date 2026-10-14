import { renderReviewQueue, bindReviewQueueEvents } from './reviewQueueView.js';

const VIEW_LABELS = { pending: '待筛选', featured: '我的精选', dismissed: '已略过' };
const CATEGORY_LABELS = { tutorial: '操作教程', cognition: '思路与经验' };
const READ_LABELS = { main_post: '只读主帖', full_thread: '记录已读完整线程', search_excerpt: '仅见搜索摘录' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

// Links from an imported file are never executable URLs or arbitrary hosts.
function safePostUrl(value) {
  const match = typeof value === 'string' && value.match(/^https:\/\/(?:(?:www|mobile)\.)?(?:x\.com|twitter\.com)\/([a-z\d_]{1,15})\/status\/(\d{5,25})\/?(?:[?#][^\s]*)?$/i);
  return match ? `https://x.com/${match[1]}/status/${match[2]}` : '';
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('zh-CN') : null;
}

function checkedTime(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return '时间未提供';
  return new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) + '（北京时间）';
}

function postLink(url, label, className = '') {
  const safe = safePostUrl(url);
  return safe ? `<a${className ? ` class="${className}"` : ''} href="${escape(safe)}" target="_blank" rel="noopener noreferrer">${escape(label)} <span aria-hidden="true">↗</span></a>` : `<span>${escape(label)}（原帖链接不可用）</span>`;
}

function renderCandidateReader(record, busy) {
  const material = record.material && typeof record.material === 'object' ? record.material : {};
  const title = typeof material.title_zh === 'string' && material.title_zh.trim() ? material.title_zh : '未命名材料';
  const id = escape(record.id);
  const bookmarks = count(material.bookmark_count), likes = count(material.like_count), views = count(material.view_count);
  const unknowns = Array.isArray(material.unknowns) ? material.unknowns.filter(value => typeof value === 'string') : [];
  const collector = record.batch?.collector || record.item?.collector || 'Dot';
  const feedgrab = collector === 'feedgrab';
  const summary = typeof material.summary_zh === 'string' && material.summary_zh ? material.summary_zh : '用途说明尚未提供，请先打开原帖。';
  const summaryCharacters = feedgrab ? Array.from(summary) : null;
  const shortened = feedgrab && summaryCharacters.length > 240;
  const preview = shortened ? summaryCharacters.slice(0,240).join('') + '…' : summary;
  const scope = feedgrab ? ({main_post:'feedgrab 采集主帖内容',full_thread:'feedgrab 记录范围为完整线程，尚未核验',search_excerpt:'feedgrab 仅见搜索摘录'}[material.read_scope] || '采集范围未提供') : READ_LABELS[material.read_scope] ? `${collector} ${READ_LABELS[material.read_scope]}` : '阅读范围未提供';
  const basis = feedgrab ? 'feedgrab 采集' : `${collector} 整理`;
  return `<article class="dot-candidate-reader" data-dot-reader-id="${id}" aria-labelledby="dot-reader-title" tabindex="0">
    <div class="dot-candidate-top">
      <span class="dot-candidate-state">${escape(VIEW_LABELS[record.status] || '待筛选')}</span>
      <span class="dot-candidate-category">${escape(CATEGORY_LABELS[material.category] || '其他材料')}</span>
      ${record.batch?.group === 'alternatives' ? '<span class="dot-candidate-alternative">备选材料</span>' : ''}
      <span class="dot-candidate-author">${escape(material.author_handle ? '@' + String(material.author_handle).replace(/^@/, '') : '作者未提供')}</span>
    </div>
    <h3 id="dot-reader-title" tabindex="-1">${escape(title)}</h3>
    <p class="dot-candidate-summary">${escape(preview)}</p>
    ${shortened ? `<details class="dot-candidate-fulltext" open><summary>展开采集原文</summary><p class="dot-candidate-fulltext-note">仅折叠显示，未进行 AI 总结。以下与保存的采集摘录一致；原帖是否完整请查看采集依据。</p><div class="dot-candidate-fulltext-content">${escape(summary)}</div></details>` : ''}
    <div class="dot-candidate-metrics"><span class="${bookmarks === null ? ' is-unknown' : ''}">${bookmarks === null ? '收藏数未知' : `收藏 ${bookmarks}`}</span>${likes !== null ? `<span>点赞 ${likes}</span>` : ''}${views !== null ? `<span>浏览 ${views}</span>` : ''}<span class="dot-candidate-scope">${escape(scope)}</span></div>
    <p class="dot-candidate-basis">${escape(basis)} · 未实测${feedgrab ? ' · 尚未进行 AI 分析' : ''}${record.status === 'featured' ? ' · 你已选入精选，仍需核对原文' : ''}</p>
    <details class="dot-candidate-details" open><summary>${feedgrab ? '采集依据 · 尚待核对' : '为什么值得看 · 整理依据'}</summary>
      <dl>
        <div><dt>入选理由</dt><dd>${escape(material.selection_reason || '未提供')}</dd></div>
        <div><dt>可以怎么用</dt><dd>${escape(material.my_angle || '未提供')}</dd></div>
        <div><dt>热度记录</dt><dd>${escape(material.metric_display || '原页面显示未提供')}</dd></div>
        <div><dt>热度查看时间</dt><dd>${escape(checkedTime(material.metrics_checked_at))} · 由 ${escape(collector)} 记录${safePostUrl(material.metrics_source_url) ? ' · ' + postLink(material.metrics_source_url, '看原帖核对') : ''}</dd></div>
        <div><dt>原帖发布时间</dt><dd>${material.published_at && Number.isFinite(Date.parse(material.published_at)) ? escape(checkedTime(material.published_at)) : '未知；采集时间不代表发布时间'}</dd></div>
        <div><dt>这批是谁${feedgrab ? '采集' : '整理'}的</dt><dd>${escape(collector)} · 采集 ${escape(checkedTime(record.batch?.collected_at))}</dd></div>
      </dl>
      <div class="dot-candidate-unknowns"><h4>还不知道什么</h4>${unknowns.length ? `<ul>${unknowns.map(value => `<li>${escape(value)}</li>`).join('')}</ul>` : '<p>未提供具体未知项；不代表内容已经核验。</p>'}</div>
    </details>

  </article>`;
}

function renderCandidateReviewActions(record, busy) {
  const material = record.material && typeof record.material === 'object' ? record.material : {};
  const id = escape(record.id), pending = record.status === 'pending', disabled = busy ? ' disabled' : '';
  const kosx = record.kosx === true || record.batch?.collector === 'KOSX';
  const pendingActions = kosx
    ? `<button type="button" class="btn-quiet" data-dot-status="dismissed" data-dot-id="${id}"${disabled}>暂不收录</button><span>只在待筛选，不会自动出现在首页。</span>`
    : `<button type="button" class="btn-secondary-quiet" data-dot-status="featured" data-dot-id="${id}"${disabled}>选入精选</button><button type="button" class="btn-quiet" data-dot-status="dismissed" data-dot-id="${id}"${disabled}>暂不收录</button>`;
  return `<div class="dot-candidate-actions">${postLink(material.original_url, '打开原帖', 'dot-original-link')}
      ${pending ? pendingActions : `${record.status === 'featured' ? `<button type="button" class="btn-primary-action" data-action="topic-save" data-item-id="${id}"${disabled}>放进主题</button>` : ''}<button type="button" class="btn-secondary-quiet" data-dot-status="pending" data-dot-id="${id}"${disabled}>退回待筛选</button>`}
    </div>`;
}

// Reading selection is an ephemeral UI choice; it never alters a material or
// substitutes for the user's explicit review actions.
function renderCandidateListRow(record, { active = false, selected = false, busy = false } = {}) {
  const material = record.material && typeof record.material === 'object' ? record.material : {};
  const title = typeof material.title_zh === 'string' && material.title_zh.trim() ? material.title_zh : '未命名材料';
  const id = escape(record.id), disabled = busy ? ' disabled' : '';
  const summary = typeof material.summary_zh === 'string' && material.summary_zh ? material.summary_zh : '用途说明尚未提供，请先打开原帖。';
  const text = Array.from(summary), preview = text.length > 180 ? text.slice(0, 180).join('') + '…' : summary;
  const bookmarks = count(material.bookmark_count), likes = count(material.like_count);
  return `<article class="dot-candidate-card${active ? ' is-active' : ''}${selected ? ' is-selected' : ''}" data-dot-candidate="${id}">
    <div class="dot-candidate-list-meta">
      ${record.status === 'pending' ? `<label class="dot-candidate-choice"><input type="checkbox" data-dot-select="${id}" aria-label="选择：${escape(title)}"${selected ? ' checked' : ''}${disabled}><span class="dot-choice-label">选择</span></label>` : `<span class="dot-candidate-state">${escape(VIEW_LABELS[record.status])}</span>`}
      <span class="dot-candidate-category">${escape(CATEGORY_LABELS[material.category] || '其他材料')}</span>
      ${record.batch?.group === 'alternatives' ? '<span class="dot-candidate-alternative">备选材料</span>' : ''}
      <span class="dot-candidate-author">${escape(material.author_handle ? '@' + String(material.author_handle).replace(/^@/, '') : '作者未提供')}</span>
    </div>
    <button type="button" class="dot-candidate-read-button" data-dot-open="${id}" aria-pressed="${active}" aria-label="阅读：${escape(title)}"${disabled}>
      <span class="dot-candidate-list-title">${escape(title)}</span><span class="dot-candidate-list-excerpt">${escape(preview)}</span>
      <span class="dot-candidate-list-foot"><span>${bookmarks === null ? '收藏数未知' : `收藏 ${bookmarks}`}</span>${likes !== null ? `<span>点赞 ${likes}</span>` : ''}<span>${escape(record.batch?.collector || record.item?.collector || 'Dot')}</span></span>
    </button>
  </article>`;
}

function renderReaderWorkbench(visible, { activeCandidateId = '', selected, view, busy } = {}) {
  const active = visible.find(record => record.id === activeCandidateId) || visible[0];
  const position = visible.findIndex(record => record.id === active?.id);
  const disabled = busy ? ' disabled' : '';
  const movement = (index, direction, label) => visible[index] ? `<button type="button" class="dot-reader-nav-button" data-dot-open="${escape(visible[index].id)}" aria-label="${label}" title="${label}"${disabled}>${direction}</button>` : `<button type="button" class="dot-reader-nav-button" aria-label="${label}" title="${label}" disabled>${direction}</button>`;
  return `<div class="dot-reader-layout${activeCandidateId ? ' is-reader-open' : ''}">
    <section class="dot-candidates-list-pane" aria-label="${escape(VIEW_LABELS[view])}材料列表">
      <div class="dot-list-pane-heading"><span>${visible.length} 条材料</span><span>点开阅读，再决定</span></div>
      <div class="dot-candidates-grid">${visible.map(record => renderCandidateListRow(record, { active: record.id === active.id, selected: view === 'pending' && selected.has(record.id), busy })).join('')}</div>
    </section>
    <section class="dot-reader-pane" aria-label="材料阅读与筛选">
      <div class="dot-reader-toolbar"><button type="button" class="dot-reader-back" data-dot-close${disabled}><span aria-hidden="true">←</span> 返回列表</button><span class="dot-reader-position">阅读 ${position + 1} / ${visible.length}</span><div class="dot-reader-movement">${movement(position - 1, '←', '上一篇材料')}${movement(position + 1, '→', '下一篇材料')}</div></div>
      ${renderCandidateReader(active, busy)}
      <div class="dot-reader-review-footer">${renderCandidateReviewActions(active, busy)}</div>
    </section>
  </div>`;
}

export function renderDotInboxPanel({ connected = false, busy = false, lastSyncedAt = null, warning = '', message = '', error = '', pendingNew = 0 } = {}) {
  const disabled = busy ? ' disabled' : '';
  return `<aside id="dot-inbox-panel" class="dot-inbox-panel" aria-labelledby="dot-inbox-title" aria-busy="${busy}">
    <div class="dot-inbox-heading"><h3 id="dot-inbox-title">素材自动接收</h3><span class="dot-inbox-state">${connected ? '已连接 · 自动接收' : '只需连接一次'}</span></div>
    ${connected ? `<div class="dot-inbox-connected"><p>${lastSyncedAt ? `最近同步：${escape(checkedTime(lastSyncedAt))}` : '连接已就绪，正在检查新投递。'}<br>页面打开时自动接收；云端新投递可能稍后出现。</p><div><button id="dot-inbox-sync" type="button" class="btn-secondary-quiet" data-dot-inbox-sync${disabled}>${busy ? '正在同步…' : '立即同步'}</button><button id="dot-inbox-disconnect" type="button" class="btn-quiet" data-dot-inbox-disconnect>断开连接</button></div></div>` : `<form id="dot-inbox-connect-form" class="dot-inbox-connect-form" autocomplete="off"><label for="dot-inbox-code">接收码</label><div><input id="dot-inbox-code" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="256" placeholder="粘贴接收码，只在这个浏览器保存" required aria-describedby="dot-inbox-help"${disabled}><button id="dot-inbox-connect" type="submit" class="btn-secondary-quiet"${disabled || warning ? ' disabled' : ''}>${busy ? '正在连接…' : '连接'}</button></div><p id="dot-inbox-help">使用接收码，不要粘贴给采集工具的投递码。接收码不会放进备份或公开页面。</p>${warning ? '<button type="button" class="btn-quiet" data-dot-inbox-disconnect>清除连接设置</button>' : ''}</form>`}
    <p class="dot-inbox-boundary">接收 Dot 或 feedgrab 的投递，自云端接收起保留 30 天。接收后，筛选记录保存在当前浏览器；精选仍由你选，不会自动公开。</p>
    ${warning ? `<p class="dot-inbox-warning" role="alert">${escape(warning)}</p>` : ''}${message ? `<p id="dot-inbox-message" class="dot-inbox-message" role="status">${escape(message)}</p>` : ''}${error ? `<p id="dot-inbox-error" class="dot-inbox-error" role="alert" tabindex="-1">${escape(error)} 已投递的批次自接收起保留 30 天，请及时重试。</p>` : ''}
    ${pendingNew ? `<button type="button" class="btn-secondary-quiet" data-dot-inbox-show-new>显示新收到的 ${Number.isSafeInteger(pendingNew) && pendingNew > 0 ? pendingNew : ''} 条材料</button>` : ''}
  </aside>`;
}

// Keep background receipt feedback separate from the filtering form and source
// cards so the app can patch it without discarding text, selection or details.
export function renderDotInboxFeedback({warning='',message='',error='',pendingNew=0}={}) {
  const issue=error || warning;
  const newCount=Number.isSafeInteger(pendingNew) && pendingNew>0 ? pendingNew : 0;
  const showNew=newCount ? `<button type="button" class="btn-secondary-quiet" data-dot-inbox-show-new>显示新收到的 ${newCount} 条材料</button>` : '';
  const notice=issue ? `<p class="dot-candidates-receive-alert" role="alert">素材接收需要处理：${escape(issue)} <button type="button" class="btn-quiet" data-dot-intake-open>查看接收设置</button></p>` : message ? `<p class="dot-candidates-receive-message" role="status">${escape(message)}</p>` : '';
  return notice+showNew;
}

export function bindDotInboxFeedbackEvents(root,{onIntakeOpen,onInboxShowNew}={}) {
  if (!root || typeof root.querySelectorAll!=='function') return;
  for (const button of root.querySelectorAll('[data-dot-intake-open]')) button.addEventListener('click',()=>{
    if (!button.disabled) onIntakeOpen?.();
  });
  // A feedback-only patch creates a new button. Whole-page binding already
  // uses bindDotInboxEvents, so attach here only when that callback is supplied.
  if(typeof onInboxShowNew==='function') for(const button of root.querySelectorAll('[data-dot-inbox-show-new]')) button.addEventListener('click',()=>{
    if(!button.disabled) onInboxShowNew();
  });
}

function renderFilters(value,busy,shown,total) {
  const filters=normalizeDotFilters(value),disabled=busy ? ' disabled' : '';
  const select=(key,id,label,options)=>`<label class="dot-filter-field" for="${id}"><span>${label}</span><select id="${id}" name="${key}"${disabled}>${(Array.isArray(options) ? options : Object.entries(options)).map(([choice,title])=>`<option value="${escape(choice)}"${filters[key]===choice ? ' selected' : ''}>${escape(title)}</option>`).join('')}</select></label>`;
  return `<section class="dot-filter-panel" aria-label="找到值得留下的材料">
    <form id="dot-filter-form" class="dot-filter-form" autocomplete="off" aria-describedby="dot-filter-help">
      <label class="dot-filter-search" for="dot-filter-query"><span>搜材料</span><input id="dot-filter-query" name="query" type="search" maxlength="200" placeholder="搜标题、正文摘录、作者或用途" value="${escape(filters.query)}"${disabled}></label>
      <details class="dot-filter-advanced"${hasDotFilters(filters) ? ' open' : ''}><summary>筛选与排序 <span aria-hidden="true">⌄</span></summary><div class="dot-filter-options">
        ${select('category','dot-filter-category','内容类型',{all:'全部类型',tutorial:'操作教程',cognition:'思路与经验'})}
        ${select('collector','dot-filter-collector','采集来源',{all:'全部采集来源',Dot:'Dot 整理',feedgrab:'feedgrab 采集'})}
        ${select('minBookmarks','dot-filter-bookmarks','收藏门槛',[['all','不限收藏数'],['200','收藏 ≥ 200'],['500','收藏 ≥ 500']])}
        ${select('sort','dot-filter-sort','排列方式',DOT_FILTER_SORTS)}
      </div><p id="dot-filter-help" class="dot-filter-help">点“应用筛选”后生效，当前勾选会清空。热度未知的材料不满足收藏门槛。</p></details>
      <div class="dot-filter-footer"><div><button type="submit" class="btn-secondary-quiet"${disabled}>应用筛选</button><button type="button" class="btn-quiet" data-dot-filter-clear${disabled || !hasDotFilters(filters) ? ' disabled' : ''}>清除筛选</button></div></div>
    </form>
    <p class="dot-filter-count" role="status">当前显示 ${shown} 条 / 本栏共 ${total} 条${hasDotFilters(filters) ? ' · 已应用筛选' : ''}<span>互动数是采集记录，内容是否有用仍由你判断。</span></p>
  </section>`;
}

export function renderDotCandidatesView({ candidates = [], view = 'pending', filters = {}, intakeOpen = false, activeCandidateId = '', selectedIds = [], busy = false, message = '', error = '', inbox = {}, reviewQueue } = {}) {
  const activeView = Object.hasOwn(VIEW_LABELS, view) ? view : 'pending';
  const rows = Array.isArray(candidates) ? candidates.filter(record => record && typeof record.id === 'string' && Object.hasOwn(VIEW_LABELS, record.status)) : [];
  const total=rows.filter(record=>record.status===activeView).length;
  const visible = filterDotCandidates(rows,{view:activeView,filters});
  const selected = new Set(Array.isArray(selectedIds) ? selectedIds : selectedIds instanceof Set ? selectedIds : []);
  const selectedVisible = activeView === 'pending' ? visible.filter(record => selected.has(record.id)) : [];
  const allSelected = visible.length > 0 && selectedVisible.length === visible.length;
  const disabled = busy ? ' disabled' : '';
  const emptyText = { pending: '连接素材自动接收，或把 Dot / feedgrab 的 JSON 文件选进来。重复的原帖会跳过，看完后再决定哪些值得留下。', featured: '先到待筛选区，选择你觉得有用的材料，再点“选入精选”。', dismissed: '暂不收录的材料放在这里，之后也能退回待筛选。' };
  return `<section id="dot-candidates-page" class="dot-candidates-page${visible.length ? ' has-materials' : ''}" aria-labelledby="dot-candidates-title" aria-busy="${busy}">
    ${reviewQueue ? renderReviewQueue(reviewQueue) : ''}
    <header class="dot-candidates-heading"><div><h2 id="dot-candidates-title">${VIEW_LABELS[activeView]}</h2><p>先看内容有没有用，再决定留下什么。</p></div>
      <label class="dot-import-button${busy ? ' is-disabled' : ''}" for="dot-candidates-file"><span>${busy ? '正在导入…' : '一键导入素材'}</span><input id="dot-candidates-file" class="dot-import-input" type="file" accept=".json,application/json" aria-label="一键导入 Dot 或 feedgrab 素材，选择 JSON 文件，最大 2 MB"${disabled}></label>
    </header>
    ${message ? `<p id="dot-candidates-message" class="dot-import-message" role="status" tabindex="-1">${escape(message)}</p>` : ''}${error ? `<p id="dot-candidates-error" class="dot-import-error" role="alert" tabindex="-1">${escape(error)}</p>` : ''}
    <div id="dot-inbox-feedback">${renderDotInboxFeedback(inbox)}</div>
    <div class="dot-review-path" aria-label="从材料到行动的三步"><ol><li${activeView==='pending' ? ' aria-current="step"' : ''}><span aria-hidden="true">1</span><div><strong>待筛选</strong><p>先看用途与原帖</p></div></li><li${activeView==='featured' ? ' aria-current="step"' : ''}><span aria-hidden="true">2</span><div><strong>我的精选</strong><p>保留你觉得有用的</p></div></li><li><span aria-hidden="true">3</span><div><strong>放进主题</strong><p>补上想法，再交给 AI</p></div></li></ol><p>精选由你决定；原文与个人判断分开保留。</p></div>
    <nav class="dot-candidates-tabs" aria-label="素材筛选状态">${Object.entries(VIEW_LABELS).map(([key, label]) => `<button type="button" data-dot-view="${key}" aria-pressed="${activeView === key}"${disabled}>${label}<span>${rows.filter(record => record.status === key).length}</span></button>`).join('')}</nav>
    ${renderFilters(filters,busy,visible.length,total)}
    ${activeView === 'pending' && visible.length ? `<div class="dot-candidates-bulk"><label><input type="checkbox" data-dot-select-all aria-label="选择当前显示的待筛选材料"${allSelected ? ' checked' : ''}${disabled}><span>全选当前显示</span></label><p role="status">已选 ${selectedVisible.length} 条</p><div><button type="button" class="btn-primary-action" data-dot-bulk-status="featured"${!selectedVisible.length || busy ? ' disabled' : ''}>选入精选</button><button type="button" class="btn-quiet" data-dot-bulk-status="dismissed"${!selectedVisible.length || busy ? ' disabled' : ''}>暂不收录</button></div></div>` : ''}
    ${activeView === 'featured' && total ? `<div class="dot-featured-heading"><p>每条保留原帖、整理理由和未知项。点“放进主题”，补上你自己的判断与下一步。</p><button type="button" class="btn-secondary-quiet" data-dot-export${disabled}>导出全部精选 JSON（${total} 条）</button></div>` : ''}
    ${visible.length ? renderReaderWorkbench(visible, { activeCandidateId, selected, view: activeView, busy }) : total ? `<div class="dot-candidates-empty dot-candidates-filter-empty"><h3>没有符合这组筛选的材料</h3><p>可以换个关键词，放宽收藏门槛，或清除筛选。原有材料仍在，不会被删除。</p><button type="button" class="btn-secondary-quiet" data-dot-filter-clear${disabled}>清除筛选，查看全部</button></div>` : `<div class="dot-candidates-empty"><h3>${activeView === 'pending' ? '还没有待筛选材料' : activeView === 'featured' ? '还没有选入精选' : '还没有略过的材料'}</h3><p>${emptyText[activeView]}</p></div>`}
    <details id="dot-candidates-intake" class="dot-candidates-intake"${intakeOpen || inbox.error || inbox.warning ? ' open' : ''}><summary><span>素材自动接收与导入说明</span><span class="dot-intake-state">${inbox.error || inbox.warning ? '接收需要处理' : inbox.connected ? '已连接 · 自动接收' : '未连接 · 可展开设置'}</span></summary><div class="dot-intake-body">${renderDotInboxPanel(inbox)}<p class="dot-candidates-local-note">也可以选择 Dot 或 feedgrab 的 JSON 文件（最大 2 MB）。手动导入文件不会上传。待筛选和我的精选保存在当前浏览器；选入精选不等于内容已实测，也不会直接发布到公开首页。</p><label class="btn-secondary-quiet dot-import-help-action" for="dot-candidates-file">选择素材文件</label></div></details>
  </section>`;
}

export function bindDotInboxEvents(root, { onInboxConnect, onInboxSync, onInboxDisconnect, onInboxShowNew } = {}) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const controls = selector => Array.from(root.querySelectorAll(selector));
  for (const form of controls('#dot-inbox-connect-form')) form.addEventListener('submit', event => {
    event.preventDefault();
    const input = form.querySelector('#dot-inbox-code'), button = form.querySelector('[type="submit"]');
    if (!input || input.disabled || button?.disabled) return;
    const code = input.value.trim(); input.value = '';
    // Enter submits without moving focus by default. Leave the cleared secret
    // input so the connection status can be safely replaced in either path.
    if (button?.focus) button.focus({preventScroll:true});
    else input.blur?.();
    if (code) onInboxConnect?.(code);
  });
  for (const [selector, callback] of [['[data-dot-inbox-sync]',onInboxSync],['[data-dot-inbox-disconnect]',onInboxDisconnect],['[data-dot-inbox-show-new]',onInboxShowNew]]) {
    for (const button of controls(selector)) button.addEventListener('click', () => { if (!button.disabled) callback?.(); });
  }
}

const readerFitRoots = new WeakSet();
// The page header can vary with status and filters. Fit the two reading panes
// to their actual document position, preserving the fixed review actions.
function fitReaderToViewport(root) {
  const layout=root?.querySelector?.('.dot-reader-layout');
  if(!layout?.style?.setProperty || typeof layout.getBoundingClientRect!=='function') return;
  const view=layout.ownerDocument?.defaultView || globalThis.window;
  const documentTop=Math.max(0,layout.getBoundingClientRect().top+(view?.scrollY || 0));
  layout.style.setProperty('--dot-reader-top',`${Math.ceil(documentTop)}px`);
}

export function bindDotCandidatesEvents(root, { onFile, onView, onSelect, onSelectAll, onSetStatus, onExport, onFilters, onIntakeToggle, onOpenCandidate, onCloseCandidate, onReviewDecision, ...inboxCallbacks } = {}) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const controls = selector => Array.from(root.querySelectorAll(selector));
  const ids = selector => controls(selector).map(control => control.dataset.dotSelect).filter(Boolean);
  fitReaderToViewport(root);
  for(const details of controls('.dot-filter-advanced')) details.addEventListener('toggle',()=>fitReaderToViewport(root));
  if(typeof root.querySelector==='function' && globalThis.window?.addEventListener && !readerFitRoots.has(root)) {
    readerFitRoots.add(root);globalThis.window.addEventListener('resize',()=>fitReaderToViewport(root));
  }
  bindDotInboxEvents(root, inboxCallbacks);
  bindReviewQueueEvents(root, {onReviewDecision});
  for (const details of controls('#dot-candidates-intake')) details.addEventListener('toggle',()=>onIntakeToggle?.(Boolean(details.open)));
  bindDotInboxFeedbackEvents(root,{onIntakeOpen:()=>{
    const details=controls('#dot-candidates-intake')[0];
    if (details) { details.open=true;onIntakeToggle?.(true);details.scrollIntoView?.({behavior:'smooth',block:'start'});details.querySelector('summary')?.focus?.({preventScroll:true}); }
  }});
  for (const form of controls('#dot-filter-form')) form.addEventListener('submit',event=>{
    event.preventDefault();
    const submit=form.querySelector('[type="submit"]');
    if (submit?.disabled) return;
    const read=name=>form.querySelector(`[name="${name}"]`)?.value;
    onFilters?.(normalizeDotFilters({query:read('query'),category:read('category'),collector:read('collector'),sort:read('sort'),minBookmarks:read('minBookmarks')}));
  });
  for (const button of controls('[data-dot-filter-clear]')) button.addEventListener('click',()=>{
    if (!button.disabled) onFilters?.(normalizeDotFilters());
  });
  for (const input of controls('#dot-candidates-file')) input.addEventListener('change', () => {
    if (input.disabled) return;
    const file = input.files?.[0];
    input.value = '';
    if (file) onFile?.(file);
  });
  for (const button of controls('[data-dot-open]')) button.addEventListener('click', () => {
    if (!button.disabled && typeof button.dataset.dotOpen === 'string' && button.dataset.dotOpen) onOpenCandidate?.(button.dataset.dotOpen);
  });
  for (const button of controls('[data-dot-close]')) button.addEventListener('click', () => {
    if (!button.disabled) onCloseCandidate?.();
  });
  for (const button of controls('[data-dot-view]')) button.addEventListener('click', () => {
    if (!button.disabled && Object.hasOwn(VIEW_LABELS, button.dataset.dotView)) onView?.(button.dataset.dotView);
  });
  for (const input of controls('[data-dot-select]')) input.addEventListener('change', () => {
    if (!input.disabled) onSelect?.(input.dataset.dotSelect, input.checked);
  });
  for (const input of controls('[data-dot-select-all]')) {
    const checkboxes = controls('[data-dot-select]');
    const chosen = checkboxes.filter(checkbox => checkbox.checked).length;
    input.indeterminate = chosen > 0 && chosen < checkboxes.length;
    input.addEventListener('change', () => { if (!input.disabled) onSelectAll?.(ids('[data-dot-select]'), input.checked); });
  }
  for (const button of controls('[data-dot-status]')) button.addEventListener('click', () => {
    if (!button.disabled && button.dataset.dotId && Object.hasOwn(VIEW_LABELS, button.dataset.dotStatus)) onSetStatus?.([button.dataset.dotId], button.dataset.dotStatus);
  });
  for (const button of controls('[data-dot-bulk-status]')) button.addEventListener('click', () => {
    const selected = controls('[data-dot-select]').filter(input => input.checked).map(input => input.dataset.dotSelect).filter(Boolean);
    if (!button.disabled && selected.length && Object.hasOwn(VIEW_LABELS, button.dataset.dotBulkStatus)) onSetStatus?.(selected, button.dataset.dotBulkStatus);
  });
  for (const button of controls('[data-dot-export]')) button.addEventListener('click', () => {
    if (!button.disabled) onExport?.(controls('[data-dot-candidate]').map(card => card.dataset.dotCandidate).filter(Boolean));
  });
}
import { DOT_FILTER_SORTS, normalizeDotFilters, hasDotFilters, filterDotCandidates } from './dotCandidateFilters.js';

