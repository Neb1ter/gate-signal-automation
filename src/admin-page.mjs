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
    <title>浜ゆ槗淇″彿鍚庡彴</title>
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
          <h1>浜ゆ槗淇″彿鍚庡彴</h1>
          <p>杩欓噷鍙互绠＄悊 Telegram 鐩戝惉缇ゃ€佸垎鏋愬笀鍒嗙兢杞彂銆佹柊闂昏嚜鍔?/ 鎵嬪姩浜ゆ槗妯″紡銆丄I 缁撴瀯鍖栬兘鍔涳紝浠ュ強 Gate 妯℃嫙璺熷崟閰嶇疆銆?/p>
          <div class="badge">鍒嗘瀽甯堝師鏂囦細鍏堣劚鏁忥紝鍐嶆寜缁撴瀯鍖栧崱鐗囧彂閫佸埌瀵瑰簲椋炰功缇わ紝纭鍚庡啀鍐冲畾鏄惁璺熷崟銆?/div>
        </div>
        <div class="actions">
          <a href="/pending" class="button-link button-secondary">鏌ョ湅寰呭喅绛?/a>
          <a href="/logout" class="button-link button-secondary">閫€鍑虹櫥褰?/a>
          <button id="reload" class="button-secondary" type="button">鍒锋柊</button>
          <button id="save" class="button-primary" type="button">淇濆瓨璁剧疆</button>
        </div>
      </div>

      <div class="grid">
        <div class="card">
          <div class="metric-label">宸插瓨淇″彿</div>
          <div class="metric-value">${escapeHtml(signalCount)}</div>
          <div class="metric-hint">褰撳墠鏁版嵁搴撲腑宸蹭繚瀛樼殑淇″彿鏁伴噺</div>
        </div>
        <div class="card">
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
          <div class="metric-label">AI 结构化</div>
          <div class="metric-value">${runtimeSettings.ai?.enabled ? "开启" : "关闭"}</div>
          <div class="metric-hint">当前运行态：${escapeHtml(runtimeAiEnabled ? "已启用" : "未启用")}</div>
        </div>
        <div class="card">
          <div class="metric-label">Gate 璺熷崟閫氶亾</div>
          <div class="metric-value">${escapeHtml(["testnet", "futures_testnet", "spot_testnet"].includes(runtimeSettings.gate?.mode) ? "Gate 妯℃嫙" : "鏈湴 Dry Run")}</div>
          <div class="metric-hint">褰撳墠杩愯鎬侊細${escapeHtml(runtimeGateMode === "futures_testnet" || runtimeGateMode === "testnet" ? "Gate 妯℃嫙鍚堢害" : runtimeGateMode === "spot_testnet" ? "Gate 妯℃嫙鐜拌揣" : "鏈湴 Dry Run")}</div>
        </div>
      </div>

      <div class="panel-grid">
        <div class="stack">
          <div class="card">
            <div class="section-title">鏂伴椈浜ゆ槗妯″紡</div>
            <p class="section-copy">鍒嗘瀽甯堟秷鎭缁堝厛鍙戦涔︼紝鐢变綘鎵嬪姩鍐崇瓥銆傝繖閲屾帶鍒剁殑鏄柊闂诲懡涓瓥鐣ュ悗锛屾槸鑷姩浜ゆ槗杩樻槸鍏堢瓑浣犵‘璁ゃ€?/p>
            <div class="field">
              <label for="newsMode">鏂伴椈浜ゆ槗妯″紡</label>
              <select id="newsMode">
                <option value="auto" ${runtimeSettings.execution?.newsMode === "manual" ? "" : "selected"}>鑷姩浜ゆ槗</option>
                <option value="manual" ${runtimeSettings.execution?.newsMode === "manual" ? "selected" : ""}>鎵嬪姩纭</option>
              </select>
              <small>鑷姩浜ゆ槗锛氬懡涓柊闂荤瓥鐣ュ悗鐩存帴鎵ц銆傛墜鍔ㄧ‘璁わ細鍏堝彂椋炰功锛屽啀鐢变綘鍐冲畾鏄惁璺熷崟銆?/small>
            </div>
          </div>

          <div class="card">
            <div class="section-title">Telegram 缇ょ洃鍚厤缃?/div>
            <p class="section-copy">濡傛灉鏌愪釜缇よ繕娌¤鑷姩璇嗗埆锛屽彲浠ョ洿鎺ュ湪杩欓噷濉叆 chat id銆傚涓?ID 鐢ㄨ嫳鏂囬€楀彿鍒嗛殧銆?/p>

            <div class="field">
              <label for="allowedCsv">鍏佽鐩戝惉鐨勭兢 ID</label>
              <textarea id="allowedCsv"></textarea>
              <small>鍙湁杩欓噷鐨勭兢鎵嶄細琚鐞嗐€傜暀绌烘椂绛変簬鍏佽鎵€鏈夊凡鍒嗙被缇ゃ€?/small>
            </div>

            <div class="field">
              <label for="newsCsv">鏂伴椈缇?ID</label>
              <textarea id="newsCsv"></textarea>
            </div>

            <div class="field">
              <label for="analystCsv">鍒嗘瀽甯堢兢 ID</label>
              <textarea id="analystCsv"></textarea>
            </div>
          </div>

          <div class="card">
            <div class="section-title">AI 文案结构化配置</div>
            <p class="section-copy">这里已经预设成阿里云百炼双模型链路：千问负责中文语义提取，DeepSeek 负责二次复核和自动化适配判断。你现在只差最后补上密钥。</p>
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
            <div class="section-title">Gate 妯℃嫙璺熷崟閰嶇疆</div>
            <p class="section-copy">褰撳墠寤鸿鍏堟帴 Gate 妯℃嫙浜ゆ槗銆備繚瀛樺悗锛屽垎鏋愬笀纭璺熷崟浼氫紭鍏堣蛋杩欓噷鐨勬ā鎷?API锛涘鏋滀笉寮€锛屽垯浠嶇劧浣跨敤鏈湴 Dry Run銆?/p>
            <div class="field">
              <label for="gateMode">Gate 璺熷崟妯″紡</label>
              <select id="gateMode">
                <option value="dry_run" ${["futures_testnet","spot_testnet","testnet"].includes(runtimeSettings.gate?.mode) ? "" : "selected"}>鏈湴 Dry Run</option>
                <option value="futures_testnet" ${runtimeSettings.gate?.mode === "futures_testnet" || runtimeSettings.gate?.mode === "testnet" ? "selected" : ""}>Gate 妯℃嫙鍚堢害</option>
                <option value="spot_testnet" ${runtimeSettings.gate?.mode === "spot_testnet" ? "selected" : ""}>Gate 妯℃嫙鐜拌揣</option>
              </select>
            </div>
            <div class="field">
              <label for="gateBaseUrl">Gate API Base URL</label>
              <input id="gateBaseUrl" type="url" placeholder="https://api-testnet.gateapi.io" value="${escapeHtml(runtimeSettings.gate?.baseUrl || "")}" />
              <small>寤鸿妯℃嫙浜ゆ槗濉啓瀹樻柟 Testnet 鍦板潃銆?/small>
            </div>
            <div class="field">
              <label for="gateApiKey">Gate API Key</label>
              <input id="gateApiKey" type="password" placeholder="妯℃嫙浜ゆ槗 API Key" value="${escapeHtml(runtimeSettings.gate?.apiKey || "")}" />
            </div>
            <div class="field">
              <label for="gateApiSecret">Gate API Secret</label>
              <input id="gateApiSecret" type="password" placeholder="妯℃嫙浜ゆ槗 API Secret" value="${escapeHtml(runtimeSettings.gate?.apiSecret || "")}" />
            </div>
          </div>

          <div class="card">
            <div class="section-title">鍒嗘瀽甯堝垎缇よ浆鍙?/div>
            <p class="section-copy">浣犲彲浠ユ妸涓嶅悓鐨?Telegram 鍒嗘瀽甯堢兢鍒嗗埆杞彂鍒颁笉鍚岀殑椋炰功缇ゃ€傛瘡涓涔︾兢閮介渶瑕佽嚜宸辩殑 webhook銆?/p>
            <div class="badge">${defaultFeishuConfigured ? "宸插瓨鍦ㄩ粯璁ら涔︾兢锛氭湭鍗曠嫭閰嶇疆鏃朵細鍥炶惤鍒伴粯璁ょ兢" : "褰撳墠娌℃湁榛樿椋炰功缇わ細璇疯嚦灏戠粰鍒嗘瀽甯堢兢閰嶇疆涓€涓?webhook"}</div>
            <div id="analystRoutesWrap" class="route-grid"></div>
          </div>

          <div class="card">
            <div class="section-title">浣跨敤璇存槑</div>
            <div class="hint-list">
              <div>1. 鍙充晶鈥滃凡鍙戠幇鐨?Telegram 缇よ亰鈥濋噷鍕鹃€夊摢浜涚兢灞炰簬鈥滄柊闂荤兢鈥濇垨鈥滃垎鏋愬笀缇も€濄€?/div>
              <div>2. 鍒嗘瀽甯堟秷鎭細灏介噺鎸夌粨鏋勫寲鏍煎紡杞彂锛涙棤娉曚笅鍗曠殑绾垎鏋愶紝涔熶細浣滀负缁撴瀯鍖栬鐐瑰崱鐗囧彂閫併€?/div>
              <div>3. 椋炰功娑堟伅閲屽彧灞曠ず鑴辨晱鍚庣殑姝ｆ枃锛屼笉鍐嶉澶栨樉绀衡€滈殣绉佸鐞嗏€濇彁绀鸿銆?/div>
              <div>4. Gate 妯℃嫙浜ゆ槗闇€瑕佷綘鑷繁鐨勬ā鎷?API Key / Secret锛涙湭閰嶇疆鏃朵粛浼氳蛋鏈湴 Dry Run銆?/div>
            </div>
            <div class="status-line" id="statusLine"></div>
          </div>
        </div>

        <div class="card">
          <div class="section-title">宸插彂鐜扮殑 Telegram 缇よ亰</div>
          <p class="section-copy">杩欓噷浼氭妸绯荤粺瑙佽繃鐨勭兢锛屼互鍙婁綘鎵嬪伐閰嶇疆浣嗚繕娌℃敹鍒拌繃棣栨潯娑堟伅鐨勭兢涓€璧峰睍绀哄嚭鏉ャ€備綘涓嶇敤鍐嶈嚜宸辫 chat id锛屽彧瑕佺湅缇ゅ悕鍗冲彲銆?/p>
          <div id="chatTableWrap"></div>
        </div>
      </div>
    </div>

    <script id="bootstrap" type="application/json">${bootstrap}</script>
    <script>
      const bootstrap = JSON.parse(document.getElementById("bootstrap").textContent);
      const discoveredIds = new Set(bootstrap.knownChats.map((chat) => String(chat.id)));
      const state = {
        allowed: new Set((bootstrap.runtimeSettings.telegram.allowedChatIds || []).map(String)),
        news: new Set((bootstrap.runtimeSettings.telegram.newsChatIds || []).map(String)),
        analyst: new Set((bootstrap.runtimeSettings.telegram.analystChatIds || []).map(String)),
        analystRoutes: new Map(
          (bootstrap.runtimeSettings.feishu?.analystRoutes || []).map((route) => [
            String(route.chatId),
            {
              webhookUrl: String(route.webhookUrl || ""),
              displayName: String(route.displayName || ""),
            },
          ]),
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
      const newsMode = document.getElementById("newsMode");
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
          title: bootstrap.configuredChatLabels?.[id] || "鎵嬪姩閰嶇疆鐨勭兢鑱?,
          username: "",
          type: "configured",
          lastSeenAt: "",
          lastText: "绯荤粺杩樻病鍦ㄨ繖涓兢閲屾敹鍒伴鏉℃柊娑堟伅",
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
        newsMode.value = state.newsMode;
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
          chatTableWrap.innerHTML = '<p class="empty">鐩墠杩樻病鏈夎嚜鍔ㄨ瘑鍒埌浠讳綍 Telegram 缇わ紝涔熸病鏈夋墜鍔ㄩ厤缃殑缇?ID銆備綘鍙互鍏堝湪宸︿晶濉叆缇?ID锛屾垨鑰呭厛璁╃郴缁熸敹鍒颁竴鏉℃柊娑堟伅銆?/p>';
          return;
        }

        const rows = chats
          .map((chat) => {
            const id = String(chat.id);
            const title = escapeClientHtml(chat.title || chat.username || id);
            const metaParts = [id];
            if (chat.username) metaParts.push("@" + chat.username);
            if (chat.type) metaParts.push(chat.type);
            if (chat.isConfiguredOnly) metaParts.push("绛夊緟棣栨潯娑堟伅");
            const helpText = escapeClientHtml(chat.lastText || "");
            return \`
              <tr>
                <td>
                  <div class="chat-title">\${title}</div>
                  <div class="chat-meta">\${escapeClientHtml(metaParts.join(" | "))}</div>
                  <div class="inline-help">\${helpText}</div>
                </td>
                <td>\${escapeClientHtml(chat.lastSeenAt || "灏氭湭鏀跺埌")}</td>
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
                <th>缇よ亰</th>
                <th>鏈€杩戞敹鍒?/th>
                <th>鍏佽鐩戝惉</th>
                <th>鏂伴椈缇?/th>
                <th>鍒嗘瀽甯堢兢</th>
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
            '<div class="empty">杩樻病鏈夎缃换浣曞垎鏋愬笀缇ゃ€傚厛鎶?Telegram 缇ゅ嬀閫変负鈥滃垎鏋愬笀缇も€濓紝杩欓噷灏变細鍑虹幇瀵瑰簲閰嶇疆銆?/div>';
          return;
        }

        const renderPositions = (metric) => {
          if (!metric?.positions?.length) {
            return '<div class="inline-help">褰撳墠娌℃湁鏈钩浠撶殑妯℃嫙鎸佷粨銆?/div>';
          }
          return [
            '<div class="mini-list">',
            ...metric.positions.slice(0, 3).map((position) =>
              [
                '<div class="mini-item">',
                '<div class="mini-item-title">' + escapeClientHtml(position.symbol) + "</div>",
                '<div class="mini-item-meta">' +
                  "鏁伴噺 " +
                  escapeClientHtml(formatMetricNumber(position.qty, 6)) +
                  " 路 鍧囦环 " +
                  escapeClientHtml(formatMetricNumber(position.avgCost, 2)) +
                  " 路 娴泩浜?" +
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
            return '<div class="inline-help">褰撳墠杩樻病鏈夊彲缁熻鐨勬垚浜よ褰曘€?/div>';
          }
          return [
            '<div class="mini-list">',
            ...metric.recentTrades.slice(0, 3).map((trade) => {
              const realizedText =
                trade.realizedPnl === null
                  ? ""
                  : " 路 宸插疄鐜扮泩浜?" + escapeClientHtml(formatMetricNumber(trade.realizedPnl, 2));
              return [
                '<div class="mini-item">',
                '<div class="mini-item-title">' +
                  escapeClientHtml(trade.symbol) +
                  " 路 " +
                  escapeClientHtml(String(trade.side || "").toUpperCase()) +
                  "</div>",
                '<div class="mini-item-meta">' +
                  escapeClientHtml(String(trade.createdAt || "").replace("T", " ").replace("Z", " UTC")) +
                  " 路 鍧囦环 " +
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
              "<p>Telegram 缇?ID锛? + escapeClientHtml(chatId) + "</p>",
              '<div class="route-fields">',
              "<div>",
              "<label>椋炰功鏄剧ず鍚嶇О</label>",
              '<input type="text" data-route-id="' +
                escapeClientHtml(chatId) +
                '" data-route-field="displayName" value="' +
                escapeClientHtml(route.displayName) +
                '" placeholder="渚嬪锛氫笁椹摜绛栫暐涓撶嚎" />',
              "<small>椋炰功鏀跺埌娑堟伅鏃舵樉绀鸿繖涓悕绉帮紝鐢ㄦ潵鍜?Telegram 鍘熺兢鍋氬尯鍒嗐€?/small>",
              "</div>",
              "<div>",
              "<label>涓撳睘椋炰功 Webhook</label>",
              '<input type="url" data-route-id="' +
                escapeClientHtml(chatId) +
                '" data-route-field="webhookUrl" value="' +
                escapeClientHtml(route.webhookUrl) +
                '" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." />',
              "<small>濉簡灏卞彂鍒拌繖涓垎鏋愬笀鑷繁鐨勯涔︾兢锛涚暀绌哄垯鍥炶惤鍒伴粯璁ら涔︾兢銆?/small>",
              "</div>",
              '<div class="route-config-grid">',
              "<div>",
              "<label>璺熷崟寮€鍏?/label>",
              '<select data-analyst-id="' +
                escapeClientHtml(chatId) +
                '" data-analyst-field="enabled">',
              '<option value="true"' + (analystConfig.enabled !== false ? " selected" : "") + ">寮€鍚?/option>",
              '<option value="false"' + (analystConfig.enabled === false ? " selected" : "") + ">鍏抽棴</option>",
              "</select>",
              "<small>鍏抽棴鍚庝粛浼氳浆鍙戠瓥鐣ワ紝浣嗕笉浼氱敓鎴愬彲鎵ц璺熷崟寤鸿銆?/small>",
              "</div>",
              "<div>",
              "<label>榛樿璺熷崟閲戦 (USDT)</label>",
              '<input type="text" data-analyst-id="' +
                escapeClientHtml(chatId) +
                '" data-analyst-field="amountQuote" value="' +
                escapeClientHtml(analystConfig.amountQuote || "100") +
                '" placeholder="渚嬪 100" />',
              "<small>杩欎釜鍒嗘瀽甯堢殑涔板叆淇″彿榛樿浣跨敤杩欎釜閲戦涓嬫ā鎷熷崟銆?/small>",
              "</div>",
              "<div>",
              "<label>鐧藉悕鍗曞竵绉?/label>",
              '<input type="text" data-analyst-id="' +
                escapeClientHtml(chatId) +
                '" data-analyst-field="allowedSymbols" value="' +
                escapeClientHtml(analystConfig.allowedSymbols || "") +
                '" placeholder="渚嬪 BTC, ETH, SOL" />',
              "<small>鍙厑璁歌繖浜涘竵绉嶇敓鎴愯窡鍗曞缓璁紱鐣欑┖琛ㄧず涓嶉檺鍒躲€?/small>",
              "</div>",
              "</div>",
              "</div>",
              '<div class="route-metrics">',
              '<div class="chat-title">绛栫暐鎵ц缁熻</div>',
              '<div class="route-metrics-grid">',
              '<div class="route-metric"><div class="inline-help">浜ゆ槗娆℃暟</div><strong>' +
                escapeClientHtml(formatMetricNumber(metric?.tradeCount || 0, 0)) +
                "</strong></div>",
              '<div class="route-metric"><div class="inline-help">鑳滅巼</div><strong>' +
                escapeClientHtml(winRateText) +
                "</strong></div>",
              '<div class="route-metric"><div class="inline-help">鐩堜簭姣?/div><strong>' +
                escapeClientHtml(plRatioText) +
                "</strong></div>",
              '<div class="route-metric"><div class="inline-help">鎬荤泩浜?(USDT)</div><strong>' +
                escapeClientHtml(formatMetricNumber(metric?.totalPnl || 0, 2)) +
                "</strong></div>",
              "</div>",
              '<div class="route-metrics-grid">',
              '<div class="route-metric"><div class="inline-help">宸插疄鐜扮泩浜?/div><strong>' +
                escapeClientHtml(formatMetricNumber(metric?.realizedPnl || 0, 2)) +
                "</strong></div>",
              '<div class="route-metric"><div class="inline-help">鏈疄鐜扮泩浜?/div><strong>' +
                escapeClientHtml(formatMetricNumber(metric?.unrealizedPnl || 0, 2)) +
                "</strong></div>",
              '<div class="route-metric"><div class="inline-help">宸插钩浠撶瑪鏁?/div><strong>' +
                escapeClientHtml(formatMetricNumber(metric?.closeCount || 0, 0)) +
                "</strong></div>",
              '<div class="route-metric"><div class="inline-help">鎴愪氦棰?(USDT)</div><strong>' +
                escapeClientHtml(formatMetricNumber(metric?.quoteVolume || 0, 2)) +
                "</strong></div>",
              "</div>",
              '<div class="field"><label>褰撳墠鎸佷粨</label>' + renderPositions(metric) + "</div>",
              '<div class="field"><label>鏈€杩戞垚浜?/label>' + renderRecentTrades(metric) + "</div>",
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
            current[routeField] = target.value;
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

      newsMode.addEventListener("change", () => {
        state.newsMode = newsMode.value === "manual" ? "manual" : "auto";
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
            analystRoutes: [...state.analyst]
              .map((chatId) => {
                const route = state.analystRoutes.get(chatId) || {};
                return {
                  chatId,
                  displayName: String(route.displayName || "").trim(),
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

        refreshStatus("淇濆瓨涓?..", false);

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
                displayName: String(route.displayName || ""),
              },
            ]),
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
          refreshStatus("璁剧疆宸蹭繚瀛樸€傛柊鐨?Telegram 娑堟伅浼氭寜鏈€鏂伴厤缃户缁祦杞€?, false);
        } catch (error) {
          refreshStatus("淇濆瓨澶辫触锛? + (error?.message || error), true);
        }
      });

      syncManualFields();
      renderChats();
      renderAnalystRoutes();
    </script>
  </body>
</html>`;
}
