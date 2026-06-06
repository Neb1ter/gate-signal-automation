// -*- coding: utf-8 -*-
// News scraper — fetches RSS feeds from crypto news sites and posts to Discord

import { config } from "./config.mjs";

const FEEDS = [
  {
    name: "吴说区块链",
    url: "https://wublock123.com/feed",
  },
];

const MAX_ITEMS_PER_FETCH = 5;
const FETCH_INTERVAL_MIN = 5;
const SEEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const seen = new Map();

function parseRSSItems(xmlText) {
  const items = [];
  // Match <item>...</item> blocks
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xmlText)) !== null) {
    const block = match[1];
    const title = extractTag(block, "title");
    const link = extractTag(block, "link");
    const pubDate = extractTag(block, "pubDate");
    const description = extractTag(block, "description");
    if (title && link) {
      items.push({
        title: decodeEntities(stripCDATA(title)),
        link: stripCDATA(link),
        pubDate: pubDate ? decodeEntities(stripCDATA(pubDate)) : "",
        description: description
          ? stripHTML(decodeEntities(stripCDATA(description))).slice(0, 200)
          : "",
      });
    }
  }
  return items;
}

// Atom feed support
function parseAtomItems(xmlText) {
  const items = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = entryRegex.exec(xmlText)) !== null) {
    const block = match[1];
    const title = extractTag(block, "title");
    const link = extractAtomLink(block);
    const updated = extractTag(block, "updated");
    const summary = extractTag(block, "summary");
    if (title && link) {
      items.push({
        title: decodeEntities(stripCDATA(title)),
        link,
        pubDate: updated ? decodeEntities(stripCDATA(updated)) : "",
        description: summary
          ? stripHTML(decodeEntities(stripCDATA(summary))).slice(0, 200)
          : "",
      });
    }
  }
  return items;
}

function extractTag(block, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(regex);
  return m ? m[1].trim() : "";
}

function extractAtomLink(block) {
  const hrefRegex = /<link[^>]*href="([^"]*)"[^>]*\/?>/i;
  const m = block.match(hrefRegex);
  if (m) return m[1];
  return extractTag(block, "link");
}

function stripCDATA(text) {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripHTML(text) {
  return text.replace(/<\/?[^>]+(>|$)/g, "");
}

function isDuplicate(link) {
  const normalized = String(link || "").trim();
  if (!normalized) return true;
  const lastSeen = seen.get(normalized);
  if (lastSeen && Date.now() - lastSeen < SEEN_TTL_MS) return true;
  seen.set(normalized, Date.now());
  return false;
}

function formatNewsItem(item, sourceName) {
  const lines = [`**【${sourceName}】** ${item.title}`];
  if (item.description) {
    lines.push(`> ${item.description}`);
  }
  lines.push(item.link);
  return lines.join("\n");
}

export class NewsScraper {
  constructor({ webhookUrl = "", intervalMin = FETCH_INTERVAL_MIN } = {}) {
    this.webhookUrl = webhookUrl;
    this.intervalMin = intervalMin;
    this.timer = null;
  }

  async fetchFeed(feed) {
    try {
      const resp = await fetch(feed.url, {
        headers: { "User-Agent": "NewsBot/1.0" },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) return [];
      const text = await resp.text();

      let items = [];
      if (text.includes("<entry>")) {
        items = parseAtomItems(text);
      } else if (text.includes("<item>")) {
        items = parseRSSItems(text);
      }

      return items
        .filter((item) => !isDuplicate(item.link))
        .slice(0, MAX_ITEMS_PER_FETCH);
    } catch {
      return [];
    }
  }

  async fetchAll() {
    const results = [];
    for (const feed of FEEDS) {
      const items = await this.fetchFeed(feed);
      for (const item of items) {
        results.push({ source: feed.name, ...item });
      }
    }
    return results;
  }

  async postToDiscord(articles) {
    if (!this.webhookUrl || !articles.length) return 0;
    let posted = 0;
    for (const article of articles) {
      try {
        const content = formatNewsItem(article, article.source);
        const resp = await fetch(this.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content,
            allowed_mentions: { parse: [] },
          }),
        });
        if (resp.ok) posted++;
        // Small delay between posts to stay under rate limits
        await new Promise((r) => setTimeout(r, 500));
      } catch {
        // skip failed posts
      }
    }
    return posted;
  }

  async runOnce() {
    const articles = await this.fetchAll();
    if (articles.length) {
      const posted = await this.postToDiscord(articles);
      if (posted) {
        console.log(`[news] Posted ${posted} articles from ${articles.length} fetched`);
      }
    }
  }

  start() {
    if (!this.webhookUrl) {
      console.log("[news] No news webhook configured — news scraper disabled");
      return;
    }
    console.log(
      `[news] Scraper started — ${FEEDS.length} feeds, every ${this.intervalMin} min`,
    );
    // Do an initial fetch after 30 seconds (let server settle)
    setTimeout(() => this.runOnce(), 30_000);
    this.timer = setInterval(() => this.runOnce(), this.intervalMin * 60_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

// Quick test CLI
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const s = new NewsScraper({ webhookUrl: "" });
  s.fetchAll().then((articles) => {
    console.log(`Fetched ${articles.length} articles:`);
    for (const a of articles) {
      console.log(`  [${a.source}] ${a.title}`);
    }
  });
}
