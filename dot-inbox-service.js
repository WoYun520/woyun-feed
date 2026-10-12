import { DOT_IMPORT_MAX_BYTES, parseDotCandidates, isCandidateCollector } from './frontend/src/dotCandidates.js';

export const DOT_INBOX_PATH = '/api/dot/inbox';
export const DOT_INBOX_TTL_SECONDS = 30 * 24 * 60 * 60;
export const DOT_INBOX_PAGE_SIZE = 50;
const batchPrefix = 'batch:';
const envelopeKeys = ['format','version','collector','collected_at','items','alternatives'];
const metadataKeys = ['id','received_at','item_count','collector','collected_at'];
const hashPattern = /^[a-f0-9]{64}$/i;
const timestamp = value => {
  if (typeof value!=='string' || value.length>64 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const [year,month,day,hour,minute,second]=value.slice(0,19).split(/[-T:]/).map(Number);
  return month>=1 && month<=12 && day>=1 && day<=new Date(Date.UTC(year,month,0)).getUTCDate() && hour<24 && minute<60 && second<60;
};

class InboxError extends Error {
  constructor(status,code,message) {super(message);this.status=status;this.code=code;}
}
const bad = (code,message) => {throw new InboxError(400,code,message);};
const unavailable = () => {throw new InboxError(503,'inbox_unavailable','素材收件箱暂时不可用，请稍后重试。');};

function json(value,status=200,extraHeaders={}) {
  return new Response(JSON.stringify(value),{status,headers:{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY',
    'Referrer-Policy':'no-referrer',
    'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",
    ...extraHeaders
  }});
}

export function isDotInboxRoute(pathname) {
  return pathname===DOT_INBOX_PATH || pathname.startsWith(`${DOT_INBOX_PATH}/`);
}

export function canonicalDotPayload(payload) {
  const sort = value => Array.isArray(value) ? value.map(sort) : value && typeof value==='object'
    ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])])) : value;
  return JSON.stringify(sort(payload));
}

export async function dotInboxHash(value) {
  const bytes=new TextEncoder().encode(value);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

function configured(env) {
  return hashPattern.test(env?.DOT_DELIVERY_TOKEN_HASH || '') && hashPattern.test(env?.DOT_REVIEW_TOKEN_HASH || '')
    && env.DOT_DELIVERY_TOKEN_HASH.toLowerCase()!==env.DOT_REVIEW_TOKEN_HASH.toLowerCase()
    && ['get','put','list'].every(method=>typeof env?.DOT_INBOX?.[method]==='function');
}

async function authorized(request,expectedHash) {
  const header=request.headers.get('Authorization') || '';
  const match=header.match(/^Bearer ([\x21-\x7e]{16,1024})$/i);
  if (!match) return false;
  const actual=await dotInboxHash(match[1]);
  const expected=expectedHash.toLowerCase();
  let difference=0;
  for (let index=0;index<64;index++) difference|=actual.charCodeAt(index)^expected.charCodeAt(index);
  return difference===0;
}

async function readBody(request) {
  const contentLength=request.headers.get('Content-Length');
  if (contentLength!==null && (!/^\d+$/.test(contentLength) || !Number.isSafeInteger(Number(contentLength)))) bad('invalid_length','请求长度不正确。');
  if (Number(contentLength)>DOT_IMPORT_MAX_BYTES) {
    await request.body?.cancel().catch(()=>{});
    throw new InboxError(413,'batch_too_large','每批素材最多 2 MB，请分批投递。');
  }
  if (!request.body) bad('empty_batch','请投递 Dot 素材 JSON。');
  const reader=request.body.getReader(),chunks=[];let length=0;
  try {
    for (;;) {
      const {done,value}=await reader.read();if (done) break;
      length+=value.byteLength;
      if (length>DOT_IMPORT_MAX_BYTES) throw new InboxError(413,'batch_too_large','每批素材最多 2 MB，请分批投递。');
      chunks.push(value);
    }
  } catch(error) {
    await reader.cancel().catch(()=>{});
    if (error instanceof InboxError) throw error;
    bad('invalid_body','未收到完整素材，请重试。');
  }
  const bytes=new Uint8Array(length);let offset=0;
  for (const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try {return new TextDecoder('utf-8',{fatal:true}).decode(bytes);} catch {bad('invalid_encoding','素材需使用 UTF-8 文本。');}
}

function validatedPayload(raw) {
  let value;try {value=JSON.parse(raw);} catch {bad('invalid_json','请投递有效的 Dot 素材 JSON。');}
  if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!envelopeKeys.includes(key)) || envelopeKeys.some(key=>!Object.hasOwn(value,key))) bad('invalid_batch','Dot 素材需使用完整的约定格式。');
  let parsed;try {parsed=parseDotCandidates(raw);} catch(error) {bad('invalid_batch',error.message);}
  if (!isCandidateCollector(parsed.collector)) bad('invalid_collector','此入口只接收 Dot 或 feedgrab 的素材。');
  return {format:'woyun-feed:candidates',version:1,collector:parsed.collector,collected_at:parsed.collected_at,
    items:parsed.items,alternatives:parsed.alternatives};
}

function validMetadata(value,id) {
  return value && typeof value==='object' && !Array.isArray(value)
    && Object.keys(value).length===metadataKeys.length && metadataKeys.every(key=>Object.hasOwn(value,key))
    && value.id===id && hashPattern.test(id) && timestamp(value.received_at) && timestamp(value.collected_at)
    && isCandidateCollector(value.collector) && Number.isSafeInteger(value.item_count) && value.item_count>=0 && value.item_count<=100;
}

