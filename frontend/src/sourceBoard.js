import { renderMaterialReview } from './materialReview.js';
import { SOURCE_GROUPS } from './sourceGroups.js';
import { repositoryPresentation } from './repositoryGuide.js';
import { postAuthorLabel } from './topicWorkspace.js';
import { normalizeSourcePreferences, readSourcePreferences, writeSourcePreferences, orderVisibleSources, sourcePreferenceKey } from './sourcePreferences.js';
import { renderEditorialFeatured, renderEditorialRecommendations } from './editorialHome.js';
import { renderFeedSearchControls, renderFeedSearchResults, selectHomeSearch, bindFeedSearchActions } from './feedSearchView.js';
import { PRACTICAL_SOURCE, practicalMaterialKind } from './practicalMaterials.js';
import { feedLoadMessage } from './feedLoadingView.js';
import { sourceIcon } from './sourceIcons.js';
import { renderPostStream, bindPostStreamActions } from './postStreamView.js';
import { creatorPreferenceKey, readCreatorPreferences } from './creatorTutorials.js';
import { CREATOR_CATALOG } from './creatorCatalog.js';

// The overview shows five entries per source; pagination still reaches every stored item.
export const BOARD_PAGE_SIZE = 5;
export const POST_PAGE_SIZE = 5;
const pageSize = source => source?.link_kind === 'post' ? POST_PAGE_SIZE : BOARD_PAGE_SIZE;

// Publication time is not a successful source read; failed attempts never advance this label.
export function feedUpdateInfo(state) {
  const readableSources=(state.sources || []).filter(source=>source.kind!=='curated');
  const times = readableSources.map(source => source.last_success_at)
    .filter(time => typeof time === 'string' && Number.isFinite(Date.parse(time)));
  const lastSuccess = times.sort((a,b) => Date.parse(b) - Date.parse(a))[0]
    || ((readableSources.length || !(state.sources || []).length) && Number.isFinite(Date.parse(state.generated_at)) ? state.generated_at : null);
  const automatic = state.publicPreview && state.publication?.automatic_update === true;
  return { lastSuccess, automatic,
    schedule: automatic ? state.publication.schedule_label || '云端定时更新' : '',
    notice: ['cached','loading','error'].includes(state.loadStatus?.phase) ? feedLoadMessage(state) : state.update_notice || state.refresh?.message || (state.publicPreview ? '查看更新，读取最近发布的内容。' : '点击更新，获取各来源的公开标题。'),
  };
}

// A connection check and a source's historical result are distinct states.
// Both full rendering and deferred status patches use this same visible notice.
export function boardUpdateMessage(state, {refreshError='', deferred=false}={}) {
  if (refreshError) return {message:refreshError,failed:true};
  const phase=state.loadStatus?.phase;
  if (['cached','loading','error'].includes(phase) || (deferred && phase==='ready')) {
    return {message:feedLoadMessage(state,{deferred}),failed:phase==='error'};
  }
  const failedSources=(state.sources || []).filter(source=>source.status==='failed').length;
  if (failedSources) return {message:`${failedSources} 个来源最近一次未更新，旧内容仍可阅读；原因和上次成功时间见“更新详情”。`,failed:true};
  if (['failed','partial'].includes(state.refresh?.status)) return {message:feedUpdateInfo(state).notice,failed:true};
  return {message:'',failed:false};
}

export function sourceStatusLabel(source, count, onlyNew = false) {
  if (source.id===PRACTICAL_SOURCE.id && source.kind==='curated') return `${count} 条实用材料${onlyNew ? ' · 最近一次新增' : ''}`;
  if (source.status === 'not_connected' && (source.disabled || source.enabled === false)) return '尚未接通';
  if (source.status === 'failed') return count ? `${count} 条旧内容 · 本次未更新` : '暂时无法获取';
  if (source.status === 'not_connected') return '尚未读到内容';
  if (source.status === 'partial') return `${count} 条内容 · 部分更新`;
  return `${count} 条${onlyNew ? '最近一次新增' : '内容'}`;
}

