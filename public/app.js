const state = {
  games: [],
  filtered: [],
  filters: new Set(),
  query: "",
  sort: "rating",
  visible: 48,
  views: loadViews(),
  favorites: loadFavorites(),
  stale: false,
};

const isHostedStatic = location.hostname.endsWith("github.io");

const elements = {
  gameCount: document.querySelector("#game-count"),
  saleCount: document.querySelector("#sale-count"),
  bestDiscount: document.querySelector("#best-discount"),
  updatedAt: document.querySelector("#updated-at"),
  freshnessAlert: document.querySelector("#freshness-alert"),
  freshnessMessage: document.querySelector("#freshness-message"),
  syncStatus: document.querySelector("#sync-status"),
  syncButton: document.querySelector("#sync-button"),
  deploymentBadge: document.querySelector("#deployment-badge"),
  themeToggle: document.querySelector("#theme-toggle"),
  themeIcon: document.querySelector("#theme-icon"),
  themeLabel: document.querySelector("#theme-label"),
  search: document.querySelector("#search-input"),
  sort: document.querySelector("#sort-select"),
  chips: [...document.querySelectorAll(".filter-chip")],
  resultCount: document.querySelector("#result-count"),
  sortNote: document.querySelector("#sort-note"),
  status: document.querySelector("#status"),
  grid: document.querySelector("#game-grid"),
  loadMore: document.querySelector("#load-more"),
  dialog: document.querySelector("#game-dialog"),
  dialogContent: document.querySelector("#dialog-content"),
  dialogClose: document.querySelector(".dialog-close"),
};

function applyTheme(theme, persist = false) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  elements.themeToggle.setAttribute("aria-pressed", String(isDark));
  elements.themeToggle.setAttribute(
    "aria-label",
    isDark ? "切換為淺色模式" : "切換為深色模式",
  );
  elements.themeIcon.textContent = isDark ? "☀" : "☾";
  elements.themeLabel.textContent = isDark ? "淺色" : "深色";
  if (persist) localStorage.setItem("tw-eshop-theme", isDark ? "dark" : "light");
}

applyTheme(document.documentElement.dataset.theme);

function loadViews() {
  try {
    return JSON.parse(localStorage.getItem("tw-eshop-game-views") ?? "{}");
  } catch {
    return {};
  }
}

function loadFavorites() {
  try {
    return new Set(JSON.parse(localStorage.getItem("tw-eshop-favorites") ?? "[]"));
  } catch {
    return new Set();
  }
}

function isFavorite(game) {
  return state.favorites.has(game.nsuid);
}

function toggleFavorite(nsuid) {
  if (state.favorites.has(nsuid)) state.favorites.delete(nsuid);
  else state.favorites.add(nsuid);
  localStorage.setItem(
    "tw-eshop-favorites",
    JSON.stringify([...state.favorites]),
  );
  applyFilters();
  if (elements.dialog.open) showGame(nsuid, false);
}

function viewCount(game) {
  return Number(state.views[game.nsuid] ?? 0);
}

function recordView(game) {
  state.views[game.nsuid] = viewCount(game) + 1;
  localStorage.setItem("tw-eshop-game-views", JSON.stringify(state.views));
}

const currency = new Intl.NumberFormat("zh-TW", {
  style: "currency",
  currency: "TWD",
  maximumFractionDigits: 0,
});

