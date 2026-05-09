import crypto from "node:crypto";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeMediaFingerprint(media = []) {
  return (Array.isArray(media) ? media : [])
    .map((item) =>
      [
        item?.type,
        item?.telegramFileUniqueId,
        item?.telegramFileId,
        item?.fileName,
        item?.publicUrl,
      ]
        .filter(Boolean)
        .join(":"),
    )
    .filter(Boolean)
    .join(" ");
}

function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}


function toNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number.parseFloat(String(value).replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

const COMMON_SYMBOL_ALIASES = new Map([
  ["btc", "BTC"],
  ["比特币", "BTC"],
  ["大饼", "BTC"],
  ["eth", "ETH"],
  ["以太", "ETH"],
  ["以太坊", "ETH"],
  ["sol", "SOL"],
  ["sui", "SUI"],
  ["xrp", "XRP"],
  ["bnb", "BNB"],
  ["ada", "ADA"],
  ["doge", "DOGE"],
  ["link", "LINK"],
  ["ltc", "LTC"],
  ["avax", "AVAX"],
  ["trx", "TRX"],
  ["dot", "DOT"],
  ["arb", "ARB"],
  ["op", "OP"],
  ["ton", "TON"],
  ["apt", "APT"],
  ["pepe", "PEPE"],
  ["shib", "SHIB"],
  ["wif", "WIF"],
  ["bch", "BCH"],
  ["etc", "ETC"],
]);

const STOP_WORDS = new Set([
  "LONG",
  "SHORT",
  "SPOT",
  "NEWS",
  "BREAKING",
  "ENTRY",
  "SL",
  "TP",
  "BTCUSDT",
  "USDT",
  "USD",
]);

const BUY_KEYWORDS = [
  "买入",
  "做多",
  "开多",
  "低多",
  "看多",
  "接多",
  "多单",
  "建仓",
  "加仓",
  "抄底",
  "long",
  "buy",
  "accumulate",
];

const SELL_KEYWORDS = [
  "卖出",
  "止盈",
  "减仓",
  "清仓",
  "做空",
  "开空",
  "高空",
  "看空",
  "空单",
  "止损离场",
  "short",
  "sell",
  "reduce",
  "exit",
];

const WATCH_KEYWORDS = ["观望", "等待", "先看", "暂不", "不追", "观察", "留意", "关注"];

const COMMENTARY_KEYWORDS = [
  "行情",
  "结构",
  "支撑",
  "压力",
  "趋势",
  "回踩",
  "突破",
  "跌破",
  "震荡",
  "反弹",
  "空头",
  "多头",
  "日内",
  "波段",
  "中线",
  "短线",
  "资金费率",
  "均线",
  "macd",
  "rsi",
];

const RETROSPECTIVE_ONLY_PATTERNS = [
  /复盘/,
  /回顾/,
  /回看/,
  /战绩/,
  /记录/,
  /盈利/,
  /止盈到了/,
  /已经涨/,
  /已经跌/,
  /提前.*提示/,
  /早盘.*提示/,
  /昨天.*提示/,
  /今天.*提示/,
  /之前.*提示/,
  /之前说过/,
  /我说过/,
  /还记得/,
  /恭喜/,
  /看到没/,
  /看到了吗/,
  /拿住了/,
  /坚持持有/,
  /大暴涨/,
  /暴涨了/,
  /吃肉/,
  /炫耀/,
  /牛回速归/,
  /review of past/i,
  /recap/i,
  /called it/i,
  /as expected/i,
  /already pumped/i,
];

const FORWARD_LOOKING_PATTERNS = [
  /可以.*做多/,
  /可以.*做空/,
  /继续.*做多/,
  /继续.*做空/,
  /准备.*做多/,
  /准备.*做空/,
  /考虑.*做多/,
  /考虑.*做空/,
  /回踩.*做多/,
  /反弹.*做空/,
  /到.*做多/,
  /到.*做空/,
  /挂单/,
  /进场/,
  /入场/,
  /建仓/,
  /开多/,
  /开空/,
  /买入/,
  /卖出/,
  /止损放/,
  /止盈看/,
  /if .* then .*long/i,
  /if .* then .*short/i,
  /entry/i,
  /enter/i,
];

function hasRetrospectiveOnlyTone(text) {
  const source = String(text || "");
  return RETROSPECTIVE_ONLY_PATTERNS.some((pattern) => pattern.test(source));
}

function hasForwardLookingInstruction(text) {
  const source = String(text || "");
  return FORWARD_LOOKING_PATTERNS.some((pattern) => pattern.test(source));
}

function classifyRetrospectiveSignal(text, analysis = {}) {
  const source = String(text || "");
  const messageType = String(analysis.messageType || "").toLowerCase();
  const contentNature = String(analysis.contentNature || "").toLowerCase();
  const executionIntent = String(analysis.executionIntent || "").toLowerCase();
  const retrospectiveByTone = hasRetrospectiveOnlyTone(source);
  const forwardByTone = hasForwardLookingInstruction(source);
  const retrospectiveByAi = ["review", "boast"].includes(messageType) ||
    ["retrospective_review", "performance_brag"].includes(contentNature);
  const forwardByAi = ["enter", "scale_in", "reduce", "exit", "hedge", "cancel", "protect"].includes(
    executionIntent,
  );

  const retrospectiveOnly =
    (retrospectiveByTone || retrospectiveByAi) && !(forwardByTone || forwardByAi);

  return {
    retrospectiveOnly,
    retrospectiveByTone,
    retrospectiveByAi,
    forwardByTone,
    forwardByAi,
  };
}

function findFirstKeywordIndex(text, keywords) {
  const haystack = String(text || "").toLowerCase();
  let best = -1;
  for (const keyword of keywords) {
    const index = haystack.indexOf(String(keyword).toLowerCase());
    if (index >= 0 && (best < 0 || index < best)) {
      best = index;
    }
  }
  return best;
}

function inferDirection(text) {
  const buyIndex = findFirstKeywordIndex(text, BUY_KEYWORDS);
  const sellIndex = findFirstKeywordIndex(text, SELL_KEYWORDS);
  const watchIndex = findFirstKeywordIndex(text, WATCH_KEYWORDS);

  if (watchIndex >= 0 && buyIndex < 0 && sellIndex < 0) {
    return { side: "", intent: "watch", label: "观望" };
  }
  if (buyIndex >= 0 && (sellIndex < 0 || buyIndex <= sellIndex)) {
    return { side: "buy", intent: "long", label: "偏多 / 做多" };
  }
  if (sellIndex >= 0) {
    return { side: "sell", intent: "short_or_reduce", label: "偏空 / 减仓" };
  }
  return { side: "", intent: "commentary", label: "分析观点" };
}

function inferDirectionV2(text) {
  const combined = `${String(text || "")} ${String(text || "").toLowerCase()}`;
  if (/(观望|等待|先看|暂不|不追|观察|留意|关注)/.test(combined)) {
    return { side: "", intent: "watch", label: "观望" };
  }
  if (/(买入|做多|开多|低多|看多|接多|多单|建仓|加仓|long|buy|accumulate)/i.test(combined)) {
    return { side: "buy", intent: "long", label: "偏多 / 做多" };
  }
  if (/(卖出|止盈|减仓|清仓|做空|开空|高空|看空|空单|short|sell|reduce|exit)/i.test(combined)) {
    return { side: "sell", intent: "short_or_reduce", label: "偏空 / 做空" };
  }
  return inferDirection(text);
}

function extractPair(text) {
  const match = String(text || "").match(/\b([A-Z0-9]{2,12})\s*\/\s*(USDT|USD|BTC|ETH)\b/i);
  if (!match) {
    return "";
  }
  return `${match[1].toUpperCase()}_${match[2].toUpperCase()}`;
}

function extractAsset(text) {
  const pair = extractPair(text);
  if (pair) {
    return pair.split("_")[0];
  }

  const dollarMatch = String(text || "").match(/\$([A-Z0-9]{2,12})\b/);
  if (dollarMatch?.[1]) {
    return dollarMatch[1].toUpperCase();
  }

  for (const [alias, symbol] of COMMON_SYMBOL_ALIASES.entries()) {
    if (String(text || "").toLowerCase().includes(alias.toLowerCase())) {
      return symbol;
    }
  }

  const candidates = String(text || "").match(/\b[A-Z]{2,10}\b/g) || [];
  for (const candidate of candidates) {
    if (!STOP_WORDS.has(candidate)) {
      return candidate;
    }
  }

  return "";
}

function extractNumberRange(snippet) {
  if (!snippet) {
    return null;
  }

  const rangeMatch = snippet.match(
    /(\d[\d,]*(?:\.\d+)?)\s*(?:-|~|到|至|—|–)\s*(\d[\d,]*(?:\.\d+)?)/,
  );
  if (rangeMatch) {
    const low = toNumber(rangeMatch[1]);
    const high = toNumber(rangeMatch[2]);
    if (low !== null && high !== null) {
      return { low: Math.min(low, high), high: Math.max(low, high), text: `${low}-${high}` };
    }
  }

  const singleMatch = snippet.match(/(\d[\d,]*(?:\.\d+)?)/);
  if (singleMatch) {
    const value = toNumber(singleMatch[1]);
    if (value !== null) {
      return { low: value, high: value, text: String(value) };
    }
  }

  return null;
}

function extractEntry(text) {
  const patterns = [
    /(?:入场|进场|建仓|买入|卖出|做多|做空|关注|现价|回踩|突破)\s*(?:区间|位置|附近|价位|点位)?\s*[:：]?\s*([^\n，。；;]+)/i,
    /(?:区间|位置)\s*[:：]?\s*(\d[\d,.]*(?:\s*(?:-|~|到|至|—|–)\s*\d[\d,.]*)?)/i,
  ];

  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    const range = extractNumberRange(match?.[1] || "");
    if (range) {
      return range;
    }
  }
  return null;
}