async function readStored(env,id) {
  const raw=await env.DOT_INBOX.get(`${batchPrefix}${id}`);
  if (raw===null || raw===undefined) return null;
  if (typeof raw!=='string' || new TextEncoder().encode(raw).byteLength>DOT_IMPORT_MAX_BYTES+1024) unavailable();
  let stored;try {stored=JSON.parse(raw);} catch {unavailable();}
  if (!stored || typeof stored!=='object' || Object.keys(stored).length!==3
    || !Object.hasOwn(stored,'id') || !Object.hasOwn(stored,'received_at') || !Object.hasOwn(stored,'payload')
    || stored.id!==id || !timestamp(stored.received_at)) unavailable();
  let payload;try {payload=validatedPayload(JSON.stringify(stored.payload));} catch {unavailable();}
  if (await dotInboxHash(canonicalDotPayload(payload))!==id) unavailable();
  return {id,received_at:stored.received_at,payload};
}

function queryCursor(url,isCollection,isRead) {
  const entries=[...url.searchParams.entries()];
  if (!entries.length) return null;
  if (!isCollection || !isRead || entries.length!==1 || entries[0][0]!=='cursor') bad('unsupported_query','此入口不支持这些查询参数；密钥只能放在请求头。');
  const value=entries[0][1];
  if (!value || value.length>2048 || /[\u0000-\u0020\u007f]/.test(value)) bad('invalid_cursor','分页位置不正确，请从第一批重新读取。');
  return value;
}

export async function handleDotInboxRequest(request,env) {
  try {
    const url=new URL(request.url);
    if (!isDotInboxRoute(url.pathname)) return null;
    const origin=request.headers.get('Origin');
    if (origin!==null && origin!==url.origin) return json({error:'origin_not_allowed',message:'不接受其他网站发来的素材收件箱请求。'},403);
    if (!configured(env)) unavailable();
    const isCollection=url.pathname===DOT_INBOX_PATH;
    const allowed=isCollection ? 'GET, POST' : 'GET';
    if (!(isCollection ? ['GET','POST'] : ['GET']).includes(request.method)) return json({error:'method_not_allowed',message:'不支持此操作。'},405,{Allow:allowed});
    const isRead=request.method==='GET';
    if (!await authorized(request,isRead ? env.DOT_REVIEW_TOKEN_HASH : env.DOT_DELIVERY_TOKEN_HASH)) return json({error:'not_authorized',message:'收件箱连接未通过，请检查对应的接入密钥。'},401,{'WWW-Authenticate':'Bearer realm="dot-inbox"'});
    const cursor=queryCursor(url,isCollection,isRead);
    if (!isCollection) {
      const id=url.pathname.slice(DOT_INBOX_PATH.length+1);
      if (!/^[a-f0-9]{64}$/.test(id)) bad('invalid_batch_id','素材批次编号不正确。');
      const stored=await readStored(env,id);
      return stored ? json(stored) : json({error:'batch_not_found',message:'这批素材不存在或已超过 30 天保留期。'},404);
    }
    if (isRead) {
      let page;
      try {page=await env.DOT_INBOX.list({prefix:batchPrefix,limit:DOT_INBOX_PAGE_SIZE,...(cursor ? {cursor} : {})});}
      catch(error) {
        if (cursor && /cursor|invalid|400/i.test(String(error?.message))) bad('invalid_cursor','分页位置已失效，请从第一批重新读取。');
        unavailable();
      }
      if (!page || !Array.isArray(page.keys) || page.keys.length>DOT_INBOX_PAGE_SIZE || typeof page.list_complete!=='boolean') unavailable();
      const batches=page.keys.map(entry=>{
        const id=entry?.name?.slice(batchPrefix.length);
        if (!entry?.name?.startsWith(batchPrefix) || !validMetadata(entry.metadata,id)) unavailable();
        return {...entry.metadata};
      });
      if (!page.list_complete && (typeof page.cursor!=='string' || !page.cursor || page.cursor.length>2048 || /[\u0000-\u0020\u007f]/.test(page.cursor))) unavailable();
      return json({batches,next_cursor:page.list_complete ? null : page.cursor});
    }
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json') return json({error:'json_required',message:'请使用 application/json 投递素材。'},415);
    const payload=validatedPayload(await readBody(request));
    const id=await dotInboxHash(canonicalDotPayload(payload));
    const previous=await readStored(env,id);
    if (previous) return json({id,received_at:previous.received_at,item_count:previous.payload.items.length+previous.payload.alternatives.length,existing:true});
    const received_at=new Date().toISOString(),item_count=payload.items.length+payload.alternatives.length;
    await env.DOT_INBOX.put(`${batchPrefix}${id}`,JSON.stringify({id,received_at,payload}),{
      expirationTtl:DOT_INBOX_TTL_SECONDS,metadata:{id,received_at,item_count,collector:payload.collector,collected_at:payload.collected_at}
    });
    return json({id,received_at,item_count,existing:false},201);
  } catch(error) {
    if (error instanceof InboxError) return json({error:error.code,message:error.message},error.status);
    return json({error:'inbox_unavailable',message:'素材收件箱暂时不可用，请稍后重试。'},503);
  }
}
