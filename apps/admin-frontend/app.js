const fields = {
  users: document.querySelector("#users"),
  successfulLogins: document.querySelector("#successful-logins"),
  failedLogins: document.querySelector("#failed-logins"),
  avgLogin: document.querySelector("#avg-login"),
  lastLogin: document.querySelector("#last-login"),
  status: document.querySelector("#status"),
};

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

