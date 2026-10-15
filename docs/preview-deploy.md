# 预览站构建与部署

本文件只记录 `woyun-feed-preview` 的构建和发布步骤。不要把 API token、投递密钥、接收码或它们的哈希写进仓库。

现有空壳 Worker `woyun` 与本预览无关，部署时不要指定那个名字。

## 构建

在仓库根目录执行：

```sh
node frontend/public-build.mjs
```

成功后会重写 `public-dist`。Worker 静态资源目录就是这个目录；`/data/public-feed.json` 与 `/api/dot/*` 先进入 Worker，其余路径由静态资源处理。

没有本机 `data/live-feed.json` 时，构建改用已提交的 `public-dist/data/public-feed.json`，并沿用其中的发布时间与自动更新标记。这不会重新抓取原站。有本机资料时仍只读取 `data/live-feed.json`。

## 部署

配置在根目录 `wrangler.jsonc`：Worker 名为 `woyun-feed-preview`，绑定已有 KV `PUBLIC_FEED` 与 `DOT_INBOX`，定时为每天 01:00 与 13:00 UTC（北京时间 09:00、21:00）。本机需要已登录的 Wrangler，或环境变量 `CLOUDFLARE_API_TOKEN`（Workers 脚本写权限）。令牌不要写入文件。

```sh
npx wrangler deploy
```

预期地址：`https://woyun-feed-preview.hhzovo66.workers.dev/`

## 收件箱密钥

浏览器不发送收件箱密钥。首页「贴链接」请求 `/api/dot/pending`，只提交一条 X 链接。未设置下面两把哈希时，`/api/dot/inbox` 和 `/api/dot/pending` 都返回不可用，不回退到公开文件，贴链接也不会写入待筛选。两把密钥必须是不同的 SHA-256 十六进制值，用 Wrangler secret 写入，名称是：

- `DOT_DELIVERY_TOKEN_HASH`
- `DOT_REVIEW_TOKEN_HASH`

```sh
npx wrangler secret put DOT_DELIVERY_TOKEN_HASH
npx wrangler secret put DOT_REVIEW_TOKEN_HASH
```

原始投递密钥和接收码只留在维护者本机，不进入公开构建、备份或文档。Overheard 用同一把投递密钥调用待筛选进料口，见 [待筛选进料](pending-intake.md)。进料自动过审的账号池在私有 KV `DOT_INBOX` 键 `kosx_pool_handles`。定时任务，以及缓存缺失或超过一小时的投递，会从 impact.kosx.ai 刷新这份名单，不必为了名单变化重新部署。拉取失败时沿用上次缓存，没有缓存时用 `frontend/kosx-pool.js`。`node frontend/refresh-kosx-pool.mjs` 只更新仓库里的后备名单。首页 KOSX 标记仍用已提交的那份。昨日低估栏钉选用同一把接收码，不新增密钥，见 [昨日低估上传](underrated-upload.md)。上面的部署命令只发布 `woyun-feed-preview`，不要部署名为 `woyun` 的 Worker。把进料代码推进仓库不会自动部署。
