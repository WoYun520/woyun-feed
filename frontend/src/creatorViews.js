import { feedAdapter } from './dataAdapter.js';
import { openTopicDialog } from './topicViews.js';
import { creatorGuideFor, creatorGuideSearchText } from './creatorGuides.js';

const normalized = value => String(value || '').normalize('NFKC').toLocaleLowerCase('zh-CN');
const handleKey = value => normalized(value).replace(/^@/, '');
const catalogFor = state => Array.isArray(state.creatorCatalog) ? state.creatorCatalog : [];
const entriesFor = state => Array.isArray(state.creatorTutorials) ? state.creatorTutorials : [];
const candidatesFor = state => Array.isArray(state.creatorCandidates) ? state.creatorCandidates : [];
const allEntriesFor = state => {
  const tutorials = Array.isArray(state.creatorAllTutorials) ? state.creatorAllTutorials : entriesFor(state);
  const seen = new Set();
  return [...tutorials,...candidatesFor(state)].filter(entry => {
    const key = entry.item?.canonical_url || entry.item?.original_url || entry.item?.id;
    if (seen.has(key)) return false;
    seen.add(key);return true;
  });
};
const enabled = (creator, state) => state.creatorPreferences?.[creator.id]?.enabled ?? creator.enabled_by_default ?? true;
const creatorHandle = creator => String(creator.handle || '').replace(/^@/, '');
const creatorName = creator => creator.name || (creatorHandle(creator) ? `@${creatorHandle(creator)}` : '作者');
const profileLabel = creator => creator.profile_label || (creatorHandle(creator) ? `@${creatorHandle(creator)}` : '作者主页');
const labels = {tutorial:'操作教程', method:'方法线索', project:'项目示例', repository:'项目示例', retrospective:'经验复盘', guide:'操作教程'};

function readingScope(entry) {
  // Selection labels must never silently turn an excerpt into a verified tutorial.
  const scope = typeof entry.scope === 'string' ? entry.scope : '';
  if (entry.item?.read_scope==='author-blog-feed') return '作者博客订阅摘录；按订阅提供的操作线索初筛，未核对原文全文或实测。';
  if (/第三方|摘录|excerpt/i.test(scope) || entry.item?.link_kind === 'post') return '第三方推文摘录，未核对完整原帖或实测。';
  if (/作者说明|readme|author[_ -]?(?:material|guide|read)/i.test(scope)) return '已阅读作者说明，未实测。';
  return scope ? `${scope}${/未实测/.test(scope) ? '' : '；未实测。'}` : '按已提供的材料整理，未核对全文或实测。';
}

function sourcesFor(creator, state) {
  const key = handleKey(creator.handle);
  const matches = source => source.creator_id
    ? source.creator_id === creator.id
    : !!creator.source_id && (source.id === creator.source_id || source.source_id === creator.source_id)
      || !!key && handleKey(source.creator_handle) === key;
  const sources=(state.sources || []).filter(matches);
  for (const id of [creator.source_id,...(key ? [`sopilot-author-${key}`,`creator-blog-${key}`] : [])].filter(Boolean)) {
    const source=state.sourceMap?.get(id);
    if (source && matches(source) && !sources.some(existing=>existing.id===source.id)) sources.push(source);
  }
  return sources;
}

