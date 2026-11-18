import "dotenv/config";
import { loadRestrictionConfig } from "../config/restriction-env.js";
import { createDatabase } from "../config/database.js";
import { createNightlyRestrictionService } from "../services/nightly-restriction.service.js";

const config = loadRestrictionConfig();
const database = createDatabase(config.database);

try {
  console.log("[nightly-restriction] job started", {
    startedAt: new Date().toISOString()
  });
  const service = createNightlyRestrictionService({
    database,
    config: config.discordBot
  });
  const summary = await service.run();
  console.log("[nightly-restriction] job completed", {
    completedAt: new Date().toISOString(),
    ...summary
  });
  if (summary.failed > 0) process.exitCode = 1;
} catch (error) {
  console.error("[nightly-restriction] job aborted", {
    error: error.message,
    status: error.status
  });
  process.exitCode = 1;
} finally {
  await database.end();
}
