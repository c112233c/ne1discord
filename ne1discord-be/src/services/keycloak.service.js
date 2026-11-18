import { createRemoteJWKSet, jwtVerify } from "jose";
import { createPkceChallenge, createRandomToken, saveOAuthTransaction, consumeOAuthTransaction } from "./oauth-state.service.js";

const DISCOVERY_TTL_MS = 5 * 60 * 1000;
let discoveryCache;

async function getProviderConfig(issuerUrl) {
  if (discoveryCache?.issuerUrl === issuerUrl && Date.now() - discoveryCache.loadedAt < DISCOVERY_TTL_MS) {
    return discoveryCache.document;
  }

  const response = await fetch(`${issuerUrl}/.well-known/openid-configuration`, {
    headers: { accept: "application/json" }, signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Keycloak discovery failed: HTTP ${response.status}`);

  const document = await response.json();
  if (document.issuer !== issuerUrl) throw new Error("Keycloak discovery issuer does not match configured issuer URL");
  if (!document.authorization_endpoint || !document.token_endpoint || !document.jwks_uri) {
    throw new Error("Keycloak discovery document is missing required endpoints");
  }
  discoveryCache = { issuerUrl, loadedAt: Date.now(), document };
  return document;
}

export async function createKeycloakAuthorizationUrl(config, session) {
  const provider = await getProviderConfig(config.issuerUrl);
  const state = createRandomToken();
  const nonce = createRandomToken();
  const codeVerifier = createRandomToken(48);
  saveOAuthTransaction(session, "keycloak", { state, nonce, codeVerifier });

  const url = new URL(provider.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code",
    scope: config.scopes, state, nonce,
    code_challenge: createPkceChallenge(codeVerifier), code_challenge_method: "S256"
  }).toString();
  return url.toString();
}

export async function completeKeycloakLogin(config, session, code, state) {
  const transaction = consumeOAuthTransaction(session, "keycloak", state);
  const provider = await getProviderConfig(config.issuerUrl);

  const tokenResponse = await fetch(provider.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code", client_id: config.clientId,
      client_secret: config.clientSecret, code, redirect_uri: config.redirectUri,
      code_verifier: transaction.codeVerifier
    }),
    signal: AbortSignal.timeout(10000)
  });
  const tokens = await tokenResponse.json();
  if (!tokenResponse.ok) {
    throw new Error(`Keycloak token exchange failed: ${tokens.error_description || tokens.error || tokenResponse.status}`);
  }
  if (!tokens.id_token) throw new Error("Keycloak response did not include an ID token");

  const jwks = createRemoteJWKSet(new URL(provider.jwks_uri));
  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer: config.issuerUrl, audience: config.clientId, clockTolerance: 5
  });
  if (payload.nonce !== transaction.nonce) throw new Error("Keycloak ID token nonce mismatch");
  if (!payload.sub) throw new Error("Keycloak ID token is missing subject");

  let userInfo = {};
  if (provider.userinfo_endpoint && tokens.access_token) {
    const response = await fetch(provider.userinfo_endpoint, {
      headers: { authorization: `Bearer ${tokens.access_token}`, accept: "application/json" },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`Keycloak userinfo failed: HTTP ${response.status}`);
    userInfo = await response.json();
    if (userInfo.sub !== payload.sub) throw new Error("Keycloak userinfo subject mismatch");
  }

  const claims = { ...payload, ...userInfo };
  const displayName = claims.user_name ?? ([claims.given_name, claims.family_name].filter(Boolean).join(" ") || null);
  return {
    sub: payload.sub,
    userId: claims.user_id ?? claims.userId ?? null,
    name: displayName,
    departmentName: claims.departname ?? claims.department ?? null,
    email: claims.email ?? null,
    username: claims.preferred_username ?? null
  };
}