function sourceStates(creator, state) {
  const sources=sourcesFor(creator,state);
  if (!sources.length) return [allEntriesFor(state).some(entry => entry.creator.id === creator.id)
    ? {label:'固定说明样本', detail:'目前展示已整理的作者说明；尚未读取这位作者的完整动态。'}
    : {label:'候选待补材料', detail:'尚未取得可展示的实用材料；入库不会自动生成教程。'}];
  return sources.map(source=>{
    const blog=source.creator_scope==='blog-feed' || String(source.id || '').startsWith('creator-blog-');
    const format = blog && ['rss','atom'].includes(source.format) ? `订阅格式：${source.format === 'atom' ? 'Atom' : 'RSS'}。` : '';
    const range=(blog ? '最近最多30篇，按原文时间；不按热度，只保留操作线索。' : '近 7 天热门帖，最多 10 条；不是完整动态，会漏掉低热度教程。')+format;
    const title=blog ? '作者博客订阅' : '公开热门帖';
    if (source.status==='failed') return {label:title+' · 更新失败',detail:(source.last_success_at
      ? '保留上次成功获取的内容；这次没有读到新材料。已收录线索不代表本次更新成功。' : '本次尚未成功获取新材料；已有旧材料仍保留，收录不代表本次更新成功。')+range,source};
    if (source.status==='not_connected') return {label:title+' · 等待首次读取',detail:'还没有成功获取这份来源。'+range,source};
    if (source.status==='partial') return {label:title+' · 部分更新',detail:'仅取得部分公开材料。'+range,source};
    return {label:title,detail:range,source};
  });
}

function selectedEntries(app, state, candidates = false) {
  const query = normalized(app.creatorQuery).trim().split(/\s+/u).filter(Boolean);
  const filter = app.creatorAuthorFilter || 'all';
  return (candidates ? candidatesFor(state) : entriesFor(state)).filter(entry => enabled(entry.creator, state)
    && (filter === 'all' || entry.creator.id === filter)
    && query.every(token => normalized([entry.item?.title, entry.item?.summary, entry.purpose, entry.reason,
      creatorName(entry.creator), entry.creator.handle, creatorGuideSearchText(entry.guide)].join(' ')).includes(token)));
}

function time(app, value, label) {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  return `<span>${label} <time datetime="${app.escapeHtml(value)}">${app.escapeHtml(app.formatTime(value))}</time></span>`;
}

function publicationDate(app, value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '<span>原文发布时间未知</span>';
  // The site's short relative time formatter can omit the year. Candidates
  // always show it, so a newly collected old article cannot look newly written.
  const date = new Date(value).toISOString().slice(0,10);
  return `<span>原文发布 <time datetime="${app.escapeHtml(value)}">${app.escapeHtml(date)}</time></span>`;
}

function guideFor(entry) {
  const guide = entry.guide && typeof entry.guide === 'object' && !Array.isArray(entry.guide) ? entry.guide : {};
  // Only the exact material's bundled note can attach a local trial. Display
  // metadata supplied by a caller cannot lend another material a trial record.
  const known = creatorGuideFor(entry.item);
  const text = value => typeof value === 'string' ? value.trim() : '';
  const purpose = text(guide.purpose) || text(entry.purpose);
  // A source title alone does not explain what someone can do with the material.
  const repeatsTitle = [entry.item?.title, entry.item?.display_title].some(title => title
    && [title, String(title).slice(0,200)].some(value => normalized(value).trim() === normalized(purpose).trim()));
  return {
    purpose: purpose && !repeatsTitle ? purpose : '用途待整理，先查看原文',
    audience: text(guide.audience) || '适用人群未知',
    requirements: text(guide.requirements) || '所需工具、账号或环境未知',
    first_step: text(guide.first_step) || '第一步未知，请先查看原文',
    cost: text(guide.cost) || '费用与使用条件未知',
    basis_label: text(guide.basis_label) || '查看整理依据',
    basis_url: text(guide.basis_url),
    read_at: text(guide.read_at),
    scope: text(guide.scope),
    trial_url: text(known?.trial_url),
    trial_label: text(known?.trial_label)
  };
}

