const form = document.querySelector("#login-form");
const button = document.querySelector("#login-button");
const message = document.querySelector("#message");
const result = document.querySelector("#result");
const steps = Array.from(document.querySelectorAll("#timeline li"));

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

function randomHex(bytes) {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

function createTraceparent() {
  return `00-${randomHex(16)}-${randomHex(8)}-01`;
}

function setStep(index, state, text) {
  steps[index].dataset.state = state;
  if (text) {
    steps[index].querySelector("p").textContent = text;
  }
}

function resetTimeline() {
  setStep(0, "idle", "Waiting for login click.");
  setStep(1, "idle", "Checks credentials and writes audit row.");
  setStep(2, "idle", "Loads profile data from PostgreSQL.");
  setStep(3, "idle", "Trace, metrics, and logs become available.");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  resetTimeline();
  result.hidden = true;
  message.className = "message";
  message.textContent = "Sending login request...";
  button.disabled = true;

  const traceparent = createTraceparent();
  const correlationId = crypto.randomUUID();
  const headers = {
    "content-type": "application/json",
    "traceparent": traceparent,
    "x-correlation-id": correlationId,
  };

  try {
    setStep(0, "running", "Click captured and sent with W3C trace context.");
    await fetch("/api/auth/ui-event", {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "login.click", correlation_id: correlationId }),
    });
    setStep(0, "done", `Correlation id: ${correlationId}`);

    setStep(1, "running", "Auth service is checking credentials.");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: document.querySelector("#email").value,
        password: document.querySelector("#password").value,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.detail || "Login failed");
    }

    setStep(1, "done", `Auth completed in ${payload.timings_ms.total_ms} ms.`);
    setStep(2, "done", `Profile service took ${payload.timings_ms.profile_service_ms} ms.`);
    setStep(3, "done", `Trace id: ${payload.trace_id}`);

    message.className = "message success";
    message.textContent = `Welcome, ${payload.user.display_name}.`;
    result.hidden = false;
    result.innerHTML = `
      <strong>Trace ready</strong><br />
      Open Grafana and search Tempo for trace id
      <code>${payload.trace_id}</code>.
    `;
  } catch (error) {
    const active = steps.findIndex((step) => step.dataset.state === "running");
    if (active >= 0) {
      setStep(active, "error", error.message);
    }
    message.className = "message error";
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
