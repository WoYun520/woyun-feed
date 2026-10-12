import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runCodexReader } from './codex-reader.js';
import { repositoryName } from './src/repositoryGuide.js';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE = ['reading', 'analyzing'];
export const researchError = (message, status = 400) => Object.assign(new Error(message), { status });

export function validateReport(report) {
  const fields = ['summary', 'who_for', 'cost_and_limits', 'next_step'];
  if (!report || fields.some(key => typeof report[key] !== 'string' || !report[key].trim() || report[key].length > 2000)) throw researchError('整理结果不完整，请重试。', 502);
  for (const key of ['can_do', 'first_steps', 'unknowns']) {
    if (!Array.isArray(report[key]) || !report[key].length || report[key].length > 8 || report[key].some(value => typeof value !== 'string' || !value.trim() || value.length > 2000)) throw researchError('整理结果不完整，请重试。', 502);
  }
  return Object.fromEntries([...fields, 'can_do', 'first_steps', 'unknowns'].map(key => [key, report[key]]));
}

export async function readGithubReadme(repository, fetchImpl = fetch) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw researchError('项目地址不符合要求。');
  const endpoint = `https://api.github.com/repos/${repository}/readme`;
  const response = await fetchImpl(endpoint, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'PersonalFeed-local', 'X-GitHub-Api-Version': '2022-11-28' } });
  if (!response.ok) throw researchError(response.status === 404 ? '没有找到可读取的 README，请打开原文查看。' : response.status === 403 || response.status === 429 ? 'GitHub 暂时限制读取，请稍后再试。' : '这次没有读到项目说明，请稍后再试。', 502);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length; chunks.push(Buffer.from(chunk));
    if (size > 1_500_000) throw researchError('项目说明太大，本轮暂不处理。', 502);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); 
  if (body.encoding !== 'base64' || typeof body.content !== 'string' || !/^[a-f0-9]{40}$/i.test(body.sha || '')) throw researchError('项目说明格式不完整，请打开原文查看。', 502);
  const raw = Buffer.from(body.content.replace(/\s/g, ''), 'base64').toString('utf8');
  if (!raw.trim()) throw researchError('项目说明为空，请打开原文查看。', 502);
  return { repository, url: `https://github.com/${repository}#readme`, api_url: endpoint,
    path: String(body.path || 'README').slice(0, 500), sha: body.sha, captured_at: new Date().toISOString(),
    text: raw.slice(0, 28000), original_characters: raw.length, truncated: raw.length > 28000 };
}

