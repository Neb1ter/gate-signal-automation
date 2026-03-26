const BROKEN_SUBSTRINGS = [
  "鍒嗘瀽",
  "涓夐┈",
  "娲竷",
  "鏄撶泩",
  "闆朵笅",
  "鑸掔惔",
  "鐔拱",
  "btc涔斾箶",
  "澶ф紓浜",
  "宸茶繛鎺",
  "灏氭湭",
  "甯備环鍗",
  "闄愪环鍗",
  "鏉ユ簮",
  "璇勫垎",
  "鍛戒腑绛栫暐",
  "褰撳墠鐘舵",
  "绛夊緟",
];

export function looksBrokenChineseText(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return false;
  }
  if (/^\?{2,}$/.test(text)) {
    return true;
  }
  if (text.includes("�")) {
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
    return `${base}策略专线`;
  }
  return `分析师专线${String(chatId || "").slice(-4)}`;
}

export function resolveAnalystRouteDisplayName(value, { chatId, label, title } = {}) {
  const fallback = buildAnalystRouteDisplayName(chatId, label || title || "");
  return coerceCleanChineseText(value, fallback);
}