function extractStopLoss(text) {
  const match = String(text || "").match(
    /(?:止损|防守|失守|跌破|站不稳|stop loss|sl)\s*(?:位|价)?\s*[:：]?\s*(\d[\d,]*(?:\.\d+)?)/i,
  );
  return toNumber(match?.[1]);
}

function extractTakeProfits(text) {
  const matches = String(text || "").matchAll(
    /(?:止盈|目标|target|tp\d*)\s*(?:位|价|区间)?\s*[:：]?\s*([^\n，。；;]+)/gi,
  );

  const values = [];
  for (const match of matches) {
    if (match?.[1]) {
      const chunk = match[1].replace(/\s+/g, "");
      const numberMatches = chunk.match(/\d[\d,]*(?:\.\d+)?/g) || [];
      for (const number of numberMatches) {
        values.push(number.replaceAll(",", ""));
      }
    }
  }
  return unique(values);
}

function extractLeverage(text) {
  const match = String(text || "").match(/(\d{1,3})\s*(?:x|X|倍)/);
  return match?.[1] ? `${match[1]}x` : "";
}

function extractSuggestedMarginQuote(text) {
  const patterns = [
    /(?:仓位|资金|保证金|投入|本金|下单金额|跟单金额)\s*[:：]?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:u|usdt|usd|刀|美金)\b/i,
    /\b(\d[\d,]*(?:\.\d+)?)\s*(?:u|usdt|usd|刀|美金)\b/i,
  ];

  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    const value = toNumber(match?.[1]);
    if (value !== null && value > 0) {
      return String(value);
    }
  }
  return "";
}

