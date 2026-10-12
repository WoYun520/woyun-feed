import { renderMaterialReview } from './materialReview.js';
import { FEED_PURPOSES, selectFeedSearch, feedMaterialKind } from './feedSearch.js';
import { repositoryPresentation } from './repositoryGuide.js';
import { practicalMaterialKind } from './practicalMaterials.js';
import { feedAdapter } from './dataAdapter.js';
import { openTopicDialog } from './topicViews.js';
import { postQuality } from './postQuality.js';
import { authorSourceEnabled } from './postStream.js';
import { creatorPreferenceKey, readCreatorPreferences } from './creatorTutorials.js';
import { CREATOR_CATALOG } from './creatorCatalog.js';

export const FEED_SEARCH_PAGE_SIZE=20;
const purposeId=app=>FEED_PURPOSES.some(purpose=>purpose.id===app.feedSearchPurpose) ? app.feedSearchPurpose : 'all';
const queryText=app=>typeof app.feedSearchQuery==='string' ? app.feedSearchQuery.slice(0,200) : '';
const purposes=()=>[{id:'all',label:'全部用途'},...FEED_PURPOSES];

function sourceIds(app,state) {
  const hidden=new Set(app.sourcePreferences?.hidden_source_ids || []);
  let storage;try {storage=globalThis.localStorage;} catch {}
  const creatorState={...state,creatorCatalog:state.creatorCatalog || CREATOR_CATALOG,
    creatorPreferences:state.creatorPreferences || readCreatorPreferences(storage,creatorPreferenceKey(state.mode,state.publicPreview)).preferences};
  return (state.sources || []).filter(source=>!hidden.has(source.id)
    && authorSourceEnabled(source,creatorState)
    && (!app.boardGroup || app.boardGroup==='all' || (source.group || 'other')===app.boardGroup)).map(source=>source.id);
}

export function selectHomeSearch(app,state,purpose=purposeId(app)) {
  const selected=selectFeedSearch(state,{query:queryText(app),purpose,sourceIds:sourceIds(app,state),onlyNew:!!app.onlyNew});
  const foldedItems=selected.items.filter(item=>postQuality(item).fold);
  return {...selected,foldedItems,foldedCount:foldedItems.length,
    items:app.feedSearchShowFolded ? selected.items : selected.items.filter(item=>!postQuality(item).fold)};
}

export function renderFeedSearchControls(app,state,selection=selectHomeSearch(app,state)) {
  const e=value=>app.escapeHtml(value),activePurpose=purposeId(app);
  return `<section class="feed-search-tools" aria-label="查找已有材料"><div class="feed-search-entry"><label for="feed-search" class="sr-only">找我需要的工具</label><div class="feed-search-input-row"><input type="search" id="feed-search" maxlength="200" value="${e(queryText(app))}" placeholder="搜索文章、项目或关键词…" aria-describedby="feed-search-note" aria-controls="feed-board-content"><button type="button" class="btn-secondary-quiet" id="feed-search-clear" ${selection.active ? '' : 'hidden'}>清空查找</button><button type="button" class="btn-primary-action" id="feed-search-submit">搜索</button></div></div><details class="feed-purpose-options" ${activePurpose!=='all' ? 'open' : ''}><summary>按用途筛选<span id="feed-purpose-label">${activePurpose!=='all' ? ` · ${e(purposes().find(purpose=>purpose.id===activePurpose)?.label)}` : ''}</span></summary><div class="feed-search-purposes" role="group" aria-label="按用途查找">${purposes().map(purpose=>{
    const count=purpose.id===activePurpose ? selection.items.length : selectHomeSearch(app,state,purpose.id).items.length;
    return `<button type="button" class="feed-search-purpose" id="feed-search-purpose-${e(purpose.id)}" data-feed-search-purpose="${e(purpose.id)}" aria-pressed="${purpose.id===activePurpose}">${e(purpose.label)} <small data-feed-search-count="${e(purpose.id)}">${count}</small></button>`;
  }).join('')}</div><p class="feed-search-note" id="feed-search-note">按已有标题和简介找，不等于实测。优先展示工具、操作教程和项目，其他资讯仍可查看。用途按钮只是关键词提示。多个词用空格隔开，需同时匹配；不搜索网页全文。</p></details></section>`;
}

