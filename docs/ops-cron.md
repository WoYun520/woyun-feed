# 定时、密钥与预览部署

预览 Worker：`woyun-feed-preview`。地址：<https://woyun-feed-preview.hhzovo66.workers.dev/>。配置在仓库根目录 `wrangler.jsonc`。生产 Worker `woyun` 不在这次部署里。把代码推进 Git 不会自动发布。

## 两条定时

时区对照：

| Worker cron（UTC） | 北京时间 | 跑什么 |
| --- | --- | --- |
| `0 0,4,8,12 * * *` | 08:00、12:00、16:00、20:00 | 精华扫榜 |
| `0 1,13 * * *` | 09:00、21:00 | 公开刷新 |

`worker.js` 的 `scheduled` 用 cron 字符串分支：等于 `ESSENCE_SWEEP_CRON`（`frontend/essence-schedule.js`）就跑 `runEssenceSweep`，另一条跑 `runScheduledUpdate`。

### 精华扫榜改队列

扫榜读 KV 里已经有的公开快照，不抓 GitHub、RSS、SoPilot 或 Hacker News，也不调用 X API 或模型。一轮里它做这些事：

1. 留下作者在账号池里、原帖北京日是今天或昨天、队列里还没有的帖。同一状态编号只留一条。已经 `rejected` 的不重新打开。
2. 每轮最多新写 20 条（`ESSENCE_INTAKE_CAP`）。池内帖子走和投递密钥相同的进队路径，先记 `pending`，不当场上首页。
3. 把来源为 `delivery` 或 `homepage`、仍是 `pending`、提交时间早于现在超过 1 小时的记录标成 `approved`，`approval` 为 `auto`。刚好 1 小时继续等人。账号池作者参加这一条。这一步不钉「昨日最被低估」。4. 把快照里已有的 `bookmark_count` / `like_count` 补进精华线。缺了就空着，不写成 0。封面和摘录也按同样的「只补空缺」回填。

队列这一轮有变化时，扫榜调用 `publishApprovedFeed`，把已过审的精华行接到**现有**快照上。这不是首页快照的整表重建。

扫帖失败会退避：下一轮先等 6 小时，再失败等 12 小时，之后最多等 24 小时。自动过审和热度回填不跟着停。

最坏一轮：X API 0 次，模型 0 token，名单 GET 最多 1 次（`impact.kosx.ai` 的缓存超过 1 小时才再拉），新进队最多 20 条。想少写队列，把 `ESSENCE_INTAKE_CAP` 调小。

Overheard 若在调用投递口之前自己扫过 X 或模型，那笔开销在它自己那边。快照里还没有的帖，仍由 Overheard 用投递密钥 `POST /api/dot/pending` 送来。

### 公开刷新才重建首页快照

公开刷新仍由 `0 1,13 * * *` 这一条定时启动，不另加 cron。它重读固定公开来源，刷新账号池缓存，做热度回填和满 1 小时自动过审，再把队列里 `approved` 的行接回快照，写入 `PUBLIC_FEED` 的 `public-feed:current:v1`。它不为了进队去扫 X。
所以：扫榜更新队列，并在队列有变化时把已过审行接到旧快照上；首页快照的整表更新发生在公开刷新。

整轮若挤在同一次 Worker 调用里，CPU 会顶到平台上限、快照写不进去。2026-11-06 用已提交快照（795 条，约 1.3 MB）在本机跑 `refreshPublicFeed`：Node CPU 约 1165 ms，墙钟约 8 s。各来源正文解析合计约 116 ms（最重的一篇博客订阅约 31 ms），合并、生成快照和整包 JSON 大约 120 ms，其余主要是读入和解码响应正文。线上 2026-11-05 13:00 UTC 在 CPU 约 2050 ms、墙钟约 52 s 时结果是 `exceededCpu`；次日 01:00 UTC 的指标是 `exceededResources`（同一类资源超限）。早班有时还能跑完，说明整轮刚好贴着这条线。

