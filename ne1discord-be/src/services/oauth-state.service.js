import { createHash, randomBytes } from "node:crypto";

const STATE_TTL_MS = 10 * 60 * 1000;

export function createRandomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function createPkceChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function saveOAuthTransaction(session, provider, values) {
  session.oauth ??= {};
  session.oauth[provider] = { ...values, createdAt: Date.now() };
}

export function consumeOAuthTransaction(session, provider, receivedState) {
  const transaction = session.oauth?.[provider];
  if (session.oauth) delete session.oauth[provider];
  if (!transaction || !receivedState || transaction.state !== receivedState) {
    throw new Error("Invalid OAuth state");
  }
  if (Date.now() - transaction.createdAt > STATE_TTL_MS) throw new Error("OAuth transaction expired");
  return transaction;
}
