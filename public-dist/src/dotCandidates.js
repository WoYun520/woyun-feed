import { containsCredentialText } from './contentPrivacy.js';

// Intake is local and declarative. It never opens links or executes instructions
// in collector text, and selection does not upgrade a record to verified.
export const DOT_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const DOT_BATCH_MAX_ITEMS = 100;
export const DOT_CANDIDATE_MAX_ITEMS = 300;
export const DOT_CANDIDATE_SOURCE = Object.freeze({id:'dot-import',name:'Dot 素材',home_url:'https://x.com'});
export const FEEDGRAB_CANDIDATE_SOURCE = Object.freeze({id:'feedgrab-import',name:'feedgrab 素材',home_url:'https://x.com'});
export const CANDIDATE_COLLECTORS = Object.freeze(['Dot','feedgrab']);
export const isCandidateCollector = value => CANDIDATE_COLLECTORS.includes(value);
export const isCandidateImport = item => ['dot_import','feedgrab_import'].includes(item?.origin);
const statuses = new Set(['pending','featured','dismissed']);
const scopes = new Set(['main_post','full_thread','search_excerpt']);
const fail = message => {throw Error(message || 'Dot 素材格式不完整，未导入。');};
const plain = value => value && typeof value==='object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const date = value => {
  if (typeof value!=='string' || value.length>64 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const [year,month,day,hour,minute,second]=value.slice(0,19).split(/[-T:]/).map(Number);
  return month>=1 && month<=12 && day>=1 && day<=new Date(Date.UTC(year,month,0)).getUTCDate() && hour<24 && minute<60 && second<60;
};
const text = (value,max,allowEmpty=false) => typeof value==='string' && value.length<=max && (allowEmpty || value.trim().length>0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const fields = ['category','original_url','author_handle','published_at','title_zh','summary_zh','bookmark_count','like_count','view_count','metric_display','metrics_checked_at','metrics_source_url','read_scope','selection_reason','my_angle','unknowns'];
const envelopeFields = ['format','version','collector','collected_at','items','alternatives'];
const credentialParam = /^(?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|password|passwd|secret|authorization|x-amz-signature|x-goog-signature)$/i;

function inspect(value,depth=0) {
  if (depth>10) fail('素材结构过深，未导入。');
  if (typeof value==='string' && value.length>30000) fail('素材内容过长，未导入。');
  if (value && typeof value==='object') {
    for (const [key,child] of Object.entries(value)) {
      if (['__proto__','constructor','prototype'].includes(key)) fail('素材包含不支持的字段，未导入。');
      inspect(child,depth+1);
    }
  }
}

export function dotPostKey(value) {
  if (typeof value!=='string' || value.length>2000 || /[\r\n\t]/.test(value)) return null;
  try {
    const url=new URL(value);
    if (url.protocol!=='https:' || !['x.com','www.x.com','twitter.com','www.twitter.com','mobile.twitter.com'].includes(url.hostname) || url.port || url.username || url.password) return null;
    let decoded;try {decoded=decodeURIComponent(url.href);} catch {return null;}
    if (containsCredentialText(decoded)) return null;
    if ([...url.searchParams.keys()].some(key=>credentialParam.test(key))) return null;
    const match=url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/([1-9]\d{7,24})\/?$/);
    return match ? `x:${match[2]}` : null;
  } catch {return null;}
}

