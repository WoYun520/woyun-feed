import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../worker.js';
import { ESSENCE_ARCHIVE_CAP, ESSENCE_ARCHIVE_KEY, ESSENCE_ARCHIVE_PAGE_SIZE, ESSENCE_ARCHIVE_PATH, essenceArchiveFromFeed, mergeEssenceArchive, normalizeEssenceArchive, setEssenceArchiveRemoved } from './essence-archive.js';
import { handleEssenceArchiveRequest, rememberEssenceArchive } from './essence-archive-service.js';
import { dotInboxHash } from '../dot-inbox-service.js';
import { PUBLIC_FEED_KEY } from './cloud-feed-service.js';
import { HOME_KEPT_BOOKMARK_MIN, HOME_LATEST_LIMIT, HOME_LATEST_WINDOW_DAYS, HOME_UNDERSTATED_LIMIT, HOME_WEEK_BOOKMARK_MIN, selectHomeShowcase } from './src/homeShowcase.js';
import { renderHomeShowcase } from './src/homeShowcaseView.js';
import { renderWorkspaceNavigation } from './src/workspaceShell.js';
import { renderEssenceArchive } from './src/essenceArchiveView.js';
import { PUBLIC_FILES } from './public-build.mjs';

const source = {id:'sopilot-all', name:'SoPilot · 综合推文榜', group:'posts', link_kind:'post', status:'ok', enabled:true};
const kosx = {id:'sopilot-kosx', name:'KOSX 过审', group:'posts', link_kind:'post', status:'ok', enabled:true};
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const app = {homeView:'latest', escapeHtml:escape, safeUrl:value => value, formatTime:value => value};

function post(id, published, extra = {}) {
  const item = {
    id, title:extra.title || `公开帖 ${id}`, summary:extra.summary ?? `这是来源摘录 ${id}，尚未核对。`,
    source_refs:extra.source_refs || ['sopilot-kosx'], link_kind:'post', origin:extra.origin || 'kosx_approved',
    content_status:'excerpt_only',
    original_url:extra.url || `https://x.com/example/status/${id}`,
    canonical_url:extra.url || `https://x.com/example/status/${id}`,
    published_at:published,
    captured_at:extra.captured_at || published,
    ...(extra.author_handle ? {author_handle:extra.author_handle, author_name:extra.author_name || extra.author_handle} : {}),
    ...(extra.review_type ? {review_type:extra.review_type} : {}),
    ...(extra.has_article !== undefined ? {has_article:extra.has_article} : {}),
    ...(extra.cover_url !== undefined ? {cover_url:extra.cover_url} : {}),
    ...(extra.bookmark_count !== undefined ? {bookmark_count:extra.bookmark_count} : {}),
    ...(extra.image ? {post_image:extra.image} : {}),
    ...(extra.created_at ? {created_at:extra.created_at} : {}),
  };
  if (extra.source_item_time !== undefined) item.source_item_time = extra.source_item_time;
  else if (extra.omitApproval !== true) item.source_item_time = published;
  return item;
}

function feed(items) {
  return {generated_at:'2026-10-10T13:01:27.954Z', sources:[source, kosx], items};
}

