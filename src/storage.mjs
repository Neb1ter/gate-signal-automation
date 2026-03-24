import fs from "node:fs";
import path from "node:path";

function normalizeIdList(value) {
  return [...new Set((value || []).map((item) => String(item).trim()).filter(Boolean))];
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
      execution: {
        newsMode: defaults.execution?.newsMode === "manual" ? "manual" : "auto",
      },
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
      execution: {
        newsMode:
          this.state.runtimeSettings?.execution?.newsMode === "manual" ? "manual" : "auto",
      },
    };
  }

  saveRuntimeSettings(nextSettings, defaults = {}) {
    const current = this.getRuntimeSettings(defaults);
    const nextTelegram = nextSettings?.telegram || {};

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
      execution: {
        newsMode: nextSettings?.execution?.newsMode === "manual" ? "manual" : "auto",
      },
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

  listTradesForDatePrefix(datePrefix) {
    return this.state.trades.filter((trade) => trade.createdAt.startsWith(datePrefix));
  }
}
