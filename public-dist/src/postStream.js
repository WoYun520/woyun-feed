// This is a view of existing SoPilot records. Identity and resource grouping
// never replace a saved item, edit its source references, or imply verification.
import { selectFeed } from './feedSelection.js';
import { postQuality } from './postQuality.js';

export const POST_STREAM_PAGE_SIZE = 5;
const asArray = value => value instanceof Set || Array.isArray(value) ? [...value] : [];
const asSet = value => new Set(asArray(value));
const text = value => typeof value === 'string' ? value : '';
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const itemIds = item => [...new Set([item.id, ...asArray(item.alias_ids)].filter(id => typeof id === 'string'))];
const timestamp = item => {
  for (const value of [item.published_at, item.source_item_time, item.captured_at]) {
    if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return Date.parse(value);
  }
  return 0;
};

export function postStatusId(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port
      || !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname.toLowerCase())) return null;
    return /^\/(?:[A-Za-z0-9_]{1,15}\/status|i\/web\/status)\/(\d{1,25})(?:\/(?:photo|video)\/\d+)?\/?$/.exec(url.pathname)?.[1] || null;
  } catch { return null; }
}

function originalLink(item, memberships) {
  const candidates = [item.original_url, item.canonical_url,
    ...asArray(item.source_links).filter(link => memberships.has(link?.source_id)).map(link => link.url)];
  const originalUrl = candidates.find(value => postStatusId(value));
  return originalUrl ? { originalUrl, statusId:postStatusId(originalUrl) } : null;
}

const excludedResourceHosts = /(?:^|\.)(?:x\.com|twitter\.com|t\.co|sopilot\.(?:net|com)|bit\.ly|tinyurl\.com|t\.ly|goo\.gl|linktr\.ee|facebook\.com|instagram\.com|linkedin\.com|threads\.net|weibo\.com|google\.[a-z.]+|bing\.com|baidu\.com)$/i;
const repositoryReserved = new Set(['about','account','apps','blog','collections','contact','customer-stories','enterprise','events','explore','features','issues','login','marketplace','new','notifications','organizations','orgs','pricing','pulls','search','security','settings','site','sponsors','topics','trending','users']);
const usefulContext = /工具|项目|教程|文档|示例|源码|开源|工作流|配置|安装|使用方法|操作步骤|\b(?:tool|tutorial|docs?|documentation|repository|workflow|install|example|source code)\b/i;
const resourceContext = /工具|教程|步骤|方法|文档|资料|示例|下载|配置|源码|项目|工作流|\b(?:tool|tutorial|docs?|documentation|resource|example|download|workflow|repository)\b/i;

function resourceLink(value, context) {
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port
      || !host.includes('.') || host.includes(':') || /^(?:\d+\.|localhost)/.test(host)
      || /\.(?:local|localhost|internal|lan)$/.test(host) || excludedResourceHosts.test(host)
      || [...url.searchParams.keys()].some(key => /token|secret|password|api.?key|authorization|credential/i.test(key))) return null;
    if (['github.com', 'www.github.com'].includes(host)) {
      const parts = url.pathname.replace(/\.git\/?$/i, '').split('/').filter(Boolean);
      if (parts.length !== 2 || parts.some(part => !/^[\w.-]+$/.test(part)) || repositoryReserved.has(parts[0].toLowerCase())) return null;
      const name = parts.join('/').toLowerCase();
      return {kind:'repository', url:`https://github.com/${name}`, label:name};
    }
    // Short links and generic mentions cannot establish a shared resource.
    // Preserve path, query and fragment: different resource pages stay separate.
    if (!resourceContext.test(context) || url.pathname === '/' && !usefulContext.test(context)
      || /\/(?:search|login|signin|signup|register)\/?$/i.test(url.pathname)) return null;
    url.hostname = host;
    return {kind:'resource', url:url.href, label:host + (url.pathname === '/' ? '' : url.pathname)};
  } catch { return null; }
}

