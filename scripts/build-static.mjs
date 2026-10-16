#!/usr/bin/env node

import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalog } from "../lib/catalog.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = join(root, "dist");
const siteUrl = (process.env.SITE_URL ?? "https://samsonjaw.github.io/tw-switch-price").replace(/\/$/, "");

const html = (value = "") => String(value)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const jsonLd = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
const money = new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 });
const day = new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Taipei" });
const shortDay = new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "numeric", day: "numeric", timeZone: "Asia/Taipei" });

function formatPrice(value) {
  return Number.isFinite(value) ? money.format(value) : "尚未定價";
}

function formatDate(value) {
  return value ? day.format(new Date(value)) : "日期未定";
}

function currentPrice(game) {
  return game.salePrice ?? game.regularPrice ?? null;
}

function gameUrl(game) {
  return `${siteUrl}/games/${encodeURIComponent(game.nsuid)}/`;
}

function priceChart(game) {
  const points = (game.priceHistory ?? [])
    .filter((point) => Number.isFinite(point.effectivePrice) && point.at)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  if (!points.length) return '<div class="chart-empty">目前尚無有效價格紀錄，網站每日更新後會在這裡累積。</div>';

  const width = 760, height = 250, left = 62, right = 18, top = 22, bottom = 42;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const values = points.map((point) => point.effectivePrice);
  const minimum = Math.min(...values), maximum = Math.max(...values);
  const range = Math.max(1, maximum - minimum);
  const paddedMin = Math.max(0, minimum - range * 0.12), paddedMax = maximum + range * 0.12;
  const start = new Date(points[0].at).getTime(), end = new Date(points.at(-1).at).getTime();
  const timeRange = Math.max(1, end - start);
  const x = (point) => points.length === 1 ? left + plotWidth / 2 : left + ((new Date(point.at).getTime() - start) / timeRange) * plotWidth;
  const y = (value) => top + ((paddedMax - value) / (paddedMax - paddedMin)) * plotHeight;
  let path = `M ${x(points[0]).toFixed(1)} ${y(points[0].effectivePrice).toFixed(1)}`;
  for (let index = 1; index < points.length; index += 1) path += ` H ${x(points[index]).toFixed(1)} V ${y(points[index].effectivePrice).toFixed(1)}`;
  const dots = points.map((point) => `<circle cx="${x(point).toFixed(1)}" cy="${y(point.effectivePrice).toFixed(1)}" r="4"><title>${html(formatDate(point.at))} ${html(formatPrice(point.effectivePrice))}</title></circle>`).join("");

  return `<div class="chart-wrap"><svg class="price-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${html(game.title)}的本站價格紀錄">
    <line class="chart-axis" x1="${left}" y1="${top + plotHeight}" x2="${width - right}" y2="${top + plotHeight}" />
    <line class="chart-grid" x1="${left}" y1="${top}" x2="${width - right}" y2="${top}" />
    <line class="chart-grid" x1="${left}" y1="${top + plotHeight / 2}" x2="${width - right}" y2="${top + plotHeight / 2}" />
    <text class="chart-label" x="${left - 8}" y="${top + 4}" text-anchor="end">${html(formatPrice(maximum))}</text>
    <text class="chart-label" x="${left - 8}" y="${top + plotHeight + 4}" text-anchor="end">${html(formatPrice(minimum))}</text>
    <text class="chart-label" x="${left}" y="${height - 11}">${html(shortDay.format(new Date(points[0].at)))}</text>
    <text class="chart-label" x="${width - right}" y="${height - 11}" text-anchor="end">${html(shortDay.format(new Date(points.at(-1).at)))}</text>
    <path class="chart-line" d="${path}" /><g class="chart-dots">${dots}</g>
  </svg></div>`;
}

function priceHistoryTable(game) {
  const points = (game.priceHistory ?? [])
    .filter((point) => Number.isFinite(point.effectivePrice) && point.at)
    .slice(-12)
    .reverse();
  if (!points.length) return "";
  return `<div class="history-table-wrap"><table class="history-table"><thead><tr><th>日期</th><th>原價</th><th>特價</th><th>當時售價</th></tr></thead><tbody>${points.map((point) => `<tr><td>${html(shortDay.format(new Date(point.at)))}</td><td>${html(formatPrice(point.regularPrice))}</td><td>${Number.isFinite(point.salePrice) ? html(formatPrice(point.salePrice)) : "—"}</td><td><strong>${html(formatPrice(point.effectivePrice))}</strong></td></tr>`).join("")}</tbody></table></div>`;
}

