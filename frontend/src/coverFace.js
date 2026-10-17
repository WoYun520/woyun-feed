import { normalizeCoverUrl, normalizePostImage } from './postMedia.js';
import { postStatusId } from './postStream.js';
import { isReviewSignalCopy, stripIntakePipelineCopy } from './reviewQueue.js';

const ARTICLE_TYPES = new Set(['文章', '教程指南']);
const PROMO_TYPES = new Set(['产品安利', '避坑']);
const KOSX_PUBLIC_SOURCE_ID = 'sopilot-kosx';

// 文章类 for a cover: an article or tutorial, or an X Article card. A row pasted
// as 短帖 still counts when has_article is set, so the article cover can paint.
// 产品安利 and 避坑 stay text cards even if that flag is present. Excerpt clues
// do not count.
export function isArticleClassItem(item) {
  const type = typeof item?.review_type === 'string' ? item.review_type : '';
  if (PROMO_TYPES.has(type)) return false;
  if (type === '短帖') return item?.has_article === true;
  return ARTICLE_TYPES.has(type) || item?.has_article === true;
}

export function itemAuthorHandle(item) {
  if (typeof item?.author_handle === 'string' && /^[A-Za-z0-9_]{1,15}$/.test(item.author_handle)) return item.author_handle;
  for (const value of [item?.original_url, item?.canonical_url]) {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      const host = url.hostname.replace(/^www\./, '').toLowerCase();
      if (host !== 'x.com' && host !== 'twitter.com') continue;
      const handle = url.pathname.split('/').filter(Boolean)[0] || '';
      if (/^[A-Za-z0-9_]{1,15}$/.test(handle) && handle.toLowerCase() !== 'i') return handle;
    } catch { /* not a post url */ }
  }
  return '';
}

// Old pool and review rows stored a process sentence as the excerpt. That
// sentence is not the post. A real note before it stays; the sentence does not.
function policyRemainder(rest) {
  const words = /账号池成员的精华帖|按时间放上首页|过审后放上首页|的 X 链接|尚未读取原文|未核对热度|不进入昨日最被低估/g;
  return !/[A-Za-z0-9\u4e00-\u9fff]/.test(rest.replace(words, ''));
}

export function coverExcerpt(summary) {
  const text = typeof summary === 'string' ? summary.trim() : '';
  if (!text) return '';
  const clause = /账号池成员的精华帖，按时间放上首页|过审后放上首页(?:的 X 链接)?|尚未读取原文，未核对热度|不进入昨日最被低估/g;
  let cut = text.length;
  for (const match of text.matchAll(clause)) {
    const index = match.index ?? 0;
    if (index < cut && policyRemainder(text.slice(index))) cut = index;
  }
  if (cut === text.length) return text;
  return text.slice(0, cut).replace(/[。．\s]+$/u, '').trim();
}

// Classifier blurbs such as「文章卡·收藏5/点赞18·Levi样例·收藏偏低但类型优先」
// are review evidence. Intake notes such as「全X中文≥1k补仓 | 非池 | 待人工过审 | rank13」
// are backlog remarks. A real title stays. Either leftover uses the same
// @handle 的精华帖 face as other essence cards.
export function homepageCardTitle(item) {
  const raw = typeof item?.title === 'string' ? item.title.trim() : '';
  const title = stripIntakePipelineCopy(raw);
  if (title && !isReviewSignalCopy(title)) return title;
  if (!raw) return '来源未提供标题';
  const handle = itemAuthorHandle(item);
  return handle ? `@${handle} 的精华帖` : '来源未提供标题';
}

function placeholderCardTitle(item) {
  const handle = itemAuthorHandle(item);
  return handle ? `@${handle} 的精华帖` : '来源未提供标题';
}

// 「@用户 的精华帖」and「来源未提供标题」are faces, not a sentence from the post.
export function usableCardTitle(item) {
  const title = homepageCardTitle(item);
  if (!title || title === '来源未提供标题' || title === placeholderCardTitle(item)) return '';
  return title;
}