function extractSuggestedContracts(text) {
  const patterns = [
    /(?:数量|仓位|下单|开仓)\s*[:：]?\s*(\d+)\s*(?:张|contracts?|contract)\b/i,
    /\b(\d+)\s*(?:张|contracts?|contract)\b/i,
  ];

  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match?.[1]) {
      return String(Number.parseInt(match[1], 10));
    }
  }
  return "";
}

function inferOrderType(text, entry) {
  const normalized = String(text || "").toLowerCase();
  if (/市价|现价|追多|追空|market/.test(normalized)) {
    return "market";
  }
  if (entry?.low !== null || entry?.high !== null) {
    return "limit";
  }
  return "market";
}

function getDefaultEntryPrice(entry) {
  if (!entry) {
    return "";
  }
  if (entry.low !== null && entry.high !== null) {
    return entry.low === entry.high ? String(entry.low) : String((entry.low + entry.high) / 2);
  }
  return entry.text || "";
}

function extractEntryV2(text) {
  const patterns = [
    /(?:入场|进场|建仓|买入|卖出|做多|做空|现价|回踩|突破)\s*(?:区间|位置|附近|价格|价位|点位)?\s*[:：]?\s*([^\n，。；;]+)/i,
    /(?:entry|entries|enter|buy|sell|long|short)\s*(?:zone|area|near|at|price)?\s*[:：]?\s*([^\n,.;]+)/i,
    /(?:区间|位置)\s*[:：]?\s*(\d[\d,.]*(?:\s*(?:-|~|到|至|—|–)\s*\d[\d,.]*)?)/i,
    /(?:zone|range)\s*[:：]?\s*(\d[\d,.]*(?:\s*(?:-|~|to)\s*\d[\d,.]*)?)/i,
  ];

  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    const range = extractNumberRange(match?.[1] || "");
    if (range) {
      return range;
    }
  }
  return extractEntry(text);
}

function extractStopLossV2(text) {
  const match = String(text || "").match(
    /(?:止损|防守|失守|跌破|站不稳|stop loss|sl)\s*(?:位|价)?\s*[:：]?\s*(\d[\d,]*(?:\.\d+)?)/i,
  );
  return toNumber(match?.[1]) ?? extractStopLoss(text);
}

function extractTakeProfitsV2(text) {
  const matches = String(text || "").matchAll(
    /(?:止盈|目标|target|tp\d*)\s*(?:位|价|区间)?\s*[:：]?\s*([^\n，。；;]+)/gi,
  );
  const values = [];
  for (const match of matches) {
    if (match?.[1]) {
      const numberMatches = match[1].match(/\d[\d,]*(?:\.\d+)?/g) || [];
      for (const number of numberMatches) {
        values.push(number.replaceAll(",", ""));
      }
    }
  }
  const filtered = values.filter((value) => !/^\d{1,3}$/.test(value) || Number(value) > 1000);
  return filtered.length ? unique(filtered) : extractTakeProfits(text);
}

