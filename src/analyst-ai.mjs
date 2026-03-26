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

function buildAiErrorMessage(error) {
  return error?.name === "AbortError" ? "request timeout" : String(error?.message || "unknown error");
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
    semanticSummary: String(parsed.semanticSummary || parsed.intentSummary || ""),
    executionIntent: String(parsed.executionIntent || ""),
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
  const recentContext = Array.isArray(signal.contextMessages) ? signal.contextMessages : [];
  return [
    {
      role: "system",
      content:
        "You are a trading-signal semantic analysis assistant. First understand what the analyst actually means, then convert that meaning into strict JSON only. Do not add explanations. Do not invent missing facts. The latest message is always the highest priority, but you may use recent context when the analyst sends a strategy in multiple consecutive parts. messageType must be one of strategy, analysis, watchlist, brief. direction must be buy, sell, or an empty string. orderType must be market, limit, or an empty string. semanticSummary should be a short Chinese summary of the real intent. executionIntent should be one of enter, scale_in, reduce, exit, wait, hedge, unclear.",
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "Understand the analyst message semantically and extract structured trading fields from the text. If the message is only one segment of a longer strategy, use the recent context as background, but keep the latest message as the final source of truth.",
        expectedFields: [
          "semanticSummary",
          "executionIntent",
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
        recentContext,
        combinedContextText: signal.contextText || signal.text,
      }),
    },
  ];
}

function buildReviewMessages(signal, extracted) {
  const recentContext = Array.isArray(signal.contextMessages) ? signal.contextMessages : [];
  return [
    {
      role: "system",
      content:
        "You are a trading-risk review assistant. Re-check the extracted result against the original analyst text and any recent context, then return strict JSON only. Focus on whether the semantic meaning was understood correctly, whether the fields are reasonable, whether the signal is automation-ready, and whether there is ambiguity or risk. automationReady should be true only when the asset, direction, and execution intent are all sufficiently clear.",
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "Review and correct the structured analyst output.",
        expectedFields: [
          "semanticSummary",
          "executionIntent",
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
        recentContext,
        combinedContextText: signal.contextText || signal.text,
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
      const meta = {
        provider: this.provider,
        primaryModel: this.primaryModel,
        reviewModel: this.reviewModel,
        reviewEnabled: this.reviewEnabled,
      };

      if (!(this.reviewEnabled && this.reviewModel)) {
        return normalizeResult(primaryRaw, meta);
      }

      try {
        const reviewRaw = await this.callModelWithTimeout(
          this.reviewModel,
          buildReviewMessages(signal, primaryRaw),
        );
        const merged = mergeObjects(primaryRaw, reviewRaw);
        return normalizeResult(merged, meta);
      } catch (reviewError) {
        const fallback = normalizeResult(primaryRaw, {
          ...meta,
          reviewEnabled: false,
        });
        fallback.parser = `ai-${String(this.primaryModel).toLowerCase()}-fallback`;
        fallback.reviewModel = this.reviewModel;
        fallback.automationReady = false;
        fallback.complianceComment = `AI review fallback: second-pass model failed (${buildAiErrorMessage(reviewError)}). Using primary extraction only.`;
        fallback.riskFlags = mergeArrays(fallback.riskFlags, ["AI second-pass review failed"]);
        return fallback;
      }
    } catch (error) {
      return {
        parser: "ai-review-error",
        provider: this.provider,
        primaryModel: this.primaryModel,
        reviewModel: this.reviewEnabled ? this.reviewModel : "",
        complianceComment: `AI structuring failed: ${buildAiErrorMessage(error)}`,
        riskFlags: [],
      };
    }
  }
}

