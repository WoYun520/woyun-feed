import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { REVIEW_ADMIN_POLL_MS, REVIEW_ADMIN_REFRESH_COPY, createReviewAdmin } from './src/reviewAdminPage.js';

const postUrl = 'https://x.com/example/status/2108148604447883999';
const signalNote = '文章卡·收藏5/点赞18·Levi样例·收藏偏低但类型优先';
const item = () => ({
  id:'kosx-1', url:postUrl, status:'pending', author_handle:'example',
  submitted_at:new Date().toISOString(), note:signalNote, text:'对照步骤把本地字幕跑通。',
});

const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','source','track','wbr']);

function parseAttrs(raw) {
  const attrs = {};
  const re = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = re.exec(raw))) attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  return attrs;
}

function createElement(tag, attrs = {}) {
  const node = {
    tagName:String(tag).toLowerCase(), attrs:{...attrs}, children:[], parent:null, listeners:{}, dataset:{},
    disabled:Object.prototype.hasOwnProperty.call(attrs, 'disabled'), checked:false, value:attrs.value || '',
  };
  for (const [key, value] of Object.entries(node.attrs)) {
    if (!key.startsWith('data-')) continue;
    const prop = key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    node.dataset[prop] = value;
  }
  node.getAttribute = name => Object.prototype.hasOwnProperty.call(node.attrs, name) ? node.attrs[name] : null;
  node.matches = selector => {
    const attr = /^\[([^\]=]+?)(?:="([^"]*)")?\]$/.exec(selector);
    if (!attr || !Object.prototype.hasOwnProperty.call(node.attrs, attr[1])) return false;
    return attr[2] === undefined || node.attrs[attr[1]] === attr[2];
  };
  node.closest = selector => {
    let current = node;
    while (current) {
      if (current.matches?.(selector)) return current;
      current = current.parent;
    }
    return null;
  };
  node.querySelectorAll = selector => {
    const found = [];
    const walk = current => {
      for (const child of current.children || []) {
        if (child.matches(selector)) found.push(child);
        walk(child);
      }
    };
    walk(node);
    return found;
  };
  node.querySelector = selector => node.querySelectorAll(selector)[0] || null;
  node.addEventListener = (type, fn) => { (node.listeners[type] ||= []).push(fn); };
  node.click = () => {
    if (node.disabled) return;
    for (const fn of node.listeners.click || []) fn({target:node, currentTarget:node});
  };
  return node;
}

function parseFragment(html) {
  const root = createElement('#fragment');
  const stack = [root];
  const re = /<\/([A-Za-z0-9]+)\s*>|<([A-Za-z0-9]+)([^>]*?)(\/?)>/g;
  let match;
  while ((match = re.exec(html))) {
    if (match[1]) {
      const tag = match[1].toLowerCase();
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index].tagName === tag) { stack.length = index; break; }
      }
      continue;
    }
    const tag = match[2].toLowerCase();
    const node = createElement(tag, parseAttrs(match[3] || ''));
    const parent = stack[stack.length - 1];
    node.parent = parent;
    parent.children.push(node);
    if (!match[4] && !VOID.has(tag)) stack.push(node);
  }
  return root.children;
}

function createRoot() {
  const root = createElement('div');
  let html = '';
  Object.defineProperty(root, 'innerHTML', {
    get() { return html; },
    set(value) {
      html = String(value);
      root.children = parseFragment(html);
      for (const child of root.children) child.parent = root;
    },
  });
  return root;
}

async function flush() {
  for (let step = 0; step < 8; step += 1) await Promise.resolve();
}

