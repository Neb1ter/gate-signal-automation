import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const envFilePath = path.join(projectRoot, ".env");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function parseCsv(value) {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseInteger(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

loadEnvFile(envFilePath);

const dataDir = path.resolve(projectRoot, process.env.DATA_DIR || "./data");
const mediaDir = path.resolve(dataDir, process.env.MEDIA_DIR || "./media");
const telegramUserSessionFile = path.resolve(
  projectRoot,
  process.env.TELEGRAM_USER_SESSION_FILE || "./data/telegram-user-session.txt",
);
const telegramSourceMode = ["user", "bot"].includes(
  String(process.env.TELEGRAM_SOURCE_MODE || "").toLowerCase(),
)
  ? String(process.env.TELEGRAM_SOURCE_MODE || "").toLowerCase()
  : "bot";

export const config = {
  projectRoot,
  host: process.env.HOST || "0.0.0.0",
  port: parseInteger(process.env.PORT, 8787),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || "",
  approvalSigningSecret: process.env.APPROVAL_SIGNING_SECRET || "replace-me",
  adminAccessToken: (process.env.ADMIN_ACCESS_TOKEN || "").trim(),
  playbooksFile: path.resolve(
    projectRoot,
    process.env.PLAYBOOKS_FILE || "./config/playbooks.example.json",
  ),
  dataDir,
  mediaDir,
  dedupWindowSec: parseInteger(process.env.DEDUP_WINDOW_SEC, 1800),
  analystThreadCollectMs: parseInteger(process.env.ANALYST_THREAD_COLLECT_MS, 12000),
  mediaRetentionDays: parseInteger(process.env.MEDIA_RETENTION_DAYS, 7),
  telegram: {
    sourceMode: telegramSourceMode,
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    mode: process.env.TELEGRAM_MODE || "polling",
    apiId: process.env.TELEGRAM_API_ID || "",
    apiHash: process.env.TELEGRAM_API_HASH || "",
    userSession: process.env.TELEGRAM_USER_SESSION || "",
    userSessionFile: telegramUserSessionFile,
    allowedChatIds: parseCsv(process.env.TELEGRAM_ALLOWED_CHAT_IDS),
    analystChatIds: parseCsv(process.env.TELEGRAM_ANALYST_CHAT_IDS),
    newsChatIds: parseCsv(process.env.TELEGRAM_NEWS_CHAT_IDS),
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "",
    pollTimeoutSec: parseInteger(process.env.TELEGRAM_POLL_TIMEOUT_SEC, 20),
    connectionRetries: parseInteger(process.env.TELEGRAM_CONNECTION_RETRIES, 5),
  },
  feishu: {
    webhookUrl: process.env.FEISHU_WEBHOOK_URL || "",
    appId: process.env.FEISHU_APP_ID || "",
    appSecret: process.env.FEISHU_APP_SECRET || "",
  },
  discord: {
    webhookUrl: process.env.DISCORD_WEBHOOK_URL || "",
    newsWebhookUrl: process.env.DISCORD_NEWS_WEBHOOK_URL || "",
    kolWebhookUrl: process.env.DISCORD_KOL_WEBHOOK_URL || "",
    priceWebhookUrl: process.env.DISCORD_PRICE_WEBHOOK_URL || "",
  },
  kol: {
    email: process.env.KOL_EMAIL || "",
    password: process.env.KOL_PASSWORD || "",
    // Fallback removed — each KOL only forwards to their own group.
    feishuFallbackWebhookUrl: "",
    feishuFallbackSignSecret: "",
    routes: [
      {
        authorName: "舒琴",
        kolChannelId: "1444962376066793513",
        feishuWebhookUrl: process.env.KOL_SHUQIN_FEISHU_WEBHOOK_URL || "",
        feishuSignSecret: process.env.KOL_SHUQIN_FEISHU_SIGN_SECRET || "",
        discordWebhookUrl: process.env.KOL_SHUQIN_DISCORD_WEBHOOK_URL || "",
      },
      {
        authorName: "陈哥",
        kolChannelId: "1444964071979089990",
        feishuWebhookUrl: process.env.KOL_CHENGE_FEISHU_WEBHOOK_URL || "",
        feishuSignSecret: process.env.KOL_CHENGE_FEISHU_SIGN_SECRET || "",
        feishuChatId: process.env.KOL_CHENGE_FEISHU_CHAT_ID || "",
        discordWebhookUrl: process.env.KOL_CHENGE_DISCORD_WEBHOOK_URL || "",
      },
      {
        authorName: "峰哥",
        kolChannelId: "1444963929393729686",
        feishuWebhookUrl: process.env.KOL_FENGGE_FEISHU_WEBHOOK_URL || "",
        feishuSignSecret: process.env.KOL_FENGGE_FEISHU_SIGN_SECRET || "",
        feishuChatId: process.env.KOL_FENGGE_FEISHU_CHAT_ID || "",
        discordWebhookUrl: process.env.KOL_FENGGE_DISCORD_WEBHOOK_URL || "",
      },
      {
        authorName: "提阿非罗",
        kolChannelId: "1320436859477819433",
        feishuWebhookUrl: process.env.KOL_TIAFEILUO_FEISHU_WEBHOOK_URL || "",
        feishuSignSecret: process.env.KOL_TIAFEILUO_FEISHU_SIGN_SECRET || "",
        feishuChatId: process.env.KOL_TIAFEILUO_FEISHU_CHAT_ID || "",
        discordWebhookUrl: process.env.KOL_TIAFEILUO_DISCORD_WEBHOOK_URL || "",
      },
      {
        authorName: "大镖客",
        kolChannelId: "1444962339743989843",
        feishuWebhookUrl: process.env.KOL_DABIAOKE_FEISHU_WEBHOOK_URL || "",
        feishuSignSecret: process.env.KOL_DABIAOKE_FEISHU_SIGN_SECRET || "",
        feishuChatId: process.env.KOL_DABIAOKE_FEISHU_CHAT_ID || "",
        discordWebhookUrl: process.env.KOL_DABIAOKE_DISCORD_WEBHOOK_URL || "",
      },
      {
        authorName: "零下二度",
        kolChannelId: "1418888601340481607",
        feishuWebhookUrl: process.env.KOL_LINGXIAERDU_FEISHU_WEBHOOK_URL || "",
        feishuSignSecret: process.env.KOL_LINGXIAERDU_FEISHU_SIGN_SECRET || "",
        feishuChatId: process.env.KOL_LINGXIAERDU_FEISHU_CHAT_ID || "",
        discordWebhookUrl:
          process.env.KOL_LINGXIAERDU_DISCORD_WEBHOOK_URL ||
          process.env.DISCORD_KOL_WEBHOOK_URL ||
          "",
      },
      {
        authorName: "飞扬vip",
        kolChannelId: "1444962410002911396",
        feishuWebhookUrl: process.env.KOL_FEIYANGVIP_FEISHU_WEBHOOK_URL || "",
        feishuSignSecret: process.env.KOL_FEIYANGVIP_FEISHU_SIGN_SECRET || "",
        feishuChatId: process.env.KOL_FEIYANGVIP_FEISHU_CHAT_ID || "",
        discordWebhookUrl:
          process.env.KOL_FEIYANGVIP_DISCORD_WEBHOOK_URL ||
          process.env.DISCORD_KOL_WEBHOOK_URL ||
          "",
      },
      {
        authorName: "相-金属会员群",
        kolChannelId: "1464406516282167448",
        feishuWebhookUrl: process.env.KOL_XIANG_METALS_FEISHU_WEBHOOK_URL || "",
        feishuSignSecret: process.env.KOL_XIANG_METALS_FEISHU_SIGN_SECRET || "",
        feishuChatId: process.env.KOL_XIANG_METALS_FEISHU_CHAT_ID || "",
        discordWebhookUrl:
          process.env.KOL_XIANG_METALS_DISCORD_WEBHOOK_URL ||
          process.env.DISCORD_KOL_WEBHOOK_URL ||
          "",
      },
    ],
  },
};

export function ensureRuntimeDirs() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.mediaDir, { recursive: true });
}

export function loadPlaybooks() {
  const raw = fs.readFileSync(config.playbooksFile, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("PLAYBOOKS_FILE must contain a JSON array");
  }
  return parsed;
}
