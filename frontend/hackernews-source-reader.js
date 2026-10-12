// Official public API: https://github.com/HackerNews/API (verified 2026-10-02).
// topstories includes jobs. Read at most its first 10 IDs, sequentially, to keep
// the scheduled feed below the free Worker limit of 50 subrequests.
export const HN_TOP_URL = 'https://hacker-news.firebaseio.com/v0/topstories.json';
const LIMIT = 10, MAX_BYTES = 2 * 1024 * 1024;
const fail = () => { throw Error('HN 官方榜单格式不完整，本次未采用。'); };
const plain = value => typeof value === 'string' ? value
  .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' ')
  .replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[\da-f]+|\d+);/gi, token => {
    const named = {'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '};
    if (named[token.toLowerCase()]) return named[token.toLowerCase()];
    const n = token[2]?.toLowerCase() === 'x' ? parseInt(token.slice(3, -1), 16) : Number(token.slice(2, -1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
  }).replace(/\s+/g, ' ').trim() : '';

function topIds(value,maxItems=LIMIT) {
  if (!Number.isSafeInteger(maxItems) || maxItems<1 || maxItems>LIMIT) fail();
  if (!Array.isArray(value) || !value.length || value.length > 500
    || value.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(value).size !== value.length) fail();
  return value.slice(0, maxItems);
}

export function parseHackerNewsApi(raw, source, {maxItems=LIMIT}={}) {
  if (source?.id !== 'hackernews' || source.feed_url !== HN_TOP_URL || !source.channel) fail();
  const snapshot = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const ids = topIds(snapshot?.topstories,maxItems);
  if (!Array.isArray(snapshot?.items) || snapshot.items.length !== ids.length) fail();
  const items = snapshot.items.flatMap((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || row.id !== ids[index]) fail();
    if (row.deleted === true || row.dead === true) return [];
    if (!['story', 'job'].includes(row.type) || typeof row.title !== 'string' || row.title.length > 2000) fail();
    const title = plain(row.title).slice(0, 500);
    if (!title) fail();
    const time = Number.isSafeInteger(row.time) && row.time > 0 && row.time * 1000 <= 8640000000000000
      ? new Date(row.time * 1000).toISOString() : null;
    return [{title, url: `https://news.ycombinator.com/item?id=${row.id}`,
      summary: typeof row.text === 'string' && row.text.length <= MAX_BYTES ? plain(row.text).slice(0, 1000) : '',
      published_at: time, source_rank: index + 1,
      heat_label: Number.isSafeInteger(row.score) && row.score >= 0 ? `${row.score} 分（HN）` : null}];
  });
  if (!items.length) fail();
  return {id: source.channel, status: 'success', items};
}

async function readJson(url, {fetchImpl, signal, headers, redirect}) {
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal.aborted) throw new DOMException('HN 读取已停止。', 'AbortError');
  signal.addEventListener('abort', abort, {once: true});
  const timer = setTimeout(abort, 4000);
  let reader;
  try {
    const response = await fetchImpl(url, {signal: controller.signal, redirect, headers});
    if (!response.ok) {await response.body?.cancel().catch(() => {}); throw Error('upstream ' + response.status);}
    if (Number(response.headers.get('content-length')) > MAX_BYTES) {
      await response.body?.cancel().catch(() => {}); throw Error('oversize');
    }
    reader = response.body.getReader();
    const chunks = []; let length = 0;
    for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      length += value.byteLength; if (length > MAX_BYTES) throw Error('oversize'); chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {await reader?.cancel().catch(() => {}); throw error;}
  finally {clearTimeout(timer); signal.removeEventListener('abort', abort);}
}

export async function readHackerNewsApi(source, {fetchImpl = fetch, signal, headers = {}, redirect = 'manual',maxItems=LIMIT} = {}) {
  if (source?.id !== 'hackernews' || source.feed_url !== HN_TOP_URL
    || !['error', 'manual'].includes(redirect)) fail();
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal?.aborted) throw new DOMException('HN 读取已停止。', 'AbortError');
  signal?.addEventListener('abort', abort, {once: true});
  const timer = setTimeout(abort, 20000);
  const options = {fetchImpl, signal: controller.signal, headers, redirect};
  try {
    const topstories = await readJson(HN_TOP_URL, options), ids = topIds(topstories,maxItems), items = [];
    for (const id of ids) {
      items.push(await readJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, options));
    }
    return parseHackerNewsApi({topstories, items}, source,{maxItems});
  } finally {clearTimeout(timer); signal?.removeEventListener('abort', abort);}
}
