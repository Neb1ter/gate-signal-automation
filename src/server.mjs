import crypto from "node:crypto";
import http from "node:http";

import { renderAdminPage } from "./admin-page.mjs";
import { config, ensureRuntimeDirs, loadPlaybooks } from "./config.mjs";
import { FeishuNotifier } from "./feishu.mjs";
import { GateSpotClient } from "./gate-api.mjs";
import {
  createSignalFromPayload,
  createSignalFromTelegramMessage,
  evaluateSignal,
  renderSignalReviewPage,
} from "./signal-engine.mjs";
import { JsonStore } from "./storage.mjs";
import { createTelegramSource } from "./telegram.mjs";

ensureRuntimeDirs();
const playbooks = loadPlaybooks();
const store = new JsonStore(config.dataDir);
const gateClient = new GateSpotClient({ ...config.gate, dryRun: config.dryRun });
const feishuNotifier = new FeishuNotifier({
  webhookUrl: config.feishu.webhookUrl,
  publicBaseUrl: config.publicBaseUrl,
});
const telegramSource = createTelegramSource(config.telegram);
const telegramRuntime = {
  sourceMode: config.telegram.sourceMode,
  ready: false,
  identity: "",
  lastError: "",
};

const configuredChatLabels = {
  "-1003758464445": "Get8.Pro",
  "-1003720685651": "Get8.Pro_News",
  "-1003093807993": "舒琴",
  "-1003358734784": "零下二度",
  "-1002953601978": "易盈社区-所长",
  "-1003435926001": "三马哥",
  "-1003162264989": "洪七公",
  "-1003300637347": "btc乔乔",
  "-1003044946193": "大漂亮策略早知道",
  "-1003547241758": "熬鹰资本",
};

const defaultRuntimeSettings = {
  telegram: {
    allowedChatIds: config.telegram.allowedChatIds,
    analystChatIds: config.telegram.analystChatIds,
    newsChatIds: config.telegram.newsChatIds,
  },
  execution: {
    newsMode: "auto",
  },
};

function getRuntimeSettings() {
  return store.getRuntimeSettings(defaultRuntimeSettings);
}

function getEffectiveTelegramConfig() {
  const runtimeSettings = getRuntimeSettings();
  return {
    ...config.telegram,
    allowedChatIds: runtimeSettings.telegram.allowedChatIds,
    analystChatIds: runtimeSettings.telegram.analystChatIds,
    newsChatIds: runtimeSettings.telegram.newsChatIds,
  };
}

function getTelegramMessage(update) {
  return update?.channel_post || update?.message || update?.edited_channel_post || null;
}

function getTelegramRuntimeSummary() {
  if (telegramRuntime.ready) {
    return telegramRuntime.identity || "已连接";
  }
  if (telegramRuntime.lastError) {
    return telegramRuntime.lastError;
  }
  return config.telegram.sourceMode === "user"
    ? "尚未连接 Telegram 个人号"
    : "尚未连接 Telegram Bot";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function json(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function html(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  response.end(payload);
}

function redirect(response, location) {
  response.writeHead(302, { Location: location });
  response.end();
}

function notFound(response) {
  json(response, 404, { error: "Not found" });
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      if (!body) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

function parseFormBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const params = new URLSearchParams(body);
      resolve(
        Object.fromEntries(
          [...params.entries()].map(([key, value]) => [key, String(value || "").trim()]),
        ),
      );
    });
    request.on("error", reject);
  });
}

function signApprovalToken(signalId) {
  return crypto
    .createHmac("sha256", config.approvalSigningSecret)
    .update(signalId)
    .digest("hex");
}

function verifyApprovalToken(signalId, token) {
  return token && token === signApprovalToken(signalId);
}

function getBaseUrl() {
  return config.publicBaseUrl || `http://127.0.0.1:${config.port}`;
}

function parseCookies(request) {
  const cookieHeader = request.headers.cookie || "";
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf("=");
        if (separatorIndex <= 0) {
          return [part, ""];
        }
        return [
          decodeURIComponent(part.slice(0, separatorIndex)),
          decodeURIComponent(part.slice(separatorIndex + 1)),
        ];
      }),
  );
}

function getAdminSessionValue() {
  if (!config.adminAccessToken) {
    return "";
  }
  return crypto
    .createHmac("sha256", config.approvalSigningSecret)
    .update(`admin:${config.adminAccessToken}`)
    .digest("hex");
}

