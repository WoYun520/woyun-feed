// Public read of one X status, used to fill a missing intake excerpt and,
// when absent, a cover. impact.kosx.ai does not fetch this in the browser.
// Its Worker stores full_text and media from api.socialdata.tools, which needs
// a paid Bearer key. Photos and video posters are served as media[].url on
// pbs.twimg.com (the mp4 stays on media[].videoUrl). This path does not call
// that API, api.x.com, or any cookie session. The public equivalent is the
// same FxTwitter / syndication payload: an X Article cover, else a card image,
// else the first photo, else a video thumbnail.
//
// publish.twitter.com/oembed now answers 301 with an empty body and a Location
// of publish.x.com. Redirects stay manual, so the old host is not requested.
// FxTwitter already expands note_tweet into tweet.text. The syndication card
// only returns a body when the public embed token is present; a bare id returns {}.

import { normalizeCoverUrl } from './src/postMedia.js';

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

const EMPTY_FACE = Object.freeze({text:'', cover_url:'', has_article:false, article_title:''});

function statusNodes(payload) {
  const list = [];
  const push = value => {
    if (value && typeof value === 'object' && !Array.isArray(value) && !list.includes(value)) list.push(value);
  };
  push(payload);
  push(payload?.tweet);
  push(payload?.data);
  push(payload?.data?.tweet);
  return list;
}

// https image only. Same host and secret rules as intake cover_url. A video
// file is not a cover; profile images are not the post.
function imageCover(value) {
  const href = normalizeCoverUrl(value);
  if (!href) return '';
  let url;
  try { url = new URL(href); } catch { return ''; }
  const path = url.pathname.toLowerCase();
  if (path.includes('/profile_images/') || path.includes('/profile_banners/')) return '';
  if (/\.(?:mp4|m3u8|mpd|webm|mov|m4s)$/.test(path)) return '';
  const host = url.hostname.toLowerCase();
  const pbsImage = host === 'pbs.twimg.com' && /^\/(?:media|amplify_video_thumb|ext_tw_video_thumb|tweet_video_thumb|card_img)\//.test(path);
  const imageExt = /\.(?:jpe?g|png|webp)$/.test(path);
  const format = (url.searchParams.get('format') || '').toLowerCase();
  const imageFormat = /^(?:jpe?g|png|webp)$/.test(format);
  return pbsImage || imageExt || imageFormat ? href : '';
}

function articleCover(article) {
  if (!article || typeof article !== 'object') return '';
  const cover = article.cover_media;
  if (typeof cover === 'string') return imageCover(cover);
  const info = cover?.media_info;
  return imageCover(info?.original_img_url)
    || imageCover(cover?.media_url_https)
    || imageCover(cover?.url)
    || imageCover(article.cover_url)
    || imageCover(article.preview_image_url);
}

function cardCover(node) {
  const card = node?.card;
  const bindings = card && typeof card === 'object' ? (card.binding_values || card.bindingValues) : null;
  const urls = [];
  if (bindings && typeof bindings === 'object') {
    const entries = Array.isArray(bindings) ? bindings.map(entry => [entry?.key || entry?.name || '', entry]) : Object.entries(bindings);
    const preferred = [];
    const rest = [];
    for (const [key, entry] of entries) {
      const url = entry?.image_value?.url || entry?.imageValue?.url;
      if (typeof url !== 'string' || !url) continue;
      if (/photo_image_full|summary_photo|thumbnail_image|player_image/i.test(String(key))) preferred.push(url);
      else rest.push(url);
    }
    urls.push(...preferred, ...rest);
  }
  if (typeof node?.thumbnail_url === 'string') urls.push(node.thumbnail_url);
  for (const url of urls) {
    const image = imageCover(url);
    if (image) return image;
  }
  return '';
}

function mediaLists(node) {
  const lists = [];
  const media = node?.media;
  if (Array.isArray(media)) lists.push(media);
  else if (media && typeof media === 'object') {
    for (const key of ['photos', 'all', 'videos']) if (Array.isArray(media[key])) lists.push(media[key]);
  }
  if (Array.isArray(node?.photos)) lists.push(node.photos);
  if (Array.isArray(node?.mediaDetails)) lists.push(node.mediaDetails);
  const extended = node?.extended_entities?.media || node?.entities?.media;
  if (Array.isArray(extended)) lists.push(extended);
  return lists;
}

function mediaKind(item) {
  return String(item?.type || item?.kind || '').toLowerCase();
}

