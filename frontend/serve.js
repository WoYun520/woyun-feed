#!/usr/bin/env node

/**
 * Levi flow · 本地预览与固定公开来源服务
 * 规范：
 * 1. 提供 frontend 静态文件、demo 数据、缓存读取与手动更新接口
 * 2. 严格检查路径边界，防范路径穿越
 * 3. 捕获非法 URI 编码并返回 400，防止服务崩溃
 * 4. 仅监听 127.0.0.1
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MultiFeedService as FeedService } from './multi-feed-service.js';
import { ResearchService, researchError } from './research-service.js';
import { stopCodexReaders } from './codex-reader.js';
import { RepositoryGuideService } from './repository-guide-service.js';
import { installationId } from './installation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FRONTEND_DIR = path.resolve(__dirname);
const ROOT_DIR = path.resolve(__dirname, '..');
const DEMO_FEED_FILE = path.resolve(ROOT_DIR, 'data', 'demo-feed.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveRequestPath(requestUrl) {
  let pathname;
  try {
    const rawPath = requestUrl.split('?')[0];
    const decodedRaw = decodeURIComponent(rawPath);

    // 显式拦截带有 .. 的穿越请求
    if (decodedRaw.includes('..')) {
      const resolved = path.resolve(FRONTEND_DIR, '.' + decodedRaw);
      const isInside = resolved === FRONTEND_DIR || resolved.startsWith(FRONTEND_DIR + path.sep);
      const isDemo = resolved === DEMO_FEED_FILE;
      if (!isInside && !isDemo) {
        return { errorStatus: 403, errorMessage: '403 Forbidden' };
      }
    }

    const parsed = new URL(requestUrl, 'http://127.0.0.1');
    pathname = decodeURIComponent(parsed.pathname);
  } catch (err) {
    // 捕获畸形 URL 编码（如 /%E0%A4%A 等），返回 400 避免进程崩溃
    return { errorStatus: 400, errorMessage: '400 Bad Request: Malformed URI' };
  }

  let filePath;
  if (pathname === '/' || pathname === '') {
    filePath = path.join(FRONTEND_DIR, 'index.html');
  } else if (pathname === '/data/demo-feed.json') {
    filePath = DEMO_FEED_FILE;
  } else {
    filePath = path.resolve(FRONTEND_DIR, '.' + pathname);
  }

  const isInsideFrontend = filePath === FRONTEND_DIR || filePath.startsWith(FRONTEND_DIR + path.sep);
  const isDemoFeed = filePath === DEMO_FEED_FILE;

  if (!isInsideFrontend && !isDemoFeed) {
    return { errorStatus: 403, errorMessage: '403 Forbidden' };
  }

  return { filePath, pathname };
}

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('405 Method Not Allowed');
    return;
  }

  const result = resolveRequestPath(req.url);

  if (result.errorStatus) {
    res.statusCode = result.errorStatus;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(result.errorMessage);
    return;
  }

  const { filePath, pathname } = result;

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(`404 Not Found: ${pathname}`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-cache');

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('500 Internal Server Error');
      }
    });
    stream.pipe(res);
  });
}

export function createFeedServer({ service = new FeedService({ dataDir: path.join(ROOT_DIR, 'data') }), research, guides } = {}) {
  const dataDir=service.dataDir || path.join(ROOT_DIR,'data');
  research ||= new ResearchService({ dataDir, feed: service });
  guides ||= new RepositoryGuideService({dataDir,feed:service});
  const server = http.createServer(async (req, res) => {
    const host = req.headers.host || '';
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return json(403, { error: '请通过本机地址访问。' });
    const route = req.url.split('?')[0];
    if (route.startsWith('/api/')) {
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return json(403, { error: '只接受本页面的请求。' });
      if (req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: '只接受本页面的请求。' });
      try {
        if (route === '/api/health' && req.method === 'GET') return json(200, {
          app: 'personal-feed', protocol: 1, installation_id: installationId(FRONTEND_DIR)
        });
        if (route === '/api/research' && req.method === 'POST') {
          if (req.headers['x-personal-feed'] !== '1' || !String(req.headers['content-type']).startsWith('application/json')) return json(403, { error: '请通过页面开始整理。' });
          const chunks = []; let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 16000) throw researchError('问题过长，请缩短后重试。', 413);
            chunks.push(chunk);
          }
          let input;
          try { input = JSON.parse(Buffer.concat(chunks).toString()); }
          catch { throw researchError('请求格式错误。'); }
          return json(202, await research.start(input));
        }
        if (route.startsWith('/api/research/') && req.method === 'GET') return json(200, await research.get(route.slice('/api/research/'.length)));
        if (route === '/api/repository-guides' && req.method === 'GET') return json(200, await guides.status());
        if (route === '/api/repository-guides' && req.method === 'POST') {
          if (req.headers['x-personal-feed'] !== '1') return json(403,{error:'请通过页面整理中文用途。'});
          req.resume();
          return json(202,await guides.start());
        }
        if (route === '/api/feed' && req.method === 'GET') return json(200, await guides.decorate(await service.current()));
        if (route === '/api/feed/refresh' && req.method === 'POST') {
          if (req.headers['x-personal-feed'] !== '1') return json(403, { error: '请在信息流页面点击更新。' });
          // No arbitrary URLs, account tokens or user profile text are accepted.
          req.resume();
          return json(200, await guides.decorate(await service.refresh()));
        }
        return json(405, { error: '请求方式不支持。' });
      } catch (error) { return json(error.status || 500, { error: error.status ? error.message : '本机服务暂时无法处理，请稍后重试。' }); }
    }
    serveStatic(req, res);
  });
  server.stopResearch = async () => { await stopCodexReaders(); await Promise.all([research.work,guides.work]); };
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const port = Number(process.env.PORT || 3000);
  const server = createFeedServer();
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return; stopping = true; server.close();
    await server.stopResearch(); process.exit(0);
  };
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
  server.on('error', error => { console.error(`启动失败：${error.code}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Levi flow：http://127.0.0.1:${port}/`));
}
