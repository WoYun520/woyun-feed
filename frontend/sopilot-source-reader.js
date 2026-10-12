// Read the public SoPilot rank page's serialized data without running scripts.
// Verified 2026-10-03 against the public 24h pages and their page JS:
// categories all, AI, Creator and Finance are the site's own filters; risingTweets is ranked
// by velocityScore (average exposures/hour). hotTweets is a separate leaderboard.
import {normalizePostImage} from './src/postMedia.js';

const MAX_HTML = 2 * 1024 * 1024;
const MAX_FLIGHT = 1024 * 1024;
const MAX_ROWS = 200;
const MAX_ITEMS = 100;
const CATEGORIES = new Set(['all', 'AI', 'Creator', 'Finance']);
const fail = message => { throw new Error(message || 'SoPilot 公开榜单格式已变化，本次未采用。'); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit) => typeof value === 'string' && value.length <= limit
  ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : '';
const flightReference = value => /^\$(?:[\da-f]+|L[\da-f]+|undefined)$/i.test(value);

function timestamp(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map((part, index) => index ? Number(part) : part);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()
    || hour > 23 || minute > 59 || second > 59 || year < 1000) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function postUrl(value, id, handle) {
  if (typeof value !== 'string' || value.length > 1000 || !/^\d{5,25}$/.test(id)
    || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname)) return null;
    const match = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})\/?$/.exec(url.pathname);
    if (!match || match[2] !== id || match[1].toLowerCase() !== handle.toLowerCase()) return null;
    // Tracking and interaction queries are not part of the original post's identity.
    return `https://x.com/${match[1]}/status/${match[2]}`;
  } catch { return null; }
}

function heatLabel(value) {
  // Missing counts stay unknown. Only a genuine numeric zero may be displayed.
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) return null;
  const formatted = value >= 1e8 ? `${(value / 1e8).toFixed(1)}亿`
    : value >= 1e4 ? `${(value / 1e4).toFixed(1)}万`
      : value >= 1e3 ? `${(value / 1e3).toFixed(1)}K` : value.toLocaleString('en-US');
  return `${formatted} 曝光/小时`;
}

// Observed 2026-10-09 on public rank and author pages: these parallel arrays
// belong to the main row. A video's static poster is a photo entry before its
// video URL. Never search avatar, article, quoted, or reposted nested fields.
export function sopilotPostImage(row, originalUrl) {
  if (!object(row) || !Array.isArray(row.mediaUrls) || !Array.isArray(row.mediaTypes)
    || row.mediaUrls.length !== row.mediaTypes.length || row.mediaUrls.length > 16) return null;
  for (let index = 0; index < row.mediaUrls.length; index++) {
    if (row.mediaTypes[index] !== 'photo' || typeof row.mediaUrls[index] !== 'string') continue;
    let kind;
    try {
      const path = new URL(row.mediaUrls[index]).pathname;
      kind = path.startsWith('/media/') ? 'photo'
        : path.startsWith('/amplify_video_thumb/') ? 'video_poster' : null;
    } catch { continue; }
    if (!kind) continue;
    const image = normalizePostImage({url: row.mediaUrls[index], kind, source_url: originalUrl}, originalUrl);
    if (image) return image;
  }
  return null;
}

// Shared by the rank and single-author public-page readers. This only decodes
// bounded serialized records; it never evaluates the page's scripts.
export function decodeSopilotFlight(raw, {matches} = {}) {
  if (typeof raw !== 'string' || !raw.length || raw.length > MAX_HTML
    || typeof matches !== 'function') fail();
  const chunks = [];
  let scripts = 0, size = 0;
  for (const [, attributes, contents] of raw.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (++scripts > 256) fail();
    if (/\bsrc\s*=/i.test(attributes)) continue;
    const match = /^\s*self\.__next_f\.push\((\[[\s\S]*\])\);?\s*$/.exec(contents);
    if (!match) continue;
    let packet;
    try { packet = JSON.parse(match[1]); } catch { fail(); }
    if (!Array.isArray(packet) || packet[0] !== 1) continue;
    if (packet.length !== 2 || typeof packet[1] !== 'string') fail();
    size += packet[1].length;
    if (size > MAX_FLIGHT) fail();
    chunks.push(packet[1]);
  }
  // Chunks can split records. Long public post texts use T<hex byte length>,
  // may contain real newlines, and can touch the next record without a newline.
  // Walk UTF-8 bytes so only genuine record boundaries can identify the props.
  const bytes = new TextEncoder().encode(chunks.join(''));
  if (bytes.length > MAX_FLIGHT) fail();
  const decoder = new TextDecoder('utf-8', {fatal: true}), candidates = [], textRecords = new Map();
  let cursor = 0, count = 0;
  while (cursor < bytes.length) {
    if (bytes[cursor] === 10) { cursor++; continue; }
    if (++count > 4000) fail();
    const colon = bytes.indexOf(58, cursor);
    if (colon < cursor || colon - cursor > 8) fail();
    const recordId = decoder.decode(bytes.subarray(cursor, colon));
    if (!/^[\da-f]+$/i.test(recordId)) fail();
    cursor = colon + 1;
    if (bytes[cursor] === 84) {
      const comma = bytes.indexOf(44, cursor);
      if (comma < cursor || comma - cursor > 8) fail();
      const lengthToken = decoder.decode(bytes.subarray(cursor + 1, comma));
      if (!/^[\da-f]+$/i.test(lengthToken)) fail();
      const length = parseInt(lengthToken, 16), start = comma + 1;
      if (!length || length > 60000 || start + length > bytes.length || textRecords.has(recordId)) fail();
      try { textRecords.set(recordId, decoder.decode(bytes.subarray(start, start + length))); } catch { fail(); }
      cursor = start + length;
      continue;
    }
    let end = bytes.indexOf(10, cursor);
    if (end === -1) end = bytes.length;
    const record = decoder.decode(bytes.subarray(cursor, end));
    cursor = end + (end < bytes.length ? 1 : 0);
    if (!record.startsWith('[')) continue;
    let node;
    try { node = JSON.parse(record); } catch { continue; }
    if (!Array.isArray(node) || node.length !== 4 || node[0] !== '$'
      || typeof node[1] !== 'string' || !/^\$L[\da-f]+$/i.test(node[1]) || !object(node[3])) continue;
    const props = node[3];
    if (matches(props)) candidates.push(props);
  }
  if (candidates.length !== 1) fail();
  return {props: candidates[0], textRecords};
}

