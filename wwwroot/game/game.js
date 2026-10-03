"use strict";

// Safari private browsing / restrictive browser settings can make localStorage throw.
// Keep that storage failure from aborting initialization and disabling every control.
const safeStorage = {
    get(key, fallback = null) {
        try { return window.localStorage.getItem(key) ?? fallback; } catch (_) { return fallback; }
    },
    set(key, value) {
        try { window.localStorage.setItem(key, String(value)); return true; } catch (_) { return false; }
    },
    list(key) {
        try {
            const value = JSON.parse(this.get(key, '["classic"]'));
            return Array.isArray(value) ? value : ["classic"];
        } catch (_) { return ["classic"]; }
    }
};

window.addEventListener("error", (event) => {
    if (!event.message) return; // ignore external resource load failures
    const notice = document.getElementById("runtimeError");
    if (notice) { notice.hidden = false; notice.textContent = "遊戲互動初始化失敗：" + event.message; }
});
window.addEventListener("unhandledrejection", (event) => {
    const notice = document.getElementById("runtimeError");
    if (notice) { notice.hidden = false; notice.textContent = "遊戲互動初始化失敗：" + (event.reason?.message || String(event.reason)); }
});

/* =========================================================
   常數
   世界座標單位是「公尺」：x 左右、y 高度、z 遠近（越大越遠）
   ========================================================= */
const W = 400;                  // 畫面邏輯寬度（像素）
const H = 700;                  // 畫面邏輯高度（像素）

const GRAV = 9.8;               // 重力
const BR = 0.11;                // 球半徑
const RR = 0.32;                // 籃框半徑
const RT = 0.025;               // 籃框鐵管粗細
const RH = 3.05;                // 籃框高度
const START = { x: 0, y: 0.5, z: 0 };   // 球的出手位置

const PITCH = 58 * Math.PI / 180;       // 固定出手仰角
const COS_P = Math.cos(PITCH);
const SIN_P = Math.sin(PITCH);
const TAN_P = Math.tan(PITCH);

// 手感調整
const KS = 0.05;                // 往上拖曳距離（像素）→ 球速（公尺/秒）
const KYAW = 0.004;             // 左右拖曳距離（像素）→ 水平角度（弧度）
const PMAX = 240;               // 最大有效拖曳距離
const ASSIST = 0.6;             // 輔助強度：越大越容易進球（0 = 完全靠自己）

// 攝影機（針孔投影）
const CAM = { x: 0, y: 1.4, z: -2.2, f: 620, horizon: 330 };

/* =========================================================
   商店資料：場地 / 籃球 / 籃框
   ========================================================= */
const COURTS = {
    classic: { name: "經典木地板", cost: 0,
        wallTop: "#0d1330", wallBottom: "#2a2050",
        outFloorNear: "#3a2314", outFloorFar: "#241608",
        floor: "#b8823f", plank: "rgba(74,44,26,0.35)",
        line: "rgba(255,255,255,0.85)", paint: "rgba(180,50,40,0.5)" },
    night: { name: "夜間球場", cost: 300,
        wallTop: "#04050f", wallBottom: "#161233",
        outFloorNear: "#0c1224", outFloorFar: "#05070f",
        floor: "#20315c", plank: "rgba(10,16,36,0.5)",
        line: "rgba(120,200,255,0.85)", paint: "rgba(40,90,180,0.45)" },
    beach: { name: "海灘球場", cost: 500,
        wallTop: "#1c5a7a", wallBottom: "#3fa6c9",
        outFloorNear: "#e8cf9a", outFloorFar: "#d8b877",
        floor: "#f0dca8", plank: "rgba(190,150,90,0.35)",
        line: "rgba(255,255,255,0.9)", paint: "rgba(60,150,170,0.35)" },
    galaxy: { name: "銀河球場", cost: 800,
        wallTop: "#05030f", wallBottom: "#1c0f3a",
        outFloorNear: "#0a0620", outFloorFar: "#040211",
        floor: "#2a1a52", plank: "rgba(120,80,200,0.3)",
        line: "rgba(190,140,255,0.9)", paint: "rgba(120,60,200,0.4)" },
};

const BALLS = {
    classic: { name: "經典橘球", cost: 0, main: "#d2500f", light: "#ffb56b", line: "#5a1e05" },
    fire:    { name: "火焰球",   cost: 250, main: "#c21414", light: "#ff8a3d", line: "#3a0a0a" },
    galaxy:  { name: "銀河球",   cost: 450, main: "#3a1c7a", light: "#a78bfa", line: "#1a0a3a" },
    gold:    { name: "黃金球",   cost: 700, main: "#b8860b", light: "#ffe38a", line: "#4a3200" },
};

const HOOPS = {
    classic: { name: "經典橘框", cost: 0, rim: "#ff7a2e", net: "rgba(255,255,255,0.85)" },
    fire:    { name: "火焰框",   cost: 300, rim: "#ff3b3b", net: "rgba(255,200,150,0.85)" },
    crystal: { name: "水晶框",   cost: 550, rim: "#5fd4ff", net: "rgba(200,240,255,0.9)" },
    space:   { name: "星空框",   cost: 900, rim: "#b06bff", net: "rgba(220,180,255,0.9)" },
};

/* =========================================================
   DOM 與畫布縮放
   ========================================================= */
const cv = document.getElementById("c");
const ctx = cv.getContext("2d");
const stage = document.getElementById("stage");
const menu = document.getElementById("menu");
const over = document.getElementById("over");

let scale = 1;

function fit() {
    const dpr = window.devicePixelRatio || 1;
    const mobile = innerWidth <= 760;
    const availableW = mobile
        ? Math.max(240, stage.parentElement.clientWidth)
        : innerWidth - 460;
    const availableH = mobile ? innerHeight - 240 : innerHeight - 190;
    const portraitMobile = mobile && innerHeight >= innerWidth;
    const heightScale = portraitMobile ? 1.12 : availableH / H;
    scale = Math.max(0.38, Math.min(availableW / W, heightScale, 1.12) * 0.98);

    stage.style.width = W * scale + "px";
    stage.style.height = H * scale + "px";
    stage.style.fontSize = 15 * scale + "px";

    cv.width = W * scale * dpr;
    cv.height = H * scale * dpr;
    cv.style.width = W * scale + "px";
    cv.style.height = H * scale + "px";
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
}

