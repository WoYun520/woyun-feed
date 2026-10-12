// Review filters only change the visible list. They do not promote, reject,
// rewrite, verify or upload source material.
export const DOT_FILTER_DEFAULTS = Object.freeze({query:'',category:'all',collector:'all',sort:'recent',minBookmarks:'all'});
export const DOT_FILTER_SORTS = Object.freeze({recent:'最近收到',bookmarks:'收藏从多到少',likes:'点赞从多到少'});

const categories = new Set(['all','tutorial','cognition']);
const collectors = new Set(['all','Dot','feedgrab']);
const minimums = new Set(['all','200','500']);
const statuses = new Set(['pending','featured','dismissed']);
const knownCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const comparableText = value => typeof value === 'string' ? value.normalize('NFKC').toLocaleLowerCase('zh-CN') : '';

export function normalizeDotFilters(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    query: typeof input.query === 'string' ? Array.from(input.query.trim()).slice(0,200).join('') : '',
    category:categories.has(input.category) ? input.category : 'all',
    collector:collectors.has(input.collector) ? input.collector : 'all',
    sort:Object.hasOwn(DOT_FILTER_SORTS,input.sort) ? input.sort : 'recent',
    minBookmarks:minimums.has(input.minBookmarks) ? input.minBookmarks : 'all',
  };
}

export function hasDotFilters(value) {
  const filters=normalizeDotFilters(value);
  return Boolean(filters.query || filters.category!=='all' || filters.collector!=='all' || filters.sort!=='recent' || filters.minBookmarks!=='all');
}

export function filterDotCandidates(candidates, {view='pending',filters={}} = {}) {
  const selectedView=statuses.has(view) ? view : 'pending';
  const selected=normalizeDotFilters(filters);
  const words=comparableText(selected.query).split(/\s+/u).filter(Boolean);
  const records=(Array.isArray(candidates) ? candidates : []).filter(record=>record && typeof record.id==='string' && record.status===selectedView);
  return records.map((record,index)=>({record,index})).filter(({record})=>{
    const material=record.material || {};
    if (selected.category!=='all' && material.category!==selected.category) return false;
    if (selected.collector!=='all' && record.batch?.collector!==selected.collector) return false;
    if (selected.minBookmarks!=='all') {
      const bookmarks=knownCount(material.bookmark_count);
      if (bookmarks===null || bookmarks<Number(selected.minBookmarks)) return false;
    }
    if (words.length) {
      const handle=typeof material.author_handle==='string' ? '@'+material.author_handle.replace(/^@/,'') : '';
      const text=[material.title_zh,material.summary_zh,material.author_handle,handle,material.selection_reason,material.my_angle].map(comparableText).join('\n');
      if (!words.every(word=>text.includes(word))) return false;
    }
    return true;
  }).sort((left,right)=>{
    if (selected.sort==='bookmarks' || selected.sort==='likes') {
      const key=selected.sort==='bookmarks' ? 'bookmark_count' : 'like_count';
      const a=knownCount(left.record.material?.[key]),b=knownCount(right.record.material?.[key]);
      if (a===null && b!==null) return 1;
      if (a!==null && b===null) return -1;
      if (a!==null && b!==null && a!==b) return b-a;
    }
    const a=Date.parse(left.record.imported_at),b=Date.parse(right.record.imported_at);
    if (Number.isFinite(a) && Number.isFinite(b) && a!==b) return b-a;
    if (Number.isFinite(a) && !Number.isFinite(b)) return -1;
    if (!Number.isFinite(a) && Number.isFinite(b)) return 1;
    return left.index-right.index;
  }).map(({record})=>record);
}
