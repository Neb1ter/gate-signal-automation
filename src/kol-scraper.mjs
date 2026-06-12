// -*- coding: utf-8 -*-
// KOL signal scraper — real-time KOL trading signals from kol.lysq.cc
//
// Architecture:
//   SSE (primary) → real-time push from /v1/api/push/subscribe
//   Polling (fallback) → 60s poll of /v1/api/ai-signals/grouped when SSE is down
//   Auto-reconnect → retry SSE every 5 polling cycles, switch back on success
//
// Per-KOL routing: each KOL has its own Discord + Feishu webhook pair.
// Noise removal via sanitizeForwardText (same pipeline as TG signals).
// Hash-based dedup to avoid duplicate posts.
//
// Policy: 只去噪不格式化。原文清洗后加【KOL转发｜xxx】标签原样发出。
// Image support: fetches raw messages from kol.lysq.cc frontend API to get attachments.

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { HttpsProxyAgent } from "https-proxy-agent";
import { config } from "./config.mjs";
import { sanitizeForwardText } from "./discord.mjs";

// ── KOL auth ──────────────────────────────────────────────
let kolAuthToken = "";
let kolAuthExpiry = 0;

async function loginKol() {
  if (kolAuthToken && Date.now() < kolAuthExpiry) return kolAuthToken;
  try {
    const resp = await proxyFetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: config.kol.email, password: config.kol.password }),
    });
    const json = await resp.json();
    kolAuthToken = json?.data?.token || "";
    kolAuthExpiry = Date.now() + 60 * 60 * 1000; // 1 hour
    if (kolAuthToken) console.log("[kol] Auth refreshed");
    return kolAuthToken;
  } catch {
    return "";
  }
}

// ── proxy-aware fetch ────────────────────────────────────
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const proxyAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : null;

if (proxyAgent) {
  console.log("[kol] Using proxy:", proxyUrl);
}

/**
 * Fetch wrapper that routes through proxy using native https module.
 * Node.js built-in fetch (undici) doesn't support HttpsProxyAgent,
 * so for https:// requests with proxy we use the native https module.
 */
async function proxyFetch(url, options = {}) {
  // No proxy or non-https URL → use native fetch
  if (!proxyAgent || !String(url).startsWith("https://")) {
    return fetch(url, options);
  }

  // Use native https module with proxy agent
  const parsedUrl = new URL(url);
  const method = (options.method || "GET").toUpperCase();
  const headers = { ...(options.headers || {}) };
  let body = options.body || null;

  // Serialize body if needed. Skip FormData/URLSearchParams — pass through to native fetch.
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const isURLSearchParams = typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams;

  if (body && !isFormData && !isURLSearchParams && typeof body !== "string") {
    body = JSON.stringify(body);
    if (!headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
  }
  if (body && !isFormData && !isURLSearchParams) {
    headers["Content-Length"] = Buffer.byteLength(body);
  }

  // FormData/URLSearchParams can't go through native https module — use native fetch
  // These are used for Feishu image upload which doesn't need proxy
  if (isFormData || isURLSearchParams) {
    return fetch(url, { ...options, headers: { ...(options.headers || {}), ...headers } });
  }

  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      agent: proxyAgent,
      headers,
      timeout: options.signal ? 15000 : 0,
    };

    const req = https.request(reqOptions, (res) => {
      const chunks = [];
      res.on("data", (chunk) => { chunks.push(Buffer.from(chunk)); });
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 400,
          status: res.statusCode,
          statusCode: res.statusCode,
          headers: {
            get: (name) => res.headers[String(name || "").toLowerCase()] || "",
          },
          arrayBuffer: async () =>
            buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
          json: async () => {
            try { return JSON.parse(buffer.toString("utf8")); } catch { return null; }
          },
          text: async () => buffer.toString("utf8"),
        });
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    if (options.signal) {
      options.signal.addEventListener("abort", () => {
        req.destroy();
        reject(new Error("Aborted"));
      });
    }

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

const API_BASE = "https://kol.lysq.cc/v1/api";
const SSE_PATH = "/v1/api/push/subscribe";

const POLL_INTERVAL_SEC = 60;
const SSE_RECONNECT_INTERVAL_CYCLES = 5;
const DEDUP_TTL_MS = 60 * 60 * 1000;
const FEISHU_TOKEN_URL = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
const FEISHU_IMAGE_URL = "https://open.feishu.cn/open-apis/im/v1/images";

let feishuTenantAccessToken = "";
let feishuTenantAccessTokenExpiresAt = 0;
const feishuImageKeyCache = new Map();

// ── dedup ──────────────────────────────────────────────────

const seenSignals = new Map();

function isDuplicate(key) {
  if (!key) return true;
  const last = seenSignals.get(key);
  if (last && Date.now() - last < DEDUP_TTL_MS) return true;
  seenSignals.set(key, Date.now());
  if (seenSignals.size > 5000) {
    const cutoff = Date.now() - DEDUP_TTL_MS;
    for (const [k, v] of seenSignals) {
      if (v < cutoff) seenSignals.delete(k);
    }
  }
  return false;
}

function buildDedupKey(signal) {
  const msgId = signal.message_id || "";
  const symbol = signal.symbol || "";
  const author = signal.author_name || signal.author_username || "";
  const direction = signal.direction || signal.entry_type || "";
  return [author, symbol, direction, msgId].join("|");
}

function compareMessageIds(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left.length !== right.length) {
    return left.length - right.length;
  }
  return left.localeCompare(right);
}

