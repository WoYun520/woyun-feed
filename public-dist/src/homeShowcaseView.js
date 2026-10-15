import { CREATOR_CATALOG } from './creatorCatalog.js';
import { creatorPreferenceKey, readCreatorPreferences } from './creatorTutorials.js';
import { normalizeCoverUrl, normalizePostImage } from './postMedia.js';
import { postStatusId } from './postStream.js';
import { postAuthorLabel } from './topicWorkspace.js';
import { isKosxPoolHandle } from '../kosx-pool.js';
import { HOME_KEPT_BOOKMARK_MIN, homeViewName, isArticleClassItem, readBoostTotal, selectHomeShowcase } from './homeShowcase.js';
import { isReviewSignalCopy } from './reviewQueue.js';

export const KOSX_EMOJI_ALT = 'KOSX 精选计划表情';
export const KOSX_EMOJI_INTERVAL_MS = 600;
export const KOSX_EMOJI_FRAMES = [1, 2, 3, 4, 5, 6].map(frame => `/assets/kosx/emoji/kosx-emoji-0${frame}-80.png`);

let kosxEmojiIndex = 0;
let kosxEmojiTimer = 0;
let kosxEmojiRoot = null;
let kosxEmojiView = null;
let kosxEmojiMedia = null;
let kosxEmojiCache = [];

export function kosxEmojiFrame(index, reducedMotion = false) {
  if (reducedMotion) return 0;
  const count = KOSX_EMOJI_FRAMES.length;
  const current = Number.isInteger(index) ? index : 0;
  return ((current % count) + count) % count;
}

function kosxEmojiReduced() {
  return kosxEmojiMedia?.matches === true;
}

function stopKosxEmojiTimer() {
  if (!kosxEmojiTimer) return;
  (kosxEmojiView || globalThis).clearInterval(kosxEmojiTimer);
  kosxEmojiTimer = 0;
}

export function resetKosxEmoji() {
  stopKosxEmojiTimer();
  kosxEmojiMedia?.removeEventListener?.('change', syncKosxEmoji);
  kosxEmojiIndex = 0;
  kosxEmojiRoot = null;
  kosxEmojiView = null;
  kosxEmojiMedia = null;
  kosxEmojiCache = [];
}

function preloadKosxEmoji(view) {
  if (kosxEmojiCache.length || typeof view?.Image !== 'function') return;
  kosxEmojiCache = KOSX_EMOJI_FRAMES.map(src => {
    const image = new view.Image();
    image.decoding = 'sync';
    image.src = src;
    return image;
  });
}

function kosxEmojiReady(index) {
  const cached = kosxEmojiCache[index];
  return !cached || cached.complete !== false;
}

function paintKosxEmoji(img) {
  const frame = kosxEmojiFrame(kosxEmojiIndex, kosxEmojiReduced());
  kosxEmojiIndex = frame;
  const src = KOSX_EMOJI_FRAMES[frame];
  if (img.getAttribute?.('src') !== src && img.src !== src) img.src = src;
  if (img.alt !== KOSX_EMOJI_ALT) img.alt = KOSX_EMOJI_ALT;
}

function syncKosxEmoji() {
  const img = kosxEmojiRoot?.querySelector?.('[data-kosx-emoji]');
  if (!img) {
    stopKosxEmojiTimer();
    return;
  }
  paintKosxEmoji(img);
  if (kosxEmojiReduced()) {
    stopKosxEmojiTimer();
    return;
  }
  if (kosxEmojiTimer) return;
  const view = kosxEmojiView || globalThis;
  kosxEmojiTimer = view.setInterval(() => {
    const node = kosxEmojiRoot?.querySelector?.('[data-kosx-emoji]');
    if (!node) {
      stopKosxEmojiTimer();
      return;
    }
    if (kosxEmojiReduced()) {
      kosxEmojiIndex = 0;
      paintKosxEmoji(node);
      stopKosxEmojiTimer();
      return;
    }
    const next = kosxEmojiFrame(kosxEmojiIndex + 1);
    if (!kosxEmojiReady(next)) return;
    kosxEmojiIndex = next;
    if (node.src !== KOSX_EMOJI_FRAMES[next]) node.src = KOSX_EMOJI_FRAMES[next];
    if (node.alt !== KOSX_EMOJI_ALT) node.alt = KOSX_EMOJI_ALT;
  }, KOSX_EMOJI_INTERVAL_MS);
}

