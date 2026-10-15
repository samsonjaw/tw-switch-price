import { readFile } from "node:fs/promises";

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compatibleImageUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.hostname === "images.ctfassets.net") {
      // JPEG works in older mobile browsers and embedded web views where
      // explicitly requested WebP images can fail to render.
      url.searchParams.delete("fm");
    }
    return url.toString();
  } catch {
    return value;
  }
}

function normalizeGame(game, rating, priceHistory = [], now = Date.now()) {
  const price = game.price ?? {};
  const regularPrice = numberOrNull(price.regular_price?.raw_value);
  const rawSalePrice = numberOrNull(price.discount_price?.raw_value);
  const saleStartsAt = price.discount_price?.start_datetime ?? null;
  const saleEndsAt = price.discount_price?.end_datetime ?? null;
  const saleIsActive =
    rawSalePrice !== null &&
    (!saleStartsAt || new Date(saleStartsAt).getTime() <= now) &&
    (!saleEndsAt || new Date(saleEndsAt).getTime() > now);
  const salePrice = saleIsActive ? rawSalePrice : null;
  const discountPercent =
    regularPrice && salePrice !== null
      ? Math.round((1 - salePrice / regularPrice) * 100)
      : 0;
  const knownPrices = priceHistory
    .map((point) => numberOrNull(point.effectivePrice))
    .filter((value) => value !== null);
  const currentPrice = salePrice ?? regularPrice;
  if (currentPrice !== null) knownPrices.push(currentPrice);

  return {
    nsuid: game.nsuid,
    title: game.title,
    publisher: game.publisher ?? "未提供",
    releaseDate: game.releaseDateDownload ?? game.releaseDate ?? null,
    platform: game.hardwareCategory ?? "Nintendo Switch",
    categories: game.category ?? [],
    rating: game.rating ?? null,
    image: compatibleImageUrl(game.imageHero?.url ?? game.imageHeroOrg),
    salesStatus: price.sales_status ?? null,
    regularPrice,
    salePrice,
    discountPercent,
    saleStartsAt,
    saleEndsAt,
    criticScore: rating?.score ?? null,
    criticReviewCount: rating?.reviewCount ?? 0,
    userScore: rating?.userScore ?? null,
    ratingUrl: rating?.url ?? null,
    searchAliases: [rating?.igdbName, ...(rating?.aliases ?? [])].filter(Boolean),
    historicalLow: knownPrices.length ? Math.min(...knownPrices) : null,
    priceHistory,
  };
}

async function readOptionalJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function buildCatalog({ gamesPath, ratingsPath, historyPath }) {
  const [source, ratingsData, historyData] = await Promise.all([
    readOptionalJson(gamesPath),
    readOptionalJson(ratingsPath),
    readOptionalJson(historyPath),
  ]);
  if (!source) throw Object.assign(new Error("找不到遊戲資料"), { code: "ENOENT" });

  const updatedAt = source.summary?.checkedAt ?? new Date().toISOString();
  const ratings = ratingsData?.ratings ?? {};
  const history = historyData?.snapshots ?? {};
  return {
    updatedAt,
    stale: Date.now() - new Date(updatedAt).getTime() > 36 * 60 * 60 * 1000,
    summary: source.summary,
    ratingSummary: ratingsData
      ? {
          source: ratingsData.source,
          updatedAt: ratingsData.updatedAt,
          matchedGameCount: ratingsData.matchedGameCount,
        }
      : null,
    games: source.games.map((game) =>
      normalizeGame(game, ratings[game.nsuid], history[game.nsuid] ?? []),
    ),
  };
}
