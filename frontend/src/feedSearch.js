// Filters existing public metadata in this browser. No requests, model calls,
// purpose claims, or changes to source items. Active search prioritizes known
// tools, tutorials and repositories while keeping order within both groups.
import { practicalMaterialKind } from './practicalMaterials.js';
import { repositoryName } from './repositoryGuide.js';

export const FEED_PURPOSES = Object.freeze([
  {id:'writing',label:'写作与笔记'},
  {id:'media',label:'图片与视频'},
  {id:'automation',label:'减少重复操作'},
  {id:'research',label:'搜集与阅读'},
  {id:'development',label:'开发工具'},
].map(Object.freeze));

const purposeKeywords = new Map([
  ['writing', /写作|笔记|文案|日志|日记|文字编辑|(?:^|[^a-z0-9])(?:markdown|writing|notes?|note[- ]?taking|notebooks?|journals?|journaling|text editor)(?=$|[^a-z0-9])/],
  ['media', /图片|图像|照片|视频|字幕|音频|语音|录屏|截图|(?:^|[^a-z0-9])(?:images?|photos?|videos?|subtitles?|captions?|screenshots?|screen capture|screen recording|audio|transcription|ocr)(?=$|[^a-z0-9])/],
  ['automation', /自动化|自动(?:整理|处理|生成|记录|运行|执行|保存|备份|同步|上传|填写)|批量|工作流|快捷键|定时任务|重复操作|(?:^|[^a-z0-9])(?:automation|automate|automated|automatic|workflows?|shortcuts?|batch processing|scheduled tasks?)(?=$|[^a-z0-9])/],
  ['research', /阅读|搜集|收集|搜索|检索|书签|收藏|知识库|整理文件|(?:^|[^a-z0-9])(?:rss|search|research|reading|read[- ]later|bookmarks?|web clipper|file organization|file management)(?=$|[^a-z0-9])/],
  ['development', /开发|编程|代码|终端|命令行|调试|(?:^|[^a-z0-9])(?:development|developers?|coding|terminal|ide|cli|code editor|mcp|sdk|api)(?=$|[^a-z0-9])/],
]);
const aliases = [
  ['字幕','subtitle','caption'],
  ['截图','screenshot','screen capture'],
  ['整理文件','file organization','file management'],
];
const normalize = value => typeof value === 'string' ? value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim() : '';
const values = value => value instanceof Set || Array.isArray(value) ? [...value] : [];
const ids = value => new Set(values(value).filter(id => typeof id === 'string'));
const userMaterial = item => /^(?:user[_-]|manual)/.test(item?.origin || '')
  || /^manual-/.test(item?.id || '') || item?.content_status === 'user_link';

export function feedMaterialKind(item) {
  if (!item || userMaterial(item)) return 'content';
  const kind = practicalMaterialKind(item);
  if (kind === 'tool' || kind === 'tutorial') return kind;
  if (item.link_kind && item.link_kind !== 'repository') return 'content';
  return repositoryName(item) ? 'repository' : 'content';
}

function metadata(item) {
  const guide = item.repository_guide;
  return [item.title,item.summary,item.repository_name,guide?.summary,guide?.example,guide?.audience]
    .filter(value => typeof value === 'string').map(value => normalize(value.slice(0, 2000))).join('\n');
}

function queryTerms(query) {
  const words = normalize(query).split(' ').filter(Boolean), result = [];
  for (let index = 0; index < words.length; index++) {
    // A dictionary's explicit two-word phrase is one alias, not an expansion
    // of generic words such as "screen" or "file" on their own.
    const phrase = `${words[index]} ${words[index + 1] || ''}`;
    const phraseGroup = aliases.find(group => group.includes(phrase));
    if (phraseGroup) {result.push(phraseGroup);index++;}
    else result.push(aliases.find(group => group.includes(words[index])) || [words[index]]);
  }
  return result;
}

export function selectFeedSearch(state, {query = '', purpose = 'all', sourceIds = null, onlyNew = false} = {}) {
  query = typeof query === 'string' ? query.normalize('NFKC').slice(0, 200).trim().split(/\s+/u).slice(0, 10).join(' ') : '';
  purpose = purposeKeywords.has(purpose) ? purpose : 'all';
  const active = !!query || purpose !== 'all', terms = queryTerms(query);
  const sources = new Set((Array.isArray(state?.sources) ? state.sources : []).map(source => source?.id)
    .filter(id => typeof id === 'string' && !/^(?:user[_-]|manual)/.test(id)));
  const visible = sourceIds === null ? sources : ids(sourceIds), hidden = ids(state?.hiddenItemIds), added = ids(state?.refresh?.new_item_ids);
  const corpus = Array.isArray(state?.allItems) ? state.allItems : Array.isArray(state?.items) ? state.items : [];
  const seen = new Set(), eligible = [];
  for (const item of corpus) {
    if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id)
      || userMaterial(item)) continue;
    const itemIds = [item.id,...(Array.isArray(item.alias_ids) ? item.alias_ids : [])];
    if (itemIds.some(id => hidden.has(id)) || onlyNew && !itemIds.some(id => added.has(id))
      || !Array.isArray(item.source_refs) || !item.source_refs.some(id => sources.has(id) && visible.has(id))) continue;
    seen.add(item.id);eligible.push(item);
  }
  const keyword = purposeKeywords.get(purpose);
  let items = eligible.filter(item => {
    const text = metadata(item);
    return (!keyword || keyword.test(text)) && terms.every(alternatives => alternatives.some(term => text.includes(term)));
  });
  if (active) {
    const practical = [], content = [];
    for (const item of items) (feedMaterialKind(item) === 'content' ? content : practical).push(item);
    items = [...practical,...content];
  }
  return {items,total:eligible.length,active,query,purpose};
}