function relatedGames(game, publisherIndex) {
  return (publisherIndex.get(game.publisher) ?? [])
    .filter((candidate) => candidate.nsuid !== game.nsuid)
    .sort((a, b) => (b.criticScore ?? -1) - (a.criticScore ?? -1) || a.title.localeCompare(b.title, "zh-Hant"))
    .slice(0, 6);
}

function gamePage(game, related, updatedAt) {
  const price = currentPrice(game), hasSale = game.salePrice !== null;
  const validHistory = (game.priceHistory ?? []).filter((point) => Number.isFinite(point.effectivePrice));
  const trackingStarted = validHistory[0]?.at ?? null;
  const description = `${game.title}－台灣 Nintendo eShop 目前${price === null ? "尚未定價" : `售價 ${formatPrice(price)}`}${hasSale ? `，折扣 ${game.discountPercent}%` : ""}。查看本站史低、價格變化與媒體評分。`;
  const canonical = gameUrl(game);
  const schema = {
    "@context": "https://schema.org", "@type": "VideoGame", name: game.title, url: canonical,
    image: game.image || undefined, gamePlatform: game.platform, datePublished: game.releaseDate || undefined,
    publisher: game.publisher ? { "@type": "Organization", name: game.publisher } : undefined,
    offers: price === null ? undefined : { "@type": "Offer", price, priceCurrency: "TWD", url: canonical },
    aggregateRating: game.criticScore === null || !game.criticReviewCount ? undefined : {
      "@type": "AggregateRating", ratingValue: Number(game.criticScore.toFixed(1)), bestRating: 100, ratingCount: game.criticReviewCount,
    },
  };

  return `<!doctype html><html lang="zh-Hant"><head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${html(game.title)}－台灣 eShop 價格、特價與史低</title>
  <meta name="description" content="${html(description)}" /><meta name="robots" content="index, follow" />
  <link rel="canonical" href="${html(canonical)}" />
  <meta property="og:type" content="website" /><meta property="og:locale" content="zh_TW" /><meta property="og:site_name" content="台服價格觀測站" />
  <meta property="og:title" content="${html(game.title)}－台灣 eShop 價格與特價" /><meta property="og:description" content="${html(description)}" /><meta property="og:url" content="${html(canonical)}" />
  ${game.image ? `<meta property="og:image" content="${html(game.image)}" />` : ""}
  <script type="application/ld+json">${jsonLd(schema)}</script>
  <script>try{const s=localStorage.getItem("tw-eshop-theme");document.documentElement.dataset.theme=s??(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light")}catch{}</script>
  <link rel="stylesheet" href="../../styles.css" /><link rel="stylesheet" href="../../game.css" />
</head><body data-nsuid="${html(game.nsuid)}">
  <header class="site-header"><a class="brand" href="../../" aria-label="回到台服價格觀測站首頁"><span class="brand-mark" aria-hidden="true"><i></i><i></i></span><span><strong>台服價格觀測站</strong><small>Nintendo Switch 台灣區</small></span></a><button id="theme-toggle" class="theme-toggle" type="button"><span id="theme-icon" aria-hidden="true">◐</span><span id="theme-label">深色</span></button></header>
  <main class="game-page">
    <nav class="breadcrumbs" aria-label="麵包屑"><a href="../../">所有遊戲</a><span>／</span><span>${html(game.title)}</span></nav>
    <article class="game-hero-detail"><div class="game-art">${game.image ? `<img src="${html(game.image)}" alt="${html(game.title)}遊戲圖片" />` : '<div class="image-placeholder">暫無圖片</div>'}</div><div class="game-summary">
      <p class="publisher">${html(game.publisher)}</p><h1>${html(game.title)}</h1>
      <div class="detail-tags"><span>${html(game.platform)}</span><span>${html(formatDate(game.releaseDate))}發售</span>${game.categories.map((category) => `<span>${html(category)}</span>`).join("")}${game.rating ? `<span>分級 ${html(game.rating)}</span>` : ""}</div>
      <section class="price-panel"><p>台灣 eShop 目前價格</p><div><strong>${html(formatPrice(price))}</strong>${hasSale ? `<del>${html(formatPrice(game.regularPrice))}</del><span class="detail-discount">省 ${game.discountPercent}%</span>` : ""}</div>${hasSale ? `<small>優惠至 ${html(formatDate(game.saleEndsAt))}</small>` : ""}</section>
      <div class="summary-cards"><div><small>本站史低${trackingStarted ? `（自 ${html(shortDay.format(new Date(trackingStarted)))}）` : ""}</small><strong>${html(formatPrice(game.historicalLow))}</strong></div><div><small>媒體評分</small><strong>${game.criticScore === null ? "—" : `${Math.round(game.criticScore)}／100`}</strong></div></div>
      <div class="detail-actions"><button id="favorite-button" type="button">☆ 加入收藏</button><a href="../../">搜尋其他遊戲</a></div>
    </div></article>
    <section class="detail-section" aria-labelledby="history-title"><div class="detail-heading"><div><p>PRICE HISTORY</p><h2 id="history-title">價格變化與本站史低</h2></div><strong>${html(formatPrice(game.historicalLow))}</strong></div>${priceChart(game)}${priceHistoryTable(game)}
      <div class="timeline-facts"><span>發售日：${html(formatDate(game.releaseDate))}</span><span>本站開始追蹤：${html(formatDate(trackingStarted))}</span><span>最後更新：${html(formatDate(updatedAt))}</span></div>
      <p class="history-notice">${trackingStarted ? `本頁價格曲線與「本站史低」只統計 ${html(formatDate(trackingStarted))}起由本站保存的資料，不代表遊戲發售至今，也不包含更早的特價。` : "本頁目前尚未有有效價格紀錄；顯示內容不代表遊戲發售至今的價格歷史。"} 每日更新後會持續累積。</p></section>
    <section class="detail-section" aria-labelledby="info-title"><div class="detail-heading"><div><p>GAME INFO</p><h2 id="info-title">遊戲資訊</h2></div></div>
      <dl class="info-grid"><div><dt>發行商</dt><dd>${html(game.publisher)}</dd></div><div><dt>平台</dt><dd>${html(game.platform)}</dd></div><div><dt>發售日期</dt><dd>${html(formatDate(game.releaseDate))}</dd></div><div><dt>分級</dt><dd>${html(game.rating ?? "未提供")}</dd></div><div><dt>類型</dt><dd>${html(game.categories.join("、") || "未提供")}</dd></div><div><dt>NSUID</dt><dd>${html(game.nsuid)}</dd></div></dl>
      ${game.criticScore !== null ? `<p class="rating-note">IGDB 收錄的專業媒體綜合評分為 <strong>${Math.round(game.criticScore)}／100</strong>，共 ${game.criticReviewCount} 篇評論。</p>` : ""}</section>
    ${related.length ? `<section class="detail-section" aria-labelledby="related-title"><div class="detail-heading"><div><p>MORE GAMES</p><h2 id="related-title">同發行商遊戲</h2></div></div><div class="related-grid">${related.map((item) => `<a href="../${encodeURIComponent(item.nsuid)}/">${item.image ? `<img src="${html(item.image)}" alt="" loading="lazy" />` : ""}<span><small>${html(item.publisher)}</small><strong>${html(item.title)}</strong><em>${html(formatPrice(currentPrice(item)))}</em></span></a>`).join("")}</div></section>` : ""}
  </main><footer><p>非任天堂官方服務。價格以 Nintendo eShop 結帳畫面為準。</p></footer><script type="module" src="../../game.js"></script>
</body></html>`;
}

