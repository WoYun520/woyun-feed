const DAY = 86400000;
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const text = (value, max = 1000) => typeof value === 'string' ? value.slice(0, max) : '';

function purpose(repo) {
  const value = `${repo.description || ''} ${(Array.isArray(repo.topics) ? repo.topics : []).join(' ')}`.toLowerCase();
  const categories = [
    [/bookmark|github stars|rss|read.it.later/, '整理收藏与信息'],
    [/transcri|subtitle|youtube/, '整理音视频文字'],
    [/screenshot|screen.capture|screen.record/, '截图与录屏'],
    [/clipboard|text utility|text.expansion/, '减少复制和打字'],
    [/note.taking|markdown|writing|notebook/, '记笔记与写作'],
    [/automat|workflow/, '减少重复操作'],
    [/\bai\b|\bllm\b|agent/, 'AI 工作助手'],
  ];
  return categories.find(([pattern]) => pattern.test(value))?.[1] || '日常效率工具';
}

export function normalizeRepositories(repos, capturedAt, snapshotId) {
  const found = new Map();
  for (const repo of repos) {
    if (!repo || typeof repo !== 'object') continue;
    if (!Number.isSafeInteger(repo.id) || repo.id <= 0 || repo.archived || repo.fork) continue;
    if (repo.stargazers_count < 100 || repo.stargazers_count > 5000 || !Number.isFinite(repo.stargazers_count)) continue;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo.full_name || '') || !time(repo.pushed_at)) continue;
    if (Date.parse(repo.pushed_at) < Date.parse(capturedAt) - 180 * DAY) continue;
    // Reconstruct a fixed-host URL rather than trusting links in external data.
    const url = `https://github.com/${repo.full_name}`;
    const category = purpose(repo);
    const item = {
      id: `github-${repo.id}`, title: `${category} · ${repo.full_name.split('/')[1]}`,
      summary: text(repo.description) || '作者未提供简介，可打开项目查看。',
      summary_label: '作者原始简介', recommendation_kind: 'rule',
      recommendation_reason: `按简介关键词归入“${category}”；${repo.stargazers_count} 个 star，近期有代码更新。属于效率工具候选，使用效果还需核对。`,
      source_refs: ['github'], original_url: url, published_at: null,
      repository_created_at: time(repo.created_at), updated_at: time(repo.pushed_at), captured_at: capturedAt,
      content_status: 'metadata_only', verification_status: 'not_tested',
      stars: repo.stargazers_count, category, repository_name: repo.full_name,
      evidence_ref: snapshotId,
      unknowns: ['只读取了项目简介与公开信息，未读完整说明、未安装实测。', '用途标签来自关键词归类，可能有偏差；star 不等于质量或增长速度。', '安装条件、费用与授权范围需要进一步核对。'],
      suggested_question: `请查看 ${url} 的说明，用通俗中文解释它能做什么、适合谁，核对安装条件与费用，给出一个可以截图展示的最小实测步骤。区分作者介绍与你实际验证的结果。`,
    };
    if (!found.has(item.id)) found.set(item.id, item);
  }
  return [...found.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
}

