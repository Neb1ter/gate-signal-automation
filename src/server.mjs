import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { renderAdminPage } from "./admin-page.mjs";
import { config, ensureRuntimeDirs, loadPlaybooks } from "./config.mjs";
import { FeishuNotifier } from "./feishu.mjs";
import {
  buildAnalystPrivacyAlias,
  createSignalFromPayload,
  createSignalFromTelegramMessage,
  evaluateSignal,
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

const defaultRuntimeSettings = {
  telegram: {
    allowedChatIds: config.telegram.allowedChatIds,
    analystChatIds: config.telegram.analystChatIds,
    newsChatIds: config.telegram.newsChatIds,
  },
  feishu: {
    analystRoutes: [],
  },
  execution: {
    newsMode: "auto",
    forwardOnlyMode: true,
  },
};

// Merge analystRoutes from payload file on every startup.
// Payload routes always win for matching chatIds; existing routes for
// other chatIds are preserved so manual additions survive restarts.
(function mergeAnalystRoutesOnStartup() {
  try {
    const payloadPath = path.join(process.cwd(), "config", "runtime-settings-payload.json");
    if (!fs.existsSync(payloadPath)) return;
    const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
    const payloadRoutes = payload.feishu?.analystRoutes;
    if (!Array.isArray(payloadRoutes) || payloadRoutes.length === 0) return;

    const currentSettings = store.getRuntimeSettings(defaultRuntimeSettings);
    const savedRoutes = currentSettings.feishu?.analystRoutes || [];
    const payloadChatIds = new Set(payloadRoutes.map((r) => r.chatId));

    // Keep saved routes for chatIds NOT in the payload; overwrite with payload for matching ids
    const merged = [
      ...savedRoutes.filter((r) => !payloadChatIds.has(r.chatId)),
      ...payloadRoutes,
    ];

    store.saveRuntimeSettings(
      { feishu: { analystRoutes: merged } },
      defaultRuntimeSettings,
    );
    console.log(
      `[startup] Merged analystRoutes: ${payloadRoutes.length} from payload, ${merged.length} total`,
    );
  } catch (e) {
    console.warn("[startup] Failed to merge analystRoutes:", e.message);
  }
})();

const feishuNotifier = new FeishuNotifier({
  webhookUrl: config.feishu.webhookUrl,
  publicBaseUrl: config.publicBaseUrl,
  appId: config.feishu.appId,
  appSecret: config.feishu.appSecret,
});
const telegramSource = createTelegramSource(config.telegram);
const telegramRuntime = {
  sourceMode: config.telegram.sourceMode,
  ready: false,
  identity: "",
  lastError: "",
};
const APP_BUILD = "forward-only-media-cleanup-v1";
scheduleMediaCleanup();
const safeConfiguredChatLabels = {
  "-1003758464445": "Get8.Pro",
  "-1003720685651": "Get8.Pro_News",
  "-1003093807993": "舒琴",
  "-1003358734784": "零下二度",
  "-1002953601978": "易盈社区-所长",
  "-1003435926001": "三马哥",
  "-1003162264989": "洪七公",
  "-1003300637347": "BTC乔乔",
  "-1003044946193": "大漂亮策略早知道",
  "-1003547241758": "熬鹰资本",
};

const cleanConfiguredChatLabels = {
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

function getRuntimeSettings() {
  return store.getRuntimeSettings(defaultRuntimeSettings);
}

function isForwardOnlyMode(runtimeSettings = getRuntimeSettings()) {
  return true;
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
  return (
    safeConfiguredChatLabels[String(chatId || "")] ||
    coerceCleanChineseText(cleanConfiguredChatLabels[String(chatId || "")], "")
  );
}

function getAnalystRoute(chatId) {
  const runtimeSettings = getRuntimeSettings();
  const routes = runtimeSettings.feishu?.analystRoutes || [];
  return routes.find((route) => route.chatId === String(chatId || "")) || null;
}
function getTelegramMessage(update) {
  return update?.channel_post || update?.message || update?.edited_channel_post || null;
}

function getSignalDeliveryOptionsSafe(signal) {
  const runtimeSettings = getRuntimeSettings();
  if (signal.sourceType !== "analyst") {
    const cleanName = coerceCleanChineseText(signal.sourceName, signal.sourceName || "信号来源");
    return {
      webhookUrl: "",
      displayName: cleanName,
      routeLabel: cleanName,
      forwardOnlyMode: isForwardOnlyMode(runtimeSettings),
      topicStyle: false,
    };
  }

  const route = getAnalystRoute(signal.chatId);
  const routeLabel =
    coerceCleanChineseText(route?.displayName, "") ||
    coerceCleanChineseText(signal.sourceName, "") ||
    getConfiguredChatLabel(signal.chatId) ||
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
    forwardOnlyMode: isForwardOnlyMode(runtimeSettings),
    topicStyle: true,
  };
}
function dedupeDeliveryTargets(targets) {
  const seen = new Set();
  const deduped = [];
  for (const target of targets) {
    if (!target) {
      continue;
    }
    const resolved = feishuNotifier.resolveWebhookUrl(target.webhookUrl);
    if (!resolved || seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    deduped.push(target);
  }
  return deduped;
}

function getSignalDeliveryTargets(signal) {
  return dedupeDeliveryTargets([getSignalDeliveryOptionsSafe(signal)]);
}

function extensionFromMimeType(mimeType = "") {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("png")) {
    return "png";
  }
  if (normalized.includes("webp")) {
    return "webp";
  }
  if (normalized.includes("gif")) {
    return "gif";
  }
  return "jpg";
}

function mediaPublicUrl(fileName) {
  const baseUrl = String(config.publicBaseUrl || "").replace(/\/$/, "");
  return baseUrl ? `${baseUrl}/media/${encodeURIComponent(fileName)}` : "";
}

async function cleanupOldMediaFiles({ retentionDays = config.mediaRetentionDays } = {}) {
  const days = Math.max(1, Number(retentionDays) || 7);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let deleted = 0;
  let scanned = 0;

  try {
    await fs.promises.mkdir(config.mediaDir, { recursive: true });
    const entries = await fs.promises.readdir(config.mediaDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const filePath = path.join(config.mediaDir, entry.name);
      const ext = path.extname(entry.name).toLowerCase();
      if (![".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) {
        continue;
      }

      scanned += 1;
      const stats = await fs.promises.stat(filePath);
      if (stats.mtimeMs < cutoff) {
        await fs.promises.unlink(filePath);
        deleted += 1;
      }
    }
  } catch (error) {
    console.warn(`[media-cleanup] failed: ${error.message}`);
    return { scanned, deleted, error: error.message };
  }

  if (deleted) {
    console.log(`[media-cleanup] deleted ${deleted}/${scanned} files older than ${days} days`);
  }
  return { scanned, deleted };
}

function scheduleMediaCleanup() {
  void cleanupOldMediaFiles();
  setInterval(() => {
    void cleanupOldMediaFiles();
  }, 12 * 60 * 60 * 1000).unref?.();
}

function persistDownloadedMedia(items = [], message = {}) {
  const media = [];
  fs.mkdirSync(config.mediaDir, { recursive: true });

  for (const item of Array.isArray(items) ? items : []) {
    const buffer = Buffer.isBuffer(item?.buffer) ? item.buffer : null;
    if (!buffer?.length || item?.type !== "image") {
      continue;
    }

    const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 24);
    const ext = extensionFromMimeType(item.mimeType);
    const messageId = String(message?.message_id || message?.id || Date.now()).replace(/\D/g, "");
    const fileName = `${messageId || "telegram"}-${hash}.${ext}`;
    const filePath = path.join(config.mediaDir, fileName);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, buffer);
    }

    media.push({
      type: "image",
      mimeType: item.mimeType || "image/jpeg",
      fileName,
      filePath,
      publicUrl: mediaPublicUrl(fileName),
      telegramFileId: item.telegramFileId || "",
      telegramFileUniqueId: item.telegramFileUniqueId || "",
    });
  }

  return media;
}

