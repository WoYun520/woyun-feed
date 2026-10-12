import { createHash } from 'node:crypto';
import { FEED_CHANNELS, creatorBlogArticleUrl, canonicalUrl } from './feed-sources.js';
import { repositoryName } from './src/repositoryGuide.js';
import { normalizePostImage } from './src/postMedia.js';
import { containsCredentialText } from './src/contentPrivacy.js';

const sourceDefinitions = [{id:'github',name:'GitHub 小型工具',home_url:'https://github.com/topics/productivity',kind:'repository',group:'tech'}, ...FEED_CHANNELS];
const definitionsById = new Map(sourceDefinitions.map(source=>[source.id,source]));
function configuredBlogDefinition(refs, url, input) {
  if (input.link_kind!=='article' || input.content_status!=='excerpt_only' || input.read_scope!=='author-blog-feed') return null;
  return refs.map(id=>definitionsById.get(id)).find(def=>{
    if (def?.creator_scope!=='blog-feed' || !['rss','atom'].includes(def.format) || !def.creator_id
      || def.source_id!==def.id) return false;
    try {
      const article=new URL(url), origin=new URL(def.allowed_article_origin);
      return article.protocol==='https:' && origin.protocol==='https:' && article.origin===origin.origin
        && creatorBlogArticleUrl(url,def)===article.href
        && (!input.creator_id || input.creator_id===def.creator_id);
    } catch { return false; }
  }) || null;
}
const text = (value, max = 1000) => typeof value === 'string' ? value.slice(0, max) : '';
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const idPattern = /^(?:github-\d+|news-[a-f0-9]{24})$/;
const fingerprint = value => createHash('sha256').update(value || '').digest('hex');

// No credentials, loopback, LAN, local file URLs or credential-like query parameters.
export function publicUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !host.includes('.') ||
      /^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host) || (host.includes(':') && /^(?:::|fc|fd|fe80:)/.test(host)) ||
      /\.(?:local|internal|localhost)$/.test(host) || [...url.searchParams.keys()].some(key => /token|secret|password|api.?key|authorization/i.test(key))) return null;
    return url.href;
  } catch { return null; }
}

// Credential prefixes start a token. Without this boundary, an ordinary public
// URL such as "high-risk-ai-research-in-the-open" contains a false "sk-" match.
// Non-alphanumeric separators (including underscores) still catch real keys in
// JSON strings, environment assignments, URLs, and copied command examples.
export const PRIVATE_CONTENT = /\/Users\/|file:\/\/|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|(?:^|[^A-Za-z0-9])(?:gh[pousr]_|github_pat_|sk-)[a-zA-Z0-9_\-]{20,}|Bearer\s+[a-zA-Z0-9._\-]{20,}/;