function tutorialCard(app, state, entry, candidate = false) {
  const e = value => app.escapeHtml(value ?? ''), item = entry.item, id = e(item.id);
  const guide = guideFor(entry);
  const saved = !!state.savedItemIds?.has(item.id), archived = !!state.archivedItemIds?.has(item.id);
  const title = item.title || item.display_title || '作者材料';
  const inTopic = (state.topics || []).some(topic => (topic.materials || []).some(material => material.item?.id === item.id
    || item.alias_ids?.includes(material.item?.id) || (item.canonical_url && material.item?.canonical_url === item.canonical_url)));
  const saveLabel = archived ? '恢复收藏' : saved ? '取消收藏' : '收藏';
  const scope = candidate ? '作者博客订阅摘录；自动按订阅提供的操作线索初筛，未核对原文全文或实测。' : readingScope(entry), excerpt = scope.includes('摘录'),blog=item.read_scope==='author-blog-feed';
  const materialReadAt = excerpt ? item.captured_at || entry.checkedAt : entry.checkedAt || item.captured_at;
  const trialUrl = !candidate && guide.trial_url ? app.safeUrl(guide.trial_url) : '';
  const failedCandidateSource = candidate && sourcesFor(entry.creator,state).some(source => source.status === 'failed'
    && (item.source_refs || []).includes(source.id || source.source_id));
  return `<article class="creator-tutorial-card${candidate ? ' creator-candidate-card' : ''}" id="creator-material-${id}" data-creator-material-id="${id}" data-item-id="${id}">
    <div class="creator-tutorial-meta"><span class="creator-material-kind">${e(labels[entry.kind] || '实用材料')}</span><span>${e(creatorName(entry.creator))} · ${e(blog ? '作者博客' : profileLabel(entry.creator))}</span></div>
    ${candidate ? `<p class="creator-candidate-badge${entry.candidateNew === true ? ' is-new' : ''}">${entry.candidateNew === true ? '最近一次更新新收录' : '已收录线索'}</p><h3>${e(title)}</h3><p class="creator-candidate-purpose"><span>中文用途线索</span>${e(guide.purpose)}</p><p class="creator-candidate-preparation"><span>准备条件</span>${e(guide.requirements)}</p><div class="creator-material-times creator-candidate-times">${publicationDate(app,item.published_at)}${time(app,item.captured_at,'取得摘录') || '<span>取得摘录时间未知</span>'}</div><p class="creator-candidate-original"><a class="creator-original-link" id="creator-original-${id}" href="${e(app.safeUrl(item.original_url))}" target="_blank" rel="noopener noreferrer">读原文 <span aria-hidden="true">↗</span></a></p>` : `<p class="creator-tutorial-purpose-label">能做什么</p><h3>${e(guide.purpose)}</h3>`}
    <p class="creator-tutorial-audience"><span>适合谁</span>${e(guide.audience)}</p>
    <details class="creator-preparation-details"><summary>开始前看一下</summary><dl class="creator-preparation-list"><div><dt>需要什么</dt><dd>${e(guide.requirements)}</dd></div><div><dt>第一步</dt><dd>${e(guide.first_step)}</dd></div><div><dt>费用与条件</dt><dd>${e(guide.cost)}</dd></div></dl></details>
    ${trialUrl && trialUrl !== '#' ? `<p class="creator-guide-trial"><a href="${e(trialUrl)}" target="_blank" rel="noopener noreferrer">${e(guide.trial_label || '查看本站截图实测（合成素材）')} <span aria-hidden="true">↗</span></a></p>` : ''}
    ${failedCandidateSource ? '<p class="creator-material-warning">来源本次更新失败；这条是已收录的旧线索，不代表本次读到新材料。</p>' : ''}
    <details class="creator-material-details"><summary>${excerpt ? '查看已取得的摘录与依据' : '查看整理说明与依据'}</summary>
      ${!candidate ? `<p class="creator-material-original"><a id="creator-original-${id}" href="${e(app.safeUrl(item.original_url))}" target="_blank" rel="noopener noreferrer">${e(title)} <span aria-hidden="true">↗</span></a></p>` : '<p class="creator-guide-basis">来源：作者博客订阅提供的标题与摘要。中文用途线索与准备提示按摘录整理，仍需读原文确认。</p>'}
      ${!candidate && guide.basis_url ? `<p class="creator-guide-basis">整理依据：<a href="${e(app.safeUrl(guide.basis_url))}" target="_blank" rel="noopener noreferrer">${e(guide.basis_label)} <span aria-hidden="true">↗</span></a></p>` : ''}
      <p class="creator-material-summary">${e(item.summary || '暂无正文摘录，请打开原文查看。')}</p>${entry.truncated ? `<p class="creator-material-warning">摘录已截短，操作步骤可能不完整；请到${blog ? '原文' : '原帖'}查看全文。</p>` : ''}
      ${entry.reason ? `<p class="creator-tutorial-reason"><span>收录理由</span>${e(entry.reason)}</p>` : ''}
      <p class="creator-material-scope">${e(scope)}</p>${!candidate && guide.scope ? `<p class="creator-guide-scope">整理依据范围：${e(guide.scope)}</p>` : ''}
      ${!candidate ? `<div class="creator-material-times">${time(app,item.published_at,'原文发布') || (blog ? '<span>原文发布时间未知</span>' : '')}${time(app,materialReadAt,excerpt ? '取得摘录' : '说明阅读') || (blog ? '<span>取得摘录时间未知</span>' : '')}${time(app,guide.read_at,'整理依据阅读')}</div>` : ''}
    </details>
    <div class="creator-material-actions"><button type="button" class="btn-secondary-quiet ${saved && !archived ? 'is-collected' : ''}" id="creator-save-${id}" data-creator-save="${id}" data-creator-save-mode="${archived ? 'restore' : 'toggle'}" aria-pressed="${saved && !archived}" aria-label="${e(saveLabel)}：${e(guide.purpose)}">${saveLabel}</button><button type="button" class="btn-quiet" id="creator-topic-${id}" data-creator-topic="${id}">放进主题</button>${inTopic ? '<span>已在主题</span>' : ''}</div>
  </article>`;
}

