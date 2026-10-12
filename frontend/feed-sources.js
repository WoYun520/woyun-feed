import { createHash } from 'node:crypto';
import { parsePublicSource } from './public-source-readers.js';
import { parseSopilotRank } from './sopilot-source-reader.js';
import { parseSopilotAuthor } from './sopilot-author-reader.js';
import { CREATOR_SOURCES, CREATOR_BLOG_SOURCES } from './creator-sources.js';
import { parseHackerNewsApi } from './hackernews-source-reader.js';
import { normalizePostImage } from './src/postMedia.js';

export const FEED_CHANNELS = [
  {id:'sspai', channel:'sspai', name:'少数派', group:'tech', home_url:'https://sspai.com', kind:'original', feed_url:'https://sspai.com/feed', format:'rss'},
  {id:'v2ex-share', channel:'v2ex-share', name:'V2EX 分享发现', group:'community', home_url:'https://www.v2ex.com/go/share', kind:'community', feed_url:'https://www.v2ex.com/feed/share.xml', format:'atom'},
  {id:'ithome', name:'IT之家', group:'tech', home_url:'https://www.ithome.com', kind:'original', feed_url:'https://www.ithome.com/list/', format:'public-html'},
  {id:'solidot', name:'Solidot 科技资讯', group:'tech', home_url:'https://www.solidot.org', kind:'original', feed_url:'https://www.solidot.org/index.rss', format:'rss'},
  {id:'producthunt', name:'Product Hunt 新产品', group:'tech', home_url:'https://www.producthunt.com', kind:'community', feed_url:'https://www.producthunt.com/feed', format:'atom', read_summary:true},
  {id:'github-trending', name:'GitHub 今日趋势', group:'tech', home_url:'https://github.com/trending', kind:'repository', feed_url:'https://github.com/trending?spoken_language_code=', format:'public-html', ranked:true, link_kind:'repository'},
  {id:'juejin', name:'掘金技术热榜', group:'community', home_url:'https://juejin.cn', kind:'community', feed_url:'https://api.juejin.cn/content_api/v1/content/article_rank?category_id=1&type=hot&spider=0', format:'public-json', ranked:true},
  {id:'hackernews', name:'Hacker News', group:'community', home_url:'https://news.ycombinator.com', kind:'community', feed_url:'https://hacker-news.firebaseio.com/v0/topstories.json', format:'hackernews-api', ranked:true, link_kind:'discussion', reading_note:'HN 官方 API：最多读取首页前 10 项，实际项数按本轮请求余量；保留原榜单位置，单项读取失败时保留上次内容。'},
  {id:'zhihu', name:'知乎热榜', group:'hot', home_url:'https://www.zhihu.com', kind:'community', feed_url:'https://www.zhihu.com/api/v3/feed/topstory/hot-list-web?limit=20&desktop=true', format:'public-json', ranked:true, link_kind:'discussion'},
  {id:'thepaper', name:'澎湃新闻热榜', group:'hot', home_url:'https://www.thepaper.cn', kind:'original', feed_url:'https://cache.thepaper.cn/contentapi/wwwIndex/rightSidebar', format:'public-json', ranked:true},
  {id:'toutiao', name:'今日头条热榜', group:'hot', home_url:'https://www.toutiao.com', kind:'aggregator', feed_url:'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc', format:'public-json', ranked:true, link_kind:'topic'},
  {id:'baidu', name:'百度热搜', group:'hot', home_url:'https://top.baidu.com/board?tab=realtime', kind:'aggregator', feed_url:'https://top.baidu.com/board?tab=realtime', format:'public-html', ranked:true, link_kind:'search'},
  {id:'wallstreetcn-hot', name:'华尔街见闻热门', group:'finance', home_url:'https://wallstreetcn.com', kind:'original', feed_url:'https://api-one.wallstcn.com/apiv1/content/articles/hot?period=all', format:'public-json', ranked:true},
  {id:'wired', name:'WIRED AI 与科技', group:'tech', home_url:'https://www.wired.com/tag/ai/', kind:'original', feed_url:'https://www.wired.com/feed/tag/ai/latest/rss', format:'rss'},
  {id:'mit-tech', name:'MIT 科技评论', group:'tech', home_url:'https://www.technologyreview.com', kind:'original', feed_url:'https://www.technologyreview.com/feed/', format:'rss'},
  {id:'36kr', name:'36氪', group:'community', home_url:'https://www.36kr.com', kind:'original', feed_url:'https://www.36kr.com/feed', format:'rss', reading_note:'官方 RSS：创业、科技与商业资讯，保留原文链接及来源摘要。'},
  {id:'ifanr', name:'爱范儿', group:'tech', home_url:'https://www.ifanr.com', kind:'original', feed_url:'https://www.ifanr.com/feed', format:'rss', reading_note:'官方 RSS：科技产品与数字生活，保留原文链接及来源摘要。'},
  {id:'appinn', name:'小众软件', group:'tech', home_url:'https://www.appinn.com', kind:'original', feed_url:'https://www.appinn.com/feed/', format:'rss', reading_note:'官方 RSS：软件与实用工具，保留文章或社区原链接及来源摘要。'},
  {id:'youtube-openai', name:'YouTube · OpenAI 官方演示', group:'creators', home_url:'https://www.youtube.com/@OpenAI', kind:'original', feed_url:'https://www.youtube.com/feeds/videos.xml?channel_id=UCXZCJLdBC09xxGZ6gcdrc6A', format:'atom', youtube_channel_id:'UCXZCJLdBC09xxGZ6gcdrc6A', read_summary:true, link_kind:'video'},
  {id:'youtube-deepmind', name:'YouTube · Google DeepMind', group:'creators', home_url:'https://www.youtube.com/@GoogleDeepMind', kind:'original', feed_url:'https://www.youtube.com/feeds/videos.xml?channel_id=UCP7jMXSY2xbc3KCAE0MHQ-A', format:'atom', youtube_channel_id:'UCP7jMXSY2xbc3KCAE0MHQ-A', read_summary:true, link_kind:'video'},
  {id:'youtube-anthropic', name:'YouTube · Anthropic 官方频道', group:'creators', home_url:'https://www.youtube.com/@anthropic-ai', kind:'original', feed_url:'https://www.youtube.com/feeds/videos.xml?channel_id=UCrDwWp7EBBv4NwvScIpBDOA', format:'atom', youtube_channel_id:'UCrDwWp7EBBv4NwvScIpBDOA', read_summary:true, link_kind:'video'},
  {id:'sopilot-ai', name:'SoPilot · AI 推文榜', group:'posts', home_url:'https://sopilot.net/zh/rank/tweets?range=24h&category=AI', feed_url:'https://sopilot.net/zh/rank/tweets?range=24h&category=AI', kind:'aggregator', format:'public-html', sopilot_category:'AI', ranked:true, link_kind:'post', reading_note:'SoPilot 的 AI 分类 · 24 小时上涨榜，最多前 2 页、100 条，按每小时曝光排序；摘录和热度尚未核对原帖。'},
  {id:'sopilot-creators', name:'SoPilot · 自媒体推文榜', group:'posts', home_url:'https://sopilot.net/zh/rank/tweets?range=24h&category=Creator', feed_url:'https://sopilot.net/zh/rank/tweets?range=24h&category=Creator', kind:'aggregator', format:'public-html', sopilot_category:'Creator', ranked:true, link_kind:'post', reading_note:'SoPilot 的自媒体分类 · 24 小时上涨榜，最多前 2 页、100 条，按每小时曝光排序；分类由来源提供，摘录和热度尚未核对原帖。'},
  {id:'sopilot-all', name:'SoPilot · 综合推文榜', group:'posts', home_url:'https://sopilot.net/zh/rank/tweets?range=24h', feed_url:'https://sopilot.net/zh/rank/tweets?range=24h', kind:'aggregator', format:'public-html', sopilot_category:'all', ranked:true, link_kind:'post', reading_note:'SoPilot 的全部领域 · 24 小时上涨榜，最多前 2 页、100 条，按每小时曝光排序；摘录和热度尚未核对原帖。'},
  {id:'sopilot-finance', name:'SoPilot · 财经推文榜', group:'posts', home_url:'https://sopilot.net/zh/rank/tweets?range=24h&category=Finance', feed_url:'https://sopilot.net/zh/rank/tweets?range=24h&category=Finance', kind:'aggregator', format:'public-html', sopilot_category:'Finance', ranked:true, link_kind:'post', reading_note:'SoPilot 的财经分类 · 24 小时上涨榜，最多前 2 页、100 条，按每小时曝光排序；摘录和热度尚未核对原帖。'},
  ...CREATOR_SOURCES,
  ...CREATOR_BLOG_SOURCES,
].map(source=>({channel:source.id,...source}));

