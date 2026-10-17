# 待筛选进料口

公开首页的「贴链接」和 Overheard 都把一条 X 精华帖交给这个接口。服务按帖子编号去重，写在私有 KV `DOT_INBOX` 的 `pending:` 前缀下。

进料当时都只记 `pending`。这个 POST 不改写 `PUBLIC_FEED`，也不再写 `approval: "pool"`。

- **首页贴链接**（来源 `homepage`）和 **投递密钥**（来源 `delivery`）走同一条待筛选队列。作者在不在 KOSX 账号池里，都不当场过审。
- 账号池只说明作者资格：回答里 `pool: true`。不按万粉或粉丝数排序，也不给粉丝多的人靠前。
- 满 1 小时仍是 `pending` 时，定时任务会标成 `approved`，`approval` 为 `auto`，并写入公开首页。刚好 1 小时还不算超过。贴链接和投递、池内和池外都参加。这一步不钉「昨日最被低估」。人用接收码先处理的，走 [待筛选过审](pending-review.md)，`approval` 为 `review`。

已经 `rejected` 的链接不会被重新打开。已经 `approved` 的链接不改原来的过审时间。首页先贴过的同一条，来源仍记为 `homepage`。之后即使用投递密钥再送一次，也不会当场过审；满 1 小时仍未人工处理时，和投递一样自动过审。以前已经以 `approval: "pool"` 放上首页的旧行留在线上，这次进料不会新写这种标记。

预览地址是熟人软启动：`https://woyun-feed-preview.hhzovo66.workers.dev/`。把改动推进 Git 不会自动部署。发布只打 Worker `woyun-feed-preview`。不要部署名为 `woyun` 的 Worker。线上是否已经包含某次提交，以最近一次预览部署为准。

## 给 Overheard 的调用

- 地址：`https://woyun-feed-preview.hhzovo66.workers.dev/api/dot/pending`
- 方法：`POST`
- 鉴权：`Authorization: Bearer <投递密钥>`。这把密钥与 `POST /api/dot/inbox` 是同一把原始投递密钥，不是哈希。哈希存在 Worker secret `DOT_DELIVERY_TOKEN_HASH`。密钥只能放在这个请求头里，不要放进网址、正文或日志。
- 请求头还要带 `Content-Type: application/json`。
- 服务端调用不要带 `Origin`。如果带了，必须等于站点自己的源；其他源返回 `403`。
- 正文可以是一条：`{"url":"https://x.com/name/status/123","author_handle":"name","note":"可选","review_type":"教程指南","bookmark_count":120,"like_count":80,"has_article":true,"cover_url":"https://cdn.example.com/covers/article.jpg","text":"可选摘录","published_at":"2026-10-08T04:00:00.000Z","created_at":"2026-10-08T04:00:00.000Z"}`。除 `url` 外都可以省略。
- 也可以一次最多 20 条：`{"items":[{"url":"https://x.com/name/status/123","note":"可选","review_type":"避坑","bookmark_count":40,"like_count":20,"has_article":false,"published_at":"2026-10-08T04:00:00.000Z"},{"url":"https://x.com/name/status/456"}]}`。
- 过审信号（只在带投递密钥时接受；首页贴链接仍只能提交 `url`）：
  - `review_type`：`文章`、`教程指南`、`避坑`、`短帖`、`产品安利` 之一。省略时，服务按 `note`、`text`、`has_article` 粗分。`note` 写成 `类型：教程指南`，或整段备注就是这五个词之一，也会当作指定类型。
  - `bookmark_count`、`like_count`：非负整数。省略表示未知，不会用另一个数去补。
  - `has_article`：`true` 或 `false`，表示这条是不是 X Article 卡。省略表示未知。
  - `cover_url`：文章封面的 https 地址，最长 1500 字。必须能当成网址解析，路径不能是空的。不能带账号密码、端口或片段，也不能是本机、内网，或在地址里夹带密钥（包括查询参数名叫 token、password、api_key 的）。省略表示没有封面。空字符串、`http`、以及带密钥的地址都会拒绝，不会改成别的图。首页只在文章类卡片上使用它，没有封面时不另做假图。
  - `text`：摘录，最长 800 字，用来粗分类型，也是公开封面卡的正文。可以换行。超过 800 字会截断后收下，不会把整条链接拒掉。`excerpt`、`body`、`summary` 若单独送来，也当作摘录，取最长的一段。不要放密钥。
  - `published_at`、`created_at`：原帖发布时间，必须带时区（例如 X 的 `created_at`，或抓取这条链接时读到的 `published_at`）。省略表示未知。格式不对会拒绝，不会改成别的时间。