function inferTimeframe(text) {
  const normalized = String(text || "").toLowerCase();
  if (/1m|3m|5m|15m|30m/.test(normalized) || /短线|超短/.test(text)) {
    return "短线";
  }
  if (/1h|2h|4h|6h|12h/.test(normalized) || /日内/.test(text)) {
    return "日内";
  }
  if (/1d|4d|1w/.test(normalized) || /波段/.test(text)) {
    return "波段";
  }
  if (/中线/.test(text)) {
    return "中线";
  }
  return "";
}

function inferConfidence(text) {
  const normalized = String(text || "").toLowerCase();
  if (/强烈|重点|必看|明确|非常看好|strong conviction/.test(text)) {
    return "高";
  }
  if (/仅供参考|轻仓|谨慎|试多|试空|watch closely/.test(normalized) || /谨慎/.test(text)) {
    return "中低";
  }
  return "中";
}

function inferMessageType(text, direction, asset) {
  if (hasRetrospectiveOnlyTone(text) && !hasForwardLookingInstruction(text)) {
    return /恭喜|战绩|暴涨|吃肉|看到没/.test(String(text || "")) ? "boast" : "review";
  }
  if (direction.side && asset) {
    return "strategy";
  }
  if (COMMENTARY_KEYWORDS.some((item) => String(text || "").toLowerCase().includes(item.toLowerCase()))) {
    return "analysis";
  }
  if (direction.intent === "watch") {
    return "watchlist";
  }
  return "brief";
}

function buildStructuredStrategy(text, sourceType) {
  const asset = extractAsset(text);
  const pair = extractPair(text);
  const direction = inferDirectionV2(text);
  const entry = extractEntryV2(text);
  const stopLoss = extractStopLossV2(text);
  const takeProfits = extractTakeProfitsV2(text);
  const leverage = extractLeverage(text);
  const suggestedMarginQuote = extractSuggestedMarginQuote(text);
  const suggestedContracts = extractSuggestedContracts(text);
  const orderType = inferOrderType(text, entry);
  const timeframe = inferTimeframe(text);
  const confidence = inferConfidence(text);
  const messageType = inferMessageType(text, direction, asset);
  const retrospectiveCheck = classifyRetrospectiveSignal(text, { messageType });

  const riskFlags = [];
  if (direction.side === "sell" && sourceType === "analyst") {
    riskFlags.push("当前执行端仅支持现货，偏空信号会按减仓/卖出现货处理");
  }
  if (!asset) {
    riskFlags.push("未识别到明确币种");
  }
  if (!direction.side) {
    riskFlags.push("未识别到明确买卖方向");
  }

  const symbol = pair || (asset ? `${asset}_USDT` : "");
  const actionable = retrospectiveCheck.retrospectiveOnly ? false : Boolean(asset && direction.side);

  return {
    parser: "heuristic-v2",
    messageType,
    contentNature: retrospectiveCheck.retrospectiveOnly
      ? messageType === "boast"
        ? "performance_brag"
        : "retrospective_review"
      : messageType === "strategy"
        ? "forward_strategy"
        : messageType === "analysis"
          ? "market_commentary"
          : messageType === "watchlist"
            ? "risk_notice"
            : "unclear",
    asset: retrospectiveCheck.retrospectiveOnly ? "" : asset,
    symbol: retrospectiveCheck.retrospectiveOnly ? "" : symbol,
    direction: retrospectiveCheck.retrospectiveOnly ? "" : direction.side,
    directionLabel: retrospectiveCheck.retrospectiveOnly
      ? "回顾 / 炫耀，不构成新策略"
      : direction.label,
    entryText: retrospectiveCheck.retrospectiveOnly ? "" : entry?.text || "",
    entryLow: retrospectiveCheck.retrospectiveOnly ? null : entry?.low ?? null,
    entryHigh: retrospectiveCheck.retrospectiveOnly ? null : entry?.high ?? null,
    stopLoss: retrospectiveCheck.retrospectiveOnly ? null : stopLoss,
    takeProfits: retrospectiveCheck.retrospectiveOnly ? [] : takeProfits,
    leverage,
    orderType: retrospectiveCheck.retrospectiveOnly ? "" : orderType,
    suggestedEntryPrice: retrospectiveCheck.retrospectiveOnly ? "" : getDefaultEntryPrice(entry),
    suggestedMarginQuote: retrospectiveCheck.retrospectiveOnly ? "" : suggestedMarginQuote,
    suggestedContracts: retrospectiveCheck.retrospectiveOnly ? "" : suggestedContracts,
    timeframe,
    confidence,
    actionable,
    executionIntent: retrospectiveCheck.retrospectiveOnly ? "wait" : "",
    riskFlags: retrospectiveCheck.retrospectiveOnly
      ? unique([...riskFlags, "retrospective recap", "not a fresh trade signal"])
      : riskFlags,
    normalizedSummary: "",
    complianceComment: "",
  };
}

