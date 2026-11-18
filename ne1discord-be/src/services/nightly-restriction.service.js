const DISCORD_API = "https://discord.com/api/v10";
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_HTTP_ATTEMPTS = 5;
const MAX_RECONCILIATION_ATTEMPTS = 3;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(response, payload, attempt) {
  const retryAfterValue = payload?.retry_after ?? response.headers?.get?.("retry-after");
  const retryAfter = retryAfterValue === null || retryAfterValue === undefined || retryAfterValue === "" ? Number.NaN : Number(retryAfterValue);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.min(retryAfter * 1000, 30000);
  }
  return Math.min(500 * (2 ** attempt), 8000);
}

export function createNightlyRestrictionService({
  database,
  config,
  fetchImpl = fetch,
  sleep = delay,
  logger = console
}) {
  const { botToken, guildId, verifiedRoleId } = config;
  const headers = {
    authorization: `Bot ${botToken}`,
    accept: "application/json"
  };

  async function discordRequest(path, options = {}) {
    for (let attempt = 0; attempt < MAX_HTTP_ATTEMPTS; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(`${DISCORD_API}${path}`, {
          ...options,
          headers: { ...headers, ...(options.headers || {}) },
          signal: AbortSignal.timeout(10000)
        });
      } catch (error) {
        if (attempt === MAX_HTTP_ATTEMPTS - 1) throw error;
        await sleep(Math.min(500 * (2 ** attempt), 8000));
        continue;
      }

      if (response.status === 204) return null;
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return payload;

      const error = new Error(
        `Discord API failed: HTTP ${response.status} (${payload.message || "unknown error"})`
      );
      error.status = response.status;
      error.discordCode = payload.code;

      if (!RETRYABLE_STATUSES.has(response.status) || attempt === MAX_HTTP_ATTEMPTS - 1) {
        throw error;
      }
      await sleep(retryDelay(response, payload, attempt));
    }
    throw new Error("Discord API retry attempts exhausted");
  }

  async function ensureVerifiedRoleAbsent(discordId) {
    const memberPath = `/guilds/${guildId}/members/${discordId}`;
    for (let attempt = 0; attempt < MAX_RECONCILIATION_ATTEMPTS; attempt += 1) {
      let member;
      try {
        member = await discordRequest(memberPath);
      } catch (error) {
        if (error.status === 404 && error.discordCode === 10007) return { outcome: "not_in_guild" };
        throw error;
      }

      if (!Array.isArray(member?.roles)) {
        throw new Error(`Discord member response for ${discordId} did not include a roles array`);
      }
      if (!member.roles.includes(verifiedRoleId)) return { outcome: "already_absent" };

      try {
        await discordRequest(`${memberPath}/roles/${verifiedRoleId}`, { method: "DELETE" });
      } catch (error) {
        if (error.status !== 404) throw error;
      }

      let confirmedMember;
      try {
        confirmedMember = await discordRequest(memberPath);
      } catch (error) {
        if (error.status === 404 && error.discordCode === 10007) return { outcome: "removed" };
        throw error;
      }
      if (!Array.isArray(confirmedMember?.roles)) {
        throw new Error(`Discord verification response for ${discordId} did not include a roles array`);
      }
      if (!confirmedMember.roles.includes(verifiedRoleId)) return { outcome: "removed" };
      if (attempt < MAX_RECONCILIATION_ATTEMPTS - 1) await sleep(250);
    }
    throw new Error(`Discord did not confirm removal of Verified role for ${discordId}`);
  }

  async function markBindingRestricted(binding, discordOutcome) {
    const connection = await database.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute(
        `UPDATE account_bindings
            SET access_status = 'restricted'
          WHERE id = ? AND binding_status = 'active' AND access_status <> 'restricted'`,
        [binding.id]
      );

      if (result.affectedRows === 1 || discordOutcome === "removed") {
        await connection.execute(
          `INSERT INTO account_binding_audit_logs
            (actor_keycloak_sub, actor_discord_id, action, target_discord_id, details)
           VALUES (?, ?, 'nightly_restriction', ?, ?)`,
          [
            "system:nightly-restriction",
            "system",
            binding.discord_id,
            JSON.stringify({
              reason: "multiple_active_discord_bindings",
              activeBindingCount: Number(binding.active_binding_count),
              verifiedRoleId,
              discordOutcome
            })
          ]
        );
      }
      await connection.commit();
      return result.affectedRows === 1 ? "restricted" : "already_restricted";
    } catch (error) {
      try { await connection.rollback(); } catch { /* transaction may already be closed */ }
      throw error;
    } finally {
      connection.release();
    }
  }

  async function run() {
    const [bindings] = await database.execute(
      `SELECT binding.id, binding.keycloak_sub, binding.discord_id,
              binding.access_status, duplicates.active_binding_count
         FROM account_bindings AS binding
         INNER JOIN (
           SELECT keycloak_sub, COUNT(*) AS active_binding_count
             FROM account_bindings
            WHERE binding_status = 'active'
            GROUP BY keycloak_sub
           HAVING COUNT(*) > 1
         ) AS duplicates ON duplicates.keycloak_sub = binding.keycloak_sub
        WHERE binding.binding_status = 'active'
        ORDER BY binding.keycloak_sub ASC, binding.id ASC`
    );

    const summary = {
      candidates: bindings.length,
      restricted: 0,
      alreadyRestricted: 0,
      notInGuild: 0,
      failed: 0
    };

    for (const binding of bindings) {
      try {
        const discordResult = await ensureVerifiedRoleAbsent(binding.discord_id);
        const databaseResult = await markBindingRestricted(binding, discordResult.outcome);
        if (databaseResult === "restricted") summary.restricted += 1;
        else summary.alreadyRestricted += 1;
        if (discordResult.outcome === "not_in_guild") summary.notInGuild += 1;
        logger.info?.("[nightly-restriction] account processed", {
          discordId: binding.discord_id,
          keycloakSub: binding.keycloak_sub,
          discordOutcome: discordResult.outcome,
          databaseOutcome: databaseResult
        });
      } catch (error) {
        summary.failed += 1;
        logger.error?.("[nightly-restriction] account failed", {
          discordId: binding.discord_id,
          keycloakSub: binding.keycloak_sub,
          error: error.message,
          status: error.status
        });
      }
    }

    return summary;
  }

  return { run, ensureVerifiedRoleAbsent };
}
