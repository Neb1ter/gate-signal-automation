function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const COMMON_CONTRACTS = [
  "BTC_USDT",
  "ETH_USDT",
  "SOL_USDT",
  "XAU_USDT",
  "BNB_USDT",
  "XRP_USDT",
  "DOGE_USDT",
  "SUI_USDT",
];

function formatSignalStatus(signal) {
  const status = String(signal.executionStatus || "").toLowerCase();
  if (status === "pending_approval") return "等待人工确认";
  if (status === "ready_for_execution") return "等待自动执行";
  if (status === "blocked_risk") return "被风控拦截";
  if (status === "notify_only") return "仅提醒";
  if (status === "executed") return "已执行";
  if (status === "dry_run_executed") return "已模拟执行";
  if (status === "execution_failed") return "执行失败";
  if (status === "cancelled") return "已撤销";
  if (status === "partially_cancelled") return "部分撤销";
  if (status === "protected") return "保护计划已更新";
  return signal.executionStatus || "待处理";
}

function formatExecutionStatus(execution) {
  const status = String(execution?.status || "").toLowerCase();
  if (status === "pending") return "准备提交";
  if (status === "submitted") return "已提交";
  if (status === "submitted_with_warnings") return "已提交，带告警";
  if (status === "protected") return "保护计划已更新";
  if (status === "cancelled") return "已撤销";
  if (status === "partially_cancelled") return "部分撤销";
  if (status === "failed") return "执行失败";
  return execution?.status || "未知";
}

function getReadableExecutionReason(signal) {
  return String(signal.executionReason || "").trim() || "等待你确认下一步操作。";
}

function formatDirection(side) {
  return String(side || "").toLowerCase() === "sell" ? "做空 / 开空" : "做多 / 开多";
}

function getProtectionDefaults(signal, tradeIdea) {
  const plan = tradeIdea?.protectionPlan || {};
  const stopLoss = plan.stopLoss ?? signal.analysis?.stopLoss ?? "";
  const takeProfits =
    (Array.isArray(plan.takeProfits) && plan.takeProfits.length
      ? plan.takeProfits
      : Array.isArray(signal.analysis?.takeProfits)
        ? signal.analysis.takeProfits
        : []) || [];

  return {
    stopLoss: stopLoss === null ? "" : String(stopLoss),
    takeProfits,
    takeProfitText: takeProfits.join(", "),
  };
}

function buildExecutionOptions(relatedExecutions, selectedId) {
  const firstOption =
    '<option value="">不指定，默认操作最近一笔相关订单</option>';
  const options = (Array.isArray(relatedExecutions) ? relatedExecutions : []).map((execution) => {
    const selected = String(selectedId || "") === String(execution.id || "") ? "selected" : "";
    const label = [
      `第 ${execution.attemptNo || "?"} 次`,
      execution.symbol || execution.contract || "未知合约",
      formatExecutionStatus(execution),
      execution.mainOrder?.orderId ? `主单 ${execution.mainOrder.orderId}` : "无主单号",
      execution.createdAt ? String(execution.createdAt).replace("T", " ").replace("Z", "") : "",
    ]
      .filter(Boolean)
      .join(" | ");
    return `<option value="${escapeHtml(execution.id)}" ${selected}>${escapeHtml(label)}</option>`;
  });
  return [firstOption, ...options].join("");
}

function buildExecutionCards(relatedExecutions) {
  const rows = (Array.isArray(relatedExecutions) ? relatedExecutions : []).map((execution) => {
    const protectionRows = (Array.isArray(execution.protectionOrders) ? execution.protectionOrders : [])
      .map((order) => {
        const orderId = order.trailId || order.orderId || order.id || "待返回";
        const state = order.active === false ? "已失效" : "生效中";
        return `<li>${escapeHtml(
          `${order.type || "保护单"} | 触发价 ${order.triggerPrice || "-"} | ID ${orderId} | ${state}`,
        )}</li>`;
      })
      .join("");

    return `<article class="execution-card">
      <div class="execution-head">
        <strong>第 ${escapeHtml(execution.attemptNo || "?")} 次执行</strong>
        <span class="pill">${escapeHtml(formatExecutionStatus(execution))}</span>
      </div>
      <div class="hint">${escapeHtml(
        `${execution.symbol || execution.contract || "未知合约"} | ${formatDirection(
          execution.requestSnapshot?.side || execution.mainOrder?.side || "buy",
        )} | ${execution.requestSnapshot?.orderType || execution.mainOrder?.orderType || "market"}`,
      )}</div>
      <div class="hint">${escapeHtml(
        execution.createdAt ? String(execution.createdAt).replace("T", " ").replace("Z", "") : "",
      )}</div>
      <div class="hint">${escapeHtml(
        execution.mainOrder?.orderId
          ? `主单 ID：${execution.mainOrder.orderId}`
          : "主单 ID：尚未返回",
      )}</div>
      <div class="hint">${escapeHtml(
        execution.mainOrder?.status
          ? `主单状态：${execution.mainOrder.status}`
          : "主单状态：未知",
      )}</div>
      ${
        protectionRows
          ? `<div class="protection-list"><strong>关联止盈止损</strong><ul>${protectionRows}</ul></div>`
          : '<div class="hint">暂无已记录的止盈止损单。</div>'
      }
    </article>`;
  });

  return rows.length
    ? rows.join("")
    : '<div class="empty-box">当前还没有可参考的历史执行批次。你可以直接按本页参数开新单。</div>';
}

