import { DOT_IMPORT_MAX_BYTES, parseDotCandidates } from './dotCandidates.js';

// The reader code is deliberately outside feed state, cache, backups and exports.
export const DOT_INBOX_STORAGE_KEY = 'personal-feed:dot-inbox:v1';
export const DOT_INBOX_SEEN_LIMIT = 1000;
export const DOT_INBOX_PAGE_LIMIT = 20;
export const DOT_INBOX_IMPORT_LIMIT = 20;
const INBOX_PATH = '/api/dot/inbox';
const codeValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(value);
const batchIdValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const cursorValid = value => value === null || (typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(value));
const isoValid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const messages = {
  format: '投递箱返回的内容不完整，本地资料没有被覆盖。请稍后重试。',
  unauthorized: '接收码无效或已更换。请断开连接后，使用新的接收码连接。',
  network: '暂时无法连接投递箱。当前材料保留，稍后会重试。',
  import: '这批材料尚未保存到浏览器，已保留在投递箱。请检查本地存储与材料格式后重试。',
  storage: '连接设置未能保存，请检查浏览器存储权限后重试。已经保存的材料保留。',
  changed: '连接设置已在其他页面更改。本次接收已停止，材料仍在投递箱。',
};
const fail = kind => { throw Error(messages[kind] || messages.format); };

function validateConfig(value) {
  if (!plain(value) || Object.keys(value).some(key => !['version','review_code','seen_batch_ids','last_synced_at','scan_cursor'].includes(key)) || value.version !== 1 || !codeValid(value.review_code)
    || !Array.isArray(value.seen_batch_ids) || value.seen_batch_ids.length > DOT_INBOX_SEEN_LIMIT || value.seen_batch_ids.some(id => !batchIdValid(id))
    || new Set(value.seen_batch_ids).size !== value.seen_batch_ids.length || !cursorValid(value.scan_cursor) || (value.last_synced_at !== null && !isoValid(value.last_synced_at))) throw Error('invalid');
  return structuredClone(value);
}

function validateList(value) {
  if (!plain(value) || !Array.isArray(value.batches) || value.batches.length > 50 || !cursorValid(value.next_cursor)) fail('format');
  const ids = new Set();
  for (const batch of value.batches) {
    if (!plain(batch) || !batchIdValid(batch.id) || ids.has(batch.id) || !isoValid(batch.received_at) || !isoValid(batch.collected_at)
      || !Number.isSafeInteger(batch.item_count) || batch.item_count < 0 || batch.item_count > 100 || typeof batch.collector !== 'string' || !batch.collector.trim() || batch.collector.length > 80) fail('format');
    ids.add(batch.id);
  }
  return value;
}

async function readBoundedJson(response) {
  if (!/application\/json\b/i.test(response.headers?.get('content-type') || '')) fail('format');
  const length = response.headers?.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > DOT_IMPORT_MAX_BYTES + 4096)) fail('format');
  let raw;
  if (response.body?.getReader) {
    const reader = response.body.getReader(), parts = []; let size = 0;
    try {
      while (true) {
        const {value, done} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > DOT_IMPORT_MAX_BYTES + 4096) { await reader.cancel(); fail('format'); }
        parts.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
      raw = new TextDecoder('utf-8', {fatal:true}).decode(bytes);
    } finally { reader.releaseLock(); }
  } else {
    raw = await response.text();
    if (new TextEncoder().encode(raw).length > DOT_IMPORT_MAX_BYTES + 4096) fail('format');
  }
  try { return JSON.parse(raw); } catch { fail('format'); }
}

export class DotInboxClient {
  constructor({storage, fetcher = globalThis.fetch, now = () => new Date().toISOString(), timeoutMs = 10000} = {}) {
    try {this.storage = storage ?? globalThis.localStorage;} catch {this.storage = null;}
    this.fetcher = fetcher; this.now = now; this.timeoutMs = Number.isFinite(timeoutMs) ? Math.min(Math.max(timeoutMs, 1), 10000) : 10000;
    this.config = null; this.warning = ''; this.active = null; this.generation = 0; this.controllers = new Set();
    this.reload();
  }

  reload() {
    try {
      const raw = this.storage.getItem(DOT_INBOX_STORAGE_KEY);
      this.config = raw ? validateConfig(JSON.parse(raw)) : null;
      this.warning = '';
    } catch {
      this.config = null;
      this.warning = '连接设置无法读取，已暂停自动接收。请先清除连接设置，再重新连接；已保存的材料不受影响。';
    }
    return this.getState();
  }

  getState() {
    // Never return a code through a UI-facing state object.
    return {connected:!!this.config, lastSyncedAt:this.config?.last_synced_at || null, warning:this.warning};
  }

  save(config) {
    try { this.storage.setItem(DOT_INBOX_STORAGE_KEY, JSON.stringify(validateConfig(config))); }
    catch { fail('storage'); }
    this.config = config;
  }

