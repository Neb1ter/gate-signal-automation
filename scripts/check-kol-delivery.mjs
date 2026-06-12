import crypto from "node:crypto";
import https from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { config } from "../src/config.mjs";

const shouldSend = process.argv.includes("--send");
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const proxyAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : null;

function signFeishuPayload(payload, signSecret = "") {
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
  const parsed = new URL(url);

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: "POST",
        agent: proxyAgent,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 15_000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            body: text,
          });
        });
      },
    );
    req.on("error", (error) => resolve({ ok: false, status: 0, body: error.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, status: 0, body: "timeout" });
    });
    req.write(body);
    req.end();
  });
}

function maskUrl(url) {
  const value = String(url || "");
  if (!value) return "";
  return `${value.slice(0, 36)}...`;
}

const missing = [];
if (!config.kol.email) missing.push("KOL_EMAIL");
if (!config.kol.password) missing.push("KOL_PASSWORD");

for (const route of config.kol.routes) {
  if (!route.discordWebhookUrl) missing.push(`${route.authorName}: Discord webhook`);
  if (!route.feishuWebhookUrl) missing.push(`${route.authorName}: Feishu webhook`);
}

console.log("KOL delivery configuration");
console.log(`Routes: ${config.kol.routes.length}`);
console.log(`Feishu images: ${config.feishu.appId && config.feishu.appSecret ? "native upload" : "link fallback"}`);
console.log(`Feishu fallback: ${config.kol.feishuFallbackWebhookUrl ? maskUrl(config.kol.feishuFallbackWebhookUrl) : "missing"}`);

for (const route of config.kol.routes) {
  console.log(
    `- ${route.authorName}: discord=${route.discordWebhookUrl ? maskUrl(route.discordWebhookUrl) : "missing"} feishu=${route.feishuWebhookUrl ? maskUrl(route.feishuWebhookUrl) : "missing"} feishuSign=${route.feishuSignSecret ? "configured" : "none"}`,
  );
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

let failed = 0;
for (const route of config.kol.routes) {
  const text = `KOL delivery test | ${route.authorName}`;
  if (route.discordWebhookUrl) {
    const resp = await postJson(route.discordWebhookUrl, {
      content: `**【KOL转发测试｜${route.authorName}】**\n\n${text}`,
      allowed_mentions: { parse: [] },
    });
    console.log(`Discord ${route.authorName}: ${resp.ok ? "ok" : `failed ${resp.status}`}`);
    if (!resp.ok) failed++;
  }

  if (route.feishuWebhookUrl) {
    const payload = {
      msg_type: "text",
      content: { text },
    };
    const resp = await postJson(
      route.feishuWebhookUrl,
      signFeishuPayload(payload, route.feishuSignSecret),
    );
    const primary = parseFeishuResponse(resp);
    let accepted = primary.accepted;
    let msg = primary.msg;
    let usedFallback = false;

    if (!accepted && config.kol.feishuFallbackWebhookUrl) {
      const fallbackText = `[主飞书群发送失败，已转入备用]\n${text}`;
      const fallbackResp = await postJson(
        config.kol.feishuFallbackWebhookUrl,
        signFeishuPayload(
          {
            msg_type: "text",
            content: { text: fallbackText },
          },
          config.kol.feishuFallbackSignSecret,
        ),
      );
      const fallback = parseFeishuResponse(fallbackResp);
      accepted = fallback.accepted;
      usedFallback = fallback.accepted;
      msg = fallback.accepted ? `fallback ok after primary error: ${msg}` : `${msg}; fallback: ${fallback.msg}`;
    }

    console.log(
      `Feishu ${route.authorName}: ${accepted ? (usedFallback ? "fallback ok" : "ok") : `failed ${resp.status}${msg ? ` ${msg}` : ""}`}`,
    );
    if (!accepted) failed++;
  }
}

if (failed) {
  process.exitCode = 1;
  console.error(`\nDelivery test failed: ${failed} target(s)`);
} else {
  console.log("\nDelivery test passed.");
}

function parseFeishuResponse(resp) {
  let accepted = resp.ok;
  let msg = "";
  if (resp.body) {
    try {
      const json = JSON.parse(resp.body || "{}");
      accepted = accepted && json.code === 0;
      msg = json.msg || "";
    } catch {
      accepted = false;
      msg = "invalid JSON response";
    }
  }
  return { accepted, msg };
}
