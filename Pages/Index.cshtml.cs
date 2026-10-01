using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace Swish.Pages;

public class IndexModel : PageModel
{
    public IActionResult OnGet()
    {
        return Redirect("/game/index.html");
    }
}
