import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createMetricsService } from "../src/services/metrics.service.js";

test("metrics expose HTTP counters and process gauges in Prometheus format", () => {
  const metrics = createMetricsService();
  const req = { path: "/api/me", method: "GET", baseUrl: "", route: { path: "/api/me" } };
  const res = new EventEmitter();
  res.statusCode = 200;
  let nextCalled = false;

  metrics.middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  res.emit("finish");

  const output = metrics.render();
  assert.match(output, /ne1discord_http_requests_total\{method="GET",route="\/api\/me",status="200"\} 1/);
  assert.match(output, /ne1discord_process_uptime_seconds/);
  assert.match(output, /ne1discord_process_resident_memory_bytes/);
  assert.ok(output.includes("\n# TYPE ne1discord_http_request_duration_seconds_total"));
  assert.ok(!output.includes("\\n"));
});
