# 云端部署说明

这套服务现在已经支持放到云端长期运行，不再依赖你的电脑一直开机。

## 这套服务上线后能做什么

- 分析师 Telegram 群消息实时推送到飞书
- 分析师策略默认始终先由你确认，再决定是否跟单
- 新闻消息可以在后台切换为：
  - 自动交易
  - 手动确认
- Telegram 群监听配置会保存在 `data/state.json`
- 只要云端容器和数据卷还在，重启后配置不会丢

## 你当前已经整理好的群 ID

### 新闻群

- `Get8.Pro`: `-1003758464445`
- `Get8.Pro_News`: `-1003720685651`

### 分析师群

- `舒琴`: `-1003093807993`
- `零下二度`: `-1003358734784`
- `易盈社区-所长`: `-1002953601978`
- `三马哥`: `-1003435926001`
- `洪七公`: `-1003162264989`
- `btc乔乔`: `-1003300637347`
- `大漂亮策略早知道`: `-1003044946193`
- `熬鹰资本`: `-1003547241758`

## 建议部署方式

推荐直接用 Docker 部署到云服务器。

原因：

- 最稳，迁移容易
- 可以挂载 `data` 目录，保住你的运行状态和监听配置
- 以后换机器也方便

## 需要准备的环境变量

以 `.env.cloud.example` 为模板，复制成 `.env` 后填写：

- `PUBLIC_BASE_URL`
  - 你的公网域名，例如 `https://signals.example.com`
- `APPROVAL_SIGNING_SECRET`
  - 用来保护审批链接的随机长串
- `ADMIN_ACCESS_TOKEN`
  - 云端后台登录口令
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `FEISHU_WEBHOOK_URL`
- `GATE_API_KEY`
- `GATE_API_SECRET`

首次上云建议先保持：

- `DRY_RUN=true`
- `AUTO_EXECUTION_ENABLED=true`

这样消息会照常流转，但不会真实下单，适合先验链路。

## 启动方式

在服务器上进入 `automation` 目录后执行：

```bash
docker compose -f docker-compose.cloud.yml up -d --build
```

## 上线后怎么管理

### 后台地址

- `https://你的域名/admin`

### 登录方式

- 输入你设置的 `ADMIN_ACCESS_TOKEN`

### 可以做的管理

- 修改允许监听的 Telegram 群
- 修改新闻群和分析师群分类
- 切换新闻交易为自动或手动
- 查看已发现的 Telegram 群聊

## Telegram 长期监听的关键点

为了让分析师群始终能被监听，必须满足下面几点：

- 机器人必须一直在群里
- 群里要允许机器人接收消息
- 云端服务必须持续运行
- `TELEGRAM_ANALYST_CHAT_IDS` 里要保留这些分析师群 ID
- `data` 目录必须做持久化挂载

如果这些条件都满足，分析师群监听不会因为你电脑关机而中断。

## 非常重要的安全建议

上线公网后，务必做到：

- 设置 `ADMIN_ACCESS_TOKEN`
- 使用 HTTPS 域名
- 不要把 `.env` 提交到 Git
- `DRY_RUN` 验证通过前，不要切到真实下单

## 推荐上线顺序

1. 上云并保持 `DRY_RUN=true`
2. 去飞书收一条测试策略消息
3. 确认飞书按钮能打开 `/pending`
4. 确认后台能看到 Telegram 群
5. 确认新闻自动 / 手动切换有效
6. 最后再把 `DRY_RUN` 改成 `false`