function isNewerMessageId(messageId, lastSeen) {
  if (!messageId) return false;
  if (!lastSeen) return true;
  return compareMessageIds(messageId, lastSeen) > 0;
}

// ── KOL routing ────────────────────────────────────────────

function findKOLRoute(authorName, routes) {
  const name = (authorName || "").trim();
  if (!name) return null;
  for (const route of routes) {
    if (!route.authorName) continue;
    if (name === route.authorName || name.includes(route.authorName) || route.authorName.includes(name)) {
      return route;
    }
  }
  return null;
}

function findKOLRouteForMessage(message, routes) {
  const channelId = String(
    message?.kolChannelId ||
      message?.channel_id ||
      message?.channelId ||
      message?.source_channel_id ||
      message?.sourceChannelId ||
      "",
  );
  if (channelId) {
    const byChannel = routes.find((route) => String(route.kolChannelId || "") === channelId);
    if (byChannel) {
      return byChannel;
    }
  }

  return findKOLRoute(
    message?.author_name || message?.author_username || message?.channel_name || "",
    routes,
  );
}

// ── image fetching ────────────────────────────────────────

/**
 * Fetch raw messages for a KOL channel from kol.lysq.cc frontend API.
 * Returns messages with attachments (images).
 */
async function fetchRawMessages(kolChannelId, limit = 3) {
  const token = await loginKol();
  if (!token || !kolChannelId) return [];
  try {
    const resp = await proxyFetch(
      `${API_BASE}/frontend-messages?limit=${limit}&offset=0&type=analysis&channel_id=${kolChannelId}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) },
    );
    if (!resp.ok) return [];
    const json = await resp.json();
    return json?.messages || [];
  } catch {
    return [];
  }
}

/**
 * Find attachments for a signal by matching source_message_id.
 * The signal's source_message_id = the raw message's message_id (Discord snowflake).
 */
function findAttachmentsForSignal(rawMessages, signal) {
  if (!rawMessages.length) return [];
  const srcMsgId = signal.source_message_id || "";

  for (const msg of rawMessages) {
    // Direct match by source_message_id → raw message_id
    if (srcMsgId && msg.message_id === srcMsgId && msg.attachments?.length) {
      return msg.attachments;
    }
  }
  return [];
}

/**
 * Build embed image URL from attachment data.
 * Discord CDN URLs work for Discord's own image proxy when ?ex= is stripped.
 * kol.lysq.cc proxy URLs also work.
 */
function buildImageUrl(att) {
  // Prefer Discord CDN (strip expiry params — Discord servers can still fetch it)
  const cdnUrl = att.originalUrl || "";
  if (cdnUrl && cdnUrl.includes("cdn.discordapp.com")) {
    return cdnUrl.replace(/[?&]ex=[^&]+/g, "").replace(/[?&]is=[^&]+/g, "").replace(/[?&]hm=[^&]+/g, "");
  }
  if (cdnUrl) return cdnUrl;

  // Fallback: kol.lysq.cc proxy URL
  const msgId = att.messageId || "";
  const attId = att.attachmentId || "";
  const ext = (att.originalName || "image.png").split(".").pop();
  if (msgId && attId) {
    return `https://kol.lysq.cc/v1/api/files/discord/attachments/${msgId}_${attId}.${ext}`;
  }
  return "";
}

/**
 * Forward an image to Discord via embed.
 */
async function forwardImageToDiscord(webhookUrl, imageUrl) {
  if (!webhookUrl || !imageUrl) return false;
  try {
    const embedBody = JSON.stringify({
      embeds: [{ image: { url: imageUrl } }],
      allowed_mentions: { parse: [] },
    });

    const u = new URL(webhookUrl);
    await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: u.hostname, port: 443, path: u.pathname + u.search,
        method: "POST", agent: proxyAgent,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(embedBody) },
      }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on("error", reject);
      req.write(embedBody);
      req.end();
    });
    return true;
  } catch {
    return false;
  }
}

