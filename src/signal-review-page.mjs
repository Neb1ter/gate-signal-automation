function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getReadableExecutionReason(signal) {
  if (signal.sourceType === "analyst") {
    if (signal.executionStatus === "pending_approval") {
      return signal.tradeIdea
        ? "AI 已整理出结构化交易建议，等待你确认是否跟单。"
        : "AI 已完成结构化摘要，但暂未形成可直接执行的订单。";
    }
    if (signal.executionStatus === "notify_only") {
      return "这条分析暂时只做提醒，不会自动下单。";
    }
  }

  if (signal.sourceType === "news") {
    if (signal.executionStatus === "ready_for_execution") {
      return "这条新闻已命中自动交易条件，系统会继续执行。";
    }
    if (signal.executionStatus === "blocked_risk") {
      return "这条新闻命中了策略，但被风控规则拦截。";
    }
    if (signal.executionStatus === "pending_approval") {
      return "当前新闻模式是手动确认，等待你决定是否执行。";
    }
  }

  return String(signal.executionReason || "").trim() || "等待处理。";
}

function formatDirection(side) {
  return side === "sell" ? "做空 / 开空" : "做多 / 开多";
}

function buildProtectionText(signal, tradeIdea) {
  const protectionPlan = tradeIdea.protectionPlan || {};
  const takeProfitText =
    Array.isArray(protectionPlan.takeProfits) && protectionPlan.takeProfits.length
      ? protectionPlan.takeProfits.join(" / ")
      : Array.isArray(signal.analysis?.takeProfits) && signal.analysis.takeProfits.length
        ? signal.analysis.takeProfits.join(" / ")
        : "未给出";

  return [
    `止损：${protectionPlan.stopLoss ?? signal.analysis?.stopLoss ?? "未给出"}`,
    `止盈：${takeProfitText}`,
    protectionPlan.riskRewardTarget ? `盈亏比：${protectionPlan.riskRewardTarget}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function renderSignalReviewPage(signal, token, options = {}) {
  const sourceLabel = signal.deliveryDisplayName || signal.displaySourceName || signal.sourceName;
  const displayText = signal.displayText || signal.text;
  const preview = options.preview || {};
  const tradeIdea = signal.tradeIdea || {};
  const title = signal.sourceType === "analyst" ? "分析师策略确认" : "新闻交易确认";
  const orderType =
    tradeIdea.orderType || (String(tradeIdea.kind || "").includes("limit") ? "limit" : "market");
  const leverage = String(tradeIdea.leverage || preview.leverage || "20").replace(/x$/i, "");
  const size = tradeIdea.size || preview.estimatedContracts || "";
  const price = tradeIdea.price || preview.referencePrice || "";
  const marginQuote = tradeIdea.marginQuote || tradeIdea.amountQuote || preview.marginQuote || "";
  const symbol = String(tradeIdea.symbol || signal.analysis?.symbol || "").toUpperCase();
  const contract = String(tradeIdea.contract || symbol || "").toUpperCase();
  const keySuggestion =
    tradeIdea.summary ||
    signal.analysis?.normalizedSummary?.split("\n").find(Boolean) ||
    "这条消息目前只有结构化分析，你可以继续手动补充下单参数。";
  const leverageHint =
    preview?.leverageSource === "current_position"
      ? `检测到 ${tradeIdea.symbol || preview.contract || "当前合约"} 已有仓位，默认沿用当前杠杆 ${leverage}x。`
      : `当前默认杠杆为 ${leverage}x；如果分析师没有明确说明，你可以在这里改成自己的杠杆。`;
  const orderTypeExplain =
    orderType === "limit"
      ? "限价单会按你填写的价格挂单，不到价不会成交。"
      : "市价单会按当前市场最优价格尽快成交，速度更快，但成交价可能有滑点。";
  const structuredBlock = signal.analysis?.normalizedSummary
    ? `<section class="section"><h2>结构化分析</h2><pre>${escapeHtml(signal.analysis.normalizedSummary)}</pre></section>`
    : "";
  const sideLabel = formatDirection(tradeIdea.side);
  const orderTypeLabel = orderType === "limit" ? "限价单" : "市价单";
  const positionSummary = size ? `${size} 张` : `${marginQuote || "未给出"} USDT 保证金`;
  const protectionText = buildProtectionText(signal, tradeIdea);

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        --bg: #f4f7fb;
        --card: #ffffff;
        --border: #d9e3f0;
        --text: #182233;
        --muted: #5b6a82;
        --blue: #0f6fff;
        --blue-deep: #0b56c4;
        --warn-bg: #fff6df;
        --warn-border: #f1d48b;
        --soft: #f8fbff;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        background: linear-gradient(180deg, #f7fbff 0%, var(--bg) 100%);
        color: var(--text);
      }
      .page { width: min(100%, 980px); margin: 0 auto; padding: 20px; }
      .card {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 22px;
        padding: 20px;
        box-shadow: 0 14px 32px rgba(18, 36, 73, 0.08);
      }
      .page-title { margin: 0 0 16px; font-size: 28px; line-height: 1.2; }
      .meta, .summary-grid, .form-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .meta-item, .field-card, .summary-card, .section, .callout {
        background: var(--soft);
        border: 1px solid #e3e9f3;
        border-radius: 16px;
        padding: 14px;
      }
      .trade-hero {
        margin: 18px 0;
        padding: 20px;
        border-radius: 20px;
        background: linear-gradient(135deg, var(--blue) 0%, #2a8cff 100%);
        color: #fff;
      }
      .trade-hero.neutral { background: linear-gradient(135deg, #4a5d80 0%, #6c7f9f 100%); }
      .eyebrow {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        opacity: 0.9;
      }
      .trade-title { margin-top: 8px; font-size: 28px; line-height: 1.35; font-weight: 800; }
      .trade-subtitle { margin-top: 10px; font-size: 14px; line-height: 1.6; opacity: 0.96; }
      .section, .callout, .summary-grid, .form-grid { margin-top: 16px; }
      h2 { margin: 0 0 10px; font-size: 18px; }
      .meta-item strong, label { display: block; font-weight: 700; margin-bottom: 8px; }
      .summary-label { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
      .summary-value { font-size: 18px; font-weight: 700; line-height: 1.4; }
      input, select {
        width: 100%;
        padding: 12px;
        border-radius: 12px;
        border: 1px solid #cad6e7;
        font: inherit;
        background: #fff;
      }
      .hint { margin-top: 6px; font-size: 13px; color: var(--muted); line-height: 1.6; }
      .full { grid-column: 1 / -1; }
      .callout {
        background: var(--warn-bg);
        border-color: var(--warn-border);
        color: #6d5200;
        line-height: 1.7;
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        background: #fff;
        padding: 12px;
        border-radius: 12px;
        border: 1px solid #e3e9f3;
        line-height: 1.7;
      }
      .actions { display: flex; gap: 12px; margin-top: 18px; flex-wrap: wrap; }
      button {
        padding: 12px 18px;
        border-radius: 12px;
        border: 0;
        cursor: pointer;
        font: inherit;
        min-height: 46px;
      }
      .approve { background: var(--blue); color: #fff; font-weight: 700; }
      .approve:hover { background: var(--blue-deep); }
      .reject { background: #eef2f7; color: #253047; }
      @media (max-width: 720px) {
        .page { padding: 10px; }
        .card { padding: 14px; border-radius: 18px; }
        .page-title { font-size: 22px; }
        .trade-title { font-size: 22px; }
        .meta, .summary-grid, .form-grid { grid-template-columns: 1fr; }
        .actions > * { flex: 1 1 100%; }
        button { width: 100%; }
        .trade-subtitle, .hint, pre { font-size: 14px; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <div class="card">
        <h1 class="page-title">${escapeHtml(title)}</h1>
        <div class="meta">
          <div class="meta-item"><strong>来源</strong><div class="hint">${escapeHtml(sourceLabel)}</div></div>
          <div class="meta-item"><strong>评分</strong><div class="hint">${signal.score.toFixed(2)}</div></div>
          <div class="meta-item"><strong>命中策略</strong><div class="hint">${escapeHtml(signal.matchedPlaybookIds.join(", ") || "无")}</div></div>
          <div class="meta-item"><strong>当前状态</strong><div class="hint">${escapeHtml(getReadableExecutionReason(signal))}</div></div>
        </div>
        <section class="trade-hero${signal.tradeIdea ? "" : " neutral"}">
          <div class="eyebrow">${signal.tradeIdea ? "重点建议" : "结构化结果"}</div>
          <div class="trade-title">${escapeHtml(signal.tradeIdea ? keySuggestion : "暂未生成可直接执行的订单")}</div>
          <div class="trade-subtitle">${
            escapeHtml(
              signal.tradeIdea
                ? "默认已经带入分析师提到的价格、杠杆和仓位建议；你确认前仍然可以继续修改。"
                : "这条消息会先保留为结构化分析；如果你想手动下单，可以直接补充币种、价格、数量和杠杆。",
            )
          }</div>
        </section>
        <section class="summary-grid">
          <div class="summary-card"><div class="summary-label">标的 / 合约</div><div class="summary-value">${escapeHtml(symbol || contract || "待补充")}</div></div>
          <div class="summary-card"><div class="summary-label">方向 / 订单类型</div><div class="summary-value">${escapeHtml(`${sideLabel} · ${orderTypeLabel}`)}</div></div>
          <div class="summary-card"><div class="summary-label">默认仓位</div><div class="summary-value">${escapeHtml(positionSummary)}</div></div>
          <div class="summary-card"><div class="summary-label">保护计划</div><div class="summary-value">${escapeHtml(protectionText)}</div></div>
        </section>
        ${structuredBlock}
        <section class="callout">${escapeHtml(orderTypeExplain)} ${escapeHtml(leverageHint)}</section>
        <form method="post" action="/signals/${signal.id}/approve?token=${encodeURIComponent(token)}">
          <section class="form-grid">
            <div class="field-card">
              <label for="symbol">币种 / 合约</label>
              <input id="symbol" name="symbol" type="text" placeholder="例如 BTC_USDT" value="${escapeHtml(symbol)}" />
              <div class="hint">如果这是一段长篇分析、系统没提取出明确标的，你可以直接在这里手动填写。</div>
            </div>
            <div class="field-card">
              <label for="contract">实际下单合约</label>
              <input id="contract" name="contract" type="text" placeholder="默认与上方标的一致" value="${escapeHtml(contract)}" />
              <div class="hint">如果你想把分析观点映射到另一个具体合约，可以在这里覆盖。</div>
            </div>
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
              <div class="hint">默认优先使用分析师给出的数量；如果你不填，系统会按保证金和杠杆估算。</div>
            </div>
            <div class="field-card">
              <label for="price">价格</label>
              <input id="price" name="price" type="number" min="0" step="0.0001" value="${escapeHtml(price)}" />
              <div class="hint">限价单会按这里的价格挂单；市价单会忽略这里的价格。</div>
            </div>
            <div class="field-card">
              <label for="marginQuote">保证金（USDT）</label>
              <input id="marginQuote" name="marginQuote" type="number" min="0" step="0.01" value="${escapeHtml(marginQuote)}" />
              <div class="hint">如果你不填写数量，系统会用保证金 × 杠杆 ÷ 合约面值估算张数。</div>
            </div>
            <input type="hidden" name="settle" value="${escapeHtml(tradeIdea.settle || "usdt")}" />
            <input type="hidden" name="timeInForce" value="${escapeHtml(tradeIdea.timeInForce || "")}" />
            <div class="field-card full">
              <label>转发正文</label>
              <pre>${escapeHtml(displayText)}</pre>
            </div>
          </section>
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
    </main>
  </body>
</html>`;
}
