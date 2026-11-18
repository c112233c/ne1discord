import { createRandomToken, saveOAuthTransaction, consumeOAuthTransaction } from "./oauth-state.service.js";

const DISCORD_API = "https://discord.com/api/v10";

export function createDiscordAuthorizationUrl(config, session) {
  const state = createRandomToken();
  saveOAuthTransaction(session, "discord", { state });
  const url = new URL("https://discord.com/oauth2/authorize");
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUri,
    response_type: "code", scope: config.scopes, state
  }).toString();
  return url.toString();
}

export async function completeDiscordLogin(config, session, code, state) {
  consumeOAuthTransaction(session, "discord", state);

  const tokenResponse = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      client_id: config.clientId, client_secret: config.clientSecret,
      grant_type: "authorization_code", code, redirect_uri: config.redirectUri
    }),
    signal: AbortSignal.timeout(10000)
  });
  const tokens = await tokenResponse.json();
  if (!tokenResponse.ok) {
    throw new Error(`Discord token exchange failed: ${tokens.error_description || tokens.error || tokenResponse.status}`);
  }
  if (!tokens.access_token) throw new Error("Discord response did not include an access token");

  const userResponse = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { authorization: `Bearer ${tokens.access_token}`, accept: "application/json" },
    signal: AbortSignal.timeout(10000)
  });
  const user = await userResponse.json();
  if (!userResponse.ok) throw new Error(`Discord user lookup failed: HTTP ${userResponse.status}`);
  if (!user.id) throw new Error("Discord user response is missing ID");

  return {
    id: user.id, username: user.username,
    globalName: user.global_name ?? null, avatar: user.avatar ?? null
  };
}
