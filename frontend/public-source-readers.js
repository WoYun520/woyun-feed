// Endpoint/field mappings adapted from NewsNow (MIT, ourongxing).
// See ../THIRD_PARTY_NOTICES.md. Parse public data only; never execute page scripts.
const plain = value => typeof value === 'string' ? value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<[^>]*>/g,' ').replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[\da-f]+|\d+);/gi, token => {
  const named={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '};
  if (named[token.toLowerCase()]) return named[token.toLowerCase()];
  const n=token[2]?.toLowerCase()==='x' ? parseInt(token.slice(3,-1),16) : Number(token.slice(2,-1));
  return n>0 && n<=0x10ffff && !(n>=0xd800 && n<=0xdfff) ? String.fromCodePoint(n) : '';
}).replace(/\s+/g,' ').trim() : '';
const identifier = value => typeof value === 'string' && /^\d+$/.test(value) ? value : Number.isSafeInteger(value) && value>0 ? String(value) : null;
const time = (value,multiplier=1000) => Number.isFinite(Number(value)) && Number(value)>0 && Number(value)*multiplier<=8640000000000000 ? new Date(Number(value)*multiplier).toISOString() : null;
const list = value => { if (!Array.isArray(value) || !value.length) throw new Error('来源没有返回有效列表，保留原有资料。'); return value; };
const attr = (tag,name) => tag?.match(new RegExp('\\b'+name+'=["\x27]([^"\x27]+)["\x27]','i'))?.[1] || '';

export function parsePublicSource(raw, source) {
  let items;
  const body=source.format==='public-json' ? JSON.parse(raw) : null;
  switch (source.id) {
    case 'juejin':
      if (body.err_no !== 0) throw new Error('来源返回错误，保留原有资料。');
      items=list(body.data).map(k=>({title:k?.content?.title,url:identifier(k?.content?.content_id) ? `https://juejin.cn/post/${k.content.content_id}` : null})); break;
    case 'zhihu':
      items=list(body.data).map(k=>({title:k?.target?.title_area?.text,url:k?.target?.link?.url,summary:plain(k?.target?.excerpt_area?.text),heat_label:plain(k?.target?.metrics_area?.text)})); break;
    case 'wallstreetcn-hot':
      if (body.code !== 20000) throw new Error('来源返回错误，保留原有资料。');
      items=list(body.data?.day_items).map(k=>({title:k?.title,url:k?.uri,published_at:time(k?.display_time)})); break;
    case 'thepaper':
      if (body.resultCode !== 1) throw new Error('来源返回错误，保留原有资料。');
      items=list(body.data?.hotNews).map(k=>({title:k?.name,url:identifier(k?.contId) ? `https://www.thepaper.cn/newsDetail_forward_${k.contId}` : null,published_at:time(k?.pubTimeLong,1)})); break;
    case 'toutiao':
      items=list(body.data).map(k=>({title:k?.Title,url:identifier(k?.ClusterIdStr) ? `https://www.toutiao.com/trending/${k.ClusterIdStr}/` : null})); break;
    case 'baidu': {
      const data=JSON.parse(raw.match(/<!--s-data:([\s\S]*?)-->/)?.[1] || 'null');
      items=list(data?.data?.cards?.[0]?.content).filter(k=>!k?.isTop).map(k=>({title:k?.word,url:k?.rawUrl,summary:plain(k?.desc)})); break;
    }
    case 'ithome':
      items=[...raw.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].flatMap(([,block])=>{
        const anchor=block.match(/<a\b[^>]*class=["']t["'][^>]*>([\s\S]*?)<\/a>/i);if (!anchor) return [];
        const title=plain(anchor[1]),url=attr(anchor[0],'href');
        if (!/^https:\/\/www\.ithome\.com\//.test(url) || /神券|优惠|补贴|京东/.test(title)) return [];
        const date=attr(block,'data-ot');
        return [{title,url,published_at:date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : null}];
      }); break;
    case 'hackernews':
      items=[...raw.matchAll(/<tr\b([^>]*class=["'][^"']*\bathing\b[^"']*["'][^>]*)>([\s\S]*?)<\/tr>/gi)].flatMap(([,tag,block])=>{
        const id=identifier(attr(tag,'id')),a=block.match(/<span\b[^>]*class=["']titleline["'][^>]*>\s*<a\b[^>]*>([\s\S]*?)<\/a>/i);
        return id && a ? [{title:plain(a[1]),url:`https://news.ycombinator.com/item?id=${id}`}]:[];
      }); break;
    case 'github-trending':
      items=[...raw.matchAll(/<article\b[^>]*class=["']Box-row["'][^>]*>([\s\S]*?)<\/article>/gi)].flatMap(([,block])=>{
        const heading=block.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || '';
        const href=attr(heading,'href');if (!/^\/[\w.-]+\/[\w.-]+$/.test(href)) return [];
        return [{title:href.slice(1),url:'https://github.com'+href,summary:plain(block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1])}];
      }); break;
    default: throw new Error('不支持的来源格式。');
  }
  const trimmed=list(items).slice(0,30).map((item,index)=>({...item,title:plain(item.title),source_rank:source.ranked ? item.source_rank || index+1 : null}));
  return {id:source.channel,status:'success',items:trimmed};
}
