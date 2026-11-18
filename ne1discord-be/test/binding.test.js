import test from "node:test";
import assert from "node:assert/strict";
import { getBindingOverview, verifyAccountBinding } from "../src/services/binding.service.js";

const keycloak = { sub: "kc-sub-001", userId: "EMP001", name: "Example User" };
const discord = { id: "discord-001", username: "example", globalName: "Example" };

test("binding overview reports unbound Discord identity and existing Keycloak links", async () => {
  let call = 0;
  const database = {
    async execute() {
      call += 1;
      if (call === 1) return [[{
        discord_id: "discord-old", discord_username: "old-account",
        discord_global_name: null, binding_status: "active",
        access_status: "restricted", verified_at: null
      }]];
      return [[]];
    }
  };

  const result = await getBindingOverview(database, keycloak, discord);
  assert.equal(result.status, "unbound");
  assert.equal(result.accessStatus, "restricted");
  assert.equal(result.linkedAccounts.length, 1);
  assert.equal(result.linkedAccounts[0].discordId, "discord-old");
});

test("binding overview detects Discord ID owned by another Keycloak subject", async () => {
  const database = {
    async execute(sql) {
      if (sql.includes("WHERE keycloak_sub")) return [[]];
      return [[{
        keycloak_sub: "another-sub", binding_status: "active",
        access_status: "verified", verified_at: new Date()
      }]];
    }
  };
  const result = await getBindingOverview(database, keycloak, discord);
  assert.equal(result.status, "conflict");
});

test("verify creates an active binding with restricted access and audit log", async () => {
  const statements = [];
  const connection = {
    async beginTransaction() {},
    async execute(sql, params) {
      statements.push({ sql, params });
      if (sql.includes("SELECT id, keycloak_sub")) return [[]];
      return [{ insertId: 1 }];
    },
    async commit() {},
    async rollback() {},
    release() {}
  };
  const database = { async getConnection() { return connection; } };

  const result = await verifyAccountBinding(database, keycloak, discord);
  assert.deepEqual(result, { status: "bound" });
  assert.ok(statements.some((item) => item.sql.includes("INSERT INTO account_bindings")));
  assert.ok(statements.some((item) => item.sql.includes("INSERT INTO account_binding_audit_logs")));
  const insert = statements.find((item) => item.sql.includes("INSERT INTO account_bindings"));
  assert.match(insert.sql, /'active', 'restricted'/);
});

test("verify refuses a Discord ID already actively bound to another subject", async () => {
  let committed = false;
  let rolledBack = false;
  const connection = {
    async beginTransaction() {},
    async execute() {
      return [[{ id: 9, keycloak_sub: "other-sub", binding_status: "active" }]];
    },
    async commit() { committed = true; },
    async rollback() { rolledBack = true; },
    release() {}
  };
  const database = { async getConnection() { return connection; } };

  const result = await verifyAccountBinding(database, keycloak, discord);
  assert.deepEqual(result, { status: "conflict" });
  assert.equal(committed, false);
  assert.equal(rolledBack, true);
});

test("verify is idempotent for the same active binding", async () => {
  const connection = {
    async beginTransaction() {},
    async execute() {
      return [[{ id: 9, keycloak_sub: keycloak.sub, binding_status: "active" }]];
    },
    async commit() {},
    async rollback() {},
    release() {}
  };
  const database = { async getConnection() { return connection; } };

  const result = await verifyAccountBinding(database, keycloak, discord);
  assert.deepEqual(result, { status: "already_bound" });
});
