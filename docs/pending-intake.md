# 待筛选进料口

公开首页的「贴链接」和 Overheard 都把一条 X 精华帖交给这个接口。服务按帖子编号去重，写在私有 KV `DOT_INBOX` 的 `pending:` 前缀下。

两条路：

- **首页贴链接**，以及 **不在 KOSX 账号池里** 的投递：只记 `pending`。这个 POST 不改写 `PUBLIC_FEED`。要上公开首页，用接收码调用 [待筛选过审](pending-review.md)。
- **投递密钥**送来的帖，作者账号在 KOSX 账号池里，并且按当前首页规则 **不会进入「昨日最被低估」**：写入队列后立刻标成 `approved`，并写入 `PUBLIC_FEED`。这是账号池资格，不是粉丝数。不按万粉或粉丝数排序，也不给粉丝多的人靠前。
- 同一条如果 **会进入「昨日最被低估」**（落在首页用来计算该栏的「昨日」里）：保持 `pending`，不自动放上首页。昨日最被低估必须人工过审。

已经 `rejected` 的链接不会被重新打开。已经 `approved` 的链接不改原来的过审时间。首页先贴过的同一条，来源记为 `homepage`，之后即使用投递密钥再送一次，也不会自动过审。

**当前仓库改动还没有部署。** 下面的地址要等有人在仓库根目录执行 `npx wrangler deploy` 之后才会出现在预览 Worker `woyun-feed-preview` 上。不要把这次部署打到名为 `woyun` 的 Worker。部署前，对现网地址发 POST 不会进入这套待筛选。

## 给 Overheard 的调用

- 地址：`https://woyun-feed-preview.hhzovo66.workers.dev/api/dot/pending`
- 方法：`POST`
- 鉴权：`Authorization: Bearer <投递密钥>`。这把密钥与 `POST /api/dot/inbox` 是同一把原始投递密钥，不是哈希。哈希存在 Worker secret `DOT_DELIVERY_TOKEN_HASH`。密钥只能放在这个请求头里，不要放进网址、正文或日志。
- 请求头还要带 `Content-Type: application/json`。
- 服务端调用不要带 `Origin`。如果带了，必须等于站点自己的源；其他源返回 `403`。
- 正文可以是一条：`{"url":"https://x.com/name/status/123","author_handle":"name","note":"可选","review_type":"教程指南","bookmark_count":120,"like_count":80,"has_article":true,"text":"可选摘录"}`。除 `url` 外都可以省略。
- 也可以一次最多 20 条：`{"items":[{"url":"https://x.com/name/status/123","note":"可选","review_type":"避坑","bookmark_count":40,"like_count":20,"has_article":false},{"url":"https://x.com/name/status/456"}]}`。
- 过审信号（只在带投递密钥时接受；首页贴链接仍只能提交 `url`）：
  - `review_type`：`文章`、`教程指南`、`避坑`、`短帖`、`产品安利` 之一。省略时，服务按 `note`、`text`、`has_article` 粗分。`note` 写成 `类型：教程指南`，或整段备注就是这五个词之一，也会当作指定类型。
  - `bookmark_count`、`like_count`：非负整数。省略表示未知，不会用另一个数去补。
  - `has_article`：`true` 或 `false`，表示这条是不是 X Article 卡。省略表示未知。
  - `text`：单行摘录，最长 800 字，用来粗分类型。不要放密钥。
- 这些字段只帮助接收码过审时排序。它们不改变原来的过审规则，也不会把帖钉进昨日低估栏。重复投递不改第一次写下的类型、热度和备注。
- `url` 必须是 `https://x.com`、`twitter.com` 或 `mobile.twitter.com` 上的 `/{账号}/status/{数字}`。服务收成 `https://x.com/{账号}/status/{数字}`，去重键是状态编号。
- `author_handle` 如果出现，必须和链接里的账号一致，忽略大小写。
- `note` 最长 400 字，单行，不能夹带密钥或密码样式的文本。
- 同一批里不能重复同一条帖子。

```sh
curl -sS -X POST 'https://woyun-feed-preview.hhzovo66.workers.dev/api/dot/pending' \
  -H 'Authorization: Bearer <投递密钥>' \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"url":"https://x.com/name/status/123","note":"可选"},{"url":"https://x.com/name/status/456"}]}'
```

新链接返回 `201`。整批都已经在队列里、而且状态没有从待筛选改成过审时返回 `200`。批量正文的形状是：

```json
{"status":"partial","results":[{"id":"kosx-123","key":"x:123","url":"https://x.com/name/status/123","author_handle":"name","status":"approved","submitted_at":"2026-10-13T00:00:00.000Z","reviewed_at":"2026-10-14T01:00:00.000Z","approval":"pool","note":"可选","source":"delivery","existing":false,"pool":true,"published":true,"message":"账号池成员的精华帖已按时间放上公开首页，不进入昨日最被低估。"},{"id":"kosx-456","key":"x:456","url":"https://x.com/name/status/456","author_handle":"name","status":"pending","submitted_at":"2026-10-13T00:00:00.000Z","note":"","source":"delivery","existing":false,"pool":true,"published":false,"message":"这条会进入昨日最被低估，保持待筛选，需接收码人工过审。"}]}
```