export function makePublicFeed(feed, { cache = {}, catalog = {}, publishedAt = new Date().toISOString(), automaticUpdate = false } = {}) {
  // Each snapshot repeats the same link and capture time across metadata and
  // evidence. Reuse validation results only within this build, never across reads.
  const dates = new Map(), urls = new Map();
  const publicDate = value => {if (!dates.has(value)) dates.set(value, date(value)); return dates.get(value);};
  const checkedUrl = value => {if (!urls.has(value)) urls.set(value, publicUrl(value)); return urls.get(value);};
  if (!feed?.schema_version || feed.mode !== 'live' || !Array.isArray(feed.items) || !Array.isArray(feed.sources) || !publicDate(publishedAt)) throw Error('公开发布需要真实来源数据和有效时间。');
  const sources = sourceDefinitions.map(def => {
    const source = feed.sources.find(entry => entry.id === def.id);
    if (!source) return null;
    const output = {id:def.id,name:def.name,home_url:def.home_url,kind:def.kind,group:def.group,
      ranked:!!def.ranked,link_kind:def.link_kind || (def.kind==='repository' ? 'repository' : 'article'),
      status: def.enabled === false ? 'not_connected' : ['ok','failed','not_connected'].includes(source.status) ? source.status : 'not_connected',
      last_success_at:publicDate(source.last_success_at),last_attempt_at:publicDate(source.last_attempt_at)};
    if (Number.isSafeInteger(source.consecutive_failures) && source.consecutive_failures>=0) output.consecutive_failures=source.consecutive_failures;
    if (publicDate(source.last_failure_at)) output.last_failure_at=publicDate(source.last_failure_at);
    if (def.enabled === false) { output.enabled=false; output.availability_message=def.availability_message; }
    if (def.reading_note) output.reading_note=text(def.reading_note,200);
    if (def.creator_handle) output.creator_handle=def.creator_handle;
    if (def.creator_scope==='blog-feed') {output.creator_scope='blog-feed';output.creator_id=def.creator_id;output.source_id=def.id;}
    output.message = def.enabled === false ? def.availability_message : output.status === 'failed' ? '上次读取失败；有旧内容时仍可阅读。' : output.status === 'not_connected' ? '这个来源尚未读到内容。' : '公开列表已读取。';
    if (def.youtube_channel_id && /^(?:UC)?[A-Za-z0-9_-]{22}$/.test(source.observed_channel_id || '')) output.observed_channel_id=source.observed_channel_id;
    if (output.status === 'failed' && /^(?:upstream \d{3}|channel_mismatch|source_format|oversize|invalid source|incomplete|no valid items|empty public list|unsafe source text|TypeError|AbortError|TimeoutError|SyntaxError|Error)$/.test(source.read_error || '')) {
      output.read_error=source.read_error;
      if (/^upstream (?:401|403|412|419|429)$/.test(source.read_error)) output.message='原站暂时不允许这次公开读取；有旧内容时仍可阅读。';
      else if (source.read_error === 'upstream 404') output.message='原站的公开订阅暂时不可用；有旧内容时仍可阅读。';
      else if (/^upstream 5\d{2}$/.test(source.read_error)) output.message='原站这次返回错误；有旧内容时仍可阅读。';
      else if (['AbortError','TimeoutError'].includes(source.read_error)) output.message='原站读取超时；有旧内容时仍可阅读。';
      else if (source.read_error === 'source_format') output.message='原站这次没有返回可用的订阅格式；有旧内容时仍可阅读。';
    }
    return output;
  }).filter(Boolean);
  const sourceIds = new Set(sources.map(source => source.id));
  const observations = new Map((Array.isArray(catalog.entries) ? catalog.entries : []).map(entry => [String(entry.repository).toLowerCase(), entry]));
  const items = [], seen = new Set();
  let rejectedPrivate=0;
  for (const input of feed.items) {
    const url = checkedUrl(input.original_url), refs = (input.source_refs || []).filter(id => sourceIds.has(id));
    if (!idPattern.test(input.id || '') || ['user_added','dot_import','feedgrab_import'].includes(input.origin) || !url || !refs.length || !text(input.title).trim() || seen.has(input.id)) continue;
    const authorScope=refs.some(id=>id.startsWith('sopilot-author-'));
    const blog=configuredBlogDefinition(refs,url,input), excerptLength=typeof input.summary==='string' ? input.summary.length : 0;
    // A supplied canonical must identify this same author article. Preserve the
    // original href as the fallback for missing or unrelated canonical inputs.
    const suppliedCanonical=checkedUrl(input.canonical_url);
    const blogCanonical=suppliedCanonical && canonicalUrl(suppliedCanonical)===canonicalUrl(url) ? canonicalUrl(url) : url;
    const item = {id:input.id,title:text(input.title,500),summary:text(input.summary,authorScope && !blog ? 12000 : 1000),summary_label:blog ? '作者博客订阅摘录，未核对全文或实测' : text(input.summary_label,60),
      ...(blog ? {read_scope:'author-blog-feed',creator_id:blog.creator_id,
        ...(blog.creator_handle ? {author_handle:blog.creator_handle} : {}),author_name:text(blog.creator_name,100),
        ...(['steps-and-example','action-guide'].includes(input.blog_method_hint) ? {blog_method_hint:input.blog_method_hint} : {}),
        excerpt_truncated:input.excerpt_truncated===true || excerptLength>1000,
        excerpt_original_length:Number.isSafeInteger(input.excerpt_original_length) && input.excerpt_original_length>=excerptLength ? input.excerpt_original_length : excerptLength}
        : authorScope ? {read_scope:'author-7d-top10',excerpt_truncated:input.excerpt_truncated===true || (input.summary?.length||0)>12000,
        excerpt_original_length:Number.isSafeInteger(input.excerpt_original_length) && input.excerpt_original_length>=0 ? input.excerpt_original_length : (input.summary?.length||0)} : {}),
      source_refs:[...new Set(refs)],original_url:url,canonical_url:blog ? blogCanonical : suppliedCanonical || url,
      published_at:publicDate(input.published_at),updated_at:publicDate(input.updated_at),captured_at:publicDate(input.captured_at),
      source_updated_at:publicDate(input.source_updated_at),repository_created_at:publicDate(input.repository_created_at),
      ...(input.link_kind==='post' ? {source_item_time:publicDate(input.source_item_time)} : {}),
      content_status:['headline_only','metadata_only','excerpt_only'].includes(input.content_status) ? input.content_status : 'metadata_only',
      verification_status:'not_tested',
      unknowns:[blog ? '作者博客订阅摘录；按订阅提供的操作线索初筛，未核对原文全文或实测，不保证教程完整或适合你。' : input.link_kind === 'video' ? '仅读取频道公开标题与简介，没有观看视频、读取字幕或核对演示效果；不是 YouTube 全站热榜。' : input.link_kind === 'post' ? '仅读取第三方榜单摘录与公开作者信息，未核对 X 原帖、作者身份或热度统计；榜单不代表本站推荐。' : '标题与简介来自公开来源，不代表本站实测或推荐；安装、费用与使用条件需到原站核对。'],
      alias_ids:(input.alias_ids || []).filter(id => idPattern.test(id)).slice(0,20),
      source_links:(input.source_links || []).filter(link => refs.includes(link.source_id) && checkedUrl(link.url)).map(link => ({
        source_id:link.source_id,url:checkedUrl(link.url),evidence_ref:'public-feed:'+input.id+':'+link.source_id,
        captured_at:publicDate(link.captured_at),source_updated_at:publicDate(link.source_updated_at),
        source_rank:Number.isSafeInteger(link.source_rank) && link.source_rank>0 && link.source_rank<=1000 ? link.source_rank : null,heat_label:text(link.heat_label,60)
      }))};
    if (Number.isSafeInteger(input.source_rank) && input.source_rank>0 && input.source_rank<=1000) item.source_rank=input.source_rank;
    if (Number.isSafeInteger(input.stars) && input.stars>=0) item.stars=input.stars;
    if (input.heat_label) item.heat_label=text(input.heat_label,60);
    if (input.link_kind==='post' && text(input.author_name,100).trim() && !/[\u0000-\u001f\u007f]/.test(input.author_name)) item.author_name=text(input.author_name,100).trim();
    if (input.link_kind==='post' && typeof input.author_handle==='string' && /^[A-Za-z0-9_]{1,15}$/.test(input.author_handle)) item.author_handle=input.author_handle;
    const postImage=input.link_kind==='post' ? normalizePostImage(input.post_image,url) : null;
    if (postImage) item.post_image=postImage;
    if (['article','repository','discussion','search','topic','video','post'].includes(input.link_kind)) item.link_kind=input.link_kind;
    const repository = repositoryName(item);
    if (repository) {
      item.repository_name=repository;
      const cached=cache.entries?.[repository.toLowerCase()], observed=observations.get(repository.toLowerCase());
      // Only descriptions and the public catalog. Never inspect private research jobs or adopt README reports.
      const guide = cached?.fingerprint === fingerprint(item.summary.slice(0,1000)) && publicDate(cached.recorded_at) ? {
        summary:cached.summary,basis:'description',source_url:url,recorded_at:publicDate(cached.recorded_at)
      } : observed && checkedUrl(observed.source_url) ? {
        summary:observed.summary,example:text(observed.example,200),audience:text(observed.audience,100),
        basis:'observation',source_url:checkedUrl(observed.source_url),recorded_at:publicDate(catalog.imported_at)
      } : null;
      if (guide && typeof guide.summary === 'string' && guide.summary.length<=100 && /[\u4e00-\u9fff]/.test(guide.summary)) item.repository_guide={...guide,verification:'not_tested'};
    }
    if (containsCredentialText(item)) {rejectedPrivate++;continue;}
    seen.add(item.id); items.push(item);
  }
  if (!items.length) throw Error(rejectedPrivate ? '来源中疑似含有密码或密钥，没有可公开的有效内容，未生成发布目录。' : '没有可公开的有效内容，未生成发布目录。');
  const available = new Set(items.map(item=>item.id));
  const newIds = (feed.refresh?.new_item_ids || []).filter(id=>available.has(id));
  const times=sources.map(s=>s.last_success_at).filter(Boolean).sort();
  const published=publicDate(publishedAt), generated=times.at(-1) || null;
  const active=sources.filter(s=>s.enabled !== false), failed=active.filter(s=>s.status==='failed').length;
  const notice=automaticUpdate ? `云端每天 09:00、21:00（北京时间）自动更新；当前 ${items.length} 条内容，本轮新增 ${newIds.length} 条。${failed ? `${failed} 个来源本轮读取失败，有旧内容时仍可阅读。` : ''}“查看更新”读取最近完成的内容，不触发抓取。` : `已发布 ${active.length} 个来源、${items.length} 条内容。获取时间见各来源；“查看更新”只读取已发布内容，不实时采集原站。`;
  return {schema_version:feed.schema_version,mode:'live',generated_at:generated,
    publication:{published_at:published,version:'0.42.0',kind:automaticUpdate ? 'scheduled-public-feed' : 'public-snapshot',
      automatic_update:automaticUpdate,...(automaticUpdate ? {schedule_label:'每天 09:00、21:00（北京时间）'} : {})},
    profile:{interests:'',exclude:'',language:'zh-CN'},sources,items,
    sections:{daily:items.slice(0,5).map(item=>item.id),discover:items.slice(5,7).map(item=>item.id)},
    refresh:{status:feed.refresh?.status==='failed' ? 'failed' : active.some(s=>s.status!=='ok') ? 'partial' : 'ok',last_attempt_at:publicDate(feed.refresh?.last_attempt_at),new_item_ids:newIds,new_count:newIds.length,message:notice},update_notice:notice};
}
