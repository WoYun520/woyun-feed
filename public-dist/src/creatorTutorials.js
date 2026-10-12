import { CREATOR_CATALOG, CREATOR_MATERIALS, creatorMaterialKind as knownCreatorMaterialKind } from './creatorCatalog.js';
import { creatorGuideFor, creatorGuideSearchText } from './creatorGuides.js';

const PREF_PREFIX = 'personal-feed:creator-preferences:';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function creatorPreferenceKey(mode='live', publicPreview=false) {
  return PREF_PREFIX + (mode==='demo' ? 'demo' : publicPreview ? 'public' : 'local') + ':v1';
}
export function normalizeCreatorPreferences(input, catalog=CREATOR_CATALOG) {
  const output={};
  if (!object(input)) return output;
  for (const creator of catalog) {
    const value=input[creator.id];
    if (!object(value)) continue;
    output[creator.id]={
      ...(typeof value.enabled==='boolean' ? {enabled:value.enabled} : {}),
      ...(typeof value.reason==='string' && value.reason.length<=500 ? {reason:value.reason.replace(/[\u0000-\u001f\u007f]/g,' ').trim()} : {}),
    };
  }
  return output;
}
export function readCreatorPreferences(storage,key,catalog=CREATOR_CATALOG) {
  try { return {preferences:normalizeCreatorPreferences(JSON.parse(storage.getItem(key)||'{}'),catalog),warning:false}; }
  catch { return {preferences:{},warning:true}; }
}
export function saveCreatorPreference(storage,key,id,patch,catalog=CREATOR_CATALOG) {
  if (!catalog.some(creator=>creator.id===id) || !object(patch)
    || Object.keys(patch).some(key=>!['enabled','reason'].includes(key))
    || ('enabled' in patch && typeof patch.enabled!=='boolean')
    || ('reason' in patch && (typeof patch.reason!=='string' || patch.reason.length>500))) throw Error('博主设置不完整；收录理由最多500字。');
  if (typeof patch.reason==='string' && /-----BEGIN .*PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})|\bBearer\s+[A-Za-z0-9_.-]{25,}|(?:密码|password|api[_ -]?key|token)\s*[:=：]\s*[^\s,;，；]{12,}/i.test(patch.reason)) throw Error('关注理由中疑似有密码或密钥，请先移除再保存。');
  // Read the latest value at the moment of saving, preserving changes from another tab.
  const {preferences,warning}=readCreatorPreferences(storage,key,catalog);
  if (warning) throw Error('无法读取博主设置，未覆盖原设置；请刷新后再试。');
  const next=normalizeCreatorPreferences({...preferences,[id]:{...preferences[id],...patch}},catalog);
  try {storage.setItem(key,JSON.stringify(next));} catch {throw Error('浏览器未能保存博主设置，原设置保留。');}
  return next;
}
export function creatorEnabled(creator,preferences={}) {
  return preferences[creator.id]?.enabled ?? creator.enabled_by_default===true;
}