export function canonicalUrl(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    if (/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[|.*\.local$)/i.test(url.hostname)) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    if (['github.com','www.github.com','sspai.com','www.sspai.com','v2ex.com','www.v2ex.com'].includes(url.hostname)) {
      url.hostname = url.hostname.replace(/^www\./, ''); url.protocol = 'https:';
    }
    if (url.hostname === 'github.com') url.pathname = url.pathname.replace(/\.git\/?$/, '').toLowerCase();
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/$/, '');
    url.searchParams.sort();
    return url.href;
  } catch { return null; }
}

// Post IDs survive author-handle case differences and renames. Use this only
// as a merge identity; original URLs and existing item IDs remain unchanged.
export function sourceLinkIdentity(value) {
  const canonical=canonicalUrl(value);if(!canonical)return null;
  const url=new URL(canonical),post=/^\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})$/.exec(url.pathname);
  return ['x.com','www.x.com','twitter.com','www.twitter.com'].includes(url.hostname) && post
    ? 'x-post:'+post[2] : canonical;
}

export function sourceBucketFromItems(items, id) {
  return items.filter(item=>item.source_refs?.includes(id)).map(item=>{
    const link=item.source_links?.find(entry=>entry.source_id===id),sole=item.source_refs.length===1;
    const restored={...structuredClone(item),source_refs:[id],source_links:[],
      evidence_ref:link?.evidence_ref || (sole ? item.evidence_ref : null),
      captured_at:link ? link.captured_at || null : sole ? item.captured_at : null,
      source_updated_at:link ? link.source_updated_at || null : sole ? item.source_updated_at : null,
      source_rank:link ? link.source_rank ?? null : sole ? item.source_rank : null,
      heat_label:link ? link.heat_label ?? null : sole ? item.heat_label : null};
    if (!id.startsWith('sopilot-author-') && !id.startsWith('creator-blog-')) {
      delete restored.read_scope;delete restored.excerpt_truncated;delete restored.excerpt_original_length;
      delete restored.blog_method_hint;
      delete restored.creator_id;
    }
    return restored;
  });
}

