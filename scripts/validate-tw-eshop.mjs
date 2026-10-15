#!/usr/bin/env node

/**
 * Nintendo Taiwan eShop feasibility probe.
 *
 * Uses only Node.js built-ins. It reads Nintendo Taiwan's public software
 * catalogue and then asks Nintendo's public price endpoint for each NSUID.
 */

const CATALOG_URL = "https://www.nintendo.com/tw/api/software?sftab=all";
const PRICE_URL = "https://api.ec.nintendo.com/v1/price";
const PAGE_SIZE = 24;
const PRICE_BATCH_SIZE = 30;
const REQUEST_DELAY_MS = 150;

const args = new Set(process.argv.slice(2));
const runAll = args.has("--all");
const outputArg = process.argv.slice(2).find((arg) => arg.startsWith("--output="));
const outputPath = outputArg?.slice("--output=".length);

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function getJson(url, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "tw-eshop-feasibility-probe/0.1",
        },
        signal: AbortSignal.timeout(20_000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(500 * attempt);
    }
  }

  throw lastError;
}

async function getCatalogPage(page) {
  const url = `${CATALOG_URL}&spage=${page}`;
  const data = await getJson(url);

  if (!Array.isArray(data.items) || typeof data.total !== "number") {
    throw new Error(`Unexpected catalogue response on page ${page}`);
  }

  return data;
}

async function getPrices(ids) {
  const params = new URLSearchParams({
    country: "TW",
    lang: "zh",
    ids: ids.join(","),
  });
  const data = await getJson(`${PRICE_URL}?${params}`);

  if (!Array.isArray(data.prices)) {
    throw new Error("Unexpected price response");
  }

  return data.prices;
}

function uniqueByNsuid(items) {
  return [
    ...new Map(
      items.filter((item) => item.nsuid).map((item) => [item.nsuid, item]),
    ).values(),
  ];
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function historyPoint(game, at) {
  const price = game.price ?? {};
  const regularPrice = numberOrNull(price.regular_price?.raw_value);
  const salePrice = numberOrNull(price.discount_price?.raw_value);
  return {
    at,
    regularPrice,
    salePrice,
    effectivePrice: salePrice ?? regularPrice,
  };
}

function addDatasetToHistory(snapshots, dataset) {
  const at = dataset?.summary?.checkedAt;
  if (!at || !Array.isArray(dataset.games)) return;

  for (const game of dataset.games) {
    if (!game.nsuid) continue;
    const points = snapshots[game.nsuid] ?? [];
    const byTime = new Map(points.map((point) => [point.at, point]));
    const point = historyPoint(game, at);
    byTime.set(point.at, point);
    const sorted = [...byTime.values()].sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
    );
    const changes = [];
    for (const item of sorted) {
      const previous = changes.at(-1);
      if (
        previous &&
        previous.regularPrice === item.regularPrice &&
        previous.salePrice === item.salePrice &&
        previous.effectivePrice === item.effectivePrice
      ) continue;
      changes.push(item);
    }
    snapshots[game.nsuid] = changes.slice(-120);
  }
}

async function main() {
  const firstPage = await getCatalogPage(1);
  const pageCount = Math.ceil(firstPage.total / PAGE_SIZE);
  const pages = runAll
    ? Array.from({ length: pageCount }, (_, index) => index + 1)
    : [...new Set([1, Math.ceil(pageCount / 2), pageCount])];

  const catalogueItems = [];
  for (const page of pages) {
    const data = page === 1 ? firstPage : await getCatalogPage(page);
    catalogueItems.push(...data.items);
    process.stderr.write(`\rCatalogue pages: ${page === pages.at(-1) ? pages.length : pages.indexOf(page) + 1}/${pages.length}`);
    await sleep(REQUEST_DELAY_MS);
  }
  process.stderr.write("\n");

  const games = uniqueByNsuid(catalogueItems);
  const catalogueEntriesWithoutNsuid = catalogueItems.filter(
    (item) => !item.nsuid,
  ).length;
  const prices = [];
  for (let index = 0; index < games.length; index += PRICE_BATCH_SIZE) {
    const batch = games.slice(index, index + PRICE_BATCH_SIZE);
    prices.push(...(await getPrices(batch.map((game) => game.nsuid))));
    process.stderr.write(
      `\rPrice batches: ${Math.ceil((index + 1) / PRICE_BATCH_SIZE)}/${Math.ceil(games.length / PRICE_BATCH_SIZE)}`,
    );
    await sleep(REQUEST_DELAY_MS);
  }
  process.stderr.write("\n");

  const priceById = new Map(
    prices.map((price) => [String(price.title_id), price]),
  );
  const missingPrices = games
    .filter((game) => !priceById.has(game.nsuid))
    .map(({ title, nsuid }) => ({ title, nsuid }));
  const discounted = prices.filter((price) => price.discount_price);
  const coverage = games.length
    ? Number(((prices.length / games.length) * 100).toFixed(2))
    : 0;

  const summary = {
    checkedAt: new Date().toISOString(),
    mode: runAll ? "all" : "sample",
    catalogueReportedTotal: firstPage.total,
    catalogueRowsReturned: catalogueItems.length,
    cataloguePagesChecked: pages.length,
    uniqueGamesChecked: games.length,
    catalogueEntriesWithoutNsuid,
    duplicateNsuidRows:
      catalogueItems.length - catalogueEntriesWithoutNsuid - games.length,
    pricesReturned: prices.length,
    priceCoveragePercent: coverage,
    activeDiscountsFound: discounted.length,
    missingPriceCount: missingPrices.length,
    missingPrices,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (outputPath) {
    const { mkdir, readFile, rename, writeFile } = await import("node:fs/promises");
    const { dirname, join } = await import("node:path");
    const rows = games.map((game) => ({
      ...game,
      price: priceById.get(game.nsuid) ?? null,
    }));
    const nextDataset = { summary, games: rows };
    const historyPath = join(dirname(outputPath), "price-history.json");
    let previousDataset = null;
    let history = { updatedAt: null, snapshots: {} };
    try {
      previousDataset = JSON.parse(await readFile(outputPath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      history = JSON.parse(await readFile(historyPath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    history.snapshots ??= {};
    addDatasetToHistory(history.snapshots, previousDataset);
    addDatasetToHistory(history.snapshots, nextDataset);
    history.updatedAt = summary.checkedAt;

    await mkdir(dirname(outputPath), { recursive: true });
    const temporaryPath = `${outputPath}.tmp`;
    await writeFile(
      temporaryPath,
      `${JSON.stringify(nextDataset, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryPath, outputPath);
    const temporaryHistoryPath = `${historyPath}.tmp`;
    await writeFile(
      temporaryHistoryPath,
      `${JSON.stringify(history, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryHistoryPath, historyPath);
    console.error(`Saved detailed result to ${outputPath}`);
    console.error(`Saved price history to ${historyPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
