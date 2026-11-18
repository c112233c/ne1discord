import test from "node:test";
import assert from "node:assert/strict";
import { createPkceChallenge, createRandomToken, saveOAuthTransaction, consumeOAuthTransaction } from "../src/services/oauth-state.service.js";
import { loadConfig } from "../src/config/env.js";

test("OAuth state is single-use and must match", () => {
  const session = {};
  const state = createRandomToken();
  saveOAuthTransaction(session, "test", { state, verifier: "abc" });
  assert.equal(consumeOAuthTransaction(session, "test", state).verifier, "abc");
  assert.throws(() => consumeOAuthTransaction(session, "test", state), /Invalid OAuth state/);
});

test("OAuth state rejects mismatched and expired transactions", () => {
  const session = {};
  saveOAuthTransaction(session, "test", { state: "correct" });
  assert.throws(() => consumeOAuthTransaction(session, "test", "wrong"), /Invalid OAuth state/);

  saveOAuthTransaction(session, "test", { state: "expired" });
  session.oauth.test.createdAt = Date.now() - 11 * 60 * 1000;
  assert.throws(() => consumeOAuthTransaction(session, "test", "expired"), /expired/);
});

test("PKCE challenge is a base64url SHA-256 digest", () => {
  assert.match(createPkceChallenge("test-verifier"), /^[A-Za-z0-9_-]{43}$/);
});

test("configuration requires bot settings and validates production Keycloak HTTPS", () => {
  const env = {
    NODE_ENV: "production",
    APP_BASE_URL: "https://discord.example.com",
    SESSION_SECRET: "a".repeat(40),
    DB_HOST: "db", DB_NAME: "discord_auth", DB_USER: "app", DB_PASSWORD: "secret",
    KEYCLOAK_ISSUER_URL: "http://keycloak/realms/OMD",
    KEYCLOAK_CLIENT_ID: "client", KEYCLOAK_CLIENT_SECRET: "secret",
    KEYCLOAK_REDIRECT_URI: "https://discord.example.com/auth/keycloak/callback",
    DISCORD_CLIENT_ID: "client", DISCORD_CLIENT_SECRET: "secret",
    DISCORD_REDIRECT_URI: "https://discord.example.com/auth/discord/callback",
    DISCORD_BOT_TOKEN: "bot-token",
    DISCORD_GUILD_ID: "guild-id",
    DISCORD_VERIFIED_ROLE_ID: "verified-role-id",
    DISCORD_VERIFY_CHANNEL_ID: "1572537106570682529"
  };
  assert.throws(() => loadConfig(env), /must use HTTPS/);
  assert.throws(() => loadConfig({ ...env, KEYCLOAK_ISSUER_URL: undefined }), /Missing required/);
});
