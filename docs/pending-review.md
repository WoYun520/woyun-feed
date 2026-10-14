# 待筛选过审

进料口把 X 链接放进待筛选。账号池成员由投递密钥送来、且不会进入「昨日最被低估」的精华帖，会在进料时直接放上首页，见 [待筛选进料](pending-intake.md)。其余链接仍用**接收码**把队列里的一条标成 `approved` 或 `rejected`。`approved` 会写进公开首页使用的 `PUBLIC_FEED`。`rejected` 会从公开首页拿掉。`pending` 不会出现在首页。

**昨日最被低估 = 必人工审。** 会进入这一栏的链接不能由账号池自动过审。账号池自动放上首页的帖可以按时间出现在最新封面和「昨日全部」里，低估栏仍跳过它们。接收码把一条已经由账号池放上首页的链接再标成 `approved` 时，过审时间不变，`approval` 改为 `review`，这条之后才可以钉进昨日最被低估。没有钉选时这一栏留空。

**当前仓库改动还没有部署。** 不要执行 `npx wrangler deploy`，也不要部署名为 `woyun` 的 Worker。下面的地址要等有人发布预览 Worker `woyun-feed-preview` 之后才能用。

## 放上公开首页

接收码是哈希存在 `DOT_REVIEW_TOKEN_HASH` 的那把原始密钥，和 `GET /api/dot/pending` 相同。投递密钥不能过审。

链接必须已经在待筛选里。这个接口不会新建队列记录。

```sh
curl -sS -X POST 'https://woyun-feed-preview.hhzovo66.workers.dev/api/dot/pending/decision' \
  -H 'Authorization: Bearer <接收码>' \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://x.com/name/status/123","status":"approved"}'
```

`200` 且 `"published": true` 表示这条已经写进 `PUBLIC_FEED`，公开首页的最新封面可以读到它。`existing: true` 表示它本来就是这个过审状态，过审时间不变。重复调用可以补上一次没写成功的首页记录。

过审时可以多带两个可选字段：

- `review_type`：把类型改成 `文章`、`教程指南`、`避坑`、`短帖`、`产品安利` 之一。
- `underrated_candidate`：`true` 时在这条过审记录上记下「低估栏候选」，并带 `underrated_candidate_at`。这只是记号。它不会调用 `POST /api/dot/pending` 以外的接口，也不会写昨日低估钉选。之后仍要用接收码单独调用 [昨日低估上传](underrated-upload.md) 的 `POST /api/dot/underrated` 才会钉上。`false` 会清掉记号。不带这个字段时，已有记号保持原样。`rejected` 不能带 `true`。

```sh
curl -sS -X POST 'https://woyun-feed-preview.hhzovo66.workers.dev/api/dot/pending/decision' \
  -H 'Authorization: Bearer <接收码>' \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://x.com/name/status/123","status":"approved","underrated_candidate":true,"review_type":"教程指南"}'
```

公开预览的「待筛选」页在连上接收码后会列出待过审链接。每条显示类型、收藏/点赞（或比例）和有没有 X Article 卡。建议先看文章，再看教程指南、避坑，短帖和产品安利靠后。点「过审上首页」时可勾选「进低估栏候选」。勾选只写下上面的记号。没有接收码时，这一栏不显示队列，也不能过审。

接收码读取 `GET /api/dot/pending` 时，每条在原有字段外还会带上已保存的 `review_type`、`bookmark_count`、`like_count`、`has_article`、`text`。有候选记号时带 `underrated_candidate: true` 和 `underrated_candidate_at`。旧记录没有这些字段时，页面会按备注粗分，热度和 Article 卡显示为未知。

从首页撤回：

```sh
curl -sS -X POST 'https://woyun-feed-preview.hhzovo66.workers.dev/api/dot/pending/decision' \
  -H 'Authorization: Bearer <接收码>' \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://x.com/name/status/123","status":"rejected"}'
```

这时 `"published": false`。正文里的 `status` 只能是 `approved` 或 `rejected`。

`404`：这条链接还没进待筛选，先按 [待筛选进料](pending-intake.md) POST。`401`：接收码不对，或误用了投递密钥。服务端调用不要带 `Origin`。

## 首页上看到什么

过审链接使用来源「KOSX 过审」。标题优先用进料时的备注；没有备注时用作者账号。摘要会写明尚未读取原文、未核对热度。时间用过审时间，所以它会出现在最新封面里，不会冒充 SoPilot 榜单。账号池自动过审和接收码过审用同一套时间顺序，不按粉丝数把谁排到前面。

「昨日全部」只列已经放上公开首页的精华帖，原帖北京日期是昨日。信息流里没有走上这条精华线的帖不进入。昨日最被低估只显示人工从「昨日全部」钉选的帖，不按来源热度、榜位或发布时间补。账号池自动过审的帖不进入该栏。没有对上的钉选时这一栏留空。

每天的公开快照重建之后，仍会按队列里的 `approved` 记录把这些链接接回 `PUBLIC_FEED`。只停在 `pending` 的链接不会被接回去。

队列上限仍是 300 条，过审和略过的记录也算在里面。

过审只让链接进入公开首页。要放进「昨日最被低估精华帖」，这条还必须已经在「昨日全部」里（公开首页上、原帖北京日期为昨日），Levi 再用同一把接收码单独钉选，见 [昨日低估上传](underrated-upload.md)。别的日期不能新钉。投递密钥不能钉选。候选池自动过审（`kosx_review` 为 `pool`）也不会进入那一栏。`underrated_candidate` 不是钉选，首页排序也不读它。
