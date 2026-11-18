import "dotenv/config";
import { loadConfig } from "./config/env.js";
import { createDatabase } from "./config/database.js";
import { createApp } from "./app.js";
import { createDiscordBotService } from "./services/discord-bot.service.js";

const config = loadConfig();
const database = createDatabase(config.database);
const { app } = await createApp({ config, database });

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`ne1discord-be listening on port ${config.port}`);
  const discordBot = createDiscordBotService(config.discordBot, database);
  discordBot.ensureVerificationMessage({
    channelId: config.discordBot.verifyChannelId,
    appBaseUrl: config.appBaseUrl
  }).then((result) => {
    console.log("[discord] verification message ready", result);
  }).catch((error) => {
    console.error("[discord] failed to ensure verification message:", error.message);
  });
});

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down`);
  server.close(async () => {
    await database.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