function formatEntry(analysis) {
  if (!analysis?.entryText) {
    return "未给出";
  }
  return analysis.entryText;
}

function formatTakeProfits(analysis) {
  if (!analysis?.takeProfits?.length) {
    return "未给出";
  }
  return analysis.takeProfits.join(" / ");
}

function buildStructuredSummary(analysis) {
  if (!analysis) {
    return "";
  }

  const lines = [
    `语义判断：${analysis.semanticSummary || "未提取"}`,
    `执行意图：${analysis.executionIntent || "未提取"}`,
    `文案类型：${
      analysis.messageType === "strategy"
        ? "交易策略"
        : analysis.messageType === "analysis"
          ? "行情分析"
          : analysis.messageType === "watchlist"
            ? "观察提醒"
            : "普通转发"
    }`,
    `币种：${analysis.asset || "未识别"}`,
    `方向：${analysis.directionLabel || "未识别"}`,
    `入场：${formatEntry(analysis)}`,
    `止损：${analysis.stopLoss ?? "未给出"}`,
    `止盈：${formatTakeProfits(analysis)}`,
    `周期：${analysis.timeframe || "未提及"}`,
    `信号强度：${analysis.confidence || "中"}`,
  ];

  if (analysis.leverage) {
    lines.push(`杠杆：${analysis.leverage}`);
  }
  if (analysis.orderType) {
    lines.push(`下单方式：${analysis.orderType === "limit" ? "限价单" : "市价单"}`);
  }
  if (analysis.suggestedEntryPrice) {
    lines.push(`参考价格：${analysis.suggestedEntryPrice}`);
  }
  if (analysis.suggestedContracts) {
    lines.push(`建议数量：${analysis.suggestedContracts} 张`);
  } else if (analysis.suggestedMarginQuote) {
    lines.push(`建议保证金：${analysis.suggestedMarginQuote} USDT`);
  }
  if (analysis.complianceComment) {
    lines.push(`AI 规范建议：${analysis.complianceComment}`);
  }
  if (analysis.automationReady !== undefined) {
    lines.push(`AI 自动化判断：${analysis.automationReady ? "适合自动执行" : "建议继续人工确认"}`);
  }
  if (analysis.automationComment) {
    lines.push(`AI 自动化备注：${analysis.automationComment}`);
  }
  if (analysis.riskFlags?.length) {
    lines.push(`提醒：${analysis.riskFlags.join("；")}`);
  }
  if (analysis.primaryModel || analysis.reviewModel) {
    lines.push(
      `AI 模型链路：${[analysis.primaryModel, analysis.reviewModel].filter(Boolean).join(" -> ")}`,
    );
  }

  return lines.join("\n");
}

function buildStructuredSummaryV2(analysis) {
  if (!analysis) {
    return "";
  }

  const messageTypeLabel =
    analysis.messageType === "strategy"
      ? "交易策略"
      : analysis.messageType === "analysis"
        ? "行情分析"
        : analysis.messageType === "watchlist"
          ? "观察提醒"
          : "普通转发";

  const lines = [
    `文案类型：${messageTypeLabel}`,
    `币种：${analysis.asset || "未识别"}`,
    `方向：${analysis.directionLabel || "未识别"}`,
    `入场：${formatEntry(analysis)}`,
    `止损：${analysis.stopLoss ?? "未给出"}`,
    `止盈：${formatTakeProfits(analysis)}`,
    `周期：${analysis.timeframe || "未提及"}`,
    `信号强度：${analysis.confidence || "中"}`,
  ];

  if (analysis.leverage) {
    lines.push(`杠杆：${analysis.leverage}`);
  }
  if (analysis.complianceComment) {
    lines.push(`AI 规范建议：${analysis.complianceComment}`);
  }
  if (analysis.riskFlags?.length) {
    lines.push(`提醒：${analysis.riskFlags.join("；")}`);
  }

  return lines.join("\n");
}

function buildDefaultTradeIdea(baseSignal, analysis, selectedPlaybook, analystConfig = {}) {
  if (!analysis?.actionable || !analysis.symbol) {
    return null;
  }

  const defaults = selectedPlaybook?.action || {};
  const side = analysis.direction || defaults.side || "";
  if (!["buy", "sell"].includes(side)) {
    return null;
  }

  const tradeIdea = {
    kind: defaults.kind || "spot_market",
    symbol: analysis.symbol,
    side,
    timeInForce: defaults.timeInForce || "ioc",
    account: defaults.account || "spot",
    clientOrderId: `t-analyst-${Date.now().toString().slice(-8)}`,
  };

  if (side === "buy") {
    tradeIdea.amountQuote = analystConfig.amountQuote || defaults.amountQuote || "100";
  } else {
    tradeIdea.amountBase = defaults.amountBase || "ALL";
  }

  const amountText =
    side === "buy"
      ? `默认投入 ${tradeIdea.amountQuote} USDT`
      : tradeIdea.amountBase === "ALL"
        ? "默认卖出现货可用仓位"
        : `默认卖出 ${tradeIdea.amountBase}`;

  const detailParts = [];
  if (analysis.entryText) {
    detailParts.push(`入场 ${analysis.entryText}`);
  }
  if (analysis.stopLoss !== null) {
    detailParts.push(`止损 ${analysis.stopLoss}`);
  }
  if (analysis.takeProfits?.length) {
    detailParts.push(`止盈 ${analysis.takeProfits.join("/")}`);
  }

  tradeIdea.summary = `${side === "buy" ? "现货买入" : "现货卖出"} ${tradeIdea.symbol}，${amountText}${
    detailParts.length ? `；${detailParts.join("；")}` : ""
  }`;

  return tradeIdea;
}

