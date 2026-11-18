import test from "node:test";
import assert from "node:assert/strict";
import { createNightlyRestrictionService } from "../src/services/nightly-restriction.service.js";

test("an invalid guild is not mistaken for a member who left the server", async () => {
  let databaseWrites = 0;
  const database = {
    async execute() {
      return [[{
        id: 4, keycloak_sub: "kc-3", discord_id: "discord-4",
        access_status: "verified", active_binding_count: 2
      }]];
    },
    async getConnection() {
      databaseWrites += 1;
      throw new Error("must not update database when guild lookup is invalid");
    }
  };
  const service = createNightlyRestrictionService({
    database,
    config: {
      botToken: "bot-token", guildId: "invalid-guild",
      verifiedRoleId: "verified-role-id"
    },
    fetchImpl: async () => ({
      status: 404,
      ok: false,
      headers: { get() { return null; } },
      async json() { return { code: 10004, message: "Unknown Guild" }; }
    }),
    sleep: async () => {},
    logger: { info() {}, error() {} }
  });

  const summary = await service.run();
  assert.equal(summary.failed, 1);
  assert.equal(databaseWrites, 0);
});
