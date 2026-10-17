# Levi flow

**Levi flow** 是公开的精华封面站：KOSX 助力条、首页「贴链接」、已助力计数，以及按栏排好的 X 精华帖。熟人软启动挂在预览地址上，正式域名还没定。

预览：<https://woyun-feed-preview.hhzovo66.workers.dev/>

这份仓库的部署配置只指向预览 Worker `woyun-feed-preview`。生产 Worker `woyun` 要等 Levi 另外开口。

## 公开栏

整理日用公开快照的 `generated_at`，没有这份时间时用当前北京时间。精华线是过审或账号池写入公开首页的帖。信息流里没走上这条线的帖不进这些栏。

| 栏 | 规则 |
| --- | --- |
| 最新精华 | 最近 3 个北京时间自然日（含整理日），最多 18 条 |
| 昨日全部 | 整理日前一个北京时间自然日 |
| 昨日最被低估 | 人工从「昨日全部」钉选，最多 2 条，可以空着 |
| 七日精选 | 最近 7 个北京时间自然日里的精华文章，收藏数达到 200 |
| 卧云精选 | 不限日期的精华文章，收藏数达到 1000 |

占位标题 `@handle 的精华帖` 可以留在卡片上，只要摘录还在。没有可用摘录、又没有会画出来的封面或图片时，`blankPublicCover` 把这张空白封面排除在五条公开栏之外。这一步已经做在 `selectHomeShowcase` 里。七日精选在整批文章都没有收藏数时还有热度退路。说明见 [docs/architecture.md](docs/architecture.md)。

内容政策、投递满 3 小时自动过审，以及贴链接满 1 小时自动过审，也在那一页。

## 文档

| 读这个 | 为了 |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | 目录、请求怎么走、栏和内容政策 |
| [docs/ops-cron.md](docs/ops-cron.md) | 两条定时、队列和首页快照、密钥名称、预览部署边界 |
| [docs/pending-review.md](docs/pending-review.md) | 本机过审和放上首页 |
| [docs/pending-intake.md](docs/pending-intake.md) | 贴链接和 Overheard 进队 |
| [docs/underrated-upload.md](docs/underrated-upload.md) | 钉「昨日最被低估」 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 改代码、提 PR |
| [docs/README.md](docs/README.md) | `docs/` 里其余文件各管什么 |

## 目录

```text
worker.js                         请求与定时入口
dot-inbox-service.js              /api/dot/inbox
dot-pending-service.js            /api/dot/pending
dot-underrated-service.js         /api/dot/underrated
frontend/                         页面、采集、测试、本机服务
public-dist/                      已构建的静态站，Worker 直接托管
data/                             本机演示与目录，不是线上首页快照
scripts/                          feedgrab 采集和投递
wrangler.jsonc                    只描述预览 Worker
打开 Levi flow.command            Mac：打开本机首页
打开过审.command                  Mac：打开本机过审
```

静态资源在 `public-dist`。`/data/public-feed.json`、`/api/dot/*`、`/api/home-boost` 先进入 Worker，其余路径由静态资源处理。

## 本机查看

需要 Node.js 22 或更新版本。Mac 双击入口和 `frontend/launch.mjs` 会拒绝更低版本。

```sh
git clone https://github.com/WoYun520/woyun-feed.git
cd woyun-feed
node frontend/public-build.mjs
cd frontend && node serve.js
```

浏览器打开 `http://127.0.0.1:3000/`。`serve.js` 只监听 `127.0.0.1`。没有本机 `data/live-feed.json` 时，公开构建沿用已提交的 `public-dist/data/public-feed.json`，不会重新抓取来源。

Mac 上也可以双击仓库根目录的「打开 Levi flow.command」。这两个 `.command` 必须留在仓库根目录：它们把自己的上一级目录当成项目根。

本机过审页是 `http://127.0.0.1:3000/review-admin`，也是唯一的过审入口。Mac 上双击「打开过审.command」。接收码放在 `.local/dot-review-token`（一行）或环境变量 `DOT_REVIEW_TOKEN`，浏览器里不用粘贴。公开首页没有「待过审」入口，`#review` 和 `?review=1` 也不会打开过审。

本机过审由 `serve.js` 带着接收码去调用预览 Worker。默认上游是上面的预览地址，可用 `DOT_REVIEW_ORIGIN` 改成另一个 https 源。首页「贴链接」请求的是当前站点的 `/api/dot/pending`；本机 `serve.js` 没有这条路由，贴链接要在已部署的预览站上试。

## 预览与自己的 Worker

根目录 `wrangler.jsonc` 指向现有预览 Worker `woyun-feed-preview`（账号 `2406ce3e27726cda95852f23951dfc93`）。静态目录是 `./public-dist`。KV 绑定是 `PUBLIC_FEED` 与 `DOT_INBOX`。

```sh
node frontend/public-build.mjs
npx wrangler deploy
```

本机需要已登录的 Wrangler，或环境变量 `CLOUDFLARE_API_TOKEN`（Workers 脚本写权限）。把改动推进 Git 不会自动部署。不要把这份配置部署到 Worker `woyun`。

仓库里没有第二份生产配置。要在自己的账号上跑一份，从 `wrangler.example.jsonc` 复制，填自己的 `account_id` 和两个 KV id。示例里的 Worker 名是 `your-woyun-feed`，保留一个不会撞上 `woyun` 或 `woyun-feed-preview` 的名字。

## 密钥名称

浏览器不发送收件箱密钥。两把哈希必须是不同的 SHA-256 十六进制，只用 Wrangler secret 写入，值不要进仓库：

```sh
npx wrangler secret put DOT_DELIVERY_TOKEN_HASH
npx wrangler secret put DOT_REVIEW_TOKEN_HASH
```

原始投递密钥、接收码和 `CLOUDFLARE_API_TOKEN` 只留在本机。`.gitignore` 已忽略 `.env`、`.env.*`、`.dev.vars`、`.local/` 和 `.wrangler/`。名称和各定时任务见 [docs/ops-cron.md](docs/ops-cron.md)。

## English

**Levi flow** is the public name of this cover feed. The soft beta for acquaintances is the preview Worker `woyun-feed-preview`: <https://woyun-feed-preview.hhzovo66.workers.dev/>. A formal domain is still open. This repo’s Wrangler file targets that preview Worker. The production Worker `woyun` stays out of scope until Levi says otherwise.

The Chinese sections are the collaborator guide: public rails, local Mac review at `/review-admin`, cron, and secret names. Detail lives in `docs/architecture.md`, `docs/ops-cron.md`, and `CONTRIBUTING.md`.
