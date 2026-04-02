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

function normalizeAsset(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) {
    return "";
  }
  const aliases = new Map([
    ["比特币", "BTC"],
    ["BTC", "BTC"],
    ["ETH", "ETH"],
    ["以太", "ETH"],
    ["以太坊", "ETH"],
    ["SOL", "SOL"],
    ["SUI", "SUI"],
    ["XRP", "XRP"],
    ["BNB", "BNB"],
    ["黄金", "XAU"],
    ["XAU", "XAU"],
  ]);
  return aliases.get(raw) || raw.replace(/[^A-Z0-9]/g, "");
}

function normalizeSymbol(value, asset = "") {
  const raw = String(value || "").trim().toUpperCase();
  if (raw) {
    if (raw.includes("/")) {
      return raw.replace("/", "_");
    }
    if (raw.includes("_")) {
      return raw;
    }
    if (/^[A-Z0-9]{2,12}$/.test(raw)) {
      return `${raw}_USDT`;
    }
  }
  const normalizedAsset = normalizeAsset(asset);
  return normalizedAsset ? `${normalizedAsset}_USDT` : "";
}

function normalizeNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numeric = Number.parseFloat(String(value).replaceAll(",", "").trim());
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeLeverage(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const match = raw.match(/(\d{1,3})/);
  return match?.[1] ? `${match[1]}x` : "";
}

function normalizeTakeProfitValues(value) {
  return normalizeArray(value)
    .map((item) => String(item).replaceAll(",", "").trim())
    .filter(Boolean);
}

