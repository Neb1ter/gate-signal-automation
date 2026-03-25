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