单条正文则直接返回上面 `results` 里的那一个对象，不包在 `results` 里。批量的 `status` 是 `approved`（全部已上首页）、`partial`（有的上了、有的还在待筛选）或 `pending`（都还在待筛选）。

`published: true` 才表示这条已经写入公开首页。`approval: "pool"` 表示账号池自动过审；`pool: false` 表示作者不在账号池。`existing: true` 表示队列里本来就有这条；服务不改原来的提交时间、备注，也不把 `rejected` 改回去。已经在首页上的重复投递仍返回「这条已经在公开首页。」，过审时间不变。

账号池自动上首页的帖按过审时间进入最新封面，和别的已过审封面帖同一套时间顺序。首页计算「昨日最被低估」时会跳过 `approval: "pool"` 的帖。接收码后来再标一次 `approved`，会把 `approval` 改成 `review`，过审时间不变，这条才可以进入昨日最被低估。

队列最多 300 条。再加新链接时返回 `409`，正文是「待筛选已满，请先处理已有链接。」状态没有变化的重复链接返回 `200`。原本在待筛选、这次由账号池放上首页的，返回 `201`。这些记录不设过期时间。

`401`：投递密钥不对，或用了接收码来提交。`400` / `413` / `415`：修正链接、备注或 JSON 后再试。`503`：预览 Worker 还没配好两把密钥哈希，或存储暂时不可用；不要把这次失败说成已经进入待筛选。

## 读取队列

读取用接收码，也就是哈希存在 `DOT_REVIEW_TOKEN_HASH` 的那把原始密钥。投递密钥不能读，接收码不能提交。

```sh
curl -sS 'https://woyun-feed-preview.hhzovo66.workers.dev/api/dot/pending' \
  -H 'Authorization: Bearer <接收码>'
```

返回 `{items, next_cursor}`，每页最多 50 条。下一批把上一页的 `next_cursor` 放在 `?cursor=`。每条含 `note` 和 `source`（`homepage` 或 `delivery`）。没有其他查询参数；不要把密钥放进网址。

## 账号池从哪里来

账号池是 [https://impact.kosx.ai/api/members](https://impact.kosx.ai/api/members) 的公开 `members[].handle`。Worker 不在每次请求时访问这个地址，也只保存账号，不保存粉丝数、显示名或其他字段。名单在 `frontend/kosx-pool.js`。更新时在仓库根目录执行：

```sh
node frontend/refresh-kosx-pool.mjs
```

脚本只写入小写 handle。确认 diff 里没有粉丝数之后再提交。预览 Worker 要等这次提交部署之后才会用新名单。部署步骤见 [预览部署](preview-deploy.md)。不要部署名为 `woyun` 的 Worker。

## 给 Overheard 的结果怎么读

继续用投递密钥 POST 到 `/api/dot/pending`。不要改用接收码，接收码不能提交。

- `published: true` 且 `approval: "pool"`：作者在账号池里，这条最新精华帖已经在公开首页。不要再等人工过审，也不要按粉丝数决定送不送。
- `status: "pending"` 且说明里写昨日最被低估：作者虽在池内，但这条会进入该栏，必须等接收码人工过审。不要把它说成已经上首页。
- `pool: false`：作者不在账号池，仍是待筛选，和以前一样等接收码。
- `status: "rejected"`：这条已经被略过，重复 POST 不会把它放回首页。

首页「贴链接」没有这些字段。它只进入待筛选。

## 首页贴链接

浏览器只提交 `{"url":"https://x.com/..."}`，不带 `Authorization`，也不带备注或 `items`。没有投递密钥时，备注和批量都会得到 `401`，提示「带备注或批量提交需要投递密钥。」

成功后页面仍写「已进入待筛选」；服务回答这条已经在队列里时，写「这条已在待筛选里」。服务拒绝或网络失败时，不写这两句，也不把链接只留在这个浏览器里。

浏览器不保存、不发送投递密钥或接收码。Worker 必须已经配置 `DOT_DELIVERY_TOKEN_HASH` 和 `DOT_REVIEW_TOKEN_HASH`，而且两把哈希不同。缺配置时 `/api/dot/pending` 与 `/api/dot/inbox` 一样返回 `503`，不回退到公开文件。本机 `node frontend/serve.js` 没有这条路由，贴链接在纯静态本地服务上会失败；要打到已部署的预览 Worker。

无密钥的单条提交是公开的：任何能访问该地址的客户端都可以放入一条 X 链接。它只能进入待筛选，队列有 300 条上限，不能读取备注，也不能写公开首页。已经过审或已略过的链接再贴一次，不会被退回 `pending`。

过审和从首页撤回见 [待筛选过审](pending-review.md)。