await rm(output, { recursive: true, force: true });
await cp(join(root, "public"), output, { recursive: true });
await mkdir(join(output, "api"), { recursive: true });
const catalog = await buildCatalog({ gamesPath: join(root, "data", "tw-eshop.json"), ratingsPath: join(root, "data", "igdb-ratings.json"), historyPath: join(root, "data", "price-history.json") });

const publisherIndex = new Map();
for (const game of catalog.games) {
  if (!publisherIndex.has(game.publisher)) publisherIndex.set(game.publisher, []);
  publisherIndex.get(game.publisher).push(game);
}

await Promise.all(catalog.games.map(async (game) => {
  const directory = join(output, "games", String(game.nsuid));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "index.html"), gamePage(game, relatedGames(game, publisherIndex), catalog.updatedAt));
}));

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[`${siteUrl}/`, ...catalog.games.map(gameUrl)].map((url) => `  <url><loc>${html(url)}</loc><lastmod>${catalog.updatedAt.slice(0, 10)}</lastmod></url>`).join("\n")}\n</urlset>\n`;
const robots = `User-agent: *\nAllow: /tw-switch-price/\n\nSitemap: ${siteUrl}/sitemap.xml\n`;
await Promise.all([
  writeFile(join(output, "api", "games.json"), JSON.stringify(catalog)), writeFile(join(output, "sitemap.xml"), sitemap),
  writeFile(join(output, "robots.txt"), robots), writeFile(join(output, ".nojekyll"), ""),
]);
console.log(`Static site built: ${catalog.games.length.toLocaleString("en-US")} games and detail pages in dist/`);
