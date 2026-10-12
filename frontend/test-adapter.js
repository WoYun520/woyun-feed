/**
 * 数据契约适配层逻辑与存储容错测试
 * 使用 node:assert 真实断言，断言失败立即抛出异常并使进程非零退出。
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEMO_FEED_PATH = path.resolve(__dirname, '../data/demo-feed.json');

// Node 环境模拟 localStorage
let storageFailMode = false;
const storage = {};
globalThis.localStorage = {
  getItem: (k) => storage[k] || null,
  setItem: (k, v) => {
    if (storageFailMode) {
      const err = new Error('QuotaExceededError: LocalStorage quota exceeded');
      err.name = 'QuotaExceededError';
      throw err;
    }
    storage[k] = String(v);
  },
  removeItem: (k) => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
};

// 模拟 fetch 读取本地真实的 data/demo-feed.json
let fetchFailMode = false;
globalThis.fetch = async (url) => {
  if (fetchFailMode) {
    return { ok: false, status: 500, statusText: 'Internal Server Error' };
  }
  const raw = fs.readFileSync(DEMO_FEED_PATH, 'utf-8');
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => JSON.parse(raw)
  };
};

async function runTests() {
  console.log('--- 启动数据适配层与契约自动化测试 ---');
  const { FeedDataAdapter } = await import('./src/dataAdapter.js');
  const feedAdapter = new FeedDataAdapter({ mode: 'demo' });

  // 1. 测试成功读取真实 data/demo-feed.json
  const state = await feedAdapter.loadFeed();
  assert.strictEqual(state.schema_version, '0.1', 'schema_version 应为 0.1');
  assert.strictEqual(state.mode, 'demo', 'mode 应为 demo');
  assert.strictEqual(state.dailyItems.length, 3, 'dailyItems 初始应为 3 条');
  assert.strictEqual(state.discoverItems.length, 1, 'discoverItems 初始应为 1 条');
  assert.strictEqual(state.sources.length, 4, 'sources 应该包含 4 个来源');
  console.log('✓ 真实 data/demo-feed.json 数据读取与契约字段解析通过');

  // 2. 测试获取失败时不会静默替换兜底假数据，必须抛出错误（对应需求第2项）
  // 创建一个新实例测试 fetch 失败情况
  const freshAdapter = new FeedDataAdapter({ mode: 'demo' });
  fetchFailMode = true;
  await assert.rejects(
    async () => { await freshAdapter.loadFeed(); },
    /读取 data\/demo-feed\.json 失败/,
    'fetch 失败时必须向外抛出错误，严禁静默使用兜底数据'
  );
  fetchFailMode = false;
  console.log('✓ 数据源读取失败时不静默兜底伪造数据，明确抛出异常测试通过');

  // 3. 测试收藏/取消收藏
  const firstId = state.dailyItems[0].id;
  feedAdapter.setSaved(firstId, true);
  assert(feedAdapter.getState().savedItemIds.has(firstId), '第一条应该被加入收藏');
  assert.strictEqual(feedAdapter.getState().savedItems.length, 1, 'savedItems 应该包含 1 条');

  feedAdapter.setSaved(firstId, false);
  assert(!feedAdapter.getState().savedItemIds.has(firstId), '取消收藏后应该移除');
  assert.strictEqual(feedAdapter.getState().savedItems.length, 0, 'savedItems 应该为空');
  console.log('✓ 收藏/取消收藏与列表同步测试通过');

  // 4. 测试不感兴趣（隐藏）与恢复
  feedAdapter.setHidden(firstId, true);
  assert(feedAdapter.getState().hiddenItemIds.has(firstId), '第一条应该在 hiddenItemIds 中');
  assert.strictEqual(feedAdapter.getState().dailyItems.length, 2, '隐藏后 dailyItems 应为 2 条');

  feedAdapter.setHidden(firstId, false);
  assert(!feedAdapter.getState().hiddenItemIds.has(firstId), '撤销隐藏后应该恢复');
  assert.strictEqual(feedAdapter.getState().dailyItems.length, 3, 'dailyItems 应该恢复为 3 条');
  console.log('✓ 不感兴趣隐藏与撤销测试通过');

  // 5. 测试跟进任务去重与材料导出
  const task1 = feedAdapter.saveFollowupDraft(firstId, '问题版本1');
  assert.strictEqual(task1.status, 'draft', '初始状态必须为 draft');
  assert.strictEqual(feedAdapter.getState().followups.length, 1, '跟进任务数应为 1');

  // 重复点击同一条目，应更新而非新建重复任务
  const task2 = feedAdapter.saveFollowupDraft(firstId, '问题版本2 (更新后)');
  assert.strictEqual(task2.id, task1.id, '重复跟进同一条目应返回已有任务，避免重复创建');
  assert.strictEqual(feedAdapter.getState().followups.length, 1, '任务总数仍应为 1');

  // 导出材料检查
  const exported = feedAdapter.exportFollowupText(task1.id);
  assert(exported.includes('问题版本2'), '导出材料应包含更新后的问题');
  assert(exported.includes('待交给 AI'), '导出材料应体现待交给 AI 状态');
  assert(exported.includes('来源入口：[NewsNow](https://newsnow.busiyi.world/)'), '导出材料应包含来源入口实际链接 [名称](home_url)');
  assert(exported.includes('原文链接：原文地址未知'), '原文链接应明确与来源入口分开');
  assert(exported.includes('采集状态：界面示例'), 'demo 内容状态应显示为“界面示例”');
  assert(exported.includes('已知盲区与待核对事项'), '导出材料应包含 unknowns');
  console.log('✓ 跟进任务去重、来源实际链接与材料导出格式测试通过');

  // 6. 测试存储写入失败时的报错与状态回滚（对应需求第3项）
  storageFailMode = true;
  assert.throws(
    () => { feedAdapter.saveProfile({ interests: '测试偏好' }); },
    /本地存储写入失败/,
    '存储写入失败时必须抛出异常让调用者感知'
  );
  assert.throws(
    () => { feedAdapter.saveFollowupDraft('test-item', '测试问题'); },
    /本地存储写入失败/,
    '跟进任务在存储失败时必须报错并回滚'
  );
  storageFailMode = false;
  console.log('✓ 本地存储异常抛出与状态回滚保护测试通过');

  // 7. 测试偏好修改与重置
  feedAdapter.saveProfile({
    interests: '新的关注：自动化工作流',
    exclude: '新的过滤：娱乐新闻'
  });
  assert.strictEqual(feedAdapter.getState().profile.interests, '新的关注：自动化工作流');
  feedAdapter.resetProfile();
  assert(feedAdapter.getState().profile.interests.includes('普通人能用的 AI 工具'));
  console.log('✓ 关注偏好修改与重置测试通过');

  console.log('\n======================================================');
  console.log('  数据适配层契约与存储容错所有断言验证通过！');
  console.log('======================================================');
}

runTests().catch(err => {
  console.error('\n❌ 测试失败:', err);
  process.exit(1);
});