export function mountKosxEmoji(root = globalThis.document) {
  kosxEmojiRoot = root || null;
  kosxEmojiView = root?.defaultView || globalThis;
  preloadKosxEmoji(kosxEmojiView);
  if (!kosxEmojiMedia && typeof kosxEmojiView.matchMedia === 'function') {
    kosxEmojiMedia = kosxEmojiView.matchMedia('(prefers-reduced-motion: reduce)');
    kosxEmojiMedia.addEventListener?.('change', syncKosxEmoji);
  }
  syncKosxEmoji();
}

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

function isKosxCard(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.origin === 'kosx_approved') return true;
  const refs = item.source_refs;
  return Array.isArray(refs) && refs.length === 1 && refs[0] === 'sopilot-kosx';
}

// Article-class KOSX cards use a delivered cover when one was stored.
// Anything else stays on the text card: a quote, or title and meta.
function articleCover(item) {
  if (!isKosxCard(item) || !isArticleClassItem(item)) return null;
  const url = normalizeCoverUrl(item?.cover_url);
  return url ? {url, kind:'article_cover'} : null;
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

function homepageSourceLabel(name) {
  const text = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  if (!text || /^sopilot$/i.test(text)) return '';
  return text.replace(/^SoPilot\s*[·•.\-]\s*/u, '').trim();
}

function sourceNames(entry, state) {
  const raw = entry.post?.sourceNames?.length
    ? entry.post.sourceNames
    : (entry.item?.source_refs || []).map(id => state.sources?.find(source => source.id === id)?.name || id);
  const names = raw.map(homepageSourceLabel).filter(Boolean);
  return names.length ? names : ['来源未提供'];
}

export function renderHomeShowcase(app, state, {now} = {}) {
  const selection = selectHomeShowcase(withCreatorScope(state), {now});
  const view = homeViewName(app.homeView);
  const signature = renderSignature();
  const body = view === 'yesterday'
    ? renderList(app, state, selection.yesterday, {id:'home-yesterday', title:'昨日全部精华帖', note:yesterdayNote(selection)})
    : view === 'week' ? renderWeek(app, state, selection)
    : view === 'kept' ? renderKept(app, state, selection)
    : renderLatest(app, state, selection);
  return `<div class="home-showcase">${renderKosxStrip(app)}<div class="home-hero">${signature}${renderBoostWatermark(app)}</div>${body}${renderKosxFooter()}</div>`;
}

function renderKosxStrip(app) {
  const open = app?.kosxOpen === true;
  const draft = typeof app?.kosxDraft === 'string' ? app.kosxDraft : '';
  const message = typeof app?.kosxMessage === 'string' ? app.kosxMessage : '';
  const error = typeof app?.kosxError === 'string' ? app.kosxError : '';
  const status = message || error;
  const e = value => app.escapeHtml(value);
  return `<section class="kosx-band" aria-label="KOSX 精选计划"><div class="kosx-strip"><div class="kosx-brand"><img class="kosx-mark" src="/assets/kosx/symbol-ink.svg" width="30" height="30" alt="KOSX 四瓣标志"><p class="kosx-name">KOSX 精选计划</p><img class="kosx-emoji" src="${KOSX_EMOJI_FRAMES[0]}" width="40" height="40" alt="${KOSX_EMOJI_ALT}" data-kosx-emoji></div><div class="kosx-middle"><p class="kosx-hint">上传你的精华帖链接</p><span class="kosx-paste"><span class="kosx-accent" aria-hidden="true"></span><button type="button" class="kosx-cta" id="kosx-open" aria-expanded="${open ? 'true' : 'false'}" aria-controls="kosx-panel">贴链接</button></span></div></div><form class="kosx-panel" id="kosx-panel"${open ? '' : ' hidden'}><label for="kosx-link">粘贴 X 精华帖链接</label><input id="kosx-link" name="url" type="url" inputmode="url" autocomplete="off" spellcheck="false" maxlength="2000" placeholder="粘贴 X 精华帖链接" value="${e(draft)}"><button type="submit" class="kosx-submit">提交</button><p class="kosx-status" id="kosx-status" role="${error ? 'alert' : 'status'}" tabindex="-1">${e(status)}</p></form></section>`;
}

function renderKosxFooter() {
  return `<footer class="kosx-footer"><img class="kosx-wordmark" src="/assets/kosx/wordmark-ink.svg" width="187" height="32" alt="KOSX.ai，橙色圆点"></footer>`;
}

function renderBoostWatermark(app) {
  const stored = readBoostTotal(preferenceStorage());
  const count = Number.isSafeInteger(app?.homeBoostCount) && app.homeBoostCount >= 0 ? app.homeBoostCount : stored;
  return `<aside class="boost-watermark" aria-label="已助力"><span class="boost-watermark-label">已助力</span><span class="boost-watermark-figure"><span class="boost-watermark-wash" aria-hidden="true"></span><span class="boost-watermark-count" id="home-boost-count">${count}</span></span></aside>`;
}

function renderSignature() {
  const letters = ['L', 'e', 'v', 'i', 'f', 'l', 'o', 'w'];
  return `<section class="levi-signature" aria-labelledby="levi-flow-title"><h1 id="levi-flow-title" class="levi-flow" aria-label="Levi flow">${letters.map((letter, index) => `<span${index === 4 ? ' class="levi-word"' : ''}>${letter}</span>`).join('')}</h1><svg class="levi-scribble" viewBox="0 0 360 28" aria-hidden="true"><path d="M6 16c28-12 42 10 70 2 24-8 36 12 62 4 22-6 40 10 66 2 28-8 48 12 78 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg><p class="levi-kicker">LEVI</p></section>`;
}

function yesterdayNote(selection) {
  const day = selection.reference.yesterday || '未能确定';
  return `昨日全部是整理日的前一个北京时间自然日（${day}）里、已经放上公开首页的精华帖，按原帖发布时间从新到旧。包括过审写入公开首页的帖，以及账号池自动放上首页的帖。信息流里其他带日期的帖不放进来。已收起抽奖或推广信号 ${selection.counts.folded} 条。未核对原帖，未实测。`;
}

function renderLatest(app, state, selection) {
  const e = value => app.escapeHtml(value);
  const underrated = selection.underrated.length
    ? `<section class="home-band home-underrated" id="home-underrated" aria-labelledby="home-underrated-title" data-underrated-rule="${e(selection.underratedRule)}"><header class="home-band-heading"><h2 id="home-underrated-title">昨日最被低估精华帖 <small>${selection.underrated.length}</small></h2></header>${renderCards(app, state, selection.underrated, 'under')}</section>`
    : '';
  return `<section class="home-band" id="home-latest" aria-labelledby="home-latest-title"><header class="home-band-heading"><h2 id="home-latest-title">最新精华帖 <small>${selection.latest.length} / 18</small></h2></header>${renderCards(app, state, selection.latest, 'latest')}</section>${renderSlogan(e)}${underrated}`;
}

function renderSlogan(e) {
  return `<p class="home-slogan" id="home-marquee" aria-label="幕布"><span class="home-slogan-line">${e('你的文章，值得被看见')}</span></p>`;
}

function renderList(app, state, entries, {id, title, note}) {
  const e = value => app.escapeHtml(value);
  return `<section class="home-band" id="${e(id)}" aria-labelledby="${e(id)}-title"><header class="home-band-heading"><h2 id="${e(id)}-title">${e(title)} <small>${entries.length}</small></h2><p class="home-rule">${e(note)}</p></header>${entries.length ? renderCards(app, state, entries, id) : '<p class="home-empty">这一日没有放上公开首页的精华帖。没有把信息流里其他帖补进来。</p>'}</section>`;
}

function renderWeek(app, state, selection) {
  const e = value => app.escapeHtml(value);
  const entries = selection.week;
  return `<section class="home-band" id="home-week" aria-labelledby="home-week-title" data-week-rule="${e(selection.weekRule)}"><header class="home-band-heading"><h2 id="home-week-title">七日精选精华帖 <small>${entries.length}</small></h2><p class="home-rule">${e(selection.weekNote)}</p></header>${entries.length ? renderCards(app, state, entries, 'week') : '<p class="home-empty">这七日没有留下精华文章。没有把其余公开帖补进来。</p>'}</section>`;
}

function renderKept(app, state, selection) {
  const e = value => app.escapeHtml(value);
  const entries = Array.isArray(selection.kept) ? selection.kept : [];
  const empty = `还没有收藏数达到 ${HOME_KEPT_BOOKMARK_MIN} 的精华文章。没有把其余公开帖补进来。`;
  return `<section class="home-band" id="home-kept" aria-labelledby="home-kept-title"><header class="home-band-heading"><h2 id="home-kept-title">卧云精选精华帖 <small>${entries.length}</small></h2><p class="home-rule">${e(selection.keptNote || '')}</p></header>${entries.length ? renderCards(app, state, entries, 'kept') : `<p class="home-empty">${e(empty)}</p>`}</section>`;
}

function itemAuthorHandle(item) {
  if (typeof item?.author_handle === 'string' && /^[A-Za-z0-9_]{1,15}$/.test(item.author_handle)) return item.author_handle;
  for (const value of [item?.original_url, item?.canonical_url]) {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      const host = url.hostname.replace(/^www\./, '').toLowerCase();
      if (host !== 'x.com' && host !== 'twitter.com') continue;
      const handle = url.pathname.split('/').filter(Boolean)[0] || '';
      if (/^[A-Za-z0-9_]{1,15}$/.test(handle) && handle.toLowerCase() !== 'i') return handle;
    } catch { /* not a post url */ }
  }
  return '';
}