addEventListener("resize", fit);
fit();

/* =========================================================
   3D → 2D 投影：越遠的東西越小、越靠近地平線
   ========================================================= */
function project(x, y, z) {
    const k = CAM.f / (z - CAM.z);      // 距離越遠，k 越小
    return {
        x: W / 2 + (x - CAM.x) * k,
        y: CAM.horizon - (y - CAM.y) * k,
        k: k,                           // 1 公尺在畫面上是幾個像素
    };
}

/* =========================================================
   遊戲狀態
   ========================================================= */
let mode = "menu";      // menu | play | over
let score = 0;
let duration = 30;
let time = duration;
let combo = 0;
let maxCombo = 0;
let hits = 0;
let shots = 0;
let started = false;    // 第一球投出後才開始倒數
let best = 0;
let totalHits = 0;
let shake = 0;
let drag = null;
let particles = [];
let floatTexts = [];

try {
    best = +safeStorage.get("hw_best") || 0;
    totalHits = +safeStorage.get("hw_hits") || 0;
} catch (e) {}

const ball = {
    x: START.x, y: START.y, z: START.z,
    vx: 0, vy: 0, vz: 0,
    rot: 0,
    state: "ready",     // ready | fly
    t: 0,
    scored: false,
    touched: false,     // 是否碰過籃框或籃板
    prevY: START.y,
    pop: 1,
};

const hoop = {
    x: 0,
    z: 4.6,             // 籃框離球員的距離
    zTarget: 4.6,
    ph: 0,              // 左右擺動的相位
    w: 1,               // 擺動速度
    amp: 0,             // 擺動幅度（公尺）
    swing: 0,           // 進球時網子的晃動
    flash: 0,           // 籃板被打到時的閃光
};

// 每命中 3 球升一級：籃框開始左右移動、距離改變
const level = () => Math.floor(hits / 3);

/* =========================================================
   商店狀態（外觀，存在 localStorage）
   ========================================================= */
let coins = +safeStorage.get("hw_coins") || 0;

const SHOP_CATS = { courts: COURTS, balls: BALLS, hoops: HOOPS };
let activeTab = "courts";

const selected = {
    courts: safeStorage.get("hw_court") || "classic",
    balls: safeStorage.get("hw_ball") || "classic",
    hoops: safeStorage.get("hw_hoop") || "classic",
};
const unlockedMap = {
    courts: safeStorage.list("hw_unlocked_courts"),
    balls: safeStorage.list("hw_unlocked_balls"),
    hoops: safeStorage.list("hw_unlocked_hoops"),
};

function renderShop() {
    const coinLabel = coins >= 2_147_483_647 ? "∞" : coins.toLocaleString();
    document.getElementById("coinDisplay").textContent = coinLabel;
    document.getElementById("shopCoins").textContent = coinLabel;
    best = +(safeStorage.get("hw_best_" + duration) || (duration === 30 ? safeStorage.get("hw_best") : 0)) || 0;
    document.getElementById("bestDisplay").textContent = best.toLocaleString();
    document.getElementById("hitsDisplay").textContent = totalHits.toLocaleString();
    const goal = Math.min(100, Math.round(best / 300 * 100));
    document.getElementById("goalProgress").textContent = Math.min(best, 300) + " / 300";
    document.getElementById("goalBar").style.width = goal + "%";

    document.querySelectorAll(".tab-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.cat === activeTab);
    });

    const category = SHOP_CATS[activeTab];
    const unlockedIds = unlockedMap[activeTab];
    const list = document.getElementById("shopList");
    list.innerHTML = "";
    const art = {
        courts: {
            classic: ["🏟️", "court-classic", "暖木地板・經典主場"],
            night: ["🌃", "court-night", "霓虹夜色・城市球場"],
            beach: ["🌴", "court-beach", "海風沙灘・度假球場"],
            galaxy: ["🌌", "court-galaxy", "星雲地板・宇宙球場"],
        },
        balls: {
            classic: ["🏀", "ball-classic", "標準手感・經典橘球"],
            fire: ["🔥", "ball-fire", "炙熱火焰・燃燒特效"],
            galaxy: ["🪐", "ball-galaxy", "星際旋紋・銀河球"],
            gold: ["✨", "ball-gold", "鍍金收藏・尊爵球"],
        },
        hoops: {
            classic: ["⭕", "hoop-classic", "標準橘框・白色球網"],
            fire: ["🔥", "hoop-fire", "烈焰紅框・夕陽球網"],
            crystal: ["💎", "hoop-crystal", "冰晶藍框・透光球網"],
            space: ["🌠", "hoop-space", "星光紫框・幻彩球網"],
        },
    };
    for (const id in category) {
        const item = category[id];
        const owned = unlockedIds.includes(id);
        const equipped = selected[activeTab] === id;
        const visual = art[activeTab][id];
        const el = document.createElement("button");
        el.className = "shop-item" + (equipped ? " selected" : "") + (owned ? "" : " locked");
        const status = owned
            ? (equipped ? "裝備中" : "已擁有")
            : "🪙 " + item.cost.toLocaleString();
        const action = equipped ? "✓ 使用中" : owned ? "裝備" : "解鎖";

        el.innerHTML = `
            <span class="shop-art ${visual[1]}">
                <span class="art-emoji">${visual[0]}</span>
            </span>
            <span class="shop-item-info">
                <span class="shop-item-name">${item.name}</span>
                <span class="shop-item-detail">${visual[2]}</span>
                <span class="shop-item-cost">${status}</span>
            </span>
            <span class="shop-action">${action}</span>
        `;
        el.onclick = async () => {
            if (authenticated) {
                try {
                    const result = await api("/api/shop/purchase", {
                        method: "POST",
                        body: JSON.stringify({ category: activeTab, itemId: id }),
                    });
                    if (result.player) applyPlayer(result.player);
                    applyInventory(result.inventory);
                    showToast(equipped ? "已裝備 " + item.name : owned ? "已切換至 " + item.name : "解鎖成功：" + item.name);
                } catch (error) {
                    showToast(error.message);
                }
                return;
            }

            if (owned) {
                selected[activeTab] = id;
                safeStorage.set("hw_" + activeTab.slice(0, -1), id);
            } else if (coins >= item.cost) {
                coins -= item.cost;
                unlockedIds.push(id);
                selected[activeTab] = id;
                safeStorage.set("hw_coins", coins);
                safeStorage.set("hw_unlocked_" + activeTab, JSON.stringify(unlockedIds));
                safeStorage.set("hw_" + activeTab.slice(0, -1), id);
                showToast("解鎖成功：" + item.name);
            } else {
                showToast("金幣不足，完成投籃賽事即可賺取金幣。");
            }
            renderShop();
        };
        list.appendChild(el);
    }
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.onclick = () => {
        activeTab = btn.dataset.cat;
        renderShop();
    };
});

