# Swish 前端與後端串接說明

目前這個目錄只包含前端。頁面會呼叫下列 ASP.NET Core API；登入、資料庫寫入、Turnstile 驗證、頻率限制與遊戲分數驗證仍需由後端實作。

## API 合約

- `GET /api/player/me`：登入後回傳 `{ player: { username, region, coins, bestScore, totalHits } }`。未登入回傳 401。
- `POST /api/auth/register`：接收 `{ account, password, username, region, turnstileToken }`。帳號是登入識別；username 是公開顯示名稱，可修改。不收 Email。
- `POST /api/auth/login`：接收 `{ account, password }`，成功後建議用安全的 HttpOnly、Secure、SameSite Cookie 維持登入。
- `POST /api/auth/logout`：清除登入 Cookie。
- `PATCH /api/player/profile`：接收 `{ username, region }`，由伺服器依登入 Cookie 更新目前玩家。
- `GET /api/leaderboard?duration=30|60|180`：回傳 `{ entries: [{ username, region, score, avatar, isCurrentPlayer }] }`，每個賽制分別查詢最高成績。
- `POST /api/games/complete`：接收 `{ duration, score, hits, shots, maxCombo }`。伺服器驗證賽制、玩家與有效成績，更新該賽制紀錄，再回傳 `{ player: { username, region, coins, bestScore, totalHits } }`。

所有登入端點都應使用 HTTPS。密碼只能由伺服器使用 ASP.NET Core Identity 或安全的密碼雜湊方案保存，不能存明文，也不要把 DB 連線字串或 Turnstile secret 放到前端。註冊端點應限制來源頻率、並在伺服器呼叫 Cloudflare Siteverify 驗證 `turnstileToken`；僅在網頁上勾選核取方塊並不能防機器人或 DDoS。

## 設定 Cloudflare Turnstile

在 Cloudflare 建立 Turnstile Widget 後，把公開的 Site Key 設定到 `index.html` 的 `meta[name="turnstile-site-key"]`。Secret Key 只放在 ASP.NET Core 的環境變數或 Secret Manager。後端收到註冊請求時，必須向 Cloudflare Siteverify 驗證 token、檢查 hostname 與成功狀態，並設置 IP／帳號頻率限制。大型 DDoS 還需要 CDN/WAF 與伺服器層防護；Turnstile 本身不會擋住所有流量攻擊。

## 建議資料表

- `Player`：Identity 使用者 ID、唯一帳號、使用者名稱、地區、金幣與累計統計。
- `GameRecord`：玩家 ID、賽制秒數、分數、命中／投籃數、最高 Combo、建立時間；為玩家與賽制建立查詢索引。
- `PlayerItem`：玩家 ID、商品 ID、購買時間。

不要信任瀏覽器送來的玩家 ID、金幣或獎勵。以登入身分識別玩家，由伺服器計算獎勵並在交易中更新錢包與紀錄。排行榜展示資料已移除；API 未連接時會顯示空狀態。