export class ResearchService {
  constructor({ dataDir, feed, fetchImpl = fetch, runner = runCodexReader }) {
    Object.assign(this, { dataDir, feed, fetchImpl, runner });
    this.jobs = new Map(); this.active = null; this.ready = null; this.lock = Promise.resolve();
  }
  async init() {
    if (!this.ready) this.ready = (async () => {
      await fs.mkdir(path.join(this.dataDir, 'research', 'jobs'), { recursive: true });
      for (const name of await fs.readdir(path.join(this.dataDir, 'research', 'jobs'))) {
        if (!ID.test(name.replace(/\.json$/, ''))) continue;
        try {
          const job = JSON.parse(await fs.readFile(path.join(this.dataDir, 'research', 'jobs', name), 'utf8'));
          if (job.id + '.json' !== name) continue;
          if (ACTIVE.includes(job.status)) {
            job.status = 'failed'; job.error = '本机服务曾中断，上次整理未完成。可以手动重试，不会自动重复消耗额度。';
            job.updated_at = new Date().toISOString(); await this.save(job);
          }
          this.jobs.set(job.id, job);
        } catch {}
      }
    })();
    return this.ready;
  }
  async save(job) {
    const dir = path.join(this.dataDir, 'research', 'jobs');
    const tmp = path.join(dir, `.${randomUUID()}.tmp`);
    try { await fs.writeFile(tmp, JSON.stringify(job, null, 2), { mode: 0o600, flag: 'wx' }); await fs.rename(tmp, path.join(dir, `${job.id}.json`)); }
    finally { await fs.rm(tmp, { force: true }).catch(() => {}); }
  }
  async findItem(id) {
    const feed = await this.feed.current();
    const current = feed.items.find(item => item.id === id);
    if (current) return {...current,repository_name:repositoryName(current) || current.repository_name};
    // Previously saved projects may no longer be in the latest batch.
    const dir = path.join(this.dataDir, 'source-snapshots');
    for (const name of (await fs.readdir(dir).catch(() => [])).filter(name => /^github-.*\.json$/.test(name)).sort().reverse()) {
      try {
        const snapshot = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
        const repo = snapshot.items.find(repo => `github-${repo.id}` === id);
        if (repo && /^[\w.-]+\/[\w.-]+$/.test(repo.full_name)) return { id, repository_name: repo.full_name, title: repo.full_name };
      } catch {}
    }
    return null;
  }
  start(input) {
    // Serialize admission to prevent double clicks from launching multiple paid requests.
    const result = this.lock.then(() => this.admit(input));
    this.lock = result.catch(() => {});
    return result;
  }
  async admit(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw researchError('请求格式不正确。');
    const { request_id, item_id, question } = input;
    await this.init();
    if (!ID.test(request_id || '') || !/^(?:github-\d+|news-[a-f0-9]{24})$/.test(item_id || '') || typeof question !== 'string' || !question.trim() || question.length > 2000) throw researchError('请选择真实项目，并填写不超过 2000 字的问题。');
    if (/-----BEGIN .*PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,})|(?:密码|password|api[_ -]?key|token)\s*[:=：]\s*\S+/i.test(question)) throw researchError('问题中可能包含凭据，请删除密码或密钥后再整理。');
    const existing = this.jobs.get(request_id);
    if (existing) {
      if (existing.item_id !== item_id || existing.question !== question.trim()) throw researchError('这次请求对应的问题已变更，请新建一次整理。', 409);
      return this.publicJob(existing);
    }
    if (this.active) throw researchError('还有一项整理在进行，请完成后再开始下一项。', 409);
    const item = await this.findItem(item_id);
    if (!item || !/^[\w.-]+\/[\w.-]+$/.test(item.repository_name || '')) throw researchError('本机资料中没有找到这个项目，请更新候选后重试。', 404);
    const now = new Date().toISOString();
    const job = { id: request_id, item_id, repository: item.repository_name, question: question.trim(), status: 'reading', created_at: now, updated_at: now, engine: 'Codex', model: null, source: null, report: null, error: null };
    await this.save(job); this.jobs.set(job.id, job); this.active = job.id;
    this.work = this.run(job).finally(() => { this.active = null; });
    return this.publicJob(job);
  }
  publicJob(job) { return structuredClone(job); }
  async get(id) {
    if (!ID.test(id)) throw researchError('记录编号无效。');
    await this.init();
    if (!this.jobs.has(id)) throw researchError('暂时没有找到这份整理记录。', 404);
    return this.publicJob(this.jobs.get(id));
  }
  async run(job) {
    try {
      const source = await readGithubReadme(job.repository, this.fetchImpl);
      const sourceDir = path.join(this.dataDir, 'research', 'sources');
      await fs.mkdir(sourceDir, { recursive: true });
      await fs.writeFile(path.join(sourceDir, `${job.id}.json`), JSON.stringify(source, null, 2), { flag: 'wx', mode: 0o600 });
      const { text, ...metadata } = source;
      job.source = metadata; job.status = 'analyzing'; job.updated_at = new Date().toISOString(); await this.save(job);
      const result = await this.runner({ source, question: job.question });
      const finished = { ...job, report: validateReport(result.report), model: result.model || null, status: 'done', updated_at: new Date().toISOString() };
      await this.save(finished); Object.assign(job, finished);
    } catch (error) {
      job.status = 'failed'; job.report = null; job.updated_at = new Date().toISOString();
      job.error = ['EACCES', 'ENOSPC', 'EROFS', 'EPERM'].includes(error.code) ? '本机未能保存整理，请检查空间或目录权限。'
        : error.name === 'TimeoutError' || error.name === 'AbortError' ? '读取项目说明超时，请稍后再试。'
        : error instanceof SyntaxError ? '整理结果或来源格式异常，未标记为完成。'
        : error.message || '本次整理失败，请稍后再试。';
      await this.save(job).catch(() => {});
    }
  }
}