renderShop();

/* 登入、玩家檔案、賽制排行榜 API */
let authMode = "login";
let currentPlayer = null;
let authenticated = false;
let turnstileToken = "";
let leaderDuration = 30;
let turnstileWidgetId = null;
const authScreen = document.getElementById("authScreen");
const profileScreen = document.getElementById("profileScreen");
const authMessage = document.getElementById("authMessage");
const authForm = document.getElementById("authForm");
const registerFields = document.getElementById("registerFields");

async function api(path, options = {}) {
    const response = await fetch(path, { credentials: "same-origin", ...options,
        headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
    const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.title || "服務暫時無法使用，請稍後再試。");
    return data;
}
function showAuth(mode = "login") {
    authScreen.hidden = false;
    setAuthMode(mode);
}
function setAuthMode(mode) {
    authMode = mode;
    document.querySelectorAll(".auth-tab").forEach((button) => button.classList.toggle("active", button.dataset.auth === mode));
    registerFields.hidden = mode !== "register";
    authForm.elements.password.autocomplete = mode === "register" ? "new-password" : "current-password";
    document.getElementById("authSubmit").innerHTML = (mode === "register" ? "建立帳戶" : "登入球場");
    authMessage.textContent = "";
    turnstileToken = "";
    if (mode === "register") mountTurnstile();
}
function mountTurnstile() {
    const siteKey = window.SWISH_TURNSTILE_SITE_KEY || document.querySelector('meta[name="turnstile-site-key"]')?.content;
    const widget = document.getElementById("turnstileWidget");
    if (turnstileWidgetId !== null && window.turnstile) { window.turnstile.reset(turnstileWidgetId); return; }
    widget.innerHTML = "";
    if (!siteKey || siteKey === "YOUR_TURNSTILE_SITE_KEY" || !window.turnstile) return;
    turnstileWidgetId = window.turnstile.render(widget, { sitekey: siteKey, callback: (token) => { turnstileToken = token; },
        "expired-callback": () => { turnstileToken = ""; }, "error-callback": () => { turnstileToken = ""; } });
}
window.onSwishTurnstileReady = mountTurnstile;
window.addEventListener("load", mountTurnstile);
loadCatalog();
api("/api/public-config")
    .then((config) => {
        const siteKey = document.querySelector('meta[name="turnstile-site-key"]');
        if (siteKey && config.turnstileSiteKey) siteKey.content = config.turnstileSiteKey;
        if (authMode === "register") mountTurnstile();
    })
    .catch(() => {});
document.querySelectorAll(".auth-tab").forEach((button) => button.addEventListener("click", () => setAuthMode(button.dataset.auth)));
authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(authForm);
    const payload = { account: form.get("account"), password: form.get("password") };
    if (authMode === "register") {
        if (!turnstileToken) { authMessage.textContent = "請先完成有效的人機驗證；若未顯示驗證框，請先設定網站金鑰。"; return; }
        payload.username = form.get("username") || payload.account;
        payload.region = form.get("region") || "";
        payload.turnstileToken = turnstileToken;
    }
    const submit = document.getElementById("authSubmit"); submit.disabled = true;
    try {
        const responseData = await api(authMode === "register" ? "/api/auth/register" : "/api/auth/login", { method: "POST", body: JSON.stringify(payload) });
        currentPlayer = responseData.player || responseData;
        if (!currentPlayer || (!currentPlayer.username && currentPlayer.coins == null && !currentPlayer.id)) throw new Error("登入 API 尚未正確回傳玩家資料，請確認後端回傳格式。");
        authenticated = true;
        authScreen.hidden = true;
        document.getElementById("loginButton").hidden = true;
        applyPlayer(currentPlayer);
        loadInventory();
        loadLeaderboard();
    } catch (error) {
        authMessage.textContent = error.message;
        if (authMode === "register") {
            turnstileToken = "";
            if (turnstileWidgetId !== null && window.turnstile) {
                window.turnstile.reset(turnstileWidgetId);
            }
        }
    } finally {
        submit.disabled = false;
    }
});
document.getElementById("guestButton").addEventListener("click", () => { authenticated = false; authScreen.hidden = true; loadLeaderboard(); });
document.getElementById("loginButton").addEventListener("click", () => showAuth("login"));
document.getElementById("closeAuth").addEventListener("click", () => { authScreen.hidden = true; });
function applyPlayer(player) {
    if (!player) return;
    currentPlayer = player;
    document.getElementById("playerName").textContent =
        player.username || player.displayName || safeStorage.get("swish_username") || "球員";
    if (Number.isFinite(+player.coins)) coins = +player.coins;
    if (Number.isFinite(+player.bestScore)) best = +player.bestScore;
    if (Number.isFinite(+player.totalHits)) totalHits = +player.totalHits;
    renderShop();
}

async function loadCatalog() {
    try {
        const result = await api("/api/shop/catalog");
        for (const item of result.items || []) {
            const category = SHOP_CATS[item.category];
            if (!category?.[item.id]) continue;
            category[item.id].name = item.name;
            category[item.id].cost = item.cost;
        }
        renderShop();
    } catch (_) {
        // Keep the local catalog available when the API is temporarily offline.
    }
}

async function loadInventory() {
    if (!authenticated) return;
    try {
        const result = await api("/api/player/me");
        applyPlayer(result.player);
        applyInventory(result.inventory);
        applyBestScores(result.bestScores);
    } catch (error) {
        showToast(error.message);
    }
}

