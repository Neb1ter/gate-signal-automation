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

export const config = {
  projectRoot,
  host: process.env.HOST || "0.0.0.0",
  port: parseInteger(process.env.PORT, 8787),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  approvalSigningSecret: process.env.APPROVAL_SIGNING_SECRET || "replace-me",
  adminAccessToken: process.env.ADMIN_ACCESS_TOKEN || "",
  dryRun: parseBoolean(process.env.DRY_RUN, true),
  autoExecutionEnabled: parseBoolean(process.env.AUTO_EXECUTION_ENABLED, false),
  playbooksFile: path.resolve(
    projectRoot,
    process.env.PLAYBOOKS_FILE || "./config/playbooks.example.json",
  ),
  dataDir,
  maxDailyTrades: parseInteger(process.env.MAX_DAILY_TRADES, 5),
  maxDailyNotionalUsd: parseInteger(process.env.MAX_DAILY_NOTIONAL_USD, 1000),
  dedupWindowSec: parseInteger(process.env.DEDUP_WINDOW_SEC, 1800),
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    mode: process.env.TELEGRAM_MODE || "polling",
    apiId: process.env.TELEGRAM_API_ID || "",
    apiHash: process.env.TELEGRAM_API_HASH || "",
    allowedChatIds: parseCsv(process.env.TELEGRAM_ALLOWED_CHAT_IDS),
    analystChatIds: parseCsv(process.env.TELEGRAM_ANALYST_CHAT_IDS),
    newsChatIds: parseCsv(process.env.TELEGRAM_NEWS_CHAT_IDS),
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "",
    pollTimeoutSec: parseInteger(process.env.TELEGRAM_POLL_TIMEOUT_SEC, 20),
  },
  feishu: {
    webhookUrl: process.env.FEISHU_WEBHOOK_URL || "",
  },
  gate: {
    apiKey: process.env.GATE_API_KEY || "",
    apiSecret: process.env.GATE_API_SECRET || "",
    baseUrl: process.env.GATE_BASE_URL || "https://api.gateio.ws",
  },
};

export function ensureRuntimeDirs() {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

export function loadPlaybooks() {
  const raw = fs.readFileSync(config.playbooksFile, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("PLAYBOOKS_FILE must contain a JSON array");
  }
  return parsed;
}