export function renderSourceHealth(app,state) {
  const failed=(state.sources || []).filter(source=>source.status==='failed' && source.kind!=='curated');
  if (!failed.length) return '';
  const e=value=>app.escapeHtml(value),time=value=>value && Number.isFinite(Date.parse(value)) ? app.formatTime(value) : '未记录';
  const reason=source=>{
    const code=String(source.read_error || '');
    if (code==='source_format') return '原站没有返回可用的订阅格式';
    if (/AbortError|TimeoutError/.test(code)) return '这次读取超过等待时间';
    if (/404/.test(code)) return '原站订阅地址这次不可用';
    if (/401|403|412|419|429/.test(code)) return '原站暂时限制读取';
    if (/5\d\d/.test(code)) return '原站这次返回错误';
    if (code==='channel_mismatch') return '视频订阅身份不匹配，未采用';
    return '这次没有读到可用资料';
  };
  return `<section class="source-health" aria-label="未更新来源详情"><h4>本次未更新的 ${failed.length} 个来源</h4><p>保留上次成功获取的内容。连续次数从本版开始记录，不补算过去的失败。</p><ul>${failed.map(source=>{
    const count=(state.allItems || []).filter(item=>item.source_refs?.includes(source.id)).length;
    const streak=Number.isSafeInteger(source.consecutive_failures) && source.consecutive_failures>0 ? `连续 ${source.consecutive_failures} 次未更新` : '连续次数尚未记录';
    return `<li><strong>${e(source.name || source.id)}</strong><span>${e(reason(source))} · ${e(streak)}</span><span>${count ? `${count} 条旧内容仍可阅读` : '尚无已保存内容'} · 上次成功：${e(time(source.last_success_at))}</span><small>最近尝试：${e(time(source.last_attempt_at))}</small></li>`;
  }).join('')}</ul></section>`;
}

// One merged item can appear in several panels, using each source's own link and rank.
export function sourceRows(state, source, onlyNew = false) {
  const hidden = state.hiddenItemIds || new Set();
  const newIds = new Set(state.refresh?.new_item_ids || []);
  const stamp = item => item.updated_at || item.published_at || item.captured_at || '';
  return state.allItems.filter(item => item.source_refs.includes(source.id)
    && !hidden.has(item.id) && !(item.alias_ids || []).some(id => hidden.has(id))
    && (!onlyNew || newIds.has(item.id)))
    .map(item => {
      const link = item.source_links?.find(link => link.source_id === source.id);
      const soleSource = item.source_refs.length === 1;
      const rank = link?.source_rank ?? (soleSource ? item.source_rank : null);
      return {item, url: link?.url || item.original_url || source.home_url,
        rank: Number.isInteger(rank) && rank > 0 ? rank : null,
        heat: link?.heat_label || (soleSource ? item.heat_label : '') || '',
        kind: source.link_kind || (source.kind === 'repository' ? 'repository' : soleSource ? item.link_kind : '') || 'article'};
    }).sort((a,b) => (source.ranked ? (a.rank ?? Infinity) - (b.rank ?? Infinity) : 0)
      || stamp(b.item).localeCompare(stamp(a.item)) || a.item.id.localeCompare(b.item.id));
}

const linkLabels = {article:'原文', repository:'项目', discussion:'讨论', search:'热搜', topic:'话题',video:'视频',post:'原帖'};
const marker = source => source.id.startsWith('youtube-') ? 'YT' : source.id.startsWith('sopilot-') ? 'SP' : ({github:'GH', 'github-trending':'GH', sspai:'少', ithome:'IT', solidot:'S',
  producthunt:'P', 'v2ex-share':'V', juejin:'掘', hackernews:'Y', zhihu:'知',
  thepaper:'澎', toutiao:'头', baidu:'百', 'wallstreetcn-hot':'见',x:'X'})[source.id] || source.name.slice(0,1);

function preferenceStorage() {
  try {return globalThis.localStorage;} catch {return undefined;}
}

function applySourcePreferences(app,state) {
  const loaded=readSourcePreferences(preferenceStorage(),state.sources,state.mode);
  app.sourcePreferences=loaded.preferences;
  app.sourcePreferenceKey=loaded.key;app.sourcePreferenceRaw=loaded.raw;
  app.sourcePreferenceReadable=loaded.readable;app.sourcePreferenceNotice=loaded.notice;
}

