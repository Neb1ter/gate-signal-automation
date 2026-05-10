import fs from "node:fs";

function formatSignalType(sourceType) {
  return sourceType === "analyst" ? "\u5206\u6790\u5e08\u7b56\u7565" : "\u65b0\u95fb\u6d88\u606f";
}

function formatExecutionStatus(status) {
  const map = {
    pending_approval: "\u7b49\u5f85\u4f60\u786e\u8ba4",
    ready_for_execution: "\u51c6\u5907\u81ea\u52a8\u6267\u884c",
    dry_run_ready: "\u547d\u4e2d\u81ea\u52a8\u7b56\u7565\uff0c\u7b49\u5f85\u6a21\u62df\u6267\u884c",
    dry_run_executed: "\u6a21\u62df\u6267\u884c\u5b8c\u6210",
    executed: "\u5df2\u6267\u884c",
    rejected: "\u5df2\u5ffd\u7565",
    blocked_risk: "\u5df2\u88ab\u98ce\u63a7\u62e6\u622a",
    notify_only: "\u4ec5\u8f6c\u53d1",
    execution_failed: "\u6267\u884c\u5931\u8d25",
  };
  return map[status] || status || "\u672a\u77e5";
}

function formatResultStatus(status) {
  const map = {
    dry_run: "\u6a21\u62df\u6267\u884c\u5b8c\u6210",
    submitted: "\u5df2\u63d0\u4ea4\u5230 Gate",
    submitted_with_warnings: "\u4e3b\u5355\u5df2\u63d0\u4ea4\uff0c\u4f46\u6709\u8b66\u544a",
    rejected: "\u5df2\u5ffd\u7565",
    failed: "\u6267\u884c\u5931\u8d25",
    skipped: "\u672a\u6267\u884c",
    cancelled: "\u5df2\u64a4\u5355",
    partially_cancelled: "\u90e8\u5206\u64a4\u5355",
    protected: "\u4fdd\u62a4\u8ba1\u5212\u5df2\u66f4\u65b0",
  };
  return map[status] || status || "\u672a\u77e5";
}

function getDisplaySource(signal, options) {
  if (options?.displayName) {
    return String(options.displayName).trim();
  }
  if (signal.sourceType === "analyst") {
    return String(signal.displaySourceName || "\u5206\u6790\u5e08\u4e13\u7ebf").trim();
  }
  return String(signal.sourceName || "\u4fe1\u53f7\u6e90").trim();
}

function getDisplayText(signal) {
  return String(signal.displayText || signal.text || "").trim();
}

function truncateText(text, limit = 3500) {
  const value = String(text || "");
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, Math.max(0, limit - 12))}\n\n[\u5185\u5bb9\u5df2\u622a\u65ad]`;
}

function escapeMarkdown(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("*", "\\*")
    .replaceAll("_", "\\_")
    .replaceAll("`", "\\`")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

function formatIsoTime(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "\u672a\u77e5\u65f6\u95f4";
  }
  return raw.replace("T", " ").replace("Z", " UTC");
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
    /\u4e0d\u6784\u6210\u6295\u8d44\u5efa\u8bae/i,
    /\u4ec5\u4f9b\u53c2\u8003/i,
    /\u76c8\u4e8f\u81ea\u8d1f/i,
    /\u626b\u7801/i,
    /\u4e8c\u7ef4\u7801/i,
    /\u52a0\u5165.*(\u7fa4|\u9891\u9053)/i,
    /\u8ba2\u9605.*(\u9891\u9053|\u793e\u7fa4)/i,
  ];
  const contactHint =
    /(vx|wx|wechat|telegram|tg|http|www\.|t\.me|x\.com|\u8054\u7cfb|\u52a9\u7406|\u5ba2\u670d|\u79c1\u804a|\u793e\u7fa4|\u9891\u9053|\u5546\u52a1|\u5408\u4f5c|\u8fdb\u7fa4|\u8ba2\u9605|\u626b\u7801|\u4e8c\u7ef4\u7801)/i;
  const tradeHint =
    /(btc|eth|sol|xrp|bnb|sui|xau|\u6bd4\u7279\u5e01|\u4ee5\u592a|\u9ec4\u91d1|\u505a\u591a|\u505a\u7a7a|\u591a\u5355|\u7a7a\u5355|\u6b62\u635f|\u6b62\u76c8|\u5165\u573a|\u8fdb\u573a|\u652f\u6491|\u538b\u529b|\u884c\u60c5|\u73b0\u4ef7|\d)/i;

  const lines = masked
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
    });

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildForwardOnlyTitle(signal, displaySource) {
  const prefix =
    signal.sourceType === "analyst"
      ? "\u8bdd\u9898\u8f6c\u53d1"
      : "\u5feb\u8baf\u8f6c\u53d1";
  return `${prefix}\uff5c${displaySource}`;
}

function buildForwardText(signal) {
  const cleaned = sanitizeForwardText(getDisplayText(signal));
  return truncateText(cleaned, 3500).trim();
}

function buildForwardOnlyContent(signal, options = {}) {
  const displaySource = getDisplaySource(signal, options);
  const body = sanitizeForwardText(getDisplayText(signal));
  const lines = [
    `# ${escapeMarkdown(displaySource)}`,
    "",
    `- **\u6765\u6e90\u7c7b\u578b**\uff1a${escapeMarkdown(formatSignalType(signal.sourceType))}`,
    `- **\u53d1\u9001\u65f6\u95f4**\uff1a${escapeMarkdown(formatIsoTime(signal.publishedAt || signal.createdAt))}`,
    `- **\u5f53\u524d\u6a21\u5f0f**\uff1a\u7eaf\u8f6c\u53d1`,
  ];

  if (signal.sourceType === "analyst" && signal.threadAggregationNote) {
    lines.push(
      `- **\u8bdd\u9898\u805a\u5408**\uff1a${escapeMarkdown(String(signal.threadAggregationNote).trim())}`,
    );
  }
  if (options?.routeLabel && options.routeLabel !== displaySource) {
    lines.push(`- **\u8f6c\u53d1\u5206\u7ec4**\uff1a${escapeMarkdown(options.routeLabel)}`);
  }

  if (body) {
    lines.push(
      "",
      "## \u8f6c\u53d1\u6b63\u6587",
      `> ${escapeMarkdown(truncateText(body, 2400)).replaceAll("\n", "\n> ")}`,
    );
  }

  return lines.join("\n");
}