function applyBestScores(scores) {
    if (!scores) return;
    for (const seconds of [30, 60, 180]) {
        if (Number.isFinite(+scores[seconds])) {
            safeStorage.set("hw_best_" + seconds, scores[seconds]);
        }
    }
    renderShop();
}

function applyInventory(inventory) {
    if (!inventory) return;
    if (Number.isFinite(+inventory.coins)) coins = +inventory.coins;
    for (const category of ["courts", "balls", "hoops"]) {
        if (Array.isArray(inventory.owned?.[category])) {
            unlockedMap[category] = inventory.owned[category];
        }
        if (inventory.equipped?.[category]) {
            selected[category] = inventory.equipped[category];
        }
    }
    renderShop();
}

let toastTimer;
function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

document.getElementById("profileButton").addEventListener("click", () => {
    const form = document.getElementById("profileForm");
    form.elements.username.value = currentPlayer?.username || document.getElementById("playerName").textContent;
    form.elements.region.value = currentPlayer?.region || "";
    profileScreen.hidden = false;
});
document.getElementById("closeProfile").addEventListener("click", () => { profileScreen.hidden = true; });
document.getElementById("profileForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const update = { username: form.get("username"), region: form.get("region") };
    try {
        if (authenticated) currentPlayer = await api("/api/player/profile", { method: "PATCH", body: JSON.stringify(update) });
        else currentPlayer = { ...(currentPlayer || {}), ...update };
        try { safeStorage.set("swish_username", update.username); safeStorage.set("swish_region", update.region); } catch (_) {}
        applyPlayer(currentPlayer); document.getElementById("profileMessage").textContent = "資料已更新。";
    } catch (error) { document.getElementById("profileMessage").textContent = error.message; }
});
document.getElementById("logoutButton").addEventListener("click", async () => {
    try { if (authenticated) await api("/api/auth/logout", { method: "POST", body: "{}" }); } catch (_) {}
    currentPlayer = null; authenticated = false; profileScreen.hidden = true;
    document.getElementById("loginButton").hidden = false;
});

async function loadLeaderboard() {
    const rows = document.getElementById("leaderboardRows");
    rows.innerHTML = '<div class="leader-empty">載入排行榜中…</div>';
    try {
        const result = await api("/api/leaderboard?duration=" + leaderDuration);
        const entries = result.entries || result;
        if (!entries.length) {
            rows.innerHTML = '<div class="leader-empty">這個賽制還沒有紀錄，來當第一名吧！</div>';
            return;
        }

        rows.innerHTML = entries
            .slice(0, 10)
            .map((player, index) => {
                const rankClass = index < 3 ? ["gold", "silver", "bronze"][index] : "";
                const rowClass = player.isCurrentPlayer ? " you" : "";
                const rank = String(index + 1).padStart(2, "0");
                const name = escapeText(player.username || "球員");
                const avatar = escapeText(player.avatar || "🏀");
                const region = escapeText(player.region || "");
                const score = Number(player.score || 0).toLocaleString();

                return `
                    <div class="rank-row${rowClass}">
                        <span class="rank ${rankClass}">${rank}</span>
                        <span class="rank-avatar">${avatar}</span>
                        <span class="rank-name">
                            <b>${name}</b>
                            <small>${region}</small>
                        </span>
                        <strong>${score}</strong>
                    </div>
                `;
            })
            .join("");
    } catch (_) {
        rows.innerHTML = '<div class="leader-empty">排行榜 API 尚未連接，登入後即可載入真實名次。</div>';
    }
}
function escapeText(value) { const node = document.createElement("span"); node.textContent = value; return node.innerHTML; }
async function submitGameResult() {
    if (!authenticated) return;
    try { const result = await api("/api/games/complete", { method: "POST", body: JSON.stringify({ duration, score, hits, shots, maxCombo }) });
        applyPlayer(result.player || currentPlayer);
        if (result.player) coins = result.player.coins;
        applyBestScores(result.bestScores);
        showToast("賽事紀錄已儲存，獲得 " + (result.coinsEarned || 0) + " 金幣！");
        renderShop();
        loadLeaderboard();
    } catch (error) { console.warn("Game result was not saved:", error.message); }
}

document.querySelectorAll(".duration-btn").forEach((button) => button.addEventListener("click", () => {
    duration = +button.dataset.seconds;
    leaderDuration = duration;
    document.querySelectorAll(".leader-tab").forEach((b) => b.classList.toggle("active", +b.dataset.duration === leaderDuration));
    document.querySelectorAll(".duration-btn").forEach((b) => b.classList.toggle("active", +b.dataset.seconds === duration));
    time = duration;
    document.getElementById("modeDescription").textContent = duration + " 秒投籃挑戰";
    document.getElementById("roundDuration").textContent = duration + " 秒賽制";
    renderShop(); loadLeaderboard();
}));
document.querySelectorAll(".leader-tab").forEach((button) => button.addEventListener("click", () => {
    leaderDuration = +button.dataset.duration;
    document.querySelectorAll(".leader-tab").forEach((b) => b.classList.toggle("active", b === button));
    loadLeaderboard();
}));
api("/api/player/me").then((result) => {
    const player = result.player || result;
    if (!player || (!player.username && player.coins == null && !player.id)) throw new Error("尚未登入");
    authenticated = true; applyPlayer(player); authScreen.hidden = true;
    document.getElementById("loginButton").hidden = true;
    if (result.inventory) applyInventory(result.inventory);
    applyBestScores(result.bestScores);
    loadLeaderboard();
}).catch(() => { /* 訪客仍可遊玩；登入視窗由右上角按鈕開啟 */ });

/* =========================================================
   音效
   ========================================================= */
let audioCtx;

function sound(freq, dur, type, vol, freqEnd) {
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = type || "sine";
        osc.frequency.setValueAtTime(freq, now);
        if (freqEnd) {
            osc.frequency.exponentialRampToValueAtTime(freqEnd, now + dur);
        }
        gain.gain.setValueAtTime(vol || 0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

        osc.connect(gain).connect(audioCtx.destination);
        osc.start();
        osc.stop(now + dur);
    } catch (e) {}
}

