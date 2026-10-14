import { dotPostKey } from './dotCandidates.js';
import { selectPostStream } from './postStream.js';

export const KOSX_BOOST_STORAGE_KEY = 'woyun-kosx-boost:v1';
export const HOME_BOOST_TOTAL_KEY = 'personal-feed:home-boost-total:v1';
export const HOME_BOOST_VISITOR_KEY = 'personal-feed:visitor:v1';

export const HOME_LATEST_LIMIT = 18;
export const HOME_UNDERSTATED_LIMIT = 2;
const VIEWS = ['latest', 'yesterday', 'week', 'kept'];

const finite = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const asSet = value => new Set(value instanceof Set || Array.isArray(value) ? value : []);

export function beijingDateKey(ms) {
  if (!Number.isFinite(ms)) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(ms);
  const value = type => parts.find(part => part.type === type)?.value || '';
  const key = `${value('year')}-${value('month')}-${value('day')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : '';
}

export function addCalendarDays(key, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  if (!match || !Number.isInteger(days)) return '';
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${month}-${day}`;
}

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

function keptShelf(state) {
  const hidden = asSet(state?.hiddenItemIds);
  const archived = asSet(state?.archivedItemIds);
  const visible = item => item && typeof item.id === 'string' && !hidden.has(item.id)
    && !(item.alias_ids || []).some(id => hidden.has(id));
  const featured = (Array.isArray(state?.dotFeaturedItems) ? state.dotFeaturedItems : []).filter(visible);
  const saved = (Array.isArray(state?.savedItems) ? state.savedItems : []).filter(item => visible(item) && !archived.has(item.id));
  const featuredIds = new Set(featured.flatMap(item => [item.id, item.canonical_url, item.original_url].filter(Boolean)));
  return {featured, saved:saved.filter(item => !featuredIds.has(item.id) && !featuredIds.has(item.canonical_url) && !featuredIds.has(item.original_url)), archivedCount:[...archived].length};
}

const UNDERRATED_HUMAN = '昨日最被低估必须人工过审，账号池自动放上首页的帖不进入这一栏。';
const KOSX_PUBLIC_SOURCE_ID = 'sopilot-kosx';

function pinnedNote() {
  return `这一栏只显示人工从「昨日全部」钉选的帖，按钉选顺序，最多 ${HOME_UNDERSTATED_LIMIT} 条。没有对上的钉选时留空，不按来源热度、榜位或发布时间补。钉选不表示已核对原帖。${UNDERRATED_HUMAN}`;
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

// The band is human pins that land on 「昨日全部」. Pool auto-approvals stay
// out. Nothing fills the gap from heat, rank, or age.
function pickPinnedUnderrated(yesterday, pins, yesterdayKey) {
  const wanted = normalizePins(pins).filter(pin => pin.day === yesterdayKey);
  if (!wanted.length) return emptyUnderrated();
  const byKey = new Map();
  for (const entry of yesterday) {
    if (entry.post.item?.kosx_review === 'pool') continue;
    const key = statusKey(entry.post.item);
    if (key && !byKey.has(key)) byKey.set(key, entry);
    if (entry.post.item?.id && !byKey.has(entry.post.item.id)) byKey.set(entry.post.item.id, entry);
  }
  const chosen = [];
  for (const pin of wanted) {
    const entry = (pin.key && byKey.get(pin.key)) || (pin.id && byKey.get(pin.id));
    if (!entry || chosen.includes(entry)) continue;
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
  // list and on the chronological cover; underrated screening reads this list,
  // so a stream post that never joined the essence line cannot enter it.
  const yesterdayEntries = dated.filter(entry => onDay(entry, yesterday) && isHomepageEssence(entry.post.item));
  const weekEntries = dated.filter(entry => weekKeys.includes(beijingDateKey(entry.time.ms)));
  const latest = dated.slice(0, HOME_LATEST_LIMIT);
  const under = pickPinnedUnderrated(yesterdayEntries, state?.underratedPins ?? state?.underrated_pins, yesterday);
  const kept = keptShelf(state);
  if (before !== state) throw Error('首页筛选不应替换资料对象。');
  return {
    reference:{...reference, dateKey, yesterday, weekKeys, weekStart:weekKeys[6] || '', weekEnd:weekKeys[0] || ''},
    counts:{open:open.length, folded:stream.posts.length - open.length, undated:open.length - dated.length, dated:dated.length},
    latest, yesterday:yesterdayEntries, weekLeads:weekEntries.filter(entry => entry.post.instruction?.eligible),
    weekRest:weekEntries.filter(entry => !entry.post.instruction?.eligible),
    underrated:under.entries, underratedRule:under.rule, underratedNote:under.note, kept,
  };
}

// Pool release holds a post when it would sit on yesterday's essence line and
// is not a pool auto-approval. The underrated band still shows pins only.
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