- 接收码过审或满 1 小时自动过审写入公开首页时，会带上已保存的 `bookmark_count`、`like_count`、`review_type`、`has_article`、`cover_url`。公开条目的 `published_at` 优先用进料里的 `published_at`，没有再用 `created_at`。两个都没有、且链接是 X 状态编号时，用 snowflake 推算原帖时间（Twitter 纪元 `1288834974657`，毫秒为 `(id >> 22) + 纪元`）。不是 X 状态编号的不编造时间。`source_item_time` 和 `captured_at` 仍是过审时间。这些字段不改变过审或略过的规则，也不会把帖钉进昨日低估栏。原帖时间如果落在「昨日」，账号池同样先停在待筛选，不当场放上首页。重复投递不改已经写下的类型、热度、摘录和真实备注，也不把 `rejected` 改回去。队列里还没有的 `bookmark_count`、`like_count`、`review_type`、`has_article`、`cover_url`、`text`，这次正文带了有效值就补上；已经有的保持原值。备注还是空的，或只是「@用户 的精华帖」时，这次带了真实标题就补上一次；已经写下的真实备注不改。已经写下的封面地址不会被后一次替换。收藏数为 `0`、`has_article` 为 `false` 都算已经写下，后来的数字或 `true` 不会替换。已经在队列里的同一条，如果这次带了可用的 `published_at` 或 `created_at`，仍会改写这两个时间。已经过审的，只要补上了信号、封面或改了时间，就按当前队列重写公开首页上的这一条，让公开条目带上收藏数和封面。已经略过的不补封面。过审时间不变，公开条目的 `source_item_time` 和 `captured_at` 仍是过审时间。
- `url` 必须是 `https://x.com`、`twitter.com` 或 `mobile.twitter.com` 上的 `/{账号}/status/{数字}`。服务收成 `https://x.com/{账号}/status/{数字}`，去重键是状态编号。
- `author_handle` 如果出现，必须和链接里的账号一致，忽略大小写。
- `note` 用来当标题。单行且不超过 400 字时原样留下。换行或超过 400 字时，第一行（最多 400 字）留下当标题，整段截到 800 字写入摘录，不再把这条链接拒掉。不能夹带密钥或密码样式的文本。
- 同一批里不能重复同一条帖子。

```sh
curl -sS -X POST 'https://woyun-feed-preview.hhzovo66.workers.dev/api/dot/pending' \
  -H 'Authorization: Bearer <投递密钥>' \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"url":"https://x.com/name/status/123","note":"可选"},{"url":"https://x.com/name/status/456"}]}'
```

新链接返回 `201`。整批都已经在队列里、而且状态没有从待筛选改成过审时返回 `200`。批量正文的形状是：

```json
{"status":"pending","results":[{"id":"kosx-123","key":"x:123","url":"https://x.com/name/status/123","author_handle":"name","status":"pending","submitted_at":"2026-10-13T00:00:00.000Z","note":"可选","source":"delivery","existing":false,"pool":true,"published":false,"message":"账号池成员的精华帖已进入待筛选。满 1 小时仍未人工处理会自动过审上公开首页。"},{"id":"kosx-456","key":"x:456","url":"https://x.com/outsider/status/456","author_handle":"outsider","status":"pending","submitted_at":"2026-10-13T00:00:00.000Z","note":"","source":"delivery","existing":false,"pool":false,"published":false}]}
```

单条正文则直接返回上面 `results` 里的那一个对象，不包在 `results` 里。新进料整批都还在待筛选时，批量的 `status` 是 `pending`。队列里已经过审的重复提交仍可能让某一行是 `approved`，这时批量 `status` 仍按全部 `approved`、有的 `approved`（`partial`）或都还在待筛选（`pending`）来标。

`published: true` 才表示这条已经写入公开首页。新进料不会返回 `approval: "pool"`。`pool: true` 只表示作者现在在账号池里，这条仍是 `pending`。`pool: false` 表示作者不在账号池，同样是待筛选。`existing: true` 表示队列里本来就有这条；服务不改原来的提交时间和真实备注，也不把 `rejected` 改回去。备注还是空的，或只是「@用户 的精华帖」时，这次带了真实标题会补上。已经在首页上的重复投递仍返回「这条已经在公开首页。」，过审时间不变。若这次带了可用的 `published_at` 或 `created_at`，公开首页上这条的 `published_at` 会改成这次的时间。队列里还没有的收藏数、点赞数、类型、Article 卡、摘录或封面地址，这次带了就会补上，并出现在这条公开条目上。已经有的不改。已经略过的不补封面。公开首页的文章类卡片会显示这张封面。没有封面时不放灰色占位，摘录的前一两行放大成金句；没有摘录就只留标题和来源时间。卡片不显示收藏数。

接收码过审和满 1 小时自动过审用同一套时间顺序：有进料原帖时间时用它，否则用 X snowflake，不再把过审时间当作原帖发布时间。不按粉丝数把谁排到前面。接收码后来再标一次 `approved`，会把 `approval` 改成 `review`，过审时间不变。以前写成 `approval: "pool"` 的旧行也一样。

队列最多 300 条。再加新链接时返回 `409`，正文是「待筛选已满，请先处理已有链接。」状态没有变化的重复链接返回 `200`。新链接返回 `201`。这些记录不设过期时间。

`401`：投递密钥不对，或用了接收码来提交。`400` / `413` / `415`：修正链接、备注或 JSON 后再试。`503`：预览 Worker 还没配好两把密钥哈希，或存储暂时不可用；不要把这次失败说成已经进入待筛选。