// Pool auto-approve stores kosx_review:"pool". Other cover posts only carry the author,
// so membership falls back to the same impact.kosx.ai handle list used at intake.
function kosxPoolBadge(item) {
  if (item?.kosx_review === 'pool' || isKosxPoolHandle(itemAuthorHandle(item))) return '<span class="kosx-pool-badge">KOSX</span>';
  return '';
}

// Old pool and review rows stored a process sentence as the excerpt. That
// sentence is not the post. A real note before it stays; the sentence does not.
function policyRemainder(rest) {
  const words = /账号池成员的精华帖|按时间放上首页|过审后放上首页|的 X 链接|尚未读取原文|未核对热度|不进入昨日最被低估/g;
  return !/[A-Za-z0-9\u4e00-\u9fff]/.test(rest.replace(words, ''));
}

export function coverExcerpt(summary) {
  const text = typeof summary === 'string' ? summary.trim() : '';
  if (!text) return '';
  const clause = /账号池成员的精华帖，按时间放上首页|过审后放上首页(?:的 X 链接)?|尚未读取原文，未核对热度|不进入昨日最被低估/g;
  let cut = text.length;
  for (const match of text.matchAll(clause)) {
    const index = match.index ?? 0;
    if (index < cut && policyRemainder(text.slice(index))) cut = index;
  }
  if (cut === text.length) return text;
  return text.slice(0, cut).replace(/[。．\s]+$/u, '').trim();
}

