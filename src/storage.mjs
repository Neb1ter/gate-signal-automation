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
      discordWebhookUrl: String(item?.discordWebhookUrl || "").trim(),
      displayName: String(item?.displayName || "").trim(),
    });
    seen.add(chatId);
  }

  return normalized;
}

function normalizeFeishuSettings(value, defaults = {}) {
  const source = value || {};
  return {
    analystRoutes: normalizeAnalystRoutes(source.analystRoutes ?? defaults.analystRoutes),
    generalAnalystSignalWebhookUrl: String(
      source.generalAnalystSignalWebhookUrl ?? defaults.generalAnalystSignalWebhookUrl ?? "",
    ).trim(),
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
      runtimeSettings: {},
      knownTelegramChats: [],
      recentAnalystMessages: {},
      analystThreadNotes: {},
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
        ...normalizeFeishuSettings(defaults.feishu, defaults.feishu),
      },
      execution: {
        newsMode: defaults.execution?.newsMode === "manual" ? "manual" : "auto",
        forwardOnlyMode: true,
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
      feishu: {
        ...normalizeFeishuSettings(this.state.runtimeSettings?.feishu, fallback.feishu),
      },
      execution: {
        newsMode:
          this.state.runtimeSettings?.execution?.newsMode === "manual" ? "manual" : "auto",
        forwardOnlyMode: true,
      },
    };
  }

  saveRuntimeSettings(nextSettings, defaults = {}) {
    const current = this.getRuntimeSettings(defaults);
    const nextTelegram = nextSettings?.telegram || {};
    const nextFeishu = nextSettings?.feishu || {};

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
        ...normalizeFeishuSettings(nextFeishu, current.feishu),
      },
      execution: {
        newsMode: nextSettings?.execution?.newsMode === "manual" ? "manual" : "auto",
        forwardOnlyMode: true,
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

  saveAnalystThreadNote(chatId, note) {
    const id = String(chatId || "").trim();
    if (!id) {
      return null;
    }

    const next = {
      threadId: String(note?.threadId || ""),
      threadMessageCount: Number(note?.threadMessageCount || 0),
      note: String(note?.note || ""),
      updatedAt: String(note?.updatedAt || new Date().toISOString()),
    };

    this.state.analystThreadNotes[id] = next;
    this.save();
    return next;
  }

  getAnalystThreadNote(chatId) {
    const id = String(chatId || "").trim();
    if (!id) {
      return null;
    }
    return this.state.analystThreadNotes?.[id] || null;
  }

  listSignals() {
    return [...this.state.signals].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getSignal(id) {
    return this.state.signals.find((signal) => signal.id === id) || null;
  }

  findLatestSignalByThread(threadId) {
    const id = String(threadId || "").trim();
    if (!id) {
      return null;
    }

    return (
      this.state.signals
        .filter((signal) => String(signal.threadId || "") === id)
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] ||
      null
    );
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

}