/* =========================================================
   特效
   ========================================================= */
function addText(x, y, text, color, size) {
    floatTexts.push({ x, y, text, color, size, t: 0 });
}

function burst(x, y, count, color) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 80 + Math.random() * 220;
        particles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 80,
            life: 0.7 + Math.random() * 0.4,
            t: 0,
            color,
        });
    }
}

/* =========================================================
   投籃計算
   ========================================================= */

// 以「目前籃框位置」算出剛好進球的球速與水平角度（給輔助功能用）
function idealShot() {
    const dz = hoop.z - START.z;
    const dh = RH - START.y;
    const speed = Math.sqrt(
        (GRAV * dz * dz) / (2 * COS_P * COS_P * (dz * TAN_P - dh))
    );

    // 籃框會左右移動，所以要瞄準「球到達時」的位置
    const flightTime = dz / (speed * COS_P);
    const targetX = hoop.amp * Math.sin(hoop.ph + hoop.w * flightTime);

    return { speed, yaw: Math.atan2(targetX - START.x, dz) };
}

// 由拖曳向量算出 3D 初速度；往上拖得不夠就視為取消
function launchVelocity() {
    if (!drag) return null;

    const dx = drag.x - drag.sx;
    const dy = drag.y - drag.sy;
    if (dy > -25) return null;

    let speed = Math.min(-dy, PMAX) * KS;
    let yaw = dx * KYAW;

    // 輔助：接近正確值時，把誤差縮小一部分（仍需要自己抓力道與方向）
    const ideal = idealShot();
    if (Math.abs(speed - ideal.speed) < ideal.speed * 0.25) {
        speed = ideal.speed + (speed - ideal.speed) * (1 - ASSIST);
    }
    if (Math.abs(yaw - ideal.yaw) < 0.2) {
        yaw = ideal.yaw + (yaw - ideal.yaw) * (1 - ASSIST);
    }

    return {
        vx: speed * COS_P * Math.sin(yaw),
        vy: speed * SIN_P,
        vz: speed * COS_P * Math.cos(yaw),
    };
}

/* =========================================================
   輸入：拖曳瞄準
   ========================================================= */
function pointerPos(e) {
    const box = cv.getBoundingClientRect();
    return {
        x: (e.clientX - box.left) / scale,
        y: (e.clientY - box.top) / scale,
    };
}

cv.addEventListener("pointerdown", (e) => {
    if (mode !== "play" || ball.state !== "ready") return;

    cv.setPointerCapture(e.pointerId);
    const p = pointerPos(e);
    drag = { sx: p.x, sy: p.y, x: p.x, y: p.y };
});

cv.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = pointerPos(e);
    drag.x = p.x;
    drag.y = p.y;
});

cv.addEventListener("pointerup", () => {
    const v = launchVelocity();
    drag = null;
    if (!v) return;

    Object.assign(ball, {
        vx: v.vx, vy: v.vy, vz: v.vz,
        state: "fly",
        t: 0,
        scored: false,
        touched: false,
        prevY: ball.y,
    });
    shots++;
    started = true;
    sound(300, 0.15, "sawtooth", 0.05, 700);
});

cv.addEventListener("pointercancel", () => {
    drag = null;
});

/* =========================================================
   遊戲流程：進球 / 投失 / 開始 / 結束
   ========================================================= */
function goal() {
    ball.scored = true;
    hits++;
    totalHits++;
    combo++;
    maxCombo = Math.max(maxCombo, combo);

    // 空心入網：沒碰框，且球心非常接近框中心
    const off = Math.hypot(ball.x - hoop.x, ball.z - hoop.z);
    const perfect = !ball.touched && off < 0.07;

    // 基本分 + Combo 加成（第 3 球起 +10，上限 +40），5 Combo 起 ×2
    const base = perfect ? 50 : 10;
    const bonus = Math.min(40, Math.max(0, combo - 2) * 10);
    const multiplier = combo >= 5 ? 2 : 1;
    const points = (base + bonus) * multiplier;

    score += points;
    hoop.swing = 1;

    const p = project(hoop.x, RH, hoop.z);
    addText(
        p.x, p.y - 40,
        (perfect ? "PERFECT! " : "") + "+" + points,
        perfect ? "#ffd84a" : "#fff",
        perfect ? 30 : 24
    );
    if (combo >= 2) {
        addText(
            p.x, p.y - 75,
            "🔥 " + combo + " COMBO" + (combo >= 5 ? " ×2" : ""),
            "#ff8a3d",
            20
        );
    }
    burst(p.x, p.y + 10, perfect ? 36 : 16, perfect ? "#ffd84a" : "#ff9d4a");
    sound(660, 0.25, "sine", 0.1, 990);
    if (perfect) setTimeout(() => sound(1320, 0.3, "sine", 0.07), 90);

    // 升級時，籃框換一個新的距離
    if (level() > 0 && hits % 3 === 0) {
        hoop.zTarget = 4.2 + Math.random() * 1.4;
    }
}

function endShot() {
    if (!ball.scored) {
        combo = 0;
        addText(W / 2, H - 140, "MISS", "#9aa4c0", 22);
    }
    Object.assign(ball, {
        x: START.x, y: START.y, z: START.z,
        vx: 0, vy: 0, vz: 0,
        state: "ready",
        pop: 0,
    });
}

function gameOver() {
    mode = "over";
    drag = null;

    const bestKey = "hw_best_" + duration;
    const isRecord = score > best && score > 0;
    if (isRecord) {
        best = score;
        try {
            safeStorage.set(bestKey, best);
            if (duration === 30) safeStorage.set("hw_best", best);
        } catch (e) {}
    }

    try { safeStorage.set("hw_hits", totalHits); } catch (e) {}

    const earned = Math.round(score / 10);
    coins += earned;
    try { safeStorage.set("hw_coins", coins); } catch (e) {}
    document.getElementById("coinEarned").textContent = "🪙 +" + earned;

    document.getElementById("fs").textContent = score.toLocaleString();
    document.getElementById("rec").textContent = isRecord
        ? "🏆 NEW RECORD"
        : "最高紀錄 " + best.toLocaleString();
    document.getElementById("stat").innerHTML =
        "命中 " + hits + " / " + shots + " 球　最高 Combo " + maxCombo;

    over.hidden = false;
    sound(320, 0.6, "sawtooth", 0.06, 90);
    renderShop();
    submitGameResult();
}

