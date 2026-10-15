#!/usr/bin/env node

import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalog } from "../lib/catalog.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = join(root, "dist");

await rm(output, { recursive: true, force: true });
await cp(join(root, "public"), output, { recursive: true });
await mkdir(join(output, "api"), { recursive: true });

const catalog = await buildCatalog({
  gamesPath: join(root, "data", "tw-eshop.json"),
  ratingsPath: join(root, "data", "igdb-ratings.json"),
  historyPath: join(root, "data", "price-history.json"),
});

await Promise.all([
  writeFile(join(output, "api", "games.json"), JSON.stringify(catalog)),
  writeFile(join(output, ".nojekyll"), ""),
]);

console.log(
  `Static site built: ${catalog.games.length.toLocaleString("en-US")} games in dist/`,
);
