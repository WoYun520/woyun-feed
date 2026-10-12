import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { repositoryName } from './src/repositoryGuide.js';
import { runCodexRepositoryGuides } from './codex-reader.js';

const fingerprint = text => createHash('sha256').update(text || '').digest('hex');
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const safeText = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 100 && /[\u4e00-\u9fff]/.test(value);
const error = (message, status=400) => Object.assign(new Error(message), {status});

export function guideInputs(feed) {
  const entries = new Map();
  for (const item of feed.items || []) {
    const repository = repositoryName(item);
    if (repository && typeof item.summary === 'string' && item.summary.trim()) {
      entries.set(repository.toLowerCase(), {repository, description:item.summary.slice(0,1000), fingerprint:fingerprint(item.summary.slice(0,1000))});
    }
  }
  return [...entries.values()];
}

export function validateGuides(report, inputs) {
  if (!report || !Array.isArray(report.entries) || report.entries.length !== inputs.length) throw error('中文介绍不完整，本批未采用。',502);
  const expected = new Map(inputs.map(entry => [entry.repository.toLowerCase(),entry]));
  const seen = new Set();
  return report.entries.map(entry => {
    const key = typeof entry?.repository === 'string' ? entry.repository.toLowerCase() : '';
    if (!expected.has(key) || seen.has(key) || !safeText(entry.summary)) throw error('中文介绍与项目不一致，本批未采用。',502);
    seen.add(key);
    return {...expected.get(key),summary:entry.summary.trim()};
  });
}

