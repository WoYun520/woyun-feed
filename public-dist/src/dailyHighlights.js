import { TOPICS } from './feedSelection.js';
import { PRACTICAL_ITEMS, PRACTICAL_SOURCE, practicalMaterialKind } from './practicalMaterials.js';
import { authorSourceEnabled } from './postStream.js';

// A local shortlist of existing public material. No requests, model calls, or
// changes to source items. The text below is evidence, not a feature promise.
const MAX_AGE = 72 * 3600000, FUTURE_TOLERANCE = 5 * 60000;
const GUIDE_LABELS = {description:'AI 整理作者简介', observation:'观察仓库整理', readme:'AI 阅读项目说明'};
const usableGroups = new Set(['tech', 'community', 'creators', 'posts']);
const chinese = value => (value.match(/[\u3400-\u9fff]/g) || []).length;
const clean = (value, max = 1000) => typeof value === 'string' ? value.slice(0, max)
  .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' ')
  .replace(/https?:\/\/\S+/gi, '').replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : '';
const readable = value => chinese(value) >= 8 && chinese(value) / Math.max(1, value.replace(/\s/g, '').length) >= 0.08;
const asSet = value => new Set(value instanceof Set || Array.isArray(value) ? value : []);
const dateValue = value => value == null || value === '' ? null : typeof value === 'string' ? Date.parse(value) : NaN;
const recent = (value, now) => Number.isFinite(value) && value <= now + FUTURE_TOLERANCE && now - value <= MAX_AGE;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const shortened = (value, maximum = 120) => value.length > maximum ? value.slice(0, maximum - 1) + '…' : value;

function preparationFor(item) {
  const sentences = clean(item.summary).split(/[。！？!?\n]+/).map(value => value.trim()).filter(Boolean);
  const condition = sentences.find(value => /(?:需要|需先|必须|要求|仅支持|适用于|面向).{0,45}(?:安装|下载|账号|登录|权限|系统|Windows|Mac|Linux|芯片|模型|配置|网络|电脑)/i.test(value));
  return condition ? `来源说明：${shortened(condition, 120)}` : '准备条件未说明，先查看原文。';
}

function publicUrl(value) {
  if (typeof value !== 'string' || value.length > 4000) return null;
  try {
    const url = new URL(value), host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !host.includes('.')
      || /^(?:localhost|0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|198\.(?:18|19)\.)/.test(host)
      || /\.(?:local|localhost|internal|lan)$/.test(host) || host.includes(':')
      || /^\d+\./.test(host) && Number(host.split('.')[0]) >= 224
      || [...url.searchParams.keys()].some(key => /token|secret|password|api.?key|authorization|credential/i.test(key))) return null;
    url.hostname = host; url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(?:fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    if (['www.github.com', 'github.com'].includes(host)) {
      url.hostname = 'github.com'; url.protocol = 'https:';
      url.pathname = url.pathname.replace(/\.git\/?$/i, '').toLowerCase();
    }
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/$/, '');
    url.searchParams.sort();
    return url.href;
  } catch { return null; }
}

function repositoryOf(item, url) {
  const parsed = new URL(url), parts = parsed.pathname.split('/').filter(Boolean);
  if (parsed.hostname !== 'github.com' || parts.length !== 2 || parts.some(part => !/^[\w.-]+$/.test(part))) return null;
  const repository = parts.join('/');
  return item.repository_name && String(item.repository_name).toLowerCase() !== repository ? null : repository;
}