function buildStructuredSummaryV3(analysis) {
  if (!analysis) {
    return "";
  }

  const messageTypeLabel =
    analysis.messageType === "strategy"
      ? "交易策略"
      : analysis.messageType === "analysis"
        ? "行情分析"
        : analysis.messageType === "watchlist"
          ? "观察提醒"
          : "普通转发";

  const lines = [
    `文案类型：${messageTypeLabel}`,
    `币种：${analysis.asset || "未识别"}`,
    `方向：${analysis.directionLabel || "未识别"}`,
    `入场：${formatEntry(analysis)}`,
    `止损：${analysis.stopLoss ?? "未给出"}`,
    `止盈：${formatTakeProfits(analysis)}`,
    `周期：${analysis.timeframe || "未提及"}`,
    `信号强度：${analysis.confidence || "中"}`,
  ];

  if (analysis.leverage) {
    lines.push(`杠杆：${analysis.leverage}`);
  }
  if (analysis.orderType) {
    lines.push(`下单方式：${analysis.orderType === "limit" ? "限价单" : "市价单"}`);
  }
  if (analysis.suggestedEntryPrice) {
    lines.push(`参考价格：${analysis.suggestedEntryPrice}`);
  }
  if (analysis.suggestedContracts) {
    lines.push(`建议数量：${analysis.suggestedContracts} 张`);
  } else if (analysis.suggestedMarginQuote) {
    lines.push(`建议保证金：${analysis.suggestedMarginQuote} USDT`);
  }
  if (analysis.complianceComment) {
    lines.push(`AI 规范建议：${analysis.complianceComment}`);
  }
  if (analysis.riskFlags?.length) {
    lines.push(`提醒：${analysis.riskFlags.join("；")}`);
  }

  return lines.join("\n");
}

function buildStructuredSummaryV4(analysis) {
  if (!analysis) {
    return "";
  }

  const messageTypeLabel =
    analysis.messageType === "strategy"
      ? "交易策略"
      : analysis.messageType === "analysis"
        ? "行情分析"
        : analysis.messageType === "watchlist"
          ? "观察提醒"
          : "普通转发";

  const lines = [
    `文案类型：${messageTypeLabel}`,
    `币种：${analysis.asset || "未识别"}`,
    `方向：${analysis.directionLabel || "未识别"}`,
    `入场：${formatEntryForDisplay(analysis)}`,
    `止损：${analysis.stopLoss ?? "未给出"}`,
    `止盈：${formatTakeProfitsForDisplay(analysis)}`,
    `周期：${analysis.timeframe || "未提及"}`,
    `信号强度：${analysis.confidence || "中"}`,
  ];

  if (analysis.semanticSummary) {
    lines.unshift(`语义判断：${analysis.semanticSummary}`);
  }
  if (analysis.executionIntent) {
    lines.push(`执行意图：${analysis.executionIntent}`);
  }
  if (analysis.threadAggregationNote) {
    lines.push(`线程备注：${analysis.threadAggregationNote}`);
  }
  if (analysis.leverage) {
    lines.push(`杠杆：${analysis.leverage}`);
  }
  if (analysis.orderType) {
    lines.push(`下单方式：${analysis.orderType === "limit" ? "限价单" : "市价单"}`);
  }
  if (analysis.suggestedEntryPrice) {
    lines.push(`参考价格：${analysis.suggestedEntryPrice}`);
  }
  if (analysis.suggestedContracts) {
    lines.push(`建议数量：${analysis.suggestedContracts} 张`);
  } else if (analysis.suggestedMarginQuote) {
    lines.push(`建议保证金：${analysis.suggestedMarginQuote} USDT`);
  }
  if (analysis.complianceComment) {
    lines.push(`AI 复核备注：${analysis.complianceComment}`);
  }
  if (analysis.riskFlags?.length) {
    lines.push(`风险提示：${analysis.riskFlags.join("；")}`);
  }

  return lines.join("\n");
}

function formatEntryForDisplay(analysis) {
  if (!analysis?.entryText) {
    return "未给出";
  }
  return analysis.entryText;
}

