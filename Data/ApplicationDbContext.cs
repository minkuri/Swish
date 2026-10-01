using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

public class ApplicationDbContext : IdentityDbContext<ApplicationUser>
{
    public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
        : base(options)
    {
    }

    public DbSet<GameRecord> GameRecords => Set<GameRecord>();
    public DbSet<PlayerItem> PlayerItems => Set<PlayerItem>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<GameRecord>(entity =>
        {
            entity.HasKey(record => record.Id);
            entity.HasIndex(record => new { record.DurationSeconds, record.Score });
            entity.HasIndex(record => new { record.UserId, record.DurationSeconds, record.Score });
            entity.Property(record => record.CreatedAtUtc).IsRequired();
            entity.HasOne(record => record.User)
                .WithMany()
                .HasForeignKey(record => record.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<PlayerItem>(entity =>
        {
            entity.HasKey(item => new { item.UserId, item.Category, item.ItemId });
            entity.HasOne(item => item.User)
                .WithMany()
                .HasForeignKey(item => item.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<IdentityUserLogin<string>>(entity =>
        {
            entity.Property(login => login.LoginProvider).HasMaxLength(128);
            entity.Property(login => login.ProviderKey).HasMaxLength(128);
        });

        builder.Entity<IdentityUserToken<string>>(entity =>
        {
            entity.Property(token => token.LoginProvider).HasMaxLength(128);
            entity.Property(token => token.Name).HasMaxLength(128);
        });

        builder.Entity<ApplicationUser>(entity =>
        {
            entity.Property(user => user.EquippedCourt).HasMaxLength(32).IsRequired();
            entity.Property(user => user.EquippedBall).HasMaxLength(32).IsRequired();
            entity.Property(user => user.EquippedHoop).HasMaxLength(32).IsRequired();
        });
    }
}
