import fs from "node:fs";
import path from "node:path";

import { TelegramClient, utils } from "telegram";
import { NewMessage } from "telegram/events/index.js";
import { StringSession } from "telegram/sessions/index.js";

function buildTelegramApiUrl(botToken, method) {
  return `https://api.telegram.org/bot${botToken}/${method}`;
}

function toUnixSeconds(value) {
  if (!value) {
    return Math.floor(Date.now() / 1000);
  }
  if (typeof value === "number") {
    return Math.floor(value);
  }
  if (value instanceof Date) {
    return Math.floor(value.getTime() / 1000);
  }
  const parsed = Date.parse(String(value));
  if (Number.isFinite(parsed)) {
    return Math.floor(parsed / 1000);
  }
  return Math.floor(Date.now() / 1000);
}

function inferChatType(chatId, chatEntity) {
  if (chatEntity?.megagroup) {
    return "supergroup";
  }
  if (chatEntity?.broadcast) {
    return "channel";
  }
  if (chatEntity?.title) {
    return "group";
  }

  const normalizedId = String(chatId || "");
  if (normalizedId.startsWith("-100")) {
    return "channel";
  }
  if (normalizedId.startsWith("-")) {
    return "group";
  }
  return "private";
}

function getChatTitle(chatId, chatEntity) {
  return (
    chatEntity?.title ||
    chatEntity?.username ||
    [chatEntity?.firstName, chatEntity?.lastName].filter(Boolean).join(" ") ||
    String(chatId)
  );
}

