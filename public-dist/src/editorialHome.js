import { renderDailyHighlights } from './dailyHighlightsView.js';
import { renderPostMedia } from './postMediaView.js';

const CATEGORY_LABELS = { tutorial:'操作教程', cognition:'思路与经验' };
const READ_LABELS = { main_post:'只读主帖', full_thread:'记录为完整线程，尚待核对', search_excerpt:'仅见搜索摘录' };
const plain = value => typeof value === 'string' ? value.trim() : '';
const shorten = (value,maximum) => {
  const text=plain(value).replace(/\s+/g,' '),characters=Array.from(text);
  return characters.length>maximum ? characters.slice(0,maximum).join('')+'…' : text;
};

// This cover is derived exclusively from existing human-featured records.
// It never promotes pending material, rewrites evidence, or creates cover art.
export function editorialFeaturedItems(state,{limit=3}={}) {
  const hidden=state.hiddenItemIds instanceof Set ? state.hiddenItemIds : new Set(state.hiddenItemIds || []);
  return (state.dotFeaturedItems || []).filter(item=>item && typeof item.id==='string'
    && !hidden.has(item.id) && !(item.alias_ids || []).some(id=>hidden.has(id))).slice(0,limit);
}

function renderFeaturedCard(app,state,item,index) {
  const e=value=>app.escapeHtml(value),id=e(item.id),title=plain(item.title) || '已选入的材料';
  const collector=plain(item.collector) || (item.origin==='feedgrab_import' ? 'feedgrab' : 'Dot');
  const summary=plain(item.summary),short=shorten(summary,index===0 ? 180 : 90);
  const note=plain(state.savedItemNotes?.[item.id]?.note);
  const inTopic=(state.topics || []).some(topic=>(topic.materials || []).some(material=>material.item?.id===item.id
    || item.alias_ids?.includes(material.item?.id) || (item.canonical_url && material.item?.canonical_url===item.canonical_url)));
  const bookmark=Number.isSafeInteger(item.bookmark_count) && item.bookmark_count>=0 ? item.bookmark_count.toLocaleString('zh-CN') : '';
  const time=value=>typeof value==='string' && Number.isFinite(Date.parse(value)) ? e(app.formatTime ? app.formatTime(value) : value) : '未提供';
  return `<article class="editorial-feature${index===0 ? ' editorial-feature-lead' : ' editorial-feature-side'}" id="editorial-feature-${id}" data-editorial-feature="${id}">
    <div class="editorial-feature-meta"><span class="editorial-feature-number" aria-hidden="true">${String(index+1).padStart(2,'0')}</span><span>${e(CATEGORY_LABELS[item.category] || '精选材料')}</span><span>${e(item.author_handle ? '@'+item.author_handle.replace(/^@/,'') : '作者未提供')}</span></div>
    ${renderPostMedia(app,item,{variant:'highlight'})}
    <h3><a href="${e(app.safeUrl(item.original_url))}" target="_blank" rel="noopener noreferrer">${e(title)}<span aria-hidden="true"> ↗</span></a></h3>
    <p class="editorial-feature-summary">${e(short || '先打开原帖，看看这条材料是否值得继续整理。')}</p>
    ${note ? `<p class="editorial-feature-personal"><span>我的想法</span>${e(shorten(note,120))}</p>` : ''}
    <div class="editorial-feature-footnote"><span>${e(collector)} ${e(READ_LABELS[item.read_scope] || '阅读范围未提供')} · 未实测</span>${bookmark ? `<span>收藏记录 ${e(bookmark)}</span>` : ''}</div>
    <details class="editorial-feature-evidence" data-excerpt-details="${e('editorial:'+item.id)}" ${app.openExcerptDetails?.has('editorial:'+item.id) ? 'open' : ''}><summary>查看完整材料与采集依据</summary><div class="editorial-feature-fulltext">${e(summary || '未提供正文摘录。')}</div>${item.recommendation_reason ? `<p><strong>采集者推荐理由：</strong>${e(item.recommendation_reason)}</p>` : ''}${item.my_angle ? `<p><strong>采集者建议角度：</strong>${e(item.my_angle)}</p>` : ''}<dl class="editorial-feature-record"><div><dt>采集时间</dt><dd>${time(item.collector_collected_at || item.captured_at)}</dd></div><div><dt>热度查看时间</dt><dd>${time(item.metrics_checked_at)}</dd></div><div><dt>原帖发布时间</dt><dd>${time(item.published_at)}${item.published_at ? '' : '；采集时间不代表发布时间'}</dd></div></dl>${(item.unknowns || []).length ? `<p><strong>尚待核对：</strong></p><ul>${item.unknowns.map(value=>`<li>${e(value)}</li>`).join('')}</ul>` : ''}<p>手动选入表示你愿意留下这条材料，不代表内容或热度已经核验。</p></details>
    <div class="editorial-feature-actions"><button type="button" class="btn-primary-action" id="editorial-topic-${id}" data-action="topic-save" data-item-id="${id}">放进主题 <span aria-hidden="true">→</span></button><a href="${e(app.safeUrl(item.original_url))}" target="_blank" rel="noopener noreferrer">读原帖 ↗</a>${inTopic ? '<span class="editorial-feature-in-topic">已在主题</span>' : ''}</div>
  </article>`;
}

export function renderEditorialFeatured(app,state) {
  const e=value=>app.escapeHtml(value),items=editorialFeaturedItems(state),all=state.dotFeaturedItems || [];
  return all.length ? `<section class="editorial-featured" aria-labelledby="editorial-featured-heading">
    <header class="editorial-section-heading"><div><p class="editorial-section-kicker">THE SHORTLIST / 我留下的好材料</p><h2 id="editorial-featured-heading">我选的精选 <small>${items.length ? `${items.length} / ` : ''}${all.length}</small></h2></div><button type="button" class="btn-secondary-quiet" data-dot-open-featured>管理精选 <span aria-hidden="true">↗</span></button></header>
    <p class="editorial-section-note">手动选入 · 保留原始采集内容 · 尚未实测 · 只保存在这个浏览器</p>
    ${items.length ? `<div class="editorial-feature-grid${items.length===1 ? ' editorial-feature-grid-single' : ''}">${items.map((item,index)=>renderFeaturedCard(app,state,item,index)).join('')}</div>` : '<p class="editorial-feature-hidden">精选目前都已隐藏，可在“我的关注”恢复；它们仍保存在资料中。</p>'}
    ${all.length>items.length && items.length ? `<div class="editorial-feature-more"><span>好材料值得慢慢看。</span><button type="button" class="btn-quiet" data-dot-open-featured>查看全部 ${e(all.length)} 条精选 →</button></div>` : ''}
  </section>` : '';
}

export function renderEditorialRecommendations(app,state,{now}={}) {
  return `<div class="editorial-recommendations${editorialFeaturedItems(state).length ? '' : ' editorial-recommendations-leading'}">${renderDailyHighlights(app,state,{now})}</div>`;
}

export function renderEditorialHome(app,state,{now}={}) {
  return `${renderEditorialFeatured(app,state)}${renderEditorialRecommendations(app,state,{now})}`;
}
