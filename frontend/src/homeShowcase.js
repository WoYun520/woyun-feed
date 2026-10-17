import { addCalendarDays, beijingDateKey } from './beijingDate.js';
import { blankPublicCover, isArticleClassItem } from './coverFace.js';
import { dotPostKey } from './dotCandidates.js';
import { selectPostStream } from './postStream.js';

export { addCalendarDays, beijingDateKey, isArticleClassItem };

export const KOSX_BOOST_STORAGE_KEY = 'woyun-kosx-boost:v1';
export const HOME_BOOST_TOTAL_KEY = 'personal-feed:home-boost-total:v1';
export const HOME_BOOST_VISITOR_KEY = 'personal-feed:visitor:v1';

export const HOME_LATEST_LIMIT = 18;
export const HOME_LATEST_WINDOW_DAYS = 3;
export const HOME_UNDERSTATED_LIMIT = 2;
// Levi's floor for 「七日精选」. Same number as the 200 bookmark gate on the material review filters.
export const HOME_WEEK_BOOKMARK_MIN = 200;
// Levi's floor for 「卧云精选」. Homepage essence articles, no date window.
export const HOME_KEPT_BOOKMARK_MIN = 1000;
const VIEWS = ['latest', 'yesterday', 'week', 'kept'];

const finite = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

// Publication time is preferred. A board timestamp or capture time is only a fallback,
// and the label stays attached so the interface can say which clock it used.
export function postTime(item) {
  const fields = [
    ['published', item?.published_at, '原帖发布时间'],
    ['source', item?.source_item_time, '榜单条目时间'],
    ['captured', item?.captured_at, '采集时间'],
  ];
  for (const [key, value, label] of fields) {
    if (!finite(value)) continue;
    const ms = Date.parse(value);
    return {key, ms, iso:new Date(ms).toISOString(), label};
  }
  return {key:'', ms:0, iso:'', label:'时间未提供'};
}

export function parsePublicHeat(label) {
  if (typeof label !== 'string' || !label.trim()) return null;
  const text = label.normalize('NFKC').replace(/,/g, '').trim();
  const number = text.match(/(\d+(?:\.\d+)?)\s*(万|千|[kK])?/);
  if (!number) return null;
  let value = Number(number[1]);
  if (!Number.isFinite(value)) return null;
  if (number[2] === '万') value *= 10000;
  else if (number[2] === '千' || number[2]?.toLowerCase() === 'k') value *= 1000;
  const unit = /曝光\s*\/\s*小时/.test(text) ? 'exposure_per_hour' : /浏览/.test(text) ? 'views' : '';
  return unit ? {value, unit, label:label.trim()} : null;
}

export function referenceClock(state, now = Date.now()) {
  const generated = Date.parse(state?.generated_at || '');
  if (Number.isFinite(generated)) return {ms:generated, iso:new Date(generated).toISOString(), source:'generated_at'};
  const clock = now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : now;
  const ms = Number.isFinite(clock) ? clock : Date.now();
  return {ms, iso:new Date(ms).toISOString(), source:'now'};
}

