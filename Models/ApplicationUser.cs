using Microsoft.AspNetCore.Identity;

public class ApplicationUser : IdentityUser
{
    public string DisplayName { get; set; } = string.Empty;
    public string Region { get; set; } = string.Empty;
    public int Coins { get; set; } = 500;
    public int BestScore { get; set; }
    public int TotalHits { get; set; }
    public int TotalGamesPlayed { get; set; }
    public string EquippedCourt { get; set; } = "classic";
    public string EquippedBall { get; set; } = "classic";
    public string EquippedHoop { get; set; } = "classic";
}
