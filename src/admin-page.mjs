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
  defaultFeishuConfigured,
  telegramSourceMode,
  telegramRuntimeSummary,
  port,
  publicBaseUrl,
}) {
  const bootstrap = safeJson({
    runtimeSettings,
    knownChats,
    configuredChatLabels,
    signalCount,
    defaultFeishuConfigured,
    telegramSourceMode,
    telegramRuntimeSummary,
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
    <title>信号转发后台</title>
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
      .shell { max-width: 1380px; margin: 0 auto; padding: 28px 18px 40px; }
      .hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 20px; }
      h1, h2, h3, p { margin: 0; }
      .hero-copy p { margin-top: 8px; color: var(--muted); max-width: 860px; }
      .actions { display: flex; gap: 10px; flex-wrap: wrap; }
      button, .button-link {
        border: 0; border-radius: 12px; padding: 11px 16px;
        font: inherit; cursor: pointer; text-decoration: none;
        display: inline-flex; align-items: center; justify-content: center;
      }
      .button-primary { background: var(--accent); color: #fff; }
      .button-secondary { background: #edf2f9; color: var(--text); }
      .grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 14px; margin-bottom: 20px; }
      .card {
        background: var(--card); border: 1px solid var(--line);
        border-radius: 18px; padding: 18px;
        box-shadow: 0 12px 30px rgba(16, 29, 62, 0.05);
      }
      .metric-label { color: var(--muted); font-size: 12px; letter-spacing: 0.05em; text-transform: uppercase; }
      .metric-value { margin-top: 8px; font-size: 28px; font-weight: 700; }
      .metric-hint { margin-top: 8px; color: var(--muted); font-size: 12px; word-break: break-all; }
      .panel-grid { display: grid; grid-template-columns: minmax(420px, 520px) minmax(0, 1fr); gap: 18px; }
      .stack { display: grid; gap: 18px; }
      .section-title { font-size: 18px; font-weight: 700; }
      .section-copy { margin-top: 6px; color: var(--muted); }
      .field { margin-top: 16px; }
      .field label { display: block; font-weight: 600; margin-bottom: 8px; }
      .field small { display: block; color: var(--muted); margin-top: 6px; }
      textarea, select, input[type="text"], input[type="url"], input[type="password"] {
        width: 100%; border: 1px solid var(--line); border-radius: 12px;
        padding: 12px 14px; font: inherit; background: #fff;
      }
      textarea { min-height: 90px; resize: vertical; }
      table { width: 100%; border-collapse: collapse; margin-top: 18px; }
      th, td { padding: 12px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
      th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
      .chat-title { font-weight: 600; }
      .chat-meta, .empty, .status-line, .inline-help { color: var(--muted); }
      .status-line { min-height: 22px; margin-top: 12px; }
      .badge {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 5px 10px; border-radius: 999px;
        background: var(--accent-soft); color: var(--accent); font-weight: 600; margin-top: 10px;
      }
      .route-grid { display: grid; gap: 12px; margin-top: 16px; }
      .route-card { border: 1px solid var(--line); border-radius: 16px; padding: 14px; background: #fbfcff; }
      .route-card h3 { font-size: 15px; }
      .route-card p { margin-top: 4px; color: var(--muted); }
      .route-fields { display: grid; gap: 10px; margin-top: 12px; }
      .hint-list { display: grid; gap: 10px; margin-top: 14px; color: var(--muted); }
      @media (max-width: 1180px) {
        .grid, .panel-grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="hero">
        <div class="hero-copy">
          <h1>信号转发后台</h1>
          <p>管理 Telegram 监听群、分析师分群转发到飞书组织群。当前为纯转发模式：只做去噪、脱敏、话题化转发。</p>
          <div class="badge">纯转发模式</div>
        </div>
        <div class="actions">
          <a href="/signals" class="button-link button-secondary">查看信号</a>
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
          <div class="metric-value">纯转发</div>
          <div class="metric-hint">只做去噪转发，不涉及交易</div>
        </div>
        <div class="card">
          <div class="metric-label">飞书默认 Webhook</div>
          <div class="metric-value">${defaultFeishuConfigured ? "已配置" : "未配置"}</div>
          <div class="metric-hint">未单独配置路由的分析师群会回落到此</div>
        </div>
      </div>

      <div class="panel-grid">
        <div class="stack">
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
            <div class="field">
              <label for="newsMode">新闻处理模式</label>
              <select id="newsMode">
                <option value="auto">自动转发</option>
                <option value="manual">手动确认</option>
              </select>
              <small>自动转发：新闻消息直接转发。手动确认：新闻消息需人工确认后才转发。</small>
            </div>
          </div>

          <div class="card">
            <div class="section-title">分析师分群转发</div>
            <p class="section-copy">把不同的 Telegram 分析师群分别转发到不同的飞书组织群。每个飞书群需要自己的自定义机器人 webhook 地址。</p>
            <div class="badge">${defaultFeishuConfigured ? "已存在默认飞书群：未单独配置时会回落到默认群" : "当前没有默认飞书群：请至少给分析师群配置一个 webhook"}</div>
            <div id="analystRoutesWrap" class="route-grid"></div>
          </div>

          <div class="card">
            <div class="section-title">使用说明</div>
            <div class="hint-list">
              <div>1. 右侧"已发现的 Telegram 群聊"里勾选哪些群属于"新闻群"或"分析师群"。</div>
              <div>2. 分析师消息会自动去噪、脱敏后转发到各自配置的飞书组织群。</div>
              <div>3. 每个分析师群需要单独配置飞书自定义机器人的 webhook 地址（open.feishu.cn/open-apis/bot/v2/hook/...）。</div>
              <div>4. 未单独配置路由的分析师消息会回落到默认飞书 webhook（FEISHU_WEBHOOK_URL）。</div>
            </div>
            <div class="status-line" id="statusLine"></div>
          </div>
        </div>

        <div class="card">
          <div class="section-title">已发现的 Telegram 群聊</div>
          <p class="section-copy">系统见过的群以及手工配置但还没收到首条消息的群都会在这里展示。</p>
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
        if (/^\\\\?{2,}$/.test(text)) return true;
        if (text.includes("�")) return true;
        return [
          "鍒分析", "三驈", "洪七", "鏢易盈",
          "零下", "聸琴", "熊鸯", "btc乔丶", "澓漂亨",
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
              discordWebhookUrl: String(route.discordWebhookUrl || ""),
              displayName: resolveRouteDisplayName(String(route.chatId), route.displayName),
            },
          ]),
        ),
        newsMode: bootstrap.runtimeSettings.execution?.newsMode === "manual" ? "manual" : "auto",
      };

      const allowedCsv = document.getElementById("allowedCsv");
      const newsCsv = document.getElementById("newsCsv");
      const analystCsv = document.getElementById("analystCsv");
      const newsMode = document.getElementById("newsMode");
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
          ...state.allowed, ...state.news, ...state.analyst, ...state.analystRoutes.keys(),
        ]);
        for (const id of configuredIds) {
          if (!knownMap.has(id)) {
            knownMap.set(id, getConfiguredOnlyChat(id));
          }
        }
        return [...knownMap.values()].sort((a, b) => {
          const aConfiguredOnly = a.isConfiguredOnly ? 1 : 0;
          const bConfiguredOnly = b.isConfiguredOnly ? 1 : 0;
          if (aConfiguredOnly !== bConfiguredOnly) return aConfiguredOnly - bConfiguredOnly;
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
        const rows = chats.map((chat) => {
          const id = String(chat.id);
          const title = escapeClientHtml(chat.title || chat.username || id);
          const metaParts = [id];
          if (chat.username) metaParts.push("@" + chat.username);
          if (chat.type) metaParts.push(chat.type);
          if (chat.isConfiguredOnly) metaParts.push("等待首条消息");
          const helpText = escapeClientHtml(chat.lastText || "");
          return [
            "<tr>",
            "<td><div class=\"chat-title\">" + title + "</div><div class=\"chat-meta\">" + escapeClientHtml(metaParts.join(" | ")) + "</div><div class=\"inline-help\">" + helpText + "</div></td>",
            "<td>" + escapeClientHtml(chat.lastSeenAt || "尚未收到") + "</td>",
            "<td><input type=\"checkbox\" data-bucket=\"allowed\" data-id=\"" + id + "\" " + checked(state.allowed, id) + " /></td>",
            "<td><input type=\"checkbox\" data-bucket=\"news\" data-id=\"" + id + "\" " + checked(state.news, id) + " /></td>",
            "<td><input type=\"checkbox\" data-bucket=\"analyst\" data-id=\"" + id + "\" " + checked(state.analyst, id) + " /></td>",
            "</tr>",
          ].join("");
        }).join("");
        chatTableWrap.innerHTML = [
          "<table>",
          "<thead><tr><th>群聊</th><th>最近收到</th><th>允许监听</th><th>新闻群</th><th>分析师群</th></tr></thead>",
          "<tbody>" + rows + "</tbody>",
          "</table>",
        ].join("");
      }

      function renderAnalystRoutes() {
        const analystIds = [...state.analyst].sort((a, b) =>
          getChatTitle(a).localeCompare(getChatTitle(b), "zh-CN"),
        );
        if (!analystIds.length) {
          analystRoutesWrap.innerHTML = '<div class="empty">还没有设置任何分析师群。先把 Telegram 群勾选为“分析师群”，这里就会出现对应配置。</div>';
          return;
        }
        analystRoutesWrap.innerHTML = analystIds.map((chatId) => {
          const route = state.analystRoutes.get(chatId) || { webhookUrl: "", discordWebhookUrl: "", displayName: "" };
          return [
            '<section class="route-card">',
            "<h3>" + escapeClientHtml(getChatTitle(chatId)) + "</h3>",
            "<p>Telegram 群 ID：" + escapeClientHtml(chatId) + "</p>",
            '<div class="route-fields">',
            "<div>",
            "<label>飞书显示名称</label>",
            '<input type="text" data-route-id="' + escapeClientHtml(chatId) + '" data-route-field="displayName" value="' + escapeClientHtml(resolveRouteDisplayName(chatId, route.displayName)) + '" placeholder="例如：三马哥策略专线" />',
            "<small>飞书收到消息时显示这个名称，用来和 Telegram 原群做区分。</small>",
            "</div>",
            "<div>",
            "<label>Discord Webhook</label>",
            '<input type="url" data-route-id="' + escapeClientHtml(chatId) + '" data-route-field="discordWebhookUrl" value="' + escapeClientHtml(route.discordWebhookUrl || "") + '" placeholder="https://discord.com/api/webhooks/..." />',
            "<small>填了就同步转发到 Discord；留空则不发 Discord。</small>",
            "</div>",
            "<div>",
            "<label>专属飞书 Webhook</label>",
            '<input type="url" data-route-id="' + escapeClientHtml(chatId) + '" data-route-field="webhookUrl" value="' + escapeClientHtml(route.webhookUrl) + '" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." />',
            "<small>填了就发到这个分析师自己的飞书群；留空则回落到默认飞书群。</small>",
            "</div>",
            "</div>",
            "</section>",
          ].join("");
        }).join("");
      }

      function refreshStatus(message, isError) {
        statusLine.textContent = message || "";
        statusLine.style.color = isError ? "#9a5b00" : "#157347";
      }

      document.addEventListener("change", (event) => {
        const target = event.target;
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
            const current = state.analystRoutes.get(routeId) || { webhookUrl: "", discordWebhookUrl: "", displayName: "" };
            current[routeField] = routeField === "displayName"
              ? resolveRouteDisplayName(routeId, target.value)
              : target.value;
            state.analystRoutes.set(routeId, current);
          }
        }
      });

      newsMode.addEventListener("change", () => {
        state.newsMode = newsMode.value === "manual" ? "manual" : "auto";
      });

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
                  displayName: resolveRouteDisplayName(chatId, route.displayName),
                  webhookUrl: String(route.webhookUrl || "").trim(),
                  discordWebhookUrl: String(route.discordWebhookUrl || "").trim(),
                };
              })
              .filter((route) => route.displayName || route.webhookUrl || route.discordWebhookUrl),
          },
          execution: {
            newsMode: state.newsMode,
            forwardOnlyMode: true,
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
              discordWebhookUrl: String(route.discordWebhookUrl || ""),
              displayName: resolveRouteDisplayName(String(route.chatId), route.displayName),
            },
            ]),
          );
          state.newsMode = saved.execution?.newsMode === "manual" ? "manual" : "auto";

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