export function normalizeSubscription(body, source, capturedAt, evidenceRef) {
  if (!body || body.id !== source.channel || !['success','cache'].includes(body.status) || !Array.isArray(body.items)) throw new Error('来源返回的内容不完整，保留原有资料。');
  const items = new Map();
  const sourceTime = Number.isFinite(body.updatedTime) && body.updatedTime > 0 && body.updatedTime <= 8640000000000000 ? new Date(body.updatedTime).toISOString() : null;
  for (const raw of body.items.slice(0, source.sopilot_category ? 100 : 30)) {
    if (!raw || typeof raw.title !== 'string' || !raw.title.trim() || typeof raw.url !== 'string' || raw.url.length > 4000) continue;
    const articleUrl=source.creator_scope==='blog-feed' ? creatorBlogArticleUrl(raw.url,source) : raw.url;
    if (source.creator_scope==='blog-feed' && !articleUrl) throw new Error('来源博客文章不匹配，保留原有资料。');
    const key = canonicalUrl(articleUrl); if (!key) continue;
    const id = 'news-' + createHash('sha256').update(key).digest('hex').slice(0, 24);
    if (items.has(id)) continue;
    const date = raw.extra?.date;
    const itemTime = typeof date === 'string' && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : null;
    const rawSummary = typeof raw.summary==='string' ? raw.summary.trim() : '';
    const authorScope=source.format==='sopilot-author';
    const blogScope=source.creator_scope==='blog-feed';
    const summary = rawSummary.slice(0,authorScope ? 12000 : 1000);
    const postImage = source.link_kind === 'post' ? normalizePostImage(raw.post_image, articleUrl) : null;
    items.set(id, {id, title:raw.title.trim().slice(0, 500), summary:summary || `来自${source.name}的标题线索，正文尚未读取。`, summary_label:summary ? blogScope ? '作者博客订阅摘要，未核对原文全文' : source.link_kind==='post' ? '榜单摘录，未核对原帖' : '来源摘要' : '读取范围',
      ...(blogScope ? {...(source.creator_handle ? {author_handle:source.creator_handle} : {}),
        ...(source.creator_id ? {creator_id:source.creator_id} : {}),author_name:source.creator_name,read_scope:'author-blog-feed',
        ...( ['steps-and-example','action-guide'].includes(raw.extra?.blog_method_hint) ? {blog_method_hint:raw.extra.blog_method_hint} : {}),
        excerpt_truncated:rawSummary.length>1000 || raw.extra?.excerpt_truncated===true,
        excerpt_original_length:Number.isSafeInteger(raw.extra?.excerpt_original_length) ? raw.extra.excerpt_original_length : rawSummary.length} : {}),
      ...(source.link_kind==='post' && typeof raw.author_name==='string' && raw.author_name.trim() && !/[\u0000-\u001f\u007f]/.test(raw.author_name) ? {author_name:raw.author_name.trim().slice(0,100)} : {}),
      ...(source.link_kind==='post' && typeof raw.author_handle==='string' && /^[A-Za-z0-9_]{1,15}$/.test(raw.author_handle) ? {author_handle:raw.author_handle} : {}),
      ...(postImage ? {post_image:postImage} : {}),
      source_refs:[source.id], original_url:articleUrl, canonical_url:key, published_at:typeof raw.published_at==='string' && Number.isFinite(Date.parse(raw.published_at)) ? new Date(raw.published_at).toISOString() : null, updated_at:null,
      ...(authorScope ? {read_scope:'author-7d-top10',excerpt_truncated:raw.extra?.excerpt_truncated===true || rawSummary.length>12000,
        excerpt_original_length:Number.isSafeInteger(raw.extra?.excerpt_original_length) ? raw.extra.excerpt_original_length : rawSummary.length} : {}),
      captured_at:capturedAt, source_updated_at:sourceTime, source_item_time:itemTime,
      content_status:summary ? 'excerpt_only' : 'headline_only', verification_status:'not_tested', recommendation_kind:'rule',
      source_rank:Number.isSafeInteger(raw.source_rank) && raw.source_rank>0 ? raw.source_rank : null, heat_label:typeof raw.heat_label==='string' ? raw.heat_label.slice(0,80) : null, link_kind:source.link_kind || 'article',
      recommendation_reason:'从所选频道读取的标题线索，是否值得深入阅读仍需核对。',
      evidence_ref:evidenceRef, unknowns:[source.link_kind==='video' ? '只读取视频标题、链接和公开视频简介，未观看视频或读取字幕。' : source.link_kind==='post' ? '只读取第三方公开榜单的帖子摘录、作者与热度，未核对 X 原帖、作者身份或统计数据。' : '只读取公开列表里的标题、链接及可用摘要，未读取完整正文或验证内容。','来源更新时间和本机获取时间都不等于内容发布时间。',...(source.ranked ? ['榜单位置仅代表该来源本次返回的顺序，不代表质量或跨平台热度。'] : [])],
      suggested_question:`请查看 ${raw.url} 的${source.link_kind==='video' ? '原视频' : '原文'}，说明它解决什么问题，并区分${source.link_kind==='video' ? '视频中的说法' : '原文说法'}与已验证的事实。`,
    });
  }
  if (body.items.length && !items.size) throw new Error('来源没有返回可用的标题和链接，保留原有资料。');
  return {items:[...items.values()], sourceTime, cached:body.status === 'cache'};
}