function sourceManager(app,state,groups) {
  if (!app.sourceManagerOpen) return '';
  const e=value=>app.escapeHtml(value),draft=normalizeSourcePreferences(app.sourcePreferenceDraft,state.sources);
  const hidden=new Set(draft.hidden_source_ids),pinned=new Set(draft.pinned_source_ids);
  return `<section class="source-manager" aria-labelledby="source-manager-heading"><form id="source-manager-form">
    <div class="source-manager-heading"><div><h3 id="source-manager-heading">管理首页来源</h3><p>选择首页显示哪些来源，常看的可以置顶。保存在此浏览器；不改变收藏和主题。</p></div><button type="button" class="btn-secondary-quiet" id="source-manager-show-all">显示全部来源</button></div>
    <div class="source-manager-groups">${groups.map(group=>`<fieldset><legend>${e(group.name)}</legend>${state.sources.filter(source=>(source.group || 'other')===group.id).map(source=>`<div class="source-manager-row"><label class="source-visibility-label"><input type="checkbox" id="source-visible-${e(source.id)}" data-source-visibility="${e(source.id)}" ${hidden.has(source.id) ? '' : 'checked'}><span>${e(source.name)}</span></label><label class="source-pin-label"><input type="checkbox" id="source-pin-${e(source.id)}" data-source-pin="${e(source.id)}" ${pinned.has(source.id) ? 'checked' : ''} ${hidden.has(source.id) ? 'disabled' : ''} aria-label="置顶${e(source.name)}"><span>置顶</span></label></div>`).join('')}</fieldset>`).join('')}</div>
    ${app.sourcePreferenceNotice ? `<p class="source-preference-warning" role="status">${e(app.sourcePreferenceNotice)}</p>` : ''}
    <p class="source-preference-warning" id="source-preference-error" role="alert" tabindex="-1" ${app.sourcePreferenceError ? '' : 'hidden'}>${e(app.sourcePreferenceError || '')}</p>
    <div class="source-manager-actions"><p>尚未保存的选择可以取消。按 Esc 也可取消。</p><button type="button" class="btn-secondary-quiet" id="source-manager-cancel">取消</button><button type="submit" class="btn-primary-action">保存设置</button></div>
  </form></section>`;
}

function saveSourcePreferences(app,state,next) {
  try {
    const saved=writeSourcePreferences(preferenceStorage(),next,state.sources,{mode:state.mode,expectedRaw:app.sourcePreferenceRaw,readable:app.sourcePreferenceReadable});
    app.sourcePreferences=saved.preferences;app.sourcePreferenceRaw=saved.raw;
    app.sourcePreferenceReadable=true;app.sourcePreferenceNotice='';app.sourcePreferenceError='';
    app.sourceManagerOpen=false;app.sourcePreferenceDraft=null;app.render();
    document.getElementById('source-manager-open')?.focus();
    app.showToast?.('来源设置已保存在此浏览器。');
  } catch(error) {
    app.sourceManagerOpen=true;app.sourcePreferenceDraft=structuredClone(next);app.sourcePreferenceError=error.message;
    app.render();document.getElementById('source-preference-error')?.focus();
  }
}

function renderExcerpt(app,item,source,kind) {
  const practical=practicalMaterialKind(item);
  if ((!practical && item.origin==='user_added') || item.content_status==='headline_only' || typeof item.summary!=='string') return '';
  const text=item.summary.trim(),plain=text.replace(/\s+/g,' ');
  if (!plain || plain===String(item.title || '').trim().replace(/\s+/g,' ')) return '';
  const e=value=>app.escapeHtml(value),key=`${source.id}:${item.id}`;
  const characters=Array.from(plain),hasMore=!practical && (characters.length>80 || text!==plain);
  const short=practical ? text : characters.slice(0,80).join('')+(characters.length>80 ? '…' : '');
  const fullOpen=hasMore && app.openFullExcerpts?.has(key);
  const label=practical ? '整理说明' : kind==='video' ? '视频简介' : kind==='post' ? '推文摘录' : kind==='article' ? '文章摘要' : '来源摘录';
  const boundary=practical ? 'AI 按官方说明整理，未实测。中文标题与说明由本站整理。' : kind==='video' ? '来源提供的视频简介，未观看视频或读取字幕。'
    : kind==='post' ? source.id.startsWith('sopilot-') ? 'SoPilot 提供的摘录，未读取完整原帖，未核对原帖、作者身份或热度。' : '来源提供的推文摘录，未读取完整原帖或核对内容。'
      : '来源提供的摘要，本站未读取全文。';
  return `<details class="headline-preview" data-excerpt-details="${e(key)}" ${app.openExcerptDetails?.has(key) ? 'open' : ''}>
    <summary>看摘录 <span>· ${label}</span></summary>
    <p class="headline-preview-text ${hasMore ? 'is-shortened' : ''}" ${fullOpen ? 'hidden' : ''}>${e(short)}</p>
    ${hasMore ? `<details class="headline-preview-full" data-excerpt-full="${e(key)}" ${fullOpen ? 'open' : ''}><summary><span class="excerpt-show-all">展开全部摘录</span><span class="excerpt-show-less">收起长摘录</span></summary><p class="headline-preview-text">${e(text)}</p></details>` : ''}
    <p class="headline-preview-boundary">${boundary}</p>
  </details>`;
}