function startGame() {
    score = 0;
    time = duration;
    combo = maxCombo = hits = shots = 0;
    started = false;
    particles = [];
    floatTexts = [];
    Object.assign(hoop, { x: 0, z: 4.6, zTarget: 4.6, ph: 0, amp: 0, swing: 0, flash: 0 });
    Object.assign(ball, {
        x: START.x, y: START.y, z: START.z,
        vx: 0, vy: 0, vz: 0,
        state: "ready",
        pop: 1,
    });

    mode = "play";
    menu.hidden = true;
    over.hidden = true;
    renderShop();
}

document.getElementById("go").onclick = startGame;
document.getElementById("again").onclick = startGame;

/* =========================================================
   物理更新（固定時間步長）
   ========================================================= */
function updateHoop(dt) {
    hoop.w = 0.9 + level() * 0.12;
    hoop.ph += dt * hoop.w;
    hoop.amp += (Math.min(0.9, level() * 0.3) - hoop.amp) * Math.min(1, dt * 2);
    hoop.z += (hoop.zTarget - hoop.z) * Math.min(1, dt * 2);
    hoop.x = hoop.amp * Math.sin(hoop.ph);
    hoop.swing *= 1 - 2.2 * dt;
    hoop.flash = (hoop.flash || 0) * (1 - 5 * dt);
}

// 籃框是水平的圓環：找出環上離球最近的點，當作小圓球碰撞
function collideRim() {
    const dx = ball.x - hoop.x;
    const dz = ball.z - hoop.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) return;

    const cx = hoop.x + (dx / len) * RR;
    const cz = hoop.z + (dz / len) * RR;
    const ox = ball.x - cx;
    const oy = ball.y - RH;
    const oz = ball.z - cz;
    const dist = Math.hypot(ox, oy, oz);
    const minDist = BR + RT;
    if (dist >= minDist || dist === 0) return;

    const nx = ox / dist;
    const ny = oy / dist;
    const nz = oz / dist;
    ball.x = cx + nx * minDist;
    ball.y = RH + ny * minDist;
    ball.z = cz + nz * minDist;

    const vn = ball.vx * nx + ball.vy * ny + ball.vz * nz;
    if (vn < 0) {
        ball.vx = (ball.vx - 1.6 * vn * nx) * 0.92;
        ball.vy -= 1.6 * vn * ny;
        ball.vz = (ball.vz - 1.6 * vn * nz) * 0.92;
        ball.touched = true;
        shake = Math.max(shake, 5);
        sound(180, 0.09, "square", 0.06);
    }
}

// 籃板在籃框正後方，球打到會彈回來（可以打板進球）
function collideBoard() {
    const boardZ = hoop.z + RR + 0.06;
    const hitsBoard =
        ball.vz > 0 &&
        ball.z + BR > boardZ &&
        ball.z - BR < boardZ + 0.06 &&
        Math.abs(ball.x - hoop.x) < 0.9 &&
        ball.y > RH - 0.15 &&
        ball.y < RH + 0.9;

    if (hitsBoard) {
        ball.z = boardZ - BR;
        ball.vz = -ball.vz * 0.55;
        ball.vx *= 0.9;
        ball.touched = true;
        hoop.flash = 1;
        shake = Math.max(shake, 4);
        sound(140, 0.12, "square", 0.07);
    }
}

function updateBall(dt) {
    if (ball.state === "ready") {
        ball.pop = Math.min(1, ball.pop + dt * 6);
        return;
    }

    // 移動與重力
    ball.prevY = ball.y;
    ball.vy -= GRAV * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.z += ball.vz * dt;
    ball.rot += dt * 8;
    ball.t += dt;

    // 地板反彈
    if (ball.y < BR && ball.vy < 0) {
        ball.y = BR;
        ball.vy = -ball.vy * 0.6;
        ball.vx *= 0.8;
        ball.vz *= 0.8;
    }

    collideRim();
    collideBoard();

    // 進球判定：球心由上往下穿過籃框平面，且落在圓環內
    const crossedDown = ball.prevY >= RH && ball.y < RH && ball.vy < 0;
    const inside = Math.hypot(ball.x - hoop.x, ball.z - hoop.z) < RR - 0.03;
    if (!ball.scored && crossedDown && inside) goal();

    // 飛太久就結束這一球
    if (ball.t > 2.6) endShot();
}

function updateEffects(dt) {
    for (const p of particles) {
        p.t += dt;
        p.vy += 800 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
    }
    particles = particles.filter((p) => p.t < p.life);

    for (const f of floatTexts) {
        f.t += dt;
        f.y -= 40 * dt;
    }
    floatTexts = floatTexts.filter((f) => f.t < 1.1);
}

function step(dt) {
    updateHoop(dt);
    shake *= 1 - 8 * dt;

    // 計時：第一球投出後開始；時間到後等球落定再結束
    if (mode === "play" && started && time > 0) {
        time = Math.max(0, time - dt);
    }
    if (mode === "play" && time <= 0 && ball.state !== "fly") {
        gameOver();
    }

    updateBall(dt);
    updateEffects(dt);
}

/* =========================================================
   繪圖：場地
   ========================================================= */
function drawText(text, x, y, size, color, align) {
    ctx.font = "900 " + (size * 1.15) + "px system-ui, 'Noto Sans TC', sans-serif";
    ctx.textAlign = align || "center";
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
}

// 把一串 3D 點連成線（points = [[x, y, z], ...]）
function strokePath3D(points, closed) {
    ctx.beginPath();
    points.forEach((pt, i) => {
        const p = project(pt[0], pt[1], pt[2]);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
    });
    if (closed) ctx.closePath();
}