// Merge only the same normalized link, never merely similar titles or claims.
export function mergeSourceItems(buckets) {
  const groups = new Map();
  const items = Object.values(buckets).flat().sort((a,b) => Number(/^github-\d+$/.test(b.id)) - Number(/^github-\d+$/.test(a.id))
    || Number(b.source_refs?.some(id=>id.startsWith('sopilot-author-') || id.startsWith('creator-blog-'))) - Number(a.source_refs?.some(id=>id.startsWith('sopilot-author-') || id.startsWith('creator-blog-'))));
  for (const item of items) {
    const canonical=canonicalUrl(item.original_url);
    const key = sourceLinkIdentity(item.original_url) || item.id;
    const refs = item.source_refs || [];
    const links = refs.map(source_id => ({source_id, url:item.original_url, evidence_ref:item.evidence_ref, captured_at:item.captured_at, source_updated_at:item.source_updated_at || null, source_rank:item.source_rank || null, heat_label:item.heat_label || null}));
    if (!groups.has(key)) groups.set(key, {...structuredClone(item), canonical_url:canonical || item.canonical_url,
      alias_ids:[...new Set([...(item.alias_ids || []), item.id])], evidence_refs:[item.evidence_ref].filter(Boolean), source_links:links});
    else {
      const existing = groups.get(key);
      // Same-post memberships may differ in media availability. Never borrow a
      // different post's image or replace a validated cover with a missing one.
      if (existing.link_kind === 'post' && !normalizePostImage(existing.post_image, existing.original_url)) {
        const image = normalizePostImage(item.post_image, existing.original_url);
        if (image) existing.post_image = image;
      }
      existing.alias_ids = [...new Set([...existing.alias_ids, ...(item.alias_ids || []), item.id])];
      existing.source_refs = [...new Set([...existing.source_refs, ...refs])];
      existing.evidence_refs = [...new Set([...existing.evidence_refs, item.evidence_ref].filter(Boolean))];
      existing.source_links.push(...links.filter(link => !existing.source_links.some(x=>x.source_id===link.source_id && x.url===link.url)));
    }
  }
  return [...groups.values()];
}