function renderPanel(app, state, source) {
  const e = value => app.escapeHtml(value);
  const availableRows = sourceRows(state, source);
  const practicalSource=source.id===PRACTICAL_SOURCE.id && source.kind==='curated';
  const readingTime=practicalSource ? availableRows.filter(row=>practicalMaterialKind(row.item)).map(row=>row.item.captured_at)
    .filter(value=>typeof value==='string' && Number.isFinite(Date.parse(value))).sort((a,b)=>Date.parse(b)-Date.parse(a))[0] : null;
  const rows = app.onlyNew ? sourceRows(state, source, true) : availableRows;
  const size = pageSize(source);
  const limit = app.sourceLimits[source.id] || size;
  const shown = rows.slice(0,limit);
  const failed = source.status === 'failed';
  const waiting = source.status === 'not_connected';
  const disconnected = waiting && (source.disabled || source.enabled === false);
  const status = sourceStatusLabel(source, failed ? availableRows.length : rows.length, app.onlyNew);
  return `<section class="source-panel" data-source-panel="${e(source.id)}" aria-labelledby="source-heading-${e(source.id)}">
    <header class="source-panel-header">
      <span class="source-mark source-mark-${e(source.group || 'other')}" aria-hidden="true"><img src="${e(sourceIcon(source))}" alt="" width="22" height="22"></span>
      <div class="source-panel-heading"><h3 id="source-heading-${e(source.id)}"><a href="${e(app.safeUrl(source.home_url))}" target="_blank" rel="noopener noreferrer" title="打开${e(source.name)}首页">${e(source.name)} <span aria-hidden="true">↗</span></a></h3><p class="${failed ? 'source-panel-warning' : ''}">${status}</p></div>
    </header>
    ${waiting ? `<p class="board-reading-note">${e(source.message || source.availability_message || (disconnected ? '自动读取尚未接通，可以手动添加原帖链接。' : '等待首次成功读取。'))}</p>` : ''}
    ${shown.length ? `<ol class="source-headlines" aria-label="${e(source.name)}标题列表">${shown.map((row,index) => {
      const {item} = row;
      const practical=practicalMaterialKind(item),repository=practical ? null : repositoryPresentation(item);
      const title = repository?.title || item.title;
      const saved=state.savedItemIds?.has(item.id),archived=state.archivedItemIds?.has(item.id);
      const inTopic = state.topics.some(topic => topic.materials.some(material => material.item.id === item.id || item.alias_ids?.includes(material.item.id) || (item.canonical_url && material.item.canonical_url === item.canonical_url)));
      const kind = practical ? '官方说明' : linkLabels[row.kind] || '原文';
      const author = !repository && row.kind==='post' ? postAuthorLabel(item) : '';
      return `<li class="source-headline ${repository ? 'headline-repository' : ''}" id="source-row-${e(source.id)}-${e(item.id)}">
        <span class="headline-number ${source.ranked && row.rank && row.rank <= 3 ? 'headline-top' : ''}" title="${source.ranked && row.rank ? '来源榜单位置' : '展示序号'}">${source.ranked && row.rank ? row.rank : index+1}</span>
        <div class="headline-content"><a class="headline-link" href="${e(app.safeUrl(row.url))}" target="_blank" rel="noopener noreferrer" title="${e(title)} · 打开${kind}（新标签页）"><span>${e(title)}</span>${!repository && kind !== '原文' ? `<small class="headline-kind">${kind}</small>` : ''}${row.heat ? `<small class="headline-heat">${e(row.heat)}</small>` : ''}</a>
        ${author ? `<p class="headline-repo-name headline-post-author">${e(author)}</p>` : ''}
        ${!repository && row.kind!=='repository' ? renderExcerpt(app,item,source,row.kind) : ''}${renderMaterialReview(app,item)}
        ${repository ? `<p class="headline-repo-name">${e(repository.repository)}</p>
        <details class="headline-explanation" data-repository-details="${e(source.id+'-'+item.id)}" ${app.openRepositoryDetails?.has(source.id+'-'+item.id) ? 'open' : ''}><summary>核心重点 <span>· ${e(repository.basis)}</span></summary>
          ${repository.guide ? `<p>${e(repository.guide.summary)}</p>` : ''}
          ${repository.guide?.example ? `<p>${e(repository.guide.example)}</p>` : ''}
          ${repository.guide?.audience ? `<p>适合：${e(repository.guide.audience)}</p>` : ''}
          <p class="repo-guide-boundary">${repository.guide ? repository.guide.basis==='readme' ? '已阅读项目说明，尚未实测。' : repository.guide.basis==='observation' ? '复用观察仓库的介绍，本次未重新实测。' : '仅整理作者简介，尚未读完整说明或实测。' : '中文用途尚未整理，可以先查看下方作者简介。'}</p>
          <details class="repo-original"><summary>作者原始简介</summary><p>${e(item.summary || '作者未提供简介。')}</p></details>
          ${repository.guide?.recorded_at ? `<small>${repository.guide.basis==='observation' ? '导入于' : '整理于'} ${e(app.formatTime(repository.guide.recorded_at))}</small>` : ''}
          ${state.publicPreview ? `<a class="source-read-project" href="${e(app.safeUrl(item.original_url))}" target="_blank" rel="noopener noreferrer">到项目页读完整说明 ↗</a>` : `<button class="source-read-project" data-action="followup" data-item-id="${e(item.id)}">让 AI 读完整说明 →</button>`}
        </details>` : ''}</div>
        <button class="headline-save ${saved ? 'is-collected' : inTopic ? 'is-in-topic' : ''}" id="collect-${e(source.id)}-${e(item.id)}" data-action="${archived ? 'restore-collection' : 'toggle-save'}" data-item-id="${e(item.id)}" aria-pressed="${!!saved}" aria-label="${archived ? '恢复到收藏' : saved ? '取消收藏' : '先收藏'}：${e(title)}" title="${archived ? '已归档 · 点一下恢复到收藏' : saved ? '已收藏 · 点击取消' : inTopic ? '已在主题 · 点一下也收进收藏' : '先收藏，稍后整理'}"><svg width="16" height="16" viewBox="0 0 24 24" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></button>
      </li>`;
    }).join('')}</ol>` : `<div class="source-panel-empty">${disconnected ? '可先点击“添加材料”，收藏你看到的原帖。' : app.onlyNew && availableRows.length ? '最近一次没有新增内容。取消上方筛选可看已有内容。' : failed ? '其他板块仍可阅读。' : app.onlyNew ? '最近一次没有新增内容。' : waiting ? state.publicPreview ? '等待云端成功读取。查看更新只读取已完成的内容。' : '点击上方“更新内容”，读取这个来源。' : '暂无可展示内容；已隐藏的条目可在“我的关注”恢复。'}</div>`}
    <footer class="source-panel-footer"><div class="source-panel-meta"><span>${practicalSource ? readingTime ? `说明阅读时间：${e(app.formatTime(readingTime))}` : '说明阅读时间未提供' : source.last_success_at ? `最近成功获取：${e(app.formatTime(source.last_success_at))}` : '尚未成功获取'}<small>${practicalSource ? '不自动更新 · 未实测' : source.ranked ? '按来源榜单排序' : source.link_kind === 'video' ? '频道新视频 · 不是全站热榜' : '按来源时间排序'}</small></span>
      ${practicalSource || source.reading_note ? `<details class="source-reading-details" data-source-reading="${e(source.id)}" ${app.openSourceReadingDetails?.has(source.id) ? 'open' : ''}><summary>来源说明${practicalSource ? ' · 未实测' : ''}</summary><p class="board-reading-note">${practicalSource ? 'AI 按官方说明整理，未实测 · 不自动更新。中文标题与说明由本站整理。' : e(source.reading_note)}</p></details>` : ''}</div>
      <div class="source-panel-pagination">${rows.length > limit ? `<button class="source-more" data-source-more="${e(source.id)}" aria-label="${e(source.name)}：查看更多，再看 ${Math.min(size,rows.length-limit)} 条">再看 ${Math.min(size,rows.length-limit)} 条 <span aria-hidden="true">→</span></button>` : ''}${limit > size && rows.length > size ? `<button class="source-more source-collapse" data-source-collapse="${e(source.id)}" aria-label="收起${e(source.name)}，只看前 ${size} 条">收起 ↑</button>` : ''}</div></footer>
  </section>`;
}

