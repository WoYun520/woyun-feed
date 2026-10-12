import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FeedService } from './feed-service.js';
import { FEED_CHANNELS, parseSubscription, normalizeSubscription, mergeSourceItems, sourceLinkIdentity, sourceBucketFromItems } from './feed-sources.js';
import { normalizePostImage } from './src/postMedia.js';
import { readHackerNewsApi } from './hackernews-source-reader.js';
import { readSopilotRank } from './sopilot-source-reader.js';
import { readSopilotAuthor } from './sopilot-author-reader.js';
import { createSourceFetch } from './source-retry.js';

export class MultiFeedService extends FeedService {
  constructor(options) { super(options); this.newsChannels = options.newsChannels || FEED_CHANNELS; this.newsCooldownMs = options.newsCooldownMs ?? 600000; }

  async current() {
    await super.current();
    // In-memory migration; no fetch or disk rewrite on page load.
    this.feed.source_buckets ||= {};
    for(const id of ['github',...this.newsChannels.map(source=>source.id)]) {
      if(!Array.isArray(this.feed.source_buckets[id])) this.feed.source_buckets[id]=sourceBucketFromItems(this.feed.items,id);
    }
    for (const definition of this.newsChannels) {
      const existing=this.feed.sources.find(source => source.id === definition.id);
      if (existing) Object.assign(existing,definition);
      else this.feed.sources.push({...definition, status:'not_connected', last_success_at:null, message:definition.availability_message || '等待首次更新'});
      if (definition.enabled === false) Object.assign(this.feed.sources.find(s=>s.id===definition.id),{status:'not_connected',message:definition.availability_message || '尚未接通自动读取'});
    }
    Object.assign(this.feed.sources.find(source=>source.id==='github'),{name:'GitHub 小型工具',group:'tech'});
    this.feed.sources = this.feed.sources.filter(source => source.id === 'github' || this.newsChannels.some(d => d.id === source.id));
    return structuredClone(this.feed);
  }

  async refresh() {
    await this.current();
    if (this.inflight) return this.inflight;
    const due = this.feed.sources.filter(source => source.enabled !== false && !(Date.parse(source.next_allowed_at || '') > this.now().getTime()));
    if (!due.length) {
      const next = Math.min(...this.feed.sources.map(s=>Date.parse(s.next_allowed_at)));
      return {...structuredClone(this.feed), update_notice:`刚检查过，请约 ${Math.max(1,Math.ceil((next-this.now().getTime())/60000))} 分钟后再更新。现有内容可以继续使用。`};
    }
    this.inflight = this.updateSources(due).finally(()=>{this.inflight=null;});
    return this.inflight;
  }

  async readGitHub(previous, items) {
    // Reuse the proven reader, but only the coordinator commits the combined cache.
    const worker = new FeedService({dataDir:this.dataDir, fetchImpl:this.fetchImpl, now:this.now, cooldownMs:this.cooldownMs, timeoutMs:this.timeoutMs, retryDelayMs:this.retryDelayMs});
    worker.feed = {...structuredClone(this.feed), generated_at:previous.last_success_at || null, items:structuredClone(items), sources:[structuredClone(previous)]};
    worker.writeFeed = async () => {};
    const result = await worker.update();
    return {items:result.items, source:{...previous,...result.sources[0],name:'GitHub 小型工具',group:'tech', last_attempt_at:result.refresh.last_attempt_at, next_allowed_at:result.refresh.next_allowed_at}};
  }

