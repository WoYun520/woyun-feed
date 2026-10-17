// Public read of one X status, used only to fill a missing intake excerpt.
// publish.twitter.com oEmbed and the syndication tweet card do not use api.x.com
// or a bearer token. A failure leaves the text empty; the review gate then
// refuses to put a blank face on the homepage.

const OEMBED_ORIGIN = 'https://publish.twitter.com';
const SYNDICATION_ORIGIN = 'https://cdn.syndication.twimg.com';
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

function excerptFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const fromHtml = excerptFromOembedHtml(payload.html);
  if (fromHtml) return fromHtml;
  for (const value of [payload.text, payload.data?.text, payload.tweet?.text]) {
    if (typeof value === 'string' && value.trim()) return decodeExcerptHtml(value);
  }
  return '';
}

async function readJson(response) {
  if (!response || response.status !== 200) return null;
  const length = response.headers?.get?.('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > BODY_LIMIT)) return null;
  const raw = await response.text();
  if (!raw || raw.length > BODY_LIMIT) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Returns the status text, or '' when the public read is missing or refused.
// fetchImpl is the only network call. Redirects are not followed.
export async function fetchXStatusText(url, fetchImpl, {timeoutMs = 4000} = {}) {
  const status = canonicalStatusUrl(url);
  if (!status || typeof fetchImpl !== 'function') return '';
  const targets = [
    `${OEMBED_ORIGIN}/oembed?omit_script=true&dnt=true&url=${encodeURIComponent(status.url)}`,
    `${SYNDICATION_ORIGIN}/tweet-result?id=${status.id}&lang=zh-cn`,
  ];
  for (const endpoint of targets) {
    try {
      const response = await fetchImpl(endpoint, {
        headers:{Accept:'application/json', 'User-Agent':'woyun-feed-preview/excerpt'},
        redirect:'manual',
        ...(typeof AbortSignal?.timeout === 'function' ? {signal:AbortSignal.timeout(timeoutMs)} : {}),
      });
      const text = excerptFromPayload(await readJson(response));
      if (text) return text;
    } catch { /* The next public card, or no excerpt. */ }
  }
  return '';
}
