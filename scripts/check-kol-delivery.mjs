// -*- coding: utf-8 -*-
// KOL delivery check — text + Feishu native image test
// Usage:
//   node scripts/check-kol-delivery.mjs                          # config only
//   node scripts/check-kol-delivery.mjs --send --skip=舒琴 --image
//   node scripts/check-kol-delivery.mjs --send --only=陈哥,峰哥,大镖客 --image

import crypto from "node:crypto";
import https from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { config } from "../src/config.mjs";

const shouldSend = process.argv.includes("--send");
const testImages = process.argv.includes("--image");
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const proxyAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : "";

// ── Filter helpers ────────────────────────────────────────
const onlyArg = process.argv.find(a => a.startsWith("--only="));
const skipArg = process.argv.find(a => a.startsWith("--skip="));
const onlySet = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",").map(s => s.trim()).filter(Boolean)) : null;
const skipSet = skipArg ? new Set(skipArg.slice("--skip=".length).split(",").map(s => s.trim()).filter(Boolean)) : new Set();

function shouldTest(route) {
  if (onlySet) return onlySet.has(route.authorName);
  if (skipSet.size) return !skipSet.has(route.authorName);
  return true;
}

function canUpload() {
  return Boolean(config.feishu.appId && config.feishu.appSecret);
}

const fallbackDisabled = skipSet.has("舒琴") && (config.kol.feishuFallbackWebhookUrl || "").includes("0b103705");
const effectiveFallback = fallbackDisabled ? "" : config.kol.feishuFallbackWebhookUrl;

// ── HTTP ──────────────────────────────────────────────────
function signPayload(payload, signSecret = "") {
  const secret = String(signSecret || "").trim();
  if (!secret) return payload;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const stringToSign = `${timestamp}\n${secret}`;
  const sign = crypto.createHmac("sha256", stringToSign).update("").digest("base64");
  return { ...payload, timestamp, sign };
}

