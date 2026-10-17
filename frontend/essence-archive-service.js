import { dotInboxHash } from '../dot-inbox-service.js';
import { PUBLIC_FEED_KEY } from './cloud-feed-service.js';
import {
  ESSENCE_ARCHIVE_ADMIN_PATH, ESSENCE_ARCHIVE_KEY, ESSENCE_ARCHIVE_PATH, archiveKeyFromUrl,
  emptyEssenceArchive, essenceArchiveCards, essenceArchiveFromFeed, essenceArchiveState,
  mergeEssenceArchive, normalizeEssenceArchive, pageStoredEssenceArchive,
  setEssenceArchiveRemoved, snapshotLooksLikeFeed,
} from './essence-archive.js';

const headers = {
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY',
  'Referrer-Policy':'strict-origin-when-cross-origin',
};
const HASH = /^[a-f0-9]{64}$/i;
const SNAPSHOT_MAX = 8_000_000;

export function isEssenceArchiveRoute(pathname) {
  return pathname === ESSENCE_ARCHIVE_PATH || pathname === ESSENCE_ARCHIVE_ADMIN_PATH;
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {status, headers:{...headers, ...extra}});
}

function pageQuery(url) {
  const entries = [...url.searchParams.entries()];
  if (!entries.length) return 1;
  if (entries.length !== 1 || entries[0][0] !== 'page' || !/^[1-9]\d{0,4}$/.test(entries[0][1])) return null;
  return Number(entries[0][1]);
}

function parseSnapshot(raw) {
  if (typeof raw === 'string') {
    if (raw.length > SNAPSHOT_MAX) return null;
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  return raw && typeof raw === 'object' && Array.isArray(raw.items) ? raw : null;
}

async function readSnapshot(env, request) {
  let stored = null;
  try {
    if (typeof env?.PUBLIC_FEED?.get === 'function') stored = await env.PUBLIC_FEED.get(PUBLIC_FEED_KEY);
  } catch { stored = null; }
  const parsed = parseSnapshot(stored);
  if (parsed) return parsed;
  if (typeof env?.ASSETS?.fetch !== 'function') return null;
  try {
    const response = await env.ASSETS.fetch(new Request(new URL('/data/public-feed.json', request.url)));
    if (!response?.ok) return null;
    return parseSnapshot(await response.text());
  } catch {
    return null;
  }
}

// missing: no archive document yet, so the public page can use the snapshot.
// invalid: a document is present and is not an archive, so it is left untouched.
// error: the archive key could not be read.
async function readStoredArchive(env) {
  if (typeof env?.PUBLIC_FEED?.get !== 'function') return {status:'missing'};
  let raw;
  try { raw = await env.PUBLIC_FEED.get(ESSENCE_ARCHIVE_KEY); }
  catch { return {status:'error'}; }
  if (raw == null || raw === '') return {status:'missing'};
  const doc = normalizeEssenceArchive(raw);
  if (doc) return {status:'ok', doc};
  // A snapshot-shaped value means this read did not find an archive document.
  // Leave it unread so a later put cannot replace the homepage snapshot.
  if (snapshotLooksLikeFeed(raw)) return {status:'ignored'};
  return {status:'invalid'};
}

function sameOrigin(request, url) {
  const origin = request.headers.get('Origin');
  if (origin !== null && origin !== url.origin) return false;
  const site = request.headers.get('Sec-Fetch-Site');
  return site == null || site === 'same-origin' || site === 'none';
}

async function reviewAuthorized(request, env) {
  const expectedHash = env?.DOT_REVIEW_TOKEN_HASH || '';
  if (!HASH.test(expectedHash)) return false;
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer ([\x21-\x7e]{16,1024})$/i);
  if (!match) return false;
  const actual = await dotInboxHash(match[1]);
  const expected = expectedHash.toLowerCase();
  let difference = 0;
  for (let index = 0; index < 64; index += 1) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

async function readJson(request) {
  const declared = request.headers.get('Content-Length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 4096)) {
    await request.body?.cancel?.().catch(() => {});
    return {error:'body_too_large', message:'请求太长。', status:413};
  }
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return {error:'json_required', message:'请使用 application/json 提交。', status:415};
  }
  let raw = '';
  try { raw = await request.text(); }
  catch { return {error:'invalid_body', message:'没有收到完整请求。', status:400}; }
  if (raw.length > 4096) return {error:'body_too_large', message:'请求太长。', status:413};
  try { return {body:JSON.parse(raw)}; }
  catch { return {error:'invalid_body', message:'请提交要下架的链接。', status:400}; }
}

