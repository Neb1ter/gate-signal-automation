function buildUrl(baseUrl) {
  const trimmed = String(baseUrl || "").replace(/\/$/, "");
  if (!trimmed) {
    return "";
  }
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

function safeJsonParse(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {}

  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function normalizeArray(value) {
  return Array.isArray(value)
    ? value
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    : [];
}

function normalizeDirection(value) {
  const normalized = String(value || "").toLowerCase();
  if (["buy", "long", "bullish"].includes(normalized)) {
    return "buy";
  }
  if (["sell", "short", "bearish", "reduce"].includes(normalized)) {
    return "sell";
  }
  return "";
}

function normalizeOrderType(value) {
  const normalized = String(value || "").toLowerCase();
  if (["market", "market order", "shi jia", "shijia"].includes(normalized)) {
    return "market";
  }
  if (["limit", "limit order", "xian jia", "xianjia"].includes(normalized)) {
    return "limit";
  }
  return "";
}

function pickFirstString(...values) {
  for (const value of values) {
    const next = String(value || "").trim();
    if (next) {
      return next;
    }
  }
  return "";
}

function mergeArrays(...lists) {
  return [...new Set(lists.flatMap((list) => normalizeArray(list)))];
}

function mergeObjects(primary = {}, review = {}) {
  return {
    ...primary,
    ...review,
    takeProfits:
      normalizeArray(review.takeProfits).length > 0
        ? normalizeArray(review.takeProfits)
        : normalizeArray(primary.takeProfits),
    riskFlags: mergeArrays(primary.riskFlags, review.riskFlags),
  };
}

function normalizeResult(parsed = {}, meta = {}) {
  const parser =
    meta.reviewModel && meta.reviewEnabled
      ? "ai-qwen-deepseek"
      : meta.primaryModel
        ? `ai-${String(meta.primaryModel).toLowerCase()}`
        : "ai-review";

  return {
    parser,
    provider: meta.provider || "dashscope",
    primaryModel: meta.primaryModel || "",
    reviewModel: meta.reviewEnabled ? meta.reviewModel || "" : "",
    messageType: String(parsed.messageType || ""),
    asset: String(parsed.asset || "").toUpperCase(),
    symbol: String(parsed.symbol || "").replace("/", "_").toUpperCase(),
    direction: normalizeDirection(parsed.direction),
    directionLabel: String(parsed.directionLabel || ""),
    entryText: String(parsed.entryText || ""),
    entryLow: parsed.entryLow ?? null,
    entryHigh: parsed.entryHigh ?? null,
    stopLoss: parsed.stopLoss ?? null,
    takeProfits: normalizeArray(parsed.takeProfits),
    leverage: String(parsed.leverage || ""),
    orderType: normalizeOrderType(parsed.orderType),
    suggestedEntryPrice: pickFirstString(parsed.suggestedEntryPrice, parsed.entryPrice),
    suggestedMarginQuote: pickFirstString(parsed.suggestedMarginQuote, parsed.marginQuote),
    suggestedContracts: pickFirstString(parsed.suggestedContracts, parsed.contracts, parsed.size),
    timeframe: String(parsed.timeframe || ""),
    confidence: String(parsed.confidence || ""),
    actionable: Boolean(parsed.actionable),
    automationReady:
      parsed.automationReady === undefined ? undefined : Boolean(parsed.automationReady),
    automationComment: String(parsed.automationComment || ""),
    complianceComment: String(parsed.complianceComment || ""),
    riskFlags: normalizeArray(parsed.riskFlags),
  };
}

function buildPrimaryMessages(signal) {
  return [
    {
      role: "system",
      content:
        "You are a trading-signal structuring assistant. Convert the analyst text into strict JSON only. Do not add explanations. Do not invent missing facts. messageType must be one of strategy, analysis, watchlist, brief. direction must be buy, sell, or an empty string. orderType must be market, limit, or an empty string.",
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "Extract structured trading fields from the analyst text.",
        expectedFields: [
          "messageType",
          "asset",
          "symbol",
          "direction",
          "directionLabel",
          "entryText",
          "entryLow",
          "entryHigh",
          "stopLoss",
          "takeProfits",
          "leverage",
          "orderType",
          "suggestedEntryPrice",
          "suggestedMarginQuote",
          "suggestedContracts",
          "timeframe",
          "confidence",
          "actionable",
          "complianceComment",
          "riskFlags",
        ],
        text: signal.text,
      }),
    },
  ];
}

function buildReviewMessages(signal, extracted) {
  return [
    {
      role: "system",
      content:
        "You are a trading-risk review assistant. Re-check the extracted result against the original analyst text and return strict JSON only. Focus on whether the fields are reasonable, whether the signal is automation-ready, and whether there is ambiguity or risk. automationReady should be true only when the asset, direction, and execution intent are all sufficiently clear.",
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "Review and correct the structured analyst output.",
        expectedFields: [
          "messageType",
          "asset",
          "symbol",
          "direction",
          "directionLabel",
          "entryText",
          "entryLow",
          "entryHigh",
          "stopLoss",
          "takeProfits",
          "leverage",
          "orderType",
          "suggestedEntryPrice",
          "suggestedMarginQuote",
          "suggestedContracts",
          "timeframe",
          "confidence",
          "actionable",
          "automationReady",
          "automationComment",
          "complianceComment",
          "riskFlags",
        ],
        originalText: signal.text,
        extracted,
      }),
    },
  ];
}

export class AnalystAiReviewer {
  constructor(config = {}) {
    this.enabled = Boolean(config.enabled);
    this.provider = String(config.provider || "dashscope").trim() || "dashscope";
    this.apiKey = config.apiKey || "";
    this.baseUrl = buildUrl(config.baseUrl);
    this.primaryModel = config.primaryModel || config.model || "";
    this.reviewModel = config.reviewModel || "";
    this.reviewEnabled = config.reviewEnabled !== false;
    this.timeoutMs = Number(config.timeoutMs || 30000);
  }

  isConfigured() {
    return Boolean(this.enabled && this.apiKey && this.baseUrl && this.primaryModel);
  }

  async callModel(model, messages, controller) {
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`${model} request failed: ${response.status} ${detail}`.trim());
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content || "";
    const parsed = safeJsonParse(content);
    if (!parsed) {
      throw new Error(`${model} returned non-JSON content`);
    }

    return parsed;
  }

  async callModelWithTimeout(model, messages) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.callModel(model, messages, controller);
    } finally {
      clearTimeout(timeout);
    }
  }

  async review(signal) {
    if (!this.isConfigured() || signal?.sourceType !== "analyst") {
      return null;
    }

    try {
      const primaryRaw = await this.callModelWithTimeout(
        this.primaryModel,
        buildPrimaryMessages(signal),
      );

      let merged = primaryRaw;
      if (this.reviewEnabled && this.reviewModel) {
        const reviewRaw = await this.callModelWithTimeout(
          this.reviewModel,
          buildReviewMessages(signal, primaryRaw),
        );
        merged = mergeObjects(primaryRaw, reviewRaw);
      }

      return normalizeResult(merged, {
        provider: this.provider,
        primaryModel: this.primaryModel,
        reviewModel: this.reviewModel,
        reviewEnabled: this.reviewEnabled,
      });
    } catch (error) {
      return {
        parser: "ai-review-error",
        provider: this.provider,
        primaryModel: this.primaryModel,
        reviewModel: this.reviewEnabled ? this.reviewModel : "",
        complianceComment: `AI structuring failed: ${
          error.name === "AbortError" ? "request timeout" : error.message
        }`,
        riskFlags: [],
      };
    }
  }
}

