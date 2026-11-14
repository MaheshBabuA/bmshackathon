import "dotenv/config";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const { port } = loadConfig();
const app = createApp();

const server = app.listen(port, () => {
  console.log(`CRISISGRID simulation server listening on http://localhost:${port}`);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "Supabase is not configured. API data operations return 503 until both server environment variables are set.",
    );
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close((error) => {
      if (error) {
        console.error("Failed to close the CRISISGRID server:", error);
        process.exitCode = 1;
        return;
      }
      process.exit(0);
    });
  });
}