test('local review explains the refresh cadence and does not restore signal copy', async () => {
  assert.equal(REVIEW_ADMIN_POLL_MS, 30000);
  assert.match(REVIEW_ADMIN_REFRESH_COPY, /打开时拉一次待过审/);
  assert.match(REVIEW_ADMIN_REFRESH_COPY, /约每 30 秒自动更新/);
  assert.match(REVIEW_ADMIN_REFRESH_COPY, /也可以点刷新/);
  const html = await fs.readFile(new URL('./review-admin.html', import.meta.url), 'utf8');
  assert.match(html, /data-review-refresh/);
  assert.match(html, new RegExp(REVIEW_ADMIN_REFRESH_COPY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const calls = [];
  const root = createRoot();
  const page = createReviewAdmin({
    root,
    documentRef:{visibilityState:'visible'},
    fetchImpl:async (url, options = {}) => {
      calls.push({url:String(url), method:options.method || 'GET'});
      if (String(url).includes('/feedback')) return {ok:true, status:200, async json() { return {items:[], truncated:false}; }};
      return {ok:true, status:200, async json() { return {items:[item()]}; }};
    },
  });
  try {
  assert.equal(await page.start(), true);
  assert.deepEqual(calls, [
    {url:'/api/local-review/pending', method:'GET'},
    {url:'/api/local-review/archive?page=1', method:'GET'},
    {url:'/api/local-review/feedback', method:'GET'},
  ]);
  assert.match(root.innerHTML, /data-review-refresh>/);
  assert.match(root.innerHTML, /刷新/);
  assert.match(root.innerHTML, new RegExp(REVIEW_ADMIN_REFRESH_COPY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(root.innerHTML, /文章卡|收藏偏低|类型优先|互动尚低|Levi样例|review-queue-heat|收藏信号强/);
  const queueAt = root.innerHTML.indexOf('id="review-queue"');
  const archiveAt = root.innerHTML.indexOf('id="essence-archive-admin"');
  const feedbackAt = root.innerHTML.indexOf('id="visitor-feedback"');
  assert.ok(queueAt >= 0 && archiveAt > queueAt && feedbackAt > archiveAt);
  assert.match(root.innerHTML.slice(archiveAt, feedbackAt), /下架只从全部精华拿下/);
  assert.match(root.innerHTML.slice(archiveAt, feedbackAt), /全部精华里还没有帖/);
  assert.doesNotMatch(root.innerHTML.slice(queueAt, archiveAt), /意见反馈|visitor-feedback|data-feedback-read|下架/);
  assert.doesNotMatch(root.innerHTML.slice(archiveAt, feedbackAt), /data-feedback-read|data-review-decision|意见反馈/);
  assert.match(root.innerHTML.slice(feedbackAt), /现在没有意见反馈/);
  } finally {
    page.stop();
  }
});

test('visible polling and the refresh button reload pending and never decide while busy', async t => {
  t.mock.timers.enable({apis:['setInterval']});
  const calls = [];
  let releaseDecision = () => {};
  const documentRef = {visibilityState:'visible', hidden:false};
  const root = createRoot();
  const page = createReviewAdmin({
    root,
    documentRef,
    clearIntervalImpl() {},
    fetchImpl:async (url, options = {}) => {
      calls.push({url:String(url), method:options.method || 'GET'});
      if (String(url).includes('/decision')) {
        await new Promise(resolve => { releaseDecision = resolve; });
        return {ok:true, status:200, async json() { return {url:postUrl, status:'approved', key:'kosx-1'}; }};
      }
      if (String(url).includes('/feedback')) return {ok:true, status:200, async json() { return {items:[], truncated:false}; }};
      return {ok:true, status:200, async json() { return {items:[item()]}; }};
    },
  });
  t.after(() => page.stop());
  try {
    await page.start();
    assert.equal(calls.length, 3);
    t.mock.timers.tick(REVIEW_ADMIN_POLL_MS - 1);
    await flush();
    assert.equal(calls.length, 3);
    t.mock.timers.tick(1);
    await flush();
    assert.deepEqual(calls.map(call => call.url), [
      '/api/local-review/pending', '/api/local-review/archive?page=1', '/api/local-review/feedback',
      '/api/local-review/pending', '/api/local-review/archive?page=1', '/api/local-review/feedback',
    ]);
    documentRef.visibilityState = 'hidden';
    documentRef.hidden = true;
    t.mock.timers.tick(REVIEW_ADMIN_POLL_MS);
    await flush();
    assert.equal(calls.length, 6);
    assert.equal(await page.refresh({reason:'poll'}), false);
    documentRef.visibilityState = 'visible';
    documentRef.hidden = false;
    root.querySelector('[data-review-refresh]').click();
    await flush();
    assert.equal(calls.length, 9);
    assert.equal(calls.every(call => call.method === 'GET' && (call.url === '/api/local-review/pending' || call.url === '/api/local-review/archive?page=1' || call.url === '/api/local-review/feedback')), true);
    const approve = root.querySelector('[data-review-decision="approved"]');
    assert.ok(approve);
    approve.click();
    await flush();
    assert.equal(page.state.busy, true);
    assert.equal(calls.filter(call => call.url.includes('/decision')).length, 1);
    const during = calls.length;
    t.mock.timers.tick(REVIEW_ADMIN_POLL_MS);
    await flush();
    root.querySelector('[data-review-refresh]').click();
    assert.equal(await page.refresh({reason:'manual'}), false);
    assert.equal(await page.refresh({reason:'poll'}), false);
    assert.equal(calls.length, during);
    releaseDecision();
    await flush();
    assert.equal(page.state.busy, false);
    assert.equal(calls.filter(call => call.method === 'POST').length, 1);
    t.mock.timers.tick(REVIEW_ADMIN_POLL_MS);
    await flush();
    assert.equal(calls.at(-3).url, '/api/local-review/pending');
    assert.equal(calls.at(-2).url, '/api/local-review/archive?page=1');
    assert.equal(calls.at(-1).url, '/api/local-review/feedback');
    assert.equal(calls.at(-1).method, 'GET');
    assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  } finally {
    t.mock.timers.reset();
  }
});

test('visitor feedback stays in its own section and can be marked read without deciding a link', async () => {
  const feedbackId = '11111111-1111-4111-8111-111111111111';
  const calls = [];
  const root = createRoot();
  const page = createReviewAdmin({
    root,
    documentRef:{visibilityState:'visible'},
    fetchImpl:async (url, options = {}) => {
      calls.push({url:String(url), method:options.method || 'GET', body:options.body || ''});
      if (String(url).endsWith('/feedback/read')) {
        return {ok:true, status:200, async json() { return {id:feedbackId, created_at:'2026-10-17T02:30:00.000Z', text:'首页有点挤', contact:'@levi', user_agent:'', read:true}; }};
      }
      if (String(url).endsWith('/feedback')) {
        return {ok:true, status:200, async json() { return {items:[{id:feedbackId, created_at:'2026-10-17T02:30:00.000Z', text:'首页有点挤', contact:'@levi', read:false}], truncated:false}; }};
      }
      return {ok:true, status:200, async json() { return {items:[item()]}; }};
    },
  });
  try {
    await page.start();
    const queueAt = root.innerHTML.indexOf('id="review-queue"');
    const archiveAt = root.innerHTML.indexOf('id="essence-archive-admin"');
    const feedbackAt = root.innerHTML.indexOf('id="visitor-feedback"');
    assert.ok(archiveAt > queueAt && feedbackAt > archiveAt);
    assert.match(root.innerHTML.slice(feedbackAt), /首页有点挤/);
    assert.match(root.innerHTML.slice(feedbackAt), /联系：@levi/);
    assert.match(root.innerHTML.slice(feedbackAt), /data-feedback-read="11111111-1111-4111-8111-111111111111"/);
    assert.doesNotMatch(root.innerHTML.slice(queueAt, feedbackAt), /首页有点挤|data-feedback-read/);
    assert.match(root.innerHTML.slice(queueAt, archiveAt), /data-review-decision="approved"/);
    root.querySelector('[data-feedback-read]').click();
    await flush();
    assert.equal(calls.filter(call => call.url.endsWith('/feedback/read')).length, 1);
    assert.equal(calls.filter(call => call.url.includes('/decision')).length, 0);
    assert.equal(JSON.parse(calls.find(call => call.url.endsWith('/feedback/read')).body).id, feedbackId);
    assert.match(root.innerHTML, /已标为已读/);
    assert.match(root.innerHTML, /已读/);
    assert.equal(root.querySelector('[data-feedback-read]'), null);
    assert.equal(page.state.items[0].url, postUrl);
    assert.equal(page.state.items[0].status, 'pending');
  } finally {
    page.stop();
  }
});

test('下架 only posts the archive flag and leaves the pending decision route alone', async () => {
  const calls = [];
  const root = createRoot();
  const archiveItem = {
    id:'188102', title:'要下架的精华', excerpt:'摘录', url:postUrl,
    published_at:'2026-10-01T00:00:00.000Z', approved_at:'2026-10-04T00:00:00.000Z',
    author:'@example', source:'KOSX 过审', cover_url:'', cover_kind:'', pool:false,
    removed:false, removed_at:'',
  };
  const page = createReviewAdmin({
    root,
    documentRef:{visibilityState:'visible'},
    fetchImpl:async (url, options = {}) => {
      calls.push({url:String(url), method:options.method || 'GET', body:options.body || ''});
      if (String(url) === '/api/local-review/archive' && options.method === 'POST') {
        return {ok:true, status:200, async json() { return {...archiveItem, removed:true, removed_at:'2026-10-17T01:00:00.000Z'}; }};
      }
      if (String(url).includes('/archive')) return {ok:true, status:200, async json() { return {page:1, page_size:24, total:1, pages:1, items:[archiveItem]}; }};
      if (String(url).includes('/feedback')) return {ok:true, status:200, async json() { return {items:[], truncated:false}; }};
      return {ok:true, status:200, async json() { return {items:[item()]}; }};
    },
  });
  try {
    await page.start();
    const archiveAt = root.innerHTML.indexOf('id="essence-archive-admin"');
    const feedbackAt = root.innerHTML.indexOf('id="visitor-feedback"');
    assert.match(root.innerHTML.slice(archiveAt, feedbackAt), /data-archive-remove="/);
    assert.match(root.innerHTML.slice(archiveAt, feedbackAt), />下架</);
    assert.match(root.innerHTML.slice(archiveAt, feedbackAt), /不会回到待过审/);
    assert.doesNotMatch(root.innerHTML.slice(archiveAt, feedbackAt), /data-review-decision|data-feedback-read/);
    root.querySelector('[data-archive-remove]').click();
    await flush();
    const posted = calls.find(call => call.method === 'POST');
    assert.equal(posted.url, '/api/local-review/archive');
    assert.deepEqual(JSON.parse(posted.body), {url:postUrl, removed:true});
    assert.equal(calls.some(call => String(call.url).includes('/decision')), false);
    assert.match(root.innerHTML, /已从全部精华下架/);
    assert.match(root.innerHTML, /data-archive-restore="/);
    assert.match(root.innerHTML, />恢复</);
    assert.equal(page.state.items[0].status, 'pending');
  } finally {
    page.stop();
  }
});
