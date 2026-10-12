import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const SOURCE = { id: 'github', name: 'GitHub', home_url: 'https://github.com/topics/productivity', kind: 'repository' };
const PROFILE = { interests: '普通人能用的 AI 工具、自动化方法、可以亲自验证的教程选题', exclude: '融资新闻、模型跑分、没有证据的收入故事', language: 'zh-CN' };
import { normalizeRepositories } from './repository-normalize.js';
import { createSourceFetch } from './source-retry.js';
export { normalizeRepositories } from './repository-normalize.js';
const DAY = 86400000;

function initialFeed() {
  return { schema_version: '0.2', mode: 'live', generated_at: null, profile: PROFILE,
    sources: [{ ...SOURCE, status: 'not_connected', last_success_at: null, message: '点击更新，获取公开的效率工具项目' }],
    items: [], sections: { daily: [], discover: [] }, followups: [],
    refresh: { status: 'idle', last_attempt_at: null, next_allowed_at: null, new_count: 0, message: '还没有获取真实内容。点击“更新内容”开始。' },
  };
}

export class FeedService {
  constructor({ dataDir, fetchImpl = fetch, now = () => new Date(), cooldownMs = 300000, timeoutMs = 12000, retryDelayMs = 200 }) {
    Object.assign(this, { dataDir, fetchImpl, now, cooldownMs, timeoutMs, retryDelayMs });
    this.inflight = null;
    this.feed = null;
    this.loadPromise = null;
  }

  async current() {
    if (!this.loadPromise) this.loadPromise = (async () => {
      try {
        const saved = JSON.parse(await fs.readFile(path.join(this.dataDir, 'live-feed.json'), 'utf8'));
        if (saved.mode !== 'live' || !Array.isArray(saved.items) || !saved.refresh || !saved.sections || !Array.isArray(saved.sources)) throw new Error('Invalid cache');
        this.feed = saved;
      } catch (error) {
        this.feed = initialFeed();
        if (error.code !== 'ENOENT') {
          this.feed.refresh.message = '本机缓存暂时无法读取，请重试更新。原文件未删除。';
        }
      }
    })();
    await this.loadPromise;
    return structuredClone(this.feed);
  }

