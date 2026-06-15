const fields = {
  users: document.querySelector("#users"),
  successfulLogins: document.querySelector("#successful-logins"),
  failedLogins: document.querySelector("#failed-logins"),
  avgLogin: document.querySelector("#avg-login"),
  lastLogin: document.querySelector("#last-login"),
  status: document.querySelector("#status"),
};

const frontendTelemetry = (() => {
  let clsScore = 0;
  let lcpMs = null;
  let inpMs = 0;
  let tbtMs = 0;
  const jsErrors = [];

  function observe(type, callback) {
    if (!("PerformanceObserver" in window)) {
      return;
    }
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(callback)).observe({
        type,
        buffered: true,
      });
    } catch {
      // Some browsers do not support every performance entry type.
    }
  }

  observe("layout-shift", (entry) => {
    if (!entry.hadRecentInput) {
      clsScore += entry.value;
    }
  });
  observe("largest-contentful-paint", (entry) => {
    lcpMs = entry.startTime;
  });
  observe("longtask", (entry) => {
    tbtMs += Math.max(entry.duration - 50, 0);
  });
  observe("event", (entry) => {
    inpMs = Math.max(inpMs, entry.duration || 0);
  });

  function paint(name) {
    return performance.getEntriesByType("paint").find((entry) => entry.name === name)
      ?.startTime;
  }

  function resourceType(entry) {
    const name = entry.name.toLowerCase();
    if (entry.initiatorType === "script" || name.endsWith(".js")) return "script";
    if (entry.initiatorType === "link" || name.endsWith(".css")) return "css";
    if (entry.initiatorType === "img" || /\.(png|jpe?g|gif|webp|svg)$/.test(name)) {
      return "image";
    }
    return entry.initiatorType || "other";
  }

  function payload() {
    const nav = performance.getEntriesByType("navigation")[0];
    const now = performance.now();
    const loadEnd = nav?.loadEventEnd > 0 ? nav.loadEventEnd : now;
    const requestStart = nav?.requestStart || 0;
    const responseStart = nav?.responseStart || 0;
    const resources = performance
      .getEntriesByType("resource")
      .filter((entry) => entry.duration > 0)
      .slice(-30)
      .map((entry) => ({
        resource_type: resourceType(entry),
        duration_ms: entry.duration,
      }));

    return {
      route: window.location.pathname || "/",
      fp_ms: paint("first-paint") ?? null,
      fcp_ms: paint("first-contentful-paint") ?? null,
      lcp_ms: lcpMs,
      tti_ms: nav?.domInteractive || loadEnd,
      tbt_ms: tbtMs,
      cls_score: clsScore,
      inp_ms: inpMs,
      ttfb_ms: responseStart && requestStart ? responseStart - requestStart : null,
      page_load_ms: loadEnd,
      resource_timings: resources,
      js_errors: jsErrors.splice(0, jsErrors.length),
    };
  }

  function send() {
    const body = JSON.stringify(payload());
    const headers = {
      "content-type": "application/json",
      "x-correlation-id": crypto.randomUUID(),
    };
    fetch("/api/auth/frontend-metrics", {
      method: "POST",
      headers,
      body,
      keepalive: true,
    }).catch(() => {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/auth/frontend-metrics",
          new Blob([body], { type: "application/json" }),
        );
      }
    });
  }

  window.addEventListener("error", () => {
    jsErrors.push({ type: "runtime", count: 1 });
    send();
  });
  window.addEventListener("unhandledrejection", () => {
    jsErrors.push({ type: "promise", count: 1 });
    send();
  });
  window.addEventListener("load", () => setTimeout(send, 1200));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      send();
    }
  });

  return { send };
})();

async function refresh() {
  try {
    const response = await fetch("/api/auth/admin/stats");
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    const stats = await response.json();
    fields.users.textContent = stats.users;
    fields.successfulLogins.textContent = stats.successful_logins;
    fields.failedLogins.textContent = stats.failed_logins;
    fields.avgLogin.textContent = `${stats.avg_login_ms} ms`;
    fields.lastLogin.textContent = stats.last_login_at
      ? `Last login audit row was written at ${new Date(stats.last_login_at).toLocaleString()}.`
      : "No login audit rows have been written yet.";
    fields.status.textContent = `Updated at ${new Date().toLocaleTimeString()}.`;
  } catch (error) {
    fields.status.textContent = `Unable to refresh admin stats: ${error.message}`;
  }
}

refresh();
setInterval(refresh, 5000);
