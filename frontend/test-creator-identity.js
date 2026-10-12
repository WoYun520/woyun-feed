import test from 'node:test';
import assert from 'node:assert/strict';
import { CREATOR_CATALOG, CREATOR_MATERIALS } from './src/creatorCatalog.js';
import { classifyCreatorMaterial, selectCreatorTutorials } from './src/creatorTutorials.js';
import { creatorGuideFor } from './src/creatorGuides.js';
import { renderCreatorPage } from './src/creatorViews.js';
import { makeBackup, parseBackup } from './src/backup.js';

const creatorIds = ['creator-ruanyifeng', 'creator-gera2ld'];
const authors = () => CREATOR_CATALOG.filter(creator => creatorIds.includes(creator.id));
const materials = () => CREATOR_MATERIALS.filter(item => creatorIds.includes(item.creator_id));
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const app = (view = 'tutorials') => ({
  escapeHtml: escape, safeUrl: value => {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '#'; }
    catch { return '#'; }
  }, formatTime: value => value, creatorView: view, creatorAuthorFilter: 'all', creatorQuery: '',
});
const viewState = (items = materials()) => ({
  creatorCatalog: authors(), creatorPreferences: {}, creatorTutorials: selectCreatorTutorials(items),
  sources: [], sourceMap: new Map(), savedItemIds: new Set(), archivedItemIds: new Set(), topics: [],
});
const savedState = item => ({saved_item_ids: [item.id], hidden_item_ids: [], followups: [], profile_override: null, item_snapshots: {[item.id]: structuredClone(item)}});
const backupFeed = item => ({schema_version: '0.3', mode: 'live', sources: [], items: [item]});

