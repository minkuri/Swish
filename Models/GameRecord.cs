public class GameRecord
{
    public long Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public int DurationSeconds { get; set; }
    public int Score { get; set; }
    public int Hits { get; set; }
    public int Shots { get; set; }
    public int MaxCombo { get; set; }
    public int CoinsEarned { get; set; }
    public DateTime CreatedAtUtc { get; set; }

    public ApplicationUser? User { get; set; }
}
