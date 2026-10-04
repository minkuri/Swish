using System.Net.Http.Json;
using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);
var configuredConnectionString = builder.Configuration.GetConnectionString("DefaultConnection");

if (string.IsNullOrWhiteSpace(configuredConnectionString))
{
    throw new InvalidOperationException(
        "ConnectionStrings:DefaultConnection is missing. Configure it with user-secrets or an environment variable.");
}

var connectionString = NormalizePostgresConnectionString(configuredConnectionString);
builder.Services.AddDbContext<ApplicationDbContext>(options => options.UseNpgsql(connectionString));
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});
builder.Services.AddHttpClient("turnstile", client => client.Timeout = TimeSpan.FromSeconds(5));
builder.Services.AddDefaultIdentity<ApplicationUser>(options =>
    {
        options.SignIn.RequireConfirmedAccount = false;
        options.SignIn.RequireConfirmedEmail = false;
        options.User.RequireUniqueEmail = false;
        options.Password.RequiredLength = 8;
        options.Password.RequireDigit = true;
        options.Password.RequireLowercase = true;
        options.Password.RequireUppercase = false;
        options.Password.RequireNonAlphanumeric = false;
        options.Lockout.MaxFailedAccessAttempts = 5;
        options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(10);
        options.Lockout.AllowedForNewUsers = true;
    })
    .AddEntityFrameworkStores<ApplicationDbContext>();

builder.Services.ConfigureApplicationCookie(options =>
{
    options.Cookie.Name = "Swish.Auth";
    options.Cookie.HttpOnly = true;
    options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
    options.Cookie.SameSite = SameSiteMode.Lax;
    options.ExpireTimeSpan = TimeSpan.FromDays(14);
    options.SlidingExpiration = true;
    options.Events.OnRedirectToLogin = context =>
    {
        if (context.Request.Path.StartsWithSegments("/api"))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        }

        context.Response.Redirect(context.RedirectUri);
        return Task.CompletedTask;
    };
    options.Events.OnRedirectToAccessDenied = context =>
    {
        if (context.Request.Path.StartsWithSegments("/api"))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        }

        context.Response.Redirect(context.RedirectUri);
        return Task.CompletedTask;
    };
});

builder.Services.AddRazorPages();
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("auth", context => RateLimitPartition.GetFixedWindowLimiter(
        GetClientKey(context), _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true,
        }));
    options.AddPolicy("register", context => RateLimitPartition.GetFixedWindowLimiter(
        GetClientKey(context), _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 4,
            Window = TimeSpan.FromHours(1),
            QueueLimit = 0,
            AutoReplenishment = true,
        }));
    options.AddPolicy("leaderboard", context => RateLimitPartition.GetFixedWindowLimiter(
        GetClientKey(context), _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 120,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true,
        }));
    options.AddPolicy("scores", context => RateLimitPartition.GetFixedWindowLimiter(
        GetClientKey(context), _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(5),
            QueueLimit = 0,
            AutoReplenishment = true,
        }));
    options.AddPolicy("shop", context => RateLimitPartition.GetFixedWindowLimiter(
        GetClientKey(context), _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 120,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true,
        }));
});

var app = builder.Build();

if (builder.Configuration.GetValue<bool>("Database:ApplyMigrations"))
{
    await using var scope = app.Services.CreateAsyncScope();
    var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
    await db.Database.MigrateAsync();
}

const string turnstileTestSecret = "1x0000000000000000000000000000000AA";
if (!app.Environment.IsDevelopment()
    && string.Equals(builder.Configuration["Turnstile:SecretKey"], turnstileTestSecret, StringComparison.Ordinal))
{
    throw new InvalidOperationException("Cloudflare Turnstile test keys cannot be used outside Development.");
}
if (!app.Environment.IsDevelopment()
    && !string.IsNullOrWhiteSpace(builder.Configuration["Turnstile:SecretKey"])
    && string.IsNullOrWhiteSpace(builder.Configuration["Turnstile:HostName"]))
{
    throw new InvalidOperationException("Configure Turnstile:HostName before enabling registration in production.");
}

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
    app.UseHsts();
}

app.UseForwardedHeaders();
app.UseHttpsRedirection();
app.UseRouting();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapStaticAssets();
app.MapRazorPages().WithStaticAssets();

app.MapGet("/api/public-config", (IConfiguration configuration) => Results.Ok(new
{
    turnstileSiteKey = configuration["Turnstile:SiteKey"] ?? string.Empty,
})).AllowAnonymous();

