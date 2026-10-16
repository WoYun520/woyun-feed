import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installationId } from './installation.js';
import { launchOpenPath } from './local-review.js';

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function checkServer(port, expectedId) {
  return new Promise(resolve => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/api/health', agent: false }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; if (body.length > 4096) req.destroy(); });
      res.on('end', () => {
        try {
          const health = JSON.parse(body);
          resolve(res.statusCode === 200 && health.app === 'personal-feed' && health.protocol === 1
            && health.installation_id === expectedId ? 'ready' : 'occupied');
        } catch { resolve('occupied'); }
      });
      res.on('error', () => resolve('occupied'));
    });
    req.setTimeout(1000, () => req.destroy());
    req.on('error', error => resolve(error.code === 'ECONNREFUSED' ? 'absent' : 'occupied'));
  });
}

export function openLocalPage(url) {
  if (process.platform !== 'darwin') throw Error('桌面入口目前支持 Mac；可以自行打开页面网址。');
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/open', [url], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(Error('浏览器未能打开，请自行打开页面网址。')));
  });
}

export async function launchFeed({ directory = frontendDir, port = 3000, timeoutMs = 15000, openPage = openLocalPage, openPath = '/' } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('启动端口无效。');
  if (Number(process.versions.node.split('.')[0]) < 22) throw Error('需要 Node.js 22 或更新版本，请先安装。');
  const expectedId = installationId(directory);
  const url = `http://127.0.0.1:${port}${launchOpenPath(openPath)}`;
  const initial = await checkServer(port, expectedId);
  if (initial === 'occupied') throw Error(`端口 ${port} 正在被其他服务或另一份信息流占用。请先关闭它，再重新打开；不会切换网址或修改已有收藏。`);
  let child, logFile, childError, childExited = false;
  if (initial === 'absent') {
    const logDir = path.resolve(directory, '..', '.local');
    fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
    logFile = path.join(logDir, 'startup.log');
    const fd = fs.openSync(logFile, 'a', 0o600);
    try {
      child = spawn(process.execPath, [path.join(directory, 'serve.js')], {
        cwd: directory, env: { ...process.env, PORT: String(port) }, detached: true, stdio: ['ignore', fd, fd]
      });
      child.on('error', error => { childError = error; });
      child.on('exit', () => { childExited = true; });
      child.unref();
    } finally { fs.closeSync(fd); }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await checkServer(port, expectedId);
      if (state === 'ready') break;
      if (state === 'occupied') throw Error(`端口 ${port} 被其他服务占用，未打开该页面。`);
      if (childError) throw Error(`信息流未能启动。请查看启动记录：${logFile}`);
      // A simultaneous double-click may lose the listen race; wait for its peer's health check.
      await sleep(200);
    }
    if (await checkServer(port, expectedId) !== 'ready') {
      // Stop only this launch's own child; leave existing services and saved data alone.
      if (!childExited && child.pid) { try { process.kill(child.pid, 'SIGTERM'); } catch {} }
      throw Error(`${childExited ? '信息流未能启动' : '启动等待超时'}。请重新双击入口；启动记录：${logFile}`);
    }
  }
  await openPage(url);
  return { url, reused: initial === 'ready', pid: child?.pid, logFile };
}

export async function runLaunchCli({env = process.env, launch = launchFeed, log = console.log, errorLog = console.error} = {}) {
  try {
    const result = await launch({openPath: env.LEVI_OPEN_PATH});
    log(`${result.reused ? '信息流已在运行，已打开页面。' : '信息流已启动，已打开页面。'}\n${result.url}\n可以关闭这个终端窗口，网站会继续在本机运行。`);
    return {ok:true, result};
  } catch (error) {
    const message = error?.message || '信息流未能启动。';
    errorLog(message);
    return {ok:false, message};
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outcome = await runLaunchCli();
  if (!outcome.ok) process.exitCode = 1;
}
