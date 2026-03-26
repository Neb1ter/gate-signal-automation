import crypto from "node:crypto";
import http from "node:http";

import { AnalystAiReviewer } from "./analyst-ai.mjs";
import { buildAnalystMetrics } from "./analyst-metrics.mjs";
import { renderAdminPage } from "./admin-page.mjs";
import { config, ensureRuntimeDirs, loadPlaybooks } from "./config.mjs";
import { FeishuNotifier } from "./feishu.mjs";
import { GateSpotClient } from "./gate-api.mjs";
import { renderSignalReviewPage } from "./signal-review-page.mjs";
import {
  applyAiAnalysis,
  buildAnalystPrivacyAlias,
  createSignalFromPayload,
  createSignalFromTelegramMessage,
  evaluateSignal,
  reconcileAnalystSignalWithAi,
} from "./signal-engine.mjs";
import { JsonStore } from "./storage.mjs";
import {
  buildAnalystRouteDisplayName,
  coerceCleanChineseText,
  resolveAnalystRouteDisplayName,
} from "./text-clean.mjs";
import { createTelegramSource } from "./telegram.mjs";

ensureRuntimeDirs();
const playbooks = loadPlaybooks();
const store = new JsonStore(config.dataDir);
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

const normalizedChatLabels = {
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
  feishu: {
    analystRoutes: [],
  },
  analysts: {
    configs: [],
  },
  execution: {
    newsMode: "auto",
  },
  ai: {
    enabled: config.ai.enabled,
    provider: config.ai.provider,
    apiKey: config.ai.apiKey,
    baseUrl: config.ai.baseUrl,
    primaryModel: config.ai.primaryModel,
    reviewModel: config.ai.reviewModel,
    reviewEnabled: config.ai.reviewEnabled,
    timeoutMs: config.ai.timeoutMs,
  },
  gate: {
    mode: config.dryRun ? "dry_run" : "futures_testnet",
    apiKey: config.gate.apiKey,
    apiSecret: config.gate.apiSecret,
    baseUrl: config.gate.baseUrl,
  },
};

function getRuntimeSettings() {
  return store.getRuntimeSettings(defaultRuntimeSettings);
}

function createAiReviewer(runtimeSettings = getRuntimeSettings()) {
  return new AnalystAiReviewer({
    ...config.ai,
    ...runtimeSettings.ai,
  });
}

