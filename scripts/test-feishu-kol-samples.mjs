// -*- coding: utf-8 -*-
// 飞书 KOL 转发真实样本测试
//
// 从 kol.lysq.cc 抓取最近几条 KOL 消息，转发到飞书，验证文字+图片显示。
// 不测舒琴。不测 Discord。重点关注飞书原生图片。
//
// Usage:
//   $env:HTTPS_PROXY="http://127.0.0.1:7890"
//   node scripts/test-feishu-kol-samples.mjs --only=陈哥,峰哥,大镖客 --limit=3

import crypto from "node:crypto";
import https from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { config } from "../src/config.mjs";
import { sanitizeForwardText } from "../src/discord.mjs";

// ── Proxy ────────────────────────────────────────────────────
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const proxyAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : null;

// ── CLI args ─────────────────────────────────────────────────
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const skipArg = process.argv.find((a) => a.startsWith("--skip="));
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const onlySet = onlyArg
  ? new Set(
      onlyArg
        .slice("--only=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
  : null;
const skipSet = new Set(["舒琴"]); // 永远排除舒琴
if (skipArg) {
  skipArg
    .slice("--skip=".length)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((s) => skipSet.add(s));
}
const LIMIT = (() => {
  const v = limitArg ? parseInt(limitArg.slice("--limit=".length), 10) : 0;
  return v > 0 && v <= 10 ? v : 3;
})();

function shouldTest(route) {
  if (skipSet.has(route.authorName)) return false;
  if (onlySet) return onlySet.has(route.authorName);
  return true;
}

// ── proxy-aware fetch ────────────────────────────────────────
async function proxyFetch(url, options = {}) {
  if (!proxyAgent || !String(url).startsWith("https://")) {
    return fetch(url, options);
  }

  const parsedUrl = new URL(url);
  const method = (options.method || "GET").toUpperCase();
  const headers = { ...(options.headers || {}) };
  let body = options.body || null;

  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const isURLSearchParams =
    typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams;

  if (body && !isFormData && !isURLSearchParams && typeof body !== "string") {
    body = JSON.stringify(body);
    if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
  }
  if (body && !isFormData && !isURLSearchParams) {
    headers["Content-Length"] = Buffer.byteLength(body);
  }

  // FormData/URLSearchParams → native fetch (used for Feishu upload, no proxy needed)
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
      res.on("data", (chunk) => {
        chunks.push(Buffer.from(chunk));
      });
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
            try {
              return JSON.parse(buffer.toString("utf8"));
            } catch {
              return null;
            }
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

    if (body) req.write(body);
    req.end();
  });
}

// ── Feishu signature ─────────────────────────────────────────
function signFeishuPayload(payload, signSecret = "") {
  const secret = String(signSecret || "").trim();
  if (!secret) return payload;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const stringToSign = `${timestamp}\n${secret}`;
  const sign = crypto.createHmac("sha256", stringToSign).update("").digest("base64");
  return { ...payload, timestamp, sign };
}

async function postFeishuJson(webhookUrl, payload, signSecret = "") {
  if (!webhookUrl) return { ok: false, status: 0, body: "missing url" };
  const signed = signFeishuPayload(payload, signSecret);
  const body = JSON.stringify(signed);

  try {
    const resp = await proxyFetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const text = await resp.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {}
    return {
      ok: resp.ok && (!parsed || parsed.code === 0),
      status: resp.status,
      code: parsed?.code ?? -1,
      msg: parsed?.msg || "",
      raw: text.slice(0, 200),
    };
  } catch (e) {
    return { ok: false, status: 0, code: -1, msg: e.message, raw: "" };
  }
}

// ── kol.lysq.cc ──────────────────────────────────────────────
const API_BASE = "https://kol.lysq.cc/v1/api";
let kolToken = "";
let kolTokenExpiry = 0;

async function loginKol() {
  if (kolToken && Date.now() < kolTokenExpiry) return kolToken;
  const resp = await proxyFetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: config.kol.email, password: config.kol.password }),
  });
  const json = await resp.json();
  kolToken = json?.data?.token || "";
  kolTokenExpiry = Date.now() + 60 * 60 * 1000;
  return kolToken;
}

