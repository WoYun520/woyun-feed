// Presentation only. The author's title, description and evidence stay unchanged.
export function repositoryName(item) {
  if (!item.original_url && /^[\w.-]+\/[\w.-]+$/.test(item.repository_name || '')) return item.repository_name;
  try {
    const u = new URL(item.original_url);
    if (u.protocol !== 'https:' || u.hostname !== 'github.com') return null;
    const parts = u.pathname.replace(/\/$/, '').split('/').filter(Boolean);
    if (parts.length !== 2 || parts.some(part => !/^[\w.-]+$/.test(part))) return null;
    return parts.join('/');
  } catch { return null; }
}

export const GUIDE_LABELS = {description:'AI 整理作者简介', observation:'观察仓库整理', readme:'AI 阅读项目说明'};

export function repositoryPresentation(item) {
  if(item.origin==='user_added') return null;
  const repository = repositoryName(item);
  if (!repository) return null;
  const guide = item.repository_guide;
  const chineseDescription = /[\u4e00-\u9fff]/.test(item.summary || '');
  return {
    repository,
    title: guide?.summary || (chineseDescription ? item.summary.slice(0,100) : '用途待整理'),
    basis: guide ? GUIDE_LABELS[guide.basis] || '整理介绍' : chineseDescription ? '作者简介' : '可查看作者原始简介',
    guide: guide || null,
    missing: !guide && !chineseDescription,
  };
}
