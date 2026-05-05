const BROKEN_SUBSTRINGS = [
  "\u5206\u6790",
  "\u4e09\u9a6c",
  "\u6d2a\u4e03",
  "\u6613\u76c8",
  "\u96f6\u4e0b",
  "\u8212\u7434",
  "\u71ac\u9e70",
  "btc\u4e54\u4e54",
  "\u5927\u6f02\u4eae",
  "\u5df2\u8fde\u63a5",
  "\u5c1a\u672a",
  "\u5e02\u4ef7\u5355",
  "\u9650\u4ef7\u5355",
  "\u6765\u6e90",
  "\u8bc4\u5206",
  "\u547d\u4e2d\u7b56\u7565",
  "\u5f53\u524d\u72b6\u6001",
  "\u7b49\u5f85",
];

export function looksBrokenChineseText(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return false;
  }
  if (/^\?{2,}$/.test(text)) {
    return true;
  }
  if (text.includes("\ufffd")) {
    return true;
  }
  return BROKEN_SUBSTRINGS.some((token) => text.includes(token));
}

export function coerceCleanChineseText(value, fallback = "") {
  const text = String(value ?? "").trim();
  if (!text) {
    return String(fallback ?? "").trim();
  }
  return looksBrokenChineseText(text) ? String(fallback ?? "").trim() : text;
}

export function buildAnalystRouteDisplayName(chatId, labelOrTitle = "") {
  const base = coerceCleanChineseText(labelOrTitle, "").trim();
  if (base) {
    return `${base}\u7b56\u7565\u4e13\u7ebf`;
  }
  return `\u5206\u6790\u5e08\u4e13\u7ebf${String(chatId || "").slice(-4)}`;
}

export function resolveAnalystRouteDisplayName(value, { chatId, label, title } = {}) {
  const fallback = buildAnalystRouteDisplayName(chatId, label || title || "");
  return coerceCleanChineseText(value, fallback);
}