function resourcesFor(item) {
  const context = `${text(item.title)}\n${text(item.summary)}`, found = new Map();
  const description = context.replace(/https?:\/\/[^\s<>"'`]+/gu, ' ');
  for (const match of context.matchAll(/https?:\/\/[^\s<>"'`]+/gu)) {
    const candidate = match[0].replace(/[.,!?;:。！？；：，、()（）\]】」』〉》]+$/u, '');
    const resource = resourceLink(candidate, description);
    if (resource) found.set(resource.url, resource);
  }
  return [...found.values()];
}

function instructionSignals(item) {
  const content = `${text(item.title)}\n${text(item.summary)}`;
  const lines = content.split(/\r?\n/).map(line => line.trim().replace(/^[$>]\s*/, '').replace(/^`{1,3}|`{1,3}$/g, ''));
  // An actual standalone command is stronger evidence than prose about using
  // software. This recognizes supplied text; it never executes or tests it.
  const command = /^(?:npx\s+(?:(?:--yes|-y)\s+)?[@A-Za-z0-9][\w@./:-]*(?:\s+\S.*)?|npm\s+(?:(?:install|i|ci|update)(?:\s+\S.*)?|(?:run|exec)\s+\S.*)|pip(?:3)?\s+install\s+\S.*|git\s+(?:clone|fetch|pull|checkout|switch|status|log|diff|init)(?:\s+\S.*)?|docker\s+(?:run|pull|build|compose)\s+\S.*)$/i;
  const hasCommand = lines.some(line => command.test(line));
  const operation = '打开|点击|选择|输入|粘贴|复制|安装|下载|配置|设置|运行|执行|启动|导出|保存|创建|导入|转换|剪辑|转录|调试|install|configure|export|transcribe|debug';
  const object = '软件|应用|工具|插件|终端|命令行|代码|脚本|文件|字幕|图片|视频|音频|浏览器|扩展|文档|笔记|工作流|菜单|设置|按钮|面板|配置项|\\b(?:Skill|MCP|API|Obsidian|Claude Code|Codex|Docker|Python|Node\\.js|FFmpeg)\\b';
  const concreteAction = new RegExp(`(?:${operation})[^。！？!?\\n]{0,48}(?:${object})|(?:${object})[^。！？!?\\n]{0,48}(?:${operation})`, 'i');
  const numberedStep = /(?:^|\n)\s*(?:\d{1,2}[.、)）]\s*|第[一二三四五六七八九十\d]+步\s*[：:、.．]?\s*)([^\n]+)/g;
  const hasSteps = [...content.matchAll(numberedStep)].some(match => concreteAction.test(match[1]));
  const description = content.replace(/https?:\/\/\S+/g, ' ');
  const instruction = /教程|操作步骤|配置步骤|使用方法|操作指南|示例|一条命令|具体做法|\b(?:tutorial|how to|step[- ]by[- ]step|example)\b/i.test(description);
  const hasObject = new RegExp(object, 'i').test(description);
  const directedAction = /(?:你可以|只需|只要|用法[：:]|操作[：:]|先(?:打开|安装|下载|点击|选择|复制|配置)|\b(?:you can|just install|first open)\b)/i.test(description)
    && concreteAction.test(description);
  return {hasCommand, hasSteps, instruction, hasObject, directedAction,
    instructionAction:instruction && concreteAction.test(description)};
}

// These are signals in the supplied excerpt, not an AI verdict, a full-text
// reading, or a guarantee that the instructions work. No AI keyword is required.
export function postInstructionEvidence(item) {
  const signals=instructionSignals(item || {});
  if (signals.hasCommand) return {eligible:true,code:'command',label:'摘录含独立命令'};
  if (signals.hasSteps) return {eligible:true,code:'steps',label:'摘录含具体操作步骤'};
  if (signals.instructionAction) return {eligible:true,code:'instruction',label:'摘录提到教程与具体操作'};
  if (signals.directedAction) return {eligible:true,code:'directed_action',label:'摘录含可跟着做的操作'};
  return {eligible:false,code:'',label:''};
}

function usefulness(item, resources) {
  const {hasCommand,hasSteps,instruction,hasObject,directedAction}=instructionSignals(item);
  // Tiers prevent several weak news or marketing phrases from overtaking a
  // command or numbered software steps. AI and automation alone add nothing.
  return (hasCommand ? 20 : hasSteps ? 10 : instruction && hasObject ? 3 : directedAction ? 1 : 0) + (resources.length ? 2 : 0);
}

function groupPosts(posts, folded) {
  const groups = new Map();
  for (const post of posts) {
    // Multiple explicit resources are ambiguous. Keep that post independent.
    const resource = post.resources.length === 1 ? post.resources[0] : null;
    const key = `${folded ? 'folded:' : ''}${resource ? `${resource.kind}:${resource.url}` : post.key}`;
    if (!groups.has(key)) groups.set(key, {key, kind:resource?.kind || 'post', resource, posts:[], folded});
    groups.get(key).posts.push(post);
  }
  return [...groups.values()].map(group => {
    group.posts.sort(orderPosts);
    return {...group, primary:group.posts[0], score:group.posts[0].score, time:group.posts[0].time,
      isNew:group.posts.some(post => post.isNew), originalCount:group.posts.length};
  }).sort((a, b) => b.score - a.score || Number(b.isNew) - Number(a.isNew) || b.time - a.time || compare(a.key, b.key));
}

const orderPosts = (a, b) => b.score - a.score || Number(b.isNew) - Number(a.isNew) || b.time - a.time || compare(a.key, b.key);
export const postStreamLimit = value => Number.isSafeInteger(value) && value >= POST_STREAM_PAGE_SIZE ? value : POST_STREAM_PAGE_SIZE;

export function authorSourceEnabled(source, state) {
  if (!source.id.startsWith('sopilot-author-') || !Array.isArray(state?.creatorCatalog)) return true;
  const handle = text(source.creator_handle || source.id.slice('sopilot-author-'.length)).replace(/^@/, '').toLowerCase();
  const creator = source.creator_id
    ? state.creatorCatalog.find(entry => entry?.id === source.creator_id)
    : state.creatorCatalog.find(entry => entry?.source_id === source.id
      || handle && text(entry?.handle).replace(/^@/, '').toLowerCase() === handle);
  if (!creator) return true;
  return state.creatorPreferences?.[creator.id]?.enabled ?? creator.enabled_by_default ?? true;
}

export function selectPostStream(state, {sources = state?.sources || [], onlyNew = false, profile = state?.profile || {}, limit = POST_STREAM_PAGE_SIZE, view = 'all'} = {}) {
  const activeView=view==='tutorials' ? 'tutorials' : 'all';
  const sourceList = asArray(sources).filter(source => typeof source?.id === 'string'
    && source.id.startsWith('sopilot-') && source.link_kind === 'post' && source.enabled !== false && !source.disabled
    && authorSourceEnabled(source, state));
  const sourceMap = new Map(sourceList.map(source => [source.id, source]));
  const hidden = asSet(state?.hiddenItemIds), added = asSet(state?.refresh?.new_item_ids);
  const corpus = Array.isArray(state?.allItems) ? state.allItems : Array.isArray(state?.items) ? state.items : [];
  const hiddenStatuses = new Set(), newStatuses = new Set(), records = [];
  for (const item of corpus) {
    if (!item || typeof item.id !== 'string' || !item.id || !Array.isArray(item.source_refs)
      || /^(?:user[_-]|manual)/.test(item.origin || '') || /^manual-/.test(item.id)) continue;
    const sourceIds = new Set(item.source_refs.filter(id => sourceMap.has(id)));
    const knownPostSources = new Set(item.source_refs.filter(id => typeof id === 'string' && id.startsWith('sopilot-')));
    if (!knownPostSources.size || item.link_kind && item.link_kind !== 'post') continue;
    const identity = originalLink(item, knownPostSources);
    if (!identity) continue;
    const ids = itemIds(item);
    if (ids.some(id => hidden.has(id))) hiddenStatuses.add(identity.statusId);
    if (ids.some(id => added.has(id))) newStatuses.add(identity.statusId);
    if (sourceIds.size) records.push({item, ids, sourceIds, ...identity});
  }
  const statusMap = new Map();
  for (const record of records) {
    if (hiddenStatuses.has(record.statusId) || onlyNew && !newStatuses.has(record.statusId)) continue;
    if (!statusMap.has(record.statusId)) statusMap.set(record.statusId, []);
    statusMap.get(record.statusId).push(record);
  }
  let posts = [...statusMap.entries()].map(([statusId, records]) => {
    const ordered = [...records].sort((a, b) => text(b.item.summary).length - text(a.item.summary).length
      || timestamp(b.item) - timestamp(a.item) || compare(a.item.id, b.item.id));
    const chosen = ordered[0], sourceIds = [...new Set(records.flatMap(record => [...record.sourceIds]))].sort(compare);
    const resources = resourcesFor(chosen.item), quality = postQuality(chosen.item), instruction=postInstructionEvidence(chosen.item);
    return {key:`post:${statusId}`, statusId, item:chosen.item, originalUrl:chosen.originalUrl,
      records:records.map(record => record.item), itemIds:[...new Set(records.flatMap(record => record.ids))],
      memberships:sourceIds.map(id => ({id, name:sourceMap.get(id).name || id})), sourceIds,
      sourceNames:sourceIds.map(id => sourceMap.get(id).name || id), resources,
      score:usefulness(chosen.item, resources), time:timestamp(chosen.item), isNew:newStatuses.has(statusId), quality, instruction};
  });
  // Interests prioritize neither category subscriptions nor author-only scopes.
  // Only the user's exclusions remove a post, using the existing matcher.
  if (profile?.exclude) {
    const excludedIds = new Set(selectFeed(posts.map(post => post.item), {exclude:profile.exclude}).decorated
      .filter(item => item.excluded_interests.length).map(item => item.id));
    posts = posts.filter(post => !excludedIds.has(post.item.id));
  }
  posts.sort(orderPosts);
  const rawRecordCount = posts.reduce((count, post) => count + post.records.length, 0);
  // The feed may already hold one record with several source memberships.
  // Count those memberships to describe actual cross-source overlap.
  const membershipCount = posts.reduce((count, post) => count + post.memberships.length, 0);
  const allVisible=posts.filter(post=>!post.quality.fold), allFolded=posts.filter(post=>post.quality.fold);
  const selectedPosts=activeView==='tutorials' ? posts.filter(post=>post.instruction.eligible) : posts;
  const visible = selectedPosts.filter(post => !post.quality.fold), folded = selectedPosts.filter(post => post.quality.fold);
  const allGroups = groupPosts(visible, false), allFoldedGroups = groupPosts(folded, true), maximum = postStreamLimit(limit);
  return {groups:allGroups.slice(0, maximum), foldedGroups:allFoldedGroups.slice(0, maximum), allGroups, allFoldedGroups, posts,selectedPosts,view:activeView,
    rawCount:membershipCount, membershipCount, rawRecordCount, originalPostCount:posts.length,
    uniquePostCount:posts.length, overlapCount:membershipCount - posts.length,
    visibleCount:visible.length, foldedCount:folded.length, groupedCount:allGroups.length,
    allVisibleCount:allVisible.length,allFoldedCount:allFolded.length,
    tutorialCount:allVisible.filter(post=>post.instruction.eligible).length,
    unmatchedCount:allVisible.filter(post=>!post.instruction.eligible).length,
    total:allGroups.length, shownCount:Math.min(maximum, allGroups.length),
    hasMore:allGroups.length > maximum, hasMoreFolded:allFoldedGroups.length > maximum, limit:maximum};
}