  async readNews(previous) {
    const source = this.newsChannels.find(s=>s.id===previous.id);
    const attemptedAt = this.now().toISOString();
    const sourceTimeoutMs = source.format==='hackernews-api' ? 20000 : source.sopilot_category ? Math.min(this.timeoutMs*2,20000) : this.timeoutMs;
    const controller = new AbortController(); const timer = setTimeout(()=>controller.abort(),sourceTimeoutMs);
    const fetchSource = createSourceFetch(this.fetchImpl, {deadline: Date.now() + sourceTimeoutMs,
      attemptTimeoutMs: source.format==='hackernews-api' ? 1800 : source.sopilot_category ? sourceTimeoutMs / 2 : sourceTimeoutMs, retryDelayMs: this.retryDelayMs});
    let delay = 60000;
    try {
      const url = new URL(source.feed_url);
      const options={signal:controller.signal, redirect:'error',headers:{Accept:'application/rss+xml, application/xml, application/json, text/html','User-Agent':'PersonalFeed-local'}};
      let body;
      if(source.format==='hackernews-api') body=await readHackerNewsApi(source,{fetchImpl:fetchSource,...options});
      else if(source.format==='sopilot-author') body=await readSopilotAuthor(source,{fetchImpl:fetchSource,...options});
      else if(source.sopilot_category) body=await readSopilotRank(source,{fetchImpl:fetchSource,...options});
      else {
      const response = await fetchSource(url,options);
      if (!response.ok) {
        if (response.status===429) delay=Math.max(delay, Math.min((Number(response.headers.get('retry-after')) || 60)*1000,3600000));
        throw new Error(response.status===429 ? '来源暂时限制请求次数，请稍后更新。' : '暂时无法读取这个频道，请稍后更新。');
      }
      const raw = await response.text(); if (Buffer.byteLength(raw)>2*1024*1024) throw new Error('来源返回内容过大，本次未采用。');
      try { body=parseSubscription(raw,source); } catch { throw new Error('来源返回的内容格式不正确，本次未采用。'); }
      }
      const capturedAt=this.now().toISOString(), snapshotId=`${source.id}-${capturedAt.replace(/[:.]/g,'-')}-${randomUUID()}`;
      const result=normalizeSubscription(body,source,capturedAt,snapshotId);
      const dir=path.join(this.dataDir,'source-snapshots'); await fs.mkdir(dir,{recursive:true});
      const extracts=body.items.slice(0,source.sopilot_category ? 100 : 30).map(item=>({id:item?.id,title:item?.title,url:item?.url,published_at:item?.published_at || null,summary:item?.summary || null,source_item_date:item?.extra?.date || null,source_rank:item?.source_rank || null,heat_label:item?.heat_label || null,...(typeof item?.author_name==='string' ? {author_name:item.author_name.slice(0,100)} : {}),...(/^[A-Za-z0-9_]{1,15}$/.test(item?.author_handle || '') ? {author_handle:item.author_handle} : {})}));
      for (let index=0;index<extracts.length;index++) {
        const image=normalizePostImage(body.items[index]?.post_image,body.items[index]?.url);
        if (image) extracts[index].post_image=image;
      }
      await fs.writeFile(path.join(dir,snapshotId+'.json'),JSON.stringify({source_url:String(url),captured_at:capturedAt,upstream_status:body.status,source_updated_at:result.sourceTime,items:extracts},null,2),{flag:'wx',mode:0o600});
      return {items:result.items,source:{...source,status:'ok',last_attempt_at:attemptedAt,last_success_at:capturedAt,next_allowed_at:new Date(this.now().getTime()+this.newsCooldownMs).toISOString(),upstream_updated_at:result.sourceTime,upstream_cached:result.cached,
        message:`已读取 ${result.items.length} 条${source.ranked ? '榜单' : '公开列表'}内容${result.cached ? '（来源返回缓存）' : ''}，完整正文未读取`}};
    } catch(error) {
      const message=['AbortError','TimeoutError'].includes(error.name) ? '来源响应较慢，本次停止更新。' : error.message === 'oversize' ? '来源返回内容过大，本次未采用。' : ['EACCES','EPERM','ENOSPC','EROFS'].includes(error.code) ? '本机无法保存来源，请检查磁盘或目录权限。' : error.message?.startsWith('来源') || error.message?.startsWith('暂时') ? error.message : '暂时无法读取这个频道，请稍后更新。';
      return {items:null,source:{...previous,status:'failed',last_attempt_at:attemptedAt,next_allowed_at:new Date(this.now().getTime()+delay).toISOString(),message:message+(previous.last_success_at ? ' 已保留上次内容。' : '')}};
    } finally {clearTimeout(timer);}
  }

  async updateSources(due) {
    const before=structuredClone(this.feed), attemptedAt=this.now().toISOString();
    const results=await Promise.all(due.map(source=>source.id==='github' ? this.readGitHub(source,before.source_buckets.github || []) : this.readNews(source)));
    const buckets=structuredClone(before.source_buckets), sources=structuredClone(before.sources);
    let successes=0;
    for (const result of results) {
      const index=sources.findIndex(s=>s.id===result.source.id); sources[index]=result.source;
      if (result.source.status==='ok') {buckets[result.source.id]=result.items;successes++;}
    }
    const items=successes ? mergeSourceItems(buckets) : before.items;
    const seen=new Set([...(before.seen_links || []).map(value=>sourceLinkIdentity(value) || value),...before.items.map(item=>sourceLinkIdentity(item.original_url) || item.id)]);
    const newIds=successes ? items.filter(item=>!seen.has(sourceLinkIdentity(item.original_url) || item.id)).map(item=>item.id) : [];
    for (const item of items) seen.add(sourceLinkIdentity(item.original_url) || item.id);
    const failures=sources.filter(s=>s.enabled !== false && s.status==='failed').length;
    const duplicateCount=Object.values(buckets).reduce((n,list)=>n+list.length,0)-items.length;
    const next=successes ? {...before,schema_version:'0.3',items,source_buckets:buckets,seen_links:[...seen].slice(-5000),generated_at:this.now().toISOString()} : {...before};
    next.sources=sources;
    next.sections={daily:items.slice(0,5).map(x=>x.id),discover:items.slice(5,7).map(x=>x.id)};
    next.refresh={status:successes ? failures ? 'partial' : 'ok' : 'failed',last_attempt_at:attemptedAt,next_allowed_at:new Date(Math.min(...sources.map(s=>Date.parse(s.next_allowed_at)||this.now().getTime()))).toISOString(),new_count:newIds.length,new_item_ids:newIds,duplicate_count:Math.max(0,duplicateCount),
      message:successes ? `已更新 ${successes} 个来源，共 ${items.length} 条内容，新增 ${newIds.length} 条。${duplicateCount>0 ? `相同链接合并了 ${duplicateCount} 条。` : ''}${failures ? `${failures} 个来源暂时读不到，保留已有内容。` : ''}${due.length<sources.length ? '其余来源沿用最近获取的内容。' : ''}` : '本次没有获取到新结果，保留上次内容；各来源情况见下方。'};
    try {await this.writeFeed(next);this.feed=next;}
    catch {
      this.feed={...before,refresh:{...before.refresh,status:'failed',last_attempt_at:attemptedAt,new_count:0,new_item_ids:[],message:'本机未能保存更新，仍保留上次内容。请检查磁盘或目录权限。'}};
    }
    return structuredClone(this.feed);
  }
}