function buildEntryText(entryText, entryLow, entryHigh, suggestedEntryPrice) {
  const existing = String(entryText || "").trim();
  if (existing) {
    return existing;
  }
  if (entryLow !== null && entryHigh !== null) {
    return entryLow === entryHigh ? String(entryLow) : `${entryLow}-${entryHigh}`;
  }
  if (entryLow !== null) {
    return String(entryLow);
  }
  if (entryHigh !== null) {
    return String(entryHigh);
  }
  return String(suggestedEntryPrice || "").trim();
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

function normalizeStageResult(input = {}) {
  return input && typeof input === "object" ? input : {};
}

function normalizeResult(parsed = {}, meta = {}) {
  const parser =
    meta.reviewModel && meta.reviewEnabled
      ? "ai-qwen-deepseek"
      : meta.primaryModel
        ? `ai-${String(meta.primaryModel).toLowerCase()}`
        : "ai-review";

  const asset = normalizeAsset(parsed.asset);
  const symbol = normalizeSymbol(parsed.symbol, asset);
  const entryLow = normalizeNumber(parsed.entryLow);
  const entryHigh = normalizeNumber(parsed.entryHigh);
  const suggestedEntryPrice = pickFirstString(parsed.suggestedEntryPrice, parsed.entryPrice);
  const normalizedEntryText = buildEntryText(parsed.entryText, entryLow, entryHigh, suggestedEntryPrice);
  const direction = normalizeDirection(parsed.direction);
  const messageType = String(parsed.messageType || "").trim().toLowerCase();
  const contentNature = String(parsed.contentNature || "").trim().toLowerCase();
  const executionIntent = String(parsed.executionIntent || "").trim().toLowerCase();
  const hasFreshAction =
    parsed.containsNewActionableInstruction === undefined
      ? undefined
      : Boolean(parsed.containsNewActionableInstruction);
  const actionable =
    hasFreshAction === false
      ? false
      : Boolean(parsed.actionable || ((asset || symbol) && direction));
  const automationReady =
    parsed.automationReady === undefined
      ? actionable && Boolean(symbol) && Boolean(direction)
      : Boolean(parsed.automationReady);
  const instructionType =
    String(parsed.instructionType || "").trim().toLowerCase() ||
    (["review", "boast"].includes(messageType)
      ? "review_only"
      : executionIntent === "cancel"
        ? "cancel"
        : executionIntent === "protect"
          ? "protect"
          : executionIntent === "reduce"
            ? "reduce"
            : executionIntent === "exit"
              ? "exit"
              : actionable
                ? "open"
                : messageType === "analysis"
                  ? "analysis_only"
                  : "");
  const rejectionReason =
    String(parsed.rejectionReason || "").trim() ||
    (hasFreshAction === false
      ? "no_new_actionable_instruction"
      : ["review", "boast"].includes(messageType)
        ? "retrospective_or_bragging_without_new_instruction"
        : "");

  return {
    parser,
    provider: meta.provider || "dashscope",
    primaryModel: meta.primaryModel || "",
    reviewModel: meta.reviewEnabled ? meta.reviewModel || "" : "",
    semanticSummary: String(parsed.semanticSummary || parsed.intentSummary || ""),
    instructionType,
    executionIntent,
    messageType,
    contentNature,
    asset,
    symbol,
    direction,
    directionLabel: String(parsed.directionLabel || ""),
    entryText: normalizedEntryText,
    entryLow,
    entryHigh,
    stopLossRaw: String(parsed.stopLossRaw || ""),
    stopLoss: normalizeNumber(parsed.stopLoss),
    takeProfits: normalizeTakeProfitValues(parsed.takeProfits),
    leverage: normalizeLeverage(parsed.leverage),
    orderType: normalizeOrderType(parsed.orderType),
    suggestedEntryPrice,
    suggestedMarginQuote: pickFirstString(parsed.suggestedMarginQuote, parsed.marginQuote),
    suggestedContracts: pickFirstString(parsed.suggestedContracts, parsed.contracts, parsed.size),
    timeframe: String(parsed.timeframe || ""),
    confidence: String(parsed.confidence || ""),
    containsNewActionableInstruction: hasFreshAction,
    actionable,
    automationReady,
    automationComment: String(parsed.automationComment || ""),
    rejectionReason,
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
        "You are a senior analyst assistant for crypto and macro trading. Your job is to read analyst messages exactly like a careful trading desk assistant: first judge what the analyst really means, then extract strict structured fields. You must separate three things clearly: 1) a new forward-looking trade strategy, 2) ordinary market analysis or commentary, 3) retrospective recap / brag / past-performance review. Retrospective content such as reviewing past calls, celebrating profits, saying 'I told you so', showing gains, or recording previous trades must NOT be treated as a new executable strategy unless the latest message also contains a fresh future-facing action with clear asset, direction, and intended execution. Always prefer the latest message as the source of truth, but use recent context when the analyst sends a strategy in several consecutive parts. Return strict JSON only. Do not add prose. Do not invent facts. Extract the asset carefully. Examples: 比特币 -> BTC, 以太/以太坊 -> ETH, 黄金 -> XAU. symbol should use the format BTC_USDT when appropriate. entryLow/entryHigh/stopLoss/takeProfits must contain the actual key price levels whenever the analyst gave them explicitly or implicitly. instructionType must be one of open, reduce, exit, cancel, protect, analysis_only, review_only. messageType must be one of strategy, analysis, review, boast, watchlist, brief. contentNature must be one of forward_strategy, market_commentary, retrospective_review, performance_brag, risk_notice, unclear. direction must be buy, sell, or an empty string. orderType must be market, limit, or an empty string. semanticSummary should be a short Chinese summary of the real intent. executionIntent should be one of enter, scale_in, reduce, exit, wait, hedge, cancel, protect, unclear. If the text is not a fresh executable instruction, set actionable=false, containsNewActionableInstruction=false, and provide rejectionReason.",
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "Act like the analyst's desk assistant. First decide whether the latest message is a new actionable strategy, a normal analysis, or a retrospective brag/review. Then extract structured trading fields only if they truly exist. Be strict about asset, symbol, entry, stop loss, take profit, leverage, and order type. If the analyst gave a price range, fill entryLow and entryHigh. If the analyst gave a single key entry price, fill suggestedEntryPrice and entryText. If the analyst is only reviewing past performance, set actionable to false and do not fabricate a new trade.",
        expectedFields: [
          "semanticSummary",
          "instructionType",
          "executionIntent",
          "messageType",
          "contentNature",
          "asset",
          "symbol",
          "direction",
          "directionLabel",
          "entryText",
          "entryLow",
          "entryHigh",
          "stopLossRaw",
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
          "containsNewActionableInstruction",
          "automationReady",
          "automationComment",
          "rejectionReason",
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

function buildSemanticMessages(signal) {
  const recentContext = Array.isArray(signal.contextMessages) ? signal.contextMessages : [];
  return [
    {
      role: "system",
      content:
        "You are a senior analyst assistant for crypto and macro trading. Stage 1: semantic interpretation only. Decide what the analyst means before extracting execution parameters. Separate: (a) fresh forward-looking trade instruction, (b) ordinary market analysis/commentary, (c) retrospective recap/brag/past-performance review. Retrospective content must not be treated as a new instruction unless the latest message clearly adds a new future-facing action. Return strict JSON only.",
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "Stage 1 semantic judgement only. Do not force numeric extraction in this stage.",
        expectedFields: [
          "semanticSummary",
          "instructionType",
          "executionIntent",
          "messageType",
          "contentNature",
          "containsNewActionableInstruction",
          "actionable",
          "automationReady",
          "automationComment",
          "rejectionReason",
          "timeframe",
          "confidence",
          "riskFlags",
        ],
        text: signal.text,
        recentContext,
        combinedContextText: signal.contextText || signal.text,
      }),
    },
  ];
}

function buildStructuringMessages(signal, semantic = {}) {
  const recentContext = Array.isArray(signal.contextMessages) ? signal.contextMessages : [];
  return [
    {
      role: "system",
      content:
        "You are a senior analyst assistant for crypto and macro trading. Stage 2: structured extraction only. Extract concrete fields strictly from explicit statements in text/context. No fabrication. If a field is missing, leave it empty/null. Use semantic judgement as guidance, but never override with guesses.",
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "Stage 2 structured extraction. Focus on asset/symbol/direction/entry/stop loss/take profits/leverage/order type.",
        semanticInput: semantic,
        expectedFields: [
          "asset",
          "symbol",
          "direction",
          "directionLabel",
          "entryText",
          "entryLow",
          "entryHigh",
          "stopLossRaw",
          "stopLoss",
          "takeProfits",
          "leverage",
          "orderType",
          "suggestedEntryPrice",
          "suggestedMarginQuote",
          "suggestedContracts",
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
        "You are a trading-risk review assistant and senior analyst QA reviewer. Re-check the extracted result against the original analyst text and any recent context, then return strict JSON only. Your first job is to verify whether this is truly a new trade instruction or merely market commentary / retrospective review / bragging. Your second job is to verify that the extracted asset, direction, entry, stop loss, take profits, leverage, and order type are grounded in the text. executionIntent may also be cancel or protect when the analyst is managing an existing order. instructionType should reflect the operational category open, reduce, exit, cancel, protect, analysis_only, or review_only. automationReady should be true only when the asset, direction, and execution intent are all sufficiently clear, and the message is a genuine forward-looking trade instruction rather than a past-performance recap.",
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "Review and correct the structured analyst output.",
        expectedFields: [
          "semanticSummary",
          "instructionType",
          "executionIntent",
          "messageType",
          "contentNature",
          "asset",
          "symbol",
          "direction",
          "directionLabel",
          "entryText",
          "entryLow",
          "entryHigh",
          "stopLossRaw",
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
          "containsNewActionableInstruction",
          "automationComment",
          "rejectionReason",
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
    this.primaryTimeoutMs = Number(config.primaryTimeoutMs || Math.min(this.timeoutMs, 12000));
    this.reviewTimeoutMs = Number(config.reviewTimeoutMs || Math.min(this.timeoutMs, 8000));
    this.semanticTimeoutMs = Number(config.semanticTimeoutMs || Math.min(this.timeoutMs, 10000));
    this.structuringTimeoutMs = Number(
      config.structuringTimeoutMs || Math.min(this.timeoutMs, 12000),
    );
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

  async callModelWithTimeout(model, messages, timeoutMs = this.timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
      const semanticRaw = normalizeStageResult(
        await this.callModelWithTimeout(
          this.primaryModel,
          buildSemanticMessages(signal),
          this.semanticTimeoutMs,
        ),
      );
      const structRaw = normalizeStageResult(
        await this.callModelWithTimeout(
          this.primaryModel,
          buildStructuringMessages(signal, semanticRaw),
          this.structuringTimeoutMs,
        ),
      );
      const primaryRaw = mergeObjects(semanticRaw, structRaw);
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
          this.reviewTimeoutMs,
        );
        const merged = mergeObjects(primaryRaw, reviewRaw);
        return normalizeResult(merged, meta);
      } catch (reviewError) {
        const fallback = normalizeResult(primaryRaw, {
          ...meta,
          reviewEnabled: false,
        });
        fallback.parser = `ai-${String(this.primaryModel).toLowerCase()}-two-stage-fallback`;
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

