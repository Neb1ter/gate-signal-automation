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
  if (["market", "市价", "市价单"].includes(normalized)) {
    return "market";
  }
  if (["limit", "限价", "限价单"].includes(normalized)) {
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
        "你是中文交易策略结构化助手。请把分析师原文整理成严格 JSON，只输出 JSON，不要额外解释。不要编造缺失信息。messageType 只能是 strategy、analysis、watchlist、brief。direction 只能是 buy、sell 或空字符串。orderType 只能是 market、limit 或空字符串。",
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "从分析师文案里提取结构化交易字段",
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
        "你是交易风控复核助手。请根据原始中文文案和第一阶段提取结果做二次校正，只输出严格 JSON。重点判断：字段是否合理、是否适合自动化执行、是否存在歧义或风险。automationReady 只在方向、标的、执行方式都足够明确时返回 true。",
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "复核并修正分析师策略结构化结果",
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
        complianceComment: `AI 结构化未完成：${
          error.name === "AbortError" ? "请求超时" : error.message
        }`,
        riskFlags: [],
      };
    }
  }
}