test('全部精华 pages the essence line by approval time and leaves the homepage rails alone', () => {
  assert.equal(ESSENCE_ARCHIVE_PAGE_SIZE, 24);
  assert.ok(ESSENCE_ARCHIVE_PAGE_SIZE >= 20 && ESSENCE_ARCHIVE_PAGE_SIZE <= 30);
  assert.equal(HOME_LATEST_WINDOW_DAYS, 30);
  assert.equal(HOME_LATEST_LIMIT, 18);
  assert.equal(HOME_WEEK_BOOKMARK_MIN, 200);
  assert.equal(HOME_KEPT_BOOKMARK_MIN, 1000);
  assert.equal(HOME_UNDERSTATED_LIMIT, 2);

  const recentApproval = post('188001', '2026-08-01T00:00:00.000Z', {
    title:'刚过审的旧原帖', source_item_time:'2026-10-12T00:00:00.000Z', author_handle:'old_author',
  });
  const olderApproval = post('188002', '2026-10-14T00:00:00.000Z', {
    title:'原帖较新但过审更早', source_item_time:'2026-10-01T00:00:00.000Z',
  });
  const noApprovalLater = post('188003', '2026-10-13T00:00:00.000Z', {
    title:'没有过审时间的较新原帖', omitApproval:true,
  });
  const noApprovalEarlier = post('188004', '2026-10-05T00:00:00.000Z', {
    title:'没有过审时间的较旧原帖', omitApproval:true,
  });
  const createdOnly = post('188005', '', {
    title:'只有创建时间', created_at:'2026-10-11T00:00:00.000Z', omitApproval:true,
  });
  const hot = post('188006', '2026-10-15T00:00:00.000Z', {
    title:'热榜帖不进全部精华', origin:'public', source_refs:[source.id], source_item_time:'2026-10-15T00:00:00.000Z',
  });
  const blank = post('188007', '2026-10-10T00:00:00.000Z', {
    title:'@blank_user 的精华帖', summary:'', author_handle:'blank_user',
    url:'https://x.com/blank_user/status/188007',
  });
  const folded = post('188008', '2026-10-09T00:00:00.000Z', {
    title:'抽奖精华', summary:'转发抽一名，送周边礼品，关注后参与。', source_item_time:'2026-10-16T00:00:00.000Z',
  });
  const covered = post('188009', '2026-09-01T00:00:00.000Z', {
    title:'<script>alert(1)</script>', summary:'封面摘录', review_type:'文章', has_article:true,
    cover_url:'https://cdn.example.com/covers/archive.jpg', source_item_time:'2026-10-08T00:00:00.000Z',
    author_handle:'ai_xiaomu',
  });
  const filler = Array.from({length:22}, (_, index) => post(String(190000 + index), '2026-07-01T00:00:00.000Z', {
    title:`更早的精华 ${index}`, source_item_time:new Date(Date.parse('2026-06-01T00:00:00.000Z') + index * 86400000).toISOString(),
  }));
  const input = feed([
    recentApproval, olderApproval, noApprovalLater, noApprovalEarlier, createdOnly, hot, blank, folded, covered, ...filler,
  ]);
  const first = essenceArchiveFromFeed(input);
  const second = essenceArchiveFromFeed(input, {page:2});
  const past = essenceArchiveFromFeed(input, {page:9});
  const ids = [...first.items, ...second.items].map(item => item.id);

  assert.equal(first.page, 1);
  assert.equal(first.page_size, 24);
  assert.equal(first.pages, 2);
  assert.equal(first.sort, 'approved_at');
  assert.equal(first.fallback, 'published_at');
  assert.equal(first.items.length, 24);
  assert.equal(second.items.length, first.total - 24);
  assert.equal(past.items.length, 0);
  assert.equal(past.total, first.total);
  assert.equal(ids[0], noApprovalLater.id);
  assert.ok(ids.indexOf(noApprovalLater.id) < ids.indexOf(noApprovalEarlier.id));
  assert.ok(ids.indexOf(recentApproval.id) < ids.indexOf(olderApproval.id));
  assert.ok(ids.includes(createdOnly.id));
  assert.ok(ids.includes(covered.id));
  assert.equal(ids.includes(hot.id), false);
  assert.equal(ids.includes(blank.id), false);
  assert.equal(ids.includes(folded.id), false);
  assert.equal(first.items.some(item => item.bookmark_count !== undefined || item.summary !== undefined || item.unknowns !== undefined), false);
  assert.equal(first.items.find(item => item.id === covered.id).pool, true);
  assert.equal(first.items.find(item => item.id === covered.id).cover_url, 'https://cdn.example.com/covers/archive.jpg');

  const homeState = {...input, allItems:input.items, hiddenItemIds:new Set(), savedItemIds:new Set(), archivedItemIds:new Set(), savedItems:[], profile:{exclude:''}, mode:'live'};
  const selected = selectHomeShowcase(homeState);
  assert.equal(selected.latest.length <= HOME_LATEST_LIMIT, true);
  assert.equal(selected.latest.some(entry => entry.post.item.id === recentApproval.id), false);
  const html = renderHomeShowcase(app, homeState);
  assert.match(html, /href="\/essence\.html">全部精华</);
  assert.equal((html.match(/href="\/essence\.html"/g) || []).length, 2);
  assert.doesNotMatch(html, /id="essence-archive"|刚过审的旧原帖|热榜帖不进全部精华|空白封面不在这里/);
  assert.equal((html.match(/class="cover-card/g) || []).length <= HOME_LATEST_LIMIT, true);
  const nav = renderWorkspaceNavigation('today', homeState, {homeView:'latest'});
  assert.doesNotMatch(nav, /全部精华|essence\.html|data-home-view="archive"/);
  assert.match(nav, />昨日全部</);
  assert.match(nav, />七日精选</);
  assert.match(nav, />卧云精选</);

  const painted = renderEssenceArchive(first);
  assert.match(painted, /全部精华/);
  assert.match(painted, /按过审时间从新到旧/);
  assert.match(painted, /loading="lazy"/);
  assert.match(painted, /referrerpolicy="no-referrer"/);
  assert.match(painted, /href="\?page=2">下一页</);
  assert.doesNotMatch(painted, /<script>alert/);
  assert.match(painted, /&lt;script&gt;alert/);
  assert.equal((painted.match(/class="cover-card/g) || []).length, 24);
  assert.match(renderEssenceArchive(past), /回到第一页/);
  assert.doesNotMatch(painted, /下架|恢复|data-archive-remove/);
  assert.equal(first.items.some(item => Object.hasOwn(item, 'key') || Object.hasOwn(item, 'removed')), false);
});

test('a blank approved row stays in 全部精华 when another copy of the same post has a face', () => {
  const url = 'https://x.com/Saccc_c/status/2110694725640474759';
  const approved = post('2110694725640474759', '2026-09-20T00:00:00.000Z', {
    title:'@Saccc_c 的精华帖', summary:'', author_handle:'Saccc_c', url,
    source_item_time:'2026-10-02T00:00:00.000Z',
  });
  const board = post('news-sacc', '2026-09-20T00:00:00.000Z', {
    origin:'public', source_refs:[source.id], author_handle:'Saccc_c', url,
    title:'手把手教你用 Opus 做 3D', summary:'本周，我用 Opus 把《小王子》做成了一款可以亲自探索的 3D 游戏。',
    omitApproval:true,
  });
  const page = essenceArchiveFromFeed(feed([approved, board]));
  assert.equal(page.total, 1);
  assert.match(page.items[0].excerpt, /小王子/);
  assert.match(page.items[0].title, /Opus/);
  assert.equal(page.items[0].approved_at.startsWith('2026-10-02'), true);
});

test('the archive route returns one page and does not write the public snapshot', async () => {
  const body = feed([
    post('188101', '2026-10-02T00:00:00.000Z', {title:'甲', source_item_time:'2026-10-03T00:00:00.000Z'}),
    post('188102', '2026-10-01T00:00:00.000Z', {title:'乙', source_item_time:'2026-10-04T00:00:00.000Z'}),
  ]);
  const raw = JSON.stringify(body);
  let puts = 0;
  let assetReads = 0;
  const env = {
    PUBLIC_FEED:{
      get:async key => {
        if (key === ESSENCE_ARCHIVE_KEY) return null;
        assert.equal(key, PUBLIC_FEED_KEY);
        return raw;
      },
      put:async () => { puts += 1; },
    },
    ASSETS:{fetch:async () => { assetReads += 1; throw Error('kv hit must not read the static seed'); }},
  };
  const response = await handleEssenceArchiveRequest(new Request('https://feed.example/api/essence-archive?page=1'), env);
  const page = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(page.items.map(item => item.id), ['188102', '188101']);
  assert.equal(puts, 0);
  assert.equal(assetReads, 0);
  const head = await handleEssenceArchiveRequest(new Request('https://feed.example/api/essence-archive', {method:'HEAD'}), env);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const denied = await handleEssenceArchiveRequest(new Request('https://feed.example/api/essence-archive', {method:'POST'}), env);
  assert.equal(denied.status, 405);
  assert.equal((await handleEssenceArchiveRequest(new Request('https://feed.example/api/essence-archive?page=0'), env)).status, 400);
  assert.equal((await handleEssenceArchiveRequest(new Request('https://feed.example/api/essence-archive?page=1&extra=1'), env)).status, 400);

  const seeded = {
    PUBLIC_FEED:{get:async () => { throw Error('kv down'); }, put:async () => { puts += 1; }},
    ASSETS:{fetch:async request => {
      assert.equal(new URL(request.url).pathname, '/data/public-feed.json');
      return new Response(raw, {status:200});
    }},
  };
  const fallback = await handleEssenceArchiveRequest(new Request('https://feed.example/api/essence-archive'), seeded);
  assert.equal(fallback.status, 200);
  assert.deepEqual((await fallback.json()).items.map(item => item.title), ['乙', '甲']);
  assert.equal(puts, 0);

  const throughWorker = await worker.fetch(new Request('https://feed.example/api/essence-archive?page=1'), env);
  assert.equal(throughWorker.status, 200);
  assert.equal((await throughWorker.json()).total, 2);
  const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const example = readFileSync(new URL('../wrangler.example.jsonc', import.meta.url), 'utf8');
  assert.match(wrangler, /\/api\/essence-archive\/\*/);
  assert.match(example, /\/api\/essence-archive\/\*/);
  assert.equal(PUBLIC_FILES.includes('essence.html'), true);
  assert.equal(PUBLIC_FILES.includes('src/essenceArchivePage.js'), true);
  assert.equal(PUBLIC_FILES.includes('src/essenceArchiveView.js'), true);
  assert.equal(ESSENCE_ARCHIVE_PATH, '/api/essence-archive');
  const admin = await worker.fetch(new Request('https://feed.example/api/essence-archive/admin', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'}), env);
  assert.equal(admin.status, 503);
  assert.equal(puts, 0);
});

test('a remembered archive stays after the snapshot drops the post, and 下架 does not reopen pending', async () => {
  const review = 'r'.repeat(32);
  const delivery = 'd'.repeat(32);
  const kept = post('188102', '2026-10-01T00:00:00.000Z', {title:'乙', source_item_time:'2026-10-04T00:00:00.000Z'});
  const other = post('188101', '2026-10-02T00:00:00.000Z', {title:'甲', source_item_time:'2026-10-03T00:00:00.000Z'});
  const body = feed([kept, other]);
  const values = new Map([[PUBLIC_FEED_KEY, JSON.stringify(body)]]);
  const inbox = [];
  const feedWrites = [];
  const env = {
    DOT_REVIEW_TOKEN_HASH:await dotInboxHash(review),
    DOT_DELIVERY_TOKEN_HASH:await dotInboxHash(delivery),
    DOT_INBOX:{
      get() { inbox.push('get'); throw Error('pending queue'); },
      put() { inbox.push('put'); throw Error('pending queue'); },
      list() { inbox.push('list'); throw Error('pending queue'); },
    },
    PUBLIC_FEED:{
      async get(key) { return values.has(key) ? values.get(key) : null; },
      async put(key, raw) {
        feedWrites.push(key);
        assert.equal(key, ESSENCE_ARCHIVE_KEY);
        values.set(key, raw);
      },
    },
  };
  assert.equal((await rememberEssenceArchive(env, body)).written, true);
  assert.deepEqual(feedWrites, [ESSENCE_ARCHIVE_KEY]);
  values.set(PUBLIC_FEED_KEY, JSON.stringify(feed([])));
  const stayed = await (await handleEssenceArchiveRequest(new Request('https://feed.example/api/essence-archive?page=1'), env)).json();
  assert.deepEqual(stayed.items.map(item => item.title), ['乙', '甲']);
  assert.equal(stayed.items.some(item => Object.hasOwn(item, 'removed') || Object.hasOwn(item, 'key')), false);

  const taken = await handleEssenceArchiveRequest(new Request('https://feed.example/api/essence-archive/admin', {
    method:'POST',
    headers:{'Content-Type':'application/json', Authorization:`Bearer ${delivery}`},
    body:JSON.stringify({url:kept.original_url, removed:true}),
  }), env);
  assert.equal(taken.status, 401);
  const response = await handleEssenceArchiveRequest(new Request('https://feed.example/api/essence-archive/admin', {
    method:'POST',
    headers:{'Content-Type':'application/json', Authorization:`Bearer ${review}`, Origin:'https://feed.example'},
    body:JSON.stringify({url:`https://twitter.com/example/status/${kept.id}`, removed:true, status:'pending'}),
  }), env);
  assert.equal(response.status, 400);
  const removed = await handleEssenceArchiveRequest(new Request('https://feed.example/api/essence-archive/admin', {
    method:'POST',
    headers:{'Content-Type':'application/json', Authorization:`Bearer ${review}`},
    body:JSON.stringify({url:kept.original_url, removed:true}),
  }), env);
  assert.equal(removed.status, 200);
  const row = await removed.json();
  assert.equal(row.removed, true);
  assert.equal(row.url, kept.original_url);
  assert.equal(Object.hasOwn(row, 'key'), false);
  const hidden = await (await handleEssenceArchiveRequest(new Request('https://feed.example/api/essence-archive'), env)).json();
  assert.deepEqual(hidden.items.map(item => item.id), [other.id]);
  assert.doesNotMatch(renderEssenceArchive(hidden), /下架|data-archive-remove/);
  const adminPage = await (await handleEssenceArchiveRequest(new Request('https://feed.example/api/essence-archive/admin', {
    headers:{Authorization:`Bearer ${review}`},
  }), env)).json();
  assert.equal(adminPage.items.find(item => item.url === kept.original_url).removed, true);
  assert.equal(adminPage.total, 2);

  const edited = structuredClone(body);
  edited.items.find(item => item.id === kept.id).title = '改过的标题';
  edited.items.find(item => item.id === kept.id).source_item_time = '2026-10-09T00:00:00.000Z';
  const approvedAt = JSON.parse(values.get(ESSENCE_ARCHIVE_KEY)).items.find(item => item.key === `x:${kept.id}`).approved_at;
  assert.equal((await rememberEssenceArchive(env, edited)).written, true);
  const stored = JSON.parse(values.get(ESSENCE_ARCHIVE_KEY));
  const keptRow = stored.items.find(item => item.key === `x:${kept.id}`);
  assert.equal(keptRow.removed, true);
  assert.equal(keptRow.approved_at, approvedAt);
  assert.equal(keptRow.title, '改过的标题');
  const stillHidden = await (await handleEssenceArchiveRequest(new Request('https://feed.example/api/essence-archive'), env)).json();
  assert.equal(stillHidden.items.some(item => item.id === kept.id), false);
  assert.equal(JSON.parse(values.get(PUBLIC_FEED_KEY)).items.length, 0);
  assert.deepEqual(inbox, []);

  const restored = await handleEssenceArchiveRequest(new Request('https://feed.example/api/essence-archive/admin', {
    method:'POST',
    headers:{'Content-Type':'application/json', Authorization:`Bearer ${review}`},
    body:JSON.stringify({url:kept.original_url, removed:false}),
  }), env);
  assert.equal((await restored.json()).removed, false);
  const back = await (await handleEssenceArchiveRequest(new Request('https://feed.example/api/essence-archive'), env)).json();
  assert.equal(back.items.some(item => item.id === kept.id), true);
  const unknown = await handleEssenceArchiveRequest(new Request('https://feed.example/api/essence-archive/admin', {
    method:'POST',
    headers:{'Content-Type':'application/json', Authorization:`Bearer ${review}`},
    body:JSON.stringify({url:'https://x.com/example/status/188199', removed:true}),
  }), env);
  assert.equal(unknown.status, 404);
  assert.deepEqual(inbox, []);

  const filler = Array.from({length:ESSENCE_ARCHIVE_CAP}, (_, index) => ({
    key:`x:${2000000000000000000n + BigInt(index)}`,
    id:String(index), title:`旧 ${index}`, excerpt:'摘录', url:`https://x.com/example/status/${2000000000000000000n + BigInt(index)}`,
    published_at:'2026-01-01T00:00:00.000Z', approved_at:'2026-01-02T00:00:00.000Z', author:'', source:'KOSX 过审',
    cover_url:'', cover_kind:'', pool:false, removed:false, removed_at:'',
  }));
  const full = mergeEssenceArchive({schema:'essence-archive-v1', items:filler}, [{
    key:'x:188199', id:'188199', title:'新的不再挤掉旧帖', excerpt:'摘录', url:'https://x.com/example/status/188199',
    published_at:'2026-10-01T00:00:00.000Z', approved_at:'2026-10-08T00:00:00.000Z', author:'', source:'KOSX 过审',
    cover_url:'', cover_kind:'', pool:false,
  }]);
  assert.equal(full.items.length, ESSENCE_ARCHIVE_CAP);
  assert.equal(full.items.some(item => item.key === 'x:188199'), false);
  const refreshed = mergeEssenceArchive(full, [{...filler[0], title:'同一条可以改标题'}]);
  assert.equal(refreshed.items.find(item => item.key === filler[0].key).title, '同一条可以改标题');
  const takenDown = setEssenceArchiveRemoved(normalizeEssenceArchive(JSON.stringify(refreshed)), filler[0].key, true, '2026-10-17T00:00:00.000Z');
  const republished = mergeEssenceArchive(takenDown, [{...filler[0], title:'发布也不能抬回来', approved_at:'2026-10-18T00:00:00.000Z'}]);
  assert.equal(republished.items.find(item => item.key === filler[0].key).removed, true);
  assert.equal(republished.items.find(item => item.key === filler[0].key).approved_at, '2026-01-02T00:00:00.000Z');

  let clobber = JSON.stringify(body);
  const writes = [];
  assert.equal((await rememberEssenceArchive({
    PUBLIC_FEED:{
      async get() { return clobber; },
      async put(key, raw) { writes.push(key); clobber = raw; },
    },
  }, body)).written, false);
  assert.deepEqual(writes, []);
});