function renderTutorials(app, state, candidates = false) {
  const e = value => app.escapeHtml(value ?? ''), catalog = catalogFor(state), entries = selectedEntries(app, state,candidates);
  const active = catalog.filter(creator => enabled(creator, state));
  const limit = Math.max(24, Number(app.creatorTutorialLimit) || 24), shown = entries.slice(0, limit);
  const filtered = !!String(app.creatorQuery || '').trim() || (app.creatorAuthorFilter && app.creatorAuthorFilter !== 'all');
  const candidateCount = candidatesFor(state).filter(entry => enabled(entry.creator,state)).length;
  return `<section class="creator-tutorials${candidates ? ' creator-candidates' : ''}" aria-label="${candidates ? '新教程候选' : '实用教程材料'}">
    ${candidates ? '<div class="creator-candidates-intro"><h3>新教程候选</h3><p>自动按作者订阅的标题与摘录初筛，未阅读全文或实测。先看能做什么，再打开原文核对步骤。</p><p>“新收录”表示最近一次更新首次取得，旧文章这次收录不等于刚发布。优先显示本轮新收录，再按实际取得摘录时间排列。</p></div>' : `<p class="creator-candidates-entry"><button type="button" class="btn-quiet" data-creator-view="candidates">查看新教程候选 · ${candidateCount} 条 <span aria-hidden="true">→</span></button></p>`}
    <form class="creator-search" id="creator-search-form"><div class="creator-search-field"><label for="creator-search">找你想做的事</label><input type="search" id="creator-search" maxlength="200" value="${e(app.creatorQuery || '')}" placeholder="截图、做网站、整理素材…" aria-describedby="creator-search-help"></div><div class="creator-author-field"><label for="creator-author-filter">${candidates ? '按作者查看' : '按博主查看'}</label><select id="creator-author-filter"><option value="all" ${!app.creatorAuthorFilter || app.creatorAuthorFilter === 'all' ? 'selected' : ''}>${candidates ? '全部已启用作者' : '全部已启用博主'}</option>${active.map(creator => `<option value="${e(creator.id)}" ${app.creatorAuthorFilter === creator.id ? 'selected' : ''}>${e(creatorName(creator))}</option>`).join('')}</select></div><button type="submit" class="btn-secondary-quiet">查找</button>${filtered ? '<button type="button" class="btn-quiet" id="creator-clear-search">清空筛选</button>' : ''}</form>
    <p class="creator-search-help" id="creator-search-help">按用途、适合谁、准备条件与已有标题查找，不要求包含“AI”；多个词需同时匹配。不搜索原帖全文。</p>
    <div class="creator-results-heading"><p role="status">${entries.length} 条${candidates ? '候选' : '材料'} · ${active.length} 位已启用${candidates ? '作者' : '博主'}${shown.length < entries.length ? ` · 当前显示 ${shown.length} 条` : ''}</p><p>${candidates ? '相同原文已合并；收藏后可补想法、放进主题。' : '看用途，再打开依据读原文。收藏后可补想法、放进主题。'}</p></div>
    ${shown.length ? `<div class="creator-tutorial-grid">${shown.map(entry => tutorialCard(app,state,entry,candidates)).join('')}</div>${entries.length > shown.length ? `<button type="button" class="btn-secondary-quiet creator-more" id="creator-more">再看 ${Math.min(24,entries.length-shown.length)} 条</button>` : ''}`
      : candidates ? `<div class="creator-empty"><h3>${filtered ? '没有找到匹配候选' : '暂时没有合格的新教程线索'}</h3><p>${filtered ? '试试换一个用途，或清空筛选。' : '当前已启用来源还没有可展示的操作线索。可以先看已整理教程，或在博主库查看来源状态。'}</p><div class="creator-empty-actions">${filtered ? '<button type="button" class="btn-secondary-quiet" data-creator-view="candidates" data-creator-reset="true">清空筛选</button>' : ''}<button type="button" class="btn-secondary-quiet" data-creator-view="tutorials" data-creator-reset="true">查看教程</button><button type="button" class="btn-quiet" data-creator-view="authors">查看博主库</button></div></div>`
      : `<div class="creator-empty"><h3>${filtered ? '没有找到匹配材料' : active.length ? '暂时没有符合条件的教程' : '还没有启用的博主'}</h3><p>${filtered ? '试试换一个用途，或清空筛选。' : active.length ? '普通动态不会自动成为教程。可以先看博主库里的作者说明样本。' : '在博主库里启用你感兴趣的人；原来的收藏和主题仍保留。'}</p><button type="button" class="btn-secondary-quiet" data-creator-view="${filtered ? 'tutorials' : 'authors'}" ${filtered ? 'data-creator-reset="true"' : ''}>${filtered ? '清空筛选' : '查看博主库'}</button></div>`}
  </section>`;
}

