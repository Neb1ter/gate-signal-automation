function getDisplaySource(signal, options) {
  if (options?.displayName) {
    return String(options.displayName).trim();
  }
  return String(signal.displaySourceName || signal.sourceName || "信号来源").trim();
}

function getDisplayText(signal) {
  return String(signal.displayText || signal.text || "").trim();
}

function truncateText(text, limit = 1800) {
  const value = String(text || "");
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, Math.max(0, limit - 10))}\n[已截断]`;
}

function sanitizeForwardText(text) {
  const masked = String(text || "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\b(?:t\.me|telegram\.me|x\.com|twitter\.com|youtube\.com|youtu\.be)\/\S+/gi, "")
    .replace(/@\w{3,}/g, "")
    .replace(/\b(?:vx|wx|wechat|telegram|tg)\s*[:：]?\s*[\w.-]{3,}\b/gi, "")
    .replace(/(?:微信|电报|飞机|频道|社群|联系|助理|客服)\s*(?:[:：]|\s)\s*[@\w.-]{3,}/g, "")
    .replace(/\b1\d{10}\b/g, "")
    .replace(/\b0x[a-fA-F0-9]{16,}\b/g, "");

  const noisePatterns = [
    /不构成投资建议/i,
    /仅供参考/i,
    /盈亏自负/i,
    /扫码/i,
    /二维码/i,
    /加入.*(群|频道)/i,
    /订阅.*(频道|社群)/i,
  ];
  const contactHint =
    /(vx|wx|wechat|telegram|tg|http|www\.|t\.me|x\.com|联系|助理|客服|私聊|社群|频道|商务|合作|进群|订阅|扫码|二维码)/i;
  const tradeHint =
    /(btc|eth|sol|xrp|bnb|sui|xau|比特币|以太|黄金|做多|做空|多单|空单|止损|止盈|入场|进场|支撑|压力|行情|现价|\d)/i;

  return masked
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
    .filter(Boolean)
    .filter((line) => {
      if (noisePatterns.some((pattern) => pattern.test(line))) {
        return false;
      }
      if (contactHint.test(line) && !tradeHint.test(line)) {
        return false;
      }
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getSignalImages(signal) {
  return (Array.isArray(signal?.media) ? signal.media : []).filter(
    (item) => item?.type === "image" && item.publicUrl,
  );
}

function buildContent(signal, options = {}) {
  const displaySource = getDisplaySource(signal, options);
  const body = sanitizeForwardText(getDisplayText(signal));
  const prefix = signal.sourceType === "analyst" ? "分析师转发" : "快讯转发";
  const header = `【${prefix}｜${displaySource}】`;
  if (!body) {
    return header;
  }
  return truncateText(`${header}\n\n${body}`, 1900);
}

export class DiscordNotifier {
  constructor({ webhookUrl = "" } = {}) {
    this.defaultWebhookUrl = webhookUrl;
  }

  resolveWebhookUrl(overrideWebhookUrl = "") {
    return String(overrideWebhookUrl || this.defaultWebhookUrl || "").trim();
  }

  isConfigured(overrideWebhookUrl = "") {
    return Boolean(this.resolveWebhookUrl(overrideWebhookUrl));
  }

  async postWebhook(payload, overrideWebhookUrl = "", retry = true) {
    const webhookUrl = this.resolveWebhookUrl(overrideWebhookUrl);
    if (!webhookUrl) {
      throw new Error("Discord webhook is not configured");
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        allowed_mentions: { parse: [] },
      }),
    });

    if (response.status === 429 && retry) {
      const data = await response.json().catch(() => ({}));
      const delayMs = Math.min(Math.max(Number(data.retry_after || 1) * 1000, 500), 5000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return this.postWebhook(payload, overrideWebhookUrl, false);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Discord webhook failed: ${response.status} ${body.slice(0, 200)}`);
    }
  }

  async sendSignal(signal, options = {}) {
    if (!this.isConfigured(options.discordWebhookUrl)) {
      return;
    }

    const webhookUrl = this.resolveWebhookUrl(options.discordWebhookUrl);
    const content = buildContent(signal, options);
    const images = getSignalImages(signal);

    if (content) {
      await this.postWebhook({ content }, webhookUrl);
    }

    for (const image of images) {
      await this.postWebhook(
        {
          embeds: [
            {
              image: { url: image.publicUrl },
            },
          ],
        },
        webhookUrl,
      );
    }
  }
}
