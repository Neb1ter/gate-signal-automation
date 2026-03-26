import crypto from "node:crypto";

function sha512Hex(value) {
  return crypto.createHash("sha512").update(value).digest("hex");
}

function hmacSha512Hex(secret, value) {
  return crypto.createHmac("sha512", secret).update(value).digest("hex");
}

function trimAmount(value) {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "";
  }
  return numeric.toFixed(8).replace(/\.?0+$/, "");
}

function trimInteger(value) {
  const numeric = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "";
  }
  return String(numeric);
}

function parseNumeric(value) {
  const numeric = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(numeric) ? numeric : null;
}

function hasOpenFuturesPosition(position) {
  const size = parseNumeric(position?.size);
  return size !== null && Math.abs(size) > 0;
}

function extractPositionLeverage(position) {
  return (
    trimInteger(position?.leverage) ||
    trimInteger(position?.cross_leverage_limit) ||
    trimInteger(position?.crossLeverageLimit) ||
    ""
  );
}

function normalizeBaseUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/api\/v4\/?$/i, "")
    .replace(/\/$/, "");
}

export class GateSpotClient {
  constructor({ apiKey, apiSecret, baseUrl, dryRun }) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.prefix = "/api/v4";
    this.dryRun = dryRun;
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiSecret && this.apiKey !== "replace-me");
  }

  async publicRequest(method, urlPath, query = "") {
    const url = query
      ? `${this.baseUrl}${this.prefix}${urlPath}?${query}`
      : `${this.baseUrl}${this.prefix}${urlPath}`;

    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
      },
    });

    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }

    if (!response.ok) {
      throw new Error(`Gate API ${response.status}: ${JSON.stringify(payload)}`);
    }

    return payload;
  }

  async request(method, urlPath, query = "", body = "") {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const bodyHash = sha512Hex(body);
    const signString = [
      method.toUpperCase(),
      `${this.prefix}${urlPath}`,
      query,
      bodyHash,
      timestamp,
    ].join("\n");
    const sign = hmacSha512Hex(this.apiSecret, signString);
    const url = query
      ? `${this.baseUrl}${this.prefix}${urlPath}?${query}`
      : `${this.baseUrl}${this.prefix}${urlPath}`;

    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        KEY: this.apiKey,
        Timestamp: timestamp,
        SIGN: sign,
      },
      body: body || undefined,
    });

    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }

    if (!response.ok) {
      throw new Error(`Gate API ${response.status}: ${JSON.stringify(payload)}`);
    }

    return payload;
  }

  async placeSpotMarketOrder(action) {
    if (!action.symbol) {
      throw new Error("现货市价单缺少交易对，例如 BTC_USDT");
    }

    const amount = await this.resolveSpotAmount(action);
    if (!amount) {
      throw new Error("现货市价单缺少数量。买入需要 amountQuote，卖出需要 amountBase");
    }

    const body = JSON.stringify({
      text: action.clientOrderId,
      currency_pair: action.symbol,
      type: "market",
      account: action.account || "spot",
      side: action.side,
      amount,
      time_in_force: action.timeInForce || "ioc",
    });

    if (this.dryRun) {
      return {
        dryRun: true,
        endpoint: "/spot/orders",
        requestBody: JSON.parse(body),
      };
    }

    if (!this.isConfigured()) {
      throw new Error("Gate API Key / Secret 尚未配置，暂时无法真实下单");
    }

    return this.request("POST", "/spot/orders", "", body);
  }

  async getAvailableSpotBalance(currency) {
    if (!this.isConfigured()) {
      throw new Error(`读取 ${currency} 持仓前，需要先配置 Gate API Key / Secret`);
    }

    const accounts = await this.request(
      "GET",
      "/spot/accounts",
      `currency=${encodeURIComponent(currency)}`,
    );

    const record = Array.isArray(accounts)
      ? accounts.find((item) => String(item.currency || "").toUpperCase() === currency)
      : null;
    return trimAmount(record?.available || "");
  }

  async getFuturesContract(contract, settle = "usdt") {
    if (!contract) {
      throw new Error("合约交易缺少合约名称，例如 BTC_USDT");
    }
    return this.publicRequest(
      "GET",
      `/futures/${encodeURIComponent(settle)}/contracts/${encodeURIComponent(contract)}`,
      "",
    );
  }

  async getFuturesPosition(contract, settle = "usdt") {
    if (!this.isConfigured()) {
      throw new Error("读取合约持仓前，需要先配置 Gate API Key / Secret");
    }
    return this.request(
      "GET",
      `/futures/${encodeURIComponent(settle)}/positions/${encodeURIComponent(contract)}`,
      "",
      "",
    );
  }

  async tryGetFuturesPosition(contract, settle = "usdt") {
    if (!this.isConfigured()) {
      return null;
    }
    try {
      return await this.getFuturesPosition(contract, settle);
    } catch (error) {
      if (/POSITION_NOT_FOUND|not found|404/i.test(String(error.message || ""))) {
        return null;
      }
      throw error;
    }
  }

  async updateFuturesLeverage(contract, leverage, settle = "usdt") {
    const normalizedLeverage = trimInteger(String(leverage || "").replace(/x$/i, ""));
    if (!normalizedLeverage) {
      throw new Error("杠杆参数无效，至少需要 1x");
    }
    if (this.dryRun) {
      return {
        dryRun: true,
        endpoint: `/futures/${settle}/positions/${contract}/leverage`,
        leverage: normalizedLeverage,
      };
    }
    if (!this.isConfigured()) {
      throw new Error("Gate API Key / Secret 尚未配置，暂时无法真实下单");
    }
    return this.request(
      "POST",
      `/futures/${encodeURIComponent(settle)}/positions/${encodeURIComponent(contract)}/leverage`,
      `leverage=${encodeURIComponent(normalizedLeverage)}`,
      "",
    );
  }

  estimateFuturesContracts({
    contractInfo,
    referencePrice,
    leverage,
    marginQuote,
    suggestedSize,
  }) {
    const multiplier = Number.parseFloat(contractInfo?.quanto_multiplier || "");
    const numericPrice = Number.parseFloat(referencePrice || "");
    const numericLeverage = Number.parseFloat(String(leverage || "").replace(/x$/i, ""));
    const numericMargin = Number.parseFloat(marginQuote || "");
    if (
      Number.isFinite(multiplier) &&
      multiplier > 0 &&
      Number.isFinite(numericPrice) &&
      numericPrice > 0 &&
      Number.isFinite(numericLeverage) &&
      numericLeverage > 0 &&
      Number.isFinite(numericMargin) &&
      numericMargin > 0
    ) {
      const contracts = Math.max(
        Math.floor((numericMargin * numericLeverage) / (numericPrice * multiplier)),
        1,
      );
      return {
        size: String(contracts),
        source: "margin_estimate",
      };
    }

    const explicitSize = trimInteger(suggestedSize);
    if (explicitSize) {
      return {
        size: explicitSize,
        source: "explicit_size",
      };
    }

    if (
      !Number.isFinite(multiplier) ||
      multiplier <= 0 ||
      !Number.isFinite(numericPrice) ||
      numericPrice <= 0 ||
      !Number.isFinite(numericLeverage) ||
      numericLeverage <= 0 ||
      !Number.isFinite(numericMargin) ||
      numericMargin <= 0
    ) {
      return {
        size: "",
        source: "unresolved",
      };
    }

    return {
      size: "",
      source: "unresolved",
    };
  }

  async previewTrade(action) {
    if (!action) {
      return null;
    }

    if (!String(action.kind || "").startsWith("futures_")) {
      return {
        market: "spot",
        kind: action.kind || "spot_market",
      };
    }

    const settle = String(action.settle || "usdt").toLowerCase();
    const contract = String(action.contract || action.symbol || "").toUpperCase();
    const contractInfo = await this.getFuturesContract(contract, settle);
    const referencePrice =
      Number.parseFloat(action.price || "") ||
      Number.parseFloat(contractInfo?.mark_price || "") ||
      Number.parseFloat(contractInfo?.last_price || "") ||
      0;
    const requestedLeverage =
      trimInteger(String(action.leverage || "").replace(/x$/i, "")) || "20";
    const position = await this.tryGetFuturesPosition(contract, settle);
    const currentLeverage = extractPositionLeverage(position);
    const hasOpenPosition = hasOpenFuturesPosition(position);
    const leverage = hasOpenPosition && currentLeverage ? currentLeverage : requestedLeverage;
    const estimated = this.estimateFuturesContracts({
      contractInfo,
      referencePrice,
      leverage,
      marginQuote: action.marginQuote || action.amountQuote,
      suggestedSize: action.size,
    });

    return {
      market: "futures",
      settle,
      contract,
      contractInfo,
      position,
      hasOpenPosition,
      referencePrice: referencePrice ? trimAmount(referencePrice) : "",
      leverage,
      leverageSource: hasOpenPosition && currentLeverage ? "current_position" : "requested_or_default",
      estimatedContracts: estimated.size,
      estimatedFrom: estimated.source,
      orderType: action.orderType || (String(action.kind || "").includes("limit") ? "limit" : "market"),
      marginQuote: trimAmount(action.marginQuote || action.amountQuote || ""),
    };
  }

  async placeFuturesOrder(action) {
    const settle = String(action.settle || "usdt").toLowerCase();
    const contract = String(action.contract || action.symbol || "").toUpperCase();
    if (!contract) {
      throw new Error("合约交易缺少合约名称，例如 BTC_USDT");
    }

    const preview = await this.previewTrade(action);
    const leverage = preview?.leverage || "1";
    const unsignedContracts = trimInteger(action.size || preview?.estimatedContracts);
    if (!unsignedContracts) {
      throw new Error("未能推导出合约下单数量，请在确认页手动填写“数量（张）”");
    }

    const signedSize =
      String(action.side || "").toLowerCase() === "sell" ? -Number(unsignedContracts) : Number(unsignedContracts);
    const orderType =
      action.orderType || (String(action.kind || "").includes("limit") ? "limit" : "market");
    const tif =
      orderType === "limit"
        ? String(action.timeInForce || "gtc").toLowerCase()
        : String(action.timeInForce || "ioc").toLowerCase();
    const price =
      orderType === "limit"
        ? trimAmount(action.price || preview?.referencePrice)
        : "0";

    if (orderType === "limit" && !price) {
      throw new Error("限价单需要填写价格");
    }

    const body = JSON.stringify({
      contract,
      size: signedSize,
      price,
      tif,
      text: action.clientOrderId || `t-futures-${Date.now().toString().slice(-8)}`,
      reduce_only: action.reduceOnly === true,
    });

    if (this.dryRun) {
      return {
        dryRun: true,
        endpoint: `/futures/${settle}/orders`,
        leverageRequest: {
          endpoint: `/futures/${settle}/positions/${contract}/leverage`,
          leverage,
        },
        requestBody: JSON.parse(body),
        preview,
      };
    }

    if (!this.isConfigured()) {
      throw new Error("Gate API Key / Secret 尚未配置，暂时无法真实下单");
    }

    if (!preview?.hasOpenPosition) {
      await this.updateFuturesLeverage(contract, leverage, settle);
    }
    return this.request("POST", `/futures/${encodeURIComponent(settle)}/orders`, "", body);
  }

  async createFuturesPriceTriggeredOrder({
    settle = "usdt",
    contract,
    triggerPrice,
    triggerRule,
    clientOrderId,
  }) {
    const normalizedTriggerPrice = trimAmount(triggerPrice);
    const normalizedTriggerRule =
      triggerRule === 1 || triggerRule === 2
        ? triggerRule
        : String(triggerRule || "") === ">="
          ? 1
          : String(triggerRule || "") === "<="
            ? 2
            : 0;
    if (!contract || !normalizedTriggerPrice || ![1, 2].includes(normalizedTriggerRule)) {
      return null;
    }

    const body = JSON.stringify({
      initial: {
        contract,
        size: 0,
        price: "0",
        close: true,
        tif: "ioc",
        text: clientOrderId || `t-protect-${Date.now().toString().slice(-8)}`,
        reduce_only: true,
      },
      trigger: {
        strategy_type: 0,
        price_type: 0,
        price: normalizedTriggerPrice,
        rule: normalizedTriggerRule,
        expiration: 86400,
      },
    });

    if (this.dryRun) {
      return {
        dryRun: true,
        endpoint: `/futures/${settle}/price_orders`,
        requestBody: JSON.parse(body),
      };
    }

    if (!this.isConfigured()) {
      throw new Error("Gate API Key / Secret 尚未配置，暂时无法提交保护条件单");
    }

    return this.request("POST", `/futures/${encodeURIComponent(settle)}/price_orders`, "", body);
  }

  async createFuturesTrailOrder({
    settle = "usdt",
    contract,
    amount,
    activationPrice,
    callbackRate = 0.003,
    isGte = true,
    clientOrderId,
  }) {
    const normalizedAmount = trimInteger(amount);
    const normalizedActivationPrice = trimAmount(activationPrice);
    const activationNumeric = Number.parseFloat(normalizedActivationPrice || "");
    const callbackOffset = Number.isFinite(activationNumeric) && activationNumeric > 0
      ? trimAmount(activationNumeric * callbackRate)
      : "";
    if (!contract || !normalizedAmount || !normalizedActivationPrice || !callbackOffset) {
      return null;
    }

    const body = JSON.stringify({
      contract,
      amount: normalizedAmount,
      activation_price: normalizedActivationPrice,
      is_gte: Boolean(isGte),
      price_offset: callbackOffset,
      reduce_only: true,
      text: clientOrderId || `t-trail-${Date.now().toString().slice(-8)}`,
    });

    if (this.dryRun) {
      return {
        dryRun: true,
        endpoint: `/futures/${settle}/autoorder/v1/trail/create`,
        requestBody: JSON.parse(body),
      };
    }

    if (!this.isConfigured()) {
      throw new Error("Gate API Key / Secret 尚未配置，暂时无法提交追踪止盈单");
    }

    return this.request(
      "POST",
      `/futures/${encodeURIComponent(settle)}/autoorder/v1/trail/create`,
      "",
      body,
    );
  }

  async placeFuturesProtectionOrders(action) {
    if (!String(action?.kind || "").startsWith("futures_")) {
      return { orders: [], errors: [] };
    }

    const protectionPlan = action?.protectionPlan || {};
    const settle = String(action.settle || "usdt").toLowerCase();
    const contract = String(action.contract || action.symbol || "").toUpperCase();
    const side = String(action.side || "").toLowerCase();
    if (!contract || !["buy", "sell"].includes(side) || action.reduceOnly === true) {
      return { orders: [], errors: [] };
    }

    const orders = [];
    const errors = [];
    const takeProfits = Array.isArray(protectionPlan.takeProfits) ? protectionPlan.takeProfits : [];
    const trailingTakeProfit =
      protectionPlan.trailingTakeProfit?.activationPrice
        ? {
            activationPrice: protectionPlan.trailingTakeProfit.activationPrice,
            callbackRate: protectionPlan.trailingTakeProfit.callbackRate || 0.003,
          }
        : takeProfits.length >= 2
          ? {
              activationPrice: takeProfits[0],
              callbackRate: 0.003,
            }
          : null;
    const firstTakeProfit = trailingTakeProfit?.activationPrice || takeProfits[0] || null;
    const finalTakeProfit = protectionPlan.finalTakeProfit || takeProfits[1] || firstTakeProfit;
    const stopLoss = protectionPlan.stopLoss ?? null;
    const preview = await this.previewTrade(action);
    const closeAmount = trimInteger(action.size || preview?.estimatedContracts);
    let lastPrice = null;
    try {
      const contractInfo = await this.getFuturesContract(contract, settle);
      lastPrice =
        parseNumeric(contractInfo?.last_price) ||
        parseNumeric(contractInfo?.mark_price) ||
        parseNumeric(contractInfo?.index_price);
    } catch {
      lastPrice = null;
    }

    const isValidTrigger = (triggerPrice, triggerRule) => {
      const numeric = parseNumeric(triggerPrice);
      if (numeric === null) {
        return false;
      }
      if (lastPrice === null) {
        return true;
      }
      return triggerRule === 1 ? numeric > lastPrice : numeric < lastPrice;
    };

    const pushError = (type, detail) => {
      errors.push(`${type}: ${detail}`);
    };

    if (trailingTakeProfit?.activationPrice && closeAmount) {
      const trailingTriggerOk =
        lastPrice === null ||
        (side === "buy"
          ? parseNumeric(trailingTakeProfit.activationPrice) > lastPrice
          : parseNumeric(trailingTakeProfit.activationPrice) < lastPrice);
      if (!trailingTriggerOk) {
        pushError(
          "take_profit_trailing",
          `activation ${trailingTakeProfit.activationPrice} is invalid near last price ${lastPrice}`,
        );
      } else {
        try {
          orders.push({
            type: "take_profit_trailing",
            triggerPrice: trailingTakeProfit.activationPrice,
            callbackRate: trailingTakeProfit.callbackRate || 0.003,
            request: await this.createFuturesTrailOrder({
              settle,
              contract,
              amount: closeAmount,
              activationPrice: trailingTakeProfit.activationPrice,
              callbackRate: trailingTakeProfit.callbackRate || 0.003,
              isGte: side === "buy",
              clientOrderId: `t-trail-${Date.now().toString().slice(-8)}`,
            }),
          });
        } catch (error) {
          pushError("take_profit_trailing", error.message);
        }
      }
    }

    if (finalTakeProfit) {
      const triggerRule = side === "buy" ? 1 : 2;
      if (!isValidTrigger(finalTakeProfit, triggerRule)) {
        pushError(
          "take_profit",
          `trigger ${finalTakeProfit} is invalid near last price ${lastPrice}`,
        );
      } else {
        try {
          orders.push({
            type: "take_profit",
            triggerPrice: finalTakeProfit,
            triggerRule,
            request: await this.createFuturesPriceTriggeredOrder({
              settle,
              contract,
              triggerPrice: finalTakeProfit,
              triggerRule,
              clientOrderId: `t-tp-${Date.now().toString().slice(-8)}`,
            }),
          });
        } catch (error) {
          pushError("take_profit", error.message);
        }
      }
    } else if (firstTakeProfit) {
      const triggerRule = side === "buy" ? 1 : 2;
      if (!isValidTrigger(firstTakeProfit, triggerRule)) {
        pushError(
          "take_profit",
          `trigger ${firstTakeProfit} is invalid near last price ${lastPrice}`,
        );
      } else {
        try {
          orders.push({
            type: "take_profit",
            triggerPrice: firstTakeProfit,
            triggerRule,
            request: await this.createFuturesPriceTriggeredOrder({
              settle,
              contract,
              triggerPrice: firstTakeProfit,
              triggerRule,
              clientOrderId: `t-tp-${Date.now().toString().slice(-8)}`,
            }),
          });
        } catch (error) {
          pushError("take_profit", error.message);
        }
      }
    }

    if (stopLoss) {
      const triggerRule = side === "buy" ? 2 : 1;
      if (!isValidTrigger(stopLoss, triggerRule)) {
        pushError("stop_loss", `trigger ${stopLoss} is invalid near last price ${lastPrice}`);
      } else {
        try {
          orders.push({
            type: "stop_loss",
            triggerPrice: stopLoss,
            triggerRule,
            request: await this.createFuturesPriceTriggeredOrder({
              settle,
              contract,
              triggerPrice: stopLoss,
              triggerRule,
              clientOrderId: `t-sl-${Date.now().toString().slice(-8)}`,
            }),
          });
        } catch (error) {
          pushError("stop_loss", error.message);
        }
      }
    }

    return { orders, errors };
  }

  async placeTrade(action) {
    if (String(action?.kind || "").startsWith("futures_")) {
      return this.placeFuturesOrder(action);
    }
    return this.placeSpotMarketOrder(action);
  }

  async getSpotTicker(symbol) {
    if (!symbol) {
      return null;
    }
    const payload = await this.publicRequest(
      "GET",
      "/spot/tickers",
      `currency_pair=${encodeURIComponent(symbol)}`,
    );
    return Array.isArray(payload) ? payload[0] || null : payload;
  }

  async getSpotBalances(currencies = []) {
    const rows = await this.request("GET", "/spot/accounts", "", "");
    if (!Array.isArray(rows)) {
      return [];
    }
    const wanted = new Set((currencies || []).map((item) => String(item || "").toUpperCase()));
    return rows.filter((item) => {
      if (!wanted.size) {
        return true;
      }
      return wanted.has(String(item.currency || "").toUpperCase());
    });
  }

  async resolveSpotAmount(action) {
    const rawAmount = action.side === "buy" ? action.amountQuote : action.amountBase;
    if (rawAmount !== "ALL") {
      return rawAmount;
    }

    if (action.side !== "sell") {
      throw new Error("amountBase=ALL 只支持卖出单");
    }

    const baseCurrency = String(action.symbol || "").split("_")[0]?.toUpperCase();
    if (!baseCurrency) {
      throw new Error("无法从交易对里识别基础币种");
    }

    if (this.dryRun) {
      return "ALL";
    }

    const available = await this.getAvailableSpotBalance(baseCurrency);
    if (!available) {
      throw new Error(`账户里没有可卖出的 ${baseCurrency} 现货仓位`);
    }
    return available;
  }
}
