public class PlayerItem
{
    public string UserId { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string ItemId { get; set; } = string.Empty;
    public DateTime PurchasedAtUtc { get; set; }

    public ApplicationUser? User { get; set; }
}