test('non-X author tutorials match their guarded creator IDs without inventing handles', () => {
  assert.deepEqual(authors().map(creator => creator.id).sort(), [...creatorIds].sort());
  for (const creator of authors()) {
    assert.equal(creator.handle, undefined);
    assert.ok(creator.profile_label);
    assert.doesNotMatch(creator.profile_url, /(?:x|twitter)\.com\//i);
    const notes = materials().filter(item => item.creator_id === creator.id);
    assert.ok(notes.length);
    const selected = selectCreatorTutorials(notes);
    assert.equal(selected.length, notes.length);
    for (const entry of selected) {
      assert.equal(entry.creator.id, creator.id);
      assert.equal(entry.item.author_handle, undefined);
      assert.equal(entry.item.verification_status, 'not_tested');
      assert.equal(entry.kind, 'tutorial');
    }
    assert.equal(selectCreatorTutorials(notes, {preferences: {[creator.id]: {enabled: false}}}).length, 0);
  }
});

test('guarded fixed author ID wins over a coincidental legacy handle', () => {
  const item = CREATOR_MATERIALS.find(entry => entry.author_handle);
  const original = CREATOR_CATALOG.find(creator => creator.id === item.creator_id);
  const own = {...original}; delete own.handle;
  const other = {...original, id: 'creator-unrelated', handle: item.author_handle};
  const selected = selectCreatorTutorials([item], {catalog: [other, own]});
  assert.equal(selected.length, 1);
  assert.equal(selected[0].creator.id, own.id);
});

test('unknown identity, edited notes and absent handles cannot inherit a known tutorial', () => {
  const item = materials()[0];
  assert.ok(item);
  for (const patch of [{creator_id: 'creator-unknown'}, {creator_id: undefined},
    {creator_id: creatorIds.find(id => id !== item.creator_id)}, {summary: item.summary + '\n已实测通过'},
    {original_url: 'https://unrelated.example/tutorial'}, {author_handle: 'ruanyifeng'}]) {
    const changed = {...item, ...patch};
    assert.equal(classifyCreatorMaterial(changed), null);
    assert.equal(selectCreatorTutorials([changed]).length, 0);
  }
  const excerpt = {...item, id: 'news-' + 'd'.repeat(24), link_kind: 'article', content_status: 'excerpt_only',
    read_scope: 'author-blog-feed', source_refs: ['creator-blog-ruanyifeng'], blog_method_hint: 'steps-and-example'};
  assert.equal(classifyCreatorMaterial(excerpt), null);
  assert.equal(selectCreatorTutorials([excerpt]).length, 0);
});

test('non-X author cards use their actual profile labels and fixed reading coverage', () => {
  const state = viewState(), before = structuredClone(state);
  const tutorials = renderCreatorPage(app(), state), library = renderCreatorPage(app('authors'), state);
  for (const creator of authors()) {
    assert.ok(library.includes(`href="${escape(creator.profile_url)}"`));
    assert.ok(library.includes(`${escape(creator.profile_label)} ↗`));
    assert.ok(tutorials.includes(`${escape(creator.name)} · ${escape(creator.profile_label)}`));
  }
  const meta = [...tutorials.matchAll(/<div class="creator-tutorial-meta">([\s\S]*?)<\/div>/g)].map(match => match[1]).join('');
  assert.doesNotMatch(meta, /@|(?:x|twitter)\.com/);
  assert.doesNotMatch(library, /@(?:ruanyifeng|gera2ld)|href="https:\/\/(?:x|twitter)\.com/);
  assert.match(library, /固定说明样本/);
  assert.doesNotMatch(library, /data-creator-source-id=/);
  assert.match(tutorials, /只有另附实测记录的案例实际跑过/);
  assert.match(library, /是否实测见独立记录/);
  assert.deepEqual(state, before);
});

test('creator ID backup remains optional and unknown IDs never certify material identity', () => {
  for (const item of materials()) {
    const raw = makeBackup(savedState(item), backupFeed(item), 'live').raw;
    const restored = parseBackup(raw, 'live').state.item_snapshots[item.id];
    assert.deepEqual(restored, item);
    assert.equal(restored.author_handle, undefined);
    assert.equal(selectCreatorTutorials([restored])[0].creator.id, item.creator_id);
  }
  const legacy = structuredClone(CREATOR_MATERIALS.find(item => item.author_handle));
  delete legacy.creator_id;
  assert.deepEqual(parseBackup(makeBackup(savedState(legacy), backupFeed(legacy), 'live').raw, 'live').state.item_snapshots[legacy.id], legacy);
  const unknown = {...materials()[0], creator_id: 'creator-unknown'};
  const restored = parseBackup(makeBackup(savedState(unknown), backupFeed(unknown), 'live').raw, 'live').state.item_snapshots[unknown.id];
  assert.equal(restored.creator_id, 'creator-unknown');
  assert.equal(classifyCreatorMaterial(restored), null);
});

test('invalid creator ID types, length and characters are rejected before backup restoration', () => {
  const item = materials()[0], base = makeBackup(savedState(item), backupFeed(item), 'live').backup;
  for (const creator_id of ['', 'c'.repeat(129), 42, {}, [], 'creator bad', 'creator-\nforged', '@ruanyifeng']) {
    const input = structuredClone(base);
    input.state.item_snapshots[item.id].creator_id = creator_id;
    assert.throws(() => parseBackup(JSON.stringify(input), 'live'), /作者编号格式不正确/);
  }
});

test('the isolated trial is a guarded companion link and cannot attach to other or edited materials', () => {
  const item = CREATOR_MATERIALS.find(entry => entry.id === 'news-06a53817383bd897e2e5a535');
  assert.ok(item);
  const guide = creatorGuideFor(item);
  const trialUrl = 'https://woyun-feed-preview.woyun520.workers.dev/trials/ffmpeg-frame-20261003/';
  assert.equal(guide.trial_url, trialUrl);
  assert.equal(item.verification_status, 'not_tested');
  assert.equal(item.trial_url, undefined);
  const state = viewState([item]), html = renderCreatorPage(app(), state);
  assert.ok(html.includes(`href="${trialUrl}"`));
  assert.match(html, /查看本站截图实测（合成素材）/);
  const blockedApp = {...app(), safeUrl: value => value === trialUrl ? '#' : app().safeUrl(value)};
  assert.doesNotMatch(renderCreatorPage(blockedApp, state), /class="creator-guide-trial"/);
  const other = materials().find(entry => entry.id !== item.id);
  for (const input of [other, {...item, summary: item.summary + '改写'}]) {
    const forged = {...state, creatorTutorials: [{item: input, creator: authors()[0], kind: 'tutorial', scope: '作者说明', guide: {...guide, trial_url: 'javascript:alert(1)', trial_label: '<img src=x onerror=alert(1)>'}}]};
    const output = renderCreatorPage(app(), forged);
    assert.doesNotMatch(output, /class="creator-guide-trial"|javascript:alert|onerror=alert/);
  }
});