  async writeFeed(feed) {
    await fs.mkdir(this.dataDir, { recursive: true });
    const temp = path.join(this.dataDir, `.live-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temp, JSON.stringify(feed, null, 2), { flag: 'wx', mode: 0o600 });
      await fs.rename(temp, path.join(this.dataDir, 'live-feed.json'));
    } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
  }

  async refresh() {
    await this.current();
    if (this.inflight) return this.inflight;
    const wait = Date.parse(this.feed.refresh.next_allowed_at || '') - this.now().getTime();
    if (wait > 0) return { ...structuredClone(this.feed), update_notice: `刚检查过，请约 ${Math.max(1, Math.ceil(wait / 60000))} 分钟后再更新。现有内容可以继续使用。` };
    this.inflight = this.update().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  async update() {
    const attemptedAt = this.now().toISOString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const fetchSource = createSourceFetch(this.fetchImpl, {deadline: Date.now() + this.timeoutMs,
      attemptTimeoutMs: this.timeoutMs, retryDelayMs: this.retryDelayMs});
    let nextAllowed = new Date(this.now().getTime() + 30000).toISOString();
    let message = '暂时连不上 GitHub，请稍后再试。';
    try {
      const since = new Date(this.now().getTime() - 180 * DAY).toISOString().slice(0, 10);
      const query = `topic:productivity stars:100..5000 archived:false fork:false pushed:>=${since}`;
      const url = new URL('https://api.github.com/search/repositories');
      url.search = new URLSearchParams({ q: query, sort: 'updated', order: 'desc', per_page: '30' }).toString();
      const response = await fetchSource(url, { signal: controller.signal, redirect: 'error', headers: {
        Accept: 'application/vnd.github+json', 'User-Agent': 'PersonalFeed-local', 'X-GitHub-Api-Version': '2022-11-28',
      } });
      if (!response.ok) {
        if (response.status === 403 || response.status === 429) {
          const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
          const retry = Number(response.headers.get('retry-after')) * 1000;
          nextAllowed = new Date(Math.max(this.now().getTime() + 60000, Math.min(reset || 0, this.now().getTime() + 3600000), this.now().getTime() + Math.min(retry || 0, 3600000))).toISOString();
          message = 'GitHub 暂时限制了请求次数，请稍后再更新。';
        }
        throw new Error(`upstream ${response.status}`);
      }
      const body = await response.json();
      if (!Array.isArray(body.items)) { message = 'GitHub 返回的内容不完整，请稍后重试。'; throw new Error('Invalid upstream'); }
      // Incomplete search must never replace a previous successful cache.
      if (body.incomplete_results) { message = '这次搜索没有完整返回，暂时保留上次内容。'; throw new Error('Incomplete upstream'); }
      const capturedAt = this.now().toISOString();
      const snapshotId = `github-${capturedAt.replace(/[:.]/g, '-')}-${randomUUID()}`;
      const items = normalizeRepositories(body.items.slice(0, 30), capturedAt, snapshotId);
      if (body.items.length && !items.length) { message = '返回的项目资料无法使用，暂时保留上次内容。'; throw new Error('No valid items'); }
      const daily = items.slice(0, 5).map(item => item.id);
      const rest = items.filter(item => !daily.includes(item.id));
      const discover = [...rest.filter(item => item.stars <= 1000), ...rest.filter(item => item.stars > 1000)].slice(0, 2).map(item => item.id);
      const previous = new Set(this.feed.items.map(item => item.id));
      const newCount = items.filter(item => !previous.has(item.id)).length;
      const refreshed = {
        ...initialFeed(), generated_at: capturedAt, items, sections: { daily, discover },
        sources: [{ ...SOURCE, status: 'ok', last_success_at: capturedAt, message: `已读取 ${items.length} 个候选项目` }],
        refresh: { status: 'ok', last_attempt_at: attemptedAt, next_allowed_at: new Date(this.now().getTime() + this.cooldownMs).toISOString(), new_count: newCount,
          message: items.length ? `已更新 ${items.length} 个候选，${newCount ? `新增 ${newCount} 个` : '没有新增项目'}；首页展示 ${daily.length + discover.length} 条。` : '本次没有找到符合条件的项目；已有收藏和跟进仍保留。' },
      };
      const snapshotDir = path.join(this.dataDir, 'source-snapshots');
      await fs.mkdir(snapshotDir, { recursive: true });
      // Store a minimal, immutable source extract; no credentials or user preferences are sent upstream.
      const sourceItems = body.items.slice(0, 30).map(repo => Object.fromEntries(['id', 'full_name', 'description', 'topics', 'stargazers_count', 'created_at', 'pushed_at', 'archived', 'fork'].map(key => [key, repo[key]])));
      await fs.writeFile(path.join(snapshotDir, `${snapshotId}.json`), JSON.stringify({ source_url: String(url), captured_at: capturedAt, items: sourceItems }, null, 2), { flag: 'wx', mode: 0o600 });
      await this.writeFeed(refreshed);
      this.feed = refreshed;
    } catch (error) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') message = 'GitHub 响应较慢，本次更新已停止，请稍后再试。';
      if (error.message === 'oversize') message = 'GitHub 返回的资料过大，本次未采用。';
      if (['EACCES', 'EPERM', 'ENOSPC', 'EROFS'].includes(error.code)) message = '本机无法保存更新结果，请检查磁盘空间或目录权限后重试。';
      this.feed = { ...this.feed,
        sources: [{ ...SOURCE, status: 'failed', last_success_at: this.feed.generated_at, message }],
        refresh: { status: 'failed', last_attempt_at: attemptedAt, next_allowed_at: nextAllowed, new_count: 0,
          message: `${message}${this.feed.generated_at ? ' 下面保留上次成功获取的内容。' : ' 尚未获取到真实内容。'}` },
      };
      // A write failure must not erase the last successful disk cache.
      await this.writeFeed(this.feed).catch(() => {});
    } finally { clearTimeout(timer); }
    return structuredClone(this.feed);
  }
}
