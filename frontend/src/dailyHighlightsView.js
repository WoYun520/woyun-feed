import { selectDailyHighlights } from './dailyHighlights.js';
import { repositoryName } from './repositoryGuide.js';
import { postStatusId } from './postStream.js';
import { renderPostMedia } from './postMediaView.js';

function beijingTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
}

function costLabel(value) {
  if (!value || value === '费用待确认') return '费用待确认';
  if (/免费/.test(value)) return '免费范围及额外费用需核对';
  if (/收费|付费|服务费|订阅|\$\d/.test(value)) return '可能涉及收费，完整条件待核对';
  return '有费用说明，最新条件待核对';
}

// Actions pass the unchanged item ID to the existing local topic workflow.
// Quoted capabilities and source notes are never promoted to test results.
export function renderDailyHighlights(app,state,{now}={}) {
  const selection=selectDailyHighlights(state.allItems || [],state.sources || [],{
    now,profile:state.profile,hiddenIds:state.hiddenItemIds || new Set(),
    hiddenSourceIds:app.sourcePreferences?.hidden_source_ids || [],group:app.boardGroup || 'all',
    onlyNewIds:app.onlyNew ? state.refresh?.new_item_ids || [] : null,limit:3,includePractical:true,
    creatorCatalog:state.creatorCatalog,creatorPreferences:state.creatorPreferences,
  });
  const e=value=>app.escapeHtml(value),date=selection.dateKey || '';
  const time=(label,value)=>{
    const formatted=beijingTime(value);
    return formatted ? `<span>${e(label)} <time datetime="${e(value)}" title="${e(value)}">${e(formatted)}</time></span>` : '';
  };
  return `<section class="daily-highlights action-highlights" id="daily-highlights" aria-labelledby="daily-highlights-heading">
    <header class="daily-highlights-header"><div><p class="action-highlights-eyebrow">来源初筛 · 少而有用</p><h3 id="daily-highlights-heading">先挑一件值得做的事 <small>${selection.items.length} 条</small></h3><p>先看能做什么，再决定要不要花时间。</p></div><div class="action-highlights-note"><p>${e(date)} 整理 · 北京时间 · 每次最多 3 条</p><p>按已有说明自动初筛，未实测；固定说明会单独标注。</p></div></header>
    ${selection.items.length ? `<ol class="daily-highlights-list" aria-label="用途清楚的材料">${selection.items.map((entry,index)=>{
      const item=entry.item,id=e(item.id),title=entry.title || item.title || '来源材料',purpose=entry.purpose || '用途待确认';
      const repository=item.repository_name || repositoryName(item),statusId=postStatusId(item.original_url) || postStatusId(item.canonical_url);
      const matchingRecord=record=>record.id===item.id || item.alias_ids?.includes(record.id)
        || !!statusId && (postStatusId(record.original_url)===statusId || postStatusId(record.canonical_url)===statusId);
      const savedRecords=(state.savedItems || []).filter(matchingRecord),savedRecord=savedRecords[0];
      const archivedRecord=(state.archivedItems || []).find(matchingRecord) || savedRecords.find(record=>state.archivedItemIds?.has(record.id));
      const archived=!!archivedRecord || state.archivedItemIds?.has(item.id),saved=!archived && (!!savedRecord || state.savedItemIds?.has(item.id));
      const collectionId=e(archivedRecord?.id || savedRecord?.id || item.id);
      const inTopic=(state.topics || []).some(topic=>(topic.materials || []).some(material=>material.item?.id===item.id
        || item.alias_ids?.includes(material.item?.id) || (item.canonical_url && material.item?.canonical_url===item.canonical_url)));
      const sourceNames=Array.isArray(entry.sourceNames) ? entry.sourceNames.join('、') : '';
      const saveLabel=archived ? '恢复收藏' : saved ? '取消收藏' : '收藏';
      const readingLabel=entry.fixed ? '读过官方说明 · 未实测' : /AI 阅读项目说明/.test(entry.basis) ? '读过项目说明 · 未实测' : '用途来自简介或摘录 · 未实测';
      return `<li class="daily-highlight" id="daily-card-${id}" data-daily-item-id="${id}">
        <div class="action-highlight-labels"><span class="daily-highlight-number" aria-hidden="true">0${index+1}</span><span class="action-highlight-reading">${e(readingLabel)}</span>${entry.fixed ? '<span class="action-highlight-fixed">固定说明 · 非今日更新</span>' : ''}</div>
        ${renderPostMedia(app,item,{variant:'highlight'})}
        <div class="daily-highlight-title"><div><p class="daily-highlight-purpose-label">能做什么</p><h4><a href="${e(app.safeUrl(item.original_url))}" target="_blank" rel="noopener noreferrer">${e(purpose)} <span aria-hidden="true">↗</span></a></h4>${repository ? `<p class="daily-highlight-repository">${e(repository)}</p>` : ''}</div></div>
        <p class="daily-highlight-reason"><span>入选理由</span>${e(entry.reason || '符合当前初筛条件')}</p>
        <dl class="daily-highlight-facts"><div><dt>适合谁</dt><dd>${e(entry.audience || '适用人群待确认')}</dd></div><div><dt>准备</dt><dd>${e(entry.preparation || '准备条件未说明，先查看原文。')}</dd></div><div><dt>费用</dt><dd>${e(costLabel(entry.cost))}</dd></div></dl>
        <details class="action-highlight-evidence"><summary>查看来源、费用与依据</summary><p class="action-highlight-original-title">${e(repository || item.title || title)}</p><p>${e(entry.cost || '费用待确认')}</p><p class="daily-highlight-basis">依据：${e(entry.basis || '来源标题和简介，未实测')}</p><p class="action-highlight-audience-note">适合谁是阅读提示；准确条件以原站最新说明为准。</p><div class="daily-highlight-origin"><p>来源：${e(sourceNames || '来源待确认')}</p><p>${time(entry.timeLabel || '来源时间',entry.timeValue)}${entry.capturedAt && !(entry.capturedAt===entry.timeValue && (entry.timeLabel?.includes('采集') || entry.fixed)) ? time('采集于',entry.capturedAt) : ''}</p></div></details>
        <div class="daily-highlight-actions"><button type="button" class="btn-primary-action action-highlight-try" id="daily-try-${id}" data-material-start="try" data-item-id="${id}" aria-label="我想试试：${e(purpose)}">我想试试 <span aria-hidden="true">→</span></button><button type="button" class="btn-secondary-quiet" id="daily-write-${id}" data-material-start="write" data-item-id="${id}" aria-label="做成选题：${e(purpose)}">做成选题</button><button type="button" class="btn-quiet ${saved ? 'daily-highlight-collected' : ''}" id="daily-collect-${id}" data-action="${archived ? 'restore-collection' : 'toggle-save'}" data-item-id="${collectionId}" aria-pressed="${!!saved}" aria-label="${saveLabel}：${e(title)}">${saveLabel}</button></div>${inTopic ? '<p class="daily-highlight-in-topic">这条材料已在选题卡中</p>' : ''}
      </li>`;
    }).join('')}</ol>` : `<div class="daily-highlights-empty"><p>当前范围还没有用途清楚、来源可用的材料，不用勉强凑数。</p><p>仍可查看来源板块，或在“管理来源”里调整显示；只看新增时不补旧材料。</p></div>`}
  </section>`;
}