function renderCards(app, state, entries, group) {
  return `<div class="cover-grid">${entries.map(entry => renderPostCard(app, state, entry, group)).join('')}</div>`;
}

const hasClock = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

// The shelf clock already prefers published_at. created_at is the intake
// fallback when that field was never stored on the public row.
function cardClock(item, fallback) {
  if (fallback?.key === 'published' && fallback.iso) return {iso:fallback.iso, label:fallback.label};
  if (hasClock(item?.published_at)) return {iso:item.published_at, label:'原帖发布时间'};
  if (hasClock(item?.created_at)) return {iso:item.created_at, label:'原帖发布时间'};
  if (fallback?.iso) return {iso:fallback.iso, label:fallback.label || '时间未提供'};
  if (hasClock(item?.source_item_time)) return {iso:item.source_item_time, label:'榜单条目时间'};
  if (hasClock(item?.captured_at)) return {iso:item.captured_at, label:'采集或阅读时间'};
  return {iso:'', label:fallback?.label || '时间未提供'};
}

function authorCue(item) {
  const handle = itemAuthorHandle(item);
  const name = typeof item?.author_name === 'string' ? item.author_name.trim() : '';
  if (handle && name && name.toLowerCase() !== handle.toLowerCase()) return `${name} · @${handle}`;
  if (handle) return `@${handle}`;
  return postAuthorLabel(item);
}