function formatTakeProfitsForDisplay(analysis) {
  if (!analysis?.takeProfits?.length) {
    return "未给出";
  }
  return analysis.takeProfits.join(" / ");
}

function buildStructuredSummarySafe(analysis) {
  if (!analysis) {
    return "";
  }

  const messageTypeMap = {
    strategy: "交易策略",
    analysis: "行情分析",
    review: "回顾复盘",
    boast: "战绩展示",
    watchlist: "观察提醒",
    brief: "普通转发",
  };

  const lines = [
    `文案类型：${messageTypeMap[analysis.messageType] || "普通转发"}`,
    `币种：${analysis.asset || "未识别"}`,
    `方向：${analysis.directionLabel || "未识别"}`,
    `入场：${analysis.entryText || "未给出"}`,
    `止损：${analysis.stopLoss ?? "未给出"}`,
    `止盈：${analysis.takeProfits?.length ? analysis.takeProfits.join(" / ") : "未给出"}`,
    `周期：${analysis.timeframe || "未提及"}`,
    `信号强度：${analysis.confidence || "中"}`,
  ];

  if (analysis.semanticSummary) {
    lines.unshift(`语义判断：${analysis.semanticSummary}`);
  }
  if (analysis.executionIntent) {
    lines.push(`执行意图：${analysis.executionIntent}`);
  }
  if (analysis.instructionType) {
    lines.push(`操作类型：${analysis.instructionType}`);
  }
  if (analysis.contentNature) {
    lines.push(`内容性质：${analysis.contentNature}`);
  }
  if (analysis.threadAggregationNote) {
    lines.push(`线程备注：${analysis.threadAggregationNote}`);
  }
  if (analysis.leverage) {
    lines.push(`杠杆：${analysis.leverage}`);
  }
  if (analysis.orderType) {
    lines.push(`下单方式：${analysis.orderType === "limit" ? "限价单" : "市价单"}`);
  }
  if (analysis.suggestedEntryPrice) {
    lines.push(`参考价格：${analysis.suggestedEntryPrice}`);
  }
  if (analysis.suggestedContracts) {
    lines.push(`建议数量：${analysis.suggestedContracts} 张`);
  } else if (analysis.suggestedMarginQuote) {
    lines.push(`建议保证金：${analysis.suggestedMarginQuote} USDT`);
  }
  if (analysis.complianceComment) {
    lines.push(`AI 复核备注：${analysis.complianceComment}`);
  }
  if (analysis.rejectionReason) {
    lines.push(`拒绝原因：${analysis.rejectionReason}`);
  }
  if (analysis.riskFlags?.length) {
    lines.push(`风险提示：${analysis.riskFlags.join("；")}`);
  }

  return lines.join("\n");
}

function scoreSignal(text, matchedCount, sourceType, analysis) {
  let score = 0.45;
  score += Math.min(matchedCount * 0.12, 0.36);
  if (/\b(breaking|urgent|exploit|hack|approved|listing)\b/i.test(text)) {
    score += 0.12;
  }
  if (/\$[A-Z]{2,10}\b/.test(text)) {
    score += 0.1;
  }
  if (sourceType === "analyst") {
    score += 0.08;
  }
  if (analysis?.actionable) {
    score += 0.08;
  }
  if (String(text || "").trim().length < 15) {
    score -= 0.08;
  }
  return clamp(score, 0.01, 0.99);
}

function matchesPlaybook(signal, playbook) {
  if (!playbook.enabled) {
    return false;
  }
  if (playbook.sourceTypes?.length && !playbook.sourceTypes.includes(signal.sourceType)) {
    return false;
  }
  if (playbook.chatIds?.length && !playbook.chatIds.includes(signal.chatId)) {
    return false;
  }
  if (playbook.sourceNames?.length && !playbook.sourceNames.includes(signal.sourceName)) {
    return false;
  }

  const haystack = normalizeText(signal.text);
  const anyKeywords = playbook.keywordsAny || [];
  const allKeywords = playbook.keywordsAll || [];
  const excludedKeywords = playbook.excludedKeywords || [];

  if (excludedKeywords.some((item) => haystack.includes(item.toLowerCase()))) {
    return false;
  }
  if (anyKeywords.length && !anyKeywords.some((item) => haystack.includes(item.toLowerCase()))) {
    return false;
  }
  if (allKeywords.length && !allKeywords.every((item) => haystack.includes(item.toLowerCase()))) {
    return false;
  }
  return true;
}

export function buildAnalystPrivacyAlias(chatId) {
  const suffix = String(chatId || "").replace(/\D/g, "").slice(-4);
  return suffix ? `分析师专线-${suffix}` : "分析师专线";
}

