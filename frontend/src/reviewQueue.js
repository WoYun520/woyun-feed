// Coarse labels for the public pending queue. They suggest a reading order.
// They do not publish, pin, or verify a post.
export const REVIEW_TYPES = Object.freeze(['文章', '教程指南', '避坑', '短帖', '产品安利']);
export const REVIEW_TYPE_PRIORITY = Object.freeze({
  '文章': 0,
  '教程指南': 1,
  '避坑': 2,
  '短帖': 3,
  '产品安利': 4,
});
export const REVIEW_TEXT_MAX = 800;
export const REVIEW_COUNT_MAX = 1_000_000_000;

const TUTORIAL = /步骤|教程|模板|架构|清单|工作流|安装步骤|配置步骤|如何|怎么做|手把手|step[- ]by[- ]step|\btemplate\b|\barchitecture\b|\bhow to\b|walkthrough/i;
const PITFALL = /避坑|踩坑|误区|别再|不要这样|坑点|翻车|\bpitfall\b|\bgotcha\b/i;
const PROMO = /安利|推荐入手|上线了|限时|优惠|促销|种草|\bpromo\b|product hunt|值得一试/i;
const PANIC = /震惊|紧急|崩了|爆料|吃瓜|恐慌|谣言|\bgossip\b/i;
const NOTE_TYPE = /(?:类型|type)\s*[:：]\s*(文章|教程指南|避坑|短帖|产品安利)/i;

export function reviewCount(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > REVIEW_COUNT_MAX) return null;
  return value;
}

export function noteReviewType(note) {
  if (typeof note !== 'string') return null;
  const trimmed = note.trim();
  if (REVIEW_TYPES.includes(trimmed)) return trimmed;
  const match = trimmed.match(NOTE_TYPE);
  return match ? match[1] : null;
}

function combinedText(input) {
  return [input.text, input.note].filter(value => typeof value === 'string').join('\n');
}

function textLength(value) {
  return Array.from(typeof value === 'string' ? value.trim() : '').length;
}

export function bookmarkSignal(bookmarkCount, likeCount) {
  if (bookmarkCount === null || likeCount === null) return false;
  if (bookmarkCount === 0 && likeCount === 0) return false;
  return bookmarkCount >= likeCount || (likeCount > 0 && bookmarkCount / likeCount >= 0.5);
}

// Explicit review_type wins. A note of "类型：避坑" (or a note that is only the
// label) wins next, so the existing note can correct the guess. Otherwise the
// order follows 文章卡长文, 教程指南, 避坑, then 短帖 / 产品安利.
export function classifyReviewItem(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const given = REVIEW_TYPES.includes(source.review_type) ? source.review_type : null;
  const fromNote = noteReviewType(source.note);
  const blob = combinedText(source);
  const length = Math.max(textLength(source.text), textLength(source.note));
  const hasArticle = source.has_article === true;
  const bookmark_count = reviewCount(source.bookmark_count);
  const like_count = reviewCount(source.like_count);
  const tutorial = TUTORIAL.test(blob);
  const pitfall = PITFALL.test(blob);
  const promo = PROMO.test(blob);
  const panic = PANIC.test(blob);
  const slogan = length > 0 && length < 24 && !tutorial && !pitfall;
  let review_type = given || fromNote;
  const type_source = given ? 'given' : fromNote ? 'note' : 'heuristic';
  if (!review_type) {
    if (hasArticle && !tutorial && !pitfall) review_type = '文章';
    else if (tutorial) review_type = '教程指南';
    else if (pitfall) review_type = '避坑';
    else if (promo) review_type = '产品安利';
    else if (length >= 120 && !panic) review_type = '文章';
    else review_type = '短帖';
  }
  const skip_cue = type_source === 'heuristic' && (review_type === '产品安利' || (review_type === '短帖' && (panic || slogan || length < 24)));
  return {
    review_type,
    type_source,
    has_article: hasArticle,
    bookmark_count,
    like_count,
    bookmark_signal: bookmarkSignal(bookmark_count, like_count),
    skip_cue,
    priority: REVIEW_TYPE_PRIORITY[review_type],
  };
}

export function presentReviewItem(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const classified = classifyReviewItem(source);
  const articleKnown = source.has_article === true || source.has_article === false;
  return {
    ...source,
    review_type: classified.review_type,
    type_source: classified.type_source,
    has_article: articleKnown ? source.has_article === true : false,
    article_known: articleKnown,
    bookmark_count: classified.bookmark_count,
    like_count: classified.like_count,
    bookmark_signal: classified.bookmark_signal,
    skip_cue: classified.skip_cue,
    priority: classified.priority,
  };
}

export function sortReviewQueue(items) {
  return (Array.isArray(items) ? items : []).map((item, index) => ({item:presentReviewItem(item), index})).sort((left, right) => {
    if (left.item.priority !== right.item.priority) return left.item.priority - right.item.priority;
    if (left.item.has_article !== right.item.has_article) return left.item.has_article ? -1 : 1;
    if (left.item.bookmark_signal !== right.item.bookmark_signal) return left.item.bookmark_signal ? -1 : 1;
    const leftTime = Date.parse(left.item.submitted_at || '');
    const rightTime = Date.parse(right.item.submitted_at || '');
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return rightTime - leftTime;
    return left.index - right.index;
  }).map(({item}) => item);
}

// Short classifier blurbs such as「文章卡·收藏5/点赞18·Levi样例·收藏偏低但类型优先」
// are evidence copy. They are not the post. Longer notes stay visible.
const SIGNAL_COPY = /文章卡|收藏偏低|类型优先|互动尚低|可执行提示词|Levi样例|收藏信号|Article卡|收藏\/点赞|收藏\d+[/／]点赞\d+/;

export function isReviewSignalCopy(value) {
  if (typeof value !== 'string') return false;
  const compact = value.replace(/\s+/g, '');
  if (!compact || compact.length > 80) return false;
  return SIGNAL_COPY.test(compact);
}
