// -*- coding: utf-8 -*-
// Price monitor — tracks BTC/ETH and alerts on key level breaks

const PAIRS = [
  { symbol: "BTCUSDT", name: "BTC", decimals: 0, roundLevels: 2000 },
  { symbol: "ETHUSDT", name: "ETH", decimals: 0, roundLevels: 100 },
];

const PRICE_API = "https://api.binance.com/api/v3/ticker/24hr";
const POLL_INTERVAL_SEC = 30;
const ALERT_COOLDOWN_MS = 10 * 60_000; // 10 min cooldown per level per pair

const state = new Map(); // symbol -> { lastPrice, alerts: Set }

function roundToLevel(price, step) {
  return Math.round(price / step) * step;
}

function formatPrice(price, symbol) {
  if (symbol === "BTCUSDT") return `$${price.toLocaleString("en-US")}`;
  return `$${price.toFixed(0)}`;
}

function fmtChange(pct) {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export class PriceMonitor {
  constructor({ webhookUrl = "", pollSec = POLL_INTERVAL_SEC } = {}) {
    this.webhookUrl = webhookUrl;
    this.pollSec = pollSec;
    this.timer = null;
    this.alertCooldowns = new Map(); // key -> timestamp
    this.lastPrices = new Map();
    this.last24hHigh = new Map();
    this.last24hLow = new Map();
  }

  isOnCooldown(key) {
    const last = this.alertCooldowns.get(key);
    if (last && Date.now() - last < ALERT_COOLDOWN_MS) return true;
    this.alertCooldowns.set(key, Date.now());
    return false;
  }

  async fetchPrices() {
    try {
      const symbols = PAIRS.map((p) => p.symbol);
      const resp = await fetch(
        `${PRICE_API}?symbols=${JSON.stringify(symbols)}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!resp.ok) return [];
      return await resp.json();
    } catch {
      return [];
    }
  }

  detectAlerts(pair, data) {
    const alerts = [];
    const price = Number(data.lastPrice);
    const high24h = Number(data.highPrice);
    const low24h = Number(data.lowPrice);
    const changePct = Number(data.priceChangePercent);

    const prev = this.lastPrices.get(pair.symbol);

    // Round level cross
    const currentLevel = roundToLevel(price, pair.roundLevels);
    if (prev) {
      const prevLevel = roundToLevel(prev, pair.roundLevels);
      if (currentLevel !== prevLevel) {
        const dir = price > prev ? "向上突破" : "向下跌破";
        const key = `${pair.symbol}:level:${currentLevel}`;
        if (!this.isOnCooldown(key)) {
          alerts.push({
            type: "level",
            text: `**${pair.name} ${dir} ${formatPrice(currentLevel, pair.symbol)}**`,
            detail: `现价 ${formatPrice(price, pair.symbol)}  24h ${fmtChange(changePct)}`,
          });
        }
      }
    }

    // Significant move (> 2% in polling window)
    if (prev) {
      const movePct = ((price - prev) / prev) * 100;
      if (Math.abs(movePct) >= 2) {
        const dir = movePct > 0 ? "急拉" : "急跌";
        const key = `${pair.symbol}:move:${Date.now()}`;
        if (!this.isOnCooldown(key)) {
          alerts.push({
            type: "surge",
            text: `⚡ **${pair.name} ${dir}** ${fmtChange(movePct)}`,
            detail: `现价 ${formatPrice(price, pair.symbol)}`,
          });
        }
      }
    }

    // 24h high/low record
    if (!this.last24hHigh.has(pair.symbol)) {
      this.last24hHigh.set(pair.symbol, high24h);
      this.last24hLow.set(pair.symbol, low24h);
    } else {
      const prevHigh = this.last24hHigh.get(pair.symbol);
      const prevLow = this.last24hLow.get(pair.symbol);
      if (price > prevHigh) {
        const key = `${pair.symbol}:high`;
        if (!this.isOnCooldown(key)) {
          alerts.push({
            type: "high",
            text: `🚀 **${pair.name} 创24h新高** ${formatPrice(price, pair.symbol)}`,
            detail: `24h涨幅 ${fmtChange(changePct)}`,
          });
        }
        this.last24hHigh.set(pair.symbol, price);
      }
      if (price < prevLow) {
        const key = `${pair.symbol}:low`;
        if (!this.isOnCooldown(key)) {
          alerts.push({
            type: "low",
            text: `📉 **${pair.name} 创24h新低** ${formatPrice(price, pair.symbol)}`,
            detail: `24h涨幅 ${fmtChange(changePct)}`,
          });
        }
        this.last24hLow.set(pair.symbol, price);
      }
    }

    this.lastPrices.set(pair.symbol, price);
    return alerts;
  }

  async runOnce() {
    const tickers = await this.fetchPrices();
    if (!tickers.length) return;
    if (!Array.isArray(tickers)) return; // single ticker returned

    const allAlerts = [];
    for (const pair of PAIRS) {
      const data = Array.isArray(tickers) ? tickers.find((t) => t.symbol === pair.symbol) : (tickers.symbol === pair.symbol ? tickers : null);
      if (data) {
        const alerts = this.detectAlerts(pair, data);
        allAlerts.push(...alerts);
      }
    }

    if (allAlerts.length) {
      await this.postAlerts(allAlerts);
    }
  }

  async postAlerts(alerts) {
    if (!this.webhookUrl || !alerts.length) return;
    for (const alert of alerts) {
      try {
        const content = `${alert.text}\n-# ${alert.detail}`;
        await fetch(this.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content,
            allowed_mentions: { parse: [] },
          }),
        });
        console.log(`[price] Alert: ${alert.text}`);
        await new Promise((r) => setTimeout(r, 500));
      } catch {
        // skip
      }
    }
  }

  async initBaseline() {
    // Fetch once to set initial state without alerts
    const tickers = await this.fetchPrices();
    if (!tickers.length) return;
    for (const pair of PAIRS) {
      const data = Array.isArray(tickers) ? tickers.find((t) => t.symbol === pair.symbol) : (tickers.symbol === pair.symbol ? tickers : null);
      if (data) {
        const price = Number(data.lastPrice);
        this.lastPrices.set(pair.symbol, price);
        this.last24hHigh.set(pair.symbol, Number(data.highPrice));
        this.last24hLow.set(pair.symbol, Number(data.lowPrice));
      }
    }
    console.log("[price] Baseline set — monitoring started");
  }

  start() {
    if (!this.webhookUrl) {
      console.log("[price] No webhook configured — price monitor disabled");
      return;
    }
    console.log(`[price] Monitor started — ${PAIRS.map((p) => p.name).join(", ")}, every ${this.pollSec}s`);
    this.initBaseline();
    this.timer = setInterval(() => this.runOnce(), this.pollSec * 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