function authorCard(app, state, creator) {
  const e = value => app.escapeHtml(value ?? ''), id = e(creator.id), preference = state.creatorPreferences?.[creator.id] || {};
  const isEnabled = enabled(creator,state), statuses = sourceStates(creator,state);
  const count = allEntriesFor(state).filter(entry => entry.creator.id === creator.id).length;
  const examples = Array.isArray(creator.material_urls) ? creator.material_urls : [];
  const reason = typeof preference.reason === 'string' ? preference.reason : creator.reason || '';
  return `<article class="creator-author-card ${isEnabled ? '' : 'creator-is-paused'}" id="creator-author-${id}" data-creator-author-id="${id}">
    <div class="creator-author-top"><div><p class="creator-author-category">${e(creator.category_label || creator.category || '实用分享')}</p><h3>${e(creatorName(creator))}</h3><a href="${e(app.safeUrl(creator.profile_url))}" target="_blank" rel="noopener noreferrer">${e(profileLabel(creator))} ↗</a></div><button type="button" class="creator-author-toggle" id="creator-toggle-${id}" data-creator-toggle="${id}" aria-pressed="${!!isEnabled}" aria-label="${isEnabled ? '暂停显示' : '启用'}${e(creatorName(creator))}">${isEnabled ? '已启用 · 暂停' : '已暂停 · 启用'}</button></div>
    <p class="creator-author-status">${count} 条教程候选</p>
    ${statuses.map(status=>`<div class="creator-author-source"${status.source ? ` data-creator-source-id="${e(status.source.id)}"` : ''}><p class="creator-author-status ${status.source?.status === 'failed' ? 'creator-material-warning' : ''}">${e(status.label)}</p><p class="creator-author-coverage">${e(status.detail)}</p>
      ${status.source?.message && status.source.status === 'failed' ? `<details class="creator-source-error"><summary>查看来源提示</summary><p>${e(status.source.message)}</p></details>` : ''}
      ${status.source?.last_success_at ? `<p class="creator-author-read-time">${time(app,status.source.last_success_at,'最近成功获取')}</p>` : status.source ? '<p class="creator-author-read-time">最近成功获取时间未知</p>' : ''}</div>`).join('')}
    <form class="creator-author-reason-form" data-creator-reason-form="${id}"><label for="creator-reason-${id}">为什么关注他</label><textarea id="creator-reason-${id}" data-creator-reason="${id}" rows="3" maxlength="500" placeholder="例如：常分享普通人能照着做的小工具">${e(reason)}</textarea><button type="submit" class="btn-quiet">保存我的理由</button></form>
    ${examples.length ? `<details class="creator-author-examples"><summary>看看已找到的材料（${examples.length}）</summary><ul>${examples.map((example,index) => {
      const url = typeof example === 'string' ? example : example.url || example.source_url;
      const label = typeof example === 'string' ? `材料 ${index+1}` : example.title || example.label || `材料 ${index+1}`;
      return `<li><a href="${e(app.safeUrl(url))}" target="_blank" rel="noopener noreferrer">${e(label)} ↗</a></li>`;
    }).join('')}</ul><p>作者说明样本；是否实测见独立记录，有材料不等于全部动态值得推荐。</p></details>` : ''}
  </article>`;
}