async function postJson(url, payload) {
  if (!url) return { ok: false, status: 0, body: "missing url" };
  const body = JSON.stringify(payload);
  const u = new URL(url);
  return new Promise(resolve => {
    const req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search,
      method: "POST", agent: proxyAgent,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 15000,
    }, res => {
      const chunks = []; res.on("data", c => chunks.push(Buffer.from(c)));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: text });
      });
    });
    req.on("error", e => resolve({ ok: false, status: 0, body: e.message }));
    req.end(body);
  });
}

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search,
      method: "GET", agent: proxyAgent,
      headers: { Accept: "image/*,*/*;q=0.8" },
      timeout: 15000,
    }, res => {
      const chunks = []; res.on("data", c => chunks.push(Buffer.from(c)));
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`download failed: ${res.statusCode}`));
          return;
        }
        resolve({
          buffer: Buffer.concat(chunks),
          mimeType: res.headers["content-type"] || "image/jpeg",
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function parseFeishu(resp) {
  let ok = resp.ok, msg = "";
  if (resp.body) {
    try { const j = JSON.parse(resp.body); ok = ok && j.code === 0; msg = j.msg || ""; }
    catch { ok = false; msg = "invalid JSON"; }
  }
  return { ok, msg };
}

function maskUrl(url) {
  const s = String(url || "");
  return s ? `${s.slice(0, 36)}...` : "";
}

// ── Config check ──────────────────────────────────────────
const missing = [];
if (!config.kol.email) missing.push("KOL_EMAIL");
if (!config.kol.password) missing.push("KOL_PASSWORD");

const routes = config.kol.routes.filter(shouldTest);
for (const route of routes) {
  if (!route.discordWebhookUrl) missing.push(`${route.authorName}: Discord webhook`);
  if (!route.feishuWebhookUrl) missing.push(`${route.authorName}: Feishu webhook`);
}

if (testImages && !canUpload()) {
  console.error("FEISHU_APP_SECRET missing, native Feishu image upload unavailable");
  process.exit(1);
}

console.log("KOL delivery configuration");
console.log(`Routes: ${routes.length} (of ${config.kol.routes.length} total)`);
console.log(`Feishu images: ${canUpload() ? "native upload" : "link fallback"}`);
console.log(`Feishu fallback: ${effectiveFallback ? maskUrl(effectiveFallback) : (fallbackDisabled ? "disabled (舒琴 protected)" : "disabled")}`);
for (const route of routes) {
  console.log(`- ${route.authorName}: discord=${route.discordWebhookUrl ? maskUrl(route.discordWebhookUrl) : "missing"} feishu=${route.feishuWebhookUrl ? maskUrl(route.feishuWebhookUrl) : "missing"} feishuSign=${route.feishuSignSecret ? "configured" : "none"}`);
}

if (missing.length) {
  console.error("\nMissing required configuration:");
  for (const item of missing) console.error(`- ${item}`);
  process.exitCode = 1;
  if (!shouldSend) process.exit();
}

if (!shouldSend) {
  console.log("\nConfig check only. Re-run with --send to post real test messages.");
  process.exit();
}

if (fallbackDisabled) {
  console.log("\n⚠️  Feishu fallback disabled (舒琴 protected)");
}

// ── Send tests ────────────────────────────────────────────
let failed = 0;
const TEST_IMG = "https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png";

for (const route of routes) {
  const text = `KOL delivery test | ${route.authorName}`;

  // Discord
  if (route.discordWebhookUrl) {
    const r = await postJson(route.discordWebhookUrl, {
      content: `**【KOL转发测试｜${route.authorName}】**\n\n${text}`,
      allowed_mentions: { parse: [] },
    });
    console.log(`Discord ${route.authorName}: ${r.ok ? "ok" : `failed ${r.status}`}`);
    if (!r.ok) failed++;
  }

  // Feishu text
  if (route.feishuWebhookUrl) {
    const p = signPayload({ msg_type: "text", content: { text } }, route.feishuSignSecret);
    const r = await postJson(route.feishuWebhookUrl, p);
    const { ok, msg } = parseFeishu(r);
    let fOk = ok, fMsg = ok ? "ok" : `failed ${r.status}${msg ? ` ${msg}` : ""}`, fb = false;
    if (!ok && effectiveFallback) {
      const fp = signPayload({ msg_type: "text", content: { text: `[主群失败] ${text}` } }, config.kol.feishuFallbackSignSecret);
      const fr = await postJson(effectiveFallback, fp);
      const fbr = parseFeishu(fr);
      fOk = fbr.ok; fb = fbr.ok; fMsg = fbr.ok ? "fallback ok" : `failed both`;
    }
    console.log(`Feishu text ${route.authorName}: ${fOk ? (fb ? "fallback ok" : "ok") : fMsg}`);
    if (!fOk) failed++;
  }

  // Feishu native image
  if (testImages && route.feishuWebhookUrl) {
    try {
      // Download test image via https module (proxy-aware)
      const { buffer: buf, mimeType: mime } = await downloadImage(TEST_IMG);

      // Get Feishu tenant token
      const tokenResp = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: config.feishu.appId, app_secret: config.feishu.appSecret }),
      });
      const tokenData = await tokenResp.json();
      const token = tokenData.tenant_access_token;
      if (!token) throw new Error("tenant token failed");

      // Upload to Feishu
      const form = new FormData();
      form.append("image_type", "message");
      form.append("image", new Blob([buf], { type: mime }), `test.${mime.split("/").pop() || "jpg"}`);
      const upResp = await fetch("https://open.feishu.cn/open-apis/im/v1/images", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const upData = await upResp.json();
      const imageKey = upData?.data?.image_key || "";
      if (!imageKey) throw new Error(`upload failed: ${upData?.msg || upResp.status}`);

      // Send as native image
      const imgPayload = signPayload({ msg_type: "image", content: { image_key: imageKey } }, route.feishuSignSecret);
      const imgResp2 = await postJson(route.feishuWebhookUrl, imgPayload);
      const imgResult = parseFeishu(imgResp2);
      let imgOk = imgResult.ok, imgMsg = imgResult.ok ? "ok" : `failed ${imgResp2.status}${imgResult.msg ? ` ${imgResult.msg}` : ""}`, imgFb = false;

      if (!imgOk && effectiveFallback) {
        const fbPayload = signPayload({ msg_type: "image", content: { image_key: imageKey } }, config.kol.feishuFallbackSignSecret);
        const fbResp = await postJson(effectiveFallback, fbPayload);
        const fbResult = parseFeishu(fbResp);
        imgOk = fbResult.ok; imgFb = fbResult.ok;
        imgMsg = fbResult.ok ? "fallback ok" : "failed both";
      }

      console.log(`Feishu image ${route.authorName}: ${imgOk ? (imgFb ? "fallback ok" : "ok") : imgMsg}`);
      if (!imgOk) failed++;
    } catch (e) {
      console.log(`Feishu image ${route.authorName}: error ${e.message}`);
      failed++;
    }
  }
}

if (failed) {
  process.exitCode = 1;
  console.error(`\nDelivery test failed: ${failed} target(s)`);
} else {
  console.log("\nDelivery test passed.");
}
