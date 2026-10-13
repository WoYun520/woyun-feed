import { CREATOR_CATALOG } from './creatorCatalog.js';
import { creatorPreferenceKey, readCreatorPreferences } from './creatorTutorials.js';
import { normalizePostImage } from './postMedia.js';
import { postStatusId } from './postStream.js';
import { postAuthorLabel } from './topicWorkspace.js';
import { homeViewName, readBoostTotal, selectHomeShowcase } from './homeShowcase.js';

const shorten = (value, maximum) => {
  const text = (typeof value === 'string' ? value : '').replace(/\s+/g, ' ').trim();
  const characters = Array.from(text);
  return characters.length > maximum ? characters.slice(0, maximum).join('') + '…' : text;
};

function preferenceStorage() {
  try { return globalThis.localStorage || null; }
  catch { return null; }
}

function withCreatorScope(state) {
  if (state?.creatorCatalog && state.creatorPreferences) return state;
  const store = preferenceStorage();
  const preferences = state?.creatorPreferences || (store
    ? readCreatorPreferences(store, creatorPreferenceKey(state?.mode, state?.publicPreview)).preferences : {});
  return {...state, creatorCatalog:state?.creatorCatalog || CREATOR_CATALOG, creatorPreferences:preferences};
}

function coverImage(post) {
  const records = [post.item, ...(post.records || [])];
  const record = records.find(item => (postStatusId(item?.original_url) === post.statusId || postStatusId(item?.canonical_url) === post.statusId)
    && normalizePostImage(item.post_image, post.originalUrl));
  return record ? normalizePostImage(record.post_image, post.originalUrl) : null;
}

function itemCover(item) {
  return normalizePostImage(item?.post_image, item?.original_url || item?.canonical_url);
}

function collectionFor(state, post) {
  const savedIds = state.savedItemIds || new Set(), archivedIds = state.archivedItemIds || new Set();
  const matches = item => item && (post.itemIds?.includes(item.id) || item.alias_ids?.some(id => post.itemIds?.includes(id))
    || postStatusId(item.original_url) === post.statusId || postStatusId(item.canonical_url) === post.statusId);
  const savedRecords = (state.savedItems || []).filter(matches);
  const archivedRecord = (state.archivedItems || []).find(matches) || savedRecords.find(item => archivedIds.has?.(item.id));
  const savedId = savedRecords[0]?.id || post.itemIds?.find(id => savedIds.has?.(id));
  const archivedId = archivedRecord?.id || post.itemIds?.find(id => archivedIds.has?.(id));
  return {saved:!!savedId, archived:!!archivedId, itemId:archivedId || savedId || post.item.id};
}

function sourceNames(entry, state) {
  if (entry.post?.sourceNames?.length) return entry.post.sourceNames;
  const names = (entry.item?.source_refs || []).map(id => state.sources?.find(source => source.id === id)?.name || id);
  return names.length ? names : ['来源未提供'];
}

export function renderHomeShowcase(app, state, {now} = {}) {
  const selection = selectHomeShowcase(withCreatorScope(state), {now});
  const view = homeViewName(app.homeView);
  const e = value => app.escapeHtml(value);
  const signature = renderSignature();
  const strap = renderStrap(e, selection);
  const body = view === 'yesterday'
    ? renderList(app, state, selection.yesterday, {id:'home-yesterday', title:'昨日全部精华帖', note:yesterdayNote(selection)})
    : view === 'week' ? renderWeek(app, state, selection)
    : view === 'kept' ? renderKept(app, state, selection)
    : renderLatest(app, state, selection);
  return `<div class="home-showcase">${renderKosxStrip(app)}<div class="home-hero">${signature}${renderBoostWatermark(app)}</div>${strap}${body}</div>`;
}