// Public descriptions only. Cached explanations are kept apart from raw feed evidence.
export class RepositoryGuideService {
  constructor({dataDir,feed,runner=runCodexRepositoryGuides,now=()=>new Date()}) {
    Object.assign(this,{dataDir,feed,runner,now});
    this.cache={version:1,entries:{}};
    this.catalog={entries:[]};
    this.ready=null; this.active=false; this.lock=Promise.resolve(); this.work=null;
    this.state={status:'idle',message:'中文用途可按需整理，已有介绍会复用。',completed:0,total:0};
  }
  async init() {
    if (!this.ready) this.ready=(async()=>{
      const read=async file=>{
        try {const text=await fs.readFile(path.join(this.dataDir,file),'utf8'); if (Buffer.byteLength(text)>1_000_000) return null; return JSON.parse(text);}
        catch {return null;}
      };
      const [cache,catalog]=await Promise.all([read('repository-guides.json'),read('observation-catalog.json')]);
      if (cache?.version===1 && cache.entries && typeof cache.entries==='object' && !Array.isArray(cache.entries)) {
        for (const [key,entry] of Object.entries(cache.entries)) {
          if (key===entry.repository?.toLowerCase() && /^[\w.-]+\/[\w.-]+$/.test(key) && safeText(entry.summary) && /^[a-f0-9]{64}$/.test(entry.fingerprint || '') && date(entry.recorded_at)) this.cache.entries[key]=entry;
        }
      }
      if (catalog?.version===1 && Array.isArray(catalog.entries)) this.catalog={...catalog,entries:catalog.entries.filter(entry=>/^[\w.-]+\/[\w.-]+$/.test(entry.repository || '') && safeText(entry.summary))};
    })();
    await this.ready;
  }
  async persist(next) {
    await fs.mkdir(this.dataDir,{recursive:true});
    const file=path.join(this.dataDir,'repository-guides.json'),tmp=path.join(this.dataDir,'.repository-guides-'+randomUUID()+'.tmp');
    try {await fs.writeFile(tmp,JSON.stringify(next,null,2),{flag:'wx',mode:0o600}); await fs.rename(tmp,file);}
    finally {await fs.rm(tmp,{force:true}).catch(()=>{});}
  }
  async readmeGuides() {
    const entries=new Map(),dir=path.join(this.dataDir,'research','jobs');
    for (const name of (await fs.readdir(dir).catch(()=>[])).filter(name=>/^[0-9a-f-]{36}\.json$/i.test(name))) {
      try {
        const text=await fs.readFile(path.join(dir,name),'utf8'); if (text.length>20000) continue;
        const job=JSON.parse(text);
        if (job.status!=='done' || !safeText(job.report?.summary) || !date(job.source?.captured_at) || !/^[a-f0-9]{40}$/i.test(job.source?.sha || '')) continue;
        const key=job.repository.toLowerCase(),old=entries.get(key);
        if (!old || job.source.captured_at>old.recorded_at) entries.set(key,{summary:job.report.summary,basis:'readme',source_url:job.source.url,source_sha:job.source.sha,recorded_at:job.source.captured_at});
      } catch {}
    }
    return entries;
  }
  async decorate(feed) {
    await this.init();
    const output=structuredClone(feed),readmes=await this.readmeGuides();
    const catalog=new Map(this.catalog.entries.map(entry=>[entry.repository.toLowerCase(),entry]));
    for (const item of output.items || []) {
      const repository=repositoryName(item); if (!repository) continue;
      const key=repository.toLowerCase(),cached=this.cache.entries[key],observed=catalog.get(key),readme=readmes.get(key);
      const pushed=Date.parse(item.pushed_at || item.updated_at || '');
      const readmeFresh=readme && this.now().getTime()-Date.parse(readme.recorded_at)<14*86400000 && (!Number.isFinite(pushed) || pushed<=Date.parse(readme.recorded_at));
      let guide=readmeFresh ? readme : cached?.fingerprint===fingerprint((item.summary || '').slice(0,1000)) ? {
        summary:cached.summary,basis:'description',source_url:item.original_url,fingerprint:cached.fingerprint,recorded_at:cached.recorded_at
      } : observed ? {summary:observed.summary,example:observed.example || '',audience:observed.audience || '',basis:'observation',source_url:observed.source_url,recorded_at:this.catalog.imported_at} : null;
      if (guide) item.repository_guide={...guide,verification:'not_tested'};
      // Deriving a repo name also enables the existing README reader for trending items.
      item.repository_name=repository;
    }
    output.repository_guide_status={...this.state,missing:guideInputs(output).filter(input=>!output.items.some(item=>repositoryName(item)?.toLowerCase()===input.repository.toLowerCase() && item.repository_guide)).length};
    return output;
  }
  async status() {await this.init();return {...this.state};}
  start() {
    const admission=this.lock.then(()=>this.admit());
    this.lock=admission.catch(()=>{});
    return admission;
  }
  async admit() {
    await this.init();
    if (this.active) return this.status();
    const feed=await this.decorate(await this.feed.current());
    const already=new Set(feed.items.filter(item=>item.repository_guide).map(item=>repositoryName(item)?.toLowerCase()));
    const inputs=guideInputs(feed).filter(input=>!already.has(input.repository.toLowerCase())).slice(0,40);
    if (!inputs.length) {
      this.state={status:'done',message:'已有的项目介绍已复用，没有重复调用 AI。',completed:0,total:0};
      return this.status();
    }
    this.active=true;
    this.state={status:'working',message:'正在把作者简介整理成中文用途，页面仍可浏览。',completed:0,total:inputs.length};
    this.work=this.run(inputs).finally(()=>{this.active=false;});
    return this.status();
  }
  async run(inputs) {
    try {
      for (let offset=0;offset<inputs.length;offset+=20) {
        const batch=inputs.slice(offset,offset+20);
        const result=await this.runner({entries:batch.map(({repository,description})=>({repository,description}))});
        const entries=validateGuides(result.report,batch);
        const next=structuredClone(this.cache),recorded_at=this.now().toISOString();
        for (const entry of entries) next.entries[entry.repository.toLowerCase()]={...entry,recorded_at,model:result.model || null};
        await this.persist(next); this.cache=next;
        this.state.completed+=entries.length;
      }
      this.state={...this.state,status:'done',message:`已补齐 ${this.state.completed} 项中文用途。只是整理作者简介，尚未实测。`};
    } catch (failure) {
      this.state={...this.state,status:'failed',message:`本次整理未全部完成，已保留 ${this.state.completed} 项。`+(failure.status || /Codex|等待时间|额外工具/.test(failure.message || '') ? failure.message : '请稍后重试；原始内容仍可阅读。')};
    }
  }
}