function guideFor(item, repository, now) {
  const guide = item.repository_guide, summary = clean(guide?.summary, 101), at = dateValue(guide?.recorded_at);
  if (!guide || !GUIDE_LABELS[guide.basis] || guide.verification !== 'not_tested' || !readable(summary)
    || summary.length > 100 || !Number.isFinite(at) || at > now + FUTURE_TOLERANCE) return null;
  // A generated guide is not pricing evidence, including in its title or
  // purpose. Use the original Chinese source text instead, or omit the item;
  // a free trial or open-source license never supports "free forever".
  if (/免费|收费|付费|售价|(?:费用|价格).{0,8}(?:为|是|仅|只|\d)|\bfree (?:tier|trial|to use)\b|\bpaid\b/i.test(summary)) return null;
  const url = publicUrl(guide.source_url);
  if (!url) return null;
  const parsed = new URL(url), segments = parsed.pathname.split('/').filter(Boolean).map(part => part.toLowerCase());
  const sameRepo = parsed.hostname === 'github.com' && segments.slice(0, 2).join('/') === repository
    || parsed.hostname === 'raw.githubusercontent.com' && segments.slice(0, 2).join('/') === repository
    || parsed.hostname === 'api.github.com' && segments[0] === 'repos' && segments.slice(1, 3).join('/') === repository;
  if (!sameRepo && guide.basis !== 'observation') return null;
  if (guide.basis === 'readme' && (now - at > 14 * 86400000 || dateValue(item.updated_at) > at)) return null;
  return {summary, label:GUIDE_LABELS[guide.basis], audience:clean(guide.audience, 100)};
}