const date = new Intl.DateTimeFormat("zh-TW", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const searchVariants = {
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
const searchRomanNumbers = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8" };

function normalizeSearch(value = "") {
  return String(value)
    .normalize("NFKD")
    .toLocaleLowerCase("zh-Hant")
    .replace(/\p{M}+/gu, "")
    .split("")
    .map((char) => searchVariants[char] ?? char)
    .join("")
    .replace(/\b(viii|vii|vi|iv|v|iii|ii)\b/gi, (value) => searchRomanNumbers[value])
    .replace(/[™®©]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compactSearch(value) {
  return normalizeSearch(value).replaceAll(" ", "");
}

function boundedLevenshtein(left, right, limit) {
  const a = Array.from(left);
  const b = Array.from(right);
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    let rowMinimum = current[0];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
      rowMinimum = Math.min(rowMinimum, current[column]);
    }
    if (rowMinimum > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

function fuzzyContains(target, query) {
  const targetChars = Array.from(target);
  const queryChars = Array.from(query);
  const limit = queryChars.length >= 8 ? 2 : 1;
  if (targetChars.length < queryChars.length - limit) return false;
  const minLength = Math.max(1, queryChars.length - limit);
  const maxLength = Math.min(targetChars.length, queryChars.length + limit);
  for (let start = 0; start <= targetChars.length - minLength; start += 1) {
    for (let length = minLength; length <= maxLength; length += 1) {
      if (start + length > targetChars.length) break;
      const candidate = targetChars.slice(start, start + length).join("");
      if (boundedLevenshtein(candidate, query, limit) <= limit) return true;
    }
  }
  return false;
}

function prepareSearch(game) {
  const values = [
    game.title,
    game.publisher,
    game.nsuid,
    ...(game.searchAliases ?? []),
  ];
  const normalized = [...new Set(values.map(normalizeSearch).filter(Boolean))];
  game.searchText = normalized.join(" ");
  game.searchCompacts = normalized.map((value) => value.replaceAll(" ", ""));
  return game;
}

function matchesSearch(game, query) {
  if (!query) return true;
  const compact = query.replaceAll(" ", "");
  if (
    game.searchText.includes(query) ||
    game.searchCompacts.some((value) => value.includes(compact))
  ) return true;
  if (compact.length < 4 || /^\d+$/.test(compact)) return false;
  return game.searchCompacts.some((value) => fuzzyContains(value, compact));
}

function formatPrice(value) {
  return value === null ? "尚未定價" : currency.format(value);
}

function formatDate(value) {
  return value ? date.format(new Date(value)) : "日期未定";
}

function historyTemplate(game) {
  const validPoints = (game.priceHistory ?? []).filter(
    (point) => Number.isFinite(point.effectivePrice) && point.at,
  );
  const points = validPoints.slice(-8).reverse();
  const trackingStarted = validPoints[0]?.at ?? null;
  const low = Number.isFinite(game.historicalLow)
    ? formatPrice(game.historicalLow)
    : "尚無資料";
  return `
    <section class="price-history">
      <h4>本站價格紀錄 · 史低 ${low}</h4>
      ${points.length
        ? `<ul class="history-list">${points
            .map(
              (point) => `<li><span>${formatDate(point.at)}</span><strong>${formatPrice(point.effectivePrice)}</strong></li>`,
            )
            .join("")}</ul>`
        : '<p class="sale-end">下次更新價格後，就會開始累積歷史紀錄。</p>'}
      <p class="sale-end">${trackingStarted
        ? `只統計 ${formatDate(trackingStarted)}起由本站保存的資料，不代表遊戲發售至今。`
        : "目前尚未有有效價格紀錄，不代表遊戲發售至今。"}</p>
    </section>`;
}

function currentPrice(game) {
  return game.salePrice ?? game.regularPrice ?? Number.POSITIVE_INFINITY;
}

function comparePriceHigh(a, b) {
  const aPrice = currentPrice(a);
  const bPrice = currentPrice(b);
  if (aPrice === Number.POSITIVE_INFINITY) return 1;
  if (bPrice === Number.POSITIVE_INFINITY) return -1;
  return bPrice - aPrice;
}

function cardTemplate(game) {
  const hasSale = game.salePrice !== null;
  const image = game.image
    ? `<img src="${escapeHtml(game.image)}" alt="" loading="lazy" />`
    : "";

  return `
    <article class="game-card">
      <button class="card-button" type="button" data-nsuid="${escapeHtml(game.nsuid)}">
        <div class="cover-wrap">
          ${image}
          ${hasSale ? `<span class="discount-badge">-${game.discountPercent}%</span>` : ""}
          <span class="platform-badge">${game.platform.includes("2") ? "SWITCH 2" : "SWITCH"}</span>
          ${game.criticScore !== null ? `<span class="score-badge">${Math.round(game.criticScore)}</span>` : ""}
        </div>
        <div class="card-body">
          <p class="publisher">${escapeHtml(game.publisher)}</p>
          <h3 class="game-title">${escapeHtml(game.title)}</h3>
          <div class="price-row">
            <span class="price-now">${formatPrice(currentPrice(game) === Number.POSITIVE_INFINITY ? null : currentPrice(game))}</span>
            ${hasSale ? `<span class="price-original">${formatPrice(game.regularPrice)}</span>` : ""}
          </div>
          <p class="sale-end card-note-row">
            <span>${hasSale ? `優惠至 ${formatDate(game.saleEndsAt)}` : `${formatDate(game.releaseDate)} 發售`}</span>
            ${viewCount(game) ? `<span class="view-count">查看 ${viewCount(game)} 次</span>` : ""}
          </p>
        </div>
      </button>
      <button class="favorite-button${isFavorite(game) ? " active" : ""}" type="button" data-favorite="${escapeHtml(game.nsuid)}" aria-label="${isFavorite(game) ? "取消收藏" : "加入收藏"}" aria-pressed="${isFavorite(game)}">★</button>
    </article>`;
}

function applyFilters() {
  const query = normalizeSearch(state.query);
  state.filtered = state.games.filter((game) => {
    return (
      matchesSearch(game, query) &&
      (!state.filters.has("favorite") || isFavorite(game)) &&
      (!state.filters.has("sale") || game.salePrice !== null) &&
      (!state.filters.has("switch2") || game.platform.includes("2")) &&
      (!state.filters.has("switch") || !game.platform.includes("2")) &&
      (!state.filters.has("under300") || currentPrice(game) <= 300) &&
      (!state.filters.has("score80") || game.criticScore >= 80)
    );
  });

  const sorters = {
    popular: (a, b) =>
      viewCount(b) - viewCount(a) ||
      b.discountPercent - a.discountPercent ||
      a.title.localeCompare(b.title, "zh-Hant"),
    rating: (a, b) =>
      (b.criticScore ?? -1) - (a.criticScore ?? -1) ||
      b.criticReviewCount - a.criticReviewCount ||
      a.title.localeCompare(b.title, "zh-Hant"),
    discount: (a, b) =>
      b.discountPercent - a.discountPercent || currentPrice(a) - currentPrice(b),
    "price-low": (a, b) => currentPrice(a) - currentPrice(b),
    "price-high": comparePriceHigh,
    newest: (a, b) =>
      new Date(b.releaseDate ?? 0).getTime() - new Date(a.releaseDate ?? 0).getTime(),
    title: (a, b) => a.title.localeCompare(b.title, "zh-Hant"),
  };
  state.filtered.sort(sorters[state.sort]);
  state.visible = 48;
  render();
}

function render() {
  elements.resultCount.textContent = state.filtered.length.toLocaleString("zh-TW");
  const notes = {
    popular: "依這台瀏覽器的查看次數排序",
    rating: "分數來自 IGDB 收錄的專業媒體評論",
  };
  elements.sortNote.textContent = notes[state.sort] ?? "";
  elements.sortNote.hidden = !notes[state.sort];

  if (!state.filtered.length) {
    elements.grid.hidden = true;
    elements.status.hidden = false;
    elements.status.innerHTML = "找不到符合條件的遊戲，試試其他關鍵字。";
    elements.loadMore.hidden = true;
    return;
  }

  elements.status.hidden = true;
  elements.grid.hidden = false;
  elements.grid.innerHTML = state.filtered
    .slice(0, state.visible)
    .map(cardTemplate)
    .join("");
  elements.loadMore.hidden = state.visible >= state.filtered.length;
}

function showGame(nsuid, record = true) {
  const game = state.games.find((item) => item.nsuid === nsuid);
  if (!game) return;

  if (record) recordView(game);
  const hasSale = game.salePrice !== null;
  elements.dialogContent.innerHTML = `
    ${game.image ? `<img class="dialog-cover" src="${escapeHtml(game.image)}" alt="" />` : ""}
    <div class="dialog-body">
      <p class="publisher">${escapeHtml(game.publisher)}</p>
      <h3>${escapeHtml(game.title)}</h3>
      <div class="dialog-meta">
        <span>${escapeHtml(game.platform)}</span>
        <span>${formatDate(game.releaseDate)} 發售</span>
        ${game.categories.map((category) => `<span>${escapeHtml(category)}</span>`).join("")}
        ${game.rating ? `<span>分級 ${escapeHtml(game.rating)}</span>` : ""}
      </div>
      <div class="dialog-price">
        <strong>${formatPrice(currentPrice(game) === Number.POSITIVE_INFINITY ? null : currentPrice(game))}</strong>
        ${hasSale ? `<span class="price-original">${formatPrice(game.regularPrice)}</span><p class="sale-end">折扣 ${game.discountPercent}%，優惠至 ${formatDate(game.saleEndsAt)}</p>` : ""}
      </div>
      ${game.criticScore !== null ? `<div class="dialog-price"><strong>${Math.round(game.criticScore)}／100</strong><p class="sale-end">IGDB 專業媒體綜合評分 · ${game.criticReviewCount} 篇評論</p></div>` : ""}
      <div class="dialog-actions">
        <button type="button" data-dialog-favorite="${escapeHtml(game.nsuid)}">${isFavorite(game) ? "★ 已收藏" : "☆ 加入收藏"}</button>
        <a class="detail-link" href="./games/${encodeURIComponent(game.nsuid)}/">查看完整頁面</a>
      </div>
      ${historyTemplate(game)}
      <p class="nsuid">NSUID ${escapeHtml(game.nsuid)}</p>
      <p class="nsuid">本機查看次數 ${viewCount(game)}</p>
    </div>`;
  if (!elements.dialog.open) elements.dialog.showModal();
}

function renderFreshness(sync = null) {
  elements.freshnessAlert.classList.remove("success", "error");
  elements.syncButton.disabled = sync?.status === "running";
  elements.syncButton.textContent =
    sync?.status === "running" ? "更新中…" : "更新價格";

  if (sync?.status === "running") {
    elements.freshnessAlert.hidden = false;
    elements.freshnessMessage.textContent = "正在向任天堂取得最新價格，通常需要 2～5 分鐘。";
    elements.syncStatus.textContent = (sync.message ?? "")
      .replace(/^Catalogue pages:/, "目錄頁面：")
      .replace(/^Price batches:/, "價格批次：");
    return;
  }
  if (sync?.status === "error") {
    elements.freshnessAlert.hidden = false;
    elements.freshnessAlert.classList.add("error");
    elements.freshnessMessage.textContent = "價格更新失敗。";
    elements.syncStatus.textContent = sync.message ?? "請稍後再試";
    return;
  }
  if (sync?.status === "success") {
    elements.freshnessAlert.hidden = false;
    elements.freshnessAlert.classList.add("success");
    elements.freshnessMessage.textContent = "價格和歷史資料已更新。";
    elements.syncStatus.textContent = "";
    setTimeout(() => renderFreshness(), 4_000);
    return;
  }
  elements.freshnessAlert.hidden = !state.stale;
  elements.freshnessMessage.textContent = state.stale
    ? isHostedStatic
      ? "價格資料已超過 36 小時，自動更新可能暫時失敗。"
      : "價格資料已超過 36 小時，建議更新後再確認特價。"
    : "";
  elements.syncStatus.textContent = "";
}

let syncPollTimer;
async function pollSync() {
  if (isHostedStatic) return;
  clearTimeout(syncPollTimer);
  try {
    const response = await fetch("/api/sync");
    const sync = await response.json();
    renderFreshness(sync);
    if (sync.status === "running") {
      syncPollTimer = setTimeout(pollSync, 1200);
    } else if (sync.status === "success") {
      await initialize();
      renderFreshness(sync);
    }
  } catch (error) {
    renderFreshness({ status: "error", message: error.message });
  }
}

async function startSync() {
  elements.syncButton.disabled = true;
  try {
    const response = await fetch("/api/sync", { method: "POST" });
    const sync = await response.json();
    if (!response.ok) throw new Error(sync.error ?? "無法開始更新");
    renderFreshness(sync);
    pollSync();
  } catch (error) {
    renderFreshness({ status: "error", message: error.message });
  }
}

async function initialize() {
  try {
    const response = await fetch("./api/games.json", { cache: "no-cache" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "無法讀取資料");

    state.games = data.games.map(prepareSearch);
    const sales = state.games.filter((game) => game.salePrice !== null);
    const bestDiscount = Math.max(0, ...sales.map((game) => game.discountPercent));
    elements.gameCount.textContent = state.games.length.toLocaleString("zh-TW");
    elements.saleCount.textContent = sales.length.toLocaleString("zh-TW");
    elements.bestDiscount.textContent = `${bestDiscount}%`;
    elements.updatedAt.textContent = `資料更新：${formatDate(data.updatedAt)}`;
    const firstHistoryDate = state.games
      .flatMap((game) => game.priceHistory ?? [])
      .filter((point) => Number.isFinite(point.effectivePrice) && point.at)
      .map((point) => new Date(point.at).getTime())
      .filter(Number.isFinite)
      .reduce((earliest, value) => Math.min(earliest, value), Number.POSITIVE_INFINITY);
    const historyCoverage = document.querySelector("#history-coverage");
    if (historyCoverage && Number.isFinite(firstHistoryDate)) {
      historyCoverage.textContent = `價格歷史自 ${formatDate(new Date(firstHistoryDate).toISOString())}起由本站累積，不代表各遊戲發售至今。`;
    }
    state.stale =
      !data.updatedAt ||
      Date.now() - new Date(data.updatedAt).getTime() > 36 * 60 * 60 * 1000;
    renderFreshness();
    const hasRatings = Boolean(data.ratingSummary?.matchedGameCount);
    const ratingOption = elements.sort.querySelector('[value="rating"]');
    const ratingChip = elements.chips.find((chip) => chip.dataset.filter === "score80");
    ratingOption.disabled = !hasRatings;
    ratingChip.disabled = !hasRatings;
    if (!hasRatings) {
      ratingOption.textContent = "媒體評分最高（尚未同步）";
      ratingChip.textContent = "媒體評分 80+（尚未同步）";
      state.sort = "discount";
      elements.sort.value = "discount";
    }
    applyFilters();
  } catch (error) {
    elements.status.classList.add("error");
    elements.status.innerHTML = escapeHtml(error.message);
    elements.updatedAt.textContent = "尚無價格資料";
  }
}

let searchTimer;
elements.search.addEventListener("input", (event) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = event.target.value;
    applyFilters();
  }, 120);
});

elements.sort.addEventListener("change", (event) => {
  state.sort = event.target.value;
  applyFilters();
});

elements.chips.forEach((chip) => {
  chip.addEventListener("click", () => {
    const filter = chip.dataset.filter;
    if (filter === "all") {
      state.filters.clear();
    } else {
      if (filter === "switch") state.filters.delete("switch2");
      if (filter === "switch2") state.filters.delete("switch");
      if (state.filters.has(filter)) state.filters.delete(filter);
      else state.filters.add(filter);
    }
    elements.chips.forEach((item) => {
      const active = item.dataset.filter === "all"
        ? state.filters.size === 0
        : state.filters.has(item.dataset.filter);
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    applyFilters();
  });
});

elements.grid.addEventListener("click", (event) => {
  const favorite = event.target.closest("[data-favorite]");
  if (favorite) {
    toggleFavorite(favorite.dataset.favorite);
    return;
  }
  const button = event.target.closest("[data-nsuid]");
  if (button) showGame(button.dataset.nsuid);
});

elements.loadMore.addEventListener("click", () => {
  state.visible += 48;
  render();
});

elements.dialogClose.addEventListener("click", () => elements.dialog.close());
elements.dialogContent.addEventListener("click", (event) => {
  const favorite = event.target.closest("[data-dialog-favorite]");
  if (favorite) toggleFavorite(favorite.dataset.dialogFavorite);
});
elements.dialog.addEventListener("click", (event) => {
  if (event.target === elements.dialog) elements.dialog.close();
});

if (isHostedStatic) {
  elements.syncButton.hidden = true;
  elements.deploymentBadge.innerHTML = "<i></i> 每日自動更新";
} else {
  elements.syncButton.addEventListener("click", startSync);
}
elements.themeToggle.addEventListener("click", () => {
  const nextTheme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme, true);
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    elements.search.focus();
  }
});

initialize();
pollSync();
