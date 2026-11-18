import test from "node:test";
import assert from "node:assert/strict";
import { createNightlyRestrictionService } from "../src/services/nightly-restriction.service.js";
import { loadRestrictionConfig } from "../src/config/restriction-env.js";

const config = {
  botToken: "bot-token",
  guildId: "guild-id",
  verifiedRoleId: "verified-role-id"
};

function response(status, payload = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get() { return null; } },
    async json() { return payload; }
  };
}

test("nightly restriction removes Verified from every active binding in duplicate groups", async () => {
  const statements = [];
  const bindings = [
    { id: 1, keycloak_sub: "kc-1", discord_id: "discord-1", access_status: "verified", active_binding_count: 2 },
    { id: 2, keycloak_sub: "kc-1", discord_id: "discord-2", access_status: "restricted", active_binding_count: 2 }
  ];
  const database = {
    async execute(sql) {
      statements.push({ sql });
      return [bindings];
    },
    async getConnection() {
      return {
        async beginTransaction() {},
        async execute(sql, params) {
          statements.push({ sql, params });
          if (sql.includes("UPDATE account_bindings")) {
            return [{ affectedRows: params[0] === 1 ? 1 : 0 }];
          }
          return [{ affectedRows: 1 }];
        },
        async commit() {},
        async rollback() {},
        release() {}
      };
    }
  };

  const roles = new Map([
    ["discord-1", ["verified-role-id", "department-role-id"]],
    ["discord-2", ["department-role-id"]]
  ]);
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET" });
    const memberMatch = url.match(/\/members\/(discord-[12])/);
    if (memberMatch && !url.includes("/roles/")) {
      return response(200, { roles: [...roles.get(memberMatch[1])] });
    }
    if (url.includes("/roles/verified-role-id") && options.method === "DELETE") {
      const discordId = memberMatch?.[1] || url.match(/\/members\/(discord-[12])/)[1];
      roles.set(discordId, roles.get(discordId).filter((role) => role !== "verified-role-id"));
      return response(204);
    }
    return response(404, { message: "unknown route" });
  };
  const service = createNightlyRestrictionService({
    database, config, fetchImpl, sleep: async () => {},
    logger: { info() {}, error() {} }
  });

  const summary = await service.run();

  assert.deepEqual(summary, {
    candidates: 2, restricted: 1, alreadyRestricted: 1, notInGuild: 0, failed: 0
  });
  assert.deepEqual(roles.get("discord-1"), ["department-role-id"]);
  assert.deepEqual(roles.get("discord-2"), ["department-role-id"]);
  assert.equal(calls.filter((call) => call.method === "DELETE").length, 1);
  assert.equal(statements.filter((item) => item.sql.includes("INSERT INTO account_binding_audit_logs")).length, 1);
  assert.match(statements.find((item) => item.sql.includes("SELECT binding.id")).sql, /HAVING COUNT\(\*\) > 1/);
});

test("nightly restriction treats a member outside the guild as having no Verified role", async () => {
  const statements = [];
  const database = {
    async execute() {
      return [[{ id: 3, keycloak_sub: "kc-2", discord_id: "discord-3", access_status: "verified", active_binding_count: 2 }]];
    },
    async getConnection() {
      return {
        async beginTransaction() {},
        async execute(sql, params) {
          statements.push({ sql, params });
          return [{ affectedRows: 1 }];
        },
        async commit() {},
        async rollback() {},
        release() {}
      };
    }
  };
  const service = createNightlyRestrictionService({
    database, config,
    fetchImpl: async () => response(404, { code: 10007, message: "Unknown Member" }),
    sleep: async () => {},
    logger: { info() {}, error() {} }
  });

  const summary = await service.run();
  assert.equal(summary.notInGuild, 1);
  assert.equal(summary.restricted, 1);
  const audit = statements.find((item) => item.sql.includes("INSERT INTO account_binding_audit_logs"));
  assert.match(audit.params[3], /"discordOutcome":"not_in_guild"/);
});

test("Discord 429 is retried using retry_after before continuing", async () => {
  const waits = [];
  let attempts = 0;
  const database = { async execute() { return [[]]; } };
  const service = createNightlyRestrictionService({
    database, config,
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1
        ? response(429, { retry_after: 1.25, message: "rate limited" })
        : response(200, { roles: [] });
    },
    sleep: async (milliseconds) => waits.push(milliseconds),
    logger: { info() {}, error() {} }
  });

  const result = await service.ensureVerifiedRoleAbsent("discord-4");
  assert.deepEqual(result, { outcome: "already_absent" });
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [1250]);
});

test("restriction config requires only database and Discord bot credentials", () => {
  const loaded = loadRestrictionConfig({
    DB_HOST: "db", DB_NAME: "app", DB_USER: "app-user", DB_PASSWORD: "secret",
    DISCORD_BOT_TOKEN: "token", DISCORD_GUILD_ID: "guild",
    DISCORD_VERIFIED_ROLE_ID: "role"
  });
  assert.equal(loaded.database.host, "db");
  assert.equal(loaded.discordBot.verifiedRoleId, "role");
  assert.throws(() => loadRestrictionConfig({}), /Missing required environment variables/);
});