function basisFor(item,repository,practical) {
  if (practical) return '官方说明整理，未实测。';
  if (repository) return `${repository.basis}；尚未实测。`;
  if (item.link_kind==='video') return '来源视频简介，未观看视频或读取字幕。';
  if (item.link_kind==='post') return '第三方帖子摘录，未核对完整原帖、作者身份或热度。';
  return item.content_status==='headline_only' ? '来源只提供标题，未读取全文。' : '来源标题和简介，未核对全文或实测。';
}

function summaryHtml(app,item,practical) {
  const e=value=>app.escapeHtml(value),summary=typeof item.summary==='string' ? item.summary : '';
  if (!practical) return `<p class="feed-search-summary ${summary ? '' : 'feed-search-summary-empty'}">${e(summary || '来源只提供标题，暂无简介。')}</p>`;
  return `<div class="feed-search-practical-summary">${summary.split(/\r?\n/).filter(line=>line.trim()).map(line=>{
    const field=line.match(/^(用途|开始|限制|费用|依据)[：:]\s*(.*)$/);
    return field ? `<p><span class="feed-search-summary-label">${e(field[1])}</span>${e(field[2])}</p>` : `<p>${e(line)}</p>`;
  }).join('') || '<p>说明未提供。</p>'}</div>`;
}

function materialLabel(kind,item) {
  return {tool:'工具',tutorial:'操作教程',repository:'GitHub 项目'}[kind]
    || (item.link_kind==='post' ? '帖子' : item.link_kind==='video' ? '视频' : '资讯');
}

