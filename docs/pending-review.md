# 待筛选过审

进料口只负责把 X 链接放进待筛选。这一步用**接收码**把队列里的一条标成 `approved` 或 `rejected`。`approved` 会写进公开首页使用的 `PUBLIC_FEED`。`rejected` 会从公开首页拿掉。`pending` 不会出现在首页。

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

过审链接使用来源「KOSX 过审」。标题优先用进料时的备注；没有备注时用作者账号。摘要会写明尚未读取原文、未核对热度。时间用过审时间，所以它会出现在最新封面里，不会冒充 SoPilot 榜单。

每天的公开快照重建之后，仍会按队列里的 `approved` 记录把这些链接接回 `PUBLIC_FEED`。只停在 `pending` 的链接不会被接回去。

队列上限仍是 300 条，过审和略过的记录也算在里面。