async function hydrateTelegramMessageMedia(message) {
  if (!message || !telegramSource?.downloadMessageMedia) {
    return message;
  }

  const existingMedia = Array.isArray(message.media) ? message.media : [];
  const hasStoredMedia = existingMedia.some((item) => item?.filePath || item?.publicUrl);
  if (hasStoredMedia) {
    return message;
  }

  try {
    const downloaded = await telegramSource.downloadMessageMedia(message);
    const persisted = persistDownloadedMedia(downloaded, message);
    if (persisted.length) {
      message.media = persisted;
    } else if (existingMedia.length) {
      message.media = existingMedia;
    }
  } catch (error) {
    console.warn(`[telegram-media] failed to download media: ${error.message}`);
    message.media = existingMedia;
  }

  return message;
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
        <p>这是你的交易信号后台。登录后可以管理 Telegram 监听群、切换系统模式，并查看转发与信号状态。</p>
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
function applyForwardOnlyMode(signal, runtimeSettings = getRuntimeSettings()) {
  if (!signal) {
    return signal;
  }

  signal.tradeIdea = null;
  signal.managementIntent = "";
  signal.executionResult = null;
  signal.executionStatus = "notify_only";
  signal.executionReason =
    signal.sourceType === "analyst"
      ? "纯转发模式：只做去噪转发"
      : "纯转发模式：只做消息转发";

  if (signal.analysis) {
    signal.analysis.semanticSummary = "";
    signal.analysis.semanticRewrite = "";
    signal.analysis.executionIntent = "";
    signal.analysis.instructionType = "";
    signal.analysis.automationReady = false;
    signal.analysis.automationComment = "";
    signal.analysis.rejectionReason = "";
    signal.analysis.complianceComment = "";
    signal.analysis.normalizedSummary = "";
    signal.analysis.riskFlags = [];
  }

  signal.processingMode = isForwardOnlyMode(runtimeSettings) ? "forward_only" : "standard";
  return signal;
}

async function notifySignal(signal) {
  const deliveryTargets = getSignalDeliveryTargets(signal);
  await Promise.all(
    deliveryTargets.map((deliveryOptions) =>
      feishuNotifier.sendSignalCard(signal, "", deliveryOptions),
    ),
  );
}

async function safeNotifySignal(signal) {
  try {
    await notifySignal(signal);
  } catch (error) {
    console.warn(`[notify] signal ${signal.id} failed: ${error.message}`);
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

  applyForwardOnlyMode(signal, getRuntimeSettings());

  const deliveryOptions = getSignalDeliveryOptionsSafe(signal);
  signal.deliveryDisplayName = deliveryOptions.displayName || signal.displaySourceName;
  store.upsertSignal(signal);

  await safeNotifySignal(signal);
  signal.notifiedAt = new Date().toISOString();
  signal.processingUpdatedAt = signal.notifiedAt;
  signal.processingState = "completed";
  store.upsertSignal(signal);
  return signal;
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
          `上一段 ${index + 1}：${String(item.publishedAt || "").replace("T", " ").replace("Z", " UTC")}\n${item.text}`,
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

  await hydrateTelegramMessageMedia(message);
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
            `上一段 ${index + 1}：${String(item.publishedAt || "").replace("T", " ").replace("Z", " UTC")}\n${item.text}`,
        ),
        `最新消息：\n${baseSignal.text}`,
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
      : "Telegram 个人号模式还没有可用会话，请先执行一次登录。";
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

    if (request.method === "GET" && url.pathname.startsWith("/media/")) {
      const fileName = path.basename(decodeURIComponent(url.pathname.slice("/media/".length)));
      const filePath = path.resolve(config.mediaDir, fileName);
      const mediaRoot = path.resolve(config.mediaDir);
      if (!fileName || !filePath.startsWith(mediaRoot + path.sep) || !fs.existsSync(filePath)) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }

      const ext = path.extname(fileName).toLowerCase();
      const contentType =
        ext === ".png"
          ? "image/png"
          : ext === ".webp"
            ? "image/webp"
            : ext === ".gif"
              ? "image/gif"
              : "image/jpeg";
      response.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=604800, immutable",
      });
      fs.createReadStream(filePath).pipe(response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, {
        ok: true,
        build: APP_BUILD,
        host: config.host,
        publicBaseUrl: config.publicBaseUrl,
        telegramMode:
          config.telegram.sourceMode === "user" ? "user-stream" : config.telegram.mode,
        telegramSourceMode: config.telegram.sourceMode,
        telegramReady: telegramRuntime.ready,
        telegramRuntime: getTelegramRuntimeSummarySafe(),
        signalCount: store.listSignals().length,
        knownTelegramChats: store.listKnownTelegramChats().length,
        mediaRetentionDays: config.mediaRetentionDays,
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
          configuredChatLabels: safeConfiguredChatLabels,
          signalCount: store.listSignals().length,
          defaultFeishuConfigured: Boolean(config.feishu.webhookUrl),
          telegramSourceMode: config.telegram.sourceMode,
          telegramRuntimeSummary: getTelegramRuntimeSummarySafe(),
          port: config.port,
          publicBaseUrl: config.publicBaseUrl,
        }),
      );
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

    notFound(response);
  } catch (error) {
    json(response, 500, { error: error.message });
  }
});

const baseUrl = config.publicBaseUrl || `http://127.0.0.1:${config.port}`;
server.listen(config.port, config.host, async () => {
  console.log(`Signal automation server listening on ${baseUrl}`);
  console.log("Mode: forward-only (no trading)");
  console.log(`Admin page: ${baseUrl}/admin`);
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
