import fs from "node:fs";
import path from "node:path";

function normalizeIdList(value) {
  return [...new Set((value || []).map((item) => String(item).trim()).filter(Boolean))];
}

function normalizeAnalystRoutes(value) {
  const routes = Array.isArray(value) ? value : [];
  const normalized = [];
  const seen = new Set();

  for (const item of routes) {
    const chatId = String(item?.chatId || "").trim();
    if (!chatId || seen.has(chatId)) {
      continue;
    }

    normalized.push({
      chatId,
      webhookUrl: String(item?.webhookUrl || "").trim(),
      displayName: String(item?.displayName || "").trim(),
    });
    seen.add(chatId);
  }

  return normalized;
}

function normalizeSymbolList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean))];
  }
  return [...new Set(String(value || "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean))];
}

function normalizeAnalystConfigs(value) {
  const configs = Array.isArray(value) ? value : [];
  const normalized = [];
  const seen = new Set();

  for (const item of configs) {
    const chatId = String(item?.chatId || "").trim();
    if (!chatId || seen.has(chatId)) {
      continue;
    }

    normalized.push({
      chatId,
      enabled: item?.enabled !== false,
      amountQuote: String(item?.amountQuote || "").trim() || "100",
      allowedSymbols: normalizeSymbolList(item?.allowedSymbols),
    });
    seen.add(chatId);
  }

  return normalized;
}

function normalizeAiSettings(value, defaults = {}) {
  const source = value || {};
  return {
    enabled: source.enabled === undefined ? Boolean(defaults.enabled) : Boolean(source.enabled),
    provider: String(source.provider ?? defaults.provider ?? "dashscope").trim() || "dashscope",
    apiKey: String(source.apiKey ?? defaults.apiKey ?? "").trim(),
    baseUrl:
      String(
        source.baseUrl ??
          defaults.baseUrl ??
          "https://dashscope.aliyuncs.com/compatible-mode/v1",
      ).trim() || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    primaryModel:
      String(source.primaryModel ?? source.model ?? defaults.primaryModel ?? defaults.model ?? "")
        .trim() || "qwen3.5-plus",
    reviewModel:
      String(source.reviewModel ?? defaults.reviewModel ?? "").trim() || "deepseek-v3.2",
    reviewEnabled:
      source.reviewEnabled === undefined
        ? defaults.reviewEnabled !== false
        : Boolean(source.reviewEnabled),
    timeoutMs: Number(source.timeoutMs ?? defaults.timeoutMs ?? 30000) || 30000,
  };
}

function normalizeGateSettings(value, defaults = {}) {
  const source = value || {};
  const rawMode = String(source.mode ?? defaults.mode ?? "dry_run").trim();
  const mode = rawMode === "testnet" ? "futures_testnet" : rawMode;
  return {
    mode: ["dry_run", "spot_testnet", "futures_testnet"].includes(mode) ? mode : "dry_run",
    apiKey: String(source.apiKey ?? defaults.apiKey ?? "").trim(),
    apiSecret: String(source.apiSecret ?? defaults.apiSecret ?? "").trim(),
    baseUrl: String(source.baseUrl ?? defaults.baseUrl ?? "").trim(),
  };
}

export class JsonStore {
  constructor(dataDir) {
    this.filePath = path.join(dataDir, "state.json");
    this.state = this.#load();
  }

  #emptyState() {
    return {
      telegramOffset: 0,
      signals: [],
      trades: [],
      runtimeSettings: {},
      knownTelegramChats: [],
      recentAnalystMessages: {},
    };
  }

  #load() {
    if (!fs.existsSync(this.filePath)) {
      return this.#emptyState();
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return {
        ...this.#emptyState(),
        ...parsed,
      };
    } catch {
      return this.#emptyState();
    }
  }

  #defaultRuntimeSettings(defaults = {}) {
    return {
      telegram: {
        allowedChatIds: normalizeIdList(defaults.telegram?.allowedChatIds),
        analystChatIds: normalizeIdList(defaults.telegram?.analystChatIds),
        newsChatIds: normalizeIdList(defaults.telegram?.newsChatIds),
      },
      feishu: {
        analystRoutes: normalizeAnalystRoutes(defaults.feishu?.analystRoutes),
      },
      analysts: {
        configs: normalizeAnalystConfigs(defaults.analysts?.configs),
      },
      execution: {
        newsMode: defaults.execution?.newsMode === "manual" ? "manual" : "auto",
      },
      ai: normalizeAiSettings(defaults.ai, defaults.ai),
      gate: normalizeGateSettings(defaults.gate, defaults.gate),
    };
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  getTelegramOffset() {
    return this.state.telegramOffset || 0;
  }

  setTelegramOffset(offset) {
    this.state.telegramOffset = offset;
    this.save();
  }

  getRuntimeSettings(defaults = {}) {
    const fallback = this.#defaultRuntimeSettings(defaults);
    const savedTelegram = this.state.runtimeSettings?.telegram;

    if (!savedTelegram) {
      return fallback;
    }

    return {
      telegram: {
        allowedChatIds: normalizeIdList(savedTelegram.allowedChatIds),
        analystChatIds: normalizeIdList(savedTelegram.analystChatIds),
        newsChatIds: normalizeIdList(savedTelegram.newsChatIds),
      },
      feishu: {
        analystRoutes: normalizeAnalystRoutes(this.state.runtimeSettings?.feishu?.analystRoutes),
      },
      analysts: {
        configs: normalizeAnalystConfigs(this.state.runtimeSettings?.analysts?.configs),
      },
      execution: {
        newsMode:
          this.state.runtimeSettings?.execution?.newsMode === "manual" ? "manual" : "auto",
      },
      ai: normalizeAiSettings(this.state.runtimeSettings?.ai, fallback.ai),
      gate: normalizeGateSettings(this.state.runtimeSettings?.gate, fallback.gate),
    };
  }

  saveRuntimeSettings(nextSettings, defaults = {}) {
    const current = this.getRuntimeSettings(defaults);
    const nextTelegram = nextSettings?.telegram || {};
    const nextFeishu = nextSettings?.feishu || {};
    const nextAnalysts = nextSettings?.analysts || {};
    const nextAi = nextSettings?.ai || {};
    const nextGate = nextSettings?.gate || {};

    this.state.runtimeSettings = {
      telegram: {
        allowedChatIds: normalizeIdList(
          nextTelegram.allowedChatIds ?? current.telegram.allowedChatIds,
        ),
        analystChatIds: normalizeIdList(
          nextTelegram.analystChatIds ?? current.telegram.analystChatIds,
        ),
        newsChatIds: normalizeIdList(nextTelegram.newsChatIds ?? current.telegram.newsChatIds),
      },
      feishu: {
        analystRoutes: normalizeAnalystRoutes(
          nextFeishu.analystRoutes ?? current.feishu.analystRoutes,
        ),
      },
      analysts: {
        configs: normalizeAnalystConfigs(nextAnalysts.configs ?? current.analysts.configs),
      },
      execution: {
        newsMode: nextSettings?.execution?.newsMode === "manual" ? "manual" : "auto",
      },
      ai: normalizeAiSettings(nextAi, current.ai),
      gate: normalizeGateSettings(nextGate, current.gate),
    };

    this.save();
    return this.getRuntimeSettings(defaults);
  }

  listKnownTelegramChats() {
    return [...this.state.knownTelegramChats].sort((a, b) => {
      return String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || ""));
    });
  }

  recordTelegramChat(message) {
    const chat = message?.chat;
    if (!chat?.id) {
      return null;
    }

    const nextRecord = {
      id: String(chat.id),
      title: chat.title || chat.username || String(chat.id),
      username: chat.username || "",
      type: chat.type || "",
      lastSeenAt: new Date(
        (message.date || message.edit_date || Math.floor(Date.now() / 1000)) * 1000,
      ).toISOString(),
      lastText: String(message.text || message.caption || "").slice(0, 240),
    };

    const index = this.state.knownTelegramChats.findIndex((item) => item.id === nextRecord.id);
    if (index >= 0) {
      this.state.knownTelegramChats[index] = {
        ...this.state.knownTelegramChats[index],
        ...nextRecord,
      };
    } else {
      this.state.knownTelegramChats.push(nextRecord);
    }

    this.save();
    return nextRecord;
  }

  getRecentAnalystMessages(chatId, { limit = 6, windowMinutes = 180 } = {}) {
    const id = String(chatId || "").trim();
    if (!id) {
      return [];
    }

    const records = Array.isArray(this.state.recentAnalystMessages?.[id])
      ? this.state.recentAnalystMessages[id]
      : [];
    const cutoff = Date.now() - windowMinutes * 60 * 1000;

    return records
      .filter((item) => {
        const timestamp = Date.parse(item?.publishedAt || "");
        return Number.isFinite(timestamp) && timestamp >= cutoff && String(item?.text || "").trim();
      })
      .sort((a, b) => String(a.publishedAt || "").localeCompare(String(b.publishedAt || "")))
      .slice(-limit);
  }

  appendRecentAnalystMessage(chatId, message, { limit = 12 } = {}) {
    const id = String(chatId || "").trim();
    const text = String(message?.text || "").trim();
    if (!id || !text) {
      return [];
    }

    const publishedAt = String(message?.publishedAt || new Date().toISOString());
    const entry = {
      messageId: String(message?.messageId || ""),
      publishedAt,
      text,
    };

    const current = Array.isArray(this.state.recentAnalystMessages?.[id])
      ? this.state.recentAnalystMessages[id]
      : [];

    const next = [...current, entry]
      .sort((a, b) => String(a.publishedAt || "").localeCompare(String(b.publishedAt || "")))
      .slice(-limit);

    this.state.recentAnalystMessages[id] = next;
    this.save();
    return next;
  }

  listSignals() {
    return [...this.state.signals].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getSignal(id) {
    return this.state.signals.find((signal) => signal.id === id) || null;
  }

  findRecentDuplicate(hash, windowSec) {
    const cutoff = Date.now() - windowSec * 1000;
    return (
      this.state.signals.find((signal) => {
        return signal.normalizedHash === hash && Date.parse(signal.createdAt) >= cutoff;
      }) || null
    );
  }

  upsertSignal(signal) {
    const index = this.state.signals.findIndex((item) => item.id === signal.id);
    if (index >= 0) {
      this.state.signals[index] = signal;
    } else {
      this.state.signals.push(signal);
    }
    this.save();
  }

  appendTrade(trade) {
    this.state.trades.push(trade);
    this.save();
  }

  listTrades() {
    return [...this.state.trades].sort((a, b) =>
      String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
    );
  }

  listTradesForDatePrefix(datePrefix) {
    return this.state.trades.filter((trade) => trade.createdAt.startsWith(datePrefix));
  }
}
