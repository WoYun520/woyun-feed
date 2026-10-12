export const SOURCE_GROUPS = [
  {id:'tech', name:'科技与工具'},
  {id:'community', name:'技术与社区'},
  {id:'posts', name:'推特'},
  {id:'creators', name:'视频与创作者'},
  {id:'hot', name:'社会与视频热点'},
  {id:'finance', name:'商业与财经'},
];
export function matchesSource(item, filter, sources) {
  if (filter === 'all') return true;
  if (filter.startsWith('group:')) return item.source_refs.some(id => sources.some(source=>source.id===id && source.group===filter.slice(6)));
  return item.source_refs.includes(filter);
}
