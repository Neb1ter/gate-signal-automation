function buildTelegramApiUrl(botToken, method) {
  return `https://api.telegram.org/bot${botToken}/${method}`;
}

export class TelegramSource {
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
