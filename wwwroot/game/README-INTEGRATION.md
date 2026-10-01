# Swish 部署與資料庫設定

Swish 現在使用 ASP.NET Core Identity、EF Core 與 PostgreSQL。帳號登入、玩家資料、賽事紀錄、排行榜及道具購買 API 已接入；遊戲頁使用安全 Cookie 與 API 同步資料。登入 API 不要求 Email。

## 初次建立資料庫

專案使用 `ConnectionStrings:DefaultConnection`。請先確認本機 PostgreSQL 服務正在執行，並建立連線字串指定的資料庫。若資料庫名稱為 `swish`，可用：

```sh
createdb swish
```

如果 connection string 尚未設好，請用 .NET User Secrets 儲存，不要把密碼放在 Git 追蹤的設定檔：

```sh
dotnet user-secrets set "ConnectionStrings:DefaultConnection" "Host=localhost;Port=5432;Database=swish;Username=YOUR_DB_USER;Password=YOUR_DB_PASSWORD"
```

套用 Identity、玩家欄位、賽事與商店資料表遷移：

```sh
dotnet ef database update
```

在專案目錄 `Swish` 執行上述命令。遷移會建立 Identity 使用者資料表、`GameRecords` 和 `PlayerItems`。新註冊玩家獲得 500 枚起始金幣；預設經典道具免費並視為已擁有。

## 人機驗證設定

開發環境已使用 Cloudflare 官方測試金鑰，讓本機註冊流程可直接操作；這組測試金鑰會自動通過驗證，**只可用於 Development**，伺服器在其他環境會拒絕啟動。正式環境請到 Cloudflare 建立自己的 Turnstile Widget，並把 Site Key 和 Secret Key 分別存入 User Secrets 或部署環境變數：

```sh
dotnet user-secrets set "Turnstile:SiteKey" "YOUR_TURNSTILE_SITE_KEY"
dotnet user-secrets set "Turnstile:SecretKey" "YOUR_TURNSTILE_SECRET_KEY"
dotnet user-secrets set "Turnstile:HostName" "your-real-domain.example"
```

正式環境必須設定 HostName 為正式網域；Development 使用測試金鑰時不檢查 HostName。Site Key 由 `/api/public-config` 提供給瀏覽器；Secret Key 只留在伺服器。伺服器會向 Cloudflare Siteverify 驗證註冊 token，驗證失敗時不會建立帳號。登入本身不需要驗證碼或 Email。Cloudflare 的測試金鑰僅供開發整合使用；正式環境必須換成自己的 Widget 金鑰。

ASP.NET Core 也對登入、註冊、成績提交設置 IP 頻率限制，Identity 會鎖定連續登入失敗的帳號。這些措施不能單獨防住大型 DDoS，正式上線仍應在反向代理或 Cloudflare WAF 設定流量防護。反向代理部署時，請只信任實際代理送來的 forwarded headers，否則 IP 限流無法正確分辨訪客。

## 已提供的 API

- `GET /api/public-config`：公開的 Turnstile Site Key。
- `POST /api/auth/register`：`{ account, password, username, region, turnstileToken }`。帳號是登入名稱，使用者名稱是可修改的公開名稱；不收 Email。成功後建立登入 Cookie。
- `POST /api/auth/login`：`{ account, password }`。使用 Identity 密碼雜湊與登入失敗鎖定。
- `POST /api/auth/logout`：撤銷目前登入 Cookie。
- `GET /api/player/me`：目前玩家資料與商店庫存。
- `PATCH /api/player/profile`：`{ username, region }`。
- `GET /api/leaderboard?duration=30|60|180`：各賽制每位玩家的最高分前 20 名。
- `POST /api/games/complete`：`{ duration, score, hits, shots, maxCombo }`；伺服器驗證欄位與合理範圍，寫入紀錄並依分數計算金幣。
- `GET /api/shop/catalog`：商店商品目錄；前端用此 API 同步商品名稱和價格。
- `GET /api/shop/inventory`：目前玩家的金幣、持有道具和裝備。
- `POST /api/shop/purchase`：`{ category, itemId }`。伺服器確認價格、餘額、所有權，再同時扣款與裝備。

資料庫不接受瀏覽器指定玩家 ID、金幣或商品價格。密碼只由 Identity 雜湊保存，Cookie 使用 HttpOnly、Secure 與 SameSite 設定。客戶端的遊戲分數仍不能視為完全防作弊；若要競技級驗證，需要伺服器簽發賽事 session 並驗證投籃事件或遊戲回放。

## 資料表

- `AspNetUsers`：Identity 帳號、顯示名稱、地區、金幣、個人統計與目前裝備。
- `GameRecords`：玩家、賽制秒數、分數、命中數、出手數、Combo、獲得金幣與時間。
- `PlayerItems`：玩家擁有的場地、籃球和籃框道具。