export function renderSourceBoard(app, state) {
  const e = value => app.escapeHtml(value);
  const update = feedUpdateInfo(state);
  if (app.sourcePreferenceKey!==sourcePreferenceKey(state.mode)) applySourcePreferences(app,state);
  app.sourcePreferences=normalizeSourcePreferences(app.sourcePreferences,state.sources);
  app.sourcePreferenceSources=state.sources;app.sourcePreferenceMode=state.mode;
  const groups = [...SOURCE_GROUPS, {id:'other',name:'其他来源'}].filter(group => state.sources.some(source => (source.group || 'other') === group.id));
  const orderedSources = groups.flatMap(group => state.sources.filter(source => (source.group || 'other') === group.id));
  const visibleSources=orderVisibleSources(orderedSources,app.sourcePreferences);
  const sources = visibleSources.filter(source => app.boardGroup === 'all' || (source.group || 'other') === app.boardGroup);
  const creatorSettings=readCreatorPreferences(preferenceStorage(),creatorPreferenceKey(state.mode,state.publicPreview));
  const postState={...state,creatorCatalog:CREATOR_CATALOG,creatorPreferences:creatorSettings.preferences};
  const postSources=sources.filter(source=>source.id.startsWith('sopilot-'));
  const otherSources=sources.filter(source=>!source.id.startsWith('sopilot-'));
  const hiddenCount=state.sources.length-visibleSources.length;
  const search=selectHomeSearch(app,state);
  const panels=`${otherSources.length ? '<div class="action-source-heading"><h3>按来源继续浏览</h3><p>点标题读原文，点书签留下材料。</p></div>' : ''}<div class="source-board">${otherSources.map(source => renderPanel(app,state,source)).join('') || (postSources.length ? '' : `<div class="empty-state"><h3>${state.sources.length ? visibleSources.length ? '这一分类没有显示的来源' : '首页来源都已隐藏' : '还没有信息来源'}</h3>${state.sources.length ? '<p>可打开“管理来源”重新勾选，或恢复全部来源。</p><button class="btn-secondary-quiet" id="source-restore-all">恢复全部来源</button>' : ''}</div>`)}</div>`;
  const sourceBrowser=app.boardGroup==='all' && otherSources.length
    ? `<details class="action-source-browser" id="board-source-browser" ${app.boardSourcesOpen ? 'open' : ''}><summary>浏览其他来源 <span>· ${otherSources.length} 个板块</span></summary><p class="action-source-browser-note">精选之外的内容留在这里，想多看时再展开。</p>${panels}</details>` : panels;
  const boardContent=search.active ? renderFeedSearchResults(app,state,search) : `${renderEditorialRecommendations(app,postState)}${postSources.length ? renderPostStream(app,postState,{sources:postSources}) : ''}${sourceBrowser}`;
  const visibleUpdate=boardUpdateMessage(state,{refreshError:app.refreshError});
  return `<div class="board-topbar editorial-board-topbar"><div class="page-intro board-intro board-intro-compact"><div class="intro-main"><p class="editorial-page-kicker">DISCOVER / 发现</p><h2 class="page-headline" tabindex="-1">好信息，留给下一步。</h2><p class="page-subtext">发现好内容，留下自己的判断。</p></div><div class="topic-actions"><button class="btn-secondary-quiet" data-manual-add>添加材料</button><button class="btn-primary-action" id="btn-check-update" ${app.refreshing || state.loadStatus?.phase === 'loading' ? 'disabled' : ''}>${app.refreshing || state.loadStatus?.phase === 'loading' ? '正在读取…' : state.publicPreview ? '查看更新' : '更新内容'}</button></div></div>
    ${app.renderWorkspaceResume?.(state) || ''}${renderFeedSearchControls(app,state,search)}</div>
    <div id="editorial-featured-surface">${search.active ? '' : renderEditorialFeatured(app,postState)}</div>
    <div class="board-toolbar"><div class="board-groups" role="group" aria-label="来源分类"><button class="board-group" data-board-group="all" aria-pressed="${app.boardGroup==='all'}">全部来源 <small>${visibleSources.length}${hiddenCount ? ` / ${state.sources.length}` : ''}</small></button>${groups.map(group => `<button class="board-group" data-board-group="${group.id}" aria-pressed="${app.boardGroup===group.id}">${group.name}</button>`).join('')}</div><div class="board-management-actions"><button class="btn-secondary-quiet" id="source-manager-open" aria-expanded="${!!app.sourceManagerOpen}">${app.sourceManagerOpen ? '正在管理来源' : '管理来源'}</button><button class="btn-secondary-quiet" id="feed-selected-btn">按我的关注筛选 →</button></div></div>
    ${sourceManager(app,state,groups)}
    ${!app.sourceManagerOpen && app.sourcePreferenceNotice ? `<p class="source-preference-warning" role="status">${e(app.sourcePreferenceNotice)}</p>` : ''}
    ${hiddenCount ? `<p class="source-visibility-note">首页隐藏了 ${hiddenCount} 个来源，可在“管理来源”里调整；收藏和主题仍保留。</p>` : ''}
    <div class="board-meta-controls"><details class="board-updates" id="board-updates" ${app.boardUpdateDetailsOpen ? 'open' : ''}><summary class="board-status-summary">${update.lastSuccess ? `最近有来源成功更新：${e(app.formatTime(update.lastSuccess))}` : '更新与来源说明'} <span>更新详情</span></summary><div class="board-status"><p class="${app.refreshError || ['failed','partial'].includes(state.refresh?.status) ? 'update-failed' : ''}"><span data-feed-update-notice>${e(update.notice)}</span>${update.automatic ? `<small>${e(update.schedule)}自动更新 · “查看更新”读取最近完成的内容</small>` : ''}</p><p class="board-reading-note">标题打开原站 · 书签一键收藏 · GitHub 先看用途，再看项目名</p>${renderSourceHealth(app,state)}</div></details>
      <p class="board-update-message ${visibleUpdate.failed ? 'update-failed' : ''}" role="status" data-board-update-message ${visibleUpdate.message ? '' : 'hidden'}><span>${e(visibleUpdate.message)}</span></p>
      <label class="feed-new-filter"><input id="feed-only-new" type="checkbox" ${app.onlyNew ? 'checked' : ''}>只看最近一次新增</label>
      ${!state.publicPreview && (state.allItems.some(item=>repositoryPresentation(item)?.missing) || app.repositoryGuideRunning || state.repositoryGuideStatus?.status==='working') ? `<button class="source-more" id="repository-intros-btn" ${app.repositoryGuideRunning ? 'disabled' : ''} title="使用本机 Codex 额度；只发送公开项目简介，已有介绍会复用。">${app.repositoryGuideRunning || state.repositoryGuideStatus?.status==='working' ? '正在整理中文用途…' : '补齐中文用途'}</button>` : ''}</div>
    ${app.repositoryGuideNotice ? `<p class="repository-guide-notice" role="status">${e(app.repositoryGuideNotice)}</p>` : ''}
    <div id="feed-board-content">${boardContent}</div>`;
}

