function toNumber(value) {
  const parsed = Number.parseFloat(String(value ?? "").replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatSymbolList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean);
}

function createEmptySummary(chatId, displayName, config = {}) {
  return {
    chatId,
    displayName,
    enabled: config.enabled !== false,
    defaultAmountQuote: config.amountQuote || "100",
    allowedSymbols: formatSymbolList(config.allowedSymbols),
    tradeCount: 0,
    closeCount: 0,
    winCount: 0,
    lossCount: 0,
    winRate: null,
    profitLossRatio: null,
    realizedPnl: 0,
    unrealizedPnl: 0,
    totalPnl: 0,
    quoteVolume: 0,
    lastTradeAt: "",
    positions: [],
    recentTrades: [],
  };
}

function getFeeInBase(trade, symbol) {
  const base = String(symbol || "").split("_")[0]?.toUpperCase() || "";
  return String(trade.feeCurrency || "").toUpperCase() === base ? toNumber(trade.fee) : 0;
}

function getFeeInQuote(trade, symbol) {
  const quote = String(symbol || "").split("_")[1]?.toUpperCase() || "";
  return String(trade.feeCurrency || "").toUpperCase() === quote ? toNumber(trade.fee) : 0;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export async function buildAnalystMetrics({
  runtimeSettings,
  knownChats,
  configuredChatLabels,
  trades,
  signals,
  gateClient,
}) {
  const routeMap = new Map(
    (runtimeSettings.feishu?.analystRoutes || []).map((route) => [
      String(route.chatId),
      {
        displayName: String(route.displayName || "").trim(),
      },
    ]),
  );
  const configMap = new Map(
    (runtimeSettings.analysts?.configs || []).map((item) => [
      String(item.chatId),
      {
        enabled: item.enabled !== false,
        amountQuote: String(item.amountQuote || "").trim() || "100",
        allowedSymbols: formatSymbolList(item.allowedSymbols),
      },
    ]),
  );
  const knownMap = new Map((knownChats || []).map((chat) => [String(chat.id), chat]));

  const analystIds = new Set([
    ...(runtimeSettings.telegram?.analystChatIds || []).map(String),
    ...routeMap.keys(),
    ...configMap.keys(),
  ]);

  const summaries = new Map();
  const trackedSymbols = new Set();

  for (const chatId of analystIds) {
    const known = knownMap.get(chatId);
    const displayName =
      routeMap.get(chatId)?.displayName ||
      configuredChatLabels?.[chatId] ||
      known?.title ||
      `分析师专线 ${String(chatId).slice(-4)}`;
    summaries.set(chatId, createEmptySummary(chatId, displayName, configMap.get(chatId)));
  }

  const signalExecutions = (signals || [])
    .filter(
      (signal) =>
        signal?.executionResult?.status === "submitted" &&
        signal?.tradeIdea?.symbol &&
        signal?.chatId,
    )
    .map((signal) => ({
      createdAt: signal.executionResult?.at || signal.reviewedAt || signal.createdAt,
      signalId: signal.id,
      chatId: signal.chatId,
      sourceType: signal.sourceType,
      sourceName: signal.sourceName,
      deliveryDisplayName: signal.deliveryDisplayName || signal.displaySourceName || signal.sourceName,
      symbol: signal.tradeIdea?.symbol,
      side: signal.tradeIdea?.side,
      mode: "futures_testnet",
      orderId: String(signal.executionResult?.result?.id || ""),
      orderStatus: String(signal.executionResult?.result?.status || ""),
      finishAs: String(signal.executionResult?.result?.finish_as || ""),
      clientOrderId: String(signal.tradeIdea?.clientOrderId || ""),
      avgPrice:
        Number.parseFloat(
          signal.executionResult?.result?.avg_deal_price ||
            signal.executionResult?.result?.fill_price ||
            "",
        ) || 0,
      filledBaseQty:
        Number.parseFloat(signal.executionResult?.result?.filled_amount || signal.tradeIdea?.amountBase || "") ||
        0,
      filledQuoteQty:
        Number.parseFloat(signal.executionResult?.result?.filled_total || signal.tradeIdea?.amountQuote || "") ||
        0,
      fee:
        Number.parseFloat(signal.executionResult?.result?.fee || "") ||
        Number.parseFloat(signal.executionResult?.result?.gt_fee || "") ||
        0,
      feeCurrency: String(signal.executionResult?.result?.fee_currency || ""),
      notionalUsd:
        Number.parseFloat(signal.tradeIdea?.amountQuote || "") ||
        Number.parseFloat(signal.tradeIdea?.amountBase || "") ||
        0,
    }));

  const mergedExecutions = [...(trades || []), ...signalExecutions];
  const deduped = new Map();
  for (const item of mergedExecutions) {
    const key = String(item?.signalId || item?.orderId || `${item?.chatId}:${item?.createdAt}`);
    if (!key) {
      continue;
    }
    const previous = deduped.get(key) || {};
    deduped.set(key, { ...previous, ...item });
  }

  const executions = [...deduped.values()]
    .filter((trade) => trade && trade.chatId && trade.symbol && trade.status !== "failed")
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));

  const positionBooks = new Map();

  for (const trade of executions) {
    const chatId = String(trade.chatId || "");
    if (!summaries.has(chatId)) {
      const displayName =
        trade.deliveryDisplayName ||
        configuredChatLabels?.[chatId] ||
        `分析师专线 ${String(chatId).slice(-4)}`;
      summaries.set(chatId, createEmptySummary(chatId, displayName, configMap.get(chatId)));
    }

    const summary = summaries.get(chatId);
    const symbol = String(trade.symbol || "").toUpperCase();
    trackedSymbols.add(symbol);

    summary.tradeCount += 1;
    summary.quoteVolume += toNumber(trade.filledQuoteQty || trade.notionalUsd);
    summary.lastTradeAt =
      !summary.lastTradeAt || String(trade.createdAt || "") > summary.lastTradeAt
        ? String(trade.createdAt || "")
        : summary.lastTradeAt;
    summary.recentTrades.push({
      createdAt: trade.createdAt,
      symbol,
      side: trade.side,
      avgPrice: toNumber(trade.avgPrice),
      filledBaseQty: toNumber(trade.filledBaseQty),
      filledQuoteQty: toNumber(trade.filledQuoteQty),
      realizedPnl: null,
      orderId: trade.orderId || "",
      mode: trade.mode || "",
    });

    const positionKey = `${chatId}:${symbol}`;
    const current =
      positionBooks.get(positionKey) || {
        chatId,
        symbol,
        qty: 0,
        cost: 0,
      };

    const filledBaseQty = toNumber(trade.filledBaseQty);
    const filledQuoteQty = toNumber(trade.filledQuoteQty);
    const feeBase = getFeeInBase(trade, symbol);
    const feeQuote = getFeeInQuote(trade, symbol);

    if (String(trade.side).toLowerCase() === "buy") {
      const netQty = Math.max(filledBaseQty - feeBase, 0);
      current.qty += netQty;
      current.cost += filledQuoteQty + feeQuote;
    } else {
      const averageCost = current.qty > 0 ? current.cost / current.qty : 0;
      const qtyReduction = Math.max(filledBaseQty + feeBase, 0);
      const realizedCost = averageCost * Math.min(current.qty, qtyReduction);
      const proceeds = Math.max(filledQuoteQty - feeQuote, 0);
      const realizedPnl = current.qty > 0 ? proceeds - realizedCost : null;

      current.qty = Math.max(current.qty - qtyReduction, 0);
      current.cost = Math.max(current.cost - realizedCost, 0);

      if (realizedPnl !== null) {
        summary.closeCount += 1;
        summary.realizedPnl += realizedPnl;
        if (realizedPnl > 0) {
          summary.winCount += 1;
        } else if (realizedPnl < 0) {
          summary.lossCount += 1;
        }
        const recent = summary.recentTrades[summary.recentTrades.length - 1];
        if (recent) {
          recent.realizedPnl = round(realizedPnl);
        }
      }
    }

    positionBooks.set(positionKey, current);
  }

  const tickers = new Map();
  await Promise.all(
    [...trackedSymbols].map(async (symbol) => {
      try {
        const ticker = await gateClient.getSpotTicker(symbol);
        if (ticker) {
          tickers.set(symbol, ticker);
        }
      } catch {
        // Keep metrics available even if market lookup fails.
      }
    }),
  );

  for (const [key, position] of positionBooks.entries()) {
    if (position.qty <= 0) {
      continue;
    }
    const chatId = key.split(":")[0];
    const summary = summaries.get(chatId);
    if (!summary) {
      continue;
    }
    const markPrice = toNumber(tickers.get(position.symbol)?.last || 0);
    const marketValue = position.qty * markPrice;
    const unrealizedPnl = markPrice > 0 ? marketValue - position.cost : 0;
    summary.unrealizedPnl += unrealizedPnl;
    summary.positions.push({
      symbol: position.symbol,
      qty: round(position.qty, 8),
      avgCost: position.qty > 0 ? round(position.cost / position.qty, 4) : 0,
      cost: round(position.cost, 4),
      markPrice: round(markPrice, 4),
      marketValue: round(marketValue, 4),
      unrealizedPnl: round(unrealizedPnl, 4),
    });
  }

  for (const summary of summaries.values()) {
    const closed = summary.winCount + summary.lossCount;
    summary.winRate = closed ? round((summary.winCount / closed) * 100, 2) : null;
    const winners = summary.recentTrades
      .map((trade) => trade.realizedPnl)
      .filter((value) => Number.isFinite(value) && value > 0);
    const losers = summary.recentTrades
      .map((trade) => trade.realizedPnl)
      .filter((value) => Number.isFinite(value) && value < 0);
    const avgWin = winners.length
      ? winners.reduce((sum, value) => sum + value, 0) / winners.length
      : 0;
    const avgLoss = losers.length
      ? Math.abs(losers.reduce((sum, value) => sum + value, 0) / losers.length)
      : 0;
    summary.profitLossRatio = avgWin > 0 && avgLoss > 0 ? round(avgWin / avgLoss, 2) : null;
    summary.realizedPnl = round(summary.realizedPnl, 4);
    summary.unrealizedPnl = round(summary.unrealizedPnl, 4);
    summary.totalPnl = round(summary.realizedPnl + summary.unrealizedPnl, 4);
    summary.quoteVolume = round(summary.quoteVolume, 4);
    summary.positions.sort((a, b) => b.marketValue - a.marketValue);
    summary.recentTrades = summary.recentTrades
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .slice(0, 8);
  }

  return [...summaries.values()].sort((a, b) => {
    const aScore = a.totalPnl;
    const bScore = b.totalPnl;
    if (aScore !== bScore) {
      return bScore - aScore;
    }
    return a.displayName.localeCompare(b.displayName, "zh-CN");
  });
}
