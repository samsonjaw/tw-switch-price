#!/usr/bin/env node

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalog } from "./lib/catalog.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDirectory = join(root, "public");
const dataPath = join(root, "data", "tw-eshop.json");
const ratingsPath = join(root, "data", "igdb-ratings.json");
const historyPath = join(root, "data", "price-history.json");
const syncScriptPath = join(root, "scripts", "validate-tw-eshop.mjs");
const requestedPort = Number(process.env.PORT ?? 4173);

const publicFiles = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/styles.css", "styles.css"],
  ["/app.js", "app.js"],
]);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

let cachedData;
let cachedMtime = 0;
let cachedRatingsMtime = 0;
let cachedHistoryMtime = 0;
let cachedAt = 0;
let syncState = {
  status: "idle",
  message: "尚未從網站啟動更新",
  startedAt: null,
  finishedAt: null,
};

async function loadOptionalJson(path) {
  try {
    const info = await stat(path);
    const source = JSON.parse(await readFile(path, "utf8"));
    return { info, source };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { info: { mtimeMs: 0 }, source: null };
    }
    throw error;
  }
}

async function loadData() {
  const info = await stat(dataPath);
  const ratingsData = await loadOptionalJson(ratingsPath);
  const historyData = await loadOptionalJson(historyPath);
  if (
    cachedData &&
    Date.now() - cachedAt < 60_000 &&
    info.mtimeMs === cachedMtime &&
    ratingsData.info.mtimeMs === cachedRatingsMtime &&
    historyData.info.mtimeMs === cachedHistoryMtime
  ) return cachedData;

  cachedData = await buildCatalog({ dataPath, ratingsPath, historyPath, gamesPath: dataPath });
  cachedMtime = info.mtimeMs;
  cachedRatingsMtime = ratingsData.info.mtimeMs;
  cachedHistoryMtime = historyData.info.mtimeMs;
  cachedAt = Date.now();
  return cachedData;
}

function startSync() {
  if (syncState.status === "running") return false;

  syncState = {
    status: "running",
    message: "正在讀取任天堂台灣目錄…",
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  const child = spawn(
    process.execPath,
    [syncScriptPath, "--all", `--output=${dataPath}`],
    { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  const updateMessage = (chunk) => {
    const lines = String(chunk).trim().split(/[\r\n]+/).filter(Boolean);
    if (lines.length) syncState.message = lines.at(-1);
  };
  child.stdout.on("data", updateMessage);
  child.stderr.on("data", updateMessage);
  child.on("error", (error) => {
    syncState = {
      ...syncState,
      status: "error",
      message: error.message,
      finishedAt: new Date().toISOString(),
    };
  });
  child.on("close", (code) => {
    if (syncState.status === "error") return;
    syncState = {
      ...syncState,
      status: code === 0 ? "success" : "error",
      message: code === 0 ? "價格與歷史資料更新完成" : `更新失敗（代碼 ${code}）`,
      finishedAt: new Date().toISOString(),
    };
  });
  return true;
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (url.pathname === "/api/games" || url.pathname === "/api/games.json") {
      sendJson(response, 200, await loadData());
      return;
    }

    if (url.pathname === "/api/sync" && request.method === "GET") {
      sendJson(response, 200, syncState);
      return;
    }

    if (url.pathname === "/api/sync" && request.method === "POST") {
      const started = startSync();
      sendJson(response, started ? 202 : 200, syncState);
      return;
    }

    const publicFile = publicFiles.get(url.pathname);
    if (publicFile) {
      const filePath = join(publicDirectory, publicFile);
      const body = await readFile(filePath);
      response.writeHead(200, {
        "content-type": contentTypes[extname(filePath)],
        "cache-control": "no-cache",
      });
      response.end(body);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    if (error.code === "ENOENT" && url.pathname === "/api/games") {
      sendJson(response, 503, {
        error: "找不到本機資料，請先執行 npm run sync。",
      });
      return;
    }

    console.error(error);
    sendJson(response, 500, { error: "伺服器讀取資料時發生錯誤。" });
  }
});

server.listen(requestedPort, "127.0.0.1", () => {
  console.log(`台服價格觀測站：http://127.0.0.1:${requestedPort}`);
  console.log("按 Ctrl+C 停止本機伺服器");
});
