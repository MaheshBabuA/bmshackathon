import http from "node:http";
import "dotenv/config";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const { port } = loadConfig();
const app = createApp();
const server = http.createServer(app);

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`\n❌ [PORT IN USE] Port ${port} is already being used by another process.`);
    console.error(`To free port ${port} in PowerShell, run:`);
    console.error(`   Stop-Process -Id (Get-NetTCPConnection -LocalPort ${port}).OwningProcess -Force`);
    console.error(`Or start CRISISGRID on another port:`);
    console.error(`   $env:PORT=3001; npm run dev\n`);
    process.exit(1);
  } else {
    console.error("Server error:", error);
    process.exit(1);
  }
});

server.listen(port, () => {
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