export function bindSourceBoardActions(app) {
  bindFeedSearchActions(app);
  bindPostStreamActions(app);
  const preferenceState={sources:app.sourcePreferenceSources || [],mode:app.sourcePreferenceMode};
  const cancelManager=()=>{
    app.sourceManagerOpen=false;app.sourcePreferenceDraft=null;app.sourcePreferenceError='';
    applySourcePreferences(app,preferenceState);app.render();document.getElementById('source-manager-open')?.focus();
  };
  document.getElementById('source-manager-open')?.addEventListener('click',()=>{
    if (app.sourceManagerOpen) {document.querySelector('[data-source-visibility]')?.focus();return;}
    applySourcePreferences(app,preferenceState);app.sourcePreferenceDraft=structuredClone(app.sourcePreferences);
    app.sourceManagerOpen=true;app.sourcePreferenceError='';app.render();document.querySelector('[data-source-visibility]')?.focus();
  });
  document.getElementById('source-manager-cancel')?.addEventListener('click',cancelManager);
  document.getElementById('source-manager-form')?.addEventListener('keydown',event=>{
    if (event.key==='Escape') {event.preventDefault();event.stopPropagation();cancelManager();}
  });
  document.getElementById('source-manager-form')?.addEventListener('submit',event=>{
    event.preventDefault();saveSourcePreferences(app,preferenceState,app.sourcePreferenceDraft);
  });
  document.getElementById('source-manager-show-all')?.addEventListener('click',()=>{
    app.sourcePreferenceDraft={...app.sourcePreferenceDraft,hidden_source_ids:[]};app.render();document.getElementById('source-manager-show-all')?.focus();
  });
  document.getElementById('source-restore-all')?.addEventListener('click',()=>saveSourcePreferences(app,preferenceState,normalizeSourcePreferences(null,preferenceState.sources)));
  document.querySelectorAll('[data-source-visibility],[data-source-pin]').forEach(input=>input.addEventListener('change',()=>{
    const id=input.dataset.sourceVisibility || input.dataset.sourcePin;
    if (!preferenceState.sources.some(source=>source.id===id)) return;
    const draft=normalizeSourcePreferences(app.sourcePreferenceDraft,preferenceState.sources);
    if (input.dataset.sourceVisibility) {
      draft.hidden_source_ids=draft.hidden_source_ids.filter(key=>key!==id);
      if (!input.checked) {draft.hidden_source_ids.push(id);draft.pinned_source_ids=draft.pinned_source_ids.filter(key=>key!==id);}
    } else {
      draft.pinned_source_ids=draft.pinned_source_ids.filter(key=>key!==id);
      if (input.checked && !draft.hidden_source_ids.includes(id)) draft.pinned_source_ids.push(id);
    }
    app.sourcePreferenceDraft=draft;app.render();document.getElementById(input.id)?.focus();
  }));
  if (typeof window!=='undefined' && !app.sourcePreferenceStorageListener) {
    app.sourcePreferenceStorageListener=event=>{
      if (event.key!==app.sourcePreferenceKey && event.key!==null) return;
      if (app.sourceManagerOpen) app.sourcePreferenceError='来源设置已在另一个页面更改。请取消后重新打开“管理来源”，再保存。';
      else applySourcePreferences(app,{sources:app.sourcePreferenceSources,mode:app.sourcePreferenceMode});
      if (app.currentTab==='today' && app.feedView==='sources' && !app.activeModal && document.activeElement?.id!=='feed-search') {
        const focused=document.activeElement?.id;
        app.render();if(focused) document.getElementById(focused)?.focus();
      } else if (app.currentTab==='today' && app.feedView==='sources') app.pendingRender=true;
    };
    window.addEventListener('storage',app.sourcePreferenceStorageListener);
  }
  app.openSourceReadingDetails ||= new Set();
  document.querySelectorAll('[data-source-reading]').forEach(detail=>detail.addEventListener('toggle',()=>{
    if (detail.isConnected===false) return;
    if (detail.open) app.openSourceReadingDetails.add(detail.dataset.sourceReading);
    else app.openSourceReadingDetails.delete(detail.dataset.sourceReading);
  }));
  document.getElementById('board-highlights')?.addEventListener('toggle',event=>{
    if (event.currentTarget.isConnected!==false) app.boardHighlightsOpen=event.currentTarget.open;
  });
  document.getElementById('board-updates')?.addEventListener('toggle',event=>{
    if (event.currentTarget.isConnected!==false) app.boardUpdateDetailsOpen=event.currentTarget.open;
  });
  document.getElementById('board-source-browser')?.addEventListener('toggle',event=>{
    if (event.currentTarget.isConnected!==false) app.boardSourcesOpen=event.currentTarget.open;
  });
  app.openExcerptDetails ||= new Set();
  app.openFullExcerpts ||= new Set();
  document.querySelectorAll('[data-excerpt-details]').forEach(detail=>detail.addEventListener('toggle',()=>{
    if (detail.isConnected===false) return;
    if (detail.open) app.openExcerptDetails.add(detail.dataset.excerptDetails);
    else app.openExcerptDetails.delete(detail.dataset.excerptDetails);
  }));
  document.querySelectorAll('[data-excerpt-full]').forEach(detail=>detail.addEventListener('toggle',()=>{
    if (detail.isConnected===false) return;
    if (detail.open) app.openFullExcerpts.add(detail.dataset.excerptFull);
    else app.openFullExcerpts.delete(detail.dataset.excerptFull);
    const short=detail.previousElementSibling;
    if (short?.classList.contains('headline-preview-text')) short.hidden=detail.open;
  }));
  app.openRepositoryDetails ||= new Set();
  document.querySelectorAll('[data-repository-details]').forEach(detail=>detail.addEventListener('toggle',()=>{
    if (detail.isConnected===false) return;
    if (detail.open) app.openRepositoryDetails.add(detail.dataset.repositoryDetails);
    else app.openRepositoryDetails.delete(detail.dataset.repositoryDetails);
  }));
  document.getElementById('repository-intros-btn')?.addEventListener('click',()=>app.startRepositoryGuides());
  document.getElementById('feed-sources-btn')?.addEventListener('click', () => {
    app.feedView='sources'; app.render(); document.querySelector('[data-board-group="all"]')?.focus();
  });
  document.querySelectorAll('[data-board-group]').forEach(button => button.addEventListener('click', () => {
    app.boardGroup=button.dataset.boardGroup; app.render(); document.querySelector(`[data-board-group="${app.boardGroup}"]`)?.focus();
  }));
  document.querySelectorAll('[data-source-more]').forEach(button => button.addEventListener('click', () => {
    const id=button.dataset.sourceMore;
    const size=pageSize(app.sourcePreferenceSources?.find(source=>source.id===id));
    const previous=app.sourceLimits[id] || size;
    app.sourceLimits[id]=previous+size; app.render();
    document.querySelectorAll(`[data-source-panel="${id}"] .headline-link`)[previous]?.focus();
  }));
  document.querySelectorAll('[data-source-collapse]').forEach(button => button.addEventListener('click', () => {
    const id=button.dataset.sourceCollapse;
    app.sourceLimits[id]=pageSize(app.sourcePreferenceSources?.find(source=>source.id===id)); app.render();
    document.querySelector(`[data-source-panel="${id}"] h3 a`)?.focus();
  }));
}