function plain(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

async function seedDocument(env, request) {
  const feed = await readSnapshot(env, request);
  if (!feed) return null;
  return mergeEssenceArchive(emptyEssenceArchive(), essenceArchiveCards(essenceArchiveState(feed)));
}

function adminView(item) {
  if (!item) return null;
  const page = pageStoredEssenceArchive({schema:'essence-archive-v1', items:[item]}, {includeRemoved:true});
  return page.items[0] || null;
}

async function handleAdmin(request, env, url) {
  if (!sameOrigin(request, url)) return json({error:'origin_not_allowed', message:'不接受其他网站改全部精华。'}, 403);
  if (!HASH.test(env?.DOT_REVIEW_TOKEN_HASH || '')) return json({error:'not_authorized', message:'下架需要接收码。'}, 503);
  if (!(await reviewAuthorized(request, env))) {
    return json({error:'not_authorized', message:'下架需要接收码。投递密钥不能改全部精华。'}, 401, {'WWW-Authenticate':'Bearer realm="essence-archive"'});
  }
  if (typeof env?.PUBLIC_FEED?.get !== 'function' || typeof env?.PUBLIC_FEED?.put !== 'function') {
    return json({error:'unavailable', message:'全部精华暂时读不到，请稍后重试。'}, 503);
  }
  if (request.method === 'GET' || request.method === 'HEAD') {
    const page = pageQuery(url);
    if (page === null) return json({error:'invalid_page', message:'页码不正确。'}, 400);
    const stored = await readStoredArchive(env);
    if (stored.status === 'invalid' || stored.status === 'error') return json({error:'unavailable', message:'全部精华暂时读不到，请稍后重试。'}, 503);
    const doc = stored.status === 'ok' ? stored.doc : await seedDocument(env, request);
    if (!doc) return json({error:'unavailable', message:'全部精华暂时读不到，请稍后重试。'}, 503);
    const body = pageStoredEssenceArchive(doc, {page, includeRemoved:true});
    return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), {headers});
  }
  if (request.method !== 'POST') return json({error:'method_not_allowed', message:'不支持此操作。'}, 405, {Allow:'GET, HEAD, POST'});
  if ([...url.searchParams.keys()].length) return json({error:'unsupported_query', message:'下架不接受查询参数。'}, 400);
  const parsed = await readJson(request);
  if (parsed.error) return json({error:parsed.error, message:parsed.message}, parsed.status);
  const body = parsed.body;
  if (!plain(body) || Object.keys(body).sort().join() !== 'removed,url' || typeof body.url !== 'string' || typeof body.removed !== 'boolean') {
    return json({error:'invalid_body', message:'请提交要下架或恢复的链接。'}, 400);
  }
  const key = archiveKeyFromUrl(body.url);
  if (!key) return json({error:'invalid_url', message:'请粘贴有效的 X 链接。'}, 400);
  const stored = await readStoredArchive(env);
  if (stored.status === 'invalid' || stored.status === 'error') return json({error:'unavailable', message:'全部精华暂时读不到，请稍后重试。'}, 503);
  let doc = stored.status === 'ok' ? stored.doc : await seedDocument(env, request);
  if (!doc) return json({error:'unavailable', message:'全部精华暂时读不到，请稍后重试。'}, 503);
  if (!doc.items.some(item => item.key === key) && stored.status !== 'ok') {
    return json({error:'not_found', message:'这条帖不在全部精华里。'}, 404);
  }
  if (!doc.items.some(item => item.key === key)) {
    const feed = await readSnapshot(env, request);
    const card = feed ? essenceArchiveCards(essenceArchiveState(feed)).find(item => item.key === key) : null;
    if (!card) return json({error:'not_found', message:'这条帖不在全部精华里。'}, 404);
    doc = mergeEssenceArchive(doc, [card]);
  }
  const next = setEssenceArchiveRemoved(doc, key, body.removed, new Date().toISOString());
  if (!next) return json({error:'not_found', message:'这条帖不在全部精华里。'}, 404);
  try { await env.PUBLIC_FEED.put(ESSENCE_ARCHIVE_KEY, JSON.stringify(next)); }
  catch { return json({error:'unavailable', message:'下架没有写成。'}, 503); }
  const item = next.items.find(entry => entry.key === key);
  return json(adminView(item));
}

// Remember posts that are already on the public essence line. A missing archive
// is created. A taken-down row stays taken down. Failures stay off the publish path.
export async function rememberEssenceArchive(env, feed) {
  if (typeof env?.PUBLIC_FEED?.get !== 'function' || typeof env?.PUBLIC_FEED?.put !== 'function') return {written:false};
  const stored = await readStoredArchive(env);
  if (stored.status === 'ignored') return {written:false};
  if (stored.status === 'error' || stored.status === 'invalid') {
    console.warn(JSON.stringify({event:'essence-archive-remember-failed'}));
    return {written:false};
  }
  const cards = essenceArchiveCards(essenceArchiveState(feed));
  if (stored.status === 'missing' && !cards.length) return {written:false};
  const next = mergeEssenceArchive(stored.status === 'ok' ? stored.doc : emptyEssenceArchive(), cards);
  try {
    await env.PUBLIC_FEED.put(ESSENCE_ARCHIVE_KEY, JSON.stringify(next));
    return {written:true};
  } catch {
    console.warn(JSON.stringify({event:'essence-archive-remember-failed'}));
    return {written:false};
  }
}

export async function handleEssenceArchiveRequest(request, env) {
  const url = new URL(request.url);
  if (!isEssenceArchiveRoute(url.pathname)) return null;
  if (url.pathname === ESSENCE_ARCHIVE_ADMIN_PATH) return handleAdmin(request, env, url);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({error:'method_not_allowed', message:'不支持此操作。'}, 405, {Allow:'GET, HEAD'});
  }
  const page = pageQuery(url);
  if (page === null) return json({error:'invalid_page', message:'页码不正确。'}, 400);
  const stored = await readStoredArchive(env);
  if (stored.status === 'invalid') return json({error:'unavailable', message:'全部精华暂时读不到，请稍后重试。'}, 503);
  if (stored.status === 'ok') {
    const body = pageStoredEssenceArchive(stored.doc, {page});
    return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), {headers});
  }
  const feed = await readSnapshot(env, request);
  if (!feed) return json({error:'unavailable', message:'全部精华暂时读不到，请稍后重试。'}, 503);
  const body = essenceArchiveFromFeed(feed, {page});
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), {headers});
}