app.MapPost("/api/auth/register", async (
    RegisterRequest request,
    HttpContext httpContext,
    UserManager<ApplicationUser> userManager,
    SignInManager<ApplicationUser> signInManager,
    IHttpClientFactory clients,
    IConfiguration configuration,
    IHostEnvironment environment) =>
{
    var account = request.Account?.Trim() ?? string.Empty;
    var displayName = request.Username?.Trim();
    var region = request.Region?.Trim() ?? string.Empty;

    if (!IsValidAccount(account))
    {
        return Results.BadRequest(new { message = "帳號需為 3–32 個英數字、底線、句點或連字號。" });
    }
    if (string.IsNullOrWhiteSpace(request.Password) || request.Password.Length < 8)
    {
        return Results.BadRequest(new { message = "密碼至少需要 8 個字元。" });
    }
    if (displayName?.Length > 24 || region.Length > 80)
    {
        return Results.BadRequest(new { message = "使用者名稱最多 24 字，地區最多 80 字。" });
    }
    if (!await VerifyTurnstileAsync(
        clients, configuration, request.TurnstileToken, httpContext.Connection.RemoteIpAddress?.ToString()))
    {
        return Results.BadRequest(new { message = "人機驗證失敗，請重新完成驗證。" });
    }

    var user = new ApplicationUser
    {
        UserName = account,
        DisplayName = string.IsNullOrWhiteSpace(displayName) ? account : displayName,
        Region = region,
        Coins = IsUnlimitedTestAccount(account, environment, configuration) ? int.MaxValue : 500,
    };
    var result = await userManager.CreateAsync(user, request.Password);
    if (!result.Succeeded)
    {
        var message = string.Join(" ", result.Errors.Select(error => error.Description));
        return Results.BadRequest(new { message });
    }

    await signInManager.SignInAsync(user, isPersistent: true);
    return Results.Ok(new { player = ToPlayerResponse(user) });
})
    .AllowAnonymous()
    .RequireRateLimiting("register");

app.MapPost("/api/auth/login", async (
    LoginRequest request,
    UserManager<ApplicationUser> userManager,
    SignInManager<ApplicationUser> signInManager,
    IHostEnvironment environment,
    IConfiguration configuration) =>
{
    var account = request.Account?.Trim() ?? string.Empty;
    var user = await userManager.FindByNameAsync(account);
    if (user is null)
    {
        return Results.Json(new { message = "帳號或密碼錯誤。" }, statusCode: StatusCodes.Status401Unauthorized);
    }

    var result = await signInManager.CheckPasswordSignInAsync(user, request.Password ?? string.Empty, lockoutOnFailure: true);
    if (!result.Succeeded)
    {
        return Results.Json(new { message = "帳號或密碼錯誤，或帳號暫時鎖定。" }, statusCode: StatusCodes.Status401Unauthorized);
    }

    if (IsUnlimitedTestAccount(user.UserName ?? string.Empty, environment, configuration)
        && user.Coins != int.MaxValue)
    {
        user.Coins = int.MaxValue;
        await userManager.UpdateAsync(user);
    }

    await signInManager.SignInAsync(user, isPersistent: true);
    return Results.Ok(new { player = ToPlayerResponse(user) });
})
    .AllowAnonymous()
    .RequireRateLimiting("auth");

app.MapPost("/api/auth/logout", async (SignInManager<ApplicationUser> signInManager) =>
{
    await signInManager.SignOutAsync();
    return Results.NoContent();
}).RequireAuthorization();

app.MapGet("/api/player/me", async (
    ClaimsPrincipal principal,
    UserManager<ApplicationUser> userManager,
    ApplicationDbContext db) =>
{
    var user = await userManager.GetUserAsync(principal);
    if (user is null) return Results.Unauthorized();

    var inventory = await ReadInventoryAsync(user, db);
    var bestScores = await ReadBestScoresAsync(user.Id, db);
    return Results.Ok(new { player = ToPlayerResponse(user), inventory, bestScores });
}).RequireAuthorization();

app.MapPatch("/api/player/profile", async (
    ProfileRequest request,
    ClaimsPrincipal principal,
    UserManager<ApplicationUser> userManager) =>
{
    var user = await userManager.GetUserAsync(principal);
    if (user is null) return Results.Unauthorized();

    var displayName = request.Username?.Trim() ?? string.Empty;
    var region = request.Region?.Trim() ?? string.Empty;
    if (displayName.Length is < 1 or > 24 || region.Length > 80
        || request.AvatarId is not null && !IsValidAvatarId(request.AvatarId))
    {
        return Results.BadRequest(new { message = "使用者名稱需為 1–24 字，地區最多 80 字，頭像需為有效選項。" });
    }

    user.DisplayName = displayName;
    user.Region = region;
    if (request.AvatarId is not null)
    {
        user.AvatarId = request.AvatarId;
    }
    var result = await userManager.UpdateAsync(user);
    if (!result.Succeeded)
    {
        return Results.BadRequest(new { message = string.Join(" ", result.Errors.Select(error => error.Description)) });
    }

    return Results.Ok(ToPlayerResponse(user));
}).RequireAuthorization();

