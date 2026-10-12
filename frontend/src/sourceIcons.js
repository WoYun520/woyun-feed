// Offline source symbols. Brand assets come from Simple Icons; generic symbols
// come from Tabler Icons. See assets/source-icons/README.md for attribution.
const SOURCE_ICONS = Object.freeze({
  github: 'github',
  'github-trending': 'github',
  'v2ex-share': 'v2ex',
  producthunt: 'producthunt',
  juejin: 'juejin',
  zhihu: 'zhihu',
  baidu: 'baidu',
  x: 'x',
  appinn: 'apps',
  sspai: 'rss',
  ithome: 'news',
  solidot: 'news',
  hackernews: 'news',
  thepaper: 'news',
  toutiao: 'news',
  'wallstreetcn-hot': 'chart-line',
  wired: 'news',
  'mit-tech': 'news',
  '36kr': 'news',
  ifanr: 'news',
});

/** The adjacent source name is the accessible label; render these with alt="". */
export function sourceIcon(source = {}) {
  const id = typeof source.id === 'string' ? source.id : '';
  const symbol = SOURCE_ICONS[id]
    || (id.startsWith('youtube-') ? 'youtube'
      : id.startsWith('sopilot-') || source.link_kind === 'post' ? 'message-circle'
      : source.kind === 'curated' ? 'book-2'
      : source.kind === 'repository' ? 'github'
      : 'rss');
  return `./assets/source-icons/${symbol}.svg`;
}