function compareId(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byRecent(a, b) {
  return b.time.ms - a.time.ms || compareId(a.post.item.id, b.post.item.id);
}

function describeKept() {
  return `卧云精选不限日期，只看已经放上公开首页的精华文章。信息流里其他带日期的帖不放进来。没有可用原帖、榜单或采集时间的不放进来。文章指标明为文章或教程指南、带有 Article 卡。短帖、产品安利和避坑不进入。收藏数只读公开条目上的 bookmark_count，达到 ${HOME_KEPT_BOOKMARK_MIN} 才留下，收藏多的在前，收藏数相同则较新的原帖在前。点赞和浏览不换算成收藏。没有收藏数，或达不到 ${HOME_KEPT_BOOKMARK_MIN}，都不进入这一栏。不读取这个浏览器里的手动精选或收藏。未核对原帖，未实测。没有把其余公开帖补进来。`;
}

// Standing shelf on the same public stream as 「七日精选」. Article class matches
// the cover (文章 / 教程指南 / Article card). Excerpt clues stay on the week
// shelf; local featured and saved rows do not fill this one.
function postItems(entry) {
  return [entry?.post?.item, ...(Array.isArray(entry?.post?.records) ? entry.post.records : [])].filter(item => item && typeof item === 'object');
}

// The stream may display the longest board excerpt while the approved row
// holds review type and bookmark_count. Shelves read the approved row first,
// then any other copy of the same post.
function shelfItem(entry) {
  return postItems(entry).find(isHomepageEssence) || entry?.post?.item;
}

function shelfBookmark(entry) {
  const items = postItems(entry);
  const ordered = [...items.filter(isHomepageEssence), ...items];
  for (const item of ordered) {
    const count = publicBookmarkCount(item);
    if (count !== null) return count;
  }
  return null;
}

function shelfHeat(entry) {
  const items = postItems(entry);
  const ordered = [...items.filter(isHomepageEssence), ...items];
  for (const item of ordered) {
    const heat = parsePublicHeat(item?.heat_label);
    if (heat && heat.value > 0) return heat;
  }
  return null;
}

function pickKept(entries) {
  const articles = entries.filter(entry => {
    const item = shelfItem(entry);
    return isHomepageEssence(item) && isArticleClassItem(item);
  });
  const kept = articles.filter(entry => {
    const count = shelfBookmark(entry);
    return count !== null && count >= HOME_KEPT_BOOKMARK_MIN;
  });
  kept.sort((a, b) => shelfBookmark(b) - shelfBookmark(a) || byRecent(a, b));
  return kept;
}

const UNDERRATED_HUMAN = '昨日最被低估必须人工过审。已经在昨日全部里的帖，以及昨日全部前一个自然日的精华帖，可以钉进这一栏，包括账号池自动放上首页的帖。';
const KOSX_PUBLIC_SOURCE_ID = 'sopilot-kosx';

function pinnedNote() {
  return `这一栏只显示人工钉选、并且原帖日是当前「昨日全部」或它的前一个自然日的帖，按钉选顺序，最多 ${HOME_UNDERSTATED_LIMIT} 条。没有对上的钉选时留空，不按来源热度、榜位或发布时间补。钉选不表示已核对原帖。${UNDERRATED_HUMAN}`;
}

// Homepage essence is the curated public line that approved pending rows and
// pool auto-approvals join (same flags as isKosxPublicItem). A dated SoPilot
// stream post that never took that path is not essence.
function isHomepageEssence(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.origin === 'kosx_approved') return true;
  const refs = item.source_refs;
  return Array.isArray(refs) && refs.length === 1 && refs[0] === KOSX_PUBLIC_SOURCE_ID;
}

// The stream keeps the longest excerpt when one status is both a public board
// post and an approved row. 最新精华 still follows the approved row.
function latestEssence(entry) {
  const items = [entry?.post?.item, ...(Array.isArray(entry?.post?.records) ? entry.post.records : [])];
  return items.some(isHomepageEssence);
}

// Approval writes source_item_time to the review clock and leaves published_at
// on the original post. Yesterday and the week shelf stay on the original
// post clock. 最新精华 also uses that original Beijing day, and only keeps
// the last 3 calendar days. Approval time still sorts rows inside the window.
function essenceOriginalDay(entry) {
  const items = [entry?.post?.item, ...(Array.isArray(entry?.post?.records) ? entry.post.records : [])];
  let day = '';
  for (const item of items) {
    if (!isHomepageEssence(item)) continue;
    const instant = finite(item?.published_at) ? item.published_at : finite(item?.created_at) ? item.created_at : '';
    if (!instant) continue;
    const key = beijingDateKey(Date.parse(instant));
    if (key && key > day) day = key;
  }
  return day;
}

function latestPlacementMs(entry) {
  const clocks = [entry?.time?.ms || 0];
  const items = [entry?.post?.item, ...(Array.isArray(entry?.post?.records) ? entry.post.records : [])];
  for (const item of items) {
    if (!isHomepageEssence(item)) continue;
    if (finite(item.source_item_time)) clocks.push(Date.parse(item.source_item_time));
    if (finite(item.published_at)) clocks.push(Date.parse(item.published_at));
    if (finite(item.captured_at)) clocks.push(Date.parse(item.captured_at));
  }
  return Math.max(...clocks);
}

const WEEK_REJECT_TYPES = new Set(['短帖', '产品安利', '避坑']);

