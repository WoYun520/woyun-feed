# 卧云信息流

公开首页是封面帖：KOSX 助力条、贴链接、已助力计数，以及精选封面。静态页面在 `public-dist`，由 Cloudflare Worker 提供。

## 本机查看

需要 Node.js 20 或更新版本。

```sh
git clone https://github.com/WoYun520/woyun-feed.git
cd woyun-feed
node frontend/public-build.mjs
cd frontend && node serve.js
```

浏览器打开 `http://127.0.0.1:3000/`。`serve.js` 只监听本机。没有 `data/live-feed.json` 时，公开构建沿用已提交的 `public-dist/data/public-feed.json`，不会重新抓取来源。

## 预览部署

根目录 `wrangler.jsonc` 指向现有预览 Worker `woyun-feed-preview`（账号 `2406ce3e27726cda95852f23951dfc93`）。静态目录是 `./public-dist`。KV 绑定是 `PUBLIC_FEED` 与 `DOT_INBOX`，命名空间 id 写在该文件里。定时为每天 01:00 与 13:00 UTC（北京时间 09:00、21:00）。

先构建，再部署：

```sh
node frontend/public-build.mjs
npx wrangler deploy
```

预期地址：`https://woyun-feed-preview.hhzovo66.workers.dev/`

本机需要已登录的 Wrangler，或环境变量 `CLOUDFLARE_API_TOKEN`（Workers 脚本写权限）。不要把令牌写进仓库。不要把这份配置部署到已有 Worker `woyun`。

## 自己的生产环境

仓库里没有第二份生产配置。协作者要部署自己的站点时，复制 `wrangler.example.jsonc` 为自己的 `wrangler.jsonc`，填入自己的 `account_id`，以及自己创建的 `PUBLIC_FEED`、`DOT_INBOX` 两个 KV id，把 `name` 改成自己的 Worker 名，然后同样执行：

```sh
node frontend/public-build.mjs
npx wrangler deploy
```

这会发布到你自己的账号，不会改写上面的预览 Worker。

## 密钥

首页不依赖收件箱密钥。未设置时 `/api/dot/inbox` 返回不可用，不回退到公开文件。两把密钥必须是不同的 SHA-256 十六进制值，只用 Wrangler secret 写入：

```sh
npx wrangler secret put DOT_DELIVERY_TOKEN_HASH
npx wrangler secret put DOT_REVIEW_TOKEN_HASH
```

原始投递密钥、接收码和 `CLOUDFLARE_API_TOKEN` 只留在本机。`.gitignore` 已忽略 `.env`、`.env.*`、`.dev.vars` 和 `.wrangler/`。不要把它们提交进仓库。

更细的预览步骤见 [docs/preview-deploy.md](docs/preview-deploy.md)。

---

# Woyun Feed

The public homepage is a cover feed: the KOSX strip, the paste-link panel, the local boost count, and the curated cover cards. `public-dist` is the static site served by a Cloudflare Worker.

## Run locally

Node.js 20 or newer.

```sh
git clone https://github.com/WoYun520/woyun-feed.git
cd woyun-feed
node frontend/public-build.mjs
cd frontend && node serve.js
```

Open `http://127.0.0.1:3000/`. `serve.js` listens on localhost only. Without `data/live-feed.json`, the public build reuses the committed `public-dist/data/public-feed.json` and does not refetch sources.

## Preview deploy

`wrangler.jsonc` targets the existing preview Worker `woyun-feed-preview` (account `2406ce3e27726cda95852f23951dfc93`). Assets come from `./public-dist`. KV bindings are `PUBLIC_FEED` and `DOT_INBOX`; the namespace ids are in that file. Cron is `0 1,13 * * *` UTC (09:00 and 21:00 Asia/Shanghai).

```sh
node frontend/public-build.mjs
npx wrangler deploy
```

Expected URL: `https://woyun-feed-preview.hhzovo66.workers.dev/`

Wrangler must already be logged in, or `CLOUDFLARE_API_TOKEN` must be set in the environment (Workers script write). Do not commit the token. Do not deploy this config onto the existing Worker named `woyun`.

## Your own production Worker

This repo has no second production config. To publish your own copy, start from `wrangler.example.jsonc`, set your `account_id`, your own `PUBLIC_FEED` and `DOT_INBOX` KV ids, and your Worker `name`, then run the same build and `npx wrangler deploy`. That publishes to your account and does not change the preview Worker above.

## Secrets

The homepage does not need inbox secrets. Without them, `/api/dot/inbox` stays unavailable and does not fall back to the public file. Store two different SHA-256 hex hashes as Worker secrets:

```sh
npx wrangler secret put DOT_DELIVERY_TOKEN_HASH
npx wrangler secret put DOT_REVIEW_TOKEN_HASH
```

Keep the raw delivery token, review code, and `CLOUDFLARE_API_TOKEN` on your machine. `.gitignore` already ignores `.env`, `.env.*`, `.dev.vars`, and `.wrangler/`.

Preview details: [docs/preview-deploy.md](docs/preview-deploy.md).