export function renderFeedSearchResults(app,state,selection=selectHomeSearch(app,state)) {
  if (!selection.active) return '';
  const e=value=>app.escapeHtml(value),limit=Math.max(FEED_SEARCH_PAGE_SIZE,app.feedSearchLimit || FEED_SEARCH_PAGE_SIZE);
  const shown=selection.items.slice(0,limit),visibleIds=new Set(sourceIds(app,state));
  const names=item=>(state.sources || []).filter(source=>visibleIds.has(source.id) && item.source_refs?.includes(source.id)).map(source=>source.name || source.id).join('、');
  const time=(label,value)=>value && Number.isFinite(Date.parse(value)) ? `<span>${e(label)} <time datetime="${e(value)}">${e(app.formatTime(value))}</time></span>` : '';
  return `<section class="feed-search-results" aria-labelledby="feed-search-results-heading"><div class="feed-search-results-heading"><h3 id="feed-search-results-heading" tabindex="-1">找到 ${selection.items.length} 条材料</h3><p role="status" aria-live="polite">已显示 ${shown.length} 条；按当前来源、分类和新增筛选查找。</p></div>
    ${selection.foldedCount ? `<div class="post-stream-fold-controls"><button type="button" class="btn-secondary-quiet" id="feed-search-fold-toggle" data-feed-search-action="fold" aria-pressed="${!!app.feedSearchShowFolded}">${app.feedSearchShowFolded ? '重新折叠' : '查看折叠的'} ${selection.foldedCount} 条推文</button><span>规则提示，可能误筛；原帖仍保留。</span></div>` : ''}
    ${shown.length ? `<ol class="feed-search-result-list">${shown.map(item=>{
      const practical=practicalMaterialKind(item),kind=feedMaterialKind(item),repository=practical ? null : repositoryPresentation(item);
      const title=practical ? item.title : repository && repository.title!=='用途待整理' ? repository.title : item.title,id=e(item.id);
      const saved=state.savedItemIds?.has(item.id),archived=state.archivedItemIds?.has(item.id),saveLabel=archived ? '恢复收藏' : saved ? '取消收藏' : '收藏';
      const inTopic=(state.topics || []).some(topic=>(topic.materials || []).some(material=>material.item?.id===item.id
        || item.alias_ids?.includes(material.item?.id) || (item.canonical_url && material.item?.canonical_url===item.canonical_url)));
      return `<li class="feed-search-result" id="feed-search-result-${id}"><div class="feed-search-result-content"><div class="feed-search-result-labels"><span class="feed-search-kind feed-search-kind-${e(kind)}">${e(materialLabel(kind,item))}</span>${practical ? '<span class="feed-search-title-note">本站中文整理标题</span>' : ''}</div><h4><a id="feed-search-link-${id}" href="${e(app.safeUrl(item.original_url))}" target="_blank" rel="noopener noreferrer">${e(title)} <span aria-hidden="true">↗</span></a></h4>${repository ? `<p class="feed-search-repository">${e(item.repository_name || repository.repository)}</p>` : ''}<p class="feed-search-origin">来源：${e(names(item) || '来源待确认')}</p>${postQuality(item).fold ? `<p class="post-stream-fold-reason">${e(postQuality(item).reason)}</p>` : ''}${summaryHtml(app,item,practical)}${renderMaterialReview(app,item)}<p class="feed-search-basis">依据：${e(basisFor(item,repository,practical))}</p><p class="feed-search-times">${practical ? time('说明阅读时间',item.captured_at) : `${repository && item.updated_at ? time('仓库更新',item.updated_at) : item.published_at ? time(item.link_kind==='post' ? '原帖发布' : '来源发布',item.published_at) : '<span>发布时间未提供</span>'}${item.link_kind==='post' ? time('榜单条目更新',item.source_item_time) : ''}${time('采集于',item.captured_at)}`}</p></div><div class="feed-search-result-actions"><button type="button" class="btn-secondary-quiet ${saved ? 'is-collected' : ''}" id="feed-search-save-${id}" data-feed-search-action="${archived ? 'restore' : 'save'}" data-item-id="${id}" aria-pressed="${!!saved}" aria-label="${e(saveLabel)}：${e(title)}">${saveLabel}</button><button type="button" class="btn-quiet" id="feed-search-topic-${id}" data-feed-search-action="topic" data-item-id="${id}">放进主题</button>${inTopic ? '<span>已在主题</span>' : ''}</div></li>`;
    }).join('')}</ol>${selection.items.length>shown.length ? `<button type="button" class="btn-secondary-quiet feed-search-more" id="feed-search-more" data-feed-search-action="more">再看 ${Math.min(FEED_SEARCH_PAGE_SIZE,selection.items.length-shown.length)} 条</button>` : ''}`
      : '<div class="feed-search-empty"><p>没有找到匹配的材料。试试少写一个词、选择其他用途，或调整来源分类。</p><button type="button" class="btn-secondary-quiet" data-feed-search-action="reset">清空搜索与用途</button></div>'}
  </section>`;
}