function canUploadFeishuImages() {
  return Boolean(config.feishu.appId && config.feishu.appSecret);
}

async function getFeishuTenantAccessToken() {
  if (!canUploadFeishuImages()) return "";
  if (feishuTenantAccessToken && Date.now() < feishuTenantAccessTokenExpiresAt - 60_000) {
    return feishuTenantAccessToken;
  }

  const resp = await proxyFetch(FEISHU_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: config.feishu.appId,
      app_secret: config.feishu.appSecret,
    }),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok || data?.code !== 0 || !data?.tenant_access_token) {
    throw new Error(`Feishu tenant token failed: ${data?.msg || resp.status}`);
  }

  feishuTenantAccessToken = data.tenant_access_token;
  feishuTenantAccessTokenExpiresAt = Date.now() + Number(data.expire || 7200) * 1000;
  return feishuTenantAccessToken;
}

function guessMimeTypeFromUrl(url) {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

async function fetchImageBuffer(imageUrl) {
  const resp = await proxyFetch(imageUrl, {
    headers: { Accept: "image/*,*/*;q=0.8" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    throw new Error(`image download failed: ${resp.status}`);
  }
  const arrayBuffer = await resp.arrayBuffer();
  const mimeType = resp.headers?.get?.("content-type") || guessMimeTypeFromUrl(imageUrl);
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: String(mimeType || "image/jpeg").split(";")[0],
  };
}

async function uploadFeishuImageFromUrl(imageUrl) {
  if (!canUploadFeishuImages() || !imageUrl) return "";
  if (feishuImageKeyCache.has(imageUrl)) {
    return feishuImageKeyCache.get(imageUrl);
  }

  const { buffer, mimeType } = await fetchImageBuffer(imageUrl);
  const token = await getFeishuTenantAccessToken();
  const form = new FormData();
  const fileName = `kol-image.${mimeType.split("/").pop() || "jpg"}`;
  form.append("image_type", "message");
  form.append("image", new Blob([buffer], { type: mimeType }), fileName);

  const resp = await proxyFetch(FEISHU_IMAGE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await resp.json().catch(() => null);
  const imageKey = data?.data?.image_key || "";
  if (!resp.ok || data?.code !== 0 || !imageKey) {
    throw new Error(`Feishu image upload failed: ${data?.msg || resp.status}`);
  }

  feishuImageKeyCache.set(imageUrl, imageKey);
  return imageKey;
}

async function postFeishuImage(webhookUrl, imageKey, signSecret = "") {
  if (!webhookUrl || !imageKey) return false;
  return postFeishuJson(
    webhookUrl,
    {
      msg_type: "image",
      content: { image_key: imageKey },
    },
    signSecret,
  );
}

function signFeishuPayload(payload, signSecret = "") {
  const secret = String(signSecret || "").trim();
  if (!secret) return payload;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const stringToSign = `${timestamp}\n${secret}`;
  const sign = crypto.createHmac("sha256", stringToSign).update("").digest("base64");
  return { ...payload, timestamp, sign };
}

async function postFeishuJson(webhookUrl, payload, signSecret = "") {
  if (!webhookUrl || !payload) return false;
  try {
    const resp = await proxyFetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signFeishuPayload(payload, signSecret)),
    });
    const data = await resp.json().catch(() => null);
    return resp.ok && (!data || data.code === 0);
  } catch {
    return false;
  }
}

async function postFeishuImageLink(webhookUrl, imageUrl, signSecret = "") {
  if (!webhookUrl || !imageUrl) return false;
  return postFeishuJson(
    webhookUrl,
    {
      msg_type: "text",
      content: { text: `[图片] ${imageUrl}` },
    },
    signSecret,
  );
}