function renderKosxStrip(app) {
  const open = app?.kosxOpen === true;
  const draft = typeof app?.kosxDraft === 'string' ? app.kosxDraft : '';
  const message = typeof app?.kosxMessage === 'string' ? app.kosxMessage : '';
  const error = typeof app?.kosxError === 'string' ? app.kosxError : '';
  const status = message || error;
  const e = value => app.escapeHtml(value);
  return `<section class="kosx-band" aria-label="KOSX 助力计划"><div class="kosx-strip"><p class="kosx-name">KOSX 助力计划</p><p class="kosx-hint">上传你的精华帖链接</p><button type="button" class="kosx-cta" id="kosx-open" aria-expanded="${open ? 'true' : 'false'}" aria-controls="kosx-panel">贴链接</button></div><form class="kosx-panel" id="kosx-panel"${open ? '' : ' hidden'}><label for="kosx-link">粘贴 X 精华帖链接</label><input id="kosx-link" name="url" type="url" inputmode="url" autocomplete="off" spellcheck="false" maxlength="2000" placeholder="粘贴 X 精华帖链接" value="${e(draft)}"><button type="submit" class="kosx-submit">提交</button><p class="kosx-status" id="kosx-status" role="${error ? 'alert' : 'status'}" tabindex="-1">${e(status)}</p></form></section>`;
}

function renderBoostWatermark(app) {
  const stored = readBoostTotal(preferenceStorage());
  const count = Number.isSafeInteger(app?.homeBoostCount) && app.homeBoostCount >= 0 ? app.homeBoostCount : stored;
  return `<aside class="boost-watermark" aria-label="已助力"><span class="boost-watermark-label">已助力</span><span class="boost-watermark-figure"><span class="boost-watermark-wash" aria-hidden="true"></span><span class="boost-watermark-count" id="home-boost-count">${count}</span></span></aside>`;
}

function renderSignature() {
  const letters = ['L', 'e', 'v', 'i', 'f', 'l', 'o', 'w'];
  return `<section class="levi-signature" aria-labelledby="levi-flow-title"><p class="levi-kicker">Levi</p><h1 id="levi-flow-title" class="levi-flow" aria-label="Levi flow">${letters.map((letter, index) => `<span${index === 4 ? ' class="levi-word"' : ''}>${letter}</span>`).join('')}</h1><svg class="levi-scribble" viewBox="0 0 360 28" aria-hidden="true"><path d="M6 16c28-12 42 10 70 2 24-8 36 12 62 4 22-6 40 10 66 2 28-8 48 12 78 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></section>`;
}

function renderStrap(e, selection) {
  const when = selection.reference.dateKey ? `<time datetime="${e(selection.reference.iso)}">${e(selection.reference.dateKey)}</time>` : '时间未提供';
  const clock = selection.reference.source === 'generated_at'
    ? `昨日和七日按公开资料整理日（北京时间）${when} 计算，不是打开页面的时钟。`
    : '这批资料没有整理时间，昨日和七日按当前北京时间计算。';
  return `<p class="home-strap">卧云信息流把公开帖放在一起。先看封面和摘录，再打开原帖。收藏和手动精选只留在这个浏览器。${clock}</p>`;
}

function yesterdayNote(selection) {
  const day = selection.reference.yesterday || '未能确定';
  return `昨日全部是整理日的前一个北京时间自然日（${day}）里、通过现有质量规则的公开帖，按发布时间从新到旧。已收起抽奖或推广信号 ${selection.counts.folded} 条。未核对原帖，未实测。`;
}

function latestNote(selection) {
  const short = selection.latest.length < 18 ? `符合条件的公开帖只有 ${selection.latest.length} 条，没有用假帖补满 18 条。` : '这里是最近 18 条，不是热度榜。';
  const folded = selection.counts.folded ? `现有质量规则收起了 ${selection.counts.folded} 条抽奖或推广信号。` : '现有质量规则没有收起抽奖或推广信号。';
  const undated = selection.counts.undated ? `另有 ${selection.counts.undated} 条没有可用时间，没有放进最新、昨日或七日。` : '';
  return `最新精华按原帖发布时间排列；没有发布时间时用榜单条目时间，再没有则用采集时间。${short}${folded}摘录里能认出操作步骤的帖不足 18 条，所以没有把“教程精选”冒充成这 18 条。未核对原帖，未实测。${undated}`;
}

