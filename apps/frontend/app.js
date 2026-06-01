const form = document.querySelector("#login-form");
const button = document.querySelector("#login-button");
const message = document.querySelector("#message");
const result = document.querySelector("#result");
const steps = Array.from(document.querySelectorAll("#timeline li"));

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

