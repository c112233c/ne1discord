# ne1discord-be

Backend for ne1discord authentication, account binding, and Discord profile synchronization.

## Authentication flow

1. Open `GET /auth/keycloak` and authenticate against the configured Keycloak OMD realm.
2. Keycloak callback validates OAuth state, PKCE, ID-token signature, issuer, audience, and nonce; then retrieves OIDC userinfo.
3. Backend redirects to Discord OAuth2.
4. Discord callback validates OAuth state, exchanges the authorization code, and retrieves the Discord identity from Discord `/users/@me`.
5. The authenticated identities are stored in a MariaDB-backed server session.
6. Browser is redirected to `/verify` to review and link the Keycloak and Discord accounts.

## Persistent Discord verification message

On backend startup, the bot checks the configured `DISCORD_VERIFY_CHANNEL_ID` for its verification entrypoint message. If it is not found in the latest 100 channel messages, it posts one with a Link button to `APP_BASE_URL/auth/keycloak`. The message remains in the channel and is not recreated on normal restarts while it remains among those latest messages.

The bot needs View Channel, Read Message History, and Send Messages in the verification channel, in addition to its existing role-management permissions. Configure `DISCORD_VERIFY_CHANNEL_ID` with the channel ID and `APP_BASE_URL` with the public HTTPS base URL.

## Account binding and Verify

- `GET /api/binding` returns signed-in identities, active Discord accounts linked to the Keycloak subject, current binding/access status, and a session-bound CSRF token.
- `POST /api/binding/verify` uses only identities from the authenticated session; request-body identity values are ignored.
- One Keycloak subject may have multiple active Discord IDs. A Discord ID can belong to only one Keycloak subject.
- Repeating Verify for the same active binding retries Discord synchronization.
- New bindings are persisted as `access_status = 'restricted'`. Access becomes `verified` only after all Discord synchronization actions succeed.
- Verify confirms that the Discord account is a member of the configured guild, sets nickname to `user_id - name` (maximum 32 characters), creates or reuses the exact Keycloak `departname` role, adds that department role, and adds the configured `Verified` role.
- Department role names preserve the exact Keycloak `departname` value, including Thai characters. Discord role names are limited to 100 characters.
- Department roles are stored in `discord_department_roles`. A MariaDB named lock serializes creation for the same guild/department so concurrent Verify calls do not create duplicate roles when using the same database.
- Department roles are informational only. Only the `Verified` role should grant protected-channel visibility.
- If synchronization fails, the binding remains active but restricted. The Verify page offers Retry Synchronization.
- Binding and synchronization actions are written to `account_binding_audit_logs`.

## Phase 4 — Nightly restriction

The nightly restriction is a separate one-shot Node.js job. Run it with:

```powershell
npm run job:nightly-restriction
```

It selects every `active` binding whose Keycloak subject has more than one active Discord binding. The count includes bindings already marked `restricted`; it does not depend on the current Discord role state. Every Discord account in each duplicate group is processed.

For each account, the job reads the current guild member roles, removes only the configured `DISCORD_VERIFIED_ROLE_ID` when present, and reads the member again to confirm that the role is absent. A Discord account that is no longer a guild member is treated as having no guild roles. Only after Discord confirms the role is absent does the job set `access_status = 'restricted'`. A transition to restricted writes a `nightly_restriction` audit entry. Existing restricted rows are still reconciled against Discord on every run.

The job never deletes or unlinks account bindings, kicks/bans members, or removes department roles/nicknames. Discord 429 and transient 5xx/network failures are retried with bounded backoff; permanent per-account failures are logged and do not prevent processing the remaining accounts. The job exits non-zero if any account failed so Kubernetes can report/retry the Job.

The job requires `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, and `DISCORD_VERIFIED_ROLE_ID`. OAuth and session secrets are not required by the job.

## Requirements

- Node.js 22+
- MariaDB
- Keycloak OIDC confidential client in the existing OMD realm
- Discord application with OAuth2 redirect URI configured
- Discord Bot added to the target guild

## Setup (PowerShell)

```powershell
Copy-Item .env.example .env
npm install
```

Edit `.env` with actual values. Never commit `.env`.

Create the database and runtime user, then apply migrations `001_create_http_sessions.sql`, `002_create_account_bindings.sql`, and `003_create_discord_department_roles.sql` using a database administrator account. Grant the runtime user SELECT, INSERT, UPDATE, and DELETE on the application database; it also needs EXECUTE permission for MariaDB `GET_LOCK` / `RELEASE_LOCK` functions (normally available by default).

```sql
CREATE DATABASE discord_auth CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'discord_auth'@'%' IDENTIFIED BY 'use-a-strong-secret';
GRANT SELECT, INSERT, UPDATE, DELETE ON discord_auth.* TO 'discord_auth'@'%';
```

Then run:

```powershell
npm run check
npm test
npm run dev
```

Open `http://localhost:3000/auth/keycloak`. After both providers authenticate, the browser opens `http://localhost:3000/verify`.

## Environment

See `.env.example`. Callback URLs must exactly match values registered in Keycloak and Discord.

- Keycloak issuer is the realm issuer URL, e.g. `https://<host>/realms/OMD`.
- Keycloak client: enable Standard Flow and confidential client authentication.
- Discord OAuth2 scope: `identify`; users join the Discord server themselves.
- Set `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_VERIFIED_ROLE_ID`, and `DISCORD_VERIFY_CHANNEL_ID`. Inject the Bot Token from Vault/environment; never commit it.
- Bot permissions: View Channel, Read Message History, Send Messages in the verification channel, plus Manage Nicknames and Manage Roles. Its highest role must be above `Verified` and every department role it creates/manages.
- Set `TRUST_PROXY=1` only behind one trusted reverse proxy.
- Production requires HTTPS and a strong `SESSION_SECRET` (minimum 32 characters).

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Application + MariaDB health |
| GET | `/auth/keycloak` | Start Keycloak OIDC |
| GET | `/auth/keycloak/callback` | Complete Keycloak login |
| GET | `/auth/discord` | Start Discord OAuth2 after Keycloak |
| GET | `/auth/discord/callback` | Complete Discord login |
| GET | `/api/me` | Return authenticated identities |
| GET | `/verify` | Account verification page |
| GET | `/api/binding` | Binding overview + CSRF token |
| POST | `/api/binding/verify` | Bind account and synchronize Discord profile/roles |
| POST | `/auth/logout` | Destroy local session |

## Security notes

- OAuth state and PKCE verifier are stored in the server-side session.
- Sessions use MariaDB storage for multi-replica deployment.
- Binding uses only Keycloak and Discord identities from the authenticated server session.
- Verify POST requires a session-bound CSRF token and checks request Origin when provided.
- OAuth access and ID tokens are not returned to the browser or persisted in the login session.
- Provider error details and stack traces are not returned to clients.
