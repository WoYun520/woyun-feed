import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ResearchService, readGithubReadme, validateReport } from './research-service.js';
import { readerArgs } from './codex-reader.js';

const report = { summary: '整理文档', can_do: ['保存文字'], who_for: '建议写作者使用', first_steps: ['打开说明'], cost_and_limits: '费用未知', unknowns: ['未实测'], next_step: '做一次小试用' };
const item = { id: 'github-1', repository_name: 'example/tool' };
const sourceResponse = (text = '# Tool\nSave text') => new Response(JSON.stringify({ encoding: 'base64', content: Buffer.from(text).toString('base64'), sha: 'a'.repeat(40), path: 'README.md' }));
async function setup(t, runner = async () => ({ report, model: 'test-only' }), fetchImpl = async () => sourceResponse()) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'feed-research-test-'));
  t.after(() => fs.rm(dataDir, { force: true, recursive: true }));
  const options = { dataDir, feed: { current: async () => ({ items: [item] }) }, fetchImpl, runner };
  return { options, service: new ResearchService(options) };
}
const request = () => ({ request_id: randomUUID(), item_id: item.id, question: '用通俗中文解释用途' });

test('reading/analyzing/done persists source and recovers completed results after restart', async t => {
  const { service, options } = await setup(t);
  const input = request();
  const first = await service.start(input);
  assert.equal(first.status, 'reading');
  await service.work;
  const done = await service.get(first.id);
  assert.equal(done.status, 'done'); assert.equal(done.report.summary, report.summary);
  assert.equal(done.source.sha, 'a'.repeat(40)); assert.equal(done.source.text, undefined);
  assert.deepEqual(await new ResearchService(options).get(first.id), done);
  const source = JSON.parse(await fs.readFile(path.join(options.dataDir, 'research', 'sources', first.id + '.json')));
  assert.match(source.text, /Save text/);
  assert.equal(source.truncated, false);
});

test('duplicate submit is idempotent; concurrent different work is rejected', async t => {
  let finish, calls = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const { service } = await setup(t, async () => { calls++; await pending; return { report }; });
  const input = request();
  const [a, b] = await Promise.all([service.start(input), service.start(input)]);
  assert.equal(a.id, b.id);
  await assert.rejects(service.start(request()), /还有一项/);
  await assert.rejects(service.start({ ...input, question: 'changed' }), /问题已变更/);
  finish(); await service.work; assert.equal(calls, 1);
  await service.start(input); assert.equal(calls, 1, 'Repeated completed request must not rerun');
});

test('unreadable source never reaches AI; invalid output never becomes done', async t => {
  let calls = 0;
  const { service } = await setup(t, async () => { calls++; return { report: {} }; }, async () => new Response('', { status: 404 }));
  const first = await service.start(request()); await service.work;
  assert.equal((await service.get(first.id)).status, 'failed'); assert.equal(calls, 0);
  service.fetchImpl = async () => sourceResponse();
  const second = await service.start(request()); await service.work;
  const bad = await service.get(second.id);
  assert.equal(bad.status, 'failed'); assert.equal(bad.report, null); assert.equal(calls, 1);
});

test('interrupted jobs require manual retry after restart', async t => {
  const { options, service } = await setup(t);
  await service.init(); const input = request();
  await service.save({ id: input.request_id, item_id: input.item_id, status: 'analyzing' });
  const recovered = await new ResearchService(options).get(input.request_id);
  assert.equal(recovered.status, 'failed'); assert.match(recovered.error, /不会自动/);
});

test('only known projects accepted; no arbitrary URL or credential submission', async t => {
  const { service } = await setup(t);
  await assert.rejects(service.start(null), /格式/);
  await assert.rejects(service.start({ ...request(), item_id: 'https://127.0.0.1/secret' }), /真实项目/);
  await assert.rejects(service.start({ ...request(), item_id: 'github-999' }), /没有找到/);
  await assert.rejects(service.start({ ...request(), question: 'password: example-test-only' }), /凭据/);
  await assert.rejects(readGithubReadme('../bad/url'), /地址/);
  assert.throws(() => validateReport({ ...report, can_do: [] }), /不完整/);
});

test('oversized README is explicitly marked excerpt; reader tools are disabled', async () => {
  const source = await readGithubReadme('example/tool', async () => sourceResponse('x'.repeat(30000)));
  assert.equal(source.text.length, 28000); assert.equal(source.truncated, true);
  const args = readerArgs('/tmp/schema', '/tmp/output', '/tmp/work');
  assert.ok(args.includes('--ignore-user-config')); assert.ok(args.includes('read-only'));
  assert.ok(args.includes('shell_tool')); assert.ok(args.includes('plugins')); assert.ok(args.includes('multi_agent'));
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
});