function buildCommonOptions(currentValue) {
  const normalizedCurrent = String(currentValue || "").toUpperCase();
  return COMMON_CONTRACTS.map((contract) => {
    const selected = normalizedCurrent === contract ? "selected" : "";
    return `<option value="${contract}" ${selected}>${contract}</option>`;
  }).join("");
}

export function renderSignalReviewPage(signal, token, options = {}) {
  const sourceLabel = signal.deliveryDisplayName || signal.displaySourceName || signal.sourceName;
  const displayText = signal.displayText || signal.text;
  const preview = options.preview || {};
  const relatedExecutions = Array.isArray(options.relatedExecutions) ? options.relatedExecutions : [];
  const tradeIdea = signal.tradeIdea || {};
  const title = signal.sourceType === "analyst" ? "分析师策略决策面板" : "新闻交易决策面板";
  const orderType =
    tradeIdea.orderType || (String(tradeIdea.kind || "").includes("limit") ? "limit" : "market");
  const leverage = String(tradeIdea.leverage || preview.leverage || "20").replace(/x$/i, "");
  const size = tradeIdea.size || preview.estimatedContracts || "";
  const price = tradeIdea.price || preview.referencePrice || "";
  const marginQuote = tradeIdea.marginQuote || tradeIdea.amountQuote || preview.marginQuote || "";
  const symbol = String(tradeIdea.symbol || signal.analysis?.symbol || "").toUpperCase();
  const contract = String(tradeIdea.contract || symbol || "").toUpperCase();
  const protectionDefaults = getProtectionDefaults(signal, tradeIdea);
  const multiplier = Number.parseFloat(preview?.contractInfo?.quanto_multiplier || "") || 0;
  const managementIntent = String(signal.managementIntent || "").toLowerCase();
  const defaultDecisionAction =
    managementIntent === "cancel" || managementIntent === "protect" ? managementIntent : "open";
  const selectedExecutionId = signal.latestExecutionId || relatedExecutions[0]?.id || "";
  const reviewButtonLabel =
    defaultDecisionAction === "cancel"
      ? "执行撤单"
      : defaultDecisionAction === "protect"
        ? "更新保护计划"
        : signal.executionStatus === "execution_failed"
          ? "再次执行"
          : "确认跟单";

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
        --error-bg: #fff1f1;
        --error-border: #f2b8b5;
        --soft: #f8fbff;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        background: linear-gradient(180deg, #f7fbff 0%, var(--bg) 100%);
        color: var(--text);
      }
      .page { width: min(100%, 1100px); margin: 0 auto; padding: 18px; }
      .card {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 22px;
        padding: 18px;
        box-shadow: 0 14px 32px rgba(18, 36, 73, 0.08);
      }
      .page-title { margin: 0 0 16px; font-size: 28px; line-height: 1.2; }
      .meta, .summary-grid, .form-grid, .layout-grid {
        display: grid;
        gap: 12px;
      }
      .meta, .summary-grid, .form-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .layout-grid {
        grid-template-columns: 1.2fr 1fr;
        align-items: start;
      }
      .meta-item, .field-card, .summary-card, .section, .callout, .error-callout, .execution-card, .empty-box {
        background: var(--soft);
        border: 1px solid #e3e9f3;
        border-radius: 16px;
        padding: 14px;
      }
      .hero {
        margin: 18px 0;
        padding: 20px;
        border-radius: 20px;
        background: linear-gradient(135deg, var(--blue) 0%, #2a8cff 100%);
        color: #fff;
      }
      .eyebrow {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        opacity: 0.9;
      }
      .hero-title { margin-top: 8px; font-size: 28px; line-height: 1.35; font-weight: 800; }
      .hero-subtitle { margin-top: 10px; font-size: 14px; line-height: 1.6; opacity: 0.96; }
      h2, h3 { margin: 0 0 10px; }
      .summary-label { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
      .summary-value { font-size: 18px; font-weight: 700; line-height: 1.4; }
      label { display: block; font-weight: 700; margin-bottom: 8px; }
      input, select {
        width: 100%;
        padding: 12px;
        border-radius: 12px;
        border: 1px solid #cad6e7;
        font: inherit;
        background: #fff;
      }
      .hint, .small { margin-top: 6px; font-size: 13px; color: var(--muted); line-height: 1.6; }
      .full { grid-column: 1 / -1; }
      .callout { background: var(--warn-bg); border-color: var(--warn-border); color: #6d5200; line-height: 1.7; }
      .error-callout { background: var(--error-bg); border-color: var(--error-border); color: #9c2f26; }
      .symbol-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(180px, 240px);
        gap: 10px;
      }
      .chip-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
      .chip {
        border: 1px solid #cad6e7;
        background: #fff;
        color: var(--text);
        border-radius: 999px;
        padding: 8px 12px;
        cursor: pointer;
        font: inherit;
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
      .execution-list { display: grid; gap: 12px; }
      .execution-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 8px; }
      .pill { background: #eaf2ff; color: #0f6fff; border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 700; }
      .protection-list ul { margin: 8px 0 0; padding-left: 18px; }
      .protection-list li { line-height: 1.6; margin-bottom: 4px; }
      @media (max-width: 900px) {
        .layout-grid { grid-template-columns: 1fr; }
      }
      @media (max-width: 720px) {
        .page { padding: 10px; }
        .card { padding: 14px; border-radius: 18px; }
        .page-title { font-size: 22px; }
        .hero-title { font-size: 22px; }
        .meta, .summary-grid, .form-grid, .symbol-row { grid-template-columns: 1fr; }
        .actions > * { flex: 1 1 100%; }
        button { width: 100%; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <div class="card">
        <h1 class="page-title">${escapeHtml(title)}</h1>
        <div class="meta">
          <div class="meta-item"><strong>来源</strong><div class="hint">${escapeHtml(sourceLabel)}</div></div>
          <div class="meta-item"><strong>当前状态</strong><div class="hint">${escapeHtml(formatSignalStatus(signal))}</div></div>
          <div class="meta-item"><strong>命中策略</strong><div class="hint">${escapeHtml(signal.matchedPlaybookIds?.join(", ") || "无")}</div></div>
          <div class="meta-item"><strong>执行说明</strong><div class="hint">${escapeHtml(getReadableExecutionReason(signal))}</div></div>
        </div>

        <section class="hero">
          <div class="eyebrow">${managementIntent ? "管理指令" : "交易建议"}</div>
          <div class="hero-title">${escapeHtml(
            tradeIdea.summary ||
              signal.analysis?.semanticSummary ||
              (managementIntent === "cancel"
                ? "分析师希望撤销相关订单"
                : managementIntent === "protect"
                  ? "分析师希望调整保护计划"
                  : "这条消息更适合人工判断"),
          )}</div>
          <div class="hero-subtitle">最终解释权以分析师原文和你的人工操作为准。系统会严格区分市价单与限价单；如果你选择撤单，系统会联动撤销该单下已经挂出的止盈止损。</div>
        </section>

        <div class="summary-grid">
          <div class="summary-card"><div class="summary-label">标的 / 合约</div><div class="summary-value">${escapeHtml(symbol || contract || "待补充")}</div></div>
          <div class="summary-card"><div class="summary-label">方向 / 订单类型</div><div class="summary-value">${escapeHtml(`${formatDirection(tradeIdea.side)} | ${orderType === "limit" ? "限价单" : "市价单"}`)}</div></div>
          <div class="summary-card"><div class="summary-label">默认保证金</div><div class="summary-value">${escapeHtml(marginQuote ? `${marginQuote} USDT` : "待补充")}</div></div>
          <div class="summary-card"><div class="summary-label">保护计划</div><div class="summary-value">${escapeHtml(
            `止损：${protectionDefaults.stopLoss || "未设置"} | 止盈：${protectionDefaults.takeProfitText || "未设置"}`,
          )}</div></div>
        </div>

        ${signal.executionStatus === "execution_failed" && signal.executionResult
          ? `<section class="error-callout">
              <h2>上一次执行失败</h2>
              <p>${escapeHtml(signal.executionResult.message || "系统没有返回更详细的错误信息。")}</p>
              <p class="small">你可以直接改参数后再次执行，也可以切换成撤单或更新保护计划。</p>
            </section>`
          : ""}

        <div class="layout-grid">
          <section class="section">
            <h2>执行面板</h2>
            <form method="post" action="/signals/${signal.id}/approve?token=${encodeURIComponent(token)}">
              <div class="form-grid">
                <div class="field-card full">
                  <label for="decisionAction">本次操作</label>
                  <select id="decisionAction" name="decisionAction">
                    <option value="open" ${defaultDecisionAction === "open" ? "selected" : ""}>开新单 / 再次执行</option>
                    <option value="cancel" ${defaultDecisionAction === "cancel" ? "selected" : ""}>撤销目标订单，并联动撤销 TP/SL</option>
                    <option value="protect" ${defaultDecisionAction === "protect" ? "selected" : ""}>只更新保护计划（不重开主单）</option>
                  </select>
                  <div class="hint">分析师如果说“撤单”或“保护”，这里会自动带上对应操作；你仍然可以人工改回开新单。</div>
                </div>

                <div class="field-card full">
                  <label for="targetExecutionId">目标订单批次</label>
                  <select id="targetExecutionId" name="targetExecutionId">
                    ${buildExecutionOptions(relatedExecutions, selectedExecutionId)}
                  </select>
                  <div class="hint">做撤单或更新保护计划时，务必选对目标订单，避免不同单子被混淆。</div>
                </div>

                <div class="field-card full">
                  <label for="symbol">币种 / 合约</label>
                  <div class="symbol-row">
                    <input id="symbol" name="symbol" type="text" placeholder="例如 BTC_USDT、ETH_USDT、XAU_USDT" value="${escapeHtml(symbol)}" />
                    <select id="commonSymbol">
                      <option value="">常用币种快捷选择</option>
                      ${buildCommonOptions(symbol || contract)}
                    </select>
                  </div>
                  <div class="chip-list">
                    ${COMMON_CONTRACTS.map((item) => `<button class="chip" type="button" data-contract="${item}">${item}</button>`).join("")}
                  </div>
                </div>

                <div class="field-card">
                  <label for="contract">实际下单合约</label>
                  <input id="contract" name="contract" type="text" placeholder="默认与上方标的一致" value="${escapeHtml(contract)}" />
                </div>
                <div class="field-card">
                  <label for="orderType">订单类型</label>
                  <select id="orderType" name="orderType">
                    <option value="market" ${orderType === "market" ? "selected" : ""}>市价单</option>
                    <option value="limit" ${orderType === "limit" ? "selected" : ""}>限价单</option>
                  </select>
                  <div class="hint" id="orderTypeHint">${escapeHtml(
                    orderType === "limit"
                      ? "限价单会按你填写的价格挂单，不到价不成交。"
                      : "市价单会按当前盘口尽快成交，速度更快，但实际成交价可能有滑点。",
                  )}</div>
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
                  <input id="leverage" name="leverage" type="number" min="1" max="125" step="1" value="${escapeHtml(leverage)}" />
                  <div class="hint">${escapeHtml(
                    preview?.leverageSource === "current_position"
                      ? `检测到当前合约已有仓位，默认沿用当前仓位杠杆 ${leverage}x。`
                      : `当前默认杠杆是 ${leverage}x。没有仓位时优先用分析师建议，否则默认 20x。`,
                  )}</div>
                </div>

                <div class="field-card">
                  <label for="price">价格</label>
                  <input id="price" name="price" type="number" min="0" step="0.0001" value="${escapeHtml(price)}" />
                  <div class="hint">限价单会使用这里的价格；市价单会忽略这里的价格。</div>
                </div>
                <div class="field-card">
                  <label for="marginQuote">保证金（USDT）</label>
                  <input id="marginQuote" name="marginQuote" type="number" min="0" step="0.01" value="${escapeHtml(marginQuote)}" />
                  <div class="hint">本系统以保证金为优先级来推算张数。</div>
                </div>

                <div class="field-card">
                  <label for="size">数量（张）</label>
                  <input id="size" name="size" type="number" min="1" step="1" value="${escapeHtml(size)}" />
                  <div class="hint" id="sizeEstimateHint">当前预计数量：${escapeHtml(size || preview.estimatedContracts || "待根据保证金计算")}</div>
                </div>
                <div class="field-card">
                  <label for="stopLoss">止损</label>
                  <input id="stopLoss" name="stopLoss" type="number" min="0" step="0.0001" value="${escapeHtml(protectionDefaults.stopLoss)}" />
                  <div class="hint">如果分析师提到了止损，这里默认已经带入；撤单时这里不会生效。</div>
                </div>

                <div class="field-card full">
                  <label for="takeProfits">止盈</label>
                  <input id="takeProfits" name="takeProfits" type="text" placeholder="例如 71500, 72800" value="${escapeHtml(protectionDefaults.takeProfitText)}" />
                  <div class="hint">多个止盈位用英文逗号分隔。两个止盈位时：第一个会挂追踪止盈，第二个会挂全平止盈。</div>
                </div>

                <input type="hidden" name="settle" value="${escapeHtml(tradeIdea.settle || "usdt")}" />
                <input type="hidden" name="timeInForce" value="${escapeHtml(tradeIdea.timeInForce || "")}" />

                <div class="field-card full">
                  <label>分析师原文</label>
                  <pre>${escapeHtml(displayText)}</pre>
                </div>

                ${
                  signal.analysis?.normalizedSummary
                    ? `<div class="field-card full">
                        <label>结构化分析</label>
                        <pre>${escapeHtml(signal.analysis.normalizedSummary)}</pre>
                      </div>`
                    : ""
                }
              </div>

              <div class="actions">
                <button class="approve" id="submitButton" type="submit">${escapeHtml(reviewButtonLabel)}</button>
              </div>
            </form>
            <div class="actions">
              <form method="post" action="/signals/${signal.id}/reject?token=${encodeURIComponent(token)}">
                <button class="reject" type="submit">忽略这单</button>
              </form>
            </div>
          </section>

          <section class="section">
            <h2>相关执行批次</h2>
            <div class="execution-list">
              ${buildExecutionCards(relatedExecutions)}
            </div>
          </section>
        </div>
      </div>
    </main>
    <script>
      (() => {
        const symbolInput = document.getElementById("symbol");
        const contractInput = document.getElementById("contract");
        const commonSymbol = document.getElementById("commonSymbol");
        const sizeInput = document.getElementById("size");
        const marginInput = document.getElementById("marginQuote");
        const leverageInput = document.getElementById("leverage");
        const priceInput = document.getElementById("price");
        const hint = document.getElementById("sizeEstimateHint");
        const decisionAction = document.getElementById("decisionAction");
        const orderType = document.getElementById("orderType");
        const orderTypeHint = document.getElementById("orderTypeHint");
        const submitButton = document.getElementById("submitButton");
        const multiplier = ${Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 0};
        let sizeTouched = false;

        function applyCommonContract(value) {
          if (!value) return;
          symbolInput.value = value;
          contractInput.value = value;
          commonSymbol.value = value;
          recomputeSize(true);
        }

        function recomputeSize(force = false) {
          const margin = Number.parseFloat(marginInput.value || "");
          const leverage = Number.parseFloat(leverageInput.value || "");
          const price = Number.parseFloat(priceInput.value || "${escapeHtml(String(preview.referencePrice || ""))}");
          if (!(margin > 0 && leverage > 0 && price > 0 && multiplier > 0)) {
            hint.textContent = "当前预计数量：待根据保证金计算";
            return;
          }
          const estimated = Math.max(Math.floor((margin * leverage) / (price * multiplier)), 1);
          hint.textContent = "当前预计数量：" + estimated + " 张（按保证金优先计算）";
          if (force || !sizeTouched || !sizeInput.value) {
            sizeInput.value = String(estimated);
          }
        }

        function refreshActionState() {
          const mode = decisionAction.value;
          if (mode === "cancel") {
            submitButton.textContent = "执行撤单";
          } else if (mode === "protect") {
            submitButton.textContent = "更新保护计划";
          } else {
            submitButton.textContent = "${escapeHtml(signal.executionStatus === "execution_failed" ? "再次执行" : "确认跟单")}";
          }
        }

        function refreshOrderTypeHint() {
          orderTypeHint.textContent =
            orderType.value === "limit"
              ? "限价单会按你填写的价格挂单，不到价不成交。"
              : "市价单会按当前盘口尽快成交，速度更快，但实际成交价可能有滑点。";
        }

        commonSymbol.addEventListener("change", (event) => applyCommonContract(event.target.value));
        document.querySelectorAll("[data-contract]").forEach((button) => {
          button.addEventListener("click", () => applyCommonContract(button.getAttribute("data-contract")));
        });
        sizeInput.addEventListener("input", () => {
          sizeTouched = Boolean(sizeInput.value);
        });
        [marginInput, leverageInput, priceInput].forEach((input) => {
          input.addEventListener("input", () => recomputeSize(false));
        });
        decisionAction.addEventListener("change", refreshActionState);
        orderType.addEventListener("change", refreshOrderTypeHint);
        refreshActionState();
        refreshOrderTypeHint();
        recomputeSize(false);
      })();
    </script>
  </body>
</html>`;
}
