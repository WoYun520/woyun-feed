// Public read of one X status, used only to fill a missing intake excerpt.
// impact.kosx.ai does not fetch status text in the browser. Its Worker stores
// full_text from api.socialdata.tools, which needs a paid Bearer key. This
// path does not call that API, api.x.com, or any cookie session.
//
// publish.twitter.com/oembed now answers 301 with an empty body and a Location
// of publish.x.com. Redirects stay manual, so the old host is not requested.
// FxTwitter already expands note_tweet into tweet.text. The syndication card
// only returns a body when the public embed token is present; a bare id returns {}.

const FXTWITTER_ORIGIN = 'https://api.fxtwitter.com';
const SYNDICATION_ORIGIN = 'https://cdn.syndication.twimg.com';
const OEMBED_ORIGIN = 'https://publish.x.com';
const BODY_LIMIT = 100_000;

function canonicalStatusUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host !== 'x.com' && host !== 'twitter.com') return '';
    const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/([1-9]\d{7,24})\/?$/);
    if (!match || match[1].toLowerCase() === 'i') return '';
    return {url:`https://x.com/${match[1]}/status/${match[2]}`, id:match[2]};
  } catch {
    return '';
  }
}

// Same public token the syndication embed page sends. It is derived from the
// status id; it is not a user credential.
function syndicationToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

export function decodeExcerptHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, digits) => {
      const code = Number(digits);
      return Number.isInteger(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) => {
      const code = Number.parseInt(digits, 16);
      return Number.isInteger(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    })
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim();
}

export function excerptFromOembedHtml(html) {
  if (typeof html !== 'string' || !html) return '';
  const match = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
  return decodeExcerptHtml(match ? match[1] : '');
}

function articleText(article) {
  if (!article || typeof article !== 'object') return [];
  const blocks = Array.isArray(article.content?.blocks) ? article.content.blocks : [];
  const body = blocks.map(block => typeof block?.text === 'string' ? block.text : '').filter(Boolean).join('\n');
  const titled = article.title && body ? `${article.title}\n${body}` : '';
  return [article.preview_text, article.text, body, titled];
}

function noteText(note) {
  if (!note || typeof note !== 'object') return [];
  return [note.text, note.note_tweet_results?.result?.text];
}

function bestText(candidates) {
  let best = '';
  for (const value of candidates) {
    if (typeof value !== 'string' || !value) continue;
    const text = decodeExcerptHtml(value);
    if (text.length > best.length) best = text;
  }
  return best;
}

// Prefer the longest real body. FxTwitter puts note_tweet text on tweet.text;
// a raw note_tweet or an article block can still be longer than the short status.
export function excerptFromStatusPayload(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const tweet = payload.tweet && typeof payload.tweet === 'object' ? payload.tweet : null;
  const candidates = [
    excerptFromOembedHtml(payload.html),
    payload.text,
    payload.full_text,
    payload.data?.text,
    ...noteText(payload.note_tweet),
    ...articleText(payload.article),
  ];
  if (tweet) {
    candidates.push(tweet.text, tweet.full_text, tweet.raw_text?.text, ...noteText(tweet.note_tweet), ...articleText(tweet.article));
  }
  return bestText(candidates);
}

async function readJson(response) {
  if (!response || response.status !== 200) return null;
  const length = response.headers?.get?.('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > BODY_LIMIT)) return null;
  const raw = await response.text();
  if (!raw || raw.length > BODY_LIMIT) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function retryableStatus(status) {
  return status === 429 || (typeof status === 'number' && status >= 500);
}

async function pause(ms) {
  if (!ms) return;
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function readStatus(fetchImpl, endpoint, timeoutMs) {
  const response = await fetchImpl(endpoint, {
    headers:{Accept:'application/json', 'User-Agent':'woyun-feed-preview/excerpt'},
    redirect:'manual',
    ...(typeof AbortSignal?.timeout === 'function' ? {signal:AbortSignal.timeout(timeoutMs)} : {}),
  });
  const text = excerptFromStatusPayload(await readJson(response));
  return {text, retry:retryableStatus(response?.status)};
}

// Returns the status text, or '' when every public read is missing or refused.
// fetchImpl is the only network call. Redirects are not followed.
export async function fetchXStatusText(url, fetchImpl, {timeoutMs = 4000, retryDelayMs = 200} = {}) {
  const status = canonicalStatusUrl(url);
  if (!status || typeof fetchImpl !== 'function') return '';
  const targets = [
    {endpoint:`${FXTWITTER_ORIGIN}/status/${status.id}`, retry:true},
    {endpoint:`${SYNDICATION_ORIGIN}/tweet-result?id=${status.id}&token=${encodeURIComponent(syndicationToken(status.id))}&lang=zh-cn`, retry:false},
    {endpoint:`${OEMBED_ORIGIN}/oembed?omit_script=true&dnt=true&url=${encodeURIComponent(status.url)}`, retry:false},
  ];
  for (const target of targets) {
    const attempts = target.retry ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let outcome = {text:'', retry:false};
      try { outcome = await readStatus(fetchImpl, target.endpoint, timeoutMs); }
      catch { outcome = {text:'', retry:true}; }
      if (outcome.text) return outcome.text;
      if (!(target.retry && outcome.retry && attempt + 1 < attempts)) break;
      await pause(retryDelayMs);
    }
  }
  return '';
}