app.MapGet("/api/leaderboard", async (
    int duration,
    ClaimsPrincipal principal,
    ApplicationDbContext db) =>
{
    if (!new[] { 30, 60, 180 }.Contains(duration))
    {
        return Results.BadRequest(new { message = "賽制秒數只接受 30、60 或 180。" });
    }

    var currentUserId = principal.FindFirstValue(ClaimTypes.NameIdentifier);
    var bestScores = db.GameRecords
        .Where(record => record.DurationSeconds == duration)
        .GroupBy(record => record.UserId)
        .Select(group => new { UserId = group.Key, Score = group.Max(record => record.Score) });

    var rows = await bestScores
        .Join(db.Users, best => best.UserId, user => user.Id,
            (best, user) => new
            {
                user.DisplayName,
                user.Region,
                user.AvatarId,
                best.Score,
                user.Id,
            })
        .OrderByDescending(row => row.Score)
        .ThenBy(row => row.DisplayName)
        .Take(20)
        .ToListAsync();

    var entries = rows.Select(row => new LeaderboardEntry(
        row.DisplayName,
        row.Region,
        row.Score,
        row.AvatarId,
        row.Id == currentUserId));

    return Results.Ok(new { entries });
})
    .AllowAnonymous()
    .RequireRateLimiting("leaderboard");

app.MapPost("/api/games/complete", async (
    CompleteGameRequest request,
    ClaimsPrincipal principal,
    UserManager<ApplicationUser> userManager,
    ApplicationDbContext db,
    IHostEnvironment environment,
    IConfiguration configuration) =>
{
    var user = await userManager.GetUserAsync(principal);
    if (user is null) return Results.Unauthorized();

    var maxAllowedScore = request.Duration switch
    {
        30 => 5_000,
        60 => 10_000,
        180 => 30_000,
        _ => 0,
    };
    if (maxAllowedScore == 0 || request.Score < 0 || request.Score > maxAllowedScore
        || request.Shots is < 1 or > 500 || request.Hits < 0 || request.Hits > request.Shots
        || request.MaxCombo < 0 || request.MaxCombo > request.Hits)
    {
        return Results.BadRequest(new { message = "成績資料無效，請重新開始一場遊戲。" });
    }

    var isUnlimitedTestAccount = IsUnlimitedTestAccount(user.UserName ?? string.Empty, environment, configuration);
    var coinsEarned = isUnlimitedTestAccount ? 0 : Math.Min(100, request.Score / 10);
    var record = new GameRecord
    {
        UserId = user.Id,
        DurationSeconds = request.Duration,
        Score = request.Score,
        Hits = request.Hits,
        Shots = request.Shots,
        MaxCombo = request.MaxCombo,
        CoinsEarned = coinsEarned,
        CreatedAtUtc = DateTime.UtcNow,
    };

    user.BestScore = Math.Max(user.BestScore, request.Score);
    user.TotalHits += request.Hits;
    user.TotalGamesPlayed++;
    user.Coins += coinsEarned;
    db.GameRecords.Add(record);
    await db.SaveChangesAsync();
    var bestScores = await ReadBestScoresAsync(user.Id, db);

    return Results.Ok(new { player = ToPlayerResponse(user), coinsEarned, bestScores });
})
    .RequireAuthorization()
    .RequireRateLimiting("scores");

app.MapGet("/api/shop/catalog", () => Results.Ok(new { items = ShopCatalog.Items }))
    .AllowAnonymous();

app.MapGet("/api/shop/inventory", async (
    ClaimsPrincipal principal,
    UserManager<ApplicationUser> userManager,
    ApplicationDbContext db) =>
{
    var user = await userManager.GetUserAsync(principal);
    if (user is null) return Results.Unauthorized();
    return Results.Ok(await ReadInventoryAsync(user, db));
}).RequireAuthorization();