async function forwardImageToFeishu(webhookUrl, imageUrl, signSecret = "") {
  if (!webhookUrl || !imageUrl) return false;
  if (!canUploadFeishuImages()) {
    return postFeishuImageLink(webhookUrl, imageUrl, signSecret);
  }

  try {
    const imageKey = await uploadFeishuImageFromUrl(imageUrl);
    if (imageKey && (await postFeishuImage(webhookUrl, imageKey, signSecret))) {
      return true;
    }
  } catch (error) {
    console.warn(`[kol] Feishu image upload failed, falling back to link: ${error.message}`);
  }
  return postFeishuImageLink(webhookUrl, imageUrl, signSecret);
}

function getFeishuFallbackTarget(primaryWebhookUrl = "") {
  const fallbackUrl = String(config.kol?.feishuFallbackWebhookUrl || "").trim();
  if (!fallbackUrl || fallbackUrl === String(primaryWebhookUrl || "").trim()) {
    return null;
  }
  // Safety: never fallback into another KOL's primary group.
  // If the fallback URL is the same as any route's feishuWebhookUrl and that
  // route is not the current one, block the fallback to avoid cross-posting.
  const ownerRoute = config.kol?.routes?.find(
    (r) => r.feishuWebhookUrl === fallbackUrl && r.feishuWebhookUrl !== primaryWebhookUrl,
  );
  if (ownerRoute) {
    console.warn(
      `[kol] Fallback blocked: target URL belongs to ${ownerRoute.authorName}, not a dedicated fallback group`,
    );
    return null;
  }
  return {
    webhookUrl: fallbackUrl,
    signSecret: config.kol?.feishuFallbackSignSecret || "",
  };
}

async function postToFeishuWithFallback(route, card) {
  if (!route?.feishuWebhookUrl) return { ok: false, usedFallback: false };
  if (await postToFeishu(route.feishuWebhookUrl, card, route.feishuSignSecret)) {
    return { ok: true, usedFallback: false };
  }

  const fallback = getFeishuFallbackTarget(route.feishuWebhookUrl);
  if (!fallback) return { ok: false, usedFallback: false };

  const fallbackCard = {
    ...card,
    title: `${card.title}｜备用`,
    content: `[主飞书群发送失败，已转入备用]\n${card.content}`,
  };
  const ok = await postToFeishu(fallback.webhookUrl, fallbackCard, fallback.signSecret);
  return { ok, usedFallback: ok };
}

async function forwardImageToFeishuWithFallback(route, imageUrl) {
  if (!route?.feishuWebhookUrl || !imageUrl) return { ok: false, usedFallback: false };
  if (await forwardImageToFeishu(route.feishuWebhookUrl, imageUrl, route.feishuSignSecret)) {
    return { ok: true, usedFallback: false };
  }

  const fallback = getFeishuFallbackTarget(route.feishuWebhookUrl);
  if (!fallback) return { ok: false, usedFallback: false };

  const ok = await forwardImageToFeishu(fallback.webhookUrl, imageUrl, fallback.signSecret);
  return { ok, usedFallback: ok };
}

// ── formatting (denoise only, no restructure) ──────────────

/**
 * Format a KOL signal for Discord.
 * ONLY denoise + label. No reformatting. Original text sent as-is.
 */
function extractRawText(msg) {
  // frontend-messages format: message_content field
  if (msg.message_content) return msg.message_content;
  // ai-signals format: original_message.content
  const om = msg.original_message;
  if (om && typeof om === "object" && om.content) return om.content;
  if (typeof om === "string" && om) return om;
  return msg.text || msg.content || msg.raw_text || "";
}

function formatDiscordSignal(signal, routeLabel) {
  const author = signal.author_name || signal.author_username || routeLabel;
  const rawText = extractRawText(signal);
  const cleaned = rawText ? sanitizeForwardText(rawText) : "";

  const lines = [];
  lines.push(`**【KOL转发｜${routeLabel || author}】**`);

  if (cleaned) {
    lines.push("");
    lines.push(cleaned);
  }

  return lines.join("\n");
}

/**
 * Format a KOL signal for Feishu bot card.
 * ONLY denoise + label. No reformatting.
 */
function formatFeishuCard(signal, routeLabel) {
  const author = signal.author_name || signal.author_username || routeLabel;
  const rawText = extractRawText(signal);
  const cleanedBody = rawText ? sanitizeForwardText(rawText) : "";

  return {
    title: `KOL转发｜${routeLabel || author}`,
    content: cleanedBody || "(无正文)",
    channel: signal.channel_name || "",
  };
}

// ── webhook posting ────────────────────────────────────────

