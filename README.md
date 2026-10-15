# 台服價格觀測站

這是一個不需安裝第三方套件的本機程式，可以抓取台灣 Nintendo eShop
商品價格、儲存成 JSON，並透過瀏覽器搜尋與瀏覽。

## 發布到 GitHub Pages

專案內的 `.github/workflows/pages.yml` 會發布靜態網站，並於台灣時間每天
04:15 自動更新價格。公開 repository 的 GitHub Actions 與 GitHub Pages 可免費使用。

1. 將 repository 的 `Settings` → `Pages` → `Source` 設為 `GitHub Actions`。
2. 將專案推送到 `main` 分支，等待 `Actions` 頁面的工作完成。
3. 網站網址為 `https://<帳號>.github.io/<repository>/`。

需要自動更新媒體評分時，在 repository 的 `Settings` → `Secrets and variables`
→ `Actions` 加入 `IGDB_CLIENT_ID` 與 `IGDB_CLIENT_SECRET`。價格同步不需要這兩項
密鑰。密鑰只存在 GitHub Secrets，不可寫入程式碼或上傳到 repository。

產生可發布的靜態檔案：

```bash
npm run build
```

輸出會放在 `dist/`，公開版不提供訪客手動觸發同步；更新由 GitHub Actions 執行。

## 快速開始

需要 Node.js 20 以上版本。第一次使用先抓資料：

```bash
npm run sync
```

抓取約需 2～5 分鐘，結果會安全地寫入 `data/tw-eshop.json`。完成後啟動本機 UI：

```bash
npm start
```

接著開啟 <http://127.0.0.1:4173>。只有本機能連線，按 `Ctrl+C` 關閉。

網站會在資料超過 36 小時後提醒更新。可直接按畫面上的「更新價格」，或執行
`npm run sync`。同步時會自動排除已結束的優惠，並把價格變化保存到
`data/price-history.json`；伺服器會在下一次讀取時自動載入新檔案。

## 同步媒體評分

媒體評分使用 IGDB 的 `aggregated_rating`（外部專業媒體綜合評分）。IGDB
非商業使用免費，但需要 Twitch Developer 應用程式憑證：

1. 登入 <https://dev.twitch.tv/console/apps>，開啟兩步驟驗證。
2. 建立應用程式，OAuth Redirect URL 填 `https://localhost`，類型選 Confidential。
3. 產生 Client Secret，然後在終端機執行：

```bash
export IGDB_CLIENT_ID='你的 Client ID'
export IGDB_CLIENT_SECRET='你的 Client Secret'
npm run sync:ratings
```

評分會寫入 `data/igdb-ratings.json`，不會保存 Client Secret。回到網站重新整理後，
即可使用「媒體評分最高」排序與「媒體評分 80+」篩選。請勿提交或分享 Client Secret。

## UI 功能

- 搜尋中英文名稱、發行商或 NSUID，支援繁簡字、符號差異與少量錯字
- 查看原價、特價、折扣比例與優惠期限
- 篩選 Switch、Switch 2、特價中及 NT$300 以下
- 依折扣、價格、發售日期或名稱排序
- 依這台瀏覽器累計的查看次數進行「我最常查看」排序
- 以 IGDB 專業媒體綜合評分排序，並篩選 80 分以上作品；同步時會以
  完全名稱優先，再用發售年份、出版社及高可信度近似名稱提高配對率
- 同時套用收藏、特價、平台、價格及評分篩選
- 使用瀏覽器本機收藏清單，不需登入或上傳資料
- 查看歷史最低價及最近價格變化
- 從網站背景更新價格，並提示資料是否過期
- 點擊卡片查看商品詳細資訊

## 可行性驗證

驗證工具用來回答兩個問題：

1. 任天堂台灣的公開目錄能否列出遊戲與 NSUID？
2. 任天堂價格端點能否以 NSUID 回傳台幣原價、折扣價和折扣期間？

## 執行方式

快速抽樣（首頁、中間頁、最後一頁）：

```bash
node scripts/validate-tw-eshop.mjs
```

檢查整份目錄：

```bash
node scripts/validate-tw-eshop.mjs --all
```

需要保留詳細結果時：

```bash
node scripts/validate-tw-eshop.mjs --all --output=data/tw-eshop.json
```

工具在每次請求之間刻意等待 150 毫秒，不會高併發呼叫官方服務。

## 目前限制

- 這些是公開但未承諾穩定的端點，格式未來可能變更。
- `robots.txt` 允許一般爬蟲存取，並不等於授予資料商業使用權。
- 正式公開網站前，仍應確認任天堂的網站條款、圖片使用方式和合理更新頻率。
- 價格歷史必須由我們定期保存；官方回應只提供當下價格與當期折扣。