// Each purpose needs both an operation and a concrete object in the same
// sentence. Generic AI, free, safety, earnings, and popularity words do not
// supply a purpose. Returned purposes quote existing text rather than inventing
// functionality from a category label.
const pair = (actions, objects) => new RegExp(`(?:${actions})[^。！？!?\\n]{0,32}(?:${objects})|(?:${objects})[^。！？!?\\n]{0,32}(?:${actions})`, 'i');
const PURPOSES = [
  {key:'information', label:'信息整理', pattern:pair('查找|搜索|检索|整理|管理|备份|归档|同步|保存|提取|聚合', '文件|文档|书签|收藏|资料|邮件|知识库|RSS')},
  {key:'writing', label:'记录与写作', pattern:pair('记下|记录|整理|生成(?!式)|撰写|编写|编辑|导出', '工作过程|工作日志|完成事项|每日摘要|任务草稿|报告|文案|文章|笔记|文本')},
  {key:'media', label:'图片与音视频处理', pattern:pair('生成(?!式)|编辑|制作|剪辑|转换|识别|转录|翻译|压缩|录制|提取', '图片|图像|视频|字幕|音频|语音|录屏|截图|照片|人物|文字')},
  {key:'tasks', label:'任务安排', pattern:/(?:任务|日程|待办)(?:管理|安排|提醒)|(?:管理|安排|提醒)(?:任务|日程|待办)/},
  {key:'network', label:'设备连接', pattern:pair('连接|直连|组网|建立|访问', '设备|隧道|内网|局域网')},
  {key:'development', label:'开发与配置', pattern:pair('运行|安装|配置|部署|调试|搭建|编译|接入|修改|管理|升级|模拟', '代码|终端|容器|Docker|Linux|开发环境|脚本|插件|MCP|Agent|软件|系统|电脑|模型')},
  {key:'automation', label:'减少重复操作', pattern:pair('自动|批量|定时|工作流|快捷键', '操作|任务|邮件|文档|文件|表格|浏览器|数据')},
];
const instruction = /教程|(?:操作|使用|配置|具体|以下)步骤|第一步|一条命令|只需.{0,12}命令|具体用法|实操|配置方法|使用方法|操作指南|示例|快捷键/i;
const practicalSentence = /(?:可以|能够|支持|用于|用来|只需|只要|可|能)[^。！？!?\n]{0,28}(?:整理|查找|搜索|记录|记下|安装|配置|运行|连接|编辑|管理|生成(?!式)|转录|翻译|提取|导出|制作|编译|备份|同步|模拟|执行|完成)|你用|(?:按|根据|通过).{0,24}(?:指令|命令|操作|步骤)|(?:完成|执行).{0,30}(?:安装|配置|查找|搜索|整理|生成|导出|检查|调整)|提示词|(?:使用|操作|配置)方法|(?:任务|日程|待办)管理工具/i;
const socialNarrative = /造假|引发.{0,8}争议|激烈争议|全是假的|总统|战争|逮捕|非法捕捞|渔船|伤亡|坠机|致死/i;
const promotion = /(?:^|[\s：:（(])(?:广告|赞助|商业推广)|推广合作|付费推广|限时抢购|立即购买|扫码购买|下单购买|折扣码|优惠券|返佣|私信领取|课程报名|稳赚|日赚\s*\d|月入\s*\d|抽奖|转发抽|关注抽|周边.{0,12}抽|(?:注册|下载).{0,16}入金|邀请码.{0,10}注册/i;
const newsOnly = /融资|估值|财报|股价|涨停|债券|期货|货币政策|跑分|benchmark|SWE-bench|排行榜|性能榜首|(?:发布|推出).{0,24}(?:图像模型|大模型|语言模型|芯片)|(?:图像模型|大模型|语言模型|芯片).{0,24}(?:发布|推出)/i;
const READING_AUDIENCE = {information:'想整理文件或收藏的人',writing:'想记录工作或写作的人',media:'处理图片、视频或字幕的人',tasks:'想安排任务或日程的人',automation:'想减少重复操作的人'};

function postActionEvidence(item) {
  const summary = typeof item.summary === 'string' ? item.summary.slice(0,12000).normalize('NFKC') : '';
  const lines = summary.split(/\r?\n/).map(line => line.trim().replace(/^[$>]\s*/, '').replace(/^`{1,3}|`{1,3}$/g, ''));
  // A supplied command can be copied, but is still neither run nor verified.
  const command = /^(?:npx\s+(?:(?:--yes|-y)\s+)?[@A-Za-z0-9][\w@./:-]*(?:\s+\S.*)?|npm\s+(?:(?:install|i|ci)(?:\s+\S.*)?|(?:run|exec)\s+\S.*)|pip(?:3)?\s+install\s+\S.*|git\s+clone\s+\S.*|docker\s+(?:run|pull|build|compose)\s+\S.*|ffmpeg\s+-\S.*)$/i;
  if (lines.some(line => command.test(line))) return 20;
  const operations = /打开|点击|框选|添加|编辑|输入|粘贴|复制|安装|下载|配置|设置|运行|执行|导出|保存|创建|导入|上传|转换|剪辑|转录|调试|生成|选择|连按/g;
  const objects = /软件|应用|工具|插件|文件|字幕|图片|画面|视频|音频|浏览器|扩展|文档|笔记|菜单|区域|箭头|文字|按钮|面板|终端|代码|脚本|配置项|\b(?:Skill|MCP|API|Obsidian|Docker|FFmpeg)\b/i;
  const operationCount = value => [...value.matchAll(operations)].length;
  const step = /^(?:\d{1,2}[.、)）:\s]|[①②③④⑤⑥⑦⑧⑨]|第[一二三四五六七八九十\d]+步)/;
  const steps = lines.filter(line => step.test(line) && objects.test(line) && operationCount(line)>0);
  const sequence = /第一步|第二步|第[一二三四五六七八九十\d]+步|然后|接着|最后|再(?:用|点|选|输入|复制|导出|保存)/;
  if (steps.length >= 2 || steps.some(line => operationCount(line)>=2)
    || summary.split(/[。！？!?\n]+/).some(sentence => sequence.test(sentence) && objects.test(sentence) && operationCount(sentence)>=2)) return 12;
  // "Ask an AI to install it" and a link to an unseen tutorial are not supplied
  // steps. A complete inline prompt/example is a distinct reusable resource.
  const prompt = /(?:完整提示词|可复制提示词|示例提示词|提示词示例)[：:]\s*([\s\S]+)/i.exec(summary)?.[1]?.trim();
  return prompt && prompt.length>=80 && readable(prompt) ? 8 : 0;
}

