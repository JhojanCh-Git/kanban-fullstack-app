import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createUserClientFactory } from "./lib/supabase.js";

function main(): void {
  let env;
  try {
    env = loadEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const app = createApp({
    createUserClient: createUserClientFactory(env.supabaseUrl, env.supabaseAnonKey),
    corsOrigins: env.corsOrigins,
  });

  const server = app.listen(env.port, () => {
    console.log(`API escuchando en http://localhost:${env.port} (${env.nodeEnv})`);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} recibido, cerrando servidor...`);
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
