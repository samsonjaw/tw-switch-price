#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const gamesPath = join(root, "data", "tw-eshop.json");
const ratingsPath = join(root, "data", "igdb-ratings.json");
const overridesPath = join(root, "data", "rating-overrides.json");
const clientId = process.env.IGDB_CLIENT_ID;
const clientSecret = process.env.IGDB_CLIENT_SECRET;
const runSelfTest = process.argv.includes("--self-test");

if (!runSelfTest && (!clientId || !clientSecret)) {
  console.error("缺少 IGDB_CLIENT_ID 或 IGDB_CLIENT_SECRET。");
  console.error("請參考 README 的「同步媒體評分」設定環境變數。");
  process.exit(1);
}

const chineseVariants = {
  體: "体", 國: "国", 龍: "龙", 鬥: "斗", 惡: "恶", 樂: "乐",
  傳: "传", 說: "说", 無: "无", 雙: "双", 夢: "梦", 學: "学",
  劍: "剑", 戰: "战", 錄: "录", 險: "险", 島: "岛", 貓: "猫",
  馬: "马", 門: "门", 風: "风", 雲: "云", 電: "电", 腦: "脑",
  機: "机", 關: "关", 畫: "画", 華: "华", 萬: "万", 與: "与",
  為: "为", 這: "这", 來: "来", 時: "时", 會: "会", 後: "后",
  裡: "里", 發: "发", 現: "现", 開: "开", 復: "复", 歸: "归",
  擊: "击", 殺: "杀", 遊: "游", 戲: "戏", 騎: "骑", 獵: "猎",
  團: "团", 隊: "队", 寶: "宝", 貝: "贝", 聲: "声", 點: "点",
  線: "线", 數: "数", 據: "据", 臺: "台", 灣: "湾", 麗: "丽",
  種: "种", 級: "级", 場: "场", 圖: "图", 書: "书", 館: "馆",
  隻: "只", 處: "处", 選: "选", 擇: "择", 實: "实", 驗: "验",
  號: "号", 賽: "赛", 車: "车", 飛: "飞", 導: "导", 彈: "弹",
  際: "际", 聯: "联", 結: "结", 繪: "绘",
};
const romanNumbers = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8" };

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function getAccessToken() {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });
  const data = await requestJson(`https://id.twitch.tv/oauth2/token?${params}`, {
    method: "POST",
  });
  return data.access_token;
}

