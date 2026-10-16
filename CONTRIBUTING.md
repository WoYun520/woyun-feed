# 参与修改

公开产品名是 **Levi flow**。协作时沿用仓库里的中文栏名：最新精华、昨日全部、昨日最被低估、七日精选、卧云精选。

## 改之前

1. 先看 [README.md](README.md)、[docs/architecture.md](docs/architecture.md) 和 [docs/ops-cron.md](docs/ops-cron.md)，确认这件事是不是已经有入口。
2. 页面和栏规则改 `frontend/`。`public-dist/` 是 `node frontend/public-build.mjs` 的结果，手改会被下一次构建盖掉。
3. 一次 PR 围着一件事。说明改了哪些文件、访客能看到什么、哪些还没做。
4. 内容要能对上来源。没有依据就写成未知。不要补造实测、热度、价格或上线效果。

## 不要带进仓库的东西

- 密钥、接收码、投递密钥、`CLOUDFLARE_API_TOKEN`，以及它们的哈希以外的原文
- `.env`、`.dev.vars`、`.local/`、`.wrangler/`
- 私人收藏、主题笔记、本机收件箱、`outputs/` 里的运行证据

`wrangler.example.jsonc` 里的 `SET_YOUR_OWN_*` 是占位符。

## 部署边界

`wrangler.jsonc` 只发布预览 Worker `woyun-feed-preview`。生产 Worker `woyun` 要等 Levi 另外开口。PR 本身不部署。需要发布预览时，在 PR 里写明，由维护者在本机执行 `npx wrangler deploy`。

## 检查

在 `frontend/` 里：

```sh
npm test
```

这是整套 Node 测试加 `check-static.js`，时间比较长。只动到一个模块时，可以先跑对应的 `node --test test-<name>.js`。和定时、栏规则相关的常用文件是 `test-essence-sweep.js`、`test-home-showcase.js`、`test-local-review.js`。

改了会进公开站的页面之后，再跑一次 `node frontend/public-build.mjs`，把 `public-dist/` 的差异放进同一个 PR。

## 提 PR

分支从 `main` 拉出。说明里写清访客路径（哪一条栏、本机过审，或只有文档），以及有没有动到预览 Worker 的行为。文档默认用中文，产品词保持中文；对外名称写 Levi flow。