function rankProps(raw) {
  if (typeof raw !== 'string' || !/<main\b[^>]*\bdata-rank-page=["']true["']/i.test(raw)) fail();
  return decodeSopilotFlight(raw, {matches: props =>
    Object.hasOwn(props, 'risingTweets') || Object.hasOwn(props, 'hotTweets')});
}

export function parseSopilotRank(raw, source, {page = 1} = {}) {
  const category = source?.sopilot_category ?? 'all';
  if (!CATEGORIES.has(category) || typeof source?.channel !== 'string' || !source.channel
    || !Number.isSafeInteger(page) || page < 1 || page > 2) {
    fail('不支持的 SoPilot 公开榜单分类。');
  }
  const {props, textRecords} = rankProps(raw);
  const publicText = (value, limit) => {
    if (typeof value === 'string' && value.startsWith('$$')) return text(value.slice(1), limit);
    const reference = typeof value === 'string' ? /^\$([\da-f]+)$/i.exec(value) : null;
    if (reference) return text(textRecords.get(reference[1]), limit);
    return flightReference(value) ? '' : text(value, limit);
  };
  // A server silently returning the all-category page must not count as a
  // successful AI/Creator refresh. It would erase the meaning of the source.
  if (props.category !== category || props.range !== '24h' || props.page !== page
    || props.locale !== 'zh' || !Number.isSafeInteger(props.totalPages) || props.totalPages < page) {
    fail('SoPilot 没有返回所选领域的公开 24 小时榜单，本次未采用。');
  }
  if (!Array.isArray(props.risingTweets) || props.risingTweets.length > MAX_ROWS
    || !Array.isArray(props.hotTweets) || props.hotTweets.length > MAX_ROWS) fail();
  const items = [], seen = new Set();
  // Read the single main post text and one optional static main-row image.
  // Quoted/reposted nested data, ads, profile details, and the other leaderboard
  // cannot enter the excerpt or provide its image.
  for (const row of props.risingTweets) {
    if (!object(row) || row.isAd === true || row.isPromoted === true || row.is_commercial === true) continue;
    const summary = publicText(row.text, 12000), author = publicText(row.authorName, 200), handle = text(row.screenName, 15);
    const id = typeof row.id === 'string' ? row.id : '', url = postUrl(row.sourceUrl, id, handle);
    // Unresolved Flight references are format drift, not tweet text or names.
    if (!summary || !author || !url || seen.has(id)) continue;
    const articleTitle = publicText(row.articleTitle, 500);
    const title = (articleTitle ? articleTitle
      : summary.split(/\r?\n/).find(line => line.trim()) || summary)
      .replace(/\s+/g, ' ').slice(0, 200);
    const rank = Number.isSafeInteger(row.rank) && row.rank > 0 && row.rank <= 10000 ? row.rank : null;
    const postImage = sopilotPostImage(row, url);
    items.push({title, url, summary: summary.slice(0, 4000), published_at: timestamp(row.tweetCreatedAt),
      author_name: author, author_handle: handle, source_rank: rank, heat_label: heatLabel(row.velocityScore),
      ...(postImage ? {post_image: postImage} : {}),
      extra: {date: timestamp(row.lastSyncedAt) || timestamp(row.updatedAt)}});
    seen.add(id);
    if (items.length === MAX_ITEMS) break;
  }
  if (!items.length) fail('SoPilot 未提供可用的公开帖子摘录，本次未采用。');
  return {id: source.channel, status: 'success', page, totalPages:props.totalPages, items};
}

function endpoint(source, page) {
  const category = source?.sopilot_category ?? 'all';
  if (!CATEGORIES.has(category) || typeof source?.channel !== 'string' || !source.channel) fail();
  // The configured first page is an identity check, never an arbitrary URL to fetch.
  if (source.feed_url !== undefined) {
    if (typeof source.feed_url !== 'string') fail('SoPilot 来源地址不正确。');
    let configured;
    try {configured = new URL(source.feed_url);} catch {fail('SoPilot 来源地址不正确。');}
    const keys = [...configured.searchParams.keys()];
    if (configured.protocol !== 'https:' || configured.hostname !== 'sopilot.net' || configured.port
      || configured.username || configured.password || configured.hash
      || !/^\/zh\/rank\/tweets\/?$/.test(configured.pathname)
      || keys.some(key => !['range','category','page'].includes(key)) || new Set(keys).size !== keys.length
      || configured.searchParams.get('range') !== '24h'
      || (configured.searchParams.get('category') || 'all') !== category
      || ![null,'1'].includes(configured.searchParams.get('page'))) fail('SoPilot 来源地址不正确。');
  }
  const url = new URL('https://sopilot.net/zh/rank/tweets');
  url.searchParams.set('range','24h');url.searchParams.set('category',category);
  if (page > 1) url.searchParams.set('page',String(page));
  return url.href;
}

function cancelBody(response) {
  // Cancellation is cleanup, not another unbounded stage in the transaction.
  try {response.body?.cancel().catch(()=>{});} catch {}
}

async function boundedText(response, maxBytes = MAX_HTML, signal) {
  if (Number(response.headers?.get('content-length')) > maxBytes) {
    cancelBody(response);fail('SoPilot 页面过大，本次未采用。');
  }
  const reader = response.body?.getReader();
  if (!reader) return response.text();
  const chunks = [];let length = 0;
  const abort = () => {reader.cancel().catch(()=>{});};
  signal?.addEventListener('abort',abort,{once:true});
  try {
    for (;;) {
      const {done,value} = await reader.read();if (done) break;
      length += value.byteLength;
      if (length > maxBytes) fail('SoPilot 页面过大，本次未采用。');
      chunks.push(value);
    }
  } catch (error) {try {reader.cancel().catch(()=>{});} catch {} throw error;}
  finally {signal?.removeEventListener('abort',abort);reader.releaseLock();}
  const bytes = new Uint8Array(length);let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk,offset);offset += chunk.byteLength;}
  return new TextDecoder().decode(bytes);
}