function renderLatest(app, state, selection) {
  const e = value => app.escapeHtml(value);
  return `<section class="home-band" id="home-latest" aria-labelledby="home-latest-title"><header class="home-band-heading"><h2 id="home-latest-title">最新精华帖 <small>${selection.latest.length} / 18</small></h2><p class="home-rule">${e(latestNote(selection))}</p></header>${renderCards(app, state, selection.latest, 'latest')}</section>${renderMarquee(e)}<section class="home-band home-underrated" id="home-underrated" aria-labelledby="home-underrated-title" data-underrated-rule="${e(selection.underratedRule)}"><header class="home-band-heading"><h2 id="home-underrated-title">昨日最被低估精华帖 <small>${selection.underrated.length}</small></h2><p class="home-rule">${e(selection.underratedNote)}</p></header>${selection.underrated.length ? renderCards(app, state, selection.underrated, 'under') : '<p class="home-empty">昨日没有可放入这一栏的公开帖。</p>'}</section>`;
}

function renderMarquee(e) {
  const line = '你的文章，值得被看见';
  return `<div class="home-marquee" id="home-marquee" role="separator" aria-label="幕布"><div class="home-marquee-track"><span>${e(line)}</span><span aria-hidden="true">${e(line)}</span></div></div>`;
}

function renderList(app, state, entries, {id, title, note}) {
  const e = value => app.escapeHtml(value);
  return `<section class="home-band" id="${e(id)}" aria-labelledby="${e(id)}-title"><header class="home-band-heading"><h2 id="${e(id)}-title">${e(title)} <small>${entries.length}</small></h2><p class="home-rule">${e(note)}</p></header>${entries.length ? renderCards(app, state, entries, id) : '<p class="home-empty">这个范围里没有通过现有质量规则的公开帖。没有补假帖。</p>'}</section>`;
}

function renderWeek(app, state, selection) {
  const e = value => app.escapeHtml(value);
  const span = selection.reference.weekStart && selection.reference.weekEnd ? `${selection.reference.weekStart} 至 ${selection.reference.weekEnd}` : '日期未能确定';
  const note = `七日是整理日往前共 7 个北京时间自然日（${span}，含整理日）。先列出摘录里有操作线索的帖，这是现有推文初筛；同窗口其余公开帖按发布时间附在后面。未实测。`;
  return `<section class="home-band" id="home-week" aria-labelledby="home-week-title"><header class="home-band-heading"><h2 id="home-week-title">七日精选精华帖 <small>${selection.weekLeads.length + selection.weekRest.length}</small></h2><p class="home-rule">${e(note)}</p></header><h3 class="home-subhead">摘录含操作线索 <small>${selection.weekLeads.length}</small></h3>${selection.weekLeads.length ? renderCards(app, state, selection.weekLeads, 'week-lead') : '<p class="home-empty">这七日的摘录里没有认出命令或操作步骤。没有用其他帖冒充教程。</p>'}<h3 class="home-subhead">同七日其余公开帖 <small>${selection.weekRest.length}</small></h3><p class="home-rule">按发布时间排列，不是另一套精选算法。</p>${selection.weekRest.length ? renderCards(app, state, selection.weekRest, 'week-rest') : '<p class="home-empty">这一窗口没有其余公开帖。</p>'}</section>`;
}