function evidenceFor(item, repository, now) {
  const guide = repository ? guideFor(item, repository, now) : null;
  const actionEvidence = item.link_kind === 'post' ? postActionEvidence(item) : 0;
  // Post opinions, news and off-page setup invitations remain in their source
  // lists; a featured action needs something usable in the supplied excerpt.
  if (item.link_kind === 'post' && !actionEvidence) return null;
  const raw = clean(item.summary).replace(/#?欢迎关注.{0,160}?(?:为您奉上。|$)/g, '').replace(/查看全文\s*$/g, '').trim();
  const summary = guide?.summary || raw;
  if (!readable(summary) || /(?:正文|用途|摘要).{0,8}(?:未读取|待整理|待确认)|来自.{0,40}标题线索/.test(summary)) return null;
  // Repository titles may have generated category prefixes. They are never
  // evidence of a repository's capability, audience, or cost.
  const title = repository ? '' : clean(item.title, 500);
  const material = `${title}\n${summary}`;
  if (promotion.test(material) || /最(?:能)?赚钱|稳赚|躺赚|保证收益|轻松变现|暴利/.test(material)
    || !guide && socialNarrative.test(material) || newsOnly.test(material) && !instruction.test(summary)) return null;
  // Repository descriptions can be bilingual. Require the selected purpose
  // itself to be Chinese, rather than borrowing Chinese from a category title
  // or a distant suffix and displaying an English paragraph. These are still
  // unchanged source sentences; missing explanations are never synthesized.
  const sentences = summary.split(repository ? /[。！？!?\n]+|\.\s+/ : /[。！？!?\n]+/).map(text => text.trim()).filter(Boolean);
  const matches = sentences.flatMap((sentence, index) => PURPOSES.filter(rule => (guide || practicalSentence.test(sentence) || instruction.test(sentence))
    && (!repository || readable(sentence) && chinese(sentence) / Math.max(1, sentence.replace(/\s/g, '').length) >= 0.4)
    && !/(?:文|编辑)\s*[｜|：:]|定位升级|行业热点|一年前.{0,20}热点/.test(sentence) && rule.pattern.test(sentence))
    .map(rule => ({rule, sentence, index, spanLength:sentence.match(rule.pattern)[0].length, strength:(instruction.test(sentence) ? 4 : 0) + (sentence.length >= 18 ? 2 : 0)
      + (sentence.match(rule.pattern)[0].length <= 16 ? 2 : 0)})));
  if (!matches.length) return null;
  matches.sort((a, b) => b.strength - a.strength || a.index - b.index || a.spanLength - b.spanLength || compare(a.rule.key, b.rule.key));
  const selected = matches[0];
  let purpose = selected.sentence;
  if (selected.rule.key === 'tasks' && /最佳|最好|我的心目中/.test(purpose)) {
    const match = purpose.match(selected.rule.pattern), end = match.index + match[0].length;
    purpose = match[0] + (purpose.slice(end).startsWith('工具') ? '工具' : '');
  }
  if (!repository && /(?:一条|一个|一款|临时|使用方|可以|能够|之间|它的)$/.test(purpose) && selected.rule.pattern.test(title)) purpose = title;
  purpose = purpose.length > 120 ? purpose.slice(0, 119) + '…' : purpose;
  const boundary = guide?.label || (repository ? '作者中文简介' : item.link_kind === 'post' ? '第三方榜单摘录'
    : item.link_kind === 'video' ? '公开视频简介' : '来源摘要');
  const audienceSentence = sentences.find(text => /(?:适合|面向|针对|供).{1,32}(?:用户|开发者|创作者|读者|团队|的人|使用者)/.test(text));
  const readingAudience = ['development','network'].includes(selected.rule.key) || /命令行|命令|配置方法/.test(selected.sentence)
    ? '有安装配置经验的人' : READING_AUDIENCE[selected.rule.key];
  const audience = guide?.audience && chinese(guide.audience) >= 2 ? `资料描述：${guide.audience}`
    : audienceSentence ? `来源描述：${audienceSentence.slice(0, 100)}` : `阅读提示：${readingAudience}`;
  // Cost comes only from the original source text, not an AI guide. Quote the
  // condition as well: open source, no registration, and API compatibility do
  // not establish that the tool is free to run.
  const feeText = `${repository ? '' : title}\n${raw}`.split(/[。！？!?\n]+/)
    .filter(text => !/邀请码|骗局|欺诈/.test(text) && /免费(?:使用|版|试用|额度|工具|软件|应用|提供|开放|下载)|完全免费|永久免费|无需付费|不收费|(?:需要|需|须|可选).{0,8}付费|付费(?:版|订阅)|收费|订阅.{0,12}(?:元|美元|价格)|(?:价格|费用).{0,16}(?:元|美元)|\bfree (?:tier|trial|to use)\b|\bpaid\b|\$\d/i.test(text));
  const cost = feeText.length ? `来源称：${feeText.join('；').trim().slice(0, 180)}${feeText.join('；').length > 180 ? '…' : ''}（完整费用与条件待核对）` : '费用待确认';
  return {purpose, category:selected.rule.key, label:selected.rule.label, audience, cost, preparation:preparationFor(item),
    actionReason:actionEvidence ? `摘录提供了${actionEvidence === 20 ? '可复制的命令' : actionEvidence === 12 ? '具体的软件操作步骤' : '可复制的完整提示词'}；具体效果尚未实测。` : '',
    title:repository ? `${purpose} · ${repository.split('/').at(-1)}` : chinese(title) >= 4 ? title : purpose,
    basis:`${boundary} · ${item.link_kind === 'post' ? '未核对原帖、' : item.link_kind === 'video' ? '未观看视频、' : ''}未实测`,
    searchText:`${repository || title}\n${raw}\n${guide?.summary || ''}`,
    score:12 + selected.strength + Math.min(2, new Set(matches.map(match => match.rule.key)).size)
      + (summary.length >= 60 ? 3 : 0) + (guide ? 3 : 0) + actionEvidence};
}

// Fixed public notes are a distinct supplement, never a newly published item.
// Exact catalog matching prevents a restored or edited item from borrowing an
// official-reading label. They still obey the visible source and item scopes.
function practicalCandidate(item, sourceMap, options) {
  const {now, hidden, hiddenSources, group, newIds, excludes, interests} = options;
  const original = PRACTICAL_ITEMS.find(entry => entry.id === item?.id);
  if (!original || !practicalMaterialKind(item) || item.captured_at !== original.captured_at
    || item.origin !== 'curated' || item.verification_status !== 'not_tested'
    || !item.source_refs?.includes(PRACTICAL_SOURCE.id)) return null;
  const source = sourceMap.get(PRACTICAL_SOURCE.id), aliases = Array.isArray(item.alias_ids) ? item.alias_ids : [];
  if (!source || source.kind !== 'curated' || source.status !== 'ok' || source.enabled === false || source.disabled === true
    || hiddenSources.has(source.id) || hidden.has(item.id) || aliases.some(id => hidden.has(id))
    || group !== 'all' && source.group !== group || newIds && !newIds.has(item.id) && !aliases.some(id => newIds.has(id))) return null;
  const captured = dateValue(item.captured_at), url = publicUrl(item.original_url);
  if (!url || !Number.isFinite(captured) || captured > now + FUTURE_TOLERANCE || now - captured > 30 * 86400000
    || item.canonical_url && publicUrl(item.canonical_url) !== url) return null;
  const fields = Object.fromEntries(item.summary.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^(用途|开始|限制|费用|依据)[：:]\s*(.*)$/);
    return match ? [[match[1], match[2]]] : [];
  }));
  const purpose = fields['用途'], rule = PURPOSES.find(rule => rule.pattern.test(purpose || ''));
  const searchText = `${item.title}\n${item.summary}`;
  if (!readable(purpose || '') || !rule || excludes.some(phrase => matchesPreference(searchText, phrase))) return null;
  const audienceSentence = purpose.match(/适合[^。！？!?]{2,60}/)?.[0];
  const audience = audienceSentence ? `整理说明：${audienceSentence}` : `阅读提示：${READING_AUDIENCE[rule.key] || '愿意按说明安装配置的人'}`;
  const preparation = fields['限制']?.split(/[。！？!?]/)[0] || fields['开始']?.split(/[。！？!?]/)[0];
  return {item, title:item.title, purpose:shortened(purpose), audience,
    preparation:preparation ? `整理说明：${shortened(preparation)}` : '准备条件待确认。',
    cost:fields['费用'] ? `整理说明：${shortened(fields['费用'], 180)}（最新条件请到原站核对）` : '费用待确认',
    basis:'AI 阅读官方说明并整理 · 未安装、未实测', category:rule.key, label:rule.label, fixed:true,
    sourceIds:[source.id], sourceNames:[source.name || source.id], keys:[`url:${url}`], score:Math.min(2, interests.filter(phrase => matchesPreference(searchText, phrase)).length),
    timeLabel:'说明阅读时间', timeValue:new Date(captured).toISOString(), capturedAt:new Date(captured).toISOString(), time:captured,
    reason:'固定实用说明，非今日更新；用途、开始方法与限制已有整理，仍需亲自核对和尝试。'};
}