function decodeXml(text) {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, token) => {
    if (!token.startsWith('#')) return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[token.toLowerCase()] || whole;
    const n=token[1].toLowerCase()==='x' ? parseInt(token.slice(2),16) : Number(token.slice(1));
    return n>0 && n<=0x10ffff && !(n>=0xd800 && n<=0xdfff) ? String.fromCodePoint(n) : '';
  });
}
const xmlText = (block,tag) => decodeXml(block.match(new RegExp('<'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)</'+tag+'>','i'))?.[1] || '').trim();
const xmlAttribute = (tag,name) => decodeXml(tag.match(new RegExp('(?:^|\\s)'+name+'\\s*=\\s*["\\x27]([^"\\x27]*)["\\x27]','i'))?.[1] || '');
const plainXml = text => text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,1000);

function configuredBlogUrl(value,source) {
  try {
    const url=new URL(value),allowed=new URL(source.allowed_article_origin);
    if (url.username || url.password || [...url.searchParams.keys()].some(key=>/token|secret|password|api.?key|authorization/i.test(key))) return null;
    // Only a verified, explicitly configured same-host HTTP feed link may be
    // upgraded. This never follows a redirect or accepts a different host/port.
    if (source.upgrade_article_http===true && url.protocol==='http:' && !url.port
      && url.hostname===allowed.hostname && allowed.protocol==='https:' && !allowed.port) url.protocol='https:';
    return url.protocol==='https:' && url.origin===allowed.origin ? url : null;
  } catch {return null;}
}

export function creatorBlogArticleUrl(value,source) {
  const url=configuredBlogUrl(value,source);
  return url && url.pathname!=='/' && !/\/(?:rss|feed|feeds)(?:\/|\.|$)/i.test(url.pathname) ? url.href : null;
}

function validateBlogChannel(value,source) {
  const url=configuredBlogUrl(value,source);
  if (!url || !(source.allowed_channel_urls || [source.allowed_article_origin+'/']).some(allowed=>{
    try {return new URL(allowed).href===url.href;} catch {return false;}
  })) throw new Error('来源博客频道不匹配，保留原有资料。');
}

function excludedBlogSample(title,url,categories,source) {
  if (source.exclude_nonpublic_samples!==true) return false;
  return /🔒/.test(title) || /^(?:测试(?:笔记|文章)?\d*|示例|test\d*|cheshi\d*)$/i.test(title.trim())
    || /(?:^|\/)\b(?:test\d*|cheshi\d*|sample|example)(?:\/|$)/i.test(new URL(url).pathname)
    || categories.some(value=>/^(?:测试|示例|test|cheshi|sample|example)$/i.test(value.trim()));
}

function recentBlogItems(items) {
  return items.map((item,index)=>({item,index,time:Date.parse(item.published_at)}))
    .sort((a,b)=>(Number.isFinite(b.time) ? b.time : -Infinity)-(Number.isFinite(a.time) ? a.time : -Infinity) || a.index-b.index)
    .slice(0,30).map(row=>row.item);
}

function blogPlainText(html) {
  return html.replace(/<(?:script|style|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript)>/gi,'')
    .replace(/<(?:br\b[^>]*|\/(?:p|div|li|h[1-6]|pre|blockquote))>/gi,'\n')
    .replace(/<[^>]*>/g,' ').replace(/[^\S\n]+/g,' ').replace(/\n\s*\n+/g,'\n').trim();
}

// Inspect only text supplied in the public subscription. Full bodies/images are never
// copied into a public item or followed as extra requests. The result is a
// rule hint, not a claim that we read the linked article or tested its steps.
function blogMethodHint(title,description,body) {
  const text=[title,description.slice(0,1000),body.slice(0,40000)].join('\n');
  const operation=/(?:截图|截圖|字幕|录屏|錄影|插件|外掛|工作流|工作流程|自动化|自動化|网页|網頁|网站|網站|笔记|筆記|文件|檔案|部署|代码|程式|測試|测试|命令|指令|教程|教學|安装|安裝|配置|設定|PDF|PPT|markdown|rss|obsidian|playwright|code review|e2e|ChatGPT|Codex)/i;
  const promotion=/(?:加我微信|私信(?:我|领取)|进群领取|限时优惠|返佣链接|日赚\s*\d|月入\s*\d|保证收益|稳赚|暴富)/i;
  const news=/(?:完成[\s\S]{0,15}融资|融资[\s\S]{0,10}(?:美元|亿元)|股价|财报|收购|估值|官宣|发布会)/i;
  const guide=/(?:怎样|如何|教程|教學|步骤|步驟|上手|使用方法|配置方法|設定方法|现教现学|完整流程|how.to|getting.started)/i;
  if (!operation.test(text) || promotion.test(text) || (news.test(title) && !guide.test(title))) return null;
  const steps=/(?:第[一二三四五六七八九十\d]+步|(?:步骤|步驟)[：:]|(?:^|\n)\s*[1-9][.、)）]\s*|[→➡]|(?:打开|開啟|点击|點擊|安装|安裝|下载|下載|上传|上傳|复制|複製|创建|建立|选择|選擇|输入|輸入)[\s\S]{0,150}(?:然后|然後|接着|接著|再(?:点|點|选|選|开|開|输|輸|执行|執行|保存|儲存)|最后|最後))/i;
  const example=/(?:示例|案例|实例|實例|设置|設定|提示词|提示詞|截图|截圖|任务|任務|配置|https?:\/\/|\b(?:npm|pip|npx)\s)/i;
  // Chapter numbers, life choices and an interview's "first step" are not UI
  // instructions. Require a concrete file/setting/tool target or command too.
  const actionTarget=/(?:打开|開啟|点击|點擊|安装|安裝|下载|下載|上传|上傳|复制|複製|创建|建立|选择|選擇|输入|輸入|保存|儲存)[^。\n]{0,45}(?:文件|檔案|设置|設定|按钮|按鈕|网页|網頁|网站|網站|PDF|PPT|插件|外掛|提示词|提示詞|链接|連結|路径|路徑|软件|軟體|工具|浏览器|瀏覽器|终端|終端|命令|指令|资料|資料|目录|目錄|文稿|演示|桌面|技能)|(?:文件|檔案|PDF|PPT)[^。\n]{0,20}(?:上传|上傳|下载|下載|保存|儲存)|\b(?:npm\s+(?:install|run)|pip\s+install|npx\s+skills\s+add)\b|\/ppt\b/i;
  if (steps.test(text) && example.test(text) && actionTarget.test(text)) return 'steps-and-example';
  if (guide.test(title) && /(?:流程|使用方法|操作|配置|設定)/.test(text) && /(?:阶段|階段|步骤|步驟|→|示例|案例)/.test(text)) return 'action-guide';
  return null;
}
export function parseSubscription(raw, source) {
  const blogScope=source.creator_scope==='blog-feed';
  if (source.enabled === false) throw new Error('此来源尚未接通自动读取。');
  if (source.format==='sopilot-author') return parseSopilotAuthor(raw,source);
  if (source.sopilot_category) return parseSopilotRank(raw,source);
  if (source.format==='hackernews-api') return parseHackerNewsApi(raw,source);
  if (['public-json','public-html'].includes(source.format)) return parsePublicSource(raw,source);
  if (source.format==='json') {
    const feed=JSON.parse(raw);
    if (!String(feed.version || '').startsWith('https://jsonfeed.org/version/') || !Array.isArray(feed.items)) throw new Error('来源订阅格式不正确。');
    return {status:'success',id:source.channel,items:feed.items.slice(0,30).map(item=>({title:item?.title,url:item?.url,published_at:item?.date_published,extra:{date:item?.date_modified}}))};
  }
  if (source.format==='atom') {
    if (/<!DOCTYPE|<!ENTITY/i.test(raw) || !/<feed[\s>]/i.test(raw) || !/<\/feed\s*>/i.test(raw)) throw new Error('来源订阅格式不正确。');
    if (source.youtube_channel_id) {
      const expected=source.youtube_channel_id, observed=xmlText(raw,'yt:channelId');
      // YouTube's own Atom response can omit the leading UC. Accept exactly
      // that documented-in-response shape, never a suffix or partial ID match.
      if (!/^UC[\w-]{22}$/.test(expected) || (observed!==expected && observed!==expected.slice(2))) throw new Error('视频来源频道不匹配，保留原有资料。');
    }
    if (blogScope) {
      const header=raw.split(/<entry(?:\s|>)/i)[0];
      const links=[...header.matchAll(/<link\b[^>]*>/gi)].map(([tag])=>({href:xmlAttribute(tag,'href'),rel:xmlAttribute(tag,'rel'),type:xmlAttribute(tag,'type')}));
      const home=links.find(link=>link.rel==='alternate' && (!link.type || link.type==='text/html'));
      validateBlogChannel(home?.href,source);
    }
    const blocks=[...raw.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].slice(0,blogScope ? 200 : 30);
    if (!blocks.length) throw new Error('来源订阅没有可用条目，保留原有资料。');
    const items=blocks.flatMap(([,block])=>{
      const links=[...block.matchAll(/<link\b[^>]*>/gi)].map(([tag])=>({href:xmlAttribute(tag,'href'),rel:xmlAttribute(tag,'rel'),type:xmlAttribute(tag,'type')}));
      // Attribute order is arbitrary in Atom. A missing rel means alternate;
      // self/enclosure links must never replace the page or video viewers need.
      const link=links.find(link=>link.rel==='alternate' && (!link.type || link.type==='text/html')) || links.find(link=>!link.rel && (!link.type || link.type==='text/html'));
      const title=xmlText(block,'title'),url=blogScope ? creatorBlogArticleUrl(link?.href,source) : link?.href || '';
      if (blogScope && !url) throw new Error('来源博客文章不匹配，保留原有资料。');
      const categories=[...block.matchAll(/<category\b[^>]*>/gi)].map(([tag])=>xmlAttribute(tag,'term'));
      if (blogScope && excludedBlogSample(title,url,categories,source)) return [];
      const content=blogScope ? blogPlainText(xmlText(block,'content')) : '';
      const description=blogScope ? blogPlainText(xmlText(block,'summary')) || content
        : source.read_summary ? plainXml(xmlText(block,'summary') || xmlText(block,'content') || xmlText(block,'media:description')) : '';
      const hint=blogScope ? blogMethodHint(title,description,content) : null;
      return [{title,url,published_at:xmlText(block,'published'),summary:description.slice(0,1000),extra:{date:xmlText(block,'updated'),
        ...(blogScope ? {...(hint ? {blog_method_hint:hint} : {}),excerpt_truncated:description.length>1000,excerpt_original_length:description.length} : {})}}];
    });
    return {status:'success',id:source.channel,items:blogScope ? recentBlogItems(items) : items};
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(raw) || !/<rss[\s>]/i.test(raw) || !/<\/rss\s*>/i.test(raw) || !/<channel[\s>]/i.test(raw)) throw new Error('来源订阅格式不正确。');
  if (blogScope) {
    const channelHeader=raw.split(/<item(?:\s|>)/i)[0];
    const channelLink=xmlText(channelHeader,'link');
    validateBlogChannel(channelLink,source);
  }
  const blocks=[...raw.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0,blogScope ? 200 : 30);
  if (!blocks.length) throw new Error('来源订阅没有可用条目，保留原有资料。');
  const items=blocks.flatMap(([,block])=>{
    const title=xmlText(block,'title'),rawUrl=xmlText(block,'link'),url=blogScope ? creatorBlogArticleUrl(rawUrl,source) : rawUrl;
    if (blogScope && !url) throw new Error('来源博客文章不匹配，保留原有资料。');
    const categories=[...block.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)].map(([,value])=>decodeXml(value));
    if (blogScope && excludedBlogSample(title,url,categories,source)) return [];
    const description=blogScope ? blogPlainText(xmlText(block,'description')) : plainXml(xmlText(block,'description'));
    const hint=blogScope ? blogMethodHint(title,description,blogPlainText(xmlText(block,'content:encoded'))) : null;
    return [{title,url,published_at:xmlText(block,'pubDate'),summary:description.slice(0,1000),
      ...(blogScope ? {extra:{...(hint ? {blog_method_hint:hint} : {}),excerpt_truncated:description.length>1000,excerpt_original_length:description.length}} : {})}];
  });
  return {status:'success',id:source.channel,items:blogScope ? recentBlogItems(items) : items};
}
