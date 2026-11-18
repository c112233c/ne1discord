import test from "node:test";
import assert from "node:assert/strict";
import { buildDiscordNickname, createDiscordBotService } from "../src/services/discord-bot.service.js";

test("nickname preserves user_id and truncates display name to 32 characters", () => {
  const nickname = buildDiscordNickname("EMP001", "A".repeat(80));
  assert.equal(nickname, "EMP001 - " + "A".repeat(23));
  assert.equal(nickname.length, 32);
});

test("nickname rejects missing or overlong user_id", () => {
  assert.throws(() => buildDiscordNickname("", "Example"), /user_id is required/);
  assert.throws(() => buildDiscordNickname("E".repeat(33), "Example"), /32-character/);
});

test("department role is created once by exact department name and member gets both roles", async () => {
  const calls = [];
  const dbCalls = [];
  const connection = {
    async execute(sql, params) {
      dbCalls.push({ sql, params });
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      return [[]];
    },
    release() {}
  };
  const database = { async getConnection() { return connection; } };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/roles") && !options.method) {
      return { status: 200, ok: true, async json() { return []; } };
    }
    if (url.endsWith("/roles") && options.method === "POST") {
      const body = JSON.parse(options.body);
      assert.equal(body.name, "ฝ่ายปฏิบัติการ");
      assert.equal(body.permissions, "0");
      assert.equal(body.hoist, true);
      return { status: 200, ok: true, async json() { return { id: "department-role-id", name: body.name }; } };
    }
    if (url.endsWith("/members/discord-user")) {
      return { status: 200, ok: true, async json() { return { user: { id: "discord-user" } }; } };
    }
    return { status: 204, ok: true, async json() { return {}; } };
  };
  const bot = createDiscordBotService({
    botToken: "test-token", guildId: "guild-id", verifiedRoleId: "verified-role-id"
  }, database, fetchImpl);

  const result = await bot.synchronizeMember({
    discordId: "discord-user", userId: "EMP001", name: "Somchai",
    departmentName: "ฝ่ายปฏิบัติการ"
  });

  assert.deepEqual(result, {
    nickname: "EMP001 - Somchai",
    departmentRoleId: "department-role-id",
    verifiedRoleId: "verified-role-id"
  });
  assert.equal(calls.filter((call) => call.options.method === "POST").length, 1);
  assert.equal(calls.filter((call) => call.options.method === "PUT").length, 2);
  assert.ok(calls.some((call) => call.options.method === "PATCH" &&
    JSON.parse(call.options.body).nick === "EMP001 - Somchai"));
  assert.ok(dbCalls.some((call) => call.sql.includes("INSERT INTO discord_department_roles")));
  assert.ok(dbCalls.some((call) => call.sql.includes("RELEASE_LOCK")));
});

test("department role reuses an existing role with an exact matching name", async () => {
  const calls = [];
  const connection = {
    async execute(sql) {
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      return [[]];
    },
    release() {}
  };
  const bot = createDiscordBotService({
    botToken: "test-token", guildId: "guild-id", verifiedRoleId: "verified-role-id"
  }, { async getConnection() { return connection; } }, async (url, options = {}) => {
    calls.push({ url, options });
    return { status: 200, ok: true, async json() {
      return url.endsWith("/roles") ? [{ id: "existing-role", name: "ฝ่ายปฏิบัติการ" }] : {};
    } };
  });

  const roleId = await bot.getDepartmentRoleId("ฝ่ายปฏิบัติการ");
  assert.equal(roleId, "existing-role");
  assert.equal(calls.some((call) => call.options.method === "POST"), false);
});

test("verification message is created with a Keycloak link button and reused on restart", async () => {
  const calls = [];
  let messages = [];
  const bot = createDiscordBotService({
    botToken: "test-token", guildId: "guild-id", verifiedRoleId: "verified-role-id"
  }, {}, async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/messages?limit=100")) {
      return { status: 200, ok: true, async json() { return messages; } };
    }
    if (url.endsWith("/messages") && options.method === "POST") {
      const body = JSON.parse(options.body);
      assert.equal(body.embeds[0].title, "ยินดีต้อนรับสู่ Discord Server");
      assert.equal(body.components[0].components[0].url, "https://discord.example.com/auth/keycloak");
      messages = [{ id: "welcome-message-id", author: { bot: true }, embeds: body.embeds }];
      return { status: 200, ok: true, async json() { return { id: "welcome-message-id" }; } };
    }
    throw new Error("Unexpected Discord API request");
  });

  const first = await bot.ensureVerificationMessage({
    channelId: "1572537106570682529", appBaseUrl: "https://discord.example.com"
  });
  const second = await bot.ensureVerificationMessage({
    channelId: "1572537106570682529", appBaseUrl: "https://discord.example.com"
  });

  assert.deepEqual(first, { created: true, messageId: "welcome-message-id" });
  assert.deepEqual(second, { created: false, messageId: "welcome-message-id" });
  assert.equal(calls.filter((call) => call.options.method === "POST").length, 1);
});