app.MapPost("/api/shop/purchase", async (
    PurchaseRequest request,
    ClaimsPrincipal principal,
    UserManager<ApplicationUser> userManager,
    ApplicationDbContext db,
    IHostEnvironment environment,
    IConfiguration configuration) =>
{
    var user = await userManager.GetUserAsync(principal);
    if (user is null) return Results.Unauthorized();

    var item = ShopCatalog.Items.SingleOrDefault(item =>
        item.Category == request.Category && item.Id == request.ItemId);
    if (item is null) return Results.NotFound(new { message = "找不到這項商品。" });

    var ownedItem = await db.PlayerItems.FindAsync(user.Id, item.Category, item.Id);
    if (ownedItem is null)
    {
        var isUnlimitedTestAccount = IsUnlimitedTestAccount(user.UserName ?? string.Empty, environment, configuration);
        if (!isUnlimitedTestAccount && user.Coins < item.Cost)
        {
            return Results.BadRequest(new { message = "金幣不足，先去球場得分賺取金幣吧。" });
        }

        if (!isUnlimitedTestAccount) user.Coins -= item.Cost;
        ownedItem = new PlayerItem
        {
            UserId = user.Id,
            Category = item.Category,
            ItemId = item.Id,
            PurchasedAtUtc = DateTime.UtcNow,
        };
        db.PlayerItems.Add(ownedItem);
    }

    switch (item.Category)
    {
        case "courts": user.EquippedCourt = item.Id; break;
        case "balls": user.EquippedBall = item.Id; break;
        case "hoops": user.EquippedHoop = item.Id; break;
    }

    await db.SaveChangesAsync();
    return Results.Ok(new { player = ToPlayerResponse(user), inventory = await ReadInventoryAsync(user, db) });
})
    .RequireAuthorization()
    .RequireRateLimiting("shop");

app.Run();

static string NormalizePostgresConnectionString(string value)
{
    if (!value.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase)
        && !value.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
    {
        return value;
    }

    if (!Uri.TryCreate(value, UriKind.Absolute, out var uri))
    {
        throw new InvalidOperationException("ConnectionStrings:DefaultConnection must be a valid PostgreSQL connection string or URI.");
    }

    var credentials = uri.UserInfo.Split(':', 2);
    if (credentials.Length != 2 || string.IsNullOrWhiteSpace(uri.Host))
    {
        throw new InvalidOperationException("The PostgreSQL URI must include a username, password, and host.");
    }

    var parsed = new NpgsqlConnectionStringBuilder
    {
        Host = uri.Host,
        Port = uri.IsDefaultPort ? 5432 : uri.Port,
        Database = Uri.UnescapeDataString(uri.AbsolutePath.Trim('/')),
        Username = Uri.UnescapeDataString(credentials[0]),
        Password = Uri.UnescapeDataString(credentials[1]),
        SslMode = SslMode.Require,
    };

    foreach (var pair in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
    {
        var parts = pair.Split('=', 2);
        var key = Uri.UnescapeDataString(parts[0]).Replace('_', '-').ToLowerInvariant();
        var queryValue = parts.Length == 2 ? Uri.UnescapeDataString(parts[1]) : string.Empty;
        if (key == "sslmode")
        {
            parsed["SSL Mode"] = queryValue;
        }
        else if (key == "channel-binding")
        {
            parsed["Channel Binding"] = queryValue;
        }
    }

    return parsed.ConnectionString;
}

static string GetClientKey(HttpContext context) =>
    context.Connection.RemoteIpAddress?.MapToIPv4().ToString() ?? "unknown-client";

static bool IsValidAccount(string account) =>
    account.Length is >= 3 and <= 32
    && account.All(character => char.IsAsciiLetterOrDigit(character)
        || character is '_' or '.' or '-');

static bool IsValidAvatarId(string avatarId) =>
    avatarId is "rookie" or "captain" or "lightning" or "ace" or "night";

static bool IsUnlimitedTestAccount(string account, IHostEnvironment environment, IConfiguration configuration) =>
    environment.IsDevelopment()
    && !string.IsNullOrWhiteSpace(configuration["TestAccount:Account"])
    && string.Equals(account, configuration["TestAccount:Account"], StringComparison.OrdinalIgnoreCase);

static PlayerResponse ToPlayerResponse(ApplicationUser user) => new(
    user.Id,
    user.UserName ?? string.Empty,
    user.DisplayName,
    user.Region,
    user.AvatarId,
    user.Coins,
    user.BestScore,
    user.TotalHits,
    user.TotalGamesPlayed,
    new Dictionary<string, string>
    {
        ["courts"] = user.EquippedCourt,
        ["balls"] = user.EquippedBall,
        ["hoops"] = user.EquippedHoop,
    });

static async Task<Dictionary<int, int>> ReadBestScoresAsync(string userId, ApplicationDbContext db)
{
    var scores = await db.GameRecords
        .Where(record => record.UserId == userId)
        .GroupBy(record => record.DurationSeconds)
        .Select(group => new { Duration = group.Key, Score = group.Max(record => record.Score) })
        .ToListAsync();

    return scores.ToDictionary(item => item.Duration, item => item.Score);
}

static async Task<InventoryResponse> ReadInventoryAsync(ApplicationUser user, ApplicationDbContext db)
{
    var owned = await db.PlayerItems
        .Where(item => item.UserId == user.Id)
        .Select(item => new { item.Category, item.ItemId })
        .ToListAsync();

    var grouped = owned.GroupBy(item => item.Category)
        .ToDictionary(group => group.Key, group => group.Select(item => item.ItemId).ToList());
    foreach (var category in new[] { "courts", "balls", "hoops" })
    {
        if (!grouped.TryGetValue(category, out var items))
        {
            grouped[category] = ["classic"];
        }
        else if (!items.Contains("classic"))
        {
            items.Add("classic");
        }
    }

    return new InventoryResponse(
        user.Coins,
        grouped,
        new Dictionary<string, string>
        {
            ["courts"] = user.EquippedCourt,
            ["balls"] = user.EquippedBall,
            ["hoops"] = user.EquippedHoop,
        });
}

static async Task<bool> VerifyTurnstileAsync(
    IHttpClientFactory clients,
    IConfiguration configuration,
    string? token,
    string? remoteIp)
{
    var secret = configuration["Turnstile:SecretKey"];
    if (string.IsNullOrWhiteSpace(secret) || string.IsNullOrWhiteSpace(token)) return false;

    try
    {
        using var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["secret"] = secret,
            ["response"] = token,
            ["remoteip"] = remoteIp ?? string.Empty,
        });
        using var response = await clients.CreateClient("turnstile")
            .PostAsync("https://challenges.cloudflare.com/turnstile/v0/siteverify", content);
        if (!response.IsSuccessStatusCode) return false;

        var verification = await response.Content.ReadFromJsonAsync<TurnstileResponse>();
        if (verification?.Success != true) return false;

        var allowedHost = configuration["Turnstile:HostName"];
        return string.IsNullOrWhiteSpace(allowedHost)
            || string.Equals(verification.Hostname, allowedHost, StringComparison.OrdinalIgnoreCase);
    }
    catch (HttpRequestException)
    {
        return false;
    }
    catch (TaskCanceledException)
    {
        return false;
    }
}