function publicBookmarkCount(item) {
  const value = item?.bookmark_count;
  return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000 ? value : null;
}

// An article is a public field already on the item, or the existing excerpt
// signal. Short posts, promos, and pitfall notes stay out even with a high count.
function weekArticle(entry) {
  const item = shelfItem(entry);
  const type = typeof item?.review_type === 'string' ? item.review_type : '';
  if (WEEK_REJECT_TYPES.has(type)) return false;
  if (isArticleClassItem(item)) return true;
  return entry?.post?.instruction?.eligible === true;
}

function describeWeek(span, rule, unit) {
  const window = `七日是整理日往前共 7 个北京时间自然日（${span}，含整理日），只看已经放上公开首页的精华帖。信息流里其他带日期的帖不放进来。文章指标明为文章或教程指南、带有 Article 卡，或摘录里已有操作线索的精华帖。短帖、产品安利和避坑不进入。收藏数只读公开条目上的 bookmark_count，达到 ${HOME_WEEK_BOOKMARK_MIN} 才留下，收藏多的在前；点赞和浏览不换算成收藏。`;
  const tail = '未核对原帖，未实测。没有把其余公开帖补进来。';
  if (rule === 'bookmarks') return `${window}没有收藏数，或达不到 ${HOME_WEEK_BOOKMARK_MIN}，都不进入这一栏。${tail}`;
  if (rule === 'heat') {
    const unitLabel = unit === 'exposure_per_hour' ? '曝光/小时' : '次浏览';
    return `${window}这七日的精华文章没有可读的收藏数，改用来源标注的「${unitLabel}」。单位不一致的不换算，只比较条数最多的那一种，留下高于中位数的文章；没有更高的则只留并列最高。高的在前。按现有公开指标粗排。${tail}`;
  }
  if (rule === 'article') return `${window}公开条目上没有可用的收藏数，同一单位的来源热度也不足 2 条，所以按发布时间从新到旧留下这些文章。这不是收藏榜。${tail}`;
  return `${window}这七日没有这样的精华文章。${tail}`;
}

// 「七日精选」 stays on the essence line, then keeps articles only. A known
// bookmark count uses the strict floor and does not fall through to heat.
// Heat is the fallback when no article has bookmark_count. Excerpt evidence
// is the last public field, and it never brings the rest of the window along.
function pickWeek(entries) {
  const articles = entries.filter(weekArticle);
  const counted = articles.filter(entry => shelfBookmark(entry) !== null);
  if (counted.length) {
    const kept = counted.filter(entry => shelfBookmark(entry) >= HOME_WEEK_BOOKMARK_MIN);
    kept.sort((a, b) => shelfBookmark(b) - shelfBookmark(a) || byRecent(a, b));
    return {entries:kept, rule:'bookmarks', unit:''};
  }
  const heated = articles.map(entry => ({entry, heat:shelfHeat(entry)})).filter(row => row.heat && row.heat.value > 0);
  const counts = new Map();
  for (const row of heated) counts.set(row.heat.unit, (counts.get(row.heat.unit) || 0) + 1);
  let unit = '', best = 0;
  for (const [name, count] of counts) if (count > best) { best = count; unit = name; }
  if (unit && best >= 2) {
    const pool = heated.filter(row => row.heat.unit === unit);
    const values = pool.map(row => row.heat.value).sort((a, b) => a - b);
    const median = values[Math.floor((values.length - 1) / 2)];
    let chosen = pool.filter(row => row.heat.value > median);
    if (!chosen.length) {
      const top = values[values.length - 1];
      chosen = pool.filter(row => row.heat.value === top);
    }
    chosen.sort((a, b) => b.heat.value - a.heat.value || byRecent(a.entry, b.entry));
    return {entries:chosen.map(row => row.entry), rule:'heat', unit};
  }
  if (articles.length) return {entries:articles, rule:'article', unit:''};
  return {entries:[], rule:'empty', unit:''};
}

function statusKey(item) {
  const values = [item?.original_url, item?.canonical_url, ...(Array.isArray(item?.source_links) ? item.source_links.map(link => link?.url) : [])];
  for (const value of values) {
    const key = dotPostKey(value);
    if (key) return key;
  }
  return '';
}

