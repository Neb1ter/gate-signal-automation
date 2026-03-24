# Gate 新闻/分析师交易编排原型

这个原型把你的需求拆成两条链路：

- 新闻链路：收到高优先级消息后，按预设 playbook 生成交易候选；满足阈值时可以自动执行。
- 分析师链路：收到 Telegram 策略后，推送飞书卡片给你审批；你批准后再执行。

默认是安全模式：

- `DRY_RUN=true`
- `AUTO_EXECUTION_ENABLED=false`

也就是说，先发卡片、先看策略、先模拟，不会直接发真实订单。

## 为什么这里不用 MCP 直接做自动成交

你现在装好的 Gate MCP 很适合：

- 研究
- 手工审批
- 查询新闻 / 风险 / 链上 / 钱包

但你想要的是更低延迟、更稳定的常驻自动化。这个场景更适合：

- 常驻服务监听 Telegram / 外部快讯源
- 用 Gate 官方交易 API 直接下单
- 再把结果回推到飞书

这样不会卡在聊天回合里，延迟也更可控。

## 目录

- [package.json](/C:/Users/26292/Desktop/gate%20ai/automation/package.json)
- [.env.example](/C:/Users/26292/Desktop/gate%20ai/automation/.env.example)
- [config/playbooks.example.json](/C:/Users/26292/Desktop/gate%20ai/automation/config/playbooks.example.json)
- [src/server.mjs](/C:/Users/26292/Desktop/gate%20ai/automation/src/server.mjs)

## 当前能力

这个原型已经支持：

- Telegram 长轮询接收消息
- Telegram webhook 接收消息
- 按 chat id 区分 `news` 和 `analyst`
- 消息去重
- 风险控制
- 基于关键词的 playbook 匹配
- 飞书卡片推送审批链接
- 批准后调用 Gate 现货市价单
- `dry-run` 模式下只预演不下单

## 快速开始

1. 复制 [.env.example](/C:/Users/26292/Desktop/gate%20ai/automation/.env.example) 为 `automation/.env`
2. 填这些最关键的配置：
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_ANALYST_CHAT_IDS`
   - `TELEGRAM_NEWS_CHAT_IDS`
   - `FEISHU_WEBHOOK_URL`
   - `PUBLIC_BASE_URL`
   - `APPROVAL_SIGNING_SECRET`
3. 如果要真实现货下单，再填：
   - `GATE_API_KEY`
   - `GATE_API_SECRET`
4. 先保持：
   - `DRY_RUN=true`
   - `AUTO_EXECUTION_ENABLED=false`
5. 启动：

```bash
cd automation
npm start
```

## 配置建议

### Telegram

如果分析师群是你能加 bot 的群：

- 把 bot 加进群
- 如果 bot 不是管理员，Telegram 默认隐私模式下只能看到部分消息
- 你要做“完整消息监听”，通常要么把 bot 提升为管理员，要么关闭 privacy mode 后重新加回群

如果是频道：

- bot 成为频道成员即可收到频道消息

### 飞书

当前实现走自定义机器人 webhook，把信号发成卡片，并附上审批链接。

注意：

- `PUBLIC_BASE_URL` 必须是飞书里能打开的地址
- 如果你先在本地调试，可以先用内网穿透或云主机

### Gate 自动交易

当前只实现了 **现货市价单**：

- 买入：`amountQuote`
- 卖出：`amountBase`

这和 Gate 官方 API 文档一致：

- 市价买入时，`amount` 表示计价货币，比如 `BTC_USDT` 里的 `USDT`
- 市价卖出时，`amount` 表示基础货币，比如 `BTC_USDT` 里的 `BTC`

## playbook 思路

`config/playbooks.example.json` 里给了三种示例：

- `fast-news-listing-buy`
- `security-incident-risk-off`
- `analyst-btc-manual`

建议你把“霍尔木兹海峡”这类宏观冲击也做成单独 playbook，但先不要自动执行，原因是：

- 它对加密市场不是稳定单向映射
- 不同市场阶段反应不一样
- 先做提醒 + 人工确认更稳

## 更快的新闻源怎么接

这个原型已经预留了通用入口：

- `POST /signals/ingest`

你可以把任何更快的外部源接进来，只要让它把消息 POST 进来就行。适合接：

- 高频新闻终端
- 自建 Telegram 频道转发器
- 交易所公告监听器
- 链上安全告警
- 你自己的消息聚合器

请求示例：

```bash
curl -X POST http://127.0.0.1:8787/signals/ingest ^
  -H "Content-Type: application/json" ^
  -d "{\"sourceType\":\"news\",\"sourceName\":\"fast-wire\",\"text\":\"Breaking: Example token will list on major exchange\"}"
```

## 上线前必做

- 保持 `DRY_RUN=true` 先跑 3-7 天
- 先只放 1-2 个最清晰的 playbook
- 打开 `AUTO_EXECUTION_ENABLED` 前，把每笔金额压到很小
- 每个 playbook 单独回测和复盘
- 不要把模糊宏观消息直接映射成自动实盘

## 后续最值得补的三件事

1. 接更快的外部新闻源，而不是只靠 Telegram。
2. 把关键词规则升级成结构化事件分类器。
3. 增加期货 / 止损 / 仓位管理，而不只是现货市价单。