function drawCourt() {
    const theme = COURTS[selected.courts] || COURTS.classic;
    const hz = CAM.horizon;
    const SW = 3.6;                          // 半場寬度
    const baseline = hoop.z + RR + 0.7;       // 底線位置

    // 觀眾席 / 背景牆
    let grad = ctx.createLinearGradient(0, 0, 0, hz);
    grad.addColorStop(0, theme.wallTop);
    grad.addColorStop(1, theme.wallBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(-10, -10, W + 20, hz + 10);

    // 界外地板
    grad = ctx.createLinearGradient(0, hz, 0, H);
    grad.addColorStop(0, theme.outFloorNear);
    grad.addColorStop(1, theme.outFloorFar);
    ctx.fillStyle = grad;
    ctx.fillRect(-10, hz, W + 20, H - hz + 10);

    // 界內木地板
    ctx.fillStyle = theme.floor;
    strokePath3D([[-SW, 0, 0], [SW, 0, 0], [SW, 0, baseline], [-SW, 0, baseline]], true);
    ctx.fill();

    // 木地板拼接紋路
    ctx.strokeStyle = theme.plank;
    ctx.lineWidth = 1;
    for (let x = -SW; x <= SW; x += 0.6) {
        strokePath3D([[x, 0, 0], [x, 0, baseline]]);
        ctx.stroke();
    }
    for (let z = 0; z <= baseline; z += 1) {
        strokePath3D([[-SW, 0, z], [SW, 0, z]]);
        ctx.stroke();
    }

    // 邊線、底線
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 2.5;
    strokePath3D([[-SW, 0, 0], [-SW, 0, baseline], [SW, 0, baseline], [SW, 0, 0]]);
    ctx.stroke();

    // 禁區
    ctx.fillStyle = theme.paint;
    strokePath3D([[-2.4, 0, 1.2], [2.4, 0, 1.2], [2.4, 0, baseline], [-2.4, 0, baseline]], true);
    ctx.fill();
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 2;
    strokePath3D([[-2.4, 0, 1.2], [-2.4, 0, baseline], [2.4, 0, baseline], [2.4, 0, 1.2]]);
    ctx.stroke();

    // 罰球圈
    const ft = [];
    for (let i = 0; i <= 16; i++) {
        const a = Math.PI + (Math.PI * i) / 16;
        ft.push([1.8 * Math.cos(a), 0, 1.2 + 1.8 * Math.sin(a)]);
    }
    strokePath3D(ft);
    ctx.stroke();

    // 三分線
    const arc = [];
    for (let i = 0; i <= 24; i++) {
        const a = (Math.PI * i) / 24;
        arc.push([hoop.x + 3.4 * Math.cos(a), 0, hoop.z - 3.4 * Math.sin(a)]);
    }
    strokePath3D(arc);
    ctx.stroke();
}

function drawBackboard() {
    const hoopSkin = HOOPS[selected.hoops] || HOOPS.classic;
    const hx = hoop.x;
    const bz = hoop.z + RR + 0.06;      // 籃板正面的 z
    const th = 0.25;                    // 籃板厚度
    const x0 = hx - 0.9, x1 = hx + 0.9;
    const y0 = RH - 0.15, y1 = RH + 0.9;
    const flash = hoop.flash || 0;      // 被球打到時的閃光

    // 1. 支柱與橫桿（在籃板後面，最先畫）
    ctx.strokeStyle = "#39406a";
    ctx.lineWidth = 8;
    strokePath3D([
        [hx, y0 + 0.25, bz + th],
        [hx, y0 + 0.25, bz + th + 0.4],
        [hx, 0, bz + th + 0.4],
    ]);
    ctx.stroke();

    // 2. 厚度：底面（攝影機在下方，一定看得到）與側面
    ctx.fillStyle = "#7d84a8";
    strokePath3D([[x0, y0, bz], [x1, y0, bz], [x1, y0, bz + th], [x0, y0, bz + th]], true);
    ctx.fill();

    ctx.fillStyle = "#666d92";
    if (CAM.x < x0) {
        strokePath3D([[x0, y0, bz], [x0, y1, bz], [x0, y1, bz + th], [x0, y0, bz + th]], true);
        ctx.fill();
    }
    if (CAM.x > x1) {
        strokePath3D([[x1, y0, bz], [x1, y1, bz], [x1, y1, bz + th], [x1, y0, bz + th]], true);
        ctx.fill();
    }

    // 3. 正面：上亮下暗，被打到時偏黃
    const top = project(hx, y1, bz);
    const bottom = project(hx, y0, bz);
    const grad = ctx.createLinearGradient(0, top.y, 0, bottom.y);
    grad.addColorStop(0, "rgba(255, 255, 255, 0.97)");
    grad.addColorStop(1, "rgba(" + Math.round(190 + 65 * flash) + ", "
        + Math.round(198 + 30 * flash) + ", " + Math.round(225 - 120 * flash) + ", 0.97)");
    ctx.fillStyle = grad;
    strokePath3D([[x0, y0, bz], [x1, y0, bz], [x1, y1, bz], [x0, y1, bz]], true);
    ctx.fill();
    ctx.strokeStyle = "#aeb6d8";
    ctx.lineWidth = 3;
    ctx.stroke();

    // 4. 紅框
    ctx.strokeStyle = "#e33b2f";
    ctx.lineWidth = 2.5;
    strokePath3D([
        [hx - 0.3, RH, bz - 0.01], [hx + 0.3, RH, bz - 0.01],
        [hx + 0.3, RH + 0.45, bz - 0.01], [hx - 0.3, RH + 0.45, bz - 0.01],
    ], true);
    ctx.stroke();

    // 5. 籃框連接籃板的固定架
    ctx.strokeStyle = hoopSkin.rim;
    ctx.lineWidth = 6;
    strokePath3D([[hx, RH, hoop.z + RR], [hx, RH, bz]]);
    ctx.stroke();
}

// 籃框圓環的一半：from ~ to 是角度，遠側 = 0~π，近側 = π~2π
function ringHalf(from, to) {
    const hoopSkin = HOOPS[selected.hoops] || HOOPS.classic;
    const points = [];
    for (let i = 0; i <= 16; i++) {
        const a = from + ((to - from) * i) / 16;
        points.push([hoop.x + RR * Math.cos(a), RH, hoop.z + RR * Math.sin(a)]);
    }
    ctx.strokeStyle = hoopSkin.rim;
    ctx.lineWidth = 4;
    strokePath3D(points);
    ctx.stroke();
}

function drawNet() {
    const hoopSkin = HOOPS[selected.hoops] || HOOPS.classic;
    const sway = Math.sin(performance.now() / 60) * 0.06 * hoop.swing;
    const depth = 0.45 + hoop.swing * 0.08;
    const top = [];
    const bottom = [];

    for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI * 2) / 8;
        top.push([hoop.x + RR * Math.cos(a), RH, hoop.z + RR * Math.sin(a)]);
        bottom.push([
            hoop.x + RR * 0.6 * Math.cos(a) + sway,
            RH - depth,
            hoop.z + RR * 0.6 * Math.sin(a),
        ]);
    }

    ctx.strokeStyle = hoopSkin.net;
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 8; i++) {
        const next = (i + 1) % 8;
        strokePath3D([top[i], bottom[i]]);
        ctx.stroke();
        strokePath3D([top[i], bottom[next]]);
        ctx.stroke();
    }
}