function normalizePins(value) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  const pins = [];
  for (const pin of list) {
    if (!pin || typeof pin !== 'object') continue;
    const key = typeof pin.key === 'string' && /^x:[1-9]\d{7,24}$/.test(pin.key) ? pin.key : '';
    const id = typeof pin.id === 'string' && pin.id ? pin.id : '';
    const day = typeof pin.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(pin.day) ? pin.day : '';
    const mark = key || id;
    if (!mark || !day || seen.has(mark)) continue;
    seen.add(mark);
    pins.push({key, id, day});
  }
  return pins;
}

function emptyUnderrated() {
  return {entries:[], rule:'empty', unit:'', note:pinnedNote()};
}

// The band is human pins whose day is 「昨日全部」 or the calendar day before it.
// Each pin still has to sit on that day's essence line. Nothing fills the gap
// from heat, rank, or age.
function pickPinnedUnderrated(entries, pins, days) {
  const allowed = new Set((Array.isArray(days) ? days : []).filter(Boolean));
  const wanted = normalizePins(pins).filter(pin => allowed.has(pin.day));
  if (!wanted.length) return emptyUnderrated();
  const byKey = new Map();
  for (const entry of entries) {
    const key = statusKey(entry.post.item);
    if (key && !byKey.has(key)) byKey.set(key, entry);
    if (entry.post.item?.id && !byKey.has(entry.post.item.id)) byKey.set(entry.post.item.id, entry);
  }
  const chosen = [];
  for (const pin of wanted) {
    const entry = (pin.key && byKey.get(pin.key)) || (pin.id && byKey.get(pin.id));
    const day = entry?.time?.ms ? beijingDateKey(entry.time.ms) : '';
    if (!entry || day !== pin.day || chosen.includes(entry)) continue;
    chosen.push(entry);
    if (chosen.length >= HOME_UNDERSTATED_LIMIT) break;
  }
  if (!chosen.length) return emptyUnderrated();
  return {entries:chosen, rule:'pinned', unit:'', note:pinnedNote()};
}

export function selectHomeShowcase(state, {now} = {}) {
  const before = state;
  const stream = selectPostStream(state || {}, {sources:state?.sources, profile:state?.profile, view:'all', limit:100000});
  const open = stream.posts.filter(post => post && !post.quality?.fold);
  const dated = open.map(post => ({post, time:postTime(post.item)})).filter(entry => entry.time.ms > 0).sort(byRecent);
  const reference = referenceClock(state, now);
  const dateKey = beijingDateKey(reference.ms);
  const yesterday = dateKey ? addCalendarDays(dateKey, -1) : '';
  const weekKeys = dateKey ? Array.from({length:7}, (_, index) => addCalendarDays(dateKey, -index)) : [];
  const onDay = (entry, key) => key && beijingDateKey(entry.time.ms) === key;
  // 「昨日全部」is homepage essence whose original-post Beijing date is yesterday.
  // Quality folds are already out of `dated`. Pool auto-approvals stay on this
  // list and on the chronological cover. A stream post that never joined the
  // essence line cannot enter it. The underrated rail uses the same essence
  // line for yesterday and the calendar day before it.
  // Same membership as 最新精华: an approved row counts when any copy of the
  // same post still has a usable excerpt or a cover the card would show.
  // A blank face — no usable excerpt and no visible media — does not take a slot.
  const showCover = entry => !blankPublicCover(entry.post);
  const yesterdayEntries = dated.filter(entry => onDay(entry, yesterday) && latestEssence(entry) && showCover(entry));
  const priorDay = yesterday ? addCalendarDays(yesterday, -1) : '';
  const underratedDays = [yesterday, priorDay].filter(Boolean);
  const underratedEntries = dated.filter(entry => underratedDays.some(day => onDay(entry, day)) && latestEssence(entry) && showCover(entry));
  const weekEntries = dated.filter(entry => weekKeys.includes(beijingDateKey(entry.time.ms)) && latestEssence(entry) && showCover(entry));
  const week = pickWeek(weekEntries);
  // 「最新精华」keeps homepage essence whose original Beijing day is inside the
  // last 3 calendar days, including the reference day. Older approved posts
  // can still reach 卧云精选 or 七日精选 under those shelves' own rules. They
  // do not take a latest slot. Inside the window, a later approval still sorts
  // ahead of an earlier original. Public-stream heat posts do not fill the cap.
  // Blank faces stay out of every public rail, including after a snapshot refresh.
  const latestKeys = dateKey ? Array.from({length:HOME_LATEST_WINDOW_DAYS}, (_, index) => addCalendarDays(dateKey, -index)) : [];
  const latest = dated.filter(entry => latestEssence(entry) && latestKeys.includes(essenceOriginalDay(entry)) && showCover(entry)).sort((a, b) => latestPlacementMs(b) - latestPlacementMs(a) || byRecent(a, b)).slice(0, HOME_LATEST_LIMIT);
  const under = pickPinnedUnderrated(underratedEntries, state?.underratedPins ?? state?.underrated_pins, underratedDays);
  const kept = pickKept(dated.filter(showCover));
  if (before !== state) throw Error('首页筛选不应替换资料对象。');
  const weekStart = weekKeys[6] || '', weekEnd = weekKeys[0] || '';
  const span = weekStart && weekEnd ? `${weekStart} 至 ${weekEnd}` : '日期未能确定';
  return {
    reference:{...reference, dateKey, yesterday, weekKeys, weekStart, weekEnd},
    counts:{open:open.length, folded:stream.posts.length - open.length, undated:open.length - dated.length, dated:dated.length},
    latest, yesterday:yesterdayEntries, week:week.entries, weekRule:week.rule, weekNote:describeWeek(span, week.rule, week.unit),
    underrated:under.entries, underratedRule:under.rule, underratedNote:under.note,
    kept, keptNote:describeKept(),
  };
}