public sealed record RegisterRequest(string? Account, string? Password, string? Username, string? Region, string? TurnstileToken);
public sealed record LoginRequest(string? Account, string? Password);
public sealed record ProfileRequest(string? Username, string? Region, string? AvatarId);
public sealed record CompleteGameRequest(int Duration, int Score, int Hits, int Shots, int MaxCombo);
public sealed record PurchaseRequest(string? Category, string? ItemId);
public sealed record PlayerResponse(string Id, string Account, string Username, string Region, string AvatarId, int Coins, int BestScore, int TotalHits, int TotalGamesPlayed, Dictionary<string, string> Equipped);
public sealed record InventoryResponse(int Coins, Dictionary<string, List<string>> Owned, Dictionary<string, string> Equipped);
public sealed record LeaderboardEntry(string Username, string Region, int Score, string Avatar, bool IsCurrentPlayer);
public sealed record TurnstileResponse(bool Success, string? Hostname);

public sealed record ShopItemDefinition(string Id, string Category, string Name, string Description, int Cost);

public static class ShopCatalog
{
    public static readonly ShopItemDefinition[] Items =
    [
        new("classic", "courts", "經典木地板", "暖木地板・經典主場", 0),
        new("night", "courts", "夜間球場", "霓虹夜色・城市球場", 300),
        new("beach", "courts", "海灘球場", "海風沙灘・度假球場", 500),
        new("galaxy", "courts", "銀河球場", "星雲地板・宇宙球場", 800),
        new("classic", "balls", "經典橘球", "標準手感・經典橘球", 0),
        new("fire", "balls", "火焰球", "炙熱火焰・燃燒特效", 250),
        new("galaxy", "balls", "銀河球", "星際旋紋・銀河球", 450),
        new("gold", "balls", "黃金球", "鍍金收藏・尊爵球", 700),
        new("classic", "hoops", "經典橘框", "標準橘框・白色球網", 0),
        new("fire", "hoops", "火焰框", "烈焰紅框・夕陽球網", 300),
        new("crystal", "hoops", "水晶框", "冰晶藍框・透光球網", 550),
        new("space", "hoops", "星空框", "星光紫框・幻彩球網", 900),
    ];
}
