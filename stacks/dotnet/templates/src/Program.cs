var app = WebApplication.CreateBuilder(args).Build();

app.MapGet("/", () => Results.Ok(new { message = "Hello from Devroost .NET template" }));

app.Run();
