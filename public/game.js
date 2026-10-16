const themeToggle = document.querySelector("#theme-toggle");
const themeIcon = document.querySelector("#theme-icon");
const themeLabel = document.querySelector("#theme-label");
const favoriteButton = document.querySelector("#favorite-button");
const nsuid = document.body.dataset.nsuid;

function applyTheme(theme, persist = false) {
  const dark = theme === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  themeIcon.textContent = dark ? "☀" : "☾";
  themeLabel.textContent = dark ? "淺色" : "深色";
  if (persist) localStorage.setItem("tw-eshop-theme", dark ? "dark" : "light");
}

function favorites() {
  try {
    return new Set(JSON.parse(localStorage.getItem("tw-eshop-favorites") ?? "[]"));
  } catch {
    return new Set();
  }
}

function renderFavorite() {
  const selected = favorites().has(nsuid);
  favoriteButton.textContent = selected ? "★ 已收藏" : "☆ 加入收藏";
  favoriteButton.setAttribute("aria-pressed", String(selected));
}

themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next, true);
});

favoriteButton.addEventListener("click", () => {
  const saved = favorites();
  if (saved.has(nsuid)) saved.delete(nsuid);
  else saved.add(nsuid);
  localStorage.setItem("tw-eshop-favorites", JSON.stringify([...saved]));
  renderFavorite();
});

applyTheme(document.documentElement.dataset.theme);
renderFavorite();