  async request(path, code) {
    const controller = new AbortController(); this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // Native browser fetch is a Window method. Calling the saved function as
      // this.fetcher would bind it to this client and fail in embedded browsers.
      const response = await this.fetcher.call(globalThis, path, {method:'GET', headers:{Authorization:`Bearer ${code}`, Accept:'application/json'}, credentials:'omit', cache:'no-store', redirect:'error', signal:controller.signal});
      if (response.status === 401 || response.status === 403) fail('unauthorized');
      if (!response.ok) fail('network');
      return await readBoundedJson(response);
    } catch (error) {
      if (Object.values(messages).includes(error?.message)) throw error;
      fail('network');
    } finally { clearTimeout(timer); this.controllers.delete(controller); }
  }

  async connect(code) {
    if (this.warning) throw Error('请先清除无法读取的连接设置，再重新连接。');
    if (!codeValid(code)) throw Error('请粘贴完整的接收码，不添加 Bearer、空格或网址。');
    const generation = ++this.generation;
    validateList(await this.request(INBOX_PATH, code));
    if (generation !== this.generation) fail('changed');
    const previous = this.config?.review_code === code ? this.config : null;
    this.save({version:1,review_code:code,seen_batch_ids:previous?.seen_batch_ids || [],last_synced_at:previous?.last_synced_at || null,scan_cursor:previous?.scan_cursor || null});
    return this.getState();
  }

  disconnect() {
    ++this.generation;
    for (const controller of this.controllers) controller.abort();
    try { this.storage.removeItem(DOT_INBOX_STORAGE_KEY); } catch { fail('storage'); }
    this.config = null; this.warning = '';
    return this.getState();
  }

  assertConnection(code, generation) {
    if (generation !== this.generation) fail('changed');
    let current; try { current = validateConfig(JSON.parse(this.storage.getItem(DOT_INBOX_STORAGE_KEY))); } catch { fail('changed'); }
    if (current.review_code !== code) fail('changed');
    this.config = current;
  }

  sync(importBatch) {
    if (this.active) return this.active;
    this.reload();
    if (!this.config) return Promise.resolve({disconnected:true,added:0,duplicates:0,existing:0,batches:0});
    const operation = this.runSync(importBatch);
    this.active = operation.finally(() => { if (this.active === wrapped) this.active = null; });
    const wrapped = this.active;
    return wrapped;
  }

  async runSync(importBatch) {
    const code = this.config.review_code, generation = this.generation;
    const result = {added:0,duplicates:0,existing:0,batches:0,skipped:0};
    // Continuation is temporary, not a time watermark: after a complete scan we
    // return to the first page so late-visible KV writes are discovered too.
    let cursor = this.config.scan_cursor;
    const cursors = new Set(cursor ? [cursor] : []), batchIds = new Set();
    for (let page = 0; page < DOT_INBOX_PAGE_LIMIT; page++) {
      this.assertConnection(code, generation);
      let list;
      try { list=validateList(await this.request(INBOX_PATH + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''), code)); }
      catch(error) {
        // KV cursors can become invalid as old batches expire. A failed scan
        // restarts from page one next time; acknowledged batch IDs stay intact.
        if(cursor) {this.assertConnection(code,generation);this.save({...this.config,scan_cursor:null});}
        throw error;
      }
      this.assertConnection(code, generation);
      for (const batch of list.batches) {
        if (batchIds.has(batch.id)) fail('format');
        batchIds.add(batch.id);
        if (this.config.seen_batch_ids.includes(batch.id)) { result.skipped++; continue; }
        if (result.batches >= DOT_INBOX_IMPORT_LIMIT) {
          return {...result,checked_at:this.config.last_synced_at,more:true};
        }
        const entry = await this.request(`${INBOX_PATH}/${batch.id}`, code);
        this.assertConnection(code, generation);
        if (!plain(entry) || entry.id !== batch.id || entry.received_at !== batch.received_at || !plain(entry.payload)) fail('format');
        let raw, parsed;
        try { raw = JSON.stringify(entry.payload); parsed = parseDotCandidates(raw); } catch { fail('format'); }
        if (parsed.total !== batch.item_count || parsed.collector !== batch.collector || parsed.collected_at !== batch.collected_at) fail('format');
        let imported;
        try { imported = await importBatch(raw); } catch { fail('import'); }
        this.assertConnection(code, generation);
        if (!plain(imported) || ['added','duplicates','existing'].some(field => !Number.isSafeInteger(imported[field]) || imported[field] < 0)) fail('import');
        // Only a successful local import transaction may acknowledge this batch.
        this.save({...this.config,seen_batch_ids:[...this.config.seen_batch_ids,batch.id].slice(-DOT_INBOX_SEEN_LIMIT)});
        for (const field of ['added','duplicates','existing']) result[field] += imported[field];
        result.batches++;
      }
      if (list.next_cursor === null) {
        this.assertConnection(code, generation);
        const checkedAt = this.now();
        this.save({...this.config,last_synced_at:checkedAt,scan_cursor:null});
        return {...result,checked_at:checkedAt};
      }
      if (cursors.has(list.next_cursor)) fail('format');
      cursors.add(list.next_cursor); cursor = list.next_cursor;
      this.save({...this.config,scan_cursor:cursor});
    }
    return {...result,checked_at:this.config.last_synced_at,more:true};
  }
}
