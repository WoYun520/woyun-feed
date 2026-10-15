# Levi flow

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

本机过审页是 `http://127.0.0.1:3000/review-admin`，也是唯一的过审入口。双击「打开过审.command」，或先双击「打开 Levi flow.command」再打开这个地址。接收码放在 `.local/dot-review-token`（一行）或环境变量 `DOT_REVIEW_TOKEN`，浏览器里不用粘贴。公开首页没有「待过审」或「待筛选」链接，`#review` 和 `?review=1` 也不会打开过审。说明见 [docs/pending-review.md](docs/pending-review.md)。

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

浏览器不发送收件箱密钥。首页「贴链接」会请求 `/api/dot/pending`，只提交一条 X 链接。未设置下面两把哈希时，`/api/dot/inbox` 和 `/api/dot/pending` 都返回不可用，不回退到公开文件，贴链接也不会写入待筛选。两把密钥必须是不同的 SHA-256 十六进制值，只用 Wrangler secret 写入：

```sh
npx wrangler secret put DOT_DELIVERY_TOKEN_HASH
npx wrangler secret put DOT_REVIEW_TOKEN_HASH
```

原始投递密钥、接收码和 `CLOUDFLARE_API_TOKEN` 只留在本机。`.gitignore` 已忽略 `.env`、`.env.*`、`.dev.vars` 和 `.wrangler/`。不要把它们提交进仓库。

Overheard 用同一把投递密钥把 X 链接送进 `/api/dot/pending`，见 [docs/pending-intake.md](docs/pending-intake.md)。作者在 KOSX 账号池里、且不会进入「昨日最被低估」时，这条会按时间写入公开首页，不按粉丝数排序。首页贴链接、池外作者，以及会进入昨日最被低估的帖，仍只记 pending。过审用接收码，见 [docs/pending-review.md](docs/pending-review.md)；只有 `approved` 会写入公开首页。昨日最被低估必须人工过审。把已经在公开首页上的帖钉进「昨日最被低估精华帖」也用这把接收码，见 [docs/underrated-upload.md](docs/underrated-upload.md)。投递密钥不能钉选。

更细的预览步骤见 [docs/preview-deploy.md](docs/preview-deploy.md)。

---

# Levi flow

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

The local review page is `http://127.0.0.1:3000/review-admin`, and it is the only review entry. Double-click `打开过审.command`, or start with `打开 Levi flow.command` and open that address. Put the review code in `.local/dot-review-token` (one line) or `DOT_REVIEW_TOKEN`. The browser does not ask for it. The public homepage has no pending-review link, and `#review` or `?review=1` does not open one. See [docs/pending-review.md](docs/pending-review.md).

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

The browser does not send inbox secrets. Homepage paste calls `/api/dot/pending` with one X URL. Without the two hashes below, both `/api/dot/inbox` and `/api/dot/pending` stay unavailable and do not fall back to the public file, so paste does not enter the queue. Store two different SHA-256 hex hashes as Worker secrets:

```sh
npx wrangler secret put DOT_DELIVERY_TOKEN_HASH
npx wrangler secret put DOT_REVIEW_TOKEN_HASH
```

Keep the raw delivery token, review code, and `CLOUDFLARE_API_TOKEN` on your machine. `.gitignore` already ignores `.env`, `.env.*`, `.dev.vars`, and `.wrangler/`.

Overheard posts X links to `/api/dot/pending` with that same delivery token. See [docs/pending-intake.md](docs/pending-intake.md). A KOSX pool author is published in chronological order when the post would not enter Yesterday's most underrated. Homepage paste, authors outside the pool, and any post that would enter that section stay `pending`. Approval uses the review code; see [docs/pending-review.md](docs/pending-review.md). That underrated section always needs a human review. There is no follower-count ordering.

Preview details: [docs/preview-deploy.md](docs/preview-deploy.md).