export function sanitizeAnalystText(text) {
  return String(text || "")
    .replace(/https?:\/\/\S+/gi, "[链接已隐藏]")
    .replace(/\bt\.me\/\S+/gi, "[链接已隐藏]")
    .replace(/@\w{3,}/g, "@***")
    .replace(/\b(?:vx|wx|wechat|telegram|tg)\s*[:：]?\s*[\w.-]{3,}\b/gi, "[联系方式已隐藏]")
    .replace(/(?:微信|电报|飞机|频道|社群|联系)\s*[:：]?\s*[@\w.-]{3,}/g, "[联系方式已隐藏]")
    .replace(/\b1\d{10}\b/g, "[手机号已隐藏]");
}

function buildSignalPresentation(baseSignal) {
  if (baseSignal.sourceType !== "analyst") {
    return {
      displaySourceName: baseSignal.sourceName,
      displayText: baseSignal.text,
    };
  }

  return {
    displaySourceName: buildAnalystPrivacyAlias(baseSignal.chatId),
    displayText: sanitizeAnalystText(baseSignal.text),
  };
}

function parseChatId(message) {
  return message?.chat?.id ? String(message.chat.id) : "";
}

function getTelegramMessage(update) {
  return update?.channel_post || update?.message || update?.edited_channel_post || null;
}

export function createSignalFromTelegramMessage(message, config) {
  if (!message) {
    return null;
  }

  const text = message.text || message.caption || "";
  const media = Array.isArray(message.media) ? message.media : [];
  if (!text.trim() && !media.length) {
    return null;
  }

  const chatId = parseChatId(message);
  if (config.telegram.allowedChatIds.length && !config.telegram.allowedChatIds.includes(chatId)) {
    return null;
  }

  let sourceType = "news";
  if (config.telegram.analystChatIds.includes(chatId)) {
    sourceType = "analyst";
  } else if (config.telegram.newsChatIds.includes(chatId)) {
    sourceType = "news";
  }

  return {
    sourceType,
    sourceName: message.chat?.title || message.chat?.username || chatId || "telegram",
    chatId,
    text,
    media,
    publishedAt: new Date((message.date || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
  };
}

export function createSignalFromTelegram(update, config) {
  return createSignalFromTelegramMessage(getTelegramMessage(update), config);
}

export function createSignalFromPayload(payload) {
  const text = String(payload.text || "");
  if (!text.trim()) {
    return null;
  }

  return {
    sourceType: payload.sourceType || "news",
    sourceName: payload.sourceName || "external-webhook",
    chatId: String(payload.chatId || ""),
    text,
    publishedAt: payload.publishedAt || new Date().toISOString(),
  };
}

export function evaluateSignal(baseSignal, playbooks, config, store) {
  const normalized = [normalizeText(baseSignal.text), normalizeMediaFingerprint(baseSignal.media)]
    .filter(Boolean)
    .join(" ");
  const normalizedHash = hashText(normalized);
  const presentation = buildSignalPresentation(baseSignal);
  const duplicate = store.findRecentDuplicate(normalizedHash, config.dedupWindowSec);

  if (duplicate) {
    return {
      skipped: true,
      reason: `在去重时间窗内命中重复信号：${duplicate.id}`,
    };
  }

  const matched = playbooks.filter((playbook) => matchesPlaybook(baseSignal, playbook));
  const selectedPlaybook = matched[0] || null;
  const analysis =
    baseSignal.sourceType === "analyst"
      ? buildStructuredStrategy(baseSignal.text, baseSignal.sourceType)
      : null;
  if (analysis) {
    analysis.normalizedSummary = buildStructuredSummarySafe(analysis);
  }

  const score = scoreSignal(baseSignal.text, matched.length, baseSignal.sourceType, analysis);

  return {
    skipped: false,
    signal: {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      normalizedHash,
      sourceType: baseSignal.sourceType,
      sourceName: baseSignal.sourceName,
      displaySourceName: presentation.displaySourceName,
      deliveryDisplayName: "",
      chatId: baseSignal.chatId,
      threadId: baseSignal.threadId || "",
      threadMessageCount: Number(baseSignal.threadMessageCount || 1),
      threadAggregationNote: baseSignal.threadAggregationNote || "",
      contextText: baseSignal.contextText || "",
      publishedAt: baseSignal.publishedAt,
      text: baseSignal.text,
      displayText: presentation.displayText,
      media: Array.isArray(baseSignal.media) ? baseSignal.media : [],
      score,
      matchedPlaybookIds: matched.map((playbook) => playbook.id),
      selectedPlaybookId: selectedPlaybook?.id || "",
      playbookNotes: selectedPlaybook?.notes || "",
      analysis,
      tradeIdea: null,
      analystFollowConfig: null,
      executionStatus: "notify_only",
      executionReason: baseSignal.sourceType === "analyst"
        ? "纯转发模式：分析师消息经过去噪后转发"
        : "纯转发模式：消息经过去噪后转发",
      reviewedAt: "",
      reviewDecision: "",
      executionResult: null,
    },
  };
}