function phrases(value) {
  return (Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[，,、;；\n]+/) : [])
    .filter(text => typeof text === 'string' && text.trim()).map(text => text.trim().toLowerCase()).slice(0, 50);
}
function matchesPreference(text, phrase) {
  const rules = TOPICS.filter(rule => rule.input.test(phrase));
  return text.normalize('NFKC').toLowerCase().includes(phrase.normalize('NFKC'))
    || rules.some(rule => rule.match.test(text) || rule.label === '图片与视频' && /图片|图像|照片|视频|字幕|音频|录屏|截图/.test(text));
}

function candidate(item, sourceMap, options) {
  const {now, hidden, hiddenSources, group, newIds, excludes, interests} = options;
  const aliases = Array.isArray(item?.alias_ids) ? item.alias_ids : [];
  if (!item || typeof item.id !== 'string' || typeof item.title !== 'string' || !item.title.trim()
    || /^(?:user[_-]|manual)/.test(item.origin || '') || /^manual-/.test(item.id) || ['headline_only', 'user_link', 'demo'].includes(item.content_status)
    || !['metadata_only', 'excerpt_only', 'body_read'].includes(item.content_status)
    || hidden.has(item.id) || aliases.some(id => hidden.has(id))
    || newIds && !newIds.has(item.id) && !aliases.some(id => newIds.has(id))) return null;
  const url = publicUrl(item.original_url);
  if (!url || item.canonical_url && publicUrl(item.canonical_url) !== url) return null;
  const repository = repositoryOf(item, url);
  if (item.repository_name && !repository) return null;
  const dates = [item.published_at, item.updated_at, item.captured_at, item.repository_created_at, item.source_updated_at, item.source_item_time].map(dateValue);
  if (dates.some(value => value !== null && (!Number.isFinite(value) || value > now + FUTURE_TOLERANCE))) return null;
  const contentTime = dateValue(repository ? item.updated_at : item.published_at);
  if (contentTime !== null && !recent(contentTime, now)) return null;
  const refs = [...new Set(Array.isArray(item.source_refs) ? item.source_refs : [])].sort(compare);
  const eligible = refs.flatMap(id => {
    const source = sourceMap.get(id);
    if (!source || source.status !== 'ok' || source.enabled === false || source.disabled === true || hiddenSources.has(id)
      || !authorSourceEnabled(source, options)
      || !usableGroups.has(source.group) || group !== 'all' && source.group !== group
      || !recent(dateValue(source.last_success_at), now)) return [];
    const link = Array.isArray(item.source_links) ? item.source_links.find(link => link?.source_id === id) : null;
    if (link && publicUrl(link.url) !== url) return [];
    const captured = dateValue(link ? link.captured_at : item.captured_at);
    return recent(captured, now) ? [{source, captured}] : [];
  });
  if (!eligible.length) return null;
  const evidence = evidenceFor(item, repository, now);
  if (!evidence || excludes.some(phrase => matchesPreference(evidence.searchText, phrase))) return null;
  const captured = Math.max(...eligible.map(entry => entry.captured)), time = contentTime ?? captured;
  const timeLabel = contentTime === null ? '最近采集；发布未知' : repository ? '仓库更新' : '来源发布';
  const names = eligible.map(entry => typeof entry.source.name === 'string' ? entry.source.name : entry.source.id);
  const titleKey = clean(item.title, 500).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const keys = [`url:${url}`, ...(repository ? [`repository:${repository}`] : []),
    ...(titleKey.replace(/[^\p{L}\p{N}]/gu, '').length >= 18 ? [`title:${titleKey}`] : [])];
  const matchedInterests = interests.filter(phrase => matchesPreference(evidence.searchText, phrase));
  // Calendar-day recency stays stable within a Beijing day. Long summaries
  // cannot accumulate extra points by repeating the same operation.
  const day = value => Math.floor((value + 8 * 3600000) / 86400000);
  const recency = Math.max(0, 3 - Math.max(0, day(now) - day(time)));
  const score = evidence.score + recency + (contentTime === null ? 0 : 2) + Math.min(2, matchedInterests.length);
  return {item, ...evidence, sourceIds:eligible.map(entry => entry.source.id), keys, score,
    sourceNames:[...new Set(names)], timeLabel, timeValue:new Date(time).toISOString(), capturedAt:new Date(captured).toISOString(), time,
    reason:evidence.actionReason || `中文资料明确提到${evidence.label}，保留原链接${matchedInterests.length ? `；匹配关注词“${matchedInterests.slice(0,2).join('、')}”` : ''}。`};
}