因此每次调用只做有界的一段，再由服务绑定 `SELF`（指向 `woyun-feed-preview` 自己）叫醒下一段。下一段是新的调用，CPU 从头计算。`wrangler.jsonc` 不增加 cron。

1. 每一段最多读 4 个来源（`PUBLIC_REFRESH_SOURCE_BATCH`）。账号池刷新只在第一段，失败不影响后面。已读来源记在 `PUBLIC_FEED` 的 `public-feed:refresh-job:v1`，不写首页键。
2. 来源都读完（或链条接不下去）之后，单独把热度回填、满 1 小时自动过审、封面摘录回填做完，再把已过审行接到快照上，然后才写入 `public-feed:current:v1`，并记住全部精华。
3. 还没读到的来源沿用上一份快照里的条目，不把它们标成失败。写失败则首页键不动。

定时入口若没有 `SELF`（本机测试就是这样），仍在同一次调用里做完上述步骤。精华扫榜的 cron 和时间不变。

## 软启动仍保留的自动过审

年龄按 `submitted_at`，没有则用 `created_at`。必须早于现在超过 1 小时。检查发生在精华扫榜和公开刷新，不另加每小时定时。
| 来源 | 进队当时 | 满 1 小时仍未人工处理 |
| --- | --- | --- |
| 首页贴链接 `homepage` | `pending` | `approved`，`approval: auto`，不钉低估 |
| 投递，作者不在账号池 | `pending` | `approved`，`approval: auto`，不钉低估 |
| 投递，作者在账号池 | `pending`，不写 `approval: pool` | 同一条 1 小时自动过审，不钉低估 |

「昨日最被低估」始终要人工钉。钉选步骤在 [underrated-upload.md](underrated-upload.md)。过审接口在 [pending-review.md](pending-review.md)。以前已经以 `approval: pool` 放上首页的旧行留在线上，新进料不再写这个标记。

## 密钥与本机变量

只写名称。值放在 Wrangler secret 或维护者自己的机器上。

| 名称 | 放在哪 | 用途 |
| --- | --- | --- |
| `DOT_DELIVERY_TOKEN_HASH` | Worker secret | 投递密钥的 SHA-256 十六进制。给 `/api/dot/inbox` 和带备注的 `/api/dot/pending` |
| `DOT_REVIEW_TOKEN_HASH` | Worker secret | 接收码的 SHA-256 十六进制。读队列、过审、钉低估 |
| `CLOUDFLARE_API_TOKEN` | 本机环境变量 | Wrangler 部署。Workers 脚本写权限 |
| `DOT_REVIEW_TOKEN` | 本机环境变量，或 `.local/dot-review-token` 一行 | 本机过审页用来调用预览 Worker。浏览器不粘贴 |
| `DOT_REVIEW_ORIGIN` | 本机环境变量，可选 | 过审上游。缺省是预览地址 |

两把哈希必须不同。缺任意一把时，`/api/dot/inbox` 和 `/api/dot/pending` 返回不可用，不回退到公开文件，贴链接也不会写入待筛选。

```sh
npx wrangler secret put DOT_DELIVERY_TOKEN_HASH
npx wrangler secret put DOT_REVIEW_TOKEN_HASH
```

原始投递密钥和接收码不要写进仓库、备份、日志或网址。

## 发布预览

在仓库根目录：

```sh
node frontend/public-build.mjs
npx wrangler deploy
```

成功后的地址是 <https://woyun-feed-preview.hhzovo66.workers.dev/>。更细的构建说明在 [preview-deploy.md](preview-deploy.md)。

`wrangler.jsonc` 的 `name` 是 `woyun-feed-preview`。不要改成 `woyun` 再部署。自己的账号用 `wrangler.example.jsonc`，示例名是 `your-woyun-feed`。

账号池的仓库后备名单：

```sh
node frontend/refresh-kosx-pool.mjs
```

脚本只写小写 handle，并同时改 `frontend/kosx-pool.js` 与 `public-dist/kosx-pool.js`。确认 diff 里没有粉丝数之后再提交。进料用的在线名单以 KV 里的 `kosx_pool_handles` 为准。