function renderAuthors(app, state) {
  const catalog = catalogFor(state), count = catalog.filter(creator => enabled(creator,state)).length;
  return `<section class="creator-authors" aria-label="教程博主库"><div class="creator-authors-intro"><h3>先选人，再选内容</h3><p>目前 ${catalog.length} 位候选，已启用 ${count} 位。启用后仍逐篇初筛，只留下具体操作、项目示例和有过程的复盘。</p><p>启用、暂停和关注理由保存在此浏览器；暂停只隐藏这里的材料，不删除收藏和主题，也不停止公共来源更新。</p></div><div class="creator-author-grid">${catalog.map(creator => authorCard(app,state,creator)).join('')}</div></section>`;
}

export function renderCreatorPage(app, state) {
  const view = ['authors','candidates'].includes(app.creatorView) ? app.creatorView : 'tutorials';
  return `<section class="creator-page" id="creator-page"><div class="page-intro creator-intro"><div><h2 class="page-headline" tabindex="-1">实用教程</h2><p class="page-subtext">跟会做的人，找能照着做的事。</p></div><div class="creator-view-switch" role="group" aria-label="教程、新教程候选与博主库"><button type="button" data-creator-view="tutorials" aria-pressed="${view==='tutorials'}">教程</button><button type="button" data-creator-view="candidates" aria-pressed="${view==='candidates'}">新教程候选</button><button type="button" data-creator-view="authors" aria-pressed="${view==='authors'}">博主库</button></div></div><p class="creator-page-boundary">${view === 'candidates' ? '候选按订阅摘录自动初筛；新收录时间与原文发布时间分开显示，未核对全文或实测。' : '按已有说明初筛；只有另附实测记录的案例实际跑过。热门帖只是一部分材料，作者入库不等于所有内容都值得推荐。'}</p>${state.creatorPreferenceWarning ? '<p class="creator-material-warning" role="status">暂时无法读取博主设置；当前展示默认选择，不代表设置已保存。</p>' : ''}${view === 'authors' ? renderAuthors(app,state) : renderTutorials(app,state,view === 'candidates')}</section>`;
}