async function igdb(endpoint, query, accessToken) {
  const data = await requestJson(`https://api.igdb.com/v4/${endpoint}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Client-ID": clientId,
      Authorization: `Bearer ${accessToken}`,
    },
    body: query,
  });
  await sleep(300);
  return data;
}

function normalizeTitle(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .split("")
    .map((char) => chineseVariants[char] ?? char)
    .join("")
    .replace(/\b(viii|vii|vi|iv|v|iii|ii)\b/gi, (value) => romanNumbers[value])
    .replace(/[™®©]/g, "")
    .replace(/nintendo switch(?: 2)? edition/gi, "")
    .replace(/\b(deluxe|ultimate|complete|definitive) edition\b/gi, "")
    .replace(/(?:數位)?(?:豪華|完整版|終極|決定|典藏)版/gu, "")
    .replace(/(?:繁體|簡體)?中文版|英文版|日文版/gu, "")
    .replace(/[×✕]/g, "x")
    .replace(/[《》「」『』【】]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function titleAliases(title) {
  if (typeof title !== "string" || !title.trim()) return [];
  const aliases = new Set([normalizeTitle(title)]);
  const parenthetical = title.matchAll(/[（(]([^）)]+)[）)]/g);
  for (const match of parenthetical) aliases.add(normalizeTitle(match[1]));
  aliases.add(
    normalizeTitle(
      title.replace(/[（(](?:繁體中文|簡體中文|中文版|英文版|日文版)[）)]/g, ""),
    ),
  );
  for (const segment of title.split(/\s*(?:[-–—]|[：:])\s*/g)) {
    aliases.add(normalizeTitle(segment));
  }
  for (const match of title.matchAll(/[A-Za-z0-9][A-Za-z0-9 '&+.!:-]{2,}/g)) {
    aliases.add(normalizeTitle(match[0]));
  }
  return [...aliases].filter((alias) => alias.length >= 2);
}

function rawIgdbAliases(game) {
  return [...new Set([
    game.name,
    ...(game.alternative_names ?? []).map((item) => item?.name),
    ...(game.game_localizations ?? []).map((item) => item?.name),
  ].filter((value) => typeof value === "string" && value.trim()))];
}

function igdbAliases(game) {
  return rawIgdbAliases(game).flatMap(titleAliases).filter(Boolean);
}

function ngrams(value, size = 2) {
  const chars = Array.from(value);
  if (chars.length <= size) return new Set([value]);
  const output = new Set();
  for (let index = 0; index <= chars.length - size; index += 1) {
    output.add(chars.slice(index, index + size).join(""));
  }
  return output;
}

function levenshtein(left, right) {
  const a = Array.from(left);
  const b = Array.from(right);
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function titleSimilarity(left, right) {
  if (left === right) return 1;
  const leftLength = Array.from(left).length;
  const rightLength = Array.from(right).length;
  const minimum = Math.min(leftLength, rightLength);
  const maximum = Math.max(leftLength, rightLength);
  if (minimum < 3) return 0;
  const editScore = 1 - levenshtein(left, right) / maximum;
  const leftGrams = ngrams(left);
  const rightGrams = ngrams(right);
  let shared = 0;
  for (const gram of leftGrams) if (rightGrams.has(gram)) shared += 1;
  const diceScore = (2 * shared) / (leftGrams.size + rightGrams.size);
  const containmentScore =
    (left.includes(right) || right.includes(left)) && minimum >= 4
      ? 0.86 + 0.12 * (minimum / maximum)
      : 0;
  return Math.max(editScore, diceScore, containmentScore);
}

function releaseYear(game) {
  return game.first_release_date
    ? new Date(game.first_release_date * 1000).getUTCFullYear()
    : 0;
}

function localReleaseYear(game) {
  return Number(
    (game.releaseDateDownload ?? game.releaseDate ?? "").slice(0, 4),
  );
}

function publisherMatches(game, localGame) {
  const publisher = normalizeTitle(localGame.publisher);
  if (!publisher) return false;
  return (game.involved_companies ?? []).some((item) => {
    const company = normalizeTitle(item?.company?.name);
    return company && (company.includes(publisher) || publisher.includes(company));
  });
}

function buildFuzzyIndex(games) {
  const index = new Map();
  for (const game of games) {
    game._aliases = [...new Set(igdbAliases(game))];
    const gameGrams = new Set(game._aliases.flatMap((alias) => [...ngrams(alias)]));
    for (const gram of gameGrams) {
      if (!index.has(gram)) index.set(gram, []);
      index.get(gram).push(game);
    }
  }
  return index;
}

function fuzzyCandidate(localGame, index) {
  const localAliases = titleAliases(localGame.title).filter(
    (alias) => Array.from(alias).length >= 4,
  );
  const counts = new Map();
  for (const alias of localAliases) {
    for (const gram of ngrams(alias)) {
      for (const game of index.get(gram) ?? []) {
        counts.set(game.id, { game, count: (counts.get(game.id)?.count ?? 0) + 1 });
      }
    }
  }
  const candidates = [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);
  const localYear = localReleaseYear(localGame);
  const scored = candidates.map(({ game }) => {
    let score = 0;
    let shortestAlias = Number.POSITIVE_INFINITY;
    for (const localAlias of localAliases) {
      for (const remoteAlias of game._aliases) {
        const similarity = titleSimilarity(localAlias, remoteAlias);
        if (similarity > score) {
          score = similarity;
          shortestAlias = Math.min(
            Array.from(localAlias).length,
            Array.from(remoteAlias).length,
          );
        }
      }
    }
    const remoteYear = releaseYear(game);
    if (localYear && remoteYear && Math.abs(localYear - remoteYear) <= 1) score += 0.02;
    if (publisherMatches(game, localGame)) score += 0.03;
    return { game, score: Math.min(score, 1), shortestAlias };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) return null;
  const secondScore = scored[1]?.score ?? 0;
  const threshold = best.shortestAlias <= 4 ? 0.96 : best.shortestAlias <= 7 ? 0.91 : 0.87;
  if (best.score < threshold) return null;
  if (best.score < 0.96 && best.score - secondScore < 0.045) return null;
  return best;
}

function chooseCandidate(candidates, localGame) {
  if (candidates.length === 1) return candidates[0];
  const localYear = localReleaseYear(localGame);
  return [...candidates].sort((a, b) => {
    const aYear = a.first_release_date
      ? new Date(a.first_release_date * 1000).getUTCFullYear()
      : 0;
    const bYear = b.first_release_date
      ? new Date(b.first_release_date * 1000).getUTCFullYear()
      : 0;
    const aDistance = localYear && aYear ? Math.abs(localYear - aYear) : 99;
    const bDistance = localYear && bYear ? Math.abs(localYear - bYear) : 99;
    return (
      aDistance - bDistance ||
      (b.aggregated_rating_count ?? 0) - (a.aggregated_rating_count ?? 0)
    );
  })[0];
}

async function readOverrides() {
  try {
    return JSON.parse(await readFile(overridesPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function main() {
  const local = JSON.parse(await readFile(gamesPath, "utf8"));
  const overrides = await readOverrides();
  const accessToken = await getAccessToken();

  const platforms = await igdb(
    "platforms",
    'fields id,name,slug; where slug = "switch" | slug = "switch-2"; limit 10;',
    accessToken,
  );
  const platformIds = platforms.map((platform) => platform.id);
  if (!platformIds.length) throw new Error("IGDB 找不到 Switch 平台資料。");

  const ratedGames = [];
  for (let offset = 0; ; offset += 500) {
    const batch = await igdb(
      "games",
      `fields name,alternative_names.name,game_localizations.name,involved_companies.company.name,aggregated_rating,aggregated_rating_count,rating,rating_count,total_rating,total_rating_count,url,first_release_date,platforms; where platforms = (${platformIds.join(",")}) & aggregated_rating != null; sort aggregated_rating desc; limit 500; offset ${offset};`,
      accessToken,
    );
    ratedGames.push(...batch);
    process.stderr.write(`\rIGDB rated games: ${ratedGames.length}`);
    if (batch.length < 500) break;
  }
  process.stderr.write("\n");

  const byAlias = new Map();
  const byId = new Map(ratedGames.map((game) => [String(game.id), game]));
  const fuzzyIndex = buildFuzzyIndex(ratedGames);
  for (const game of ratedGames) {
    for (const alias of game._aliases) {
      if (!byAlias.has(alias)) byAlias.set(alias, []);
      byAlias.get(alias).push(game);
    }
  }

  const ratings = {};
  const matchCounts = { override: 0, exact: 0, fuzzy: 0 };
  for (const game of local.games) {
    let match = overrides[game.nsuid]
      ? byId.get(String(overrides[game.nsuid]))
      : null;
    let matchType = match ? "override" : null;
    let matchScore = match ? 1 : null;
    if (!match) {
      const candidates = new Map();
      for (const alias of titleAliases(game.title)) {
        for (const candidate of byAlias.get(alias) ?? []) {
          candidates.set(candidate.id, candidate);
        }
      }
      if (candidates.size) {
        match = chooseCandidate([...candidates.values()], game);
        matchType = "exact";
        matchScore = 1;
      }
    }
    if (!match) {
      const fuzzy = fuzzyCandidate(game, fuzzyIndex);
      if (fuzzy) {
        match = fuzzy.game;
        matchType = "fuzzy";
        matchScore = Math.round(fuzzy.score * 1000) / 1000;
      }
    }
    if (!match) continue;
    matchCounts[matchType] += 1;

    ratings[game.nsuid] = {
      score: Math.round(match.aggregated_rating * 10) / 10,
      reviewCount: match.aggregated_rating_count ?? 0,
      userScore:
        match.rating === undefined ? null : Math.round(match.rating * 10) / 10,
      userRatingCount: match.rating_count ?? 0,
      igdbId: match.id,
      igdbName: match.name,
      aliases: rawIgdbAliases(match),
      matchType,
      matchScore,
      url: match.url,
    };
  }

  const output = {
    updatedAt: new Date().toISOString(),
    source: "IGDB",
    sourceUrl: "https://www.igdb.com/",
    localGameCount: local.games.length,
    igdbRatedGameCount: ratedGames.length,
    matchedGameCount: Object.keys(ratings).length,
    matchCounts,
    ratings,
  };
  await mkdir(dirname(ratingsPath), { recursive: true });
  const temporaryPath = `${ratingsPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await rename(temporaryPath, ratingsPath);
  console.log(
    `評分同步完成：${output.matchedGameCount}/${output.localGameCount} 款成功匹配。`,
  );
  console.log(
    `配對方式：完全 ${matchCounts.exact}、近似 ${matchCounts.fuzzy}、手動 ${matchCounts.override}。`,
  );
  console.log(`已保存至 ${ratingsPath}`);
}

function selfTestMatcher() {
  const ratedGames = [
    {
      id: 1,
      name: "Rayman Legends Retold",
      alternative_names: [],
      game_localizations: [],
      involved_companies: [{ company: { name: "Ubisoft" } }],
      first_release_date: Date.UTC(2026, 11, 3) / 1000,
    },
    {
      id: 2,
      name: "Rayman Legends",
      alternative_names: [],
      game_localizations: [],
      involved_companies: [{ company: { name: "Ubisoft" } }],
      first_release_date: Date.UTC(2017, 8, 12) / 1000,
    },
    {
      id: 3,
      name: "勇者斗恶龙怪物仙境",
      alternative_names: [],
      game_localizations: [],
      involved_companies: [{ company: { name: "Square Enix" } }],
      first_release_date: Date.UTC(2026, 11, 3) / 1000,
    },
    {
      id: 4,
      name: "Hades",
      alternative_names: [],
      game_localizations: [],
      involved_companies: [{ company: { name: "Supergiant Games" } }],
      first_release_date: Date.UTC(2020, 8, 17) / 1000,
    },
    {
      id: 5,
      name: "Hades II",
      alternative_names: [],
      game_localizations: [],
      involved_companies: [{ company: { name: "Supergiant Games" } }],
      first_release_date: Date.UTC(2025, 8, 25) / 1000,
    },
  ];
  const index = buildFuzzyIndex(ratedGames);
  const cases = [
    {
      local: {
        title: "《雷射超人：傳奇重述》 - Rayman Legends Retld",
        publisher: "Ubisoft",
        releaseDate: "2026-12-03T00:00:00.000Z",
      },
      expected: 1,
    },
    {
      local: {
        title: "勇者鬥惡龍怪物仙境",
        publisher: "SQUARE ENIX",
        releaseDate: "2026-12-03T00:00:00.000Z",
      },
      expected: 3,
    },
    {
      local: {
        title: "Hades 2",
        publisher: "Supergiant Games",
        releaseDate: "2025-09-25T00:00:00.000Z",
      },
      expected: 5,
    },
  ];
  for (const test of cases) {
    const result = fuzzyCandidate(test.local, index);
    if (result?.game.id !== test.expected) {
      throw new Error(
        `Matcher self-test failed for ${test.local.title}: ${result?.game.id ?? "no match"}`,
      );
    }
  }
  console.log(`Matcher self-test passed (${cases.length} cases).`);
}

if (runSelfTest) {
  selfTestMatcher();
} else {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
