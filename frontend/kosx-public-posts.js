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

export function kosxPublicItem(record) {
  if (!record || record.status !== 'approved' || typeof record.reviewed_at !== 'string' || !Number.isFinite(Date.parse(record.reviewed_at))) return null;
  const note = typeof record.note === 'string' ? record.note.trim() : '';
  const when = new Date(record.reviewed_at).toISOString();
  const pool = record.approval === 'pool';
  const title = (note || `@${record.author_handle} 的精华帖`).slice(0, 500);
  const summary = (pool
    ? (note
      ? `${note}。账号池成员的精华帖，按时间放上首页。尚未读取原文，未核对热度。不进入昨日最被低估。`
      : '账号池成员的精华帖，按时间放上首页。尚未读取原文，未核对热度。不进入昨日最被低估。')
    : (note
      ? `${note}。过审后放上首页。尚未读取原文，未核对热度。`
      : '过审后放上首页的 X 链接。尚未读取原文，未核对热度。')).slice(0, 1000);
  return {
    id:record.id,
    title,
    summary,
    summary_label:'过审链接，未核对原帖',
    source_refs:[KOSX_PUBLIC_SOURCE_ID],
    original_url:record.url,
    canonical_url:record.url,
    published_at:when,
    source_item_time:when,
    captured_at:when,
    content_status:'excerpt_only',
    verification_status:'not_tested',
    link_kind:'post',
    origin:'kosx_approved',
    author_handle:record.author_handle,
    author_name:record.author_handle,
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