async function fetchChannelMessages(kolChannelId, limit = 3) {
  if (!kolChannelId) return [];
  const token = await loginKol();
  if (!token) return [];
  const resp = await proxyFetch(
    `${API_BASE}/frontend-messages?limit=${limit}&offset=0&type=all&channel_id=${kolChannelId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!resp.ok) return [];
  const json = await resp.json();
  return json?.messages || [];
}

// ── Feishu image upload ──────────────────────────────────────
let feishuToken = "";
let feishuTokenExpiry = 0;

function canUploadImages() {
  return Boolean(config.feishu.appId && config.feishu.appSecret);
}

async function getFeishuTenantToken() {
  if (feishuToken && Date.now() < feishuTokenExpiry - 60000) return feishuToken;

  const resp = await proxyFetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: config.feishu.appId,
        app_secret: config.feishu.appSecret,
      }),
    },
  );
  const data = await resp.json();
  if (!resp.ok || data?.code !== 0 || !data?.tenant_access_token) {
    throw new Error(`Feishu tenant token failed: ${data?.msg || resp.status}`);
  }
  feishuToken = data.tenant_access_token;
  feishuTokenExpiry = Date.now() + (data.expire || 7200) * 1000;
  return feishuToken;
}

async function uploadFeishuImageFromUrl(imageUrl) {
  // 1. Download image via proxy
  const imgResp = await proxyFetch(imageUrl, {
    headers: { Accept: "image/*,*/*;q=0.8" },
    signal: AbortSignal.timeout(15000),
  });
  if (!imgResp.ok) throw new Error(`download failed: ${imgResp.status}`);

  const arrayBuffer = await imgResp.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const mimeType = (imgResp.headers?.get?.("content-type") || "image/jpeg").split(";")[0];

  // 2. Upload to Feishu
  const token = await getFeishuTenantToken();
  const form = new FormData();
  const ext = mimeType.split("/").pop() || "jpg";
  form.append("image_type", "message");
  form.append("image", new Blob([buffer], { type: mimeType }), `kol-test.${ext}`);

  const upResp = await proxyFetch("https://open.feishu.cn/open-apis/im/v1/images", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const upData = await upResp.json();
  if (!upResp.ok || upData?.code !== 0 || !upData?.data?.image_key) {
    throw new Error(`Feishu upload failed: ${upData?.msg || upResp.status}`);
  }
  return upData.data.image_key;
}

// ── Helpers ──────────────────────────────────────────────────
function extractRawText(msg) {
  if (msg.message_content) return msg.message_content;
  const om = msg.original_message;
  if (om && typeof om === "object" && om.content) return om.content;
  if (typeof om === "string" && om) return om;
  return msg.text || msg.content || msg.raw_text || "";
}

function buildImageUrl(att) {
  const cdnUrl = att.originalUrl || "";
  if (cdnUrl && cdnUrl.includes("cdn.discordapp.com")) {
    return cdnUrl
      .replace(/[?&]ex=[^&]+/g, "")
      .replace(/[?&]is=[^&]+/g, "")
      .replace(/[?&]hm=[^&]+/g, "");
  }
  if (cdnUrl) return cdnUrl;
  const msgId = att.messageId || "";
  const attId = att.attachmentId || "";
  const ext = (att.originalName || "image.png").split(".").pop();
  if (msgId && attId) {
    return `https://kol.lysq.cc/v1/api/files/discord/attachments/${msgId}_${attId}.${ext}`;
  }
  return "";
}

