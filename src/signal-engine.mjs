import crypto from "node:crypto";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(text) {
  return (text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function buildAnalystPrivacyAlias(chatId) {
  const suffix = String(chatId || "").replace(/\D/g, "").slice(-4);
  return suffix ? `分析师专线 ${suffix}` : "分析师专线";
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

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

function scoreSignal(text, matchedCount, sourceType) {
  const normalized = normalizeText(text);
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
  if (normalized.length < 15) {
    score -= 0.08;
  }
  return clamp(score, 0.01, 0.99);
}

function extractAsset(text, playbook) {
  if (playbook.assetHintRegex) {
    const regex = new RegExp(playbook.assetHintRegex, "i");
    const match = text.match(regex);
    if (match?.[1]) {
      return match[1].toUpperCase();
    }
  }

  const patterns = [
    /\blist(?:ing|ed)?\s+\$?([A-Z0-9]{2,10})\b/gi,
    /\b([A-Z0-9]{2,10})\s+(?:will\s+be\s+)?list(?:ed|ing)\b/gi,
    /\$([A-Z0-9]{2,10})\b/g,
    /\b([A-Z0-9]{2,10})\/USDT\b/g,
    /\(([A-Z0-9]{2,10})\)/g,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      return match[1].toUpperCase();
    }
  }
  return "";
}

function renderSymbol(template, asset) {
  if (!template) {
    return "";
  }
  return template.replaceAll("{{asset}}", asset);
}

function buildTradeIdea(playbook, asset) {
  const action = { ...playbook.action };
  action.symbol = action.symbol || renderSymbol(playbook.symbolTemplate, asset);
  action.clientOrderId = `t-${playbook.id.slice(0, 10)}-${Date.now().toString().slice(-8)}`;

  const amountSummary =
    action.side === "buy"
      ? `投入 ${action.amountQuote}`
      : action.amountBase === "ALL"
        ? "卖出全部可用仓位"
        : `卖出 ${action.amountBase}`;

  const actionLabel = action.side === "buy" ? "市价买入" : "市价卖出";
  return {
    ...action,
    summary: `${actionLabel} ${action.symbol}（${amountSummary}）`,
  };
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
  const count = trades.length;
  const notional = trades.reduce((sum, trade) => sum + (Number(trade.notionalUsd) || 0), 0);
  return { count, notional };
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
  const score = scoreSignal(baseSignal.text, matched.length, baseSignal.sourceType);
  const selectedPlaybook = matched[0] || null;
  const asset = selectedPlaybook ? extractAsset(baseSignal.text, selectedPlaybook) : "";
  const tradeIdea = selectedPlaybook ? buildTradeIdea(selectedPlaybook, asset) : null;
  const risk = getDailyRiskSnapshot(store);
  const runtimeSettings = store.getRuntimeSettings({
    telegram: {
      allowedChatIds: [],
      analystChatIds: [],
      newsChatIds: [],
    },
    feishu: {
      analystRoutes: [],
    },
    execution: {
      newsMode: "auto",
    },
  });

  let executionStatus = "notify_only";
  let executionReason = "没有命中可执行策略，这条消息只做提醒";

  if (baseSignal.sourceType === "analyst" && !selectedPlaybook) {
    executionStatus = "pending_approval";
    executionReason = "分析师新消息默认先发飞书，等你查看后再决定是否交易";
  } else if (selectedPlaybook && tradeIdea) {
    const notionalEstimate =
      Number.parseFloat(tradeIdea.amountQuote || "") ||
      Number.parseFloat(tradeIdea.amountBase || "") ||
      0;
    const dailyTradeLimitReached = risk.count >= config.maxDailyTrades;
    const dailyNotionalLimitReached = risk.notional + notionalEstimate > config.maxDailyNotionalUsd;
    const forceManualForNews =
      baseSignal.sourceType === "news" && runtimeSettings.execution.newsMode === "manual";

    if (dailyTradeLimitReached || dailyNotionalLimitReached) {
      executionStatus = "blocked_risk";
      executionReason = dailyTradeLimitReached
        ? "已达到当日交易次数上限"
        : "已达到当日交易金额上限";
    } else if (selectedPlaybook.approvalRequired || baseSignal.sourceType === "analyst") {
      executionStatus = "pending_approval";
      executionReason = "等待你手动确认";
    } else if (forceManualForNews) {
      executionStatus = "pending_approval";
      executionReason = "新闻已切到手动确认模式";
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
      tradeIdea,
      executionStatus,
      executionReason,
      reviewedAt: "",
      reviewDecision: "",
      executionResult: null,
    },
  };
}

export function renderSignalReviewPage(signal, token) {
  const sourceLabel = signal.deliveryDisplayName || signal.displaySourceName || signal.sourceName;
  const displayText = signal.displayText || signal.text;
  const tradeBlock = signal.tradeIdea
    ? `<p><strong>交易建议:</strong> ${escapeHtml(signal.tradeIdea.summary)}</p>`
    : "<p><strong>交易建议:</strong> 无</p>";

  const title = signal.sourceType === "analyst" ? "分析师策略确认" : "新闻交易确认";

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; padding: 24px; max-width: 760px; margin: 0 auto; background: #f7f9fc; color: #182233; }
      .card { border: 1px solid #dbe3ef; background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 14px 32px rgba(18, 36, 73, 0.08); }
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
      <p><strong>来源:</strong> ${escapeHtml(sourceLabel)}</p>
      <p><strong>评分:</strong> ${signal.score.toFixed(2)}</p>
      <p><strong>命中策略:</strong> ${escapeHtml(signal.matchedPlaybookIds.join(", ") || "无")}</p>
      ${tradeBlock}
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