function isAdminAuthenticated(request) {
  if (!config.adminAccessToken) {
    return true;
  }
  const cookies = parseCookies(request);
  return cookies.gate_admin_session === getAdminSessionValue();
}

function appendCookie(response, cookieValue) {
  const previous = response.getHeader("Set-Cookie");
  if (!previous) {
    response.setHeader("Set-Cookie", cookieValue);
    return;
  }
  if (Array.isArray(previous)) {
    response.setHeader("Set-Cookie", [...previous, cookieValue]);
    return;
  }
  response.setHeader("Set-Cookie", [previous, cookieValue]);
}

function setAdminSession(response) {
  appendCookie(
    response,
    `gate_admin_session=${getAdminSessionValue()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
  );
}

function clearAdminSession(response) {
  appendCookie(
    response,
    "gate_admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
  );
}

function renderLoginPage(nextPath = "/admin", errorMessage = "") {
  const safeNext = String(nextPath || "/admin");
  const errorBlock = errorMessage
    ? `<div class="error">${escapeHtml(errorMessage)}</div>`
    : "";

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>云端管理登录</title>
    <style>
      body { margin: 0; font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background: linear-gradient(180deg, #f7fbff 0%, #edf3fb 100%); color: #182233; }
      .wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
      .card { width: min(460px, 100%); background: #fff; border: 1px solid #dbe3ef; border-radius: 20px; padding: 28px; box-shadow: 0 16px 40px rgba(18, 36, 73, 0.1); }
      h1 { margin: 0 0 10px; font-size: 28px; }
      p { margin: 0 0 18px; color: #61708a; line-height: 1.65; }
      label { display: block; font-weight: 600; margin-bottom: 8px; }
      input { width: 100%; border: 1px solid #dbe3ef; border-radius: 12px; padding: 13px 14px; font: inherit; box-sizing: border-box; }
      button { width: 100%; margin-top: 16px; border: 0; border-radius: 12px; padding: 13px 16px; background: #0f6fff; color: #fff; font: inherit; cursor: pointer; }
      .error { margin-bottom: 14px; padding: 12px 14px; border-radius: 12px; background: #fff4df; color: #9a5b00; }
      .hint { margin-top: 14px; font-size: 13px; color: #61708a; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <form class="card" method="post" action="/login">
        <h1>云端管理登录</h1>
        <p>这是你的交易信号后台。登录后可以管理 Telegram 监听群、切换新闻自动或手动交易模式，并查看待决策信号。</p>
        ${errorBlock}
        <input type="hidden" name="next" value="${escapeHtml(safeNext)}" />
        <label for="password">管理口令</label>
        <input id="password" name="password" type="password" placeholder="输入 ADMIN_ACCESS_TOKEN" autocomplete="current-password" required />
        <button type="submit">进入后台</button>
        <div class="hint">如果你还没设置口令，可以先在云端环境变量里填写 <code>ADMIN_ACCESS_TOKEN</code>。</div>
      </form>
    </div>
  </body>
</html>`;
}

function requireAdmin(request, response, url) {
  if (isAdminAuthenticated(request)) {
    return true;
  }

  const wantsHtml =
    request.method === "GET" &&
    String(request.headers.accept || "").toLowerCase().includes("text/html");

  if (wantsHtml) {
    const next = url?.pathname ? `${url.pathname}${url.search}` : "/admin";
    html(response, 401, renderLoginPage(next));
    return false;
  }

  json(response, 401, { error: "Admin authentication required" });
  return false;
}

function renderActionResultPage(title, summary, result) {
  const resultBlock = result
    ? `<pre>${escapeHtml(JSON.stringify(result, null, 2))}</pre>`
    : "";

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; padding: 24px; max-width: 760px; margin: 0 auto; background: #f7f9fc; color: #182233; }
      .card { border: 1px solid #dbe3ef; background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 14px 32px rgba(18, 36, 73, 0.08); }
      h1 { margin-top: 0; }
      p { line-height: 1.6; }
      pre { white-space: pre-wrap; word-break: break-word; background: #f7f9fc; padding: 12px; border-radius: 10px; border: 1px solid #e3e9f3; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(summary)}</p>
      ${resultBlock}
    </div>
  </body>
</html>`;
}

function renderPendingQueuePage(pendingSignals) {
  const cards = pendingSignals
    .map((signal) => {
      const token = signApprovalToken(signal.id);
      const tradeSummary = signal.tradeIdea ? signal.tradeIdea.summary : "无交易建议";
      return `<section class="card">
        <div class="meta">
          <span class="pill">${escapeHtml(signal.sourceType === "analyst" ? "分析师策略" : "新闻消息")}</span>
          <span>${escapeHtml(signal.sourceName)}</span>
          <span>${escapeHtml(signal.createdAt)}</span>
        </div>
        <h2>${escapeHtml(tradeSummary)}</h2>
        <p class="reason">${escapeHtml(signal.executionReason || "等待处理")}</p>
        <p><strong>命中策略：</strong>${escapeHtml(signal.matchedPlaybookIds.join(", ") || "无")}</p>
        <pre>${escapeHtml(signal.text)}</pre>
        <div class="actions">
          <form method="post" action="/signals/${signal.id}/approve?token=${encodeURIComponent(token)}">
            <button class="approve" type="submit">确认跟单</button>
          </form>
          <form method="post" action="/signals/${signal.id}/reject?token=${encodeURIComponent(token)}">
            <button class="reject" type="submit">忽略这单</button>
          </form>
        </div>
      </section>`;
    })
    .join("");

  const content = cards || '<div class="empty">当前没有待你确认的信号，新的策略来了会出现在这里。</div>';

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>待决策面板</title>
    <style>
      body { font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; padding: 24px; max-width: 980px; margin: 0 auto; background: #f7f9fc; color: #182233; }
      .hero { margin-bottom: 20px; }
      .hero p { color: #5f6f89; line-height: 1.6; }
      .card, .empty { border: 1px solid #dbe3ef; background: #fff; border-radius: 16px; padding: 20px; box-shadow: 0 14px 32px rgba(18, 36, 73, 0.08); margin-bottom: 16px; }
      .meta { display: flex; flex-wrap: wrap; gap: 10px; color: #5f6f89; font-size: 13px; margin-bottom: 8px; }
      .pill { background: #eaf2ff; color: #0f6fff; border-radius: 999px; padding: 4px 10px; font-weight: 600; }
      h1, h2 { margin: 0; }
      h2 { font-size: 20px; margin-bottom: 8px; }
      .reason { color: #0f6fff; margin: 8px 0 14px; }
      .actions { display: flex; gap: 12px; margin-top: 16px; }
      button { padding: 12px 18px; border-radius: 12px; border: 0; cursor: pointer; font: inherit; }
      .approve { background: #0f6fff; color: #fff; }
      .reject { background: #eef2f7; color: #253047; }
      pre { white-space: pre-wrap; word-break: break-word; background: #f7f9fc; padding: 12px; border-radius: 10px; border: 1px solid #e3e9f3; }
    </style>
  </head>
  <body>
    <div class="hero">
      <h1>待决策面板</h1>
      <p>这里会汇总所有等待你处理的分析师策略和新闻单。你从飞书卡片点按钮进来后，直接在这里确认跟单或忽略即可。</p>
    </div>
    ${content}
  </body>
</html>`;
}

async function notifySignal(signal) {
  const approvalToken = signApprovalToken(signal.id);
  await feishuNotifier.sendSignalCard(signal, approvalToken);
}

async function executeSignal(signal, trigger) {
  if (!signal.tradeIdea) {
    return {
      status: "skipped",
      message: "这条信号没有生成可执行交易建议",
    };
  }

  try {
    const result = await gateClient.placeSpotMarketOrder(signal.tradeIdea);
    const executionResult = {
      status: gateClient.dryRun ? "dry_run" : "submitted",
      trigger,
      message: gateClient.dryRun
        ? "当前是模拟模式，没有真实下单"
        : "真实订单已提交到 Gate",
      result,
      at: new Date().toISOString(),
    };

    signal.executionStatus = gateClient.dryRun ? "dry_run_executed" : "executed";
    signal.executionResult = executionResult;
    store.upsertSignal(signal);
    store.appendTrade({
      createdAt: executionResult.at,
      signalId: signal.id,
      notionalUsd:
        Number.parseFloat(signal.tradeIdea.amountQuote || "") ||
        Number.parseFloat(signal.tradeIdea.amountBase || "") ||
        0,
    });
    await feishuNotifier.sendExecutionResult(signal, executionResult);
    return executionResult;
  } catch (error) {
    const executionResult = {
      status: "failed",
      trigger,
      message: error.message,
      at: new Date().toISOString(),
    };
    signal.executionStatus = "execution_failed";
    signal.executionResult = executionResult;
    store.upsertSignal(signal);
    await feishuNotifier.sendExecutionResult(signal, executionResult);
    return executionResult;
  }
}

async function processBaseSignal(baseSignal) {
  const evaluation = evaluateSignal(baseSignal, playbooks, config, store);
  if (evaluation.skipped) {
    return { skipped: true, reason: evaluation.reason };
  }

  const { signal } = evaluation;
  store.upsertSignal(signal);
  await notifySignal(signal);

  if (signal.executionStatus === "ready_for_execution") {
    const executionResult = await executeSignal(signal, "auto");
    return { skipped: false, signal, executionResult };
  }

  return { skipped: false, signal };
}

async function processTelegramUpdate(update) {
  const message = getTelegramMessage(update);
  return processTelegramMessage(message);
}

async function processTelegramMessage(message) {
  if (!message) {
    return null;
  }

  store.recordTelegramChat(message);

  const baseSignal = createSignalFromTelegramMessage(message, {
    telegram: getEffectiveTelegramConfig(),
  });
  if (!baseSignal) {
    return null;
  }
  return processBaseSignal(baseSignal);
}

async function startTelegramPolling() {
  if (
    config.telegram.sourceMode !== "bot" ||
    config.telegram.mode !== "polling" ||
    !telegramSource.isConfigured()
  ) {
    return;
  }

  telegramRuntime.ready = true;
  telegramRuntime.identity = "Telegram Bot polling";
  telegramRuntime.lastError = "";

  while (true) {
    try {
      const updates = await telegramSource.getUpdates(store.getTelegramOffset() + 1);
      telegramRuntime.ready = true;
      telegramRuntime.identity = "Telegram Bot polling";
      telegramRuntime.lastError = "";
      for (const update of updates) {
        store.setTelegramOffset(update.update_id);
        await processTelegramUpdate(update);
      }
    } catch (error) {
      telegramRuntime.ready = false;
      telegramRuntime.lastError = error.message;
      console.error("[telegram] polling error:", error.message);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

async function ensureTelegramWebhook() {
  if (
    config.telegram.sourceMode !== "bot" ||
    config.telegram.mode !== "webhook" ||
    !telegramSource.isConfigured()
  ) {
    return;
  }

  if (!config.publicBaseUrl) {
    throw new Error("PUBLIC_BASE_URL is required when TELEGRAM_MODE=webhook");
  }

  const webhookUrl = `${String(config.publicBaseUrl).replace(/\/$/, "")}/webhooks/telegram`;
  const info = await telegramSource.getWebhookInfo();
  if (info?.url === webhookUrl) {
    telegramRuntime.ready = true;
    telegramRuntime.identity = "Telegram Bot webhook";
    telegramRuntime.lastError = "";
    return info;
  }

  await telegramSource.setWebhook(config.publicBaseUrl);
  const nextInfo = await telegramSource.getWebhookInfo();
  telegramRuntime.ready = true;
  telegramRuntime.identity = "Telegram Bot webhook";
  telegramRuntime.lastError = "";
  return nextInfo;
}

async function startTelegramUserStream() {
  if (config.telegram.sourceMode !== "user") {
    return;
  }

  if (!telegramSource.isConfigured()) {
    const status = telegramSource.getStatus?.() || {};
    telegramRuntime.ready = false;
    telegramRuntime.lastError = !status.hasCredentials
      ? "Telegram 个人号模式缺少 API ID / API Hash"
      : "Telegram 个人号模式还没有可用会话，请先执行一次登录";
    console.warn(`[telegram-user] ${telegramRuntime.lastError}`);
    return;
  }

  const account = await telegramSource.start(async ({ message }) => {
    await processTelegramMessage(message);
  });
  telegramRuntime.ready = true;
  telegramRuntime.identity = `Telegram 个人号：${account.displayName}`;
  telegramRuntime.lastError = "";
}

async function handleSignalAction(signalId, action) {
  const signal = store.getSignal(signalId);
  if (!signal) {
    return {
      statusCode: 404,
      title: "信号不存在",
      summary: "这条信号已经找不到了，可能已被清理。",
      result: null,
    };
  }

  if (action === "reject") {
    if (signal.executionStatus === "rejected") {
      return {
        statusCode: 200,
        title: "已忽略",
        summary: "这条信号之前已经被忽略，不会执行。",
        result: signal.executionResult,
      };
    }

    if (["executed", "dry_run_executed"].includes(signal.executionStatus)) {
      return {
        statusCode: 200,
        title: "已处理完成",
        summary: "这条信号已经执行过了，不能再忽略。",
        result: signal.executionResult,
      };
    }

    const executionResult = {
      status: "rejected",
      trigger: "manual_reject",
      message: "已由你在飞书确认页手动忽略",
      at: new Date().toISOString(),
    };

    signal.reviewedAt = executionResult.at;
    signal.reviewDecision = action;
    signal.executionStatus = "rejected";
    signal.executionResult = executionResult;
    store.upsertSignal(signal);
    await feishuNotifier.sendExecutionResult(signal, executionResult);

    return {
      statusCode: 200,
      title: "已忽略",
      summary: "这条信号不会执行。",
      result: executionResult,
    };
  }

  if (["executed", "dry_run_executed", "execution_failed"].includes(signal.executionStatus)) {
    return {
      statusCode: 200,
      title: "处理完成",
      summary: "这条信号之前已经处理过了。",
      result: signal.executionResult,
    };
  }

  if (signal.executionStatus === "rejected") {
    return {
      statusCode: 200,
      title: "已忽略",
      summary: "这条信号之前已经被忽略，不会再次执行。",
      result: signal.executionResult,
    };
  }

  signal.reviewedAt = new Date().toISOString();
  signal.reviewDecision = action;
  const executionResult = await executeSignal(signal, "manual_approval");

  return {
    statusCode: 200,
    title: executionResult.status === "failed" ? "执行失败" : "处理完成",
    summary:
      executionResult.status === "failed"
        ? "这条信号执行失败了，请查看下面的详细信息。"
        : "这条信号已经按你的确认处理完成。",
    result: executionResult,
  };
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (request.method === "GET" && url.pathname === "/login") {
      if (isAdminAuthenticated(request)) {
        redirect(response, url.searchParams.get("next") || "/admin");
        return;
      }
      html(response, 401, renderLoginPage(url.searchParams.get("next") || "/admin"));
      return;
    }

    if (request.method === "POST" && url.pathname === "/login") {
      const form = await parseFormBody(request);
      const nextPath = form.next || "/admin";
      if (!config.adminAccessToken) {
        redirect(response, nextPath);
        return;
      }
      if (form.password !== config.adminAccessToken) {
        html(response, 401, renderLoginPage(nextPath, "口令不正确，请重新输入。"));
        return;
      }
      setAdminSession(response);
      response.writeHead(302, { Location: nextPath });
      response.end();
      return;
    }

    if (request.method === "GET" && url.pathname === "/logout") {
      clearAdminSession(response);
      response.writeHead(302, { Location: "/login" });
      response.end();
      return;
    }

    if (request.method === "GET" && url.pathname === "/") {
      redirect(response, "/admin");
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, {
        ok: true,
        host: config.host,
        publicBaseUrl: config.publicBaseUrl,
        dryRun: config.dryRun,
        autoExecutionEnabled: config.autoExecutionEnabled,
        telegramMode:
          config.telegram.sourceMode === "user" ? "user-stream" : config.telegram.mode,
        telegramSourceMode: config.telegram.sourceMode,
        telegramReady: telegramRuntime.ready,
        telegramRuntime: getTelegramRuntimeSummary(),
        signalCount: store.listSignals().length,
        knownTelegramChats: store.listKnownTelegramChats().length,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/admin") {
      if (!requireAdmin(request, response, url)) {
        return;
      }
      html(
        response,
        200,
        renderAdminPage({
          runtimeSettings: getRuntimeSettings(),
          knownChats: store.listKnownTelegramChats(),
          configuredChatLabels,
          signalCount: store.listSignals().length,
          dryRun: config.dryRun,
          autoExecutionEnabled: config.autoExecutionEnabled,
          telegramSourceMode: config.telegram.sourceMode,
          telegramRuntimeSummary: getTelegramRuntimeSummary(),
          port: config.port,
          publicBaseUrl: config.publicBaseUrl,
        }),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/pending") {
      if (!requireAdmin(request, response, url)) {
        return;
      }
      const pendingSignals = store
        .listSignals()
        .filter((signal) => signal.executionStatus === "pending_approval");
      html(response, 200, renderPendingQueuePage(pendingSignals));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/runtime-settings") {
      if (!requireAdmin(request, response, url)) {
        return;
      }
      json(response, 200, getRuntimeSettings());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/runtime-settings") {
      if (!requireAdmin(request, response, url)) {
        return;
      }
      const payload = await parseBody(request);
      const saved = store.saveRuntimeSettings(payload || {}, defaultRuntimeSettings);
      json(response, 200, saved);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/telegram/chats") {
      if (!requireAdmin(request, response, url)) {
        return;
      }
      json(response, 200, store.listKnownTelegramChats());
      return;
    }

    if (request.method === "GET" && url.pathname === "/signals") {
      if (!requireAdmin(request, response, url)) {
        return;
      }
      json(response, 200, store.listSignals().slice(0, 100));
      return;
    }

    if (request.method === "POST" && url.pathname === "/signals/ingest") {
      const payload = await parseBody(request);
      const baseSignal = createSignalFromPayload(payload || {});
      if (!baseSignal) {
        json(response, 400, { error: "text is required" });
        return;
      }
      const result = await processBaseSignal(baseSignal);
      json(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/webhooks/telegram") {
      if (
        config.telegram.webhookSecret &&
        request.headers["x-telegram-bot-api-secret-token"] !== config.telegram.webhookSecret
      ) {
        json(response, 401, { error: "Invalid Telegram webhook secret" });
        return;
      }
      const payload = await parseBody(request);
      const result = await processTelegramUpdate(payload || {});
      json(response, 200, result || { ignored: true });
      return;
    }

    const signalMatch = url.pathname.match(/^\/signals\/([0-9a-f-]+)$/i);
    if (request.method === "GET" && signalMatch) {
      const signal = store.getSignal(signalMatch[1]);
      if (!signal) {
        notFound(response);
        return;
      }
      const token = url.searchParams.get("token") || "";
      if (!verifyApprovalToken(signal.id, token)) {
        json(response, 401, { error: "Invalid approval token" });
        return;
      }
      html(response, 200, renderSignalReviewPage(signal, token));
      return;
    }

    const actionMatch = url.pathname.match(/^\/signals\/([0-9a-f-]+)\/(approve|reject)$/i);
    if (["GET", "POST"].includes(request.method || "") && actionMatch) {
      const [, signalId, action] = actionMatch;
      const token = url.searchParams.get("token") || "";
      if (!verifyApprovalToken(signalId, token)) {
        json(response, 401, { error: "Invalid approval token" });
        return;
      }

      const actionResult = await handleSignalAction(signalId, action);
      html(
        response,
        actionResult.statusCode,
        renderActionResultPage(actionResult.title, actionResult.summary, actionResult.result),
      );
      return;
    }

    notFound(response);
  } catch (error) {
    json(response, 500, { error: error.message });
  }
});

server.listen(config.port, config.host, async () => {
  console.log(`Signal automation server listening on ${getBaseUrl()}`);
  console.log(`Dry run: ${config.dryRun ? "on" : "off"}`);
  console.log(`Auto execution: ${config.autoExecutionEnabled ? "enabled" : "disabled"}`);
  console.log(`Admin page: ${getBaseUrl()}/admin`);
  console.log(
    `Telegram source: ${config.telegram.sourceMode === "user" ? "user account" : "bot"}`,
  );
  if (config.adminAccessToken) {
    console.log("Admin auth: enabled");
  }
  if (config.telegram.sourceMode === "bot" && config.telegram.mode === "webhook") {
    try {
      const info = await ensureTelegramWebhook();
      console.log(`Telegram webhook ready: ${info?.url || "ok"}`);
    } catch (error) {
      telegramRuntime.ready = false;
      telegramRuntime.lastError = error.message;
      console.error(`Telegram webhook setup failed: ${error.message}`);
    }
  }
});

startTelegramPolling().catch((error) => {
  telegramRuntime.ready = false;
  telegramRuntime.lastError = error.message;
  console.error("Telegram polling crashed:", error);
});

startTelegramUserStream().catch((error) => {
  telegramRuntime.ready = false;
  telegramRuntime.lastError = error.message;
  console.error("Telegram user stream crashed:", error);
});
