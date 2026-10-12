// Public author pages contain SoPilot's top ten posts by views over seven days,
// not the author's complete timeline, thread replies, or text inside images.
import {decodeSopilotFlight, sopilotPostImage} from './sopilot-source-reader.js';

const MAX_HTML = 2 * 1024 * 1024;
const MAX_POSTS = 10;
const MAX_EXCERPT = 12000;
const READ_SCOPE = 'author-7d-top10';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => {throw new Error(message || 'SoPilot 公开作者页格式已变化，本次未采用。');};
const clean = value => typeof value === 'string'
  ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : '';
const flightReference = value => /^\$(?:[\da-f]+|L[\da-f]+|undefined)$/i.test(value);

function endpoint(source) {
  const handle = source?.creator_handle;
  if (typeof handle !== 'string' || !/^[A-Za-z0-9_]{1,15}$/.test(handle) || typeof source?.channel !== 'string'
    || !source.channel || source.channel.length > 120
    || (source.format !== undefined && source.format !== 'sopilot-author')) fail('SoPilot 作者配置不正确。');
  const expected = `https://sopilot.net/zh/rank/creators/${handle}`;
  if (source.feed_url !== undefined) {
    let url;
    try {url = new URL(source.feed_url);} catch {fail('SoPilot 作者来源地址不正确。');}
    if (url.protocol !== 'https:' || url.hostname !== 'sopilot.net' || url.port || url.username || url.password
      || url.hash || url.search || !/^\/zh\/rank\/creators\/[A-Za-z0-9_]{1,15}\/?$/.test(url.pathname)
      || url.pathname.replace(/\/$/, '').toLowerCase() !== new URL(expected).pathname.toLowerCase()) {
      fail('SoPilot 作者来源地址不正确。');
    }
  }
  return expected;
}

function timestamp(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()
    || hour > 23 || minute > 59 || second > 59) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function postUrl(value, id, expectedHandle) {
  if (typeof value !== 'string' || value.length > 1000 || !/^\d{5,25}$/.test(id || '')) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !['x.com','www.x.com','twitter.com','www.twitter.com'].includes(url.hostname)) return null;
    const match = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})\/?$/.exec(url.pathname);
    if (!match || match[2] !== id || match[1].toLowerCase() !== expectedHandle.toLowerCase()) return null;
    return `https://x.com/${match[1]}/status/${match[2]}`;
  } catch {return null;}
}

function heatLabel(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) return null;
  const count = value >= 1e8 ? `${(value / 1e8).toFixed(1)}亿`
    : value >= 1e4 ? `${(value / 1e4).toFixed(1)}万`
      : value >= 1e3 ? `${(value / 1e3).toFixed(1)}K` : value.toLocaleString('en-US');
  return `${count} 次浏览`;
}

export function parseSopilotAuthor(raw, source) {
  endpoint(source);
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > MAX_HTML
    || !/<main\b[^>]*\bdata-rank-page=["']true["']/i.test(raw)) fail();
  const {props, textRecords} = decodeSopilotFlight(raw, {matches: value =>
    Object.hasOwn(value, 'detail') && Object.hasOwn(value, 'backHref')});
  const detail = props.detail, expectedHandle = source.creator_handle;
  if (props.locale !== 'zh' || ![1,'1'].includes(props.page) || props.query !== '' || !object(detail)
    || !object(detail.account) || typeof detail.account.screenName !== 'string'
    || detail.account.screenName.toLowerCase() !== expectedHandle.toLowerCase() || detail.timeRange !== '7d'
    || !Array.isArray(detail.posts) || detail.posts.length > MAX_POSTS) {
    fail('SoPilot 没有返回所选作者的近七日公开榜单，本次未采用。');
  }
  const publicText = value => {
    if (typeof value === 'string' && value.startsWith('$$')) return clean(value.slice(1));
    const reference = typeof value === 'string' ? /^\$([\da-f]+)$/i.exec(value) : null;
    if (reference) return clean(textRecords.get(reference[1]));
    return flightReference(value) ? '' : clean(value);
  };
  const items = [], seen = new Set();
  for (const row of detail.posts) {
    if (!object(row)) fail();
    if (row.isAd === true || row.isPromoted === true || row.is_commercial === true) continue;
    const handle = typeof row.screenName === 'string' ? row.screenName : '';
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle) || handle.toLowerCase() !== expectedHandle.toLowerCase()) {
      fail('SoPilot 作者页混入了其他作者的帖子，本次未采用。');
    }
    const id = typeof row.id === 'string' ? row.id : '', url = postUrl(row.sourceUrl, id, expectedHandle);
    if (!url) fail('SoPilot 作者页的原帖地址无法核对，本次未采用。');
    const fullText = publicText(row.text), author = publicText(row.authorName);
    if (!fullText || !author || author.length > 200) fail('SoPilot 作者页没有可用的公开帖子摘录，本次未采用。');
    if (seen.has(id)) continue;
    const articleTitle = publicText(row.articleTitle);
    const title = (articleTitle && articleTitle.length <= 500 ? articleTitle
      : fullText.split(/\r?\n/).find(line => line.trim()) || fullText).replace(/\s+/g, ' ').slice(0, 200);
    // Avoid splitting a supplementary character at the excerpt limit.
    let summary = fullText.slice(0, MAX_EXCERPT);
    if (/[\uD800-\uDBFF]$/.test(summary)) summary = summary.slice(0, -1);
    const postImage = sopilotPostImage(row, url);
    items.push({title, url, summary, published_at: timestamp(row.tweetCreatedAt),
      author_name: author, author_handle: handle, heat_label: heatLabel(row.viewsCount),
      ...(postImage ? {post_image: postImage} : {}),
      extra: {date: timestamp(row.lastSyncedAt) || timestamp(row.updatedAt), read_scope: READ_SCOPE,
        excerpt_truncated: summary.length < fullText.length, excerpt_original_length: fullText.length}});
    seen.add(id);
  }
  return {id: source.channel, status: 'success', read_scope: READ_SCOPE, items};
}