function renderKept(app, state, selection) {
  const e = value => app.escapeHtml(value);
  const featured = selection.kept.featured, saved = selection.kept.saved;
  const note = '卧云精选贴读取这个浏览器里已经保存的手动精选和收藏，不另建本地库。手动选入或收藏不等于已实测。换浏览器或清空站点数据后这里会空。';
  return `<section class="home-band" id="home-kept" aria-labelledby="home-kept-title"><header class="home-band-heading"><h2 id="home-kept-title">卧云精选贴（常驻保存） <small>${featured.length + saved.length}</small></h2><p class="home-rule">${e(note)}</p></header><h3 class="home-subhead">我选入的精选 <small>${featured.length}</small></h3>${featured.length ? renderItemCards(app, state, featured, 'kept-featured') : '<p class="home-empty">这个浏览器还没有选入精选。选入仍由人工决定，不会自动出现在首页。</p>'}<h3 class="home-subhead">已收藏 <small>${saved.length}</small></h3>${saved.length ? renderItemCards(app, state, saved, 'kept-saved') : '<p class="home-empty">还没有收藏。点卡片上的收藏，会写在这个浏览器里。</p>'}${selection.kept.archivedCount ? `<p class="home-rule">另有归档材料留在这个浏览器，不重复列在这里。</p>` : ''}</section>`;
}

function renderCards(app, state, entries, group) {
  return `<div class="cover-grid">${entries.map(entry => renderPostCard(app, state, entry, group)).join('')}</div>`;
}

function renderPostCard(app, state, entry, group) {
  const post = entry.post, item = post.item, e = value => app.escapeHtml(value);
  const title = item.title || '来源未提供标题';
  const excerpt = typeof item.summary === 'string' ? item.summary.trim() : '';
  const image = coverImage(post);
  const collection = collectionFor(state, post);
  const id = e(item.id);
  const names = sourceNames(entry, state).join('、');
  const author = postAuthorLabel(item);
  const heat = typeof item.heat_label === 'string' && item.heat_label.trim() ? item.heat_label.trim() : '';
  const when = entry.time.iso ? `<time datetime="${e(entry.time.iso)}">${e(app.formatTime ? app.formatTime(entry.time.iso) : entry.time.iso)}</time>` : '时间未提供';
  return `<article class="cover-card shape-card" id="home-card-${e(group)}-${id}" data-shape="card" data-home-card="${id}" data-home-group="${e(group)}">
    ${renderCover(app, item, title, image, post.originalUrl, `${group}:${item.id}`)}
    <div class="cover-body"><p class="cover-meta"><span>${e(names)}</span>${author ? `<span>${e(author)}</span>` : ''}<span>${e(entry.time.label)} ${when}</span></p>
      <h3><a href="${e(app.safeUrl(post.originalUrl))}" target="_blank" rel="noopener noreferrer">${e(title)}</a></h3>
      <p class="cover-excerpt">${e(shorten(excerpt, 96) || '来源未提供摘录，请打开原帖。')}</p>
      <details class="cover-evidence"><summary>摘录与时间依据</summary><p>${e(excerpt || '来源未提供摘录。')}</p>${heat ? `<p>来源标注：${e(heat)}。未核对。</p>` : '<p>来源没有给出可展示的热度文字。</p>'}<p>${e(entry.time.label)}。未核对原帖，未实测。</p>${post.instruction?.eligible ? `<p>${e(post.instruction.label)}。这是摘录里的线索，不是实测。</p>` : ''}</details>
      <div class="cover-actions"><a class="shape-pill-solid" href="${e(app.safeUrl(post.originalUrl))}" target="_blank" rel="noopener noreferrer">打开原帖</a>${saveButton(e, collection, `home-save-${group}-${item.id}`, title)}</div>
    </div></article>`;
}

function renderItemCards(app, state, items, group) {
  return `<div class="cover-grid">${items.map(item => renderKeptCard(app, state, item, group)).join('')}</div>`;
}