export function loadTelegramUserSession({ userSession = "", userSessionFile = "" } = {}) {
  const inlineSession = String(userSession || "").trim();
  if (inlineSession) {
    return inlineSession;
  }

  const filePath = String(userSessionFile || "").trim();
  if (!filePath || !fs.existsSync(filePath)) {
    return "";
  }

  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

export function saveTelegramUserSession(userSessionFile, sessionString) {
  const filePath = String(userSessionFile || "").trim();
  if (!filePath) {
    return;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${String(sessionString || "").trim()}\n`, "utf8");
}

export async function normalizeTelegramUserMessage(message) {
  const chatId = String(message?.chatId || utils.getPeerId(message?.peerId));
  const chatEntity = await message?.getChat?.().catch(() => null);

  return {
    text: String(message?.message || message?.text || ""),
    caption: "",
    date: toUnixSeconds(message?.date),
    edit_date: message?.editDate ? toUnixSeconds(message.editDate) : undefined,
    chat: {
      id: chatId,
      title: getChatTitle(chatId, chatEntity),
      username: chatEntity?.username || "",
      type: inferChatType(chatId, chatEntity),
    },
  };
}

export class TelegramBotSource {
  constructor({ botToken, pollTimeoutSec, webhookSecret }) {
    this.botToken = botToken;
    this.pollTimeoutSec = pollTimeoutSec;
    this.webhookSecret = webhookSecret;
  }

  isConfigured() {
    return Boolean(this.botToken);
  }

  async #call(method, payload) {
    const response = await fetch(buildTelegramApiUrl(this.botToken, method), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload || {}),
    });
    const body = await response.json();
    if (!body.ok) {
      throw new Error(`Telegram ${method} failed: ${JSON.stringify(body)}`);
    }
    return body.result;
  }

  async getUpdates(offset) {
    return this.#call("getUpdates", {
      offset,
      timeout: this.pollTimeoutSec,
      allowed_updates: ["message", "channel_post", "edited_channel_post"],
    });
  }

  async setWebhook(publicBaseUrl) {
    const webhookUrl = `${String(publicBaseUrl || "").replace(/\/$/, "")}/webhooks/telegram`;
    return this.#call("setWebhook", {
      url: webhookUrl,
      secret_token: this.webhookSecret || undefined,
      allowed_updates: ["message", "channel_post", "edited_channel_post"],
      drop_pending_updates: false,
    });
  }

  async getWebhookInfo() {
    return this.#call("getWebhookInfo");
  }

  async deleteWebhook() {
    return this.#call("deleteWebhook", {
      drop_pending_updates: false,
    });
  }
}

export class TelegramUserSource {
  constructor({
    apiId,
    apiHash,
    userSession,
    userSessionFile,
    connectionRetries = 5,
  }) {
    this.apiId = Number.parseInt(apiId, 10) || 0;
    this.apiHash = apiHash;
    this.userSession = userSession;
    this.userSessionFile = userSessionFile;
    this.connectionRetries = connectionRetries;
    this.client = null;
  }

  hasCredentials() {
    return Boolean(this.apiId && this.apiHash);
  }

  hasSavedSession() {
    return Boolean(
      loadTelegramUserSession({
        userSession: this.userSession,
        userSessionFile: this.userSessionFile,
      }),
    );
  }

  isConfigured() {
    return this.hasCredentials() && this.hasSavedSession();
  }

  getStatus() {
    return {
      hasCredentials: this.hasCredentials(),
      hasSavedSession: this.hasSavedSession(),
    };
  }

  async start(onMessage) {
    if (!this.hasCredentials()) {
      throw new Error("Telegram user mode requires TELEGRAM_API_ID and TELEGRAM_API_HASH");
    }

    const sessionString = loadTelegramUserSession({
      userSession: this.userSession,
      userSessionFile: this.userSessionFile,
    });
    if (!sessionString) {
      throw new Error(
        "Telegram user mode requires TELEGRAM_USER_SESSION or a saved session file",
      );
    }

    const client = new TelegramClient(
      new StringSession(sessionString),
      this.apiId,
      this.apiHash,
      {
        connectionRetries: this.connectionRetries,
      },
    );

    await client.connect();
    const authorized = await client.checkAuthorization();
    if (!authorized) {
      throw new Error("The saved Telegram user session is no longer authorized");
    }

    const me = await client.getMe();
    const persistedSession = client.session.save();
    if (persistedSession) {
      saveTelegramUserSession(this.userSessionFile, persistedSession);
    }

    client.addEventHandler(
      async (event) => {
        try {
          const normalizedMessage = await normalizeTelegramUserMessage(event.message);
          if (!String(normalizedMessage.text || "").trim()) {
            return;
          }
          await onMessage({
            source: "user",
            message: normalizedMessage,
            rawEvent: event,
          });
        } catch (error) {
          console.error("[telegram-user] message error:", error.message);
        }
      },
      new NewMessage({ incoming: true }),
    );

    this.client = client;

    return {
      id: String(me?.id || ""),
      username: me?.username || "",
      displayName:
        [me?.firstName, me?.lastName].filter(Boolean).join(" ") ||
        me?.username ||
        String(me?.id || ""),
    };
  }

  async stop() {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
  }
}

export function createTelegramSource(config) {
  if (String(config?.sourceMode || "bot").toLowerCase() === "user") {
    return new TelegramUserSource(config || {});
  }
  return new TelegramBotSource(config || {});
}

export async function loginTelegramUser({
  apiId,
  apiHash,
  userSession = "",
  userSessionFile = "",
  phoneNumber,
  password,
  phoneCode,
  onError,
  connectionRetries = 5,
}) {
  const client = new TelegramClient(
    new StringSession(
      loadTelegramUserSession({
        userSession,
        userSessionFile,
      }),
    ),
    Number.parseInt(apiId, 10) || 0,
    apiHash,
    {
      connectionRetries,
    },
  );

  await client.start({
    phoneNumber,
    password,
    phoneCode,
    onError,
  });

  const sessionString = client.session.save();
  if (sessionString) {
    saveTelegramUserSession(userSessionFile, sessionString);
  }

  const me = await client.getMe();
  await client.disconnect();

  return {
    sessionString,
    me: {
      id: String(me?.id || ""),
      username: me?.username || "",
      displayName:
        [me?.firstName, me?.lastName].filter(Boolean).join(" ") ||
        me?.username ||
        String(me?.id || ""),
    },
  };
}