## 读取队列

读取用接收码，也就是哈希存在 `DOT_REVIEW_TOKEN_HASH` 的那把原始密钥。投递密钥不能读，接收码不能提交。

```sh
curl -sS 'https://woyun-feed-preview.hhzovo66.workers.dev/api/dot/pending' \
  -H 'Authorization: Bearer <接收码>'
```

返回 `{items, next_cursor}`，每页最多 50 条。下一批把上一页的 `next_cursor` 放在 `?cursor=`。每条含 `note` 和 `source`（`homepage` 或 `delivery`）。没有其他查询参数；不要把密钥放进网址。

## 账号池从哪里来

账号池是 [https://impact.kosx.ai/api/members](https://impact.kosx.ai/api/members) 的公开 `members[].handle`。进料用这份名单标 `pool`，不认粉丝数，也不凭名单当场过审。`latest_followers`、显示名和其他字段都丢掉，不写入 KV，也不写入公开首页。

预览 Worker 把小写 handle 存在私有 KV `DOT_INBOX` 的键 `kosx_pool_handles`。公开来源定时任务（每天 01:00 与 13:00 UTC，北京时间 09:00 与 21:00）会拉取名单并覆盖这个键。另有一条精华进队（UTC `0 0,4,8,12 * * *`，北京时间 08:00、12:00、16:00、20:00）只读已有公开快照，不调用 X；缓存不存在或早于一小时时，它最多再拉一次这份免费名单。投递到达时，缓存不存在或早于一小时，也会当场再拉一次。拉取成功后，名单变化不必再部署才能用于进料回答里的 `pool`。调用量和 1 小时自动过审见 [待筛选过审](pending-review.md)。

拉取失败时继续用上一次成功写入的缓存。还没有可用缓存时，用仓库里的 `frontend/kosx-pool.js`。名单拉取失败不会让进料接口失败，也不会把这一次投递记成失败。

首页上的 KOSX 标记仍读随静态资源发布的 `kosx-pool.js`，不读这份 KV。它要等下一次构建部署才换。

仓库里的后备名单用下面的命令从同一接口刷新。脚本只写入小写 handle，并同时更新 `frontend/kosx-pool.js` 与 `public-dist/kosx-pool.js`。确认 diff 里没有粉丝数之后再提交。

```sh
node frontend/refresh-kosx-pool.mjs
```

部署步骤见 [预览部署](preview-deploy.md)。不要部署名为 `woyun` 的 Worker。进料回答里的 `pool` 读 KV 里的账号池。公开刷新和精华扫榜会更新这份缓存，账号加入或退出之后不必为了这个标记再部署。首页上的 KOSX 标记仍要等下一次构建部署。

## 给 Overheard 的结果怎么读

继续用投递密钥 POST 到 `/api/dot/pending`。不要改用接收码，接收码不能提交。

- `pool: true` 且 `status: "pending"`：作者在账号池里，这条还在待筛选，没有上公开首页。满 1 小时仍未人工处理会自动过审。不要把它说成已经上首页，也不要按粉丝数决定送不送。
- `pool: false` 且 `status: "pending"`：作者不在账号池，同样待筛选。满 1 小时仍未人工处理也会自动过审。
- `published: true`：这条已经在公开首页。新进料不会因为账号池变成这样。重复投递一条已经过审的链接才会如此。
- `status: "rejected"`：这条已经被略过，重复 POST 不会把它放回首页。

首页「贴链接」没有 `pool` 和 `published`。它只进入待筛选，来源是 `homepage`。满 1 小时仍未人工处理，也会自动过审。

## 首页贴链接

浏览器只提交 `{"url":"https://x.com/..."}`，不带 `Authorization`，也不带备注或 `items`。没有投递密钥时，备注和批量都会得到 `401`，提示「带备注或批量提交需要投递密钥。」

成功后页面仍写「已进入待筛选」；服务回答这条已经在队列里时，写「这条已在待筛选里」。服务拒绝或网络失败时，不写这两句，也不把链接只留在这个浏览器里。

浏览器不保存、不发送投递密钥或接收码。Worker 必须已经配置 `DOT_DELIVERY_TOKEN_HASH` 和 `DOT_REVIEW_TOKEN_HASH`，而且两把哈希不同。缺配置时 `/api/dot/pending` 与 `/api/dot/inbox` 一样返回 `503`，不回退到公开文件。本机 `node frontend/serve.js` 没有这条路由，贴链接在纯静态本地服务上会失败；要打到已部署的预览 Worker。

无密钥的单条提交是公开的：任何能访问该地址的客户端都可以放入一条 X 链接。这个 POST 只能进入待筛选，队列有 300 条上限，不能读取备注，也不当场写公开首页。满 1 小时仍未人工处理时，定时任务会把它标成 `approved`（`approval` 为 `auto`）并写入公开首页。已经过审或已略过的链接再贴一次，不会被退回 `pending`。

过审和从首页撤回见 [待筛选过审](pending-review.md)。