/* =========================================================
   繪圖：球、瞄準線、特效、HUD
   ========================================================= */
function drawBall(cx, cy, r, rot) {
    const skin = BALLS[selected.balls] || BALLS.classic;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);

    const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    grad.addColorStop(0, skin.light);
    grad.addColorStop(1, skin.main);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // 球的紋路
    ctx.strokeStyle = skin.line;
    ctx.lineWidth = Math.max(1.2, r * 0.09);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.moveTo(-r, 0);
    ctx.lineTo(r, 0);
    ctx.moveTo(0, -r);
    ctx.lineTo(0, r);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(-r * 1.2, 0, r * 0.98, -0.85, 0.85);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(r * 1.2, 0, r * 0.98, Math.PI - 0.85, Math.PI + 0.85);
    ctx.stroke();

    ctx.restore();
}

function drawBallWithShadow() {
    const pop = ball.state === "ready" ? 0.6 + 0.4 * ball.pop : 1;

    // 地上的影子：球越高，影子越淡越小
    const s = project(ball.x, 0, ball.z);
    const height = Math.max(0, ball.y - BR);
    ctx.fillStyle = "rgba(0, 0, 0, " + Math.max(0.08, 0.35 - height * 0.06) + ")";
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, BR * s.k * 1.1, BR * s.k * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    const p = project(ball.x, ball.y, ball.z);
    drawBall(p.x, p.y, BR * p.k * pop, ball.rot);
}

// 只顯示出手後最初的一小段軌跡，讓玩家看到方向，但不直接告訴他會不會進
function drawAimGuide() {
    if (!drag) return;

    const v = launchVelocity();
    if (v) {
        let { x, y, z } = ball;
        let { vx, vy, vz } = v;

        ctx.fillStyle = "#fff";
        for (let i = 0; i < 10; i++) {
            for (let k = 0; k < 3; k++) {
                vy -= GRAV * 0.01;
                x += vx * 0.01;
                y += vy * 0.01;
                z += vz * 0.01;
            }
            const p = project(x, y, z);
            ctx.globalAlpha = 0.9 * (1 - i / 11);
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    // 手指拖曳線
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(drag.sx, drag.sy);
    ctx.lineTo(drag.x, drag.y);
    ctx.stroke();
}

function drawEffects() {
    for (const p of particles) {
        ctx.globalAlpha = 1 - p.t / p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const f of floatTexts) {
        ctx.globalAlpha = Math.min(1, (1.1 - f.t) * 2.5);
        drawText(f.text, f.x, f.y, f.size, f.color);
    }
    ctx.globalAlpha = 1;
}

function drawHud() {
    drawText("SCORE", 18, 30, 13, "#9aa4c0", "left");
    drawText(score.toLocaleString(), 18, 66, 38, "#fff", "left");

    const urgent = time <= 5 && started;
    drawText("TIME", W - 18, 30, 13, "#9aa4c0", "right");
    drawText(Math.ceil(time), W - 18, 66, 38, urgent ? "#ff5a5a" : "#fff", "right");

    if (combo >= 2) {
        drawText("🔥 x" + combo, W / 2, 60, 26, "#ff9d4a");
    }

    if (mode === "play" && !started && !drag) {
        const alpha = 0.55 + 0.4 * Math.sin(performance.now() / 300);
        drawText("向上滑動投籃 ↑", W / 2, H - 40, 18, "rgba(255, 255, 255, " + alpha + ")");
    }
}

function draw() {
    ctx.save();
    if (shake > 0.3) {
        ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    drawCourt();

    // 依球和籃板 / 籃框的前後關係決定畫圖順序，才不會穿模
    const boardZ = hoop.z + RR + 0.06;
    const ballBehindBoard = ball.z > boardZ;
    const ballInFront = ball.z < hoop.z - RR - 0.05;

    if (ballBehindBoard) {
        // 球飛過籃板上方、落到後面：先畫球，籃板和籃框再蓋上去
        drawBallWithShadow();
        drawBackboard();
        ringHalf(0, Math.PI);
        drawNet();
        ringHalf(Math.PI, Math.PI * 2);
    } else if (ballInFront) {
        // 球還在籃框前方：整個籃框先畫，球在最上層
        drawBackboard();
        ringHalf(0, Math.PI);
        drawNet();
        ringHalf(Math.PI, Math.PI * 2);
        drawBallWithShadow();
    } else {
        // 球在籃框範圍內：夾在後半圈與前半圈+網子之間，形成穿過籃框的效果
        drawBackboard();
        ringHalf(0, Math.PI);
        drawBallWithShadow();
        drawNet();
        ringHalf(Math.PI, Math.PI * 2);
    }

    drawAimGuide();
    drawEffects();
    drawHud();

    ctx.restore();
}

/* =========================================================
   主迴圈：固定 1/120 秒物理步長，不受螢幕更新率影響
   ========================================================= */
const STEP = 1 / 120;
let lastTime = 0;
let accumulator = 0;

function loop(timestamp) {
    const dt = Math.min(0.05, (timestamp - lastTime) / 1000 || 0);
    lastTime = timestamp;
    accumulator += dt;

    while (accumulator >= STEP) {
        step(STEP);
        accumulator -= STEP;
    }

    draw();
    requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