async function untilAborted(start, signal) {
  if (signal.aborted) throw signal.reason || new DOMException('读取已取消。','AbortError');
  let abort;
  const stopped = new Promise((_,reject) => {
    abort = () => reject(signal.reason || new DOMException('读取已取消。','AbortError'));
    signal.addEventListener('abort',abort,{once:true});
  });
  try {return await Promise.race([Promise.resolve().then(start),stopped]);}
  finally {signal.removeEventListener('abort',abort);}
}

// Pages are one source transaction: a failed or silently substituted second
// page rejects the complete result so the coordinator can retain its old list.
export async function readSopilotRank(source, {fetchImpl = fetch, signal, headers, redirect = 'error', readText = boundedText} = {}) {
  const firstUrl = endpoint(source,1);
  if (!['error','manual'].includes(redirect) || typeof fetchImpl !== 'function' || typeof readText !== 'function') fail();
  signal ||= AbortSignal.timeout(10000);
  const publicHeaders = new Headers();
  for (const [key,value] of new Headers(headers || {})) {
    if (['accept','accept-language','user-agent'].includes(key.toLowerCase())) publicHeaders.set(key,value);
  }
  if (!publicHeaders.has('accept')) publicHeaders.set('accept','text/html');
  async function read(page) {
    const url = page === 1 ? firstUrl : endpoint(source,page);
    const response = await untilAborted(async () => {
      const value = await fetchImpl(url,{method:'GET',signal,headers:publicHeaders,redirect,credentials:'omit'});
      if (signal.aborted) {cancelBody(value);throw signal.reason;}
      return value;
    },signal);
    if (!response.ok) {cancelBody(response);throw new Error(`upstream ${response.status}`);}
    if (response.redirected) {cancelBody(response);fail('SoPilot 公开页面未成功返回。');}
    let raw;
    try {raw = await untilAborted(() => readText(response,MAX_HTML,signal),signal);}
    catch (error) {cancelBody(response);throw error;}
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > MAX_HTML) {
      cancelBody(response);fail('SoPilot 页面过大，本次未采用。');
    }
    return parseSopilotRank(raw,source,{page});
  }
  const first = await read(1), pages = [first];
  if (first.totalPages >= 2) {
    const second = await read(2);
    if (second.totalPages !== first.totalPages) fail('SoPilot 分页已变化，本次未采用。');
    pages.push(second);
  }
  const items = [], seen = new Set();
  for (const page of pages) for (const item of page.items) {
    const id = item.url.match(/\/status\/(\d+)$/)?.[1];
    if (seen.has(id)) continue;
    seen.add(id);items.push(item);
    if (items.length === MAX_ITEMS) return {...first,items};
  }
  return {...first,items};
}