async function postToDiscord(webhookUrl, content) {
  if (!webhookUrl || !content) return false;
  try {
    const resp = await proxyFetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: content.slice(0, 2000),
        allowed_mentions: { parse: [] },
      }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function postToFeishu(webhookUrl, card, signSecret = "") {
  if (!webhookUrl || !card) return false;
  const isBot = /\/open-apis\/bot\/v2\/hook\//i.test(webhookUrl);

  try {
    if (isBot) {
      const body = {
        msg_type: "interactive",
        card: {
          header: {
            title: { content: card.title, tag: "plain_text" },
            template: "blue",
          },
          elements: [
            { tag: "div", text: { content: card.content, tag: "lark_md" } },
            { tag: "hr" },
            {
              tag: "note",
              elements: [
                {
                  content: `KOL转发 · ${card.channel || card.title}`,
                  tag: "plain_text",
                },
              ],
            },
          ],
        },
      };
      return postFeishuJson(webhookUrl, body, signSecret);
    }

    return postFeishuJson(webhookUrl, { title: card.title, content: card.content }, signSecret);
  } catch {
    return false;
  }
}

// ── frontend message polling ──────────────────────────────

/**
 * Fetch latest raw messages for a KOL channel from kol.lysq.cc frontend API.
 * Returns messages with text + attachments (images).
 */
async function fetchChannelMessages(kolChannelId, limit = 5) {
  if (!kolChannelId) return [];
  try {
    const token = await loginKol();
    if (!token) return [];
    const resp = await proxyFetch(
      `${API_BASE}/frontend-messages?limit=${limit}&offset=0&type=all&channel_id=${kolChannelId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!resp.ok) return [];
    const json = await resp.json();
    return json?.messages || [];
  } catch {
    return [];
  }
}

// ── SSE client ─────────────────────────────────────────────

function connectSSE({ onSignal, onDisconnect }) {
  const sseUrl = API_BASE + SSE_PATH;
  const parsedUrl = new URL(sseUrl);
  const lib = parsedUrl.protocol === "https:" ? https : http;

  let buffer = "";
  let eventType = "";
  let data = "";
  let connected = false;
  let closed = false;
  let req = null;

  function parseLine(line) {
    const trimmed = line.trim();
    if (trimmed.startsWith("event:")) {
      eventType = trimmed.slice(6).trim();
    } else if (trimmed.startsWith("data:")) {
      data += trimmed.slice(5);
    } else if (trimmed === "" && data) {
      try {
        const parsed = JSON.parse(data);
        onSignal({ event: eventType || "message", data: parsed });
      } catch {
        // non-JSON, skip
      }
      eventType = "";
      data = "";
    }
  }

  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
    path: parsedUrl.pathname + parsedUrl.search,
    method: "GET",
    headers: {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
    timeout: 0,
  };
  if (proxyAgent && parsedUrl.protocol === "https:") {
    options.agent = proxyAgent;
  }

  req = lib.request(options, (res) => {
    if (res.statusCode !== 200) {
      const reason = `SSE HTTP ${res.statusCode}`;
      if (!closed) onDisconnect(reason);
      return;
    }
    connected = true;
    res.setEncoding("utf8");

    res.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) parseLine(line);
    });

    res.on("error", (err) => {
      connected = false;
      if (!closed) onDisconnect(`SSE read error: ${err.message}`);
    });

    res.on("end", () => {
      connected = false;
      if (!closed) onDisconnect("SSE stream ended");
    });
  });

  req.on("error", (err) => {
    connected = false;
    if (!closed) onDisconnect(`SSE connection error: ${err.message}`);
  });

  req.end();

  return {
    close() {
      closed = true;
      connected = false;
      try { req.destroy(); } catch { /* ignore */ }
    },
    isConnected() {
      return connected;
    },
  };
}

// ── KolScraper ─────────────────────────────────────────────

export class KolScraper {
  constructor({ routes = [], pollSec = POLL_INTERVAL_SEC } = {}) {
    this.routes = routes;
    this.activeRoutes = routes.filter(
      (r) => r.authorName && (r.discordWebhookUrl || r.feishuWebhookUrl),
    );
    this.pollSec = pollSec;
    this.sseClient = null;
    this.pollTimer = null;
    this.running = false;
    this.mode = "init";
    this.pollCycleCount = 0;
    this.pollInProgress = false;
    this.lastSeenFile = path.join(config.dataDir, "kol-last-seen.json");
    this._lastSeen = this.loadLastSeen();
    this.stats = {
      sseReceived: 0,
      pollFetched: 0,
      discordSent: 0,
      discordImageSent: 0,
      feishuSent: 0,
      feishuImageSent: 0,
      feishuFallbackSent: 0,
      failures: 0,
    };
  }

  loadLastSeen() {
    try {
      if (!fs.existsSync(this.lastSeenFile)) {
        return new Map();
      }
      const parsed = JSON.parse(fs.readFileSync(this.lastSeenFile, "utf8"));
      return new Map(Object.entries(parsed || {}));
    } catch (error) {
      console.warn(`[kol] Failed to load last-seen state: ${error.message}`);
      return new Map();
    }
  }

  saveLastSeen() {
    try {
      fs.mkdirSync(path.dirname(this.lastSeenFile), { recursive: true });
      fs.writeFileSync(
        this.lastSeenFile,
        JSON.stringify(Object.fromEntries(this._lastSeen || new Map()), null, 2),
      );
    } catch (error) {
      console.warn(`[kol] Failed to save last-seen state: ${error.message}`);
    }
  }

  handleSSEEvent({ data: raw }) {
    const signals = Array.isArray(raw) ? raw : [raw];
    for (const item of signals) {
      this.stats.sseReceived++;
      const signal = {
        author_name: item.author_name,
        author_username: item.author_username,
        channel_name: item.channel_name,
        platform: item.platform,
        ...item,
        ai_analysis: item.ai_analysis || item.ai_result,
      };
      const route = findKOLRouteForMessage(signal, this.activeRoutes);
      if (!route) {
        console.warn(
          `[kol] SSE signal skipped: no route for ${signal.author_name || signal.channel_name || "unknown"}`,
        );
        continue;
      }
      if (isDuplicate(buildDedupKey(signal))) {
        continue;
      }
      void this.routeAndSend(signal, route);
    }
  }

  async routeAndSend(msg, route) {
    if (!route) {
      console.warn("[kol] Message skipped: no route");
      return;
    }
    const label = route.authorName;
    const rawText = extractRawText(msg);
    const cleaned = rawText ? sanitizeForwardText(rawText) : "";

    // 1. Post text to Discord
    if (route.discordWebhookUrl && cleaned) {
      const content = `**【KOL转发｜${label}】**\n\n${cleaned}`;
      const ok = await postToDiscord(route.discordWebhookUrl, content);
      if (ok) this.stats.discordSent++;
      else this.stats.failures++;
    }

    // 2. Post images
    if (msg.attachments?.length) {
      for (const att of msg.attachments) {
        const imageUrl = buildImageUrl(att);
        if (!imageUrl) {
          continue;
        }
        if (route.discordWebhookUrl) {
          const ok = await forwardImageToDiscord(route.discordWebhookUrl, imageUrl);
          if (ok) this.stats.discordImageSent++;
          else this.stats.failures++;
        }
        if (route.feishuWebhookUrl) {
          const result = await forwardImageToFeishuWithFallback(route, imageUrl);
          if (result.ok) {
            this.stats.feishuImageSent++;
            if (result.usedFallback) this.stats.feishuFallbackSent++;
          } else {
            this.stats.failures++;
          }
        }
      }
    }

    // 3. Post to Feishu
    if (route.feishuWebhookUrl) {
      const card = {
        title: `KOL转发｜${label}`,
        content: cleaned || "(无正文)",
        channel: msg.channel_name || "",
      };
      const result = await postToFeishuWithFallback(route, card);
      if (result.ok) {
        this.stats.feishuSent++;
        if (result.usedFallback) this.stats.feishuFallbackSent++;
      } else {
        this.stats.failures++;
      }
    }

    const imgTag = msg.attachments?.length ? ` +${msg.attachments.length}📎` : "";
    console.log(`[kol] ${label} → discord:${route.discordWebhookUrl ? "✓" : "✗"} feishu:${route.feishuWebhookUrl ? "✓" : "✗"}${imgTag}`);
  }

  async pollOnce() {
    if (!this.running) return;
    if (this.pollInProgress) return;
    this.pollInProgress = true;
    this.pollCycleCount++;

    let newCount = 0;
    try {
      for (const route of this.activeRoutes) {
        if (!route.kolChannelId) continue;
        try {
          const msgs = await fetchChannelMessages(route.kolChannelId, 5);
          this.stats.pollFetched += msgs.length;
          const lastSeenKey = `last_${route.kolChannelId}`;
          const lastSeen = this._lastSeen.get(lastSeenKey) || "";
          const newMessages = msgs
            .filter((msg) => isNewerMessageId(msg.message_id, lastSeen))
            .sort((a, b) => compareMessageIds(a.message_id, b.message_id));

          for (const msg of newMessages) {
            const msgId = msg.message_id;

            const dedupKey = `raw_${msgId}`;
            if (isDuplicate(dedupKey)) continue;

            await this.routeAndSend(msg, route);
            this._lastSeen.set(lastSeenKey, msgId);
            this.saveLastSeen();
            newCount++;
            await new Promise(r => setTimeout(r, 300)); // rate limit
          }
        } catch (error) {
          this.stats.failures++;
          console.warn(`[kol] Poll failed for ${route.authorName}: ${error.message}`);
        }
      }

      if (newCount) {
        console.log(`[kol] Poll #${this.pollCycleCount}: ${newCount} new messages forwarded`);
      }
    } finally {
      this.pollInProgress = false;
    }
  }

  async startPolling() {
    this.mode = "poll";
    this.pollCycleCount = 0;
    console.log("[kol] SSE unavailable — falling back to polling mode");

    await this.pollOnce();

    this.pollTimer = setInterval(async () => {
      await this.pollOnce();

      if (this.pollCycleCount % SSE_RECONNECT_INTERVAL_CYCLES === 0) {
        if (this.running) {
          console.log("[kol] Attempting SSE reconnect...");
          this.startSSE();
        }
      }
    }, this.pollSec * 1000);
  }

  startSSE() {
    if (this.sseClient) {
      try { this.sseClient.close(); } catch { /* ignore */ }
      this.sseClient = null;
    }

    console.log("[kol] Connecting SSE...");
    this.sseClient = connectSSE({
      onSignal: (event) => this.handleSSEEvent(event),
      onDisconnect: (reason) => {
        console.log(`[kol] SSE disconnected: ${reason}`);
        this.sseClient = null;

        if (this.running) {
          if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
          }
          this.startPolling();
        }
      },
    });

    setTimeout(() => {
      if (this.sseClient && this.sseClient.isConnected()) {
        this.mode = "sse";
        console.log("[kol] SSE connected — real-time mode active");
        if (this.pollTimer) {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
        }
      }
    }, 5000);
  }

  start() {
    if (!this.activeRoutes.length) {
      console.log("[kol] No KOL routes configured — KOL scraper disabled");
      return;
    }
    if (!config.kol.email || !config.kol.password) {
      console.warn("[kol] KOL_EMAIL/KOL_PASSWORD missing — polling login will fail until configured");
    }
    if (this.activeRoutes.some((route) => route.feishuWebhookUrl) && !canUploadFeishuImages()) {
      console.warn("[kol] FEISHU_APP_ID/FEISHU_APP_SECRET missing — Feishu KOL images will be sent as links");
    }

    this.running = true;
    const names = this.activeRoutes.map((r) => r.authorName).join("、");
    console.log(
      `[kol] KOL scraper starting — tracking: ${names} (${this.activeRoutes.length} KOLs)`,
    );
    console.log(`[kol] SSE primary, ${this.pollSec}s polling fallback`);
    void this.pollOnce();
    this.startSSE();
  }

  stop() {
    this.running = false;
    if (this.sseClient) {
      try { this.sseClient.close(); } catch { /* ignore */ }
      this.sseClient = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    console.log("[kol] KOL scraper stopped");
  }

  getStats() {
    return {
      ...this.stats,
      mode: this.mode,
      routesCount: this.activeRoutes.length,
      feishuImageMode: canUploadFeishuImages() ? "upload" : "link",
      feishuFallbackConfigured: Boolean(config.kol?.feishuFallbackWebhookUrl),
    };
  }

  /**
   * Cloud test-send: fetch latest real KOL messages and forward to
   * Feishu / Discord.  Bypasses dedup / lastSeen so the forwarding
   * pipeline is exercised with live data.  Admin-only.
   */
  async testSend({ only = [], skip = ["舒琴"], limit = 1, sendDiscord = false, sendFeishu = true } = {}) {
    const onlySet = new Set(only.filter(Boolean));
    const skipSet = new Set(skip.filter(Boolean));

    const targets = this.activeRoutes.filter((r) => {
      if (skipSet.has(r.authorName)) return false;
      if (onlySet.size && !onlySet.has(r.authorName)) return false;
      return true;
    });

    const results = [];

    for (const route of targets) {
      const entry = {
        authorName: route.authorName,
        messageId: "",
        feishuText: "skipped",
        feishuImage: "skipped",
        discordText: "skipped",
        discordImage: "skipped",
        error: null,
      };

      try {
        const messages = await fetchChannelMessages(route.kolChannelId, limit);
        if (!messages.length) {
          entry.error = "no messages returned from kol.lysq.cc";
          results.push(entry);
          continue;
        }

        const msg = messages[0];
        entry.messageId = msg.message_id || "";
        const rawText = extractRawText(msg);
        const cleaned = rawText ? sanitizeForwardText(rawText) : "";

        // ── Feishu text ──
        if (sendFeishu && route.feishuWebhookUrl && cleaned) {
          const card = {
            title: `KOL转发｜${route.authorName}`,
            content: cleaned,
            channel: msg.channel_name || "",
          };
          const r = await postToFeishuWithFallback(route, card);
          entry.feishuText = r.ok ? (r.usedFallback ? "fallback" : "ok") : "failed";
        } else if (sendFeishu && !route.feishuWebhookUrl) {
          entry.feishuText = "no webhook";
        } else if (sendFeishu && !cleaned) {
          entry.feishuText = "no text";
        }

        // ── Feishu images ──
        if (sendFeishu && route.feishuWebhookUrl && msg.attachments?.length) {
          const imgOut = [];
          for (const att of msg.attachments) {
            const imageUrl = buildImageUrl(att);
            if (!imageUrl) {
              imgOut.push("no-url");
              continue;
            }
            const r = await forwardImageToFeishuWithFallback(route, imageUrl);
            imgOut.push(r.ok ? (r.usedFallback ? "fallback" : "native") : "failed");
          }
          entry.feishuImage = imgOut.join(", ");
        } else if (sendFeishu && !msg.attachments?.length) {
          entry.feishuImage = "no attachments";
        }

        // ── Discord text ──
        if (sendDiscord && route.discordWebhookUrl && cleaned) {
          const content = `**【KOL转发测试｜${route.authorName}】**\n\n${cleaned}`;
          const ok = await postToDiscord(route.discordWebhookUrl, content);
          entry.discordText = ok ? "ok" : "failed";
        } else if (sendDiscord && !route.discordWebhookUrl) {
          entry.discordText = "no webhook";
        }

        // ── Discord images ──
        if (sendDiscord && route.discordWebhookUrl && msg.attachments?.length) {
          const imgOut = [];
          for (const att of msg.attachments) {
            const imageUrl = buildImageUrl(att);
            if (!imageUrl) {
              imgOut.push("no-url");
              continue;
            }
            const ok = await forwardImageToDiscord(route.discordWebhookUrl, imageUrl);
            imgOut.push(ok ? "ok" : "failed");
          }
          entry.discordImage = imgOut.join(", ");
        }
      } catch (e) {
        entry.error = e.message;
      }

      results.push(entry);
    }

    return { ok: true, results };
  }
}