function getReadableExecutionReason(signal) {
  return String(signal.executionReason || "").trim() || "\u7b49\u5f85\u5904\u7406\u3002";
}

function buildStandardTitle(signal, displaySource) {
  const prefix =
    signal.sourceType === "analyst"
      ? "\u5206\u6790\u5e08\u4fe1\u53f7"
      : "\u65b0\u95fb\u4fe1\u53f7";
  return `${prefix}\uff5c${displaySource}`;
}

function buildStandardContent(signal, options = {}) {
  const displaySource = getDisplaySource(signal, options);
  const body = sanitizeForwardText(getDisplayText(signal));
  const lines = [
    `# ${escapeMarkdown(displaySource)}`,
    "",
    `- **\u6765\u6e90\u7c7b\u578b**\uff1a${escapeMarkdown(formatSignalType(signal.sourceType))}`,
    `- **\u5f53\u524d\u72b6\u6001**\uff1a${escapeMarkdown(formatExecutionStatus(signal.executionStatus))}`,
    `- **\u53d1\u9001\u65f6\u95f4**\uff1a${escapeMarkdown(formatIsoTime(signal.publishedAt || signal.createdAt))}`,
    `- **\u8bf4\u660e**\uff1a${escapeMarkdown(getReadableExecutionReason(signal))}`,
  ];

  if (body) {
    lines.push(
      "",
      "## \u8f6c\u53d1\u6b63\u6587",
      `> ${escapeMarkdown(truncateText(body, 2200)).replaceAll("\n", "\n> ")}`,
    );
  }

  return lines.join("\n");
}

function buildExecutionContent(signal, result, options = {}) {
  const displaySource = getDisplaySource(signal, options);
  const lines = [
    `# ${escapeMarkdown(displaySource)} \u6267\u884c\u7ed3\u679c`,
    "",
    `- **\u72b6\u6001**\uff1a${escapeMarkdown(formatResultStatus(result.status))}`,
    `- **\u7ed3\u679c\u8bf4\u660e**\uff1a${escapeMarkdown(result.message || "\u65e0")}`,
    `- **\u65f6\u95f4**\uff1a${escapeMarkdown(formatIsoTime(result.at || new Date().toISOString()))}`,
  ];

  if (result.orderId) {
    lines.push(`- **\u8ba2\u5355\u53f7**\uff1a${escapeMarkdown(result.orderId)}`);
  }
  if (result.avgPrice) {
    lines.push(`- **\u6210\u4ea4\u5747\u4ef7**\uff1a${escapeMarkdown(result.avgPrice)}`);
  }
  if (result.filledSize) {
    lines.push(`- **\u6210\u4ea4\u6570\u91cf**\uff1a${escapeMarkdown(result.filledSize)}`);
  }

  return lines.join("\n");
}