function createGateClient(runtimeSettings = getRuntimeSettings()) {
  const gateSettings = runtimeSettings.gate || {};
  const baseUrl =
    gateSettings.baseUrl ||
    (["testnet", "spot_testnet", "futures_testnet"].includes(gateSettings.mode)
      ? "https://api-testnet.gateapi.io"
      : config.gate.baseUrl);

  return new GateSpotClient({
    apiKey: gateSettings.apiKey || config.gate.apiKey,
    apiSecret: gateSettings.apiSecret || config.gate.apiSecret,
    baseUrl,
    dryRun: !["testnet", "spot_testnet", "futures_testnet"].includes(gateSettings.mode),
  });
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

function getConfiguredChatLabel(chatId) {
  return coerceCleanChineseText(normalizedChatLabels[String(chatId || "")], "");
}

function getAnalystRoute(chatId) {
  const runtimeSettings = getRuntimeSettings();
  const routes = runtimeSettings.feishu?.analystRoutes || [];
  return routes.find((route) => route.chatId === String(chatId || "")) || null;
}

function getAnalystConfig(chatId) {
  const runtimeSettings = getRuntimeSettings();
  const configs = runtimeSettings.analysts?.configs || [];
  return configs.find((item) => item.chatId === String(chatId || "")) || null;
}

function getSignalDeliveryOptions(signal) {
  if (signal.sourceType !== "analyst") {
    return {
      webhookUrl: "",
      displayName: signal.sourceName,
      routeLabel: signal.sourceName,
    };
  }

  const route = getAnalystRoute(signal.chatId);
  const routeLabel =
    getConfiguredChatLabel(signal.chatId) || signal.sourceName || signal.chatId || "分析师群";

  return {
    webhookUrl: route?.webhookUrl || "",
    displayName: route?.displayName || buildAnalystPrivacyAlias(signal.chatId),
    routeLabel,
  };
}

function getTelegramMessage(update) {
  return update?.channel_post || update?.message || update?.edited_channel_post || null;
}

function getSignalDeliveryOptionsSafe(signal) {
  if (signal.sourceType !== "analyst") {
    const cleanName = coerceCleanChineseText(signal.sourceName, signal.sourceName || "信号来源");
    return {
      webhookUrl: "",
      displayName: cleanName,
      routeLabel: cleanName,
    };
  }

  const route = getAnalystRoute(signal.chatId);
  const routeLabel =
    getConfiguredChatLabel(signal.chatId) ||
    coerceCleanChineseText(signal.sourceName, "") ||
    signal.chatId ||
    "分析师群";

  return {
    webhookUrl: route?.webhookUrl || "",
    displayName:
      resolveAnalystRouteDisplayName(route?.displayName, {
        chatId: signal.chatId,
        label: routeLabel,
        title: signal.sourceName,
      }) ||
      buildAnalystRouteDisplayName(signal.chatId, routeLabel) ||
      buildAnalystPrivacyAlias(signal.chatId),
    routeLabel,
  };
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

function getTelegramRuntimeSummarySafe() {
  if (telegramRuntime.ready) {
    return coerceCleanChineseText(telegramRuntime.identity, "已连接");
  }
  if (telegramRuntime.lastError) {
    return coerceCleanChineseText(telegramRuntime.lastError, "Telegram 连接异常");
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

function parseTakeProfitsInput(value) {
  return String(value || "")
    .split(/[,\n，/|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeProtectionPriceInput(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const numeric = Number.parseFloat(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "";
  }
  return String(numeric);
}

function buildManualProtectionPlan(existingPlan = {}, { stopLoss, takeProfits }) {
  const normalizedTakeProfits = (takeProfits || [])
    .map((value) => normalizeProtectionPriceInput(value))
    .filter(Boolean);
  const normalizedStopLoss = normalizeProtectionPriceInput(stopLoss);

  return {
    ...existingPlan,
    stopLoss: normalizedStopLoss || null,
    takeProfits: normalizedTakeProfits,
    trailingTakeProfit:
      normalizedTakeProfits.length >= 2
        ? {
            activationPrice: normalizedTakeProfits[0],
            callbackRate: 0.003,
          }
        : null,
    finalTakeProfit:
      normalizedTakeProfits.length >= 2
        ? normalizedTakeProfits[1]
        : normalizedTakeProfits.length === 1
          ? normalizedTakeProfits[0]
          : null,
  };
}

function applyManualTradeOverrides(signal, form = {}) {
  if (!signal) {
    return signal;
  }

  const existingTradeIdea = signal.tradeIdea || {};
  const fallbackSymbol = String(
    form.symbol ||
      existingTradeIdea.symbol ||
      existingTradeIdea.contract ||
      signal.analysis?.symbol ||
      "",
  )
    .trim()
    .toUpperCase();
  const fallbackContract = String(form.contract || existingTradeIdea.contract || fallbackSymbol)
    .trim()
    .toUpperCase();

  const nextTradeIdea = {
    ...existingTradeIdea,
    orderType: ["market", "limit"].includes(String(form.orderType || "").toLowerCase())
      ? String(form.orderType).toLowerCase()
      : existingTradeIdea.orderType || "market",
    side: ["buy", "sell"].includes(String(form.side || "").toLowerCase())
      ? String(form.side).toLowerCase()
      : existingTradeIdea.side || "buy",
    leverage: String(form.leverage || existingTradeIdea.leverage || "20").replace(/x$/i, ""),
    size: String(form.size || existingTradeIdea.size || "").trim(),
    price: String(form.price || existingTradeIdea.price || "").trim(),
    marginQuote: String(
      form.marginQuote || existingTradeIdea.marginQuote || existingTradeIdea.amountQuote || "",
    ).trim(),
    contract: fallbackContract,
    symbol: fallbackSymbol,
    settle: String(form.settle || existingTradeIdea.settle || "usdt").trim().toLowerCase(),
  };

  nextTradeIdea.kind = nextTradeIdea.orderType === "limit" ? "futures_limit" : "futures_market";
  nextTradeIdea.timeInForce =
    nextTradeIdea.orderType === "limit"
      ? String(form.timeInForce || existingTradeIdea.timeInForce || "gtc").toLowerCase()
      : "ioc";
  nextTradeIdea.account = "futures";
  nextTradeIdea.clientOrderId =
    existingTradeIdea.clientOrderId || `t-manual-${Date.now().toString().slice(-8)}`;
  nextTradeIdea.summary = `${nextTradeIdea.side === "buy" ? "合约做多" : "合约做空"} ${nextTradeIdea.symbol}，${
    nextTradeIdea.orderType === "limit" ? "限价单" : "市价单"
  }，${nextTradeIdea.leverage}x 杠杆，${
    nextTradeIdea.size ? `数量 ${nextTradeIdea.size} 张` : `保证金 ${nextTradeIdea.marginQuote} USDT`
  }${nextTradeIdea.orderType === "limit" && nextTradeIdea.price ? `，价格 ${nextTradeIdea.price}` : ""}`;

  signal.tradeIdea = nextTradeIdea;
  return signal;
}

function applyManualTradeOverridesV2(signal, form = {}) {
  if (!signal) {
    return signal;
  }

  const existingTradeIdea = signal.tradeIdea || {};
  const fallbackSymbol = String(
    form.symbol ||
      existingTradeIdea.symbol ||
      existingTradeIdea.contract ||
      signal.analysis?.symbol ||
      "",
  )
    .trim()
    .toUpperCase();
  const fallbackContract = String(form.contract || existingTradeIdea.contract || fallbackSymbol)
    .trim()
    .toUpperCase();
  const marginQuote = String(
    form.marginQuote || existingTradeIdea.marginQuote || existingTradeIdea.amountQuote || "",
  ).trim();
  const size = String(form.size || existingTradeIdea.size || "").trim();
  const stopLoss = String(form.stopLoss || "").trim();
  const takeProfits = parseTakeProfitsInput(form.takeProfits);

  const nextTradeIdea = {
    ...existingTradeIdea,
    orderType: ["market", "limit"].includes(String(form.orderType || "").toLowerCase())
      ? String(form.orderType).toLowerCase()
      : existingTradeIdea.orderType || "market",
    side: ["buy", "sell"].includes(String(form.side || "").toLowerCase())
      ? String(form.side).toLowerCase()
      : existingTradeIdea.side || "buy",
    leverage: String(form.leverage || existingTradeIdea.leverage || "20").replace(/x$/i, ""),
    size,
    price: String(form.price || existingTradeIdea.price || "").trim(),
    marginQuote,
    amountQuote: marginQuote,
    contract: fallbackContract,
    symbol: fallbackSymbol,
    settle: String(form.settle || existingTradeIdea.settle || "usdt").trim().toLowerCase(),
  };

  nextTradeIdea.kind = nextTradeIdea.orderType === "limit" ? "futures_limit" : "futures_market";
  nextTradeIdea.timeInForce =
    nextTradeIdea.orderType === "limit"
      ? String(form.timeInForce || existingTradeIdea.timeInForce || "gtc").toLowerCase()
      : "ioc";
  nextTradeIdea.account = "futures";
  nextTradeIdea.clientOrderId = `t-manual-${Date.now().toString().slice(-8)}`;
  nextTradeIdea.protectionPlan = buildManualProtectionPlan(existingTradeIdea.protectionPlan || {}, {
    stopLoss,
    takeProfits,
  });
  nextTradeIdea.summary = `${nextTradeIdea.side === "buy" ? "合约做多" : "合约做空"} ${nextTradeIdea.symbol}，${
    nextTradeIdea.orderType === "limit" ? "限价单" : "市价单"
  }，${nextTradeIdea.leverage}x 杠杆，${
    nextTradeIdea.marginQuote
      ? `保证金 ${nextTradeIdea.marginQuote} USDT 优先`
      : nextTradeIdea.size
        ? `数量 ${nextTradeIdea.size} 张`
        : "待补充仓位"
  }${nextTradeIdea.orderType === "limit" && nextTradeIdea.price ? `，价格 ${nextTradeIdea.price}` : ""}${
    nextTradeIdea.protectionPlan.stopLoss ? `，止损 ${nextTradeIdea.protectionPlan.stopLoss}` : ""
  }${
    nextTradeIdea.protectionPlan.takeProfits?.length
      ? `，止盈 ${nextTradeIdea.protectionPlan.takeProfits.join("/")}`
      : ""
  }`;

  signal.tradeIdea = nextTradeIdea;
  return signal;
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
      @media (max-width: 720px) {
        body { padding: 12px; }
        .card { padding: 16px; border-radius: 14px; }
      }
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
          <span>${escapeHtml(signal.deliveryDisplayName || signal.displaySourceName || signal.sourceName)}</span>
          <span>${escapeHtml(signal.createdAt)}</span>
        </div>
        <h2>${escapeHtml(tradeSummary)}</h2>
        <p class="reason">${escapeHtml(signal.executionReason || "等待处理")}</p>
        <p><strong>命中策略：</strong>${escapeHtml(signal.matchedPlaybookIds.join(", ") || "无")}</p>
        <pre>${escapeHtml(signal.displayText || signal.text)}</pre>
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
  const deliveryOptions = getSignalDeliveryOptionsSafe(signal);
  await feishuNotifier.sendSignalCard(signal, approvalToken, deliveryOptions);
}

async function safeNotifySignal(signal) {
  try {
    await notifySignal(signal);
  } catch (error) {
    console.warn(`[notify] signal ${signal.id} failed: ${error.message}`);
  }
}

async function safeNotifyExecutionResult(signal, executionResult, deliveryOptions) {
  try {
    await feishuNotifier.sendExecutionResult(signal, executionResult, deliveryOptions);
  } catch (error) {
    console.warn(`[notify] execution ${signal.id} failed: ${error.message}`);
  }
}

const processingJobs = new Map();
const analystThreadTimers = new Map();
const ANALYST_THREAD_COLLECT_MS = config.analystThreadCollectMs || 12 * 1000;

function enqueueSignalProcessing(signalId) {
  if (processingJobs.has(signalId)) {
    return processingJobs.get(signalId);
  }

  const job = Promise.resolve()
    .then(() => finalizeSignalProcessing(signalId))
    .catch((error) => {
      const signal = store.getSignal(signalId);
      if (signal) {
        signal.processingState = "failed";
        signal.processingError = error.message;
        signal.processingUpdatedAt = new Date().toISOString();
        store.upsertSignal(signal);
      }
      console.error(`[signal-processing] ${signalId} failed: ${error.message}`);
    })
    .finally(() => {
      processingJobs.delete(signalId);
    });
  processingJobs.set(signalId, job);
  return job;
}

function scheduleAnalystThreadProcessing(signal) {
  const threadId = String(signal?.threadId || "");
  if (!threadId) {
    return enqueueSignalProcessing(signal.id);
  }

  const existingTimer = analystThreadTimers.get(threadId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    analystThreadTimers.delete(threadId);
    const latest = store.findLatestSignalByThread(threadId);
    if (latest?.id) {
      void enqueueSignalProcessing(latest.id);
    }
  }, ANALYST_THREAD_COLLECT_MS);

  analystThreadTimers.set(threadId, timer);
  return timer;
}

async function finalizeSignalProcessing(signalId) {
  const signal = store.getSignal(signalId);
  if (!signal) {
    return null;
  }

  if (signal.sourceType === "analyst" && signal.threadId) {
    const latestInThread = store.findLatestSignalByThread(signal.threadId);
    if (latestInThread && latestInThread.id !== signal.id) {
      signal.processingState = "superseded";
      signal.processingError = "";
      signal.processingUpdatedAt = new Date().toISOString();
      signal.executionStatus = signal.executionStatus || "notify_only";
      signal.executionReason = "同一策略线程里已有更新消息，当前这条已由更新版本接管";
      store.upsertSignal(signal);
      return signal;
    }
  }

  signal.processingState = "processing";
  signal.processingError = "";
  signal.processingUpdatedAt = new Date().toISOString();
  store.upsertSignal(signal);

  const runtimeSettings = getRuntimeSettings();
  if (signal.sourceType === "analyst") {
    const aiAnalysis = await createAiReviewer(runtimeSettings).review(signal);
    if (aiAnalysis) {
      applyAiAnalysis(signal, aiAnalysis);
      signal.aiCompletedAt = new Date().toISOString();
    }
    reconcileAnalystSignalWithAi(signal, runtimeSettings, config, store);
  }

  const deliveryOptions = getSignalDeliveryOptionsSafe(signal);
  signal.deliveryDisplayName = deliveryOptions.displayName || signal.displaySourceName;
  store.upsertSignal(signal);

  await safeNotifySignal(signal);
  signal.notifiedAt = new Date().toISOString();
  signal.processingUpdatedAt = signal.notifiedAt;
  store.upsertSignal(signal);

  if (signal.executionStatus === "ready_for_execution") {
    signal.processingState = "executing";
    store.upsertSignal(signal);
    const executionResult = await executeSignal(signal, "auto");
    const latestSignal = store.getSignal(signalId) || signal;
    latestSignal.processingState =
      executionResult.status === "failed" ? "completed_with_errors" : "completed";
    latestSignal.processingUpdatedAt = new Date().toISOString();
    store.upsertSignal(latestSignal);
    return latestSignal;
  }

  signal.processingState = "completed";
  signal.processingUpdatedAt = new Date().toISOString();
  store.upsertSignal(signal);
  return signal;
}

async function executeSignal(signal, trigger) {
  const runtimeSettings = getRuntimeSettings();
  const gateClient = createGateClient(runtimeSettings);
  const deliveryOptions = getSignalDeliveryOptionsSafe(signal);
  if (!signal.tradeIdea) {
    return {
      status: "skipped",
      message: "这条信号没有生成可执行交易建议",
    };
  }

  try {
    const result = await gateClient.placeTrade(signal.tradeIdea);
    let protectionOrders = [];
    let protectionErrors = [];
    let protectionError = "";
    if (String(signal.tradeIdea.kind || "").startsWith("futures_")) {
      try {
        const protectionResult = await gateClient.placeFuturesProtectionOrders(signal.tradeIdea);
        if (Array.isArray(protectionResult)) {
          protectionOrders = protectionResult;
        } else {
          protectionOrders = Array.isArray(protectionResult?.orders) ? protectionResult.orders : [];
          protectionErrors = Array.isArray(protectionResult?.errors) ? protectionResult.errors : [];
          protectionError = protectionErrors.join(" | ");
        }
      } catch (error) {
        protectionError = error.message;
        protectionErrors = [error.message];
      }
    }
    const executionResult = {
      status: gateClient.dryRun
        ? "dry_run"
        : protectionErrors.length
          ? "submitted_with_warnings"
          : "submitted",
      trigger,
      message: gateClient.dryRun
        ? "当前是模拟模式，没有真实下单"
        : "真实订单已提交到 Gate",
      result: {
        ...result,
        protectionOrders,
        protectionErrors,
        protectionError,
      },
      at: new Date().toISOString(),
    };

    signal.executionStatus = gateClient.dryRun ? "dry_run_executed" : "executed";
    signal.executionResult = executionResult;
    store.upsertSignal(signal);
    const feeValue =
      Number.parseFloat(result?.fee || "") ||
      Number.parseFloat(result?.gt_fee || "") ||
      Number.parseFloat(result?.point_fee || "") ||
      0;
    const filledBaseQty =
      Number.parseFloat(result?.filled_amount || "") ||
      Number.parseFloat(result?.size || "") ||
      Number.parseFloat(result?.amount || "") ||
      0;
    const filledQuoteQty =
      Number.parseFloat(result?.filled_total || "") ||
      Number.parseFloat(result?.value || "") ||
      Number.parseFloat(signal.tradeIdea.marginQuote || signal.tradeIdea.amountQuote || "") ||
      0;
    store.appendTrade({
      createdAt: executionResult.at,
      signalId: signal.id,
      chatId: signal.chatId,
      sourceType: signal.sourceType,
      sourceName: signal.sourceName,
      deliveryDisplayName: signal.deliveryDisplayName || signal.displaySourceName || signal.sourceName,
      symbol: signal.tradeIdea.symbol,
      side: signal.tradeIdea.side,
      mode: gateClient.dryRun ? "dry_run" : "futures_testnet",
      orderId: String(result?.id || ""),
      orderStatus: String(result?.status || ""),
      finishAs: String(result?.finish_as || ""),
      clientOrderId: String(signal.tradeIdea.clientOrderId || ""),
      avgPrice: Number.parseFloat(result?.avg_deal_price || result?.fill_price || "") || 0,
      filledBaseQty,
      filledQuoteQty,
      fee: feeValue,
      feeCurrency: String(result?.fee_currency || ""),
      notionalUsd:
        Number.parseFloat(signal.tradeIdea.marginQuote || signal.tradeIdea.amountQuote || "") ||
        Number.parseFloat(signal.tradeIdea.amountBase || "") ||
        0,
    });
    await safeNotifyExecutionResult(signal, executionResult, deliveryOptions);
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
    await safeNotifyExecutionResult(signal, executionResult, deliveryOptions);
    return executionResult;
  }
}

async function processBaseSignal(baseSignal) {
  const evaluation = evaluateSignal(baseSignal, playbooks, config, store);
  if (evaluation.skipped) {
    return { skipped: true, reason: evaluation.reason };
  }

  const { signal } = evaluation;
  if (signal.sourceType === "analyst" && signal.threadId) {
    signal.processingState = "collecting";
    signal.executionReason =
      signal.executionReason || `正在等待同一策略线程补充消息（约 ${Math.round(ANALYST_THREAD_COLLECT_MS / 1000)} 秒）`;
  } else {
    signal.processingState = "queued";
  }
  signal.processingError = "";
  signal.processingUpdatedAt = new Date().toISOString();
  store.upsertSignal(signal);
  if (signal.sourceType === "analyst" && signal.threadId) {
    scheduleAnalystThreadProcessing(signal);
  } else {
    void enqueueSignalProcessing(signal.id);
  }
  return { skipped: false, queued: true, signal };
}

async function processTelegramUpdate(update) {
  const message = getTelegramMessage(update);
  return processTelegramMessage(message);
}

function buildAnalystThreadContext(baseSignal, message) {
  const recentContext = store.getRecentAnalystMessages(baseSignal.chatId, {
    limit: 12,
    windowMinutes: 180,
  });
  const currentEntry = {
    messageId: String(message.message_id || message.id || ""),
    publishedAt: baseSignal.publishedAt,
    text: baseSignal.text,
  };
  const threadWindowMs = 5 * 60 * 1000;
  const currentTime = Date.parse(baseSignal.publishedAt);
  const candidateThread = [...recentContext, currentEntry].filter((item) => {
    const timestamp = Date.parse(item?.publishedAt || "");
    return Number.isFinite(timestamp) && currentTime - timestamp <= threadWindowMs;
  });

  if (candidateThread.length > 1) {
    const firstAt = candidateThread[0]?.publishedAt || baseSignal.publishedAt;
    baseSignal.threadId = `${baseSignal.chatId}:${Date.parse(firstAt) || Date.now()}`;
    baseSignal.threadMessageCount = candidateThread.length;
    baseSignal.threadAggregationNote = `已将最近 ${candidateThread.length} 条连续消息合并为同一策略线程`;
    baseSignal.contextMessages = candidateThread.slice(0, -1);
    baseSignal.contextText = [
      ...candidateThread.slice(0, -1).map(
        (item, index) =>
          `上一段 ${index + 1}（${String(item.publishedAt || "").replace("T", " ").replace("Z", " UTC")}）:\n${item.text}`,
      ),
      `最新消息：\n${baseSignal.text}`,
    ].join("\n\n");
  } else {
    baseSignal.threadId = `${baseSignal.chatId}:${currentTime || Date.now()}`;
    baseSignal.threadMessageCount = 1;
    baseSignal.threadAggregationNote = "当前按单条策略消息处理";
  }

  store.saveAnalystThreadNote(baseSignal.chatId, {
    threadId: baseSignal.threadId,
    threadMessageCount: baseSignal.threadMessageCount,
    note: baseSignal.threadAggregationNote,
    updatedAt: new Date().toISOString(),
  });

  store.appendRecentAnalystMessage(baseSignal.chatId, currentEntry);
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

  if (baseSignal.sourceType === "analyst" && baseSignal.chatId) {
    buildAnalystThreadContext(baseSignal, message);
  }

  if (false && baseSignal.sourceType === "analyst" && baseSignal.chatId) {
    const recentContext = store.getRecentAnalystMessages(baseSignal.chatId, {
      limit: 6,
      windowMinutes: 180,
    });

    if (recentContext.length) {
      baseSignal.contextMessages = recentContext;
      baseSignal.contextText = [
        ...recentContext.map(
          (item, index) =>
            `上一段 ${index + 1}（${String(item.publishedAt || "").replace("T", " ").replace("Z", " UTC")}）:\n${item.text}`,
        ),
        `最新消息:\n${baseSignal.text}`,
      ].join("\n\n");
    }

    store.appendRecentAnalystMessage(baseSignal.chatId, {
      messageId: message.message_id || message.id || "",
      publishedAt: baseSignal.publishedAt,
      text: baseSignal.text,
    });
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

async function handleSignalAction(signalId, action, form = {}) {
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
    await safeNotifyExecutionResult(signal, executionResult);

    return {
      statusCode: 200,
      title: "已忽略",
      summary: "这条信号不会执行。",
      result: executionResult,
    };
  }

  if (["executed", "dry_run_executed"].includes(signal.executionStatus)) {
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
  if (action === "approve") {
    applyManualTradeOverridesV2(signal, form);
    store.upsertSignal(signal);
  }
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
      const runtimeGateMode = getRuntimeSettings().gate?.mode || "dry_run";
      json(response, 200, {
        ok: true,
        host: config.host,
        publicBaseUrl: config.publicBaseUrl,
        dryRun: !["testnet", "spot_testnet", "futures_testnet"].includes(runtimeGateMode),
        autoExecutionEnabled: config.autoExecutionEnabled,
        runtimeAiEnabled: getRuntimeSettings().ai?.enabled || false,
        runtimeGateMode,
        telegramMode:
          config.telegram.sourceMode === "user" ? "user-stream" : config.telegram.mode,
        telegramSourceMode: config.telegram.sourceMode,
        telegramReady: telegramRuntime.ready,
        telegramRuntime: getTelegramRuntimeSummarySafe(),
        signalCount: store.listSignals().length,
        knownTelegramChats: store.listKnownTelegramChats().length,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/admin") {
      if (!requireAdmin(request, response, url)) {
        return;
      }
      const runtimeGateMode = getRuntimeSettings().gate?.mode || "dry_run";
      const analystMetrics = await buildAnalystMetrics({
        runtimeSettings: getRuntimeSettings(),
        knownChats: store.listKnownTelegramChats(),
        configuredChatLabels: normalizedChatLabels,
        trades: store.listTrades(),
        signals: store.listSignals(),
        gateClient: createGateClient(getRuntimeSettings()),
      });
      html(
        response,
        200,
        renderAdminPage({
          runtimeSettings: getRuntimeSettings(),
          knownChats: store.listKnownTelegramChats(),
          configuredChatLabels: normalizedChatLabels,
          signalCount: store.listSignals().length,
          dryRun: !["testnet", "spot_testnet", "futures_testnet"].includes(runtimeGateMode),
          autoExecutionEnabled: config.autoExecutionEnabled,
          runtimeAiEnabled: getRuntimeSettings().ai?.enabled || false,
          runtimeGateMode,
          defaultFeishuConfigured: Boolean(config.feishu.webhookUrl),
          telegramSourceMode: config.telegram.sourceMode,
          telegramRuntimeSummary: getTelegramRuntimeSummarySafe(),
          analystMetrics,
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

    if (request.method === "GET" && url.pathname === "/api/analyst-metrics") {
      if (!requireAdmin(request, response, url)) {
        return;
      }
      const analystMetrics = await buildAnalystMetrics({
        runtimeSettings: getRuntimeSettings(),
        knownChats: store.listKnownTelegramChats(),
        configuredChatLabels: normalizedChatLabels,
        trades: store.listTrades(),
        signals: store.listSignals(),
        gateClient: createGateClient(getRuntimeSettings()),
      });
      json(response, 200, analystMetrics);
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
      const preview = signal.tradeIdea ? await createGateClient(getRuntimeSettings()).previewTrade(signal.tradeIdea) : null;
      html(response, 200, renderSignalReviewPage(signal, token, { preview }));
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

      const form = request.method === "POST" ? await parseFormBody(request) : {};
      const actionResult = await handleSignalAction(signalId, action, form);
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