function firstPhoto(node) {
  for (const list of mediaLists(node)) {
    for (const item of list) {
      const kind = mediaKind(item);
      if (kind && kind !== 'photo' && kind !== 'image') continue;
      const url = imageCover(item?.url) || imageCover(item?.media_url_https);
      if (url) return url;
    }
  }
  return '';
}

function firstVideoThumb(node) {
  for (const list of mediaLists(node)) {
    for (const item of list) {
      const kind = mediaKind(item);
      if (kind !== 'video' && kind !== 'animated_gif' && kind !== 'gif') continue;
      const thumb = imageCover(item?.thumbnail_url) || imageCover(item?.preview_image_url) || imageCover(item?.media_url_https) || imageCover(item?.url);
      if (thumb) return thumb;
    }
  }
  return '';
}

// Article cover, then a twitter card image, then the first photo, then a
// video thumbnail. The mp4 itself is never the cover.
export function coverFromStatusPayload(payload) {
  const found = {article:'', card:'', photo:'', video:''};
  for (const node of statusNodes(payload)) {
    if (!found.article) found.article = articleCover(node.article);
    if (!found.card) found.card = cardCover(node);
    if (!found.photo) found.photo = firstPhoto(node);
    if (!found.video) found.video = firstVideoThumb(node);
  }
  return found.article || found.card || found.photo || found.video || '';
}

export function statusHasArticle(payload) {
  for (const node of statusNodes(payload)) {
    if (node.article && typeof node.article === 'object' && !Array.isArray(node.article)) return true;
    const card = node.card;
    const name = card && typeof card === 'object'
      ? String(card.name || card.card_type || '')
      : (typeof node.twitter_card === 'string' ? node.twitter_card : '');
    if (/article/i.test(name)) return true;
  }
  return false;
}

export function articleTitleFromStatusPayload(payload) {
  for (const node of statusNodes(payload)) {
    const title = node.article?.title;
    if (typeof title === 'string' && title.trim()) return title.trim();
  }
  return '';
}

export function faceFromStatusPayload(payload) {
  if (!payload || typeof payload !== 'object') return {...EMPTY_FACE};
  return {
    text:excerptFromStatusPayload(payload),
    cover_url:coverFromStatusPayload(payload),
    has_article:statusHasArticle(payload),
    article_title:articleTitleFromStatusPayload(payload),
  };
}

function mergeFace(current, next) {
  if (!next) return current;
  return {
    text:next.text.length > current.text.length ? next.text : current.text,
    cover_url:current.cover_url || next.cover_url || '',
    has_article:current.has_article || next.has_article === true,
    article_title:current.article_title || next.article_title || '',
  };
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
  return {face:faceFromStatusPayload(await readJson(response)), retry:retryableStatus(response?.status)};
}

// Text plus a cover and article flag from the same public read. Stops once a
// body is found, and keeps a cover already seen on an earlier payload.
// fetchImpl is the only network call. Redirects are not followed.
export async function fetchXStatusFace(url, fetchImpl, {timeoutMs = 4000, retryDelayMs = 200} = {}) {
  const status = canonicalStatusUrl(url);
  if (!status || typeof fetchImpl !== 'function') return {...EMPTY_FACE};
  const targets = [
    {endpoint:`${FXTWITTER_ORIGIN}/status/${status.id}`, retry:true},
    {endpoint:`${SYNDICATION_ORIGIN}/tweet-result?id=${status.id}&token=${encodeURIComponent(syndicationToken(status.id))}&lang=zh-cn`, retry:false},
    {endpoint:`${OEMBED_ORIGIN}/oembed?omit_script=true&dnt=true&url=${encodeURIComponent(status.url)}`, retry:false},
  ];
  let face = {...EMPTY_FACE};
  for (const target of targets) {
    const attempts = target.retry ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let outcome = {face:{...EMPTY_FACE}, retry:false};
      try { outcome = await readStatus(fetchImpl, target.endpoint, timeoutMs); }
      catch { outcome = {face:{...EMPTY_FACE}, retry:true}; }
      face = mergeFace(face, outcome.face);
      if (face.text) return face;
      if (!(target.retry && outcome.retry && attempt + 1 < attempts)) break;
      await pause(retryDelayMs);
    }
  }
  return face;
}

// Returns the status text, or '' when every public read is missing or refused.
export async function fetchXStatusText(url, fetchImpl, options) {
  return (await fetchXStatusFace(url, fetchImpl, options)).text;
}