function buildLegacyPayload({ title, content, buttonUrl = "", buttonText = "" }) {
  return {
    title,
    content,
    button_url: buttonUrl,
    button_text: buttonText,
  };
}

function buildTextPayload(text) {
  return {
    msg_type: "text",
    content: {
      text: text || "\u6682\u65e0\u53ef\u8f6c\u53d1\u6b63\u6587",
    },
  };
}

function buildImagePayload(imageKey) {
  return {
    msg_type: "image",
    content: {
      image_key: imageKey,
    },
  };
}

function getSignalImages(signal) {
  return (Array.isArray(signal?.media) ? signal.media : []).filter(
    (item) => item?.type === "image" && (item.filePath || item.publicUrl || item.feishuImageKey),
  );
}

function buildBotCardPayload({ title, content, buttons = [], template = "blue" }) {
  const elements = [
    {
      tag: "div",
      text: {
        tag: "lark_md",
        content: truncateText(content, 3500),
      },
    },
  ];

  const visibleButtons = buttons.filter((button) => button?.url && button?.text);
  if (visibleButtons.length) {
    elements.push({
      tag: "action",
      actions: visibleButtons.map((button, index) => ({
        tag: "button",
        text: {
          tag: "plain_text",
          content: button.text,
        },
        type: button.type || (index === 0 ? "primary" : "default"),
        url: button.url,
      })),
    });
  }

  return {
    msg_type: "interactive",
    card: {
      config: {
        wide_screen_mode: true,
      },
      header: {
        template,
        title: {
          tag: "plain_text",
          content: title,
        },
      },
      elements,
    },
  };
}

function pickTemplate(signal, options = {}) {
  if (options.forwardOnlyMode) {
    return signal.sourceType === "analyst" ? "blue" : "turquoise";
  }
  const direction = String(signal.analysis?.direction || signal.tradeIdea?.side || "").toLowerCase();
  if (direction === "sell") {
    return "red";
  }
  if (direction === "buy") {
    return "green";
  }
  return signal.sourceType === "analyst" ? "blue" : "turquoise";
}

export class FeishuNotifier {
  constructor({ webhookUrl, publicBaseUrl, appId = "", appSecret = "" }) {
    this.defaultWebhookUrl = webhookUrl;
    this.publicBaseUrl = publicBaseUrl;
    this.appId = String(appId || "").trim();
    this.appSecret = String(appSecret || "").trim();
    this.tenantAccessToken = "";
    this.tenantAccessTokenExpiresAt = 0;
    this.imageKeyCache = new Map();
  }

  resolveWebhookUrl(overrideWebhookUrl = "") {
    return String(overrideWebhookUrl || this.defaultWebhookUrl || "").trim();
  }

  isConfigured(overrideWebhookUrl = "") {
    return Boolean(this.resolveWebhookUrl(overrideWebhookUrl));
  }

  isBotWebhook(webhookUrl) {
    return /\/open-apis\/bot\/v2\/hook\//i.test(String(webhookUrl || ""));
  }

  buildReviewUrl(signalId, approvalToken) {
    if (!this.publicBaseUrl) {
      return "";
    }
    return `${this.publicBaseUrl.replace(/\/$/, "")}/signals/${signalId}?token=${approvalToken}`;
  }

  buildApproveUrl(signalId, approvalToken) {
    if (!this.publicBaseUrl) {
      return "";
    }
    return `${this.publicBaseUrl.replace(/\/$/, "")}/signals/${signalId}/approve?token=${approvalToken}`;
  }

  buildRejectUrl(signalId, approvalToken) {
    if (!this.publicBaseUrl) {
      return "";
    }
    return `${this.publicBaseUrl.replace(/\/$/, "")}/signals/${signalId}/reject?token=${approvalToken}`;
  }

  async postWebhook(payload, overrideWebhookUrl = "") {
    const webhookUrl = this.resolveWebhookUrl(overrideWebhookUrl);
    if (!webhookUrl) {
      throw new Error("Feishu webhook is not configured");
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new Error(`Feishu webhook failed: ${response.status} ${details}`.trim());
    }

    const data = await response.json().catch(() => null);
    if (data && typeof data.code === "number" && data.code !== 0) {
      throw new Error(`Feishu webhook rejected request: ${data.msg || data.code}`);
    }

    return data;
  }

  canUploadImages() {
    return Boolean(this.appId && this.appSecret);
  }

