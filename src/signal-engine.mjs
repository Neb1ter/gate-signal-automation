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

function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
  "买入",
  "做多",
  "开多",
  "低多",
  "看多",
  "接多",
  "多单",
  "抄底",
  "建仓",
  "加仓",
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
  "卖出",
  "止盈",
  "减仓",
  "清仓",
  "止损离场",
  "做空",
  "开空",
  "高空",
  "看空",
  "空单",
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
    /(\d[\d,]*(?:\.\d+)?)\s*(?:-|~|—|到|至)\s*(\d[\d,]*(?:\.\d+)?)/,
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
    /(?:入场|进场|建仓|买入|卖出|做多|做空|参考|关注|现价|回踩|突破)\s*(?:区间|位置|附近|价位|点位)?\s*[:：]?\s*([^\n。；;]+)/i,
    /(?:区间|位置)\s*[:：]?\s*(\d[\d,.]*(?:\s*(?:-|~|—|到|至)\s*\d[\d,.]*)?)/i,
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
    /(?:止盈|目标|target|tp\d*)\s*(?:位|价|区间)?\s*[:：]?\s*([^\n。；;]+)/gi,
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
  const match = String(text || "").match(/(\d{1,3})\s*[xX倍]/);
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
    /(?:区间|位置)\s*[:：]?\s*(\d[\d,.]*(?:\s*(?:-|~|到|至)\s*\d[\d,.]*)?)/i,
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
  const actionable = Boolean(asset && direction.side);

  return {
    parser: "heuristic-v2",
    messageType,
    asset,
    symbol,
    direction: direction.side,
    directionLabel: direction.label,
    entryText: entry?.text || "",
    entryLow: entry?.low ?? null,
    entryHigh: entry?.high ?? null,
    stopLoss,
    takeProfits,
    leverage,
    orderType,
    suggestedEntryPrice: getDefaultEntryPrice(entry),
    suggestedMarginQuote,
    suggestedContracts,
    timeframe,
    confidence,
    actionable,
    riskFlags,
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
  if (analysis.riskFlags?.length) {
    lines.push(`提醒：${analysis.riskFlags.join("；")}`);
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

function buildTradeIdeaV2(baseSignal, analysis, selectedPlaybook, analystConfig = {}) {
  if (!analysis?.actionable || !analysis.symbol) {
    return null;
  }

  const defaults = selectedPlaybook?.action || {};
  const side = analysis.direction || defaults.side || "";
  if (!["buy", "sell"].includes(side)) {
    return null;
  }

  const orderType =
    analysis.orderType || (String(defaults.kind || "").includes("limit") ? "limit" : "market");
  const tradeIdea = {
    kind: orderType === "limit" ? "futures_limit" : "futures_market",
    symbol: analysis.symbol,
    contract: analysis.symbol,
    side,
    settle: defaults.settle || "usdt",
    orderType,
    timeInForce: defaults.timeInForce || (orderType === "limit" ? "gtc" : "ioc"),
    account: defaults.account || "futures",
    leverage: String(analysis.leverage || defaults.leverage || "5").replace(/x$/i, ""),
    clientOrderId: `t-analyst-${Date.now().toString().slice(-8)}`,
  };

  if (analysis.suggestedContracts) {
    tradeIdea.size = analysis.suggestedContracts;
  }
  if (analysis.suggestedMarginQuote) {
    tradeIdea.marginQuote = analysis.suggestedMarginQuote;
  } else {
    tradeIdea.marginQuote = analystConfig.amountQuote || defaults.amountQuote || "100";
  }
  if (analysis.suggestedEntryPrice) {
    tradeIdea.price = analysis.suggestedEntryPrice;
  }

  const amountText = tradeIdea.size
    ? `默认数量 ${tradeIdea.size} 张`
    : `默认保证金 ${tradeIdea.marginQuote} USDT`;
  const detailParts = [orderType === "limit" ? "限价单" : "市价单", `${tradeIdea.leverage}x 杠杆`];

  if (analysis.entryText) {
    detailParts.push(`入场 ${analysis.entryText}`);
  }
  if (analysis.stopLoss !== null) {
    detailParts.push(`止损 ${analysis.stopLoss}`);
  }
  if (analysis.takeProfits?.length) {
    detailParts.push(`止盈 ${analysis.takeProfits.join("/")}`);
  }

  tradeIdea.summary = `${side === "buy" ? "合约做多" : "合约做空"} ${tradeIdea.symbol}，${amountText}${
    detailParts.length ? `，${detailParts.join("，")}` : ""
  }`;

  return tradeIdea;
}

function buildPlaybookTradeIdeaV2(playbook, asset, analysis) {
  if (!playbook?.action) {
    return null;
  }

  const action = { ...playbook.action };
  action.symbol =
    analysis?.symbol ||
    action.symbol ||
    String(playbook.symbolTemplate || "").replaceAll("{{asset}}", asset || analysis?.asset || "");
  action.contract = action.contract || action.symbol;
  action.clientOrderId = `t-${playbook.id.slice(0, 10)}-${Date.now().toString().slice(-8)}`;
  action.settle = action.settle || "usdt";
  action.orderType =
    analysis?.orderType || action.orderType || (String(action.kind || "").includes("limit") ? "limit" : "market");
  action.kind = action.orderType === "limit" ? "futures_limit" : "futures_market";
  action.leverage = String(analysis?.leverage || action.leverage || "5").replace(/x$/i, "");

  if (analysis?.direction && ["buy", "sell"].includes(analysis.direction)) {
    action.side = analysis.direction;
  }
  if (analysis?.suggestedEntryPrice) {
    action.price = analysis.suggestedEntryPrice;
  }
  if (analysis?.suggestedContracts) {
    action.size = analysis.suggestedContracts;
  }
  if (analysis?.suggestedMarginQuote) {
    action.marginQuote = analysis.suggestedMarginQuote;
  }
  if (!action.marginQuote) {
    action.marginQuote = action.amountQuote || "100";
  }

  const amountSummary = action.size
    ? `数量 ${action.size} 张`
    : `保证金 ${action.marginQuote} USDT`;
  const detailParts = [
    action.orderType === "limit" ? "限价单" : "市价单",
    `${action.leverage}x 杠杆`,
  ];

  if (analysis?.entryText) {
    detailParts.push(`入场 ${analysis.entryText}`);
  }
  if (analysis?.stopLoss != null) {
    detailParts.push(`止损 ${analysis.stopLoss}`);
  }
  if (analysis?.takeProfits?.length) {
    detailParts.push(`止盈 ${analysis.takeProfits.join("/")}`);
  }

  action.summary = `${action.side === "buy" ? "合约做多" : "合约做空"} ${action.symbol}，${amountSummary}${
    detailParts.length ? `，${detailParts.join("，")}` : ""
  }`;
  return action;
}

function extractAssetFromPlaybook(text, playbook) {
  if (playbook?.assetHintRegex) {
    const match = String(text || "").match(new RegExp(playbook.assetHintRegex, "i"));
    if (match) {
      const candidate = match.slice(1).find(Boolean);
      if (candidate) {
        return candidate.toUpperCase();
      }
    }
  }
  return extractAsset(text);
}

function buildPlaybookTradeIdea(playbook, asset, analysis) {
  if (!playbook?.action) {
    return null;
  }

  const action = { ...playbook.action };
  action.symbol =
    analysis?.symbol ||
    action.symbol ||
    String(playbook.symbolTemplate || "").replaceAll("{{asset}}", asset || analysis?.asset || "");
  action.clientOrderId = `t-${playbook.id.slice(0, 10)}-${Date.now().toString().slice(-8)}`;

  if (analysis?.direction && ["buy", "sell"].includes(analysis.direction)) {
    action.side = analysis.direction;
  }

  const amountSummary =
    action.side === "buy"
      ? `投入 ${action.amountQuote || "100"} USDT`
      : action.amountBase === "ALL"
        ? "卖出现货可用仓位"
        : `卖出 ${action.amountBase}`;

  const detailParts = [];
  if (analysis?.entryText) {
    detailParts.push(`入场 ${analysis.entryText}`);
  }
  if (analysis?.stopLoss != null) {
    detailParts.push(`止损 ${analysis.stopLoss}`);
  }
  if (analysis?.takeProfits?.length) {
    detailParts.push(`止盈 ${analysis.takeProfits.join("/")}`);
  }

  action.summary = `${action.side === "buy" ? "现货买入" : "现货卖出"} ${action.symbol}，${amountSummary}${
    detailParts.length ? `；${detailParts.join("；")}` : ""
  }`;
  return action;
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

function getDailyRiskSnapshot(store) {
  const datePrefix = new Date().toISOString().slice(0, 10);
  const trades = store.listTradesForDatePrefix(datePrefix);
  return {
    count: trades.length,
    notional: trades.reduce((sum, trade) => sum + (Number(trade.notionalUsd) || 0), 0),
  };
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
  if (!text.trim()) {
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
  const normalized = normalizeText(baseSignal.text);
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
  const runtimeSettings = store.getRuntimeSettings({
    telegram: {
      allowedChatIds: [],
      analystChatIds: [],
      newsChatIds: [],
    },
    feishu: {
      analystRoutes: [],
    },
    analysts: {
      configs: [],
    },
    execution: {
      newsMode: "auto",
    },
  });
  const analystConfig =
    runtimeSettings.analysts?.configs?.find(
      (item) => String(item.chatId || "") === String(baseSignal.chatId || ""),
    ) || null;
  const analysis =
    baseSignal.sourceType === "analyst"
      ? buildStructuredStrategy(baseSignal.text, baseSignal.sourceType)
      : null;
  if (analysis) {
    analysis.normalizedSummary = buildStructuredSummaryV3(analysis);
  }

  const score = scoreSignal(baseSignal.text, matched.length, baseSignal.sourceType, analysis);
  const asset = selectedPlaybook ? extractAssetFromPlaybook(baseSignal.text, selectedPlaybook) : "";
  const tradeIdea = selectedPlaybook
    ? buildPlaybookTradeIdeaV2(selectedPlaybook, asset, analysis)
    : buildTradeIdeaV2(baseSignal, analysis, selectedPlaybook, analystConfig || {});
  const risk = getDailyRiskSnapshot(store);

  let executionStatus = "notify_only";
  let executionReason = "没有命中可执行策略，这条消息只做提醒";
  let finalTradeIdea = tradeIdea;

  if (baseSignal.sourceType === "analyst") {
    const allowedSymbols = Array.isArray(analystConfig?.allowedSymbols)
      ? analystConfig.allowedSymbols
      : [];
    const symbolAllowed =
      !finalTradeIdea?.symbol ||
      !allowedSymbols.length ||
      allowedSymbols.includes(String(finalTradeIdea.symbol || "").split("_")[0]?.toUpperCase());

    if (analystConfig?.enabled === false) {
      finalTradeIdea = null;
      executionStatus = "notify_only";
      executionReason = "该分析师已关闭自动跟单，只保留消息转发";
    } else if (finalTradeIdea && !symbolAllowed) {
      finalTradeIdea = null;
      executionStatus = "notify_only";
      executionReason = "该分析师当前只允许白名单币种，已转为提醒";
    } else {
      executionStatus = "pending_approval";
      executionReason = finalTradeIdea
        ? "已提炼为结构化交易建议，等待你确认是否跟单"
        : "已转为结构化行情摘要，但暂未抽取出可执行下单参数";
    }
  } else if (selectedPlaybook && tradeIdea) {
    const notionalEstimate =
      Number.parseFloat(tradeIdea.marginQuote || tradeIdea.amountQuote || "") ||
      Number.parseFloat(tradeIdea.amountBase || "") ||
      0;
    const dailyTradeLimitReached = risk.count >= config.maxDailyTrades;
    const dailyNotionalLimitReached = risk.notional + notionalEstimate > config.maxDailyNotionalUsd;
    const forceManualForNews =
      baseSignal.sourceType === "news" && runtimeSettings.execution.newsMode === "manual";

    if (dailyTradeLimitReached || dailyNotionalLimitReached) {
      executionStatus = "blocked_risk";
      executionReason = dailyTradeLimitReached ? "已达到当日交易次数上限" : "已达到当日交易金额上限";
    } else if (selectedPlaybook.approvalRequired) {
      executionStatus = "pending_approval";
      executionReason = "等待你手动确认";
    } else if (forceManualForNews) {
      executionStatus = "pending_approval";
      executionReason = "新闻已切换到手动确认模式";
    } else if (selectedPlaybook.autoExecute && score >= (selectedPlaybook.minScore || 0.8)) {
      executionStatus = config.autoExecutionEnabled ? "ready_for_execution" : "dry_run_ready";
      executionReason = config.autoExecutionEnabled
        ? "已命中自动交易条件"
        : "已命中自动交易条件，但全局自动执行开关未开启";
    } else {
      executionStatus = "notify_only";
      executionReason = "命中了策略，但当前配置为只提醒";
    }
  }

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
      publishedAt: baseSignal.publishedAt,
      text: baseSignal.text,
      displayText: presentation.displayText,
      score,
      matchedPlaybookIds: matched.map((playbook) => playbook.id),
      selectedPlaybookId: selectedPlaybook?.id || "",
      playbookNotes: selectedPlaybook?.notes || "",
      analysis,
      tradeIdea: finalTradeIdea,
      analystFollowConfig: analystConfig
        ? {
            enabled: analystConfig.enabled !== false,
            amountQuote: analystConfig.amountQuote || "100",
            allowedSymbols: analystConfig.allowedSymbols || [],
          }
        : null,
      executionStatus,
      executionReason,
      reviewedAt: "",
      reviewDecision: "",
      executionResult: null,
    },
  };
}

export function applyAiAnalysis(signal, aiAnalysis) {
  if (!signal?.analysis || !aiAnalysis || typeof aiAnalysis !== "object") {
    return signal;
  }

  const nextAnalysis = {
    ...signal.analysis,
    parser: aiAnalysis.parser || "ai-review",
    messageType: aiAnalysis.messageType || signal.analysis.messageType,
    asset: aiAnalysis.asset || signal.analysis.asset,
    symbol: aiAnalysis.symbol || signal.analysis.symbol,
    direction: aiAnalysis.direction || signal.analysis.direction,
    directionLabel: aiAnalysis.directionLabel || signal.analysis.directionLabel,
    entryText: aiAnalysis.entryText || signal.analysis.entryText,
    entryLow: aiAnalysis.entryLow ?? signal.analysis.entryLow,
    entryHigh: aiAnalysis.entryHigh ?? signal.analysis.entryHigh,
    stopLoss: aiAnalysis.stopLoss ?? signal.analysis.stopLoss,
    takeProfits:
      Array.isArray(aiAnalysis.takeProfits) && aiAnalysis.takeProfits.length
        ? aiAnalysis.takeProfits
        : signal.analysis.takeProfits,
    leverage: aiAnalysis.leverage || signal.analysis.leverage,
    orderType: aiAnalysis.orderType || signal.analysis.orderType,
    suggestedEntryPrice: aiAnalysis.suggestedEntryPrice || signal.analysis.suggestedEntryPrice,
    suggestedMarginQuote: aiAnalysis.suggestedMarginQuote || signal.analysis.suggestedMarginQuote,
    suggestedContracts: aiAnalysis.suggestedContracts || signal.analysis.suggestedContracts,
    timeframe: aiAnalysis.timeframe || signal.analysis.timeframe,
    confidence: aiAnalysis.confidence || signal.analysis.confidence,
    actionable: Boolean(
      aiAnalysis.actionable ??
        signal.analysis.actionable ??
        ((aiAnalysis.asset || signal.analysis.asset) && (aiAnalysis.direction || signal.analysis.direction)),
    ),
    complianceComment: aiAnalysis.complianceComment || signal.analysis.complianceComment || "",
    riskFlags: unique([...(signal.analysis.riskFlags || []), ...(aiAnalysis.riskFlags || [])]),
  };

  nextAnalysis.normalizedSummary = buildStructuredSummaryV3(nextAnalysis);
  signal.analysis = nextAnalysis;

  if (!signal.tradeIdea) {
    signal.tradeIdea = buildTradeIdeaV2(signal, nextAnalysis, null);
  } else if (nextAnalysis.symbol || nextAnalysis.direction) {
    const rebuilt = buildTradeIdeaV2(signal, nextAnalysis, null);
    signal.tradeIdea = {
      ...signal.tradeIdea,
      symbol: nextAnalysis.symbol || signal.tradeIdea.symbol,
      contract: rebuilt?.contract || signal.tradeIdea.contract,
      side: nextAnalysis.direction || signal.tradeIdea.side,
      orderType: rebuilt?.orderType || signal.tradeIdea.orderType,
      leverage: rebuilt?.leverage || signal.tradeIdea.leverage,
      price: rebuilt?.price || signal.tradeIdea.price,
      marginQuote: rebuilt?.marginQuote || signal.tradeIdea.marginQuote,
      size: rebuilt?.size || signal.tradeIdea.size,
      summary: rebuilt?.summary || signal.tradeIdea.summary,
    };
  }

  if (signal.sourceType === "analyst") {
    signal.executionStatus = "pending_approval";
    signal.executionReason = signal.tradeIdea
      ? "AI 已补充结构化建议，等待你确认是否跟单"
      : "AI 已补充结构化摘要，但仍未形成可执行下单参数";
  }

  if (signal.sourceType === "analyst") {
    signal.executionReason = signal.tradeIdea
      ? "AI 已补充结构化建议，等待你确认是否跟单"
      : "AI 已补充结构化摘要，但仍未形成可执行下单参数";
  }

  return signal;
}

function renderSignalReviewPageV2(signal, token, options = {}) {
  const sourceLabel = signal.deliveryDisplayName || signal.displaySourceName || signal.sourceName;
  const displayText = signal.displayText || signal.text;
  const preview = options.preview || {};
  const tradeIdea = signal.tradeIdea || {};
  const title = signal.sourceType === "analyst" ? "分析师策略确认" : "新闻交易确认";
  const orderType = tradeIdea.orderType || (String(tradeIdea.kind || "").includes("limit") ? "limit" : "market");
  const leverage = String(tradeIdea.leverage || preview.leverage || "5").replace(/x$/i, "");
  const size = tradeIdea.size || preview.estimatedContracts || "";
  const price = tradeIdea.price || preview.referencePrice || "";
  const marginQuote = tradeIdea.marginQuote || tradeIdea.amountQuote || preview.marginQuote || "";
  const structuredBlock = signal.analysis?.normalizedSummary
    ? `<div class="structured"><h2>结构化摘要</h2><pre>${escapeHtml(signal.analysis.normalizedSummary)}</pre></div>`
    : "";

  const tradeBlock = signal.tradeIdea
    ? `<div class="trade-hero">
        <div class="trade-title">${escapeHtml(signal.tradeIdea.summary || "已生成交易建议")}</div>
        <div class="trade-subtitle">默认已带入分析师的指导价格、杠杆和数量；你确认前还可以继续修改。</div>
      </div>`
    : `<div class="trade-hero">
        <div class="trade-title">暂未生成可执行订单</div>
        <div class="trade-subtitle">这条消息会保留为结构化分析，不会直接跟单。</div>
      </div>`;

  const orderTypeExplain =
    orderType === "limit"
      ? "限价单：按你填写的价格挂单，价格没到不会成交。"
      : "市价单：按当前市场最优价尽快成交，速度更快，但成交价可能有滑点。";

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; padding: 24px; max-width: 980px; margin: 0 auto; background: #f7f9fc; color: #182233; }
      .card { border: 1px solid #dbe3ef; background: #fff; border-radius: 18px; padding: 24px; box-shadow: 0 14px 32px rgba(18, 36, 73, 0.08); }
      .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 18px; margin-bottom: 18px; }
      .meta-item, .field-card { background: #f8fbff; border: 1px solid #e3e9f3; border-radius: 12px; padding: 12px; }
      .trade-hero { margin: 18px 0; padding: 18px; border-radius: 16px; background: linear-gradient(135deg, #0f6fff 0%, #2a8cff 100%); color: #fff; }
      .trade-title { font-size: 24px; font-weight: 800; line-height: 1.35; }
      .trade-subtitle { margin-top: 8px; font-size: 14px; opacity: 0.92; }
      .structured { margin: 18px 0; }
      .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 18px; }
      .full { grid-column: 1 / -1; }
      label { display: block; font-weight: 700; margin-bottom: 8px; }
      input, select { width: 100%; box-sizing: border-box; padding: 12px; border-radius: 12px; border: 1px solid #cad6e7; font: inherit; background: #fff; }
      .hint { font-size: 13px; color: #5b6a82; margin-top: 6px; }
      .actions { display: flex; gap: 12px; margin-top: 20px; }
      button { padding: 12px 20px; border-radius: 12px; border: 0; cursor: pointer; font: inherit; }
      .approve { background: #0f6fff; color: white; font-weight: 700; }
      .reject { background: #eef2f7; color: #253047; }
      pre { white-space: pre-wrap; word-break: break-word; background: #f7f9fc; padding: 12px; border-radius: 10px; border: 1px solid #e3e9f3; }
      .callout { margin-top: 14px; padding: 14px 16px; border-radius: 12px; background: #fff6df; border: 1px solid #f1d48b; color: #6d5200; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">
        <div class="meta-item"><strong>来源：</strong>${escapeHtml(sourceLabel)}</div>
        <div class="meta-item"><strong>评分：</strong>${signal.score.toFixed(2)}</div>
        <div class="meta-item"><strong>命中策略：</strong>${escapeHtml(signal.matchedPlaybookIds.join(", ") || "无")}</div>
        <div class="meta-item"><strong>当前状态：</strong>${escapeHtml(signal.executionReason || "待处理")}</div>
      </div>
      ${tradeBlock}
      ${structuredBlock}
      <div class="callout">${escapeHtml(orderTypeExplain)}</div>
      <form method="post" action="/signals/${signal.id}/approve?token=${encodeURIComponent(token)}">
        <div class="form-grid">
          <div class="field-card">
            <label for="orderType">订单类型</label>
            <select id="orderType" name="orderType">
              <option value="market" ${orderType === "market" ? "selected" : ""}>市价单</option>
              <option value="limit" ${orderType === "limit" ? "selected" : ""}>限价单</option>
            </select>
          </div>
          <div class="field-card">
            <label for="side">方向</label>
            <select id="side" name="side">
              <option value="buy" ${tradeIdea.side === "buy" ? "selected" : ""}>做多 / 开多</option>
              <option value="sell" ${tradeIdea.side === "sell" ? "selected" : ""}>做空 / 开空</option>
            </select>
          </div>
          <div class="field-card">
            <label for="leverage">杠杆</label>
            <input id="leverage" name="leverage" type="number" min="1" max="100" step="1" value="${escapeHtml(leverage)}" />
          </div>
          <div class="field-card">
            <label for="size">数量（张）</label>
            <input id="size" name="size" type="number" min="1" step="1" value="${escapeHtml(size)}" />
            <div class="hint">默认优先使用分析师给出的数量；如果原文没给数量，会按默认保证金和杠杆估算。</div>
          </div>
          <div class="field-card">
            <label for="price">价格</label>
            <input id="price" name="price" type="number" min="0" step="0.0001" value="${escapeHtml(price)}" />
            <div class="hint">限价单会按这个价格挂单；市价单会忽略这里的价格。</div>
          </div>
          <div class="field-card">
            <label for="marginQuote">保证金（USDT）</label>
            <input id="marginQuote" name="marginQuote" type="number" min="0" step="0.01" value="${escapeHtml(marginQuote)}" />
            <div class="hint">如果你不手填数量，系统会用 保证金 × 杠杆 / 合约面值 估算张数。</div>
          </div>
          <input type="hidden" name="symbol" value="${escapeHtml(tradeIdea.symbol || "")}" />
          <input type="hidden" name="contract" value="${escapeHtml(tradeIdea.contract || tradeIdea.symbol || "")}" />
          <input type="hidden" name="settle" value="${escapeHtml(tradeIdea.settle || "usdt")}" />
          <input type="hidden" name="timeInForce" value="${escapeHtml(tradeIdea.timeInForce || "")}" />
          <div class="field-card full">
            <label>脱敏原文</label>
            <pre>${escapeHtml(displayText)}</pre>
          </div>
        </div>
        <div class="actions">
          <button class="approve" type="submit">确认跟单</button>
        </div>
      </form>
      <div class="actions">
        <form method="post" action="/signals/${signal.id}/reject?token=${encodeURIComponent(token)}">
          <button class="reject" type="submit">忽略这单</button>
        </form>
      </div>
    </div>
  </body>
</html>`;
}

export function renderSignalReviewPage(signal, token, options = {}) {
  return renderSignalReviewPageV2(signal, token, options);
  const sourceLabel = signal.deliveryDisplayName || signal.displaySourceName || signal.sourceName;
  const displayText = signal.displayText || signal.text;
  const structuredBlock = signal.analysis?.normalizedSummary
    ? `<div class="structured"><h2>结构化摘要</h2><pre>${escapeHtml(signal.analysis.normalizedSummary)}</pre></div>`
    : "";
  const tradeBlock = signal.tradeIdea
    ? `<p><strong>交易建议：</strong>${escapeHtml(signal.tradeIdea.summary)}</p>`
    : "<p><strong>交易建议：</strong>暂未生成可执行订单</p>";

  const title = signal.sourceType === "analyst" ? "分析师策略确认" : "新闻交易确认";

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; padding: 24px; max-width: 860px; margin: 0 auto; background: #f7f9fc; color: #182233; }
      .card { border: 1px solid #dbe3ef; background: #fff; border-radius: 18px; padding: 24px; box-shadow: 0 14px 32px rgba(18, 36, 73, 0.08); }
      .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 18px; margin-bottom: 18px; }
      .meta-item { background: #f8fbff; border: 1px solid #e3e9f3; border-radius: 12px; padding: 12px; }
      h1, h2 { margin: 0 0 10px; }
      .structured { margin: 18px 0; }
      .actions { display: flex; gap: 12px; margin-top: 20px; }
      button { padding: 12px 20px; border-radius: 12px; border: 0; cursor: pointer; font: inherit; }
      .approve { background: #0f6fff; color: white; }
      .reject { background: #eef2f7; color: #253047; }
      pre { white-space: pre-wrap; word-break: break-word; background: #f7f9fc; padding: 12px; border-radius: 10px; border: 1px solid #e3e9f3; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">
        <div class="meta-item"><strong>来源：</strong>${escapeHtml(sourceLabel)}</div>
        <div class="meta-item"><strong>评分：</strong>${signal.score.toFixed(2)}</div>
        <div class="meta-item"><strong>命中策略：</strong>${escapeHtml(signal.matchedPlaybookIds.join(", ") || "无")}</div>
        <div class="meta-item"><strong>当前状态：</strong>${escapeHtml(signal.executionReason || "待处理")}</div>
      </div>
      ${tradeBlock}
      ${structuredBlock}
      <h2>脱敏原文</h2>
      <pre>${escapeHtml(displayText)}</pre>
      <div class="actions">
        <form method="post" action="/signals/${signal.id}/approve?token=${encodeURIComponent(token)}">
          <button class="approve" type="submit">确认跟单</button>
        </form>
        <form method="post" action="/signals/${signal.id}/reject?token=${encodeURIComponent(token)}">
          <button class="reject" type="submit">忽略这单</button>
        </form>
      </div>
    </div>
  </body>
</html>`;
}
