// Local, explainable matching of public metadata. No model or network calls.
import { repositoryPresentation } from './repositoryGuide.js';
export const TOPICS = [
  { label: 'AI 工具', input: /\bai\b|人工智能|智能助手|\bagent\b|\bllm\b/i, match: /\b(?:ai|llm|agents?|gpt|claude|codex|gemini)\b|人工智能|智能助手/i },
  { label: '自动化', input: /自动化|重复操作|automation|workflow/i, match: /automat|workflow|shortcut|手势|快捷键|自动化/i },
  { label: '写作与笔记', input: /写作|笔记|writing|notes?|markdown/i, match: /note.taking|notebook|writing|journaling|note app|笔记|写作|知识库/i },
  { label: '信息整理', input: /信息整理|收藏|书签|信息流|简报|rss|bookmark|read.later/i, match: /bookmark|github.stars|rss|read.it.later|news.reader|书签|收藏|简报/i },
  { label: '图片与视频', input: /图片|截图|视频|录屏|字幕|screenshot|video|youtube/i, match: /screenshot|screen.capture|screen.record|transcri|subtitle|youtube|video|image.edit|截图|字幕|录屏|视频/i },
  { label: '翻译与识字', input: /翻译|识字|文字识别|translation|\bocr\b/i, match: /translat|\bocr\b|翻译|文字识别/i },
  { label: 'Mac 工具', input: /\bmac(?:os)?\b|苹果电脑/i, match: /\bmac(?:os)?\b|苹果电脑/i },
  { label: '开发工具', input: /开发|编程|终端|coding|terminal|developer/i, match: /\bide\b|terminal|developer|coding|code.editor|开发|编程|终端/i },
];

const EXTRA_RULES = [
  { label: '融资新闻', input: /融资|funding/i, match: /funding.round|raised.*million|融资/i },
  { label: '模型跑分', input: /跑分|benchmark/i, match: /benchmark|leaderboard|跑分/i },
];
const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tokens = value => [...new Set(String(value || '').split(/[，,、;；\n]+/).map(s => s.trim()).filter(Boolean))];
const textOf = item => `${item.repository_name || item.title || ''} ${item.summary || ''} ${(Array.isArray(item.topics) ? item.topics : []).join(' ')}`;

function criteria(value) {
  const result = new Map();
  for (const phrase of tokens(value)) {
    const known = [...TOPICS, ...EXTRA_RULES].filter(rule => rule.input.test(phrase));
    if (known.length) for (const rule of known) result.set(rule.label, { label: rule.label, match: rule.match, literal: false });
    else {
      // Unknown requests are matched literally; no semantic or profitability inference.
      const pattern = /^[\w .+-]+$/.test(phrase) ? `(^|[^a-z0-9])${escapePattern(phrase)}(?=$|[^a-z0-9])` : escapePattern(phrase);
      result.set(phrase, { label: phrase, match: new RegExp(pattern, 'i'), literal: true });
    }
  }
  return [...result.values()];
}

export function describePurpose(item) {
  const value = textOf(item);
  const rules = [
    [/legal.*workflow|document.heavy|法律文书|律师/i, '处理文档与材料'],
    [/transcri|subtitle|youtube|字幕/i, '整理视频与字幕'],
    [/screenshot|screen.capture|screen.record|截图|录屏/i, '截图与录屏'],
    [/translat|\bocr\b|翻译|文字识别/i, '翻译与文字识别'],
    [/bookmark|github.stars|rss|read.it.later|书签|收藏/i, '整理收藏与信息'],
    [/terminal.*manager|terminal.*workspace|终端管理/i, '管理终端工作'],
    [/agent.skills?|claude.skills?|技能库/i, '给 AI 增加工作方法'],
    [/clipboard|text.utility|text.expansion|剪贴板/i, '减少复制和打字'],
    [/note.taking|notebook|writing|journaling|笔记|写作/i, '记笔记与写作'],
    [/automat|workflow|shortcut|手势|快捷键|自动化/i, '减少重复操作'],
    [/\b(?:ai|llm|agent)\b|智能助手/i, 'AI 工作助手'],
  ];
  return rules.find(([pattern]) => pattern.test(value))?.[1] || '日常效率工具';
}

export function selectFeed(items, profile = {}, hiddenIds = [], options = {}) {
  const include = criteria(profile.interests);
  const exclude = criteria(profile.exclude);
  const hidden = new Set(hiddenIds);
  const decorated = items.map(item => {
    const value = textOf(item);
    const matches = include.filter(rule => rule.match.test(value)).map(rule => rule.label);
    const exclusions = exclude.filter(rule => rule.match.test(value)).map(rule => rule.label);
    const category = describePurpose(item);
    const repository=repositoryPresentation(item);
    return { ...item, display_title: repository?.guide ? `${repository.title} · ${repository.repository.split('/').pop()}` : item.repository_name ? `${category} · ${item.repository_name.split('/').pop()}` : item.title,
      matched_interests: matches, excluded_interests: exclusions,
      matches_profile: (!include.length || matches.length > 0) && !exclusions.length,
      selection_reason: exclusions.length ? `包含不想看的方向：${exclusions.join('、')}，已从“按我的关注”移开。`
        : matches.length ? `标题、简介或摘要匹配“${matches.join('、')}”。这是关键词匹配，内容尚未验证。`
        : include.length ? '没有匹配当前想看的关键词；仍可查看或收藏。' : '尚未限定想看方向，先按来源时间排列；未知时用获取时间。',
    };
  });
  const recent = (a, b) => String(b.updated_at || b.published_at || b.captured_at || '').localeCompare(String(a.updated_at || a.published_at || a.captured_at || '')) || a.id.localeCompare(b.id);
  const rank = item => item.source_links?.find(link=>link.source_id===options.rankSource)?.source_rank || item.source_rank || Infinity;
  const order = options.rankSource ? (a,b) => (rank(a)-rank(b) || recent(a,b)) : recent;
  const candidates = decorated.filter(item => !hidden.has(item.id) && !(item.alias_ids || []).some(id => hidden.has(id))).sort(order);
  const matched = candidates.filter(item => item.matches_profile).sort((a, b) => b.matched_interests.length - a.matched_interests.length || order(a, b));
  const daily = matched.slice(0, 5);
  const rest = matched.slice(5);
  const discover = [...rest.filter(item => Number.isFinite(item.stars) && item.stars <= 1000), ...rest.filter(item => !Number.isFinite(item.stars) || item.stars > 1000)].slice(0, 2);
  return { decorated, candidates, daily, discover, matchedCount: matched.length,
    excludedCount: candidates.filter(item => item.excluded_interests.length).length,
    hiddenCount: decorated.filter(item => hidden.has(item.id) || item.alias_ids?.some(id=>hidden.has(id))).length,
    includes: include.map(rule => rule.label), literals: include.filter(rule => rule.literal).map(rule => rule.label),
  };
}