  async getTenantAccessToken() {
    if (!this.canUploadImages()) {
      return "";
    }

    if (this.tenantAccessToken && Date.now() < this.tenantAccessTokenExpiresAt - 60_000) {
      return this.tenantAccessToken;
    }

    const response = await fetch(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          app_id: this.appId,
          app_secret: this.appSecret,
        }),
      },
    );
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.code !== 0 || !data?.tenant_access_token) {
      throw new Error(`Feishu tenant token failed: ${data?.msg || response.status}`);
    }

    this.tenantAccessToken = data.tenant_access_token;
    this.tenantAccessTokenExpiresAt = Date.now() + Number(data.expire || 7200) * 1000;
    return this.tenantAccessToken;
  }

  async uploadImage(media) {
    if (media?.feishuImageKey) {
      return media.feishuImageKey;
    }
    if (!this.canUploadImages() || !media?.filePath) {
      return "";
    }

    const cacheKey = String(media.filePath || media.publicUrl || media.fileName || "");
    if (cacheKey && this.imageKeyCache.has(cacheKey)) {
      return this.imageKeyCache.get(cacheKey);
    }

    const buffer = await fs.promises.readFile(media.filePath);
    const token = await this.getTenantAccessToken();
    const form = new FormData();
    form.append("image_type", "message");
    form.append(
      "image",
      new Blob([buffer], { type: media.mimeType || "image/jpeg" }),
      media.fileName || "telegram-image.jpg",
    );

    const response = await fetch("https://open.feishu.cn/open-apis/im/v1/images", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    });
    const data = await response.json().catch(() => null);
    const imageKey = data?.data?.image_key || "";
    if (!response.ok || data?.code !== 0 || !imageKey) {
      throw new Error(`Feishu image upload failed: ${data?.msg || response.status}`);
    }

    if (cacheKey) {
      this.imageKeyCache.set(cacheKey, imageKey);
    }
    return imageKey;
  }

  async sendSignalImages(signal, webhookUrl) {
    const images = getSignalImages(signal);
    for (const image of images) {
      try {
        const imageKey = await this.uploadImage(image);
        if (imageKey) {
          await this.postWebhook(buildImagePayload(imageKey), webhookUrl);
          continue;
        }
        if (image.publicUrl) {
          await this.postWebhook(buildTextPayload(`[图片] ${image.publicUrl}`), webhookUrl);
        }
      } catch (error) {
        if (image.publicUrl) {
          await this.postWebhook(buildTextPayload(`[图片] ${image.publicUrl}`), webhookUrl);
        } else {
          console.warn(`[feishu] image forwarding failed: ${error.message}`);
        }
      }
    }
  }

  async sendSignalCard(signal, approvalToken, options = {}) {
    if (!this.isConfigured(options.webhookUrl)) {
      return;
    }

    const webhookUrl = this.resolveWebhookUrl(options.webhookUrl);
    const content = buildForwardText(signal);
    const hasContent = Boolean(content);
    const images = getSignalImages(signal);

    if (!hasContent && !images.length) {
      return;
    }

    if (this.isBotWebhook(webhookUrl)) {
      if (content) {
        await this.postWebhook(buildTextPayload(content), webhookUrl);
      }
      await this.sendSignalImages(signal, webhookUrl);
      return;
    }

    const legacyContent = [
      content,
      ...images.map((image) => image.publicUrl).filter(Boolean).map((url) => `[图片] ${url}`),
    ]
      .filter(Boolean)
      .join("\n");

    await this.postWebhook(
      buildLegacyPayload({
        title: "",
        content: legacyContent,
        buttonUrl: "",
        buttonText: "",
      }),
      webhookUrl,
    );
  }

  async sendExecutionResult(signal, result, options = {}) {
    if (!this.isConfigured(options.webhookUrl)) {
      return;
    }

    const webhookUrl = this.resolveWebhookUrl(options.webhookUrl);
    const displaySource = getDisplaySource(signal, options);
    const title =
      result.status === "failed"
        ? `${displaySource} \u6267\u884c\u5931\u8d25`
        : `${displaySource} \u6267\u884c\u7ed3\u679c`;
    const content = buildExecutionContent(signal, result, options);

    if (this.isBotWebhook(webhookUrl)) {
      await this.postWebhook(
        buildBotCardPayload({
          title,
          content,
          buttons: [],
          template: result.status === "failed" ? "red" : "turquoise",
        }),
        webhookUrl,
      );
      return;
    }

    await this.postWebhook(
      buildLegacyPayload({
        title,
        content,
      }),
      webhookUrl,
    );
  }
}
