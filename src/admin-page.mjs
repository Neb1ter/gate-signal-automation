function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

export function renderAdminPage({
  runtimeSettings,
  knownChats,
  configuredChatLabels,
  signalCount,
  dryRun,
  autoExecutionEnabled,
  runtimeAiEnabled,
  runtimeGateMode,
  defaultFeishuConfigured,
  telegramSourceMode,
  telegramRuntimeSummary,
  analystMetrics,
  port,
  publicBaseUrl,
}) {
  const bootstrap = safeJson({
    runtimeSettings,
    knownChats,
    configuredChatLabels,
    signalCount,
    dryRun,
    autoExecutionEnabled,
    runtimeAiEnabled,
    runtimeGateMode,
    defaultFeishuConfigured,
    telegramSourceMode,
    telegramRuntimeSummary,
    analystMetrics,
    port,
    publicBaseUrl,
  });

  const accessEntry = publicBaseUrl || `http://127.0.0.1:${port}`;
  const isCloudEntry =
    Boolean(publicBaseUrl) &&
    !/^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(?::|\/|$)/i.test(String(publicBaseUrl));

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>交易信号后台</title>
    <style>
      :root {
        --bg: #f6f8fc;
        --card: #ffffff;
        --text: #182233;
        --muted: #61708a;
        --line: #dbe2ee;
        --accent: #0f6fff;
        --accent-soft: #eaf2ff;
        --ok: #157347;
        --warn: #9a5b00;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: linear-gradient(180deg, #fbfdff 0%, var(--bg) 100%);
        color: var(--text);
        font: 14px/1.6 "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      .shell {
        max-width: 1380px;
        margin: 0 auto;
        padding: 28px 18px 40px;
      }
      .hero {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 18px;
        margin-bottom: 20px;
      }
      h1, h2, h3, p { margin: 0; }
      .hero-copy p {
        margin-top: 8px;
        color: var(--muted);
        max-width: 860px;
      }
      .actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      button,
      .button-link {
        border: 0;
        border-radius: 12px;
        padding: 11px 16px;
        font: inherit;
        cursor: pointer;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .button-primary {
        background: var(--accent);
        color: #fff;
      }
      .button-secondary {
        background: #edf2f9;
        color: var(--text);
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        gap: 14px;
        margin-bottom: 20px;
      }
      .card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 18px;
        box-shadow: 0 12px 30px rgba(16, 29, 62, 0.05);
      }
      .metric-label {
        color: var(--muted);
        font-size: 12px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }
      .metric-value {
        margin-top: 8px;
        font-size: 28px;
        font-weight: 700;
      }
      .metric-hint {
        margin-top: 8px;
        color: var(--muted);
        font-size: 12px;
        word-break: break-all;
      }
      .panel-grid {
        display: grid;
        grid-template-columns: minmax(420px, 520px) minmax(0, 1fr);
        gap: 18px;
      }
      .stack {
        display: grid;
        gap: 18px;
      }
      .section-title {
        font-size: 18px;
        font-weight: 700;
      }
      .section-copy {
        margin-top: 6px;
        color: var(--muted);
      }
      .field {
        margin-top: 16px;
      }
      .field label {
        display: block;
        font-weight: 600;
        margin-bottom: 8px;
      }
      .field small {
        display: block;
        color: var(--muted);
        margin-top: 6px;
      }
      textarea,
      select,
      input[type="text"],
      input[type="url"],
      input[type="password"] {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 12px 14px;
        font: inherit;
        background: #fff;
      }
      textarea {
        min-height: 90px;
        resize: vertical;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 18px;
      }
      th,
      td {
        padding: 12px 10px;
        border-bottom: 1px solid var(--line);
        text-align: left;
        vertical-align: top;
      }
      th {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .chat-title {
        font-weight: 600;
      }
      .chat-meta,
      .empty,
      .status-line,
      .inline-help {
        color: var(--muted);
      }
      .status-line {
        min-height: 22px;
        margin-top: 12px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font-weight: 600;
        margin-top: 10px;
      }
      .route-grid {
        display: grid;
        gap: 12px;
        margin-top: 16px;
      }
      .route-card {
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 14px;
        background: #fbfcff;
      }
      .route-card h3 {
        font-size: 15px;
      }
      .route-card p {
        margin-top: 4px;
        color: var(--muted);
      }
      .route-fields {
        display: grid;
        gap: 10px;
        margin-top: 12px;
      }
      .route-config-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }
      .route-metrics {
        margin-top: 14px;
        border-top: 1px solid var(--line);
        padding-top: 12px;
      }
      .route-metrics-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
        margin-top: 10px;
      }
      .route-metric {
        border: 1px solid var(--line);
        border-radius: 12px;
        background: #fff;
        padding: 10px;
      }
      .route-metric strong {
        display: block;
        font-size: 18px;
        margin-top: 4px;
      }
      .mini-list {
        margin-top: 10px;
        display: grid;
        gap: 8px;
      }
      .mini-item {
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 10px;
        background: #fff;
      }
      .mini-item-title {
        font-weight: 600;
      }
      .mini-item-meta {
        color: var(--muted);
        font-size: 12px;
        margin-top: 4px;
      }
      .hint-list {
        display: grid;
        gap: 10px;
        margin-top: 14px;
        color: var(--muted);
      }
      @media (max-width: 1180px) {
        .grid,
        .panel-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="hero">
        <div class="hero-copy">
          <h1>交易信号后台</h1>
          <p>这里可以管理 Telegram 监听群、分析师分群转发、纯转发 / 交易模式、飞书群路由，以及 Gate 跟单配置。</p>
          <div class="badge">当前推荐使用“纯转发模式”：机器人只做去噪、脱敏、话题化转发，不再输出 AI 分析、交易建议或审批按钮。</div>
        </div>
        <div class="actions">
          <a href="/pending" class="button-link button-secondary">查看待决策</a>
          <a href="/logout" class="button-link button-secondary">退出登录</a>
          <button id="reload" class="button-secondary" type="button">刷新</button>
          <button id="save" class="button-primary" type="button">保存设置</button>
        </div>
      </div>

      <div class="grid">
        <div class="card">
          <div class="metric-label">已存信号</div>
          <div class="metric-value">${escapeHtml(signalCount)}</div>
          <div class="metric-hint">当前数据库中已保存的信号数量</div>
        </div>
        <div class="card">
          <div class="metric-label">下单模式</div>
          <div class="metric-value">${dryRun ? "模拟" : "真实"}</div>
          <div class="metric-hint">${dryRun ? "当前不会真实下单" : "当前允许真实交易"}</div>
        </div>
        <div class="card">
          <div class="metric-label">自动执行总开关</div>
          <div class="metric-value">${autoExecutionEnabled ? "开启" : "关闭"}</div>
          <div class="metric-hint">只影响新闻自动单，不影响分析师审批流</div>
        </div>
        <div class="card">
          <div class="metric-label">当前入口</div>
          <div class="metric-value">${escapeHtml(isCloudEntry ? "云端" : "本机")}</div>
          <div class="metric-hint">${escapeHtml(accessEntry)}</div>
        </div>
        <div class="card">
          <div class="metric-label">Telegram 监听身份</div>
          <div class="metric-value">${escapeHtml(telegramSourceMode === "user" ? "个人号" : "Bot")}</div>
          <div class="metric-hint">${escapeHtml(telegramRuntimeSummary || "尚未连接")}</div>
        </div>
        <div class="card">
          <div class="metric-label">系统模式</div>
          <div class="metric-value">${runtimeSettings.execution?.forwardOnlyMode !== false ? "纯转发" : "分析交易"}</div>
          <div class="metric-hint">${runtimeSettings.execution?.forwardOnlyMode !== false ? "不使用 AI 判断与交易按钮" : "会启用 AI / 审批 / 交易链路"}</div>
        </div>
        <div class="card">
          <div class="metric-label">AI 结构化</div>
          <div class="metric-value">${runtimeSettings.execution?.forwardOnlyMode !== false ? "旁路" : runtimeSettings.ai?.enabled ? "开启" : "关闭"}</div>
          <div class="metric-hint">当前运行态：${escapeHtml(runtimeSettings.execution?.forwardOnlyMode !== false ? "纯转发模式下不参与链路" : runtimeAiEnabled ? "已启用" : "未启用")}</div>
        </div>
        <div class="card">
          <div class="metric-label">Gate 跟单通道</div>
          <div class="metric-value">${escapeHtml(["testnet", "futures_testnet", "spot_testnet"].includes(runtimeSettings.gate?.mode) ? "Gate 模拟" : "本地 Dry Run")}</div>
          <div class="metric-hint">当前运行态：${escapeHtml(runtimeGateMode === "futures_testnet" || runtimeGateMode === "testnet" ? "Gate 模拟合约" : runtimeGateMode === "spot_testnet" ? "Gate 模拟现货" : "本地 Dry Run")}</div>
        </div>
      </div>

      <div class="panel-grid">
        <div class="stack">
          <div class="card">
            <div class="section-title">执行模式</div>
            <p class="section-copy">你可以把系统切到纯转发模式，只保留话题群转发；或者切回带审批 / 交易建议的旧模式。纯转发开启时，分析师和新闻都不会再走 AI 判断与下单链路。</p>
            <div class="field">
              <label for="forwardOnlyMode">系统模式</label>
              <select id="forwardOnlyMode">
                <option value="true" ${runtimeSettings.execution?.forwardOnlyMode !== false ? "selected" : ""}>纯转发模式</option>
                <option value="false" ${runtimeSettings.execution?.forwardOnlyMode === false ? "selected" : ""}>分析 / 交易模式</option>
              </select>
              <small>纯转发模式：只做去噪、脱敏、分群转发。分析 / 交易模式：恢复 AI 结构化、审批面板和交易相关链路。</small>
            </div>
            <div class="field">
              <label for="analystMode">分析师交易模式</label>
              <select id="analystMode">
                <option value="manual" ${runtimeSettings.execution?.analystMode === "auto" ? "" : "selected"}>手动确认</option>
                <option value="auto" ${runtimeSettings.execution?.analystMode === "auto" ? "selected" : ""}>AI 自动交易</option>
              </select>
              <small>手动确认：只转发到群聊，等待人工审批。AI 自动交易：只有 AI 明确判断可执行时，才会自动下单并把交易结果发到“分析师交易信号”总群。</small>
            </div>
            <div class="field">
              <label for="newsMode">新闻交易模式</label>
              <select id="newsMode">
                <option value="auto" ${runtimeSettings.execution?.newsMode === "manual" ? "" : "selected"}>自动交易</option>
                <option value="manual" ${runtimeSettings.execution?.newsMode === "manual" ? "selected" : ""}>手动确认</option>
              </select>
              <small>自动交易：命中新闻策略后直接执行。手动确认：先发飞书，再由你决定是否跟单。</small>
            </div>
          </div>

          <div class="card">
            <div class="section-title">Telegram 群监听配置</div>
            <p class="section-copy">如果某个群还没被自动识别，可以直接在这里填入 chat id。多个 ID 用英文逗号分隔。</p>

            <div class="field">
              <label for="allowedCsv">允许监听的群 ID</label>
              <textarea id="allowedCsv"></textarea>
              <small>只有这里的群才会被处理。留空时等于允许所有已分类群。</small>
            </div>

            <div class="field">
              <label for="newsCsv">新闻群 ID</label>
              <textarea id="newsCsv"></textarea>
            </div>

            <div class="field">
              <label for="analystCsv">分析师群 ID</label>
              <textarea id="analystCsv"></textarea>
            </div>
          </div>

          <div class="card">
            <div class="section-title">AI 文案结构化配置</div>
            <p class="section-copy">只有当系统模式切回“分析 / 交易模式”时，这里的 AI 配置才会真正参与消息链路。纯转发模式下会整体旁路。</p>
            <div class="field">
              <label for="aiEnabled">AI 结构化开关</label>
              <select id="aiEnabled">
                <option value="false" ${runtimeSettings.ai?.enabled ? "" : "selected"}>关闭</option>
                <option value="true" ${runtimeSettings.ai?.enabled ? "selected" : ""}>开启</option>
              </select>
            </div>
            <div class="field">
              <label for="aiBaseUrl">AI API Base URL</label>
              <input id="aiBaseUrl" type="url" placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" value="${escapeHtml(runtimeSettings.ai?.baseUrl || "")}" />
              <small>阿里云百炼 OpenAI 兼容地址默认就是这个，通常不用改。</small>
            </div>
            <div class="field">
              <label for="aiPrimaryModel">主模型（语义提取）</label>
              <input id="aiPrimaryModel" type="text" placeholder="qwen3.5-plus" value="${escapeHtml(runtimeSettings.ai?.primaryModel || runtimeSettings.ai?.model || "")}" />
              <small>建议用千问 3.5 Plus 把中文长文提炼成结构化字段。</small>
            </div>
            <div class="field">
              <label for="aiReviewModel">复核模型（自动化复判）</label>
              <input id="aiReviewModel" type="text" placeholder="deepseek-v3.2" value="${escapeHtml(runtimeSettings.ai?.reviewModel || "")}" />
              <small>建议用 DeepSeek 纠偏字段、补充风控备注，并判断是否适合自动化执行。</small>
            </div>
            <div class="field">
              <label for="aiReviewEnabled">二次复核</label>
              <select id="aiReviewEnabled">
                <option value="true" ${runtimeSettings.ai?.reviewEnabled === false ? "" : "selected"}>开启</option>
                <option value="false" ${runtimeSettings.ai?.reviewEnabled === false ? "selected" : ""}>关闭</option>
              </select>
            </div>
            <div class="field">
              <label for="aiApiKey">AI API Key</label>
              <input id="aiApiKey" type="password" placeholder="先留空，等你最后提供阿里云密钥后再补" value="${escapeHtml(runtimeSettings.ai?.apiKey || "")}" />
            </div>
            <div class="field">
              <label for="aiTimeoutMs">AI 超时（毫秒）</label>
              <input id="aiTimeoutMs" type="text" value="${escapeHtml(runtimeSettings.ai?.timeoutMs || 30000)}" />
            </div>
          </div>
          <div class="card">
            <div class="section-title">Gate 模拟跟单配置</div>
            <p class="section-copy">当前建议先接 Gate 模拟交易。保存后，分析师确认跟单会优先走这里的模拟 API；如果不开，则仍然使用本地 Dry Run。</p>
            <div class="field">
              <label for="gateMode">Gate 跟单模式</label>
              <select id="gateMode">
                <option value="dry_run" ${["futures_testnet","spot_testnet","testnet"].includes(runtimeSettings.gate?.mode) ? "" : "selected"}>本地 Dry Run</option>
                <option value="futures_testnet" ${runtimeSettings.gate?.mode === "futures_testnet" || runtimeSettings.gate?.mode === "testnet" ? "selected" : ""}>Gate 模拟合约</option>
                <option value="spot_testnet" ${runtimeSettings.gate?.mode === "spot_testnet" ? "selected" : ""}>Gate 模拟现货</option>
              </select>
            </div>
            <div class="field">
              <label for="gateBaseUrl">Gate API Base URL</label>
              <input id="gateBaseUrl" type="url" placeholder="https://api-testnet.gateapi.io" value="${escapeHtml(runtimeSettings.gate?.baseUrl || "")}" />
              <small>建议模拟交易填写官方 Testnet 地址。</small>
            </div>
            <div class="field">
              <label for="gateApiKey">Gate API Key</label>
              <input id="gateApiKey" type="password" placeholder="模拟交易 API Key" value="${escapeHtml(runtimeSettings.gate?.apiKey || "")}" />
            </div>
            <div class="field">
              <label for="gateApiSecret">Gate API Secret</label>
              <input id="gateApiSecret" type="password" placeholder="模拟交易 API Secret" value="${escapeHtml(runtimeSettings.gate?.apiSecret || "")}" />
            </div>
          </div>

          <div class="card">
            <div class="section-title">分析师分群转发</div>
            <p class="section-copy">你可以把不同的 Telegram 分析师群分别转发到不同的飞书群。每个飞书群都需要自己的 webhook。</p>
            <div class="badge">${defaultFeishuConfigured ? "已存在默认飞书群：未单独配置时会回落到默认群" : "当前没有默认飞书群：请至少给分析师群配置一个 webhook"}</div>
            <div class="field">
              <label for="generalAnalystSignalWebhookUrl">分析师交易信号总群 Webhook</label>
              <input id="generalAnalystSignalWebhookUrl" type="url" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." value="${escapeHtml(runtimeSettings.feishu?.generalAnalystSignalWebhookUrl || "")}" />
              <small>这个总群只在“分析 / 交易模式”下用于集中广播可执行分析师信号；纯转发模式下不会额外发送到这里。</small>
            </div>
            <div id="analystRoutesWrap" class="route-grid"></div>
          </div>

          <div class="card">
            <div class="section-title">使用说明</div>
            <div class="hint-list">
              <div>1. 右侧“已发现的 Telegram 群聊”里勾选哪些群属于“新闻群”或“分析师群”。</div>
              <div>2. 分析师消息会尽量按结构化格式转发；无法下单的纯分析，也会作为结构化观点卡片发送。</div>
              <div>3. 飞书消息里只展示脱敏后的正文，不再额外显示“隐私处理”提示语。</div>
              <div>4. Gate 模拟交易需要你自己的模拟 API Key / Secret；未配置时仍会走本地 Dry Run。</div>
            </div>
            <div class="status-line" id="statusLine"></div>
          </div>
        </div>

        <div class="card">
          <div class="section-title">已发现的 Telegram 群聊</div>
          <p class="section-copy">这里会把系统见过的群，以及你手工配置但还没收到过首条消息的群一起展示出来。你不用再自己记 chat id，只要看群名即可。</p>
          <div id="chatTableWrap"></div>
        </div>
      </div>
    </div>

    <script id="bootstrap" type="application/json">${bootstrap}</script>
    <script>
      const bootstrap = JSON.parse(document.getElementById("bootstrap").textContent);
      const discoveredIds = new Set(bootstrap.knownChats.map((chat) => String(chat.id)));

      function looksBrokenChineseText(value) {
        const text = String(value ?? "").trim();
        if (!text) return false;
        if (/^\\?{2,}$/.test(text)) return true;
        if (text.includes("�")) return true;
        return [
          "鍒嗘瀽",
          "涓夐┈",
          "娲竷",
          "鏄撶泩",
          "闆朵笅",
          "鑸掔惔",
          "鐔拱",
          "btc涔斾箶",
          "澶ф紓浜",
        ].some((token) => text.includes(token));
      }

      function getKnownChatMapFromBootstrap() {
        const map = new Map();
        for (const chat of bootstrap.knownChats) {
          const id = String(chat.id);
          map.set(id, {
            ...chat,
            title: bootstrap.configuredChatLabels?.[id] || chat.title || id,
            isConfiguredOnly: false,
          });
        }
        return map;
      }

      function buildDefaultRouteDisplayName(chatId) {
        const id = String(chatId);
        const knownChat = getKnownChatMapFromBootstrap().get(id);
        const title = knownChat?.title || bootstrap.configuredChatLabels?.[id] || id;
        return title ? title + "策略专线" : "分析师专线" + id.slice(-4);
      }

      function resolveRouteDisplayName(chatId, value) {
        const text = String(value ?? "").trim();
        if (!text || looksBrokenChineseText(text)) {
          return buildDefaultRouteDisplayName(chatId);
        }
        return text;
      }

      const state = {
        allowed: new Set((bootstrap.runtimeSettings.telegram.allowedChatIds || []).map(String)),
        news: new Set((bootstrap.runtimeSettings.telegram.newsChatIds || []).map(String)),
        analyst: new Set((bootstrap.runtimeSettings.telegram.analystChatIds || []).map(String)),
        analystRoutes: new Map(
          (bootstrap.runtimeSettings.feishu?.analystRoutes || []).map((route) => [
            String(route.chatId),
            {
              webhookUrl: String(route.webhookUrl || ""),
              displayName: resolveRouteDisplayName(String(route.chatId), route.displayName),
            },
          ]),
        ),
        generalAnalystSignalWebhookUrl: String(
          bootstrap.runtimeSettings.feishu?.generalAnalystSignalWebhookUrl || "",
        ),
        analystConfigs: new Map(
          (bootstrap.runtimeSettings.analysts?.configs || []).map((item) => [
            String(item.chatId),
            {
              enabled: item.enabled !== false,
              amountQuote: String(item.amountQuote || "100"),
              allowedSymbols: Array.isArray(item.allowedSymbols)
                ? item.allowedSymbols.join(", ")
                : String(item.allowedSymbols || ""),
            },
          ]),
        ),
        newsMode: bootstrap.runtimeSettings.execution?.newsMode === "manual" ? "manual" : "auto",
        analystMode:
          bootstrap.runtimeSettings.execution?.analystMode === "auto" ? "auto" : "manual",
        forwardOnlyMode: bootstrap.runtimeSettings.execution?.forwardOnlyMode !== false,
        ai: {
          enabled: Boolean(bootstrap.runtimeSettings.ai?.enabled),
          provider: String(bootstrap.runtimeSettings.ai?.provider || "dashscope"),
          baseUrl: String(bootstrap.runtimeSettings.ai?.baseUrl || ""),
          primaryModel: String(
            bootstrap.runtimeSettings.ai?.primaryModel ||
              bootstrap.runtimeSettings.ai?.model ||
              "qwen3.5-plus",
          ),
          reviewModel: String(bootstrap.runtimeSettings.ai?.reviewModel || "deepseek-v3.2"),
          reviewEnabled: bootstrap.runtimeSettings.ai?.reviewEnabled !== false,
          apiKey: String(bootstrap.runtimeSettings.ai?.apiKey || ""),
          timeoutMs: String(bootstrap.runtimeSettings.ai?.timeoutMs || "30000"),
        },
        gate: {
          mode: String(bootstrap.runtimeSettings.gate?.mode || "dry_run"),
          baseUrl: String(bootstrap.runtimeSettings.gate?.baseUrl || ""),
          apiKey: String(bootstrap.runtimeSettings.gate?.apiKey || ""),
          apiSecret: String(bootstrap.runtimeSettings.gate?.apiSecret || ""),
        },
      };

      const allowedCsv = document.getElementById("allowedCsv");
      const newsCsv = document.getElementById("newsCsv");
      const analystCsv = document.getElementById("analystCsv");
      const forwardOnlyMode = document.getElementById("forwardOnlyMode");
      const analystMode = document.getElementById("analystMode");
      const newsMode = document.getElementById("newsMode");
      const generalAnalystSignalWebhookUrl = document.getElementById("generalAnalystSignalWebhookUrl");
      const aiEnabled = document.getElementById("aiEnabled");
      const aiBaseUrl = document.getElementById("aiBaseUrl");
      const aiPrimaryModel = document.getElementById("aiPrimaryModel");
      const aiReviewModel = document.getElementById("aiReviewModel");
      const aiReviewEnabled = document.getElementById("aiReviewEnabled");
      const aiApiKey = document.getElementById("aiApiKey");
      const aiTimeoutMs = document.getElementById("aiTimeoutMs");
      const gateMode = document.getElementById("gateMode");
      const gateBaseUrl = document.getElementById("gateBaseUrl");
      const gateApiKey = document.getElementById("gateApiKey");
      const gateApiSecret = document.getElementById("gateApiSecret");
      const statusLine = document.getElementById("statusLine");
      const chatTableWrap = document.getElementById("chatTableWrap");
      const analystRoutesWrap = document.getElementById("analystRoutesWrap");

      function escapeClientHtml(value) {
        return String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }

      function formatMetricNumber(value, digits = 2) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
          return "--";
        }
        return numeric.toFixed(digits);
      }

      function getAnalystMetric(chatId) {
        return (bootstrap.analystMetrics || []).find((item) => String(item.chatId) === String(chatId)) || null;
      }

      function parseCsv(value) {
        return String(value || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      }

      function nonDiscoveredFromSet(set) {
        return [...set].filter((id) => !discoveredIds.has(id)).join(", ");
      }

      function getKnownChatMap() {
        const map = new Map();
        for (const chat of bootstrap.knownChats) {
          const id = String(chat.id);
          map.set(id, {
            ...chat,
            title: bootstrap.configuredChatLabels?.[id] || chat.title || id,
            isConfiguredOnly: false,
          });
        }
        return map;
      }

      function getConfiguredOnlyChat(id) {
        return {
          id,
          title: bootstrap.configuredChatLabels?.[id] || "手动配置的群聊",
          username: "",
          type: "configured",
          lastSeenAt: "",
          lastText: "系统还没在这个群里收到首条新消息",
          isConfiguredOnly: true,
        };
      }

      function getVisibleChats() {
        const knownMap = getKnownChatMap();
        const configuredIds = new Set([
          ...state.allowed,
          ...state.news,
          ...state.analyst,
          ...state.analystRoutes.keys(),
        ]);

        for (const id of configuredIds) {
          if (!knownMap.has(id)) {
            knownMap.set(id, getConfiguredOnlyChat(id));
          }
        }

        return [...knownMap.values()].sort((a, b) => {
          const aConfiguredOnly = a.isConfiguredOnly ? 1 : 0;
          const bConfiguredOnly = b.isConfiguredOnly ? 1 : 0;
          if (aConfiguredOnly !== bConfiguredOnly) {
            return aConfiguredOnly - bConfiguredOnly;
          }
          return String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || ""));
        });
      }

      function getChatTitle(id) {
        const visible = getVisibleChats().find((chat) => String(chat.id) === String(id));
        return visible?.title || bootstrap.configuredChatLabels?.[String(id)] || String(id);
      }

      function syncManualFields() {
        allowedCsv.value = nonDiscoveredFromSet(state.allowed);
        newsCsv.value = nonDiscoveredFromSet(state.news);
        analystCsv.value = nonDiscoveredFromSet(state.analyst);
        forwardOnlyMode.value = state.forwardOnlyMode ? "true" : "false";
        analystMode.value = state.analystMode;
        newsMode.value = state.newsMode;
        generalAnalystSignalWebhookUrl.value = state.generalAnalystSignalWebhookUrl;
        aiEnabled.value = state.ai.enabled ? "true" : "false";
        aiBaseUrl.value = state.ai.baseUrl;
        aiPrimaryModel.value = state.ai.primaryModel;
        aiReviewModel.value = state.ai.reviewModel;
        aiReviewEnabled.value = state.ai.reviewEnabled ? "true" : "false";
        aiApiKey.value = state.ai.apiKey;
        aiTimeoutMs.value = state.ai.timeoutMs;
        gateMode.value = state.gate.mode;
        gateBaseUrl.value = state.gate.baseUrl;
        gateApiKey.value = state.gate.apiKey;
        gateApiSecret.value = state.gate.apiSecret;
      }

      function checked(set, id) {
        return set.has(String(id)) ? "checked" : "";
      }

      function renderChats() {
        const chats = getVisibleChats();
        if (!chats.length) {
          chatTableWrap.innerHTML = '<p class="empty">目前还没有自动识别到任何 Telegram 群，也没有手动配置的群 ID。你可以先在左侧填入群 ID，或者先让系统收到一条新消息。</p>';
          return;
        }

        const rows = chats
          .map((chat) => {
            const id = String(chat.id);
            const title = escapeClientHtml(chat.title || chat.username || id);
            const metaParts = [id];
            if (chat.username) metaParts.push("@" + chat.username);
            if (chat.type) metaParts.push(chat.type);
            if (chat.isConfiguredOnly) metaParts.push("等待首条消息");
            const helpText = escapeClientHtml(chat.lastText || "");
            return \`
              <tr>
                <td>
                  <div class="chat-title">\${title}</div>
                  <div class="chat-meta">\${escapeClientHtml(metaParts.join(" | "))}</div>
                  <div class="inline-help">\${helpText}</div>
                </td>
                <td>\${escapeClientHtml(chat.lastSeenAt || "尚未收到")}</td>
                <td><input type="checkbox" data-bucket="allowed" data-id="\${id}" \${checked(state.allowed, id)} /></td>
                <td><input type="checkbox" data-bucket="news" data-id="\${id}" \${checked(state.news, id)} /></td>
                <td><input type="checkbox" data-bucket="analyst" data-id="\${id}" \${checked(state.analyst, id)} /></td>
              </tr>
            \`;
          })
          .join("");

        chatTableWrap.innerHTML = \`
          <table>
            <thead>
              <tr>
                <th>群聊</th>
                <th>最近收到</th>
                <th>允许监听</th>
                <th>新闻群</th>
                <th>分析师群</th>
              </tr>
            </thead>
            <tbody>\${rows}</tbody>
          </table>
        \`;
      }

      function renderAnalystRoutes() {
        const analystIds = [...state.analyst].sort((a, b) =>
          getChatTitle(a).localeCompare(getChatTitle(b), "zh-CN"),
        );
        if (!analystIds.length) {
          analystRoutesWrap.innerHTML =
            '<div class="empty">还没有设置任何分析师群。先把 Telegram 群勾选为“分析师群”，这里就会出现对应配置。</div>';
          return;
        }

        const renderPositions = (metric) => {
          if (!metric?.positions?.length) {
            return '<div class="inline-help">当前没有未平仓的模拟持仓。</div>';
          }
          return [
            '<div class="mini-list">',
            ...metric.positions.slice(0, 3).map((position) =>
              [
                '<div class="mini-item">',
                '<div class="mini-item-title">' + escapeClientHtml(position.symbol) + "</div>",
                '<div class="mini-item-meta">' +
                  "数量 " +
                  escapeClientHtml(formatMetricNumber(position.qty, 6)) +
                  " · 均价 " +
                  escapeClientHtml(formatMetricNumber(position.avgCost, 2)) +
                  " · 浮盈亏 " +
                  escapeClientHtml(formatMetricNumber(position.unrealizedPnl, 2)) +
                  "</div>",
                "</div>",
              ].join(""),
            ),
            "</div>",
          ].join("");
        };

        const renderRecentTrades = (metric) => {
          if (!metric?.recentTrades?.length) {
            return '<div class="inline-help">当前还没有可统计的成交记录。</div>';
          }
          return [
            '<div class="mini-list">',
            ...metric.recentTrades.slice(0, 3).map((trade) => {
              const realizedText =
                trade.realizedPnl === null
                  ? ""
                  : " · 已实现盈亏 " + escapeClientHtml(formatMetricNumber(trade.realizedPnl, 2));
              return [
                '<div class="mini-item">',
                '<div class="mini-item-title">' +
                  escapeClientHtml(trade.symbol) +
                  " · " +
                  escapeClientHtml(String(trade.side || "").toUpperCase()) +
                  "</div>",
                '<div class="mini-item-meta">' +
                  escapeClientHtml(String(trade.createdAt || "").replace("T", " ").replace("Z", " UTC")) +
                  " · 均价 " +
                  escapeClientHtml(formatMetricNumber(trade.avgPrice, 2)) +
                  realizedText +
                  "</div>",
                "</div>",
              ].join("");
            }),
            "</div>",
          ].join("");
        };

        analystRoutesWrap.innerHTML = analystIds
          .map((chatId) => {
            const route = state.analystRoutes.get(chatId) || { webhookUrl: "", displayName: "" };
            const analystConfig = state.analystConfigs.get(chatId) || {
              enabled: true,
              amountQuote: "100",
              allowedSymbols: "",
            };
            const metric = getAnalystMetric(chatId);
            const winRateText =
              metric?.winRate === null ? "--" : formatMetricNumber(metric.winRate, 2) + "%";
            const plRatioText =
              metric?.profitLossRatio === null
                ? "--"
                : formatMetricNumber(metric.profitLossRatio, 2);

            return [
              '<section class="route-card">',
              "<h3>" + escapeClientHtml(getChatTitle(chatId)) + "</h3>",
              "<p>Telegram 群 ID：" + escapeClientHtml(chatId) + "</p>",
              '<div class="route-fields">',
              "<div>",
              "<label>飞书显示名称</label>",
              '<input type="text" data-route-id="' +
                escapeClientHtml(chatId) +
                '" data-route-field="displayName" value="' +
                escapeClientHtml(resolveRouteDisplayName(chatId, route.displayName)) +
                '" placeholder="例如：三马哥策略专线" />',
              "<small>飞书收到消息时显示这个名称，用来和 Telegram 原群做区分。</small>",
              "</div>",
              "<div>",
              "<label>专属飞书 Webhook</label>",
              '<input type="url" data-route-id="' +
                escapeClientHtml(chatId) +
                '" data-route-field="webhookUrl" value="' +
                escapeClientHtml(route.webhookUrl) +
                '" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." />',
              "<small>填了就发到这个分析师自己的飞书群；留空则回落到默认飞书群。</small>",
              "</div>",
              '<div class="route-config-grid">',
              "<div>",
              "<label>跟单开关</label>",
              '<select data-analyst-id="' +
                escapeClientHtml(chatId) +
                '" data-analyst-field="enabled">',
              '<option value="true"' + (analystConfig.enabled !== false ? " selected" : "") + ">开启</option>",
              '<option value="false"' + (analystConfig.enabled === false ? " selected" : "") + ">关闭</option>",
              "</select>",
              "<small>关闭后仍会转发策略，但不会生成可执行跟单建议。</small>",
              "</div>",
              "<div>",
              "<label>默认跟单金额 (USDT)</label>",
              '<input type="text" data-analyst-id="' +
                escapeClientHtml(chatId) +
                '" data-analyst-field="amountQuote" value="' +
                escapeClientHtml(analystConfig.amountQuote || "100") +
                '" placeholder="例如 100" />',
              "<small>这个分析师的买入信号默认使用这个金额下模拟单。</small>",
              "</div>",
              "<div>",
              "<label>白名单币种</label>",
              '<input type="text" data-analyst-id="' +
                escapeClientHtml(chatId) +
                '" data-analyst-field="allowedSymbols" value="' +
                escapeClientHtml(analystConfig.allowedSymbols || "") +
                '" placeholder="例如 BTC, ETH, SOL" />',
              "<small>只允许这些币种生成跟单建议；留空表示不限制。</small>",
              "</div>",
              "</div>",
              "</div>",
              '<div class="route-metrics">',
              '<div class="chat-title">策略执行统计</div>',
              '<div class="route-metrics-grid">',
              '<div class="route-metric"><div class="inline-help">交易次数</div><strong>' +
                escapeClientHtml(formatMetricNumber(metric?.tradeCount || 0, 0)) +
                "</strong></div>",
              '<div class="route-metric"><div class="inline-help">胜率</div><strong>' +
                escapeClientHtml(winRateText) +
                "</strong></div>",
              '<div class="route-metric"><div class="inline-help">盈亏比</div><strong>' +
                escapeClientHtml(plRatioText) +
                "</strong></div>",
              '<div class="route-metric"><div class="inline-help">总盈亏 (USDT)</div><strong>' +
                escapeClientHtml(formatMetricNumber(metric?.totalPnl || 0, 2)) +
                "</strong></div>",
              "</div>",
              '<div class="route-metrics-grid">',
              '<div class="route-metric"><div class="inline-help">已实现盈亏</div><strong>' +
                escapeClientHtml(formatMetricNumber(metric?.realizedPnl || 0, 2)) +
                "</strong></div>",
              '<div class="route-metric"><div class="inline-help">未实现盈亏</div><strong>' +
                escapeClientHtml(formatMetricNumber(metric?.unrealizedPnl || 0, 2)) +
                "</strong></div>",
              '<div class="route-metric"><div class="inline-help">已平仓笔数</div><strong>' +
                escapeClientHtml(formatMetricNumber(metric?.closeCount || 0, 0)) +
                "</strong></div>",
              '<div class="route-metric"><div class="inline-help">成交额 (USDT)</div><strong>' +
                escapeClientHtml(formatMetricNumber(metric?.quoteVolume || 0, 2)) +
                "</strong></div>",
              "</div>",
              '<div class="field"><label>当前持仓</label>' + renderPositions(metric) + "</div>",
              '<div class="field"><label>最近成交</label>' + renderRecentTrades(metric) + "</div>",
              "</div>",
              "</section>",
            ].join("");
          })
          .join("");
      }

      function refreshStatus(message, isError) {
        statusLine.textContent = message || "";
        statusLine.style.color = isError ? "#9a5b00" : "#157347";
      }

      document.addEventListener("change", (event) => {
        const target = event.target;
        if (target instanceof HTMLSelectElement) {
          const analystId = target.dataset.analystId;
          const analystField = target.dataset.analystField;
          if (analystId && analystField) {
            const current = state.analystConfigs.get(analystId) || {
              enabled: true,
              amountQuote: "100",
              allowedSymbols: "",
            };
            current[analystField] = analystField === "enabled" ? target.value === "true" : target.value;
            state.analystConfigs.set(analystId, current);
            return;
          }
        }
        if (!(target instanceof HTMLInputElement)) return;
        const bucket = target.dataset.bucket;
        const id = target.dataset.id;
        if (!bucket || !id || !state[bucket]) return;
        if (target.checked) {
          state[bucket].add(id);
        } else {
          state[bucket].delete(id);
        }
        syncManualFields();
        renderChats();
        renderAnalystRoutes();
      });

      document.addEventListener("input", (event) => {
        const target = event.target;
        if (target instanceof HTMLInputElement) {
          const routeId = target.dataset.routeId;
          const routeField = target.dataset.routeField;
          if (routeId && routeField) {
            const current = state.analystRoutes.get(routeId) || { webhookUrl: "", displayName: "" };
            current[routeField] =
              routeField === "displayName"
                ? resolveRouteDisplayName(routeId, target.value)
                : target.value;
            state.analystRoutes.set(routeId, current);
          }
          const analystId = target.dataset.analystId;
          const analystField = target.dataset.analystField;
          if (analystId && analystField) {
            const current = state.analystConfigs.get(analystId) || {
              enabled: true,
              amountQuote: "100",
              allowedSymbols: "",
            };
            current[analystField] = target.value;
            state.analystConfigs.set(analystId, current);
          }
        }
      });

      analystMode.addEventListener("change", () => {
        state.analystMode = analystMode.value === "auto" ? "auto" : "manual";
      });

      forwardOnlyMode.addEventListener("change", () => {
        state.forwardOnlyMode = forwardOnlyMode.value !== "false";
      });

      newsMode.addEventListener("change", () => {
        state.newsMode = newsMode.value === "manual" ? "manual" : "auto";
      });

      generalAnalystSignalWebhookUrl.addEventListener("input", () => {
        state.generalAnalystSignalWebhookUrl = generalAnalystSignalWebhookUrl.value.trim();
      });

      aiEnabled.addEventListener("change", () => {
        state.ai.enabled = aiEnabled.value === "true";
      });
      aiBaseUrl.addEventListener("input", () => { state.ai.baseUrl = aiBaseUrl.value.trim(); });
      aiPrimaryModel.addEventListener("input", () => { state.ai.primaryModel = aiPrimaryModel.value.trim(); });
      aiReviewModel.addEventListener("input", () => { state.ai.reviewModel = aiReviewModel.value.trim(); });
      aiReviewEnabled.addEventListener("change", () => { state.ai.reviewEnabled = aiReviewEnabled.value === "true"; });
      aiApiKey.addEventListener("input", () => { state.ai.apiKey = aiApiKey.value.trim(); });
      aiTimeoutMs.addEventListener("input", () => { state.ai.timeoutMs = aiTimeoutMs.value.trim(); });
      gateMode.addEventListener("change", () => { state.gate.mode = gateMode.value || "dry_run"; });
      gateBaseUrl.addEventListener("input", () => { state.gate.baseUrl = gateBaseUrl.value.trim(); });
      gateApiKey.addEventListener("input", () => { state.gate.apiKey = gateApiKey.value.trim(); });
      gateApiSecret.addEventListener("input", () => { state.gate.apiSecret = gateApiSecret.value.trim(); });

      document.getElementById("reload").addEventListener("click", () => {
        location.reload();
      });

      document.getElementById("save").addEventListener("click", async () => {
        const payload = {
          telegram: {
            allowedChatIds: [...new Set([...state.allowed, ...parseCsv(allowedCsv.value)])],
            newsChatIds: [...new Set([...state.news, ...parseCsv(newsCsv.value)])],
            analystChatIds: [...new Set([...state.analyst, ...parseCsv(analystCsv.value)])],
          },
          feishu: {
            generalAnalystSignalWebhookUrl: state.generalAnalystSignalWebhookUrl,
            analystRoutes: [...state.analyst]
              .map((chatId) => {
                const route = state.analystRoutes.get(chatId) || {};
                return {
                  chatId,
                  displayName: resolveRouteDisplayName(chatId, route.displayName),
                  webhookUrl: String(route.webhookUrl || "").trim(),
                };
              })
              .filter((route) => route.displayName || route.webhookUrl),
          },
          analysts: {
            configs: [...state.analyst].map((chatId) => {
              const analystConfig = state.analystConfigs.get(chatId) || {};
              return {
                chatId,
                enabled: analystConfig.enabled !== false,
                amountQuote: String(analystConfig.amountQuote || "100").trim() || "100",
                allowedSymbols: parseCsv(String(analystConfig.allowedSymbols || "")),
              };
            }),
          },
          execution: {
            forwardOnlyMode: state.forwardOnlyMode,
            analystMode: state.analystMode,
            newsMode: state.newsMode,
          },
          ai: {
            enabled: state.ai.enabled,
            provider: state.ai.provider || "dashscope",
            baseUrl: state.ai.baseUrl,
            primaryModel: state.ai.primaryModel,
            reviewModel: state.ai.reviewModel,
            reviewEnabled: state.ai.reviewEnabled,
            apiKey: state.ai.apiKey,
            timeoutMs: Number.parseInt(state.ai.timeoutMs || "30000", 10) || 30000,
          },
          gate: {
            mode: state.gate.mode,
            baseUrl: state.gate.baseUrl,
            apiKey: state.gate.apiKey,
            apiSecret: state.gate.apiSecret,
          },
        };

        refreshStatus("保存中...", false);

        try {
          const response = await fetch("/api/runtime-settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            throw new Error(await response.text());
          }

          const saved = await response.json();
          state.allowed = new Set((saved.telegram.allowedChatIds || []).map(String));
          state.news = new Set((saved.telegram.newsChatIds || []).map(String));
          state.analyst = new Set((saved.telegram.analystChatIds || []).map(String));
          state.analystRoutes = new Map(
            (saved.feishu?.analystRoutes || []).map((route) => [
              String(route.chatId),
              {
                webhookUrl: String(route.webhookUrl || ""),
                displayName: resolveRouteDisplayName(String(route.chatId), route.displayName),
              },
            ]),
          );
          state.generalAnalystSignalWebhookUrl = String(
            saved.feishu?.generalAnalystSignalWebhookUrl || "",
          );
          state.analystConfigs = new Map(
            (saved.analysts?.configs || []).map((item) => [
              String(item.chatId),
              {
                enabled: item.enabled !== false,
                amountQuote: String(item.amountQuote || "100"),
                allowedSymbols: Array.isArray(item.allowedSymbols)
                  ? item.allowedSymbols.join(", ")
                  : String(item.allowedSymbols || ""),
              },
            ]),
          );
          state.forwardOnlyMode = saved.execution?.forwardOnlyMode !== false;
          state.analystMode = saved.execution?.analystMode === "auto" ? "auto" : "manual";
          state.newsMode = saved.execution?.newsMode === "manual" ? "manual" : "auto";
          state.ai = {
            enabled: Boolean(saved.ai?.enabled),
            provider: String(saved.ai?.provider || "dashscope"),
            baseUrl: String(saved.ai?.baseUrl || ""),
            primaryModel: String(saved.ai?.primaryModel || saved.ai?.model || "qwen3.5-plus"),
            reviewModel: String(saved.ai?.reviewModel || "deepseek-v3.2"),
            reviewEnabled: saved.ai?.reviewEnabled !== false,
            apiKey: String(saved.ai?.apiKey || ""),
            timeoutMs: String(saved.ai?.timeoutMs || "30000"),
          };
          state.gate = {
            mode: String(saved.gate?.mode || "dry_run"),
            baseUrl: String(saved.gate?.baseUrl || ""),
            apiKey: String(saved.gate?.apiKey || ""),
            apiSecret: String(saved.gate?.apiSecret || ""),
          };

          syncManualFields();
          renderChats();
          renderAnalystRoutes();
          refreshStatus("设置已保存。新的 Telegram 消息会按最新配置继续流转。", false);
        } catch (error) {
          refreshStatus("保存失败：" + (error?.message || error), true);
        }
      });

      syncManualFields();
      renderChats();
      renderAnalystRoutes();
    </script>
  </body>
</html>`;
}