const directUrl = value => {
  try {const u=new URL(value);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password ? u.href : null;} catch {return null;}
};
const exactMaterial = item => knownCreatorMaterialKind(item) ? CREATOR_MATERIALS.find(entry=>entry.id===item.id) : null;
export const creatorMaterialKind = item => exactMaterial(item) ? 'tutorial' : null;
const promotion = /(?:加我微信|私信(?:我|领取)|进群领取|付费社群|限时优惠|购买课程|报名课程|返佣链接|优惠码|折扣码|订阅会员|日赚\s*\d|月入\s*\d|保证收益|稳赚|暴富)/i;
const pureNews = /(?:完成[\s\S]{0,15}融资|融资[\s\S]{0,10}(?:美元|亿元)|股价|财报|收购|估值|首发|刚刚发布|正式发布|官宣|发布会)/i;
const steps = /(?:第[一二三四五六七八九十\d]+步|步骤[：:]|开始[：:]|安装[：:]|安装指令[：:]|安装只需|用法[：:]|(?:^|\n)\s*[1-9][.、)）]\s*|[→➡]|(?:打开|点击|安装|下载|复制|创建|选择)[\s\S]{0,100}(?:然后|接着|再(?:点|选|开|输|执行|保存)|最后))/i;
const commandExample = /(?:^|\n)\s*(?:npx\s+skills\s+add\s+[\w/-]+|npm\s+(?:install|run)\s+[\w/-]+|pip\s+install\s+[\w.-]+)|agent\.act\(['"]/i;
const operation = /(?:截图|截圖|字幕|录屏|錄影|訂閱|订阅|插件|外掛|工作流|工作模式|自动化|自動化|网页|網頁|网站|網站|博客|部落格|笔记|筆記|记忆|記憶|文稿|文件|檔案|部署|代码|程式|测试|測試|命令|教程|教學|安装|安裝|配置|設定|云盘|同步|办公|视频|影片|封面|pdf|ppt|code review|e2e|markdown|rss|obsidian|playwright|github pages)/i;
const actionable = /(?:教程|教學|操作步骤|操作步驟|手把手|上手|配置方法|設定方法|完整流程|具体步骤|具體步驟|示例|实例|範例|代码示例|使用方法|快速开始|快速開始|技巧|how.to|getting.started|step.by.step)/i;

function blogAuthor(item) {
  if (item?.origin==='user_added' || item?.link_kind!=='article' || item?.content_status!=='excerpt_only'
    || item?.read_scope!=='author-blog-feed') return null;
  const handle=String(item.author_handle || '').toLowerCase();
  const creator=item.creator_id ? CREATOR_CATALOG.find(entry=>entry.id===item.creator_id)
    : handle ? CREATOR_CATALOG.find(entry=>entry.handle?.toLowerCase()===handle) : null;
  if (!creator || (item.creator_id && creator.handle && creator.handle.toLowerCase()!==handle)
    || (!creator.handle && handle)
    || !(creator.blog_source_ids || (creator.handle ? ['creator-blog-'+creator.handle.toLowerCase()] : [])).some(id=>(item.source_refs || []).includes(id))) return null;
  try {
    const url=new URL(item.original_url);
    if (url.protocol!=='https:' || url.username || url.password || url.pathname==='/'
      || /\/(?:rss|feed)(?:\/|\.|$)/i.test(url.pathname)) return null;
    return (creator.blog_urls || []).some(value=>new URL(value).origin===url.origin) ? creator : null;
  } catch { return null; }
}

function classifyBlogMaterial(item) {
  if (!blogAuthor(item)) return null;
  const text=[item.title,item.summary].filter(Boolean).join('\n');
  if (text.length<50 || promotion.test(text) || !operation.test(text)) return null;
  // Only the configured author's own feed may supply this narrow method hint.
  // It describes signals in the feed, not a full article reading or a trial.
  const hint=['steps-and-example','action-guide'].includes(item.blog_method_hint);
  const hasSteps=steps.test(text) || commandExample.test(text);
  // A historical essay may contain numbered arguments or a quoted command.
  // Feed hints cannot by themselves turn that into something to follow along.
  if (!operation.test(item.title || '') && !(hasSteps && actionable.test(item.summary || ''))) return null;
  if (/🔒|^(?:测试|測試)(?:\d|笔记|筆記|$)/i.test(item.title || '')) return null;
  if (/(?:^站[点點]更新|更新日[志誌]|^测试|^測試|🔒|平台(?:比较|比較)|(?:涨价|漲價)後?值得)/i.test(item.title || '')
    && !/(?:教程|教學|操作步骤|操作步驟|具体步骤|具體步驟|手把手)/i.test(item.title || '')) return null;
  if (/(?:发出警告|发表看法|预测[：:]|观点[：:]|意味着什么)/i.test(item.title || '') && !actionable.test(item.title || '')) return null;
  const describedProcess=/(?:流程|体系|怎样使用|如何(?:使用|配置|构建|制作)|实践)/i.test(text);
  if (!hint && (!hasSteps || !(actionable.test(text) || describedProcess || /https?:\/\//i.test(item.summary || '')))) return null;
  if ((pureNews.test(item.title || '') && !actionable.test(item.title || '')) || (pureNews.test(text) && !actionable.test(text) && !hint)) return null;
  return {kind:'method',purpose:String(item.title || '').slice(0,200),
    reason:hint ? '作者订阅提供了操作过程或具体用法线索，不依赖热度入选。' : '订阅摘录说明了具体操作流程，先作为方法线索。',
    scope:'作者博客订阅摘录；按订阅提供的操作线索初筛，未核对原文全文或实测',
    checkedAt:null,truncated:item.excerpt_truncated===true};
}

export function classifyCreatorMaterial(item) {
  const fixed=exactMaterial(item);
  if (fixed) return {kind:'tutorial',purpose:(item.summary.match(/(?:用途|能做什么)[：:]\s*([^\n]+)/)?.[1] || item.title).slice(0,220),
    reason:'已读作者的操作说明，包含开始方法和适用条件。',scope:'AI 阅读作者说明并整理，未安装或实测',checkedAt:item.checked_at || item.captured_at,truncated:false};
  if (item?.read_scope==='author-blog-feed') return classifyBlogMaterial(item);
  if (item?.link_kind!=='post' || !directUrl(item.original_url) || item.content_status!=='excerpt_only' || !(item.source_refs||[]).some(id=>id.startsWith('sopilot-'))) return null;
  const text=[item.title,item.summary].filter(Boolean).join('\n');
  if (text.length<90 || promotion.test(text) || !operation.test(text)) return null;
  // A tool name or a company announcement is not a tutorial. Require concrete action.
  const hasSteps=steps.test(text) || commandExample.test(text), hasResource=/https?:\/\//i.test(item.summary||'');
  const hasCommand=commandExample.test(text);
  if (!hasSteps || (!actionable.test(text) && !hasResource && !hasCommand)) return null;
  if (pureNews.test(text) && !actionable.test(text)) return null;
  const first=(item.summary||'').split(/\n/).map(s=>s.trim()).find(s=>s && !/https?:\/\//.test(s)) || item.title;
  return {kind:'method',purpose:first.slice(0,200),reason:'摘录含操作过程与实例或资源，先作为方法线索。',
    scope:'第三方作者/榜单摘录；未核对X原帖、未实测',checkedAt:null,truncated:item.excerpt_truncated===true};
}

export function selectCreatorTutorials(items,{catalog=CREATOR_CATALOG,preferences={},hiddenItemIds=[],author='all',query=''}={}) {
  const hidden=new Set(hiddenItemIds),selected=[],seen=new Set();
  const words=String(query).normalize('NFKC').toLowerCase().trim().split(/\s+/).filter(Boolean).slice(0,10);
  // A known reading note wins over a newly fetched excerpt of the same original.
  // Copy before sorting so callers' feed order and saved records stay intact.
  const ordered=[...(items || [])].sort((a,b)=>Number(!!exactMaterial(b))-Number(!!exactMaterial(a)));
  for (const item of ordered) {
    const fixed=exactMaterial(item);
    // A fixed reading note carries an exact, guarded creator ID. Handles only
    // identify the existing X/blog excerpts; two absent handles are no match.
    const handle=typeof item.author_handle==='string' ? item.author_handle.toLowerCase() : '';
    const matchedBlog=item?.read_scope==='author-blog-feed' ? blogAuthor(item) : null;
    const creator=fixed ? catalog.find(creator=>creator.id===fixed.creator_id)
      : matchedBlog ? catalog.find(creator=>creator.id===matchedBlog.id)
        : handle ? catalog.find(creator=>creator.handle?.toLowerCase()===handle) : null;
    if (!creator || !creatorEnabled(creator,preferences) || (author!=='all' && creator.id!==author) || hidden.has(item.id)) continue;
    const parsed=classifyCreatorMaterial(item); if (!parsed) continue;
    const url=directUrl(item.original_url);if (!url) continue;
    const key=materialLinkKey(url);
    if (seen.has(key)) continue;
    const guide=creatorGuideFor(item);
    const haystack=[item.title,item.summary,creator.name,creator.handle,creatorGuideSearchText(guide)].join(' ').normalize('NFKC').toLowerCase();
    if (!words.every(word=>haystack.includes(word))) continue;
    seen.add(key); selected.push({item,creator,...parsed,...(guide ? {guide,purpose:guide.purpose} : {})});
  }
  // Fixed tutorials first; their check date never becomes a fabricated publication date.
  return selected.sort((a,b)=>Number(b.kind==='tutorial')-Number(a.kind==='tutorial') || String(b.item.published_at||'').localeCompare(String(a.item.published_at||'')));
}

function materialLinkKey(value) {
  const url=new URL(value);
  const post=/^\/\w+\/status\/(\d+)/.exec(url.pathname);
  if (['x.com','www.x.com','twitter.com','www.twitter.com'].includes(url.hostname) && post) return 'x-post:'+post[1];
  url.hash='';
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();if (url.pathname!=='/') url.pathname=url.pathname.replace(/\/$/,'');
  return url.href;
}

// This note is a narrow reading clue from a subscription, not a full article
// summary or a claim that the described software works. No installation advice
// or trial link is inferred from a title.
function candidateGuide(item) {
  const text=[item.title,item.summary].join('\n');
  const topics=[
    [/記憶|记忆/i,'了解管理 AI 记忆的方法'],
    [/封面|thumbnail/i,'了解制作内容封面的操作流程'],
    [/博客|部落格|blog/i,'了解搭建或管理个人博客的方法'],
    [/字幕|transcript/i,'了解处理视频字幕的方法'],
    [/截圖|截图|screenshot/i,'了解截图和图片标注的方法'],
    [/筆記|笔记|obsidian|notion/i,'了解整理笔记和资料的方法'],
    [/檔案|文件/i,'了解处理和整理文件的方法'],
    [/任務|任务|待辦|待办/i,'了解安排任务的操作方法'],
    [/網站|网站|網頁|网页/i,'了解制作或使用网站的方法'],
    [/影片|视频|youtube/i,'了解视频制作或整理的方法'],
    [/工作流|工作流程|流程|workflow|自動化|自动化/i,'了解减少重复操作的工作流程'],
    [/安裝|安装|部署|設定|配置/i,'了解工具的安装或设置方法'],
  ];
  const topic=topics.find(([pattern])=>pattern.test(item.title || '')) || topics.find(([pattern])=>pattern.test(text));
  return {purpose:topic?.[1] || '具体用途待确认，先读作者的原文',
    audience:'对这项操作感兴趣、愿意对照原文尝试的人',
    requirements:'订阅未完整说明所需工具、账号或环境，请在原文中确认',
    first_step:'先打开原文，核对准备条件与完整步骤，再决定是否尝试',
    cost:'费用与使用条件尚未核对',basis_label:'作者订阅对应的原文',basis_url:item.original_url,
    scope:'按已取得的订阅标题和摘要生成用途线索；未阅读全文或实测'};
}

export function selectCreatorCandidates(items,options={}) {
  const entries=selectCreatorTutorials(items,{...options,query:''});
  const recent=new Set(options.refresh?.new_item_ids || []);
  const words=String(options.query || '').normalize('NFKC').toLowerCase().trim().split(/\s+/).filter(Boolean).slice(0,10);
  const date=value=>Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
  // Fixed read-through notes live in the main library. An old article first
  // encountered by this update remains old; capture time only orders discovery.
  return entries.filter(entry=>entry.kind==='method' && entry.item.read_scope==='author-blog-feed').map(entry=>{
    const guide=candidateGuide(entry.item);
    return {...entry,guide,purpose:guide.purpose,candidateNew:['ok','partial'].includes(options.refresh?.status)
      && [entry.item.id,...(entry.item.alias_ids || [])].some(id=>recent.has(id))};
  }).filter(entry=>words.every(word=>[entry.item.title,entry.item.summary,entry.creator.name,creatorGuideSearchText(entry.guide)].join(' ').normalize('NFKC').toLowerCase().includes(word)))
    .sort((a,b)=>Number(b.candidateNew)-Number(a.candidateNew)
      || date(b.item.captured_at)-date(a.item.captured_at)
      || date(b.item.published_at)-date(a.item.published_at) || a.item.id.localeCompare(b.item.id));
}
