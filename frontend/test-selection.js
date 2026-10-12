import test from 'node:test';
import assert from 'node:assert/strict';
import { selectFeed, describePurpose } from './src/feedSelection.js';

const item = (id, summary, extra = {}) => ({ id: String(id), repository_name: `maker/tool-${id}`, title: `Original ${id}`, summary, updated_at: '2026-09-28T12:00:00Z', stars: 300, ...extra });

test('Chinese AI preference matches English metadata without matching chair or paid', () => {
  const input = [item(1, 'A chair for your home'), item(2, 'Paid service'), item(3, 'An AI assistant for tasks'), item(4, 'Claude agents for automation')];
  const before = JSON.stringify(input);
  const result = selectFeed(input, { interests: 'AI 工具、自动化' });
  assert.deepEqual(result.daily.map(i => i.id), ['4', '3']);
  assert.equal(result.matchedCount, 2);
  assert.equal(result.candidates.length, 4);
  assert.match(result.daily[0].selection_reason, /AI 工具、自动化/);
  assert.equal(JSON.stringify(input), before, 'Source material stays unchanged');
});

test('exclusions win over interests; all candidates remain readable', () => {
  const input = [item(1, 'AI assistant for macOS'), item(2, 'AI assistant for Windows')];
  const result = selectFeed(input, { interests: 'AI 工具', exclude: 'Mac 工具' });
  assert.equal(result.excludedCount, 1);
  assert.deepEqual(result.daily.map(i => i.id), ['2']);
  assert.equal(result.candidates.length, 2);
  assert.match(result.candidates.find(i => i.id === '1').selection_reason, /不想看/);
});

test('unmatched or complex text never yields unrelated recommendations', () => {
  const input = [item(1, 'Translation utility'), item(2, 'An AI assistant')];
  for (const interests of ['火星种菜', '免费且适合初学者', 'a+b']) {
    const result = selectFeed(input, { interests });
    assert.equal(result.daily.length, 0);
    assert.equal(result.discover.length, 0);
    assert.equal(result.candidates.length, 2);
  }
  assert.equal(selectFeed([item(1, 'utility called a+b')], { interests: 'a+b' }).matchedCount, 1, 'Metacharacters are literal');
});

test('empty preferences show recent projects; hidden items stay hidden; 5+2 unique matches', () => {
  const input = Array.from({ length: 12 }, (_, i) => item(i + 1, 'AI automation', { stars: i > 5 ? 150 : 4000 }));
  const result = selectFeed(input, {}, ['1', '2']);
  assert.equal(result.daily.length, 5);
  assert.equal(result.discover.length, 2);
  assert.equal(new Set([...result.daily, ...result.discover].map(i => i.id)).size, 7);
  assert.equal(result.candidates.length, 10);
  assert.equal(result.hiddenCount, 2);
  assert.ok(!result.daily.some(i => ['1', '2'].includes(i.id)));
});

test('specific purpose precedes incidental markdown mention', () => {
  assert.equal(describePurpose(item(1, 'Desktop terminal manager with markdown editor')), '管理终端工作');
  assert.equal(describePurpose(item(2, 'Agent skills in plain markdown')), '给 AI 增加工作方法');
  assert.equal(describePurpose(item(3, 'Desktop translation suite')), '翻译与文字识别');
  assert.equal(describePurpose(item(4, 'AI workspace for legal and document-heavy workflows with OCR')), '处理文档与材料');
});

test('adapter saves preferences, reselects after reload and refresh, and preserves saved exclusions', async () => {
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  const { FeedDataAdapter } = await import('./src/dataAdapter.js');
  let data = { schema_version: '0.2', mode: 'live', profile: { interests: '', exclude: '' }, sources: [], items: [item(1, 'AI for macOS'), item(2, 'Translation utility')], sections: { daily: ['1', '2'], discover: [] }, refresh: { status: 'ok', message: 'updated' } };
  globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(data) });
  const adapter = new FeedDataAdapter();
  await adapter.loadFeed();
  adapter.setSaved('1', true);
  adapter.saveProfile({ interests: '翻译', exclude: 'AI 工具' });
  assert.deepEqual(adapter.getState().dailyItems.map(i => i.id), ['2']);
  assert.equal(adapter.getState().savedItems[0].id, '1');
  assert.equal(data.items[0].selection_reason, undefined);
  const reloaded = new FeedDataAdapter();
  await reloaded.loadFeed();
  assert.deepEqual(reloaded.getState().dailyItems.map(i => i.id), ['2']);
  data = { ...data, items: [item(3, 'Translation app'), item(4, 'AI translator')] };
  await reloaded.refreshFeed();
  assert.deepEqual(reloaded.getState().dailyItems.map(i => i.id), ['3']);
  assert.equal(reloaded.getState().savedItems[0].id, '1');
  globalThis.localStorage.setItem = () => { throw new Error('Full'); };
  assert.throws(() => reloaded.saveProfile({ interests: 'AI 工具' }), /本地存储/);
  assert.deepEqual(reloaded.getState().dailyItems.map(i => i.id), ['3']);
});