function quoteText(excerpt) {
  const lines = excerpt.split(/\n+/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (lines.length > 1) return lines.slice(0, 2).join(' ');
  return excerpt.replace(/\s+/g, ' ').trim();
}

// The card face already shows the excerpt. Open the details only when that
// face is shorter than the real excerpt. Heat gaps and "未核对" lines stay off the card.
function cardEvidence(e, excerpt, mode) {
  const full = typeof excerpt === 'string' ? excerpt.trim() : '';
  if (!full) return '';
  const collapsed = full.replace(/\s+/g, ' ').trim();
  const visible = mode === 'media' ? shorten(full, 96) : quoteText(full);
  if (!visible || visible === collapsed || visible.replace(/…$/, '') === collapsed) return '';
  return `<details class="cover-evidence"><summary>摘录与时间依据</summary><p>${e(full)}</p></details>`;
}

// Classifier blurbs such as「文章卡·收藏5/点赞18·Levi样例·收藏偏低但类型优先」
// are review evidence. A real title stays. A signal line uses the same
// @handle 的精华帖 face as other essence cards.
function homepageCardTitle(item) {
  const title = typeof item?.title === 'string' ? item.title.trim() : '';
  if (!isReviewSignalCopy(title)) return title || '来源未提供标题';
  const handle = itemAuthorHandle(item);
  return handle ? `@${handle} 的精华帖` : '来源未提供标题';
}

// Intake sometimes glues a type tag onto a real sentence, as in
// 「宏观黑板微观树（文章卡）」. The tag is not the excerpt. A classifier
// blurb such as「文章卡·收藏5/点赞18·Levi样例·收藏偏低但类型优先」still drops.
function withoutClassifierTag(line) {
  const text = line.trim();
  const tagged = text
    .replace(/\s*[（(]\s*(?:文章卡|Article卡)\s*[）)]\s*$/u, '')
    .replace(/\s*(?:文章卡|Article卡)\s*$/u, '');
  if (tagged === text) return text;
  return tagged.replace(/[：:·\s]+$/u, '').trim();
}

function homepageCardExcerpt(summary) {
  const excerpt = coverExcerpt(summary);
  if (!excerpt) return '';
  return excerpt.split(/\n+/).map(line => {
    const cleaned = withoutClassifierTag(line);
    if (!cleaned || isReviewSignalCopy(cleaned)) return '';
    return cleaned;
  }).filter(Boolean).join('\n');
}

function renderPostCard(app, state, entry, group) {
  const post = entry.post, item = post.item;
  const title = homepageCardTitle(item);
  const excerpt = homepageCardExcerpt(item.summary);
  const image = articleCover(item) || coverImage(post);
  return renderShowcaseCard(app, {
    group, item, title, excerpt, image, originalUrl:post.originalUrl, mediaKey:`${group}:${item.id}`,
    collection:collectionFor(state, post), names:sourceNames(entry, state).join('、'),
    clock:cardClock(item, entry.time), saveId:`home-save-${group}-${item.id}`,
  });
}

function renderShowcaseCard(app, spec) {
  const e = value => app.escapeHtml(value);
  const {group, item, title, excerpt, image, originalUrl, mediaKey, collection, names, clock, saveId} = spec;
  const mode = image ? 'media' : excerpt ? 'quote' : 'plain';
  const id = e(item.id);
  const quote = quoteText(excerpt);
  const shown = clock.iso ? (app.formatTime ? app.formatTime(clock.iso) : clock.iso) : '';
  const kind = clock.iso && clock.label && clock.label !== '原帖发布时间' ? `<span class="cover-date-kind">${e(clock.label)}</span>` : '';
  const date = `<p class="cover-date">${kind}${clock.iso ? `<time datetime="${e(clock.iso)}">${e(shown)}</time>` : e(clock.label || '时间未提供')}</p>`;
  const quoteBlock = quote ? `<blockquote class="cover-quote"><span class="cover-quote-text">${e(quote)}</span></blockquote>` : '';
  const excerptLine = mode === 'media' && excerpt ? `<p class="cover-excerpt">${e(shorten(excerpt, 96))}</p>` : '';
  const evidence = cardEvidence(e, excerpt, mode);
  const author = authorCue(item);
  const cueBits = [
    kosxPoolBadge(item),
    author ? `<span class="cover-author">${e(author)}</span>` : '',
    names ? `<span>${e(names)}</span>` : '',
  ].filter(Boolean);
  return `<article class="cover-card shape-card" id="home-card-${e(group)}-${id}" data-shape="card" data-home-card="${id}" data-home-group="${e(group)}" data-cover="${mode}">
    ${date}
    ${quoteBlock}
    ${renderCover(app, title, image, originalUrl, mediaKey)}
    <div class="cover-body"><h3><a href="${e(app.safeUrl(originalUrl))}" target="_blank" rel="noopener noreferrer">${e(title)}</a></h3>
      ${excerptLine}
      ${cueBits.length ? `<p class="cover-cue">${cueBits.join('')}</p>` : ''}
      ${evidence}
      <div class="cover-actions"><a class="shape-pill-solid" href="${e(app.safeUrl(originalUrl))}" target="_blank" rel="noopener noreferrer">打开原帖</a>${saveButton(e, collection, saveId, title)}</div>
    </div></article>`;
}

function renderCover(app, title, image, originalUrl, key) {
  const e = value => app.escapeHtml(value);
  if (!image) return '';
  const hit = `<a class="cover-hit" href="${e(app.safeUrl(originalUrl))}" target="_blank" rel="noopener noreferrer" aria-label="${e(`打开原帖：${title}`)}"></a>`;
  if (image.kind === 'article_cover') {
    return `<div class="cover-frame"><figure class="cover-photo cover-article" data-post-media><img src="${e(image.url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-post-media-thumb></figure>${hit}</div>`;
  }
  const kind = image.kind === 'video_poster' ? '视频封面，未播放' : '来源附图';
  const caption = image.kind === 'video_poster' ? `<figcaption>${e(kind)}</figcaption>` : '';
  return `<div class="cover-frame"><figure class="cover-photo" data-post-media><img src="${e(image.url)}" alt="${e(kind)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-post-media-thumb><button type="button" class="cover-zoom" data-post-media-open data-post-media-key="${e(key)}" data-post-media-url="${e(image.url)}" data-post-media-kind="${e(image.kind)}" data-post-media-source="${e(image.source_url)}" data-post-media-original="${e(originalUrl)}" aria-label="${e(`放大${kind}：${title}`)}">放大</button>${caption}</figure>${hit}</div>`;
}

function saveButton(e, collection, id, title) {
  const label = collection.archived ? '恢复收藏' : collection.saved ? '取消收藏' : '收藏';
  return `<button type="button" class="btn-quiet shape-pill-line${collection.saved ? ' is-saved' : ''}" id="${e(id)}" data-action="${collection.archived ? 'restore-collection' : 'toggle-save'}" data-item-id="${e(collection.itemId)}" aria-pressed="${collection.saved ? 'true' : 'false'}" aria-label="${e(`${label}：${title}`)}">${label}</button>`;
}
