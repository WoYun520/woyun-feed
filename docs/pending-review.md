# 待筛选过审

进料口把 X 链接放进待筛选。账号池成员由投递密钥送来、且不会进入「昨日最被低估」的精华帖，会在进料时直接放上首页，见 [待筛选进料](pending-intake.md)。其余链接仍用**接收码**把队列里的一条标成 `approved` 或 `rejected`。`approved` 会写进公开首页使用的 `PUBLIC_FEED`。`rejected` 会从公开首页拿掉。`pending` 不会出现在首页。

**昨日最被低估 = 必人工审。** 会进入这一栏的链接不能由账号池自动过审。账号池自动放上首页的帖只按时间出现在最新封面里，首页挑选昨日最被低估时会跳过它们。接收码把一条已经由账号池放上首页的链接再标成 `approved` 时，过审时间不变，`approval` 改为 `review`，这条之后才可以进入昨日最被低估。

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

`200` 且 `"published": true` 表示这条已经写进 `PUBLIC_FEED`，公开首页的最新封面可以读到它。`existing: true` 表示它本来就是 `approved`，过审时间不变。重复调用可以补上一次没写成功的首页记录。

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

昨日最被低估仍按现有公开指标从「昨日」里挑选，并且必须先有人工过审。账号池自动过审的帖不进入该栏。

每天的公开快照重建之后，仍会按队列里的 `approved` 记录把这些链接接回 `PUBLIC_FEED`。只停在 `pending` 的链接不会被接回去。

队列上限仍是 300 条，过审和略过的记录也算在里面。

过审只让链接进入公开首页。要放进「昨日最被低估精华帖」，Levi 再用同一把接收码单独钉选，见 [昨日低估上传](underrated-upload.md)。投递密钥不能钉选。候选池自动过审（`kosx_review` 为 `pool`）也不会进入那一栏。
