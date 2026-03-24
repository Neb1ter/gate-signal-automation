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
  signalCount,
  dryRun,
  autoExecutionEnabled,
  port,
  publicBaseUrl,
}) {
  const bootstrap = safeJson({
    runtimeSettings,
    knownChats,
    signalCount,
    dryRun,
    autoExecutionEnabled,
    port,
    publicBaseUrl,
  });

  const newsMode = runtimeSettings.execution?.newsMode === "manual" ? "manual" : "auto";
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
        color-scheme: light;
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
        max-width: 1180px;
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
        max-width: 820px;
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
        grid-template-columns: repeat(4, minmax(0, 1fr));
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
        grid-template-columns: minmax(320px, 380px) minmax(0, 1fr);
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
      select {
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
      @media (max-width: 980px) {
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
          <p>这里可以直接管理 Telegram 监听群、分析师群和新闻群，还能切换“新闻消息自动交易”或“新闻消息手动确认”。保存后会立刻生效，不需要改代码。</p>
          <div class="badge">分析师策略始终先发飞书，只有你确认后才会跟单</div>
        </div>
        <div class="actions">
          <a href="/logout" class="button-link button-secondary">退出登录</a>
          <button id="reload" class="button-secondary" type="button">刷新</button>
          <button id="save" class="button-primary" type="button">保存设置</button>
        </div>
      </div>

      <div class="grid">
        <div class="card">
          <div class="metric-label">已存信号</div>
          <div class="metric-value">${escapeHtml(signalCount)}</div>
          <div class="metric-hint">保存在运行时状态文件中</div>
        </div>
        <div class="card">
          <div class="metric-label">下单模式</div>
          <div class="metric-value">${dryRun ? "模拟" : "真实"}</div>
          <div class="metric-hint">${dryRun ? "当前不会真实下单" : "当前允许真实交易"}</div>
        </div>
        <div class="card">
          <div class="metric-label">自动执行总开关</div>
          <div class="metric-value">${autoExecutionEnabled ? "开启" : "关闭"}</div>
          <div class="metric-hint">命中自动策略后是否允许直接执行</div>
        </div>
        <div class="card">
          <div class="metric-label">当前入口</div>
          <div class="metric-value">${escapeHtml(isCloudEntry ? "云端" : "本机")}</div>
          <div class="metric-hint">${escapeHtml(accessEntry)}</div>
        </div>
      </div>

      <div class="panel-grid">
        <div class="stack">
          <div class="card">
            <div class="section-title">交易模式</div>
            <p class="section-copy">分析师策略默认永远走飞书确认。这里控制的是“新闻消息”收到后，是自动交易还是先手动确认。</p>
            <div class="field">
              <label for="newsMode">新闻交易模式</label>
              <select id="newsMode">
                <option value="auto" ${newsMode === "auto" ? "selected" : ""}>自动交易</option>
                <option value="manual" ${newsMode === "manual" ? "selected" : ""}>手动确认</option>
              </select>
              <small>自动交易：命中新闻策略后直接执行。手动确认：先发飞书，再由你决定是否跟单。</small>
            </div>
          </div>

          <div class="card">
            <div class="section-title">手动填写群聊 ID</div>
            <p class="section-copy">如果某个群还没被自动识别，可以直接把 chat id 填在这里，多个 ID 用英文逗号分隔。</p>

            <div class="field">
              <label for="allowedCsv">允许监听的群聊 ID</label>
              <textarea id="allowedCsv"></textarea>
              <small>只有这里的群才会被处理。留空则默认允许所有已识别群聊。</small>
            </div>

            <div class="field">
              <label for="newsCsv">新闻群 ID</label>
              <textarea id="newsCsv"></textarea>
            </div>

            <div class="field">
              <label for="analystCsv">分析师群 ID</label>
              <textarea id="analystCsv"></textarea>
            </div>

            <div class="status-line" id="statusLine"></div>
          </div>

          <div class="card">
            <div class="section-title">如何新增监听群</div>
            <p class="section-copy">1. 把 Telegram bot 拉进目标群或频道。2. 让群里出现一条新消息。3. 回来点刷新，就能在右侧列表里勾选分类。</p>
            <p class="inline-help">如果右侧一直是空的，通常有两种情况：bot 还没在这个群里真正收到过消息，或者 bot 没有读消息权限。现在你手工填过的群也会先显示出来，不用等第一条消息。</p>
          </div>
        </div>

        <div class="card">
          <div class="section-title">已发现的 Telegram 群聊</div>
          <p class="section-copy">这里会同时显示两类群：一类是 bot 真正见过消息的群；另一类是你手工配置但 bot 还没收到首条消息的群。</p>
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
        newsMode: bootstrap.runtimeSettings.execution?.newsMode === "manual" ? "manual" : "auto",
      };

      const allowedCsv = document.getElementById("allowedCsv");
      const newsCsv = document.getElementById("newsCsv");
      const analystCsv = document.getElementById("analystCsv");
      const newsMode = document.getElementById("newsMode");
      const statusLine = document.getElementById("statusLine");
      const chatTableWrap = document.getElementById("chatTableWrap");

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

      function syncManualFields() {
        allowedCsv.value = nonDiscoveredFromSet(state.allowed);
        newsCsv.value = nonDiscoveredFromSet(state.news);
        analystCsv.value = nonDiscoveredFromSet(state.analyst);
        newsMode.value = state.newsMode;
      }

      function checked(set, id) {
        return set.has(String(id)) ? "checked" : "";
      }

      function getVisibleChats() {
        const knownMap = new Map(
          bootstrap.knownChats.map((chat) => [String(chat.id), { ...chat, isConfiguredOnly: false }]),
        );

        const configuredIds = new Set([...state.allowed, ...state.news, ...state.analyst]);
        for (const id of configuredIds) {
          if (!knownMap.has(id)) {
            knownMap.set(id, {
              id,
              title: "手动配置的群聊",
              username: "",
              type: "configured",
              lastSeenAt: "",
              lastText: "bot 还没有在这个群里收到过新消息",
              isConfiguredOnly: true,
            });
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

      function renderChats() {
        const chats = getVisibleChats();
        if (!chats.length) {
          chatTableWrap.innerHTML = '<p class="empty">目前还没有自动识别到任何 Telegram 群，也没有手动配置的群 ID。你可以先在左侧填入群 ID，或者先让 bot 收到一条新消息。</p>';
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
          execution: {
            newsMode: state.newsMode,
          },
        };

        refreshStatus("保存中...", false);

        try {
          const response = await fetch("/api/runtime-settings", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            throw new Error(await response.text());
          }

          const saved = await response.json();
          state.allowed = new Set((saved.telegram.allowedChatIds || []).map(String));
          state.news = new Set((saved.telegram.newsChatIds || []).map(String));
          state.analyst = new Set((saved.telegram.analystChatIds || []).map(String));
          state.newsMode = saved.execution?.newsMode === "manual" ? "manual" : "auto";
          syncManualFields();
          renderChats();
          refreshStatus("已保存，新的 Telegram 消息会立刻按新设置处理。", false);
        } catch (error) {
          refreshStatus("保存失败：" + error.message, true);
        }
      });

      syncManualFields();
      renderChats();
    </script>
  </body>
</html>`;
}
