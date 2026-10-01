# Swish 展示網站部署（Render + Neon）

此設定適合少量訪客的作品展示。GitHub 儲存程式碼，Render 執行 ASP.NET Core，Neon 提供 PostgreSQL。Render 免費網站閒置後會休眠；免費 Neon 資料庫有用量上限。正式上線前請查看兩邊最新方案限制。

## 1. 建立 Neon PostgreSQL

1. 在 Neon 建立一個 PostgreSQL 專案。
2. 開啟 **Connect**，選擇 Npgsql/.NET 的連線格式，複製連線字串。
3. 不要把連線字串貼進程式碼或提交到 GitHub。

## 2. 推送部署設定到 GitHub

確認以下檔案已推送至 `main`：

- `Dockerfile`
- `.dockerignore`
- `render.yaml`
- `DEPLOY-RENDER.md`

## 3. 在 Render 建立服務

1. 在 Render Dashboard 選 **New → Blueprint**，連接 Swish GitHub repository。
2. Render 會讀取根目錄的 `render.yaml` 並建立 Web Service。若畫面要求未同步的環境變數，照下方項目填入；若服務先建立完成，前往 **Environment** 設定後再重新部署。
3. 填入 `ConnectionStrings__DefaultConnection`：可使用 Neon 的 Npgsql/.NET 連線字串，或 Neon 提供的 `postgresql://...` URI。程式會自動將 PostgreSQL URI 轉成 Npgsql 格式。
4. 確認 `ASPNETCORE_ENVIRONMENT` 是 `Production`，`Database__ApplyMigrations` 是 `true`。

資料庫連線成功後，應用程式會在啟動時自動套用已提交的 EF Core migrations，建立所需資料表。

## 4. 設定註冊用的人機驗證

1. 在 Cloudflare Turnstile 建立正式 widget，允許主機名稱 `swish-showcase.onrender.com`。如果 Render 配給的網址不同，改用 Render 顯示的實際主機名稱。
2. 將正式的 Site Key 設為 `Turnstile__SiteKey`，Secret Key 設為 `Turnstile__SecretKey`，主機名稱設為 `Turnstile__HostName`。
3. 三個值都要在 Render 的 **Environment** 設定，不要放進 GitHub。

## 5. 分享網址

Render 部署完成後會提供 `https://...onrender.com` 網址。分享該網址即可。免費 Web Service 閒置後會休眠，第一位訪客可能需要等待服務喚醒；Neon 免費資料庫也有每月運算與儲存上限。

## 注意事項

- 不要把資料庫密碼、Turnstile Secret Key 或任何 User Secrets 提交至 GitHub。
- `appsettings.Development.json` 已排除於 Docker 建置內容之外。
- 無限資源測試帳號只在 `Development` 環境有效；正式展示站不會啟用。
- Render Blueprints 中 `sync: false` 的值不會寫入 repository，應直接在 Render Dashboard 設定。