function statusIcon(ok) {
  return ok ? "✅" : "❌";
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

const routes = config.kol.routes.filter(shouldTest);

console.log("═══════════════════════════════════════════════");
console.log("  飞书 KOL 转发 — 真实样本测试");
console.log("═══════════════════════════════════════════════");
console.log(`测试 KOL: ${routes.map((r) => r.authorName).join(" / ")}`);
console.log(`已排除:  舒琴`);
console.log(`每 KOL 取最近 ${LIMIT} 条消息`);
console.log(`Feishu native image: ${canUploadImages() ? "✅ upload 模式" : "❌ link fallback (缺 APP_SECRET)"}`);
console.log("");

if (!routes.length) {
  console.error("❌ 没有可测试的 KOL 路由");
  process.exit(1);
}

// ── Pre-flight checks ────────────────────────────────────────
const missing = [];
if (!config.kol.email) missing.push("KOL_EMAIL");
if (!config.kol.password) missing.push("KOL_PASSWORD");
for (const r of routes) {
  if (!r.feishuWebhookUrl) missing.push(`${r.authorName}: FEISHU_WEBHOOK_URL`);
}
if (missing.length) {
  console.error("❌ 缺少配置:");
  for (const m of missing) console.error(`   - ${m}`);
  process.exit(1);
}

// ── Login ────────────────────────────────────────────────────
console.log("🔑 登录 kol.lysq.cc...");
const token = await loginKol();
if (!token) {
  console.error("❌ 登录失败！检查 KOL_EMAIL / KOL_PASSWORD");
  process.exit(1);
}
console.log("✅ 登录成功\n");

// ── Per-KOL test ─────────────────────────────────────────────
const results = [];

for (const route of routes) {
  const kolResult = {
    name: route.authorName,
    messages: [],
    hasSign: Boolean(route.feishuSignSecret),
  };

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📡 ${route.authorName}`);
  console.log(`   channel: ${route.kolChannelId}`);
  console.log(`   feishu:  ${route.feishuWebhookUrl ? "✅" : "❌"} | sign: ${route.feishuSignSecret ? "✅" : "⚠️ 无"}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const messages = await fetchChannelMessages(route.kolChannelId, LIMIT);
  console.log(`  获取到 ${messages.length} 条消息`);

  if (!messages.length) {
    console.log(`  ⚠️ 无消息可测\n`);
    results.push(kolResult);
    continue;
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const rawText = extractRawText(msg);
    const cleaned = rawText ? sanitizeForwardText(rawText) : "";
    const msgId = msg.message_id || "unknown";
    const attachments = msg.attachments || [];

    const msgResult = {
      messageId: msgId,
      textOk: null,
      textCode: 0,
      textMsg: "",
      images: [],
    };

    console.log(`\n  ── 消息 ${i + 1}/${messages.length} ──`);
    console.log(`  id: ${msgId.slice(0, 24)}...`);
    console.log(`  原文: ${(rawText || "(无文字)").slice(0, 100)}`);
    console.log(`  附件: ${attachments.length} 个`);

    // ── 文字转发 ──
    if (cleaned) {
      const textResult = await postFeishuJson(
        route.feishuWebhookUrl,
        {
          msg_type: "text",
          content: { text: `【KOL转发测试｜${route.authorName}】\n\n${cleaned}` },
        },
        route.feishuSignSecret,
      );
      msgResult.textOk = textResult.ok;
      msgResult.textCode = textResult.code;
      msgResult.textMsg = textResult.msg;
      console.log(
        `  文字 → Feishu: ${statusIcon(textResult.ok)} | code=${textResult.code} ${textResult.msg ? `msg="${textResult.msg}"` : ""}`,
      );
    } else {
      console.log(`  文字 → Feishu: ⏭️ 跳过（无文字）`);
    }

    // ── 图片转发 ──
    for (let j = 0; j < attachments.length; j++) {
      const att = attachments[j];
      const imageUrl = buildImageUrl(att);
      const imgResult = { index: j + 1, url: imageUrl?.slice(0, 60) || "", mode: "", ok: false, code: -1, msg: "" };

      if (!imageUrl) {
        imgResult.mode = "skip";
        imgResult.msg = "无法构建 URL";
        console.log(`  图片 ${j + 1}: ⚠️ 无法构建 URL`);
        msgResult.images.push(imgResult);
        continue;
      }

      if (!canUploadImages()) {
        // 无 APP_SECRET → 显示链接
        console.log(`  图片 ${j + 1}: ⚠️ FEISHU_APP_SECRET 缺失 → link fallback`);
        const linkResult = await postFeishuJson(
          route.feishuWebhookUrl,
          {
            msg_type: "text",
            content: { text: `[KOL转发测试图片｜${route.authorName}]\n${imageUrl}` },
          },
          route.feishuSignSecret,
        );
        imgResult.mode = "link-fallback";
        imgResult.ok = linkResult.ok;
        imgResult.code = linkResult.code;
        imgResult.msg = linkResult.msg;
        console.log(
          `  图片 ${j + 1} link-fallback: ${statusIcon(linkResult.ok)} | code=${linkResult.code} ${linkResult.msg ? `msg="${linkResult.msg}"` : ""}`,
        );
      } else {
        // 原生图片上传
        try {
          const imageKey = await uploadFeishuImageFromUrl(imageUrl);
          const imgSendResult = await postFeishuJson(
            route.feishuWebhookUrl,
            {
              msg_type: "image",
              content: { image_key: imageKey },
            },
            route.feishuSignSecret,
          );
          imgResult.mode = imgSendResult.ok ? "native" : "uploaded-but-send-failed";
          imgResult.ok = imgSendResult.ok;
          imgResult.code = imgSendResult.code;
          imgResult.msg = imgSendResult.msg;
          console.log(
            `  图片 ${j + 1}: ${imgSendResult.ok ? "✅ 原生图片" : "❌ 上传成功但发送失败"} | code=${imgSendResult.code} ${imgSendResult.msg ? `msg="${imgSendResult.msg}"` : ""}`,
          );
        } catch (e) {
          // Upload failed → link fallback
          console.log(`  图片 ${j + 1}: ❌ 上传失败 (${e.message.slice(0, 60)}) → link fallback`);
          const linkResult = await postFeishuJson(
            route.feishuWebhookUrl,
            {
              msg_type: "text",
              content: { text: `[KOL转发测试图片｜${route.authorName}]\n${imageUrl}` },
            },
            route.feishuSignSecret,
          );
          imgResult.mode = "link-fallback";
          imgResult.ok = linkResult.ok;
          imgResult.code = linkResult.code;
          imgResult.msg = linkResult.msg;
          console.log(
            `  图片 ${j + 1} link-fallback: ${statusIcon(linkResult.ok)} | code=${linkResult.code} ${linkResult.msg ? `msg="${linkResult.msg}"` : ""}`,
          );
        }
      }

      msgResult.images.push(imgResult);
      // 图片间限速
      await new Promise((r) => setTimeout(r, 400));
    }

    kolResult.messages.push(msgResult);
    // 消息间限速
    await new Promise((r) => setTimeout(r, 500));
  }

  results.push(kolResult);
  console.log();
}

// ═══════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════
console.log("═══════════════════════════════════════════════");
console.log("  测试汇总");
console.log("═══════════════════════════════════════════════");

let totalText = 0;
let totalTextOk = 0;
let totalImages = 0;
let totalImagesOk = 0;
let totalImagesNative = 0;
let totalImagesFallback = 0;

for (const kr of results) {
  console.log(`\n📊 ${kr.name}:`);
  const textResults = kr.messages.filter((m) => m.textOk !== null);
  const imageResults = kr.messages.flatMap((m) => m.images);

  totalText += textResults.length;
  const textOk = textResults.filter((m) => m.textOk).length;
  totalTextOk += textOk;
  console.log(`   文字: ${textOk}/${textResults.length} ok`);

  totalImages += imageResults.length;
  const imgOk = imageResults.filter((i) => i.ok).length;
  totalImagesOk += imgOk;
  const imgNative = imageResults.filter((i) => i.mode === "native").length;
  totalImagesNative += imgNative;
  const imgFallback = imageResults.filter((i) => i.mode === "link-fallback").length;
  totalImagesFallback += imgFallback;
  console.log(
    `   图片: ${imgOk}/${imageResults.length} ok (native=${imgNative}, fallback=${imgFallback})`,
  );
}

console.log(`\n─────────────────────────────────────────────`);
console.log(`总计: 文字 ${totalTextOk}/${totalText} | 图片 ${totalImagesOk}/${totalImages} (native=${totalImagesNative})`);

const allOk = totalTextOk === totalText && totalImagesOk === totalImages;
if (allOk) {
  console.log("\n✅ 全部通过");
} else {
  console.log("\n⚠️ 存在失败项，详见上方日志");
}

// ── Check 舒琴 was NOT touched ──
const shuqinInResults = results.some((r) => r.name === "舒琴");
if (shuqinInResults) {
  console.error("\n🛑 警告：舒琴出现在测试结果中！");
  process.exitCode = 1;
}

process.exit(0);