// Intake sometimes glues a type tag onto a real sentence, as in
// 「宏观黑板微观树（文章卡）」. The tag is not the excerpt. A classifier
// blurb such as「文章卡·收藏5/点赞18·Levi样例·收藏偏低但类型优先」still drops.
function withoutClassifierTag(line) {
  const text = line.trim();
  const tagged = text
    .replace(/\s*[（(]\s*(?:文章卡|Article卡)\s*[）)]\s*$/u, '')
    .replace(/\s*(?:文章卡|Article卡)\s*$/u, '');
  if (tagged === text) return text;
  return tagged.replace(/[：:·\s]+$/u, '').trim();
}

export function homepageCardExcerpt(summary) {
  const excerpt = stripIntakePipelineCopy(coverExcerpt(summary));
  if (!excerpt) return '';
  return excerpt.split(/\n+/).map(line => {
    const cleaned = withoutClassifierTag(line);
    if (!cleaned || isReviewSignalCopy(cleaned)) return '';
    return cleaned;
  }).filter(Boolean).join('\n');
}

function coverRecords(post) {
  return [post?.item, ...(Array.isArray(post?.records) ? post.records : [])].filter(item => item && typeof item === 'object');
}

function isKosxCard(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.origin === 'kosx_approved') return true;
  const refs = item.source_refs;
  return Array.isArray(refs) && refs.length === 1 && refs[0] === KOSX_PUBLIC_SOURCE_ID;
}

// Article-class KOSX cards use a delivered cover when one was stored.
// Anything else stays on the text card: a quote, or title and meta.
function articleCover(item) {
  if (!isKosxCard(item) || !isArticleClassItem(item)) return null;
  const url = normalizeCoverUrl(item?.cover_url);
  return url ? {url, kind:'article_cover'} : null;
}

function postImage(post) {
  if (!post || typeof post !== 'object') return null;
  const record = coverRecords(post).find(item => (postStatusId(item?.original_url) === post.statusId || postStatusId(item?.canonical_url) === post.statusId)
    && normalizePostImage(item.post_image, post.originalUrl));
  return record ? normalizePostImage(record.post_image, post.originalUrl) : null;
}

// The image the cover card would paint: an article cover, or a same-post photo.
export function showcaseCoverMedia(post) {
  return coverRecords(post).map(articleCover).find(Boolean) || postImage(post) || null;
}

// A public cover with no usable excerpt and no visible media is a blank face.
// Placeholder titles and intake remarks do not count. A same-post donor excerpt
// or a cover that the card actually shows does.
export function blankPublicCover(post) {
  if (!post || typeof post !== 'object') return true;
  if (showcaseCoverMedia(post)) return false;
  return !coverRecords(post).some(item => homepageCardExcerpt(item?.summary));
}

const PLACEHOLDER_EXCERPT = /^@[A-Za-z0-9_]{1,15} 的精华帖$/u;

// homepageCardExcerpt keeps a real sentence. 「@用户 的精华帖」and「来源未提供标题」
// are faces, the same way usableCardTitle treats them. Intake remarks are already gone.
export function usableExcerptText(value) {
  const excerpt = homepageCardExcerpt(value);
  if (!excerpt || excerpt === '来源未提供标题' || PLACEHOLDER_EXCERPT.test(excerpt)) return '';
  return excerpt;
}

// A pending row is a blank face when it has no real text, summary, excerpt, body,
// or note, and the homepage would not paint a cover. Placeholder titles do not count.
// This is the same blank-face rule as blankPublicCover, with the placeholder face
// excluded from the excerpt.
export function pendingBlankFace(record) {
  if (!record || typeof record !== 'object') return true;
  for (const key of ['text', 'summary', 'excerpt', 'body', 'note']) {
    if (usableExcerptText(record[key])) return false;
  }
  const summary = typeof record.text === 'string' && record.text.trim()
    ? record.text
    : (typeof record.note === 'string' ? record.note : '');
  const item = {
    summary,
    title:typeof record.note === 'string' ? record.note : '',
    author_handle:record.author_handle,
    original_url:record.url,
    canonical_url:record.url,
    review_type:record.review_type,
    has_article:record.has_article,
    cover_url:record.cover_url,
    origin:'kosx_approved',
    source_refs:['sopilot-kosx'],
  };
  const statusId = postStatusId(record.url);
  return !showcaseCoverMedia({item, records:[item], originalUrl:record.url, statusId});
}