function cancelBody(response) {
  try {response.body?.cancel().catch(() => {});} catch {}
}

async function untilAborted(start, signal) {
  if (signal.aborted) throw signal.reason || new DOMException('读取已取消。', 'AbortError');
  let abort;
  const stopped = new Promise((_, reject) => {
    abort = () => reject(signal.reason || new DOMException('读取已取消。', 'AbortError'));
    signal.addEventListener('abort', abort, {once: true});
  });
  try {return await Promise.race([Promise.resolve().then(start), stopped]);}
  finally {signal.removeEventListener('abort', abort);}
}

async function boundedText(response, maxBytes, signal) {
  if (Number(response.headers?.get('content-length')) > maxBytes) {
    cancelBody(response);fail('SoPilot 作者页面过大，本次未采用。');
  }
  const reader = response.body?.getReader();
  if (!reader) return response.text();
  const chunks = [];let length = 0;
  const abort = () => {try {reader.cancel().catch(() => {});} catch {}};
  signal.addEventListener('abort', abort, {once: true});
  try {
    for (;;) {
      const {done, value} = await reader.read();if (done) break;
      length += value.byteLength;
      if (length > maxBytes) fail('SoPilot 作者页面过大，本次未采用。');
      chunks.push(value);
    }
  } catch (error) {abort();throw error;}
  finally {signal.removeEventListener('abort', abort);reader.releaseLock();}
  const bytes = new Uint8Array(length);let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset);offset += chunk.byteLength;}
  return new TextDecoder().decode(bytes);
}

// One exact public author page is the entire transaction. A wrong identity,
// redirect, malformed body, cancellation, or deadline never becomes an empty
// successful update that could erase the source coordinator's previous data.
export async function readSopilotAuthor(source, {fetchImpl = fetch, signal, headers, redirect = 'error',
  readText = boundedText, timeoutMs = 10000} = {}) {
  const url = endpoint(source);
  if (typeof fetchImpl !== 'function' || typeof readText !== 'function' || !['error','manual'].includes(redirect)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) fail();
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason || new DOMException('读取已取消。', 'AbortError'));
  if (signal?.aborted) cancel();else signal?.addEventListener('abort', cancel, {once: true});
  const timer = setTimeout(() => controller.abort(new DOMException('SoPilot 作者页读取超时。', 'TimeoutError')), timeoutMs);
  const publicHeaders = new Headers();
  for (const [key, value] of new Headers(headers || {})) {
    if (['accept','accept-language','user-agent'].includes(key.toLowerCase())) publicHeaders.set(key, value);
  }
  if (!publicHeaders.has('accept')) publicHeaders.set('accept', 'text/html');
  let response;
  try {
    response = await untilAborted(async () => {
      const value = await fetchImpl(url, {method: 'GET', signal: controller.signal, headers: publicHeaders,
        redirect, credentials: 'omit'});
      if (controller.signal.aborted) {cancelBody(value);throw controller.signal.reason;}
      return value;
    }, controller.signal);
    if (!response.ok) {cancelBody(response);throw new Error(`upstream ${response.status}`);}
    if (response.redirected) {cancelBody(response);fail('SoPilot 公开作者页未成功返回。');}
    const raw = await untilAborted(() => readText(response, MAX_HTML, controller.signal), controller.signal);
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > MAX_HTML) {
      fail('SoPilot 作者页面过大，本次未采用。');
    }
    if (controller.signal.aborted) throw controller.signal.reason;
    return parseSopilotAuthor(raw, source);
  } catch (error) {if (response) cancelBody(response);throw error;}
  finally {clearTimeout(timer);signal?.removeEventListener('abort', cancel);}
}