export function bindCreatorActions(app, state) {
  const root = document.getElementById('creator-page');
  if (!root || root.creatorActionsBound) return;
  root.creatorActionsBound = true;
  const on = (selector,event,callback) => root.querySelectorAll(selector).forEach(node => node.addEventListener(event,callback));
  const focus = id => document.getElementById(id)?.focus();
  const render = id => { app.render(); if (id) focus(id); };
  const savePreference = (id,patch,trigger) => {
    try {
      app.setCreatorPreference(id,patch);
      // The owning app controls persistence and refresh; focus the replacement control if it rerenders.
      if (trigger?.id) focus(trigger.id);
    } catch (error) { app.showToast?.(error.message); }
  };
  on('[data-creator-view]','click',event => {
    const button = event.currentTarget;
    app.creatorView = ['authors','candidates'].includes(button.dataset.creatorView) ? button.dataset.creatorView : 'tutorials';
    if (button.dataset.creatorReset) { app.creatorQuery=''; app.creatorAuthorFilter='all'; app.creatorTutorialLimit=24; }
    render();document.querySelector('.creator-page .page-headline')?.focus();
  });
  const search = root.querySelector('#creator-search');
  if (search) {
    search.addEventListener('input',() => { app.creatorQuery=search.value.slice(0,200); });
    search.addEventListener('change',() => { app.creatorQuery=search.value.slice(0,200); app.creatorTutorialLimit=24; render('creator-search'); });
  }
  on('#creator-search-form','submit',event => {
    event.preventDefault();app.creatorQuery=search?.value.slice(0,200) || '';app.creatorTutorialLimit=24;render('creator-search');
  });
  on('#creator-author-filter','change',event => {
    app.creatorAuthorFilter=event.currentTarget.value;app.creatorTutorialLimit=24;render('creator-author-filter');
  });
  on('#creator-clear-search','click',() => { app.creatorQuery='';app.creatorAuthorFilter='all';app.creatorTutorialLimit=24;render('creator-search'); });
  on('#creator-more','click',() => { app.creatorTutorialLimit=Math.max(24,Number(app.creatorTutorialLimit) || 24)+24;render(); });
  on('[data-creator-toggle]','click',event => {
    const button = event.currentTarget, creator = catalogFor(state).find(value => value.id === button.dataset.creatorToggle);
    if (creator) savePreference(creator.id,{enabled:!enabled(creator,state)},button);
  });
  on('[data-creator-reason-form]','submit',event => {
    event.preventDefault();const form = event.currentTarget,id = form.dataset.creatorReasonForm;
    const field = form.querySelector('[data-creator-reason]');
    savePreference(id,{reason:(field?.value || '').slice(0,500)},field);
  });
  on('[data-creator-save]','click',event => {
    const button = event.currentTarget,id = button.dataset.creatorSave;
    try {
      if (button.dataset.creatorSaveMode === 'restore') feedAdapter.setArchived(id,false);
      else feedAdapter.setSaved(id,!feedAdapter.getState().savedItemIds.has(id));
      app.showToast?.(button.dataset.creatorSaveMode === 'restore' ? '已恢复到收藏。' : state.savedItemIds?.has(id) ? '已取消收藏，主题里的材料保留。' : '已收藏，可以在收藏页补想法。');
      focus(button.id);
    } catch (error) { app.showToast?.(`未保存：${error.message}`); }
  });
  on('[data-creator-topic]','click',event => {
    const button = event.currentTarget;
    openTopicDialog(app,'collect',{itemId:button.dataset.creatorTopic},button);
  });
}
