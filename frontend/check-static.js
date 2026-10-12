/**
 * 静态代码与文件规范检查脚本
 * 说明：本脚本仅进行静态文本、代码结构与规则契约检查，不代表实际浏览器中的渲染测量与人眼核验。
 * 使用 node:assert 真实断言，断言失败立即抛出异常并使进程非零退出。
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('--- 启动静态代码与规范文本检查 ---');

const htmlPath = path.join(__dirname, 'index.html');
const cssPath = path.join(__dirname, 'src/styles.css');
const appJsPath = path.join(__dirname, 'src/app.js');
const dataAdapterPath = path.join(__dirname, 'src/dataAdapter.js');
const demoFeedPath = path.resolve(__dirname, '../data/demo-feed.json');

const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
const cssContent = fs.readFileSync(cssPath, 'utf-8');
const appJsContent = fs.readFileSync(appJsPath, 'utf-8');
const dataAdapterContent = fs.readFileSync(dataAdapterPath, 'utf-8');
const demoFeedContent = fs.readFileSync(demoFeedPath, 'utf-8');

// 1. 文件与关键结构存在性
assert(htmlContent.includes('我的信息流'), 'HTML 应包含主标题');
assert(htmlContent.includes('styles.css'), 'HTML 应引入样式表');
assert(htmlContent.includes('app.js'), 'HTML 应引入主应用脚本');
assert(htmlContent.includes('viewport'), 'HTML 必须包含移动端视口设置');
console.log('✓ index.html 结构与关键标签静态核查通过');

// 2. CSS 布局声明静态检查（仅核查样式声明存在，不代表实际浏览器渲染度量）
assert(cssContent.includes('--max-width: 1120px'), '版心尺寸应声明在 1080-1160px 范围');
assert(cssContent.includes('--main-col-width: 720px'), '主阅读列应声明在 680-760px 范围');
assert(cssContent.includes('@media (max-width: 860px)'), '必须包含移动端响应式断点声明');
assert(cssContent.includes('overflow-x: hidden'), 'CSS 应包含防横向溢出声明');
assert(cssContent.includes('.btn-primary-action'), '主要动作样式类存在');
assert(cssContent.includes('.btn-quiet'), '低强调按钮样式类存在');
console.log('✓ CSS 视觉规范与样式声明静态核查通过');

// 3. 文案规范、通俗化表达与证据边界静态检查
assert(appJsContent.includes('示例内容 · 尚未连接信息源'), '必须统一显示示例内容提示');
assert(appJsContent.includes('你的阅读偏好，示例内容暂不重排'), '偏好说明必须使用统一通俗文案“你的阅读偏好，示例内容暂不重排”');
assert(appJsContent.includes('预览跟进状态'), '必须使用通俗的“预览跟进状态”而不是英文状态列表');
assert(appJsContent.includes('这版还没有连接真实信息源，目前展示的是示例内容。接入后，你可以在这里获取新内容。'), '检查更新弹窗必须使用通俗的两句话解释');
assert(!appJsContent.includes('<code>docs/feed-contract.md</code>'), '页面弹窗中不得向普通用户展示契约文档路径');
assert(!appJsContent.includes('sources: not_connected'), '页面弹窗中不得展示内部状态代码');
assert(!appJsContent.includes('爬虫'), '页面弹窗中不得展示“爬虫”等技术术语');
assert(!appJsContent.includes('刚刚抓取'), '严禁出现虚假未发生的“刚刚抓取”字样');
assert(!appJsContent.includes('全网实时'), '严禁出现虚假的“全网实时”字样');
assert(!appJsContent.includes('已由 Muse 分析'), '严禁出现未发生的“已由 Muse 分析”字样');
assert(appJsContent.includes('待交给 AI'), '任务初始状态必须为“待交给 AI”');
assert(appJsContent.includes('时间未提供'), '发布时间为空时必须提示“时间未提供”');
assert(appJsContent.includes('打开来源'), '无原文 URL 时按钮必须为“打开来源”');

// 来源 kind 展示通俗化检查：不直接展示英文 kind 术语
assert(!appJsContent.includes('(${src.kind})'), '不应在页面直接展示原始英文 kind（如 aggregator 等）');
assert(dataAdapterContent.includes('界面示例'), '导出材料中 demo 状态应转换为“界面示例”');
console.log('✓ 业务文案通俗化与诚实边界静态检查通过');

// 4. 存储隔离键名
assert(dataAdapterContent.includes('personal-feed:demo:v1'), '必须使用独立存储键 personal-feed:demo:v1');
console.log('✓ 存储隔离键名静态核查通过');

// 5. 检查 demo-feed.json
const demoJson = JSON.parse(demoFeedContent);
assert.strictEqual(demoJson.schema_version, '0.1', 'schema_version 应为 0.1');
assert.strictEqual(demoJson.mode, 'demo', 'mode 必须为 demo');
assert(Array.isArray(demoJson.items) && demoJson.items.length >= 4, 'items 至少提供 4 条演示数据');
console.log('✓ demo-feed.json 静态数据契约核查通过');

console.log('\n======================================================');
console.log('  静态代码与规范文本检查通过（非实际浏览器渲染核验）');
console.log('======================================================');