export function validateDotMaterial(value) {
  if (!plain(value) || fields.some(field=>!Object.hasOwn(value,field)) || Object.keys(value).some(field=>!fields.includes(field))) fail('每条素材需保留完整的原帖、用途、热度与未确认项。');
  inspect(value);
  if (containsCredentialText(value)) fail('素材疑似含有密码或密钥，请移除后再导入。');
  if (!['tutorial','cognition'].includes(value.category)) fail('素材类别只支持教程或认知。');
  const key=dotPostKey(value.original_url);
  if (!key || dotPostKey(value.metrics_source_url)!==key) fail('原帖与热度依据需指向同一条公开 X 帖子。');
  if (typeof value.author_handle!=='string' || !/^[A-Za-z0-9_]{1,15}$/.test(value.author_handle) || new URL(value.original_url).pathname.split('/')[1].toLowerCase()!==value.author_handle.toLowerCase()) fail('作者账号与原帖链接不一致。');
  if (value.published_at!==null && !date(value.published_at)) fail('发布时间需含时区；未知时请保留 null。');
  if (!date(value.metrics_checked_at)) fail('请保留含时区的热度观察时间。');
  if (!scopes.has(value.read_scope)) fail('请注明只读主帖、完整线程或搜索摘录。');
  for (const field of ['bookmark_count','like_count','view_count']) if (value[field]!==null && (!Number.isSafeInteger(value[field]) || value[field]<0)) fail('收藏、点赞和浏览量需为非负整数；未知时请保留 null。');
  for (const [field,max,empty] of [['title_zh',200,false],['summary_zh',8000,false],['metric_display',1000,true],['selection_reason',4000,false],['my_angle',4000,true]]) if (!text(value[field],max,empty)) fail(`素材的 ${field} 过长或不完整。`);
  if (/[\r\n]/.test(value.title_zh)) fail('素材标题需为一行。');
  if (!Array.isArray(value.unknowns) || value.unknowns.length>50 || !value.unknowns.every(entry=>text(entry,2000))) fail('未确认项格式不正确或过长。');
  // Copy only the supported contract, preserving source-supplied values.
  return Object.fromEntries(fields.map(field=>[field,structuredClone(value[field])]));
}

export function parseDotCandidates(raw) {
  if (typeof raw!=='string' || new TextEncoder().encode(raw).length>DOT_IMPORT_MAX_BYTES) fail('采集文件最多 2 MB，请分批导入。');
  let value;try {value=JSON.parse(raw);} catch {fail('这不是有效的 JSON，请选择采集工具交付的素材文件。');}
  inspect(value);
  if (!plain(value) || value.format!=='woyun-feed:candidates' || value.version!==1 || envelopeFields.some(field=>!Object.hasOwn(value,field)) || Object.keys(value).some(field=>!envelopeFields.includes(field))) fail('请选择完整的 format 为 woyun-feed:candidates、version 为 1 的采集素材。');
  if (containsCredentialText(value)) fail('素材疑似含有密码或密钥，请移除后再导入。');
  if (!text(value.collector,80) || !date(value.collected_at)) fail('请保留采集者和含时区的采集时间。');
  if (!isCandidateCollector(value.collector)) fail('采集者只支持 Dot 或 feedgrab，请保留真实来源名称。');
  if (!Array.isArray(value.items) || !Array.isArray(value.alternatives) || value.items.length+value.alternatives.length>DOT_BATCH_MAX_ITEMS) fail('每批最多 100 条素材，items 和 alternatives 需为列表。');
  return {collector:value.collector,collected_at:value.collected_at,items:value.items.map(validateDotMaterial),alternatives:value.alternatives.map(validateDotMaterial),total:value.items.length+value.alternatives.length};
}

export function candidateSource(collector) {
  if (!isCandidateCollector(collector)) fail('采集者只支持 Dot 或 feedgrab，请保留真实来源名称。');
  return collector==='feedgrab' ? FEEDGRAB_CANDIDATE_SOURCE : DOT_CANDIDATE_SOURCE;
}