function renderKeptCard(app, state, item, group) {
  const e = value => app.escapeHtml(value), title = item.title || '已保存的材料';
  const excerpt = typeof item.summary === 'string' ? item.summary.trim() : '';
  const image = itemCover(item);
  const time = [item.published_at, item.source_item_time, item.captured_at].find(value => typeof value === 'string' && Number.isFinite(Date.parse(value)));
  const label = item.published_at === time ? '原帖发布时间' : item.source_item_time === time ? '榜单条目时间' : time ? '采集或阅读时间' : '时间未提供';
  const names = (item.source_refs || []).map(id => state.sources?.find(source => source.id === id)?.name || (item.origin === 'dot_import' ? '手动精选' : id));
  const archived = state.archivedItemIds?.has?.(item.id);
  const saved = !archived && (group === 'kept-saved' || state.savedItemIds?.has?.(item.id));
  const collection = {saved, archived, itemId:item.id};
  const id = e(item.id);
  return `<article class="cover-card shape-card" id="home-card-${e(group)}-${id}" data-shape="card" data-home-card="${id}" data-home-group="${e(group)}">
    ${renderCover(app, item, title, image, item.original_url, `${group}:${item.id}`)}
    <div class="cover-body"><p class="cover-meta"><span>${e(names.filter(Boolean).join('、') || '来源未提供')}</span><span>${e(label)}${time ? ` <time datetime="${e(time)}">${e(app.formatTime ? app.formatTime(time) : time)}</time>` : ''}</span></p>
      <h3><a href="${e(app.safeUrl(item.original_url))}" target="_blank" rel="noopener noreferrer">${e(title)}</a></h3>
      <p class="cover-excerpt">${e(shorten(excerpt, 96) || '没有摘录。')}</p>
      <div class="cover-actions"><a class="shape-pill-solid" href="${e(app.safeUrl(item.original_url))}" target="_blank" rel="noopener noreferrer">打开原帖</a>${saveButton(e, collection, `home-save-${group}-${item.id}`, title)}</div>
    </div></article>`;
}

function renderCover(app, item, title, image, originalUrl, key) {
  const e = value => app.escapeHtml(value);
  const fallback = `<div class="cover-fallback"${image ? ' aria-hidden="true"' : ''}><p>无来源附图</p><strong>${e(shorten(title, 72))}</strong></div>`;
  if (!image) return `<div class="cover-frame">${fallback}<a class="cover-hit" href="${e(app.safeUrl(originalUrl))}" target="_blank" rel="noopener noreferrer" aria-label="${e(`打开原帖：${title}`)}"></a></div>`;
  const kind = image.kind === 'video_poster' ? '视频封面，未播放' : '来源附图，未核对原帖';
  return `<div class="cover-frame">${fallback}<figure class="cover-photo" data-post-media><img src="${e(image.url)}" alt="${e(kind)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-post-media-thumb><button type="button" class="cover-zoom" data-post-media-open data-post-media-key="${e(key)}" data-post-media-url="${e(image.url)}" data-post-media-kind="${e(image.kind)}" data-post-media-source="${e(image.source_url)}" data-post-media-original="${e(originalUrl)}" aria-label="${e(`放大${kind}：${title}`)}">放大</button><figcaption>${e(kind)}</figcaption></figure><a class="cover-hit" href="${e(app.safeUrl(originalUrl))}" target="_blank" rel="noopener noreferrer" aria-label="${e(`打开原帖：${title}`)}"></a></div>`;
}

function saveButton(e, collection, id, title) {
  const label = collection.archived ? '恢复收藏' : collection.saved ? '取消收藏' : '收藏';
  return `<button type="button" class="btn-quiet shape-pill-line${collection.saved ? ' is-saved' : ''}" id="${e(id)}" data-action="${collection.archived ? 'restore-collection' : 'toggle-save'}" data-item-id="${e(collection.itemId)}" aria-pressed="${collection.saved ? 'true' : 'false'}" aria-label="${e(`${label}：${title}`)}">${label}</button>`;
}