// Pool release holds a post when it would sit on yesterday's essence line and
// is not a pool auto-approval. A blank face is already off that line. The
// underrated band still shows pins only.
export function wouldEnterUnderrated(state, itemId) {
  if (typeof itemId !== 'string' || !itemId) return true;
  const selection = selectHomeShowcase(state || {});
  if (selection.underrated.some(entry => entry.post?.item?.id === itemId)) return true;
  return selection.yesterday.some(entry => entry.post?.item?.id === itemId && entry.post.item?.kosx_review !== 'pool');
}

export function homeViewName(value) {
  return VIEWS.includes(value) ? value : 'latest';
}

function boostIds(store) {
  if (!store || typeof store.getItem !== 'function') return [];
  try {
    const parsed = JSON.parse(store.getItem(KOSX_BOOST_STORAGE_KEY) || '{"ids":[]}');
    const ids = Array.isArray(parsed?.ids) ? parsed.ids : [];
    return [...new Set(ids.filter(id => typeof id === 'string' && /^[1-9]\d{7,24}$/.test(id)))];
  } catch {
    return [];
  }
}

// Local dedupe only. The number on the page is the shared total from /api/home-boost.
export function readKosxBoost(store) {
  const ids = boostIds(store);
  return {count:ids.length, ids};
}

export function readBoostTotal(store) {
  const count = Number(store?.getItem?.(HOME_BOOST_TOTAL_KEY));
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

export function writeBoostTotal(store, count) {
  if (!Number.isSafeInteger(count) || count < 0 || typeof store?.setItem !== 'function') return;
  try { store.setItem(HOME_BOOST_TOTAL_KEY, String(count)); } catch { /* The watermark keeps the last painted number. */ }
}

export function boostVisitorId(store) {
  const existing = store?.getItem?.(HOME_BOOST_VISITOR_KEY);
  if (typeof existing === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) return existing;
  const id = globalThis.crypto?.randomUUID?.() || '';
  if (!id || typeof store?.setItem !== 'function') return '';
  try { store.setItem(HOME_BOOST_VISITOR_KEY, id); return id; }
  catch { return ''; }
}

export function recordKosxBoost(store, url) {
  const current = readKosxBoost(store);
  const key = dotPostKey(typeof url === 'string' ? url : '');
  if (!key || !store || typeof store.setItem !== 'function') return {counted:false, count:current.count, id:''};
  const id = key.slice(2);
  if (current.ids.includes(id)) return {counted:false, count:current.count, id};
  const ids = [...current.ids, id].slice(-300);
  try { store.setItem(KOSX_BOOST_STORAGE_KEY, JSON.stringify({ids})); }
  catch { return {counted:false, count:current.count, id}; }
  return {counted:true, count:ids.length, id};
}
