// -*- coding: utf-8 -*-
// KOL signal scraper — fetches AI-analyzed KOL trading signals from 链云KOL助手 (kol.lysq.cc)

const API_BASE = "https://kol.lysq.cc/v1/api";

const POLL_INTERVAL_SEC = 60;
const SEEN_TTL_MS = 60 * 60 * 1000; // 1 hour dedup

const seen = new Map();

function isDuplicate(id) {
  if (!id) return true;
  const last = seen.get(id);
  if (last && Date.now() - last < SEEN_TTL_MS) return true;
  seen.set(id, Date.now());
  return false;
}

function fmtDir(dir) {
  if (dir === "buy" || dir === "long") return "🟢 做多";
  if (dir === "sell" || dir === "short") return "🔴 做空";
  if (dir === "hold") return "⚪ 观望";
  return dir || "信号";
}

function fmtSentiment(s) {
  if (s === "bullish") return "看涨";
  if (s === "bearish") return "看跌";
  if (s === "neutral") return "中性";
  return s || "";
}

function parseTpSl(signal) {
  const parts = [];
  if (signal.stop_loss) parts.push(`止损 ${signal.stop_loss}`);
  if (signal.targets?.length) parts.push(`止盈 ${signal.targets.join(" / ")}`);
  else if (signal.take_profits?.length) parts.push(`止盈 ${signal.take_profits.join(" / ")}`);
  else if (signal.takeProfit) parts.push(`止盈 ${signal.takeProfit}`);
  return parts.join(" ｜ ");
}

function formatSignal(signal) {
  const author = signal.author_name || signal.author_username || "KOL";
  const channel = signal.channel_name || "";
  const symbol = signal.symbol || "";
  const dir = fmtDir(signal.direction || signal.entry_type);
  const entry = signal.entry_zone
    ? `入场 ${signal.entry_zone.min}${signal.entry_zone.max !== signal.entry_zone.min ? "-" + signal.entry_zone.max : ""}`
    : signal.entry_price_raw
      ? `入场 ${signal.entry_price_raw}`
      : "";
  const ai = signal.ai_analysis || signal.ai_result || {};
  const risk = ai.risk_level || "";
  const sentiment = fmtSentiment(ai.sentiment || signal.sentiment || "");
  const tpSl = parseTpSl({ ...signal, ...ai });
  const summary = ai.summary || signal.analysis || "";

  const lines = [];
  lines.push(`**${symbol}  ${dir}**`);
  lines.push(`┃ 👤 ${author}${channel ? ` · ${channel}` : ""}`);
  if (entry) lines.push(`┃ 📍 ${entry}`);
  if (tpSl) lines.push(`┃ 🎯 ${tpSl}`);
  if (sentiment || risk) {
    const tags = [sentiment, risk ? `风险${risk}` : ""].filter(Boolean);
    lines.push(`┃ 📊 ${tags.join(" ｜ ")}`);
  }
  if (summary) lines.push(`┃ 💡 ${summary}`);
  return lines.join("\n");
}

function formatShortSignal(signal) {
  const author = signal.author_name || signal.author_username || "KOL";
  const symbol = signal.symbol || "";
  const dir = signal.direction || signal.entry_type;
  const dirEmoji = dir === "buy" || dir === "long" ? "🟢" : dir === "sell" || dir === "short" ? "🔴" : "⚪";
  const entry = signal.entry_zone
    ? `入场${signal.entry_zone.min}`
    : signal.entry_price_raw
      ? `入场${signal.entry_price_raw}`
      : "";
  const tpSl = parseTpSl({ ...signal, ...(signal.ai_analysis || {}) });

  let text = `${dirEmoji} **${symbol}** ${author}`;
  if (entry) text += ` ｜ ${entry}`;
  if (tpSl) text += ` ｜ ${tpSl}`;
  return text;
}

export class KolScraper {
  constructor({
    discordWebhookUrl = "",
    feishuWebhookUrl = "",
    pollSec = POLL_INTERVAL_SEC,
  } = {}) {
    this.discordWebhookUrl = discordWebhookUrl;
    this.feishuWebhookUrl = feishuWebhookUrl;
    this.pollSec = pollSec;
    this.timer = null;
  }

  async fetchGroupedSignals() {
    try {
      const resp = await fetch(`${API_BASE}/ai-signals/grouped`, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) return [];
      const json = await resp.json();
      const groups = json?.data?.groups || [];
      return groups
        .filter((g) => !isDuplicate(g.groupKey + "_" + (g.latestSignal?.message_id || Date.now())))
        .map((g) => ({
          author_name: g.author_name,
          channel_name: g.channel_name,
          platform: g.platform,
          todayCount: g.todayCount,
          ...g.latestSignal,
          ai_analysis: g.latestSignal?.ai_analysis,
        }));
    } catch {
      return [];
    }
  }

  async postToDiscord(signals) {
    if (!this.discordWebhookUrl || !signals.length) return 0;
    let posted = 0;
    for (const s of signals) {
      try {
        const content = formatSignal(s);
        await fetch(this.discordWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
        });
        posted++;
        await new Promise((r) => setTimeout(r, 500));
      } catch {
        // skip
      }
    }
    return posted;
  }

  async postToFeishu(signals) {
    if (!this.feishuWebhookUrl || !signals.length) return 0;
    let posted = 0;
    for (const s of signals) {
      try {
        const text = formatShortSignal(s);
        await fetch(this.feishuWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            msg_type: "interactive",
            card: {
              header: {
                title: { content: `${s.symbol || "信号"} · ${s.author_name || "KOL"}`, tag: "plain_text" },
              },
              elements: [
                { tag: "div", text: { content: text, tag: "lark_md" } },
                { tag: "hr" },
                { tag: "note", elements: [{ content: `来源: 链云KOL助手 · ${s.channel_name || ""}`, tag: "plain_text" }] },
              ],
            },
          }),
        });
        posted++;
        await new Promise((r) => setTimeout(r, 300));
      } catch {
        // skip
      }
    }
    return posted;
  }

  async runOnce() {
    const signals = await this.fetchGroupedSignals();
    if (!signals.length) return;
    const [dc, fs] = await Promise.all([
      this.postToDiscord(signals),
      this.postToFeishu(signals),
    ]);
    if (dc || fs) {
      console.log(`[kol] Posted ${dc} discord + ${fs} feishu from ${signals.length} signals`);
    }
  }

  start() {
    if (!this.discordWebhookUrl && !this.feishuWebhookUrl) {
      console.log("[kol] No webhook configured — KOL scraper disabled");
      return;
    }
    console.log(`[kol] Scraper started — every ${this.pollSec}s`);
    setTimeout(() => this.runOnce(), 10_000);
    this.timer = setInterval(() => this.runOnce(), this.pollSec * 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