// ── quick test CLI ────────────────────────────────────────

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const scraper = new KolScraper({ routes: config.kol?.routes || [] });

  if (!scraper.activeRoutes.length) {
    console.log("[kol:test] No active KOL routes (check webhook URLs)");
    console.log("[kol:test] Available routes:");
    for (const r of config.kol?.routes || []) {
      console.log(`  ${r.authorName}: discord=${Boolean(r.discordWebhookUrl)} feishu=${Boolean(r.feishuWebhookUrl)}`);
    }
    process.exit(0);
  }

  console.log(`[kol:test] Active routes: ${scraper.activeRoutes.map((r) => r.authorName).join(", ")}`);
  console.log("[kol:test] Fetching signals via polling...");

  const signals = [];
  for (const route of scraper.activeRoutes) {
    const messages = await fetchChannelMessages(route.kolChannelId, 5);
    signals.push(...messages.map((message) => ({ ...message, _route: route })));
  }
  console.log(`[kol:test] Fetched ${signals.length} signals:`);
  for (const s of signals) {
    const route = s._route || findKOLRouteForMessage(s, scraper.activeRoutes);
    console.log(`  [${route?.authorName || s.author_name || "unknown"}] ${String(extractRawText(s)).slice(0, 60)} → route:${route?.authorName || "none"}`);
  }

  if (process.argv.includes("--dry") && signals.length) {
    console.log("\n--- Discord preview ---");
    for (const s of signals) {
      const route = s._route || findKOLRouteForMessage(s, scraper.activeRoutes);
      if (route) {
        console.log(formatDiscordSignal(s, route.authorName));
        console.log("---");
      }
    }
  }

  process.exit(0);
}
