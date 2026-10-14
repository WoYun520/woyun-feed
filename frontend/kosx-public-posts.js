import { normalizeCoverUrl } from './src/postMedia.js';
import { REVIEW_COUNT_MAX, REVIEW_TYPES } from './src/reviewQueue.js';

// Approved KOSX links are attached after the public snapshot is built.
// The scheduled crawl does not know this source, so it cannot fetch or drop it
// by itself; callers reattach the current approved set after each rebuild.
export const KOSX_PUBLIC_SOURCE_ID = 'sopilot-kosx';

export function kosxPublicSource() {
  return {
    id:KOSX_PUBLIC_SOURCE_ID,
    name:'KOSX 过审',
    home_url:'https://x.com',
    kind:'aggregator',
    group:'posts',
    ranked:false,
    link_kind:'post',
    status:'ok',
    enabled:true,
    message:'账号池成员的最新精华帖按时间放上首页；其余链接经接收码过审。未读取原文，未核对热度。不按粉丝数排序。',
    reading_note:'这不是 SoPilot 榜单，也不按粉丝数排序。昨日最被低估必须人工过审。账号池自动放上首页的帖不进入那一栏。',
  };
}

export function isKosxPublicItem(item) {
  return item?.origin === 'kosx_approved'
    || (Array.isArray(item?.source_refs) && item.source_refs.length === 1 && item.source_refs[0] === KOSX_PUBLIC_SOURCE_ID);
}

function knownInstant(value) {
  if (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value))) return '';
  return new Date(value).toISOString();
}

function publicCount(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= REVIEW_COUNT_MAX ? value : null;
}

// Twitter snowflake epoch, 2010-11-04T01:42:54.657Z. Status ids are wider than
// 32 bits, and often wider than 53, so the shift has to stay on BigInt.
export const X_SNOWFLAKE_EPOCH_MS = 1288834974657;
const X_HOSTS = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']);

function xStatusId(record) {
  const keyed = typeof record?.key === 'string' ? /^x:([1-9]\d{7,24})$/.exec(record.key) : null;
  if (keyed) return keyed[1];
  for (const value of [record?.url, record?.original_url, record?.canonical_url]) {
    if (typeof value !== 'string' || value.length > 2000) continue;
    let url;
    try { url = new URL(value); } catch { continue; }
    if (url.protocol !== 'https:' || !X_HOSTS.has(url.hostname)) continue;
    const match = url.pathname.match(/^\/[A-Za-z0-9_]{1,15}\/status\/([1-9]\d{7,24})\/?$/);
    if (match) return match[1];
  }
  return '';
}

function snowflakeInstant(id) {
  if (!/^[1-9]\d{7,24}$/.test(id)) return '';
  const ms = (BigInt(id) >> 22n) + BigInt(X_SNOWFLAKE_EPOCH_MS);
  if (ms < BigInt(X_SNOWFLAKE_EPOCH_MS) || ms > 4102444800000n) return '';
  const numeric = Number(ms);
  if (!Number.isSafeInteger(numeric)) return '';
  return new Date(numeric).toISOString();
}

// Intake published_at wins, then created_at. When both are missing, an X
// status id supplies the post instant. Anything else stays blank: a review
// clock is not a publication time, and non-X links are not given one.
export function originalPostInstant(record) {
  return knownInstant(record?.published_at) || knownInstant(record?.created_at) || snowflakeInstant(xStatusId(record));
}

export function kosxPublicItem(record) {
  if (!record || record.status !== 'approved' || typeof record.reviewed_at !== 'string' || !Number.isFinite(Date.parse(record.reviewed_at))) return null;
  const note = typeof record.note === 'string' ? record.note.trim() : '';
  const reviewed = new Date(record.reviewed_at).toISOString();
  const posted = originalPostInstant(record);
  // published_at is the original post. source_item_time and captured_at stay
  // on the review clock. The review clock fills published_at only when the
  // row is not an X status and intake did not supply a time.
  const pool = record.approval === 'pool';
  const title = (note || `@${record.author_handle} 的精华帖`).slice(0, 500);
  const summary = (pool
    ? (note
      ? `${note}。账号池成员的精华帖，按时间放上首页。尚未读取原文，未核对热度。不进入昨日最被低估。`
      : '账号池成员的精华帖，按时间放上首页。尚未读取原文，未核对热度。不进入昨日最被低估。')
    : (note
      ? `${note}。过审后放上首页。尚未读取原文，未核对热度。`
      : '过审后放上首页的 X 链接。尚未读取原文，未核对热度。')).slice(0, 1000);
  const bookmark_count = publicCount(record.bookmark_count);
  const like_count = publicCount(record.like_count);
  const review_type = REVIEW_TYPES.includes(record.review_type) ? record.review_type : '';
  const hasArticle = record.has_article === true || record.has_article === false ? record.has_article : undefined;
  const cover_url = normalizeCoverUrl(record.cover_url);
  return {
    id:record.id,
    title,
    summary,
    summary_label:'过审链接，未核对原帖',
    source_refs:[KOSX_PUBLIC_SOURCE_ID],
    original_url:record.url,
    canonical_url:record.url,
    published_at:posted || reviewed,
    source_item_time:reviewed,
    captured_at:reviewed,
    content_status:'excerpt_only',
    verification_status:'not_tested',
    link_kind:'post',
    origin:'kosx_approved',
    author_handle:record.author_handle,
    author_name:record.author_handle,
    ...(review_type ? {review_type} : {}),
    ...(bookmark_count !== null ? {bookmark_count} : {}),
    ...(like_count !== null ? {like_count} : {}),
    ...(hasArticle !== undefined ? {has_article:hasArticle} : {}),
    ...(cover_url ? {cover_url} : {}),
    ...(pool ? {kosx_review:'pool'} : {}),
    unknowns:['未读取原文', '热度未知', '过审不等于已实测'],
  };
}

export function attachKosxApproved(feed, records) {
  const approved = (Array.isArray(records) ? records : []).map(kosxPublicItem).filter(Boolean);
  const sources = Array.isArray(feed?.sources) ? feed.sources : [];
  const items = Array.isArray(feed?.items) ? feed.items : [];
  const had = sources.some(source => source?.id === KOSX_PUBLIC_SOURCE_ID) || items.some(isKosxPublicItem);
  if (!approved.length && !had) return feed;
  const seen = new Set();
  const posts = [];
  for (const item of approved) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    posts.push(item);
  }
  return {
    ...feed,
    sources:[...sources.filter(source => source?.id !== KOSX_PUBLIC_SOURCE_ID), ...(posts.length ? [kosxPublicSource()] : [])],
    items:[...items.filter(item => !isKosxPublicItem(item)), ...posts],
  };
}