export function bindFeedSearchActions(app) {
  const input=document.getElementById('feed-search'),content=document.getElementById('feed-board-content');
  if (!input || !content || content.feedSearchBound) return;
  content.feedSearchBound=true;
  const current=()=>feedAdapter.getState();
  const syncControls=(selection,state)=>{
    const clear=document.getElementById('feed-search-clear');if(clear) clear.hidden=!selection.active;
    const purposeLabel=document.getElementById('feed-purpose-label');
    if(purposeLabel) purposeLabel.textContent=purposeId(app)==='all' ? '' : ` · ${purposes().find(purpose=>purpose.id===purposeId(app))?.label || ''}`;
    document.querySelectorAll('[data-feed-search-purpose]').forEach(button=>{
      const id=button.dataset.feedSearchPurpose;
      button.setAttribute('aria-pressed',String(id===purposeId(app)));
      const count=button.querySelector('[data-feed-search-count]');
      if(count) count.textContent=String(id===purposeId(app) ? selection.items.length : selectHomeSearch(app,state,id).items.length);
    });
  };
  const reset=()=>{
    app.feedSearchQuery='';app.feedSearchPurpose='all';app.feedSearchLimit=FEED_SEARCH_PAGE_SIZE;app.feedSearchComposing=false;app.feedSearchShowFolded=false;
    app.render();const fresh=document.getElementById('feed-search');fresh?.focus();fresh?.setSelectionRange?.(0,0);
  };
  const update=()=>{
    const state=current(),selection=selectHomeSearch(app,state);syncControls(selection,state);
    if (!selection.active) {app.render();document.getElementById('feed-search')?.focus();return;}
    // The human-selected cover sits before the source filters. Active search
    // replaces that presentation too without redrawing the user's input.
    const editorial=document.getElementById('editorial-featured-surface');
    if (editorial) editorial.innerHTML='';
    content.innerHTML=renderFeedSearchResults(app,state,selection);
    app.rememberDisplayedItems?.(state);
  };
  const typed=event=>{
    if(input.isConnected===false) return;
    app.feedSearchQuery=input.value.slice(0,200);app.feedSearchLimit=FEED_SEARCH_PAGE_SIZE;
    app.feedSearchComposing=!!event.isComposing;
    if (!event.isComposing) update();
  };
  input.addEventListener('compositionstart',()=>{app.feedSearchComposing=true;});
  input.addEventListener('input',typed);
  input.addEventListener('compositionend',()=>{
    if(input.isConnected===false) return;
    app.feedSearchComposing=false;app.feedSearchQuery=input.value.slice(0,200);app.feedSearchLimit=FEED_SEARCH_PAGE_SIZE;update();
  });
  input.addEventListener('search',typed);
  const submit=()=>{if(app.feedSearchComposing) return;app.feedSearchQuery=input.value.slice(0,200);update();document.getElementById('feed-search-results-heading')?.focus();};
  input.addEventListener('keydown',event=>{if(event.key==='Enter' && !event.isComposing) {event.preventDefault();submit();}});
  document.getElementById('feed-search-submit')?.addEventListener('click',submit);
  input.addEventListener('blur',()=>requestAnimationFrame(()=>{if(app.pendingRender && !app.activeModal && !app.feedSearchComposing && document.activeElement?.id!=='feed-search') app.render();}));
  document.getElementById('feed-search-clear')?.addEventListener('click',reset);
  document.querySelectorAll('[data-feed-search-purpose]').forEach(button=>button.addEventListener('click',()=>{
    app.feedSearchPurpose=button.dataset.feedSearchPurpose;app.feedSearchLimit=FEED_SEARCH_PAGE_SIZE;update();
    document.getElementById(`feed-search-purpose-${purposeId(app)}`)?.focus();
  }));
  content.addEventListener('click',event=>{
    const button=event.target.closest('[data-feed-search-action]');
    if (!button || !content.contains(button)) return;
    const action=button.dataset.feedSearchAction;
    if (action==='reset') {reset();return;}
    if (action==='fold') {app.feedSearchShowFolded=!app.feedSearchShowFolded;update();document.getElementById('feed-search-fold-toggle')?.focus();return;}
    if (action==='more') {
      const state=current(),selection=selectHomeSearch(app,state),previous=Math.max(FEED_SEARCH_PAGE_SIZE,app.feedSearchLimit || FEED_SEARCH_PAGE_SIZE);
      app.feedSearchLimit=previous+FEED_SEARCH_PAGE_SIZE;content.innerHTML=renderFeedSearchResults(app,state,selection);
      app.rememberDisplayedItems?.(state);
      document.getElementById(`feed-search-link-${selection.items[previous]?.id}`)?.focus();return;
    }
    const id=button.dataset.itemId;
    const state=current();
    const displayed=feedAdapter.displayedItems?.get(id);
    const actionState=displayed ? {...state,allItems:[displayed]} : state;
    if (!selectHomeSearch(app,actionState).items.some(item=>item.id===id || item.alias_ids?.includes(id))) return;
    if (action==='save') app.toggleSaved(id,button);
    else if (action==='topic') openTopicDialog(app,'collect',{itemId:id},button);
    else if (action==='restore') {
      const top=window.scrollY;
      try {
        feedAdapter.setArchived(id,false);window.scrollTo({top,behavior:'instant'});
        document.getElementById(button.id)?.focus({preventScroll:true});app.showToast('已恢复到收藏。');
      } catch(error) {app.showToast(`未保存：${error.message}`);}
    }
  });
}