function distinct(candidates) {
  const parents = candidates.map((_, index) => index), byKey = new Map();
  function find(index) {while (parents[index] !== index) {parents[index] = parents[parents[index]]; index = parents[index];} return index;}
  for (let index = 0; index < candidates.length; index++) for (const key of candidates[index].keys) {
    if (byKey.has(key)) parents[find(index)] = find(byKey.get(key));
    else byKey.set(key, index);
  }
  const first = new Map();
  for (let index = 0; index < candidates.length; index++) if (!first.has(find(index))) first.set(find(index), candidates[index]);
  return [...first.values()];
}

export function selectDailyHighlights(items, sources, {now = Date.now(), profile = {}, hiddenIds = [], hiddenSourceIds = [], group = 'all', onlyNewIds = null, limit = 5, includePractical = false, creatorCatalog, creatorPreferences = {}} = {}) {
  now = now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : now;
  if (!Number.isFinite(now)) throw new RangeError('精选需要有效的当前时间。');
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const value = type => parts.find(part => part.type === type).value;
  const dateKey = `${value('year')}-${value('month')}-${value('day')}`;
  const sourceMap = new Map((Array.isArray(sources) ? sources : []).filter(source => source && typeof source.id === 'string').map(source => [source.id, source]));
  const options = {now, hidden:asSet(hiddenIds), hiddenSources:asSet(hiddenSourceIds), group:typeof group === 'string' ? group.replace(/^group:/, '') : 'all',
    newIds:onlyNewIds === null ? null : asSet(onlyNewIds), excludes:phrases(profile?.exclude), interests:phrases(profile?.interests), creatorCatalog, creatorPreferences};
  // Manually curated external material has its own shelf; never label it an automatic daily pick.
  const originals = Array.isArray(items) ? items.filter(item=>!['dot_import','feedgrab_import'].includes(item?.origin)) : [];
  const candidates = [...originals.map(item => candidate(item, sourceMap, options)).filter(Boolean),
    ...(includePractical ? originals.map(item => practicalCandidate(item, sourceMap, options)).filter(Boolean) : [])]
    .sort((a, b) => b.score - a.score || b.time - a.time || compare(a.item.id, b.item.id) || compare(a.keys[0], b.keys[0]));
  const unique = distinct(candidates), sourceCounts = new Map(), purposeCounts = new Map(), selected = [];
  const maximum = Number.isFinite(limit) ? Math.max(0, Math.min(5, Math.floor(limit))) : 5;
  for (const entry of unique) {
    if (selected.length >= maximum) break;
    if (entry.sourceIds.some(id => (sourceCounts.get(id) || 0) >= 2) || (purposeCounts.get(entry.category) || 0) >= 2) continue;
    for (const id of entry.sourceIds) sourceCounts.set(id, (sourceCounts.get(id) || 0) + 1);
    purposeCounts.set(entry.category, (purposeCounts.get(entry.category) || 0) + 1);
    const {item, title, purpose, audience, preparation, cost, reason, basis, sourceNames, timeLabel, timeValue, capturedAt, fixed} = entry;
    selected.push({item, title, purpose, audience, preparation, cost, reason, basis, sourceNames, timeLabel, timeValue, capturedAt, fixed:!!fixed});
  }
  return {dateKey, items:selected, candidateCount:unique.length, omittedCount:unique.length - selected.length,
    message:maximum === 0 ? '本次未展示精选材料。' : !selected.length ? '暂无符合近期、中文用途和来源可用条件的材料。'
      : selected.length < maximum ? `本次精选 ${selected.length} 条，符合时效与用途条件的材料有限；规则初筛，未实测。`
        : `从 ${unique.length} 条合格材料中精选 ${selected.length} 条；规则初筛，未实测。`};
}
