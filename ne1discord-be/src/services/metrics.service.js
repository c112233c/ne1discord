const counters = new Map();
const startedAt = process.hrtime.bigint();

function escapeLabel(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export function createMetricsService() {
  function middleware(req, res, next) {
    if (req.path === "/metrics") return next();
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      const route = req.route?.path
        ? `${req.baseUrl || ""}${req.route.path}`
        : "unmatched";
      const key = [req.method, route, res.statusCode].join("|");
      const current = counters.get(key) || { count: 0, durationSeconds: 0 };
      current.count += 1;
      current.durationSeconds += Number(process.hrtime.bigint() - started) / 1e9;
      counters.set(key, current);
    });
    next();
  }

  function render() {
    const lines = [
      "# HELP ne1discord_http_requests_total Total HTTP requests.",
      "# TYPE ne1discord_http_requests_total counter"
    ];
    for (const [key, value] of counters) {
      const [method, route, status] = key.split("|");
      lines.push(`ne1discord_http_requests_total{method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${status}"} ${value.count}`);
    }
    lines.push(
      "# HELP ne1discord_http_request_duration_seconds_total Total HTTP request duration in seconds.",
      "# TYPE ne1discord_http_request_duration_seconds_total counter"
    );
    for (const [key, value] of counters) {
      const [method, route, status] = key.split("|");
      lines.push(`ne1discord_http_request_duration_seconds_total{method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${status}"} ${value.durationSeconds}`);
    }
    lines.push(
      "# HELP ne1discord_process_uptime_seconds Process uptime in seconds.",
      "# TYPE ne1discord_process_uptime_seconds gauge",
      `ne1discord_process_uptime_seconds ${Number(process.hrtime.bigint() - startedAt) / 1e9}`,
      "# HELP ne1discord_process_resident_memory_bytes Process resident memory in bytes.",
      "# TYPE ne1discord_process_resident_memory_bytes gauge",
      `ne1discord_process_resident_memory_bytes ${process.memoryUsage().rss}`,
      "# HELP ne1discord_process_heap_used_bytes Process heap used in bytes.",
      "# TYPE ne1discord_process_heap_used_bytes gauge",
      `ne1discord_process_heap_used_bytes ${process.memoryUsage().heapUsed}`
    );
    return `${lines.join("\n")}\n`;
  }

  function handler(_req, res) {
    res.type("text/plain; version=0.0.4; charset=utf-8").send(render());
  }

  return { middleware, handler, render };
}
