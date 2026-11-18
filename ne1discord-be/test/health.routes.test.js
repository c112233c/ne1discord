import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createHealthRouter } from "../src/routes/health.routes.js";

async function withServer(database, run) {
  const app = express();
  app.use(createHealthRouter(database));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("liveness does not depend on database availability", async () => {
  await withServer({ async query() { throw new Error("database down"); } }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/live`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "ok");
  });
});

test("readiness and health return 503 when database is unavailable", async () => {
  await withServer({ async query() { throw new Error("database down"); } }, async (baseUrl) => {
    for (const path of ["/ready", "/health"]) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 503);
      assert.equal((await response.json()).database, "unavailable");
    }
  });
});