export function dotMaterialItem(material,batch) {
  const key=dotPostKey(material.original_url),statusId=key?.slice(2);
  if (!key) fail();
  const source=candidateSource(batch.collector),feedgrab=batch.collector==='feedgrab';
  return {id:`dot-x-${statusId}`,title:material.title_zh,summary:material.summary_zh,
    original_url:material.original_url,canonical_url:`https://x.com/${material.author_handle.toLowerCase()}/status/${statusId}`,
    source_refs:[source.id],origin:feedgrab ? 'feedgrab_import' : 'dot_import',captured_at:batch.collected_at,published_at:material.published_at,
    content_status:'collector_summary',verification_status:'not_verified',link_kind:'post',author_handle:material.author_handle,
    summary_label:feedgrab ? 'feedgrab 采集' : 'Dot 整理',recommendation_reason:material.selection_reason,my_angle:material.my_angle,unknowns:structuredClone(material.unknowns),
    read_scope:material.read_scope,category:material.category,bookmark_count:material.bookmark_count,like_count:material.like_count,view_count:material.view_count,
    metric_display:material.metric_display,metrics_checked_at:material.metrics_checked_at,metrics_source_url:material.metrics_source_url,
    collector:batch.collector,collector_collected_at:batch.collected_at};
}

const stable = value => JSON.stringify(value && typeof value==='object' ? Array.isArray(value) ? value.map(entry=>JSON.parse(stable(entry))) : Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(stable(value[key]))])) : value);

export function validateDotItem(item) {
  if (!plain(item) || !isCandidateImport(item)) fail('采集材料的来源标记不完整。');
  const material=Object.fromEntries(fields.map(field=>[field,field==='title_zh' ? item.title : field==='summary_zh' ? item.summary : field==='selection_reason' ? item.recommendation_reason : item[field]]));
  validateDotMaterial(material);
  if (!isCandidateCollector(item.collector) || !date(item.collector_collected_at)) fail('采集材料缺少真实采集来源或时间。');
  const expected=dotMaterialItem(material,{collector:item.collector,collected_at:item.collector_collected_at});
  if (stable(item)!==stable(expected)) fail('原始采集内容不能被改成已核验或自动实测的记录。');
  return structuredClone(item);
}

export function validateDotCandidateRecords(records) {
  if (!Array.isArray(records) || records.length>DOT_CANDIDATE_MAX_ITEMS) fail('待筛选与精选最多保留 300 条，请先备份整理。');
  inspect(records);const keys=new Set();
  return records.map(record=>{
    if (!plain(record) || Object.keys(record).some(key=>!['id','key','status','imported_at','featured_at','batch','material','item'].includes(key)) || !statuses.has(record.status) || !date(record.imported_at) || !plain(record.batch) || !isCandidateCollector(record.batch.collector) || !date(record.batch.collected_at) || !['items','alternatives'].includes(record.batch.group) || Object.keys(record.batch).some(key=>!['collector','collected_at','group'].includes(key))) fail('采集筛选记录格式不完整。');
    if (record.status==='featured' ? !date(record.featured_at) : record.featured_at!==null) fail('Dot 精选时间与筛选状态不一致。');
    const material=validateDotMaterial(record.material),key=dotPostKey(material.original_url),item=dotMaterialItem(material,record.batch);
    if (record.key!==key || record.id!==item.id || keys.has(key) || stable(record.item)!==stable(item)) fail('采集素材重复或来源标记被修改。');
    keys.add(key);return {...structuredClone(record),material,item};
  });
}

export function makeDotCandidate(material,batch,now) {
  const item=dotMaterialItem(material,batch);
  return {id:item.id,key:dotPostKey(material.original_url),status:'pending',imported_at:now,featured_at:null,batch:structuredClone(batch),material:structuredClone(material),item};
}

export function createDotFeaturedExport(records) {
  const selected=validateDotCandidateRecords(records).filter(record=>record.status==='featured');
  if (!selected.length) fail('请先选入至少一条精选，再导出。');
  const exported_at=new Date().toISOString();
  const output={format:'woyun-feed:curated-selection',version:1,exported_at,selection_status:'user_selected_not_verified',
    note:'用户选入的素材；采集者的热度与摘要尚未独立核验，选入不代表实测、事实确认或公开发布。',
    items:selected.map(record=>({selected_at:record.featured_at,batch:structuredClone(record.batch),material:structuredClone(record.material)}))};
  return {filename:`dot-featured-${exported_at.replace(/[:.]/g,'-')}.json`,raw:JSON.stringify(output,null,2),count:selected.length};
}
