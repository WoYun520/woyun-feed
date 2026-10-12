const validId=value=>typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const record=value=>value && typeof value==='object' && !Array.isArray(value) && value.version===1
  && ['hidden_source_ids','pinned_source_ids'].every(field=>Array.isArray(value[field]) && value[field].length<=1000 && value[field].every(id=>typeof id==='string'));

export const sourcePreferenceKey=(mode='live')=>`personal-feed:${mode==='demo' ? 'demo' : 'live'}:source-preferences:v1`;

export function normalizeSourcePreferences(value,sources=[]) {
  const known=new Set(sources.map(source=>source.id).filter(validId));
  const unique=field=>[...new Set(Array.isArray(value?.[field]) ? value[field].filter(id=>validId(id) && known.has(id)) : [])];
  const hidden=unique('hidden_source_ids'),hiddenSet=new Set(hidden);
  return {version:1,hidden_source_ids:hidden,pinned_source_ids:unique('pinned_source_ids').filter(id=>!hiddenSet.has(id))};
}

export function readSourcePreferences(storage,sources,mode='live') {
  const key=sourcePreferenceKey(mode),defaults=normalizeSourcePreferences(null,sources);
  let raw;
  try {raw=storage.getItem(key);} catch {
    return {key,raw:null,preferences:defaults,readable:false,notice:'暂时无法读取此浏览器的来源设置，先显示全部来源；未采用任何已保存偏好。'};
  }
  if (raw===null) return {key,raw,preferences:defaults,readable:true,notice:''};
  try {
    const parsed=JSON.parse(raw);
    if (!record(parsed)) throw Error('invalid');
    return {key,raw,preferences:normalizeSourcePreferences(parsed,sources),readable:true,notice:''};
  } catch {
    return {key,raw,preferences:defaults,readable:true,notice:'此浏览器的来源设置格式不正确，先显示全部来源；可在“管理来源”里重新保存。'};
  }
}

export function writeSourcePreferences(storage,value,sources,{mode='live',expectedRaw,readable=true}={}) {
  if (!readable) throw Error('暂时无法读取此浏览器的来源设置。请取消后重新打开“管理来源”，再试一次。');
  if (!record(value)) throw Error('来源设置格式不正确，没有保存。');
  const key=sourcePreferenceKey(mode),preferences=normalizeSourcePreferences(value,sources);
  let current;
  try {current=storage.getItem(key);} catch {throw Error('无法核对最新来源设置，没有保存。请稍后重试。');}
  if (current!==expectedRaw) throw Error('来源设置已在另一个页面更改。请取消后重新打开“管理来源”，再保存。');
  const raw=JSON.stringify(preferences);
  try {storage.setItem(key,raw);} catch {throw Error('来源设置没有保存，浏览器存储暂时不可用。当前选择仍保留，请稍后重试。');}
  return {key,raw,preferences,readable:true,notice:''};
}

export function orderVisibleSources(sources,preferences) {
  const next=normalizeSourcePreferences(preferences,sources),hidden=new Set(next.hidden_source_ids),pins=new Map(next.pinned_source_ids.map((id,index)=>[id,index]));
  return sources.filter(source=>!hidden.has(source.id)).sort((a,b)=>(pins.get(a.id) ?? sources.length)-(pins.get(b.id) ?? sources.length));
}
