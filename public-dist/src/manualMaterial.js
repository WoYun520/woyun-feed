// User-entered links stay local; this module never opens or fetches a URL.
const secret=/-----BEGIN .*PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})|\bBearer\s+[A-Za-z0-9_.-]{25,}|(?:密码|password|api[_ -]?key|token)\s*[:=：]\s*[^\s,;，；]{12,}/i;
const credentialParam=/^(?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|password|passwd|secret|authorization|x-amz-signature|x-goog-signature)$/i;
export function manualLink(value) {
  if(typeof value!=='string' || !value.trim() || value.length>4000 || /[\r\n\t]/.test(value)) throw Error('请粘贴一条完整的网页链接，最多 4000 字。');
  let url;
  try {url=new URL(value.trim());} catch {throw Error('链接格式不正确，请粘贴以 https:// 或 http:// 开头的完整链接。');}
  if(!['https:','http:'].includes(url.protocol) || url.username || url.password) throw Error('只支持网页链接，请移除链接中的账号和密码。');
  let decoded;
  try {decoded=decodeURIComponent(url.href);} catch {decoded=url.href;}
  if(secret.test(decoded) || [...url.searchParams.keys()].some(key=>credentialParam.test(key))) throw Error('链接中疑似含有密钥或登录凭据，请改用公开页面的链接。');
  return url.href;
}
export function materialLinkKey(value) {
  try {
    const url=new URL(value);
    if(!['http:','https:'].includes(url.protocol)) return null;
    url.hash='';
    for(const key of [...url.searchParams.keys()]) if(/^utm_/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href;
  } catch {return null;}
}
export function validateManualTitle(title) {
  if(typeof title!=='string' || !title.trim() || title.length>200 || /[\r\n]/.test(title)) throw Error('请填一个标题，最多 200 字。');
  if(secret.test(title)) throw Error('标题中疑似含有密码或密钥，请移除后保存。');
  return title.trim();
}
export function makeManualMaterial({url,title}) {
  const original_url=manualLink(url);
  return {id:`manual-${crypto.randomUUID()}`,title:validateManualTitle(title),summary:'',original_url,
    canonical_url:materialLinkKey(original_url),source_refs:['user-added'],origin:'user_added',
    added_at:new Date().toISOString(),captured_at:null,published_at:null,
    content_status:'user_link',verification_status:'not_verified',link_kind:null};
}
export function validateManualMaterial(item) {
  if(item.origin!=='user_added' || !/^manual-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(item.id) || !Number.isFinite(Date.parse(item.added_at))
    || item.added_at.length>64 || item.summary!=='' || item.captured_at!==null || item.published_at!==null
    || item.content_status!=='user_link' || item.verification_status!=='not_verified' || item.link_kind!==null
    || item.source_refs?.length!==1 || item.source_refs[0]!=='user-added' || item.repository_guide || item.evidence_ref || item.evidence_refs || item.alias_ids || item.source_links?.length)
    throw Error('手动材料的来源标记不完整，不能当成自动读取或已核验的资料。');
  if(manualLink(item.original_url)!==item.original_url || materialLinkKey(item.original_url)!==item.canonical_url || validateManualTitle(item.title)!==item.title)
    throw Error('手动材料的标题或链接格式不正确。');
}
