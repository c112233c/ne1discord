const identity = document.querySelector("#identity");
const status = document.querySelector("#status");
const accounts = document.querySelector("#accounts");
const button = document.querySelector("#verify");
const message = document.querySelector("#message");
let csrfToken = "";

function showMessage(text, kind = "info") {
  message.textContent = text;
  message.className = kind;
}

function field(label, value) {
  const wrapper = document.createElement("div");
  wrapper.className = "item";
  const small = document.createElement("small");
  small.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = value || "—";
  wrapper.append(small, strong);
  identity.append(wrapper);
}

async function load() {
  const response = await fetch("/api/binding", { credentials: "same-origin", cache: "no-store" });
  if (response.status === 401) {
    showMessage("Please sign in first.", "error");
    const login = document.createElement("a");
    login.href = "/auth/keycloak";
    login.textContent = "Login with Keycloak";
    status.replaceChildren(login);
    button.hidden = true;
    return;
  }
  if (!response.ok) throw new Error("Unable to load account information.");

  const data = await response.json();
  csrfToken = data.csrfToken;
  field("Employee ID", data.identity.userId);
  field("Name", data.identity.name);
  field("Department", data.identity.departmentName);
  field("Discord", data.identity.discordUsername);
  field("Discord ID", data.identity.discordId);

  if (data.binding.status === "active" && data.binding.accessStatus === "verified") {
    status.textContent = "These accounts are linked and verified.";
    showMessage("Discord nickname and roles are synchronized.", "success");
    button.hidden = true;
  } else if (data.binding.status === "active") {
    status.textContent = "These accounts are linked, but Discord synchronization is pending.";
    showMessage("Access is restricted. Retry Verify to synchronize your Discord profile and roles.", "info");
    button.hidden = false;
    button.disabled = false;
    button.textContent = "Retry Synchronization";
  } else if (data.binding.status === "conflict") {
    status.textContent = "This Discord account cannot be linked.";
    showMessage("This Discord account is already linked to another organization account. Contact an administrator.", "error");
    button.hidden = true;
  } else {
    status.textContent = "No active binding found for this Discord account.";
    button.disabled = false;
    button.textContent = "Verify Account";
  }

  if (data.binding.linkedAccounts.length) {
    const heading = document.createElement("h3");
    heading.textContent = "Your linked Discord accounts";
    const list = document.createElement("ul");
    for (const account of data.binding.linkedAccounts) {
      const item = document.createElement("li");
      item.textContent = account.discordUsername + " (" + account.discordId + ")";
      list.append(item);
    }
    accounts.append(heading, list);
  }
}

button.addEventListener("click", async () => {
  if (!confirm("Confirm that this Discord account belongs to you and link it to your organization account?")) return;
  button.disabled = true;
  try {
    const response = await fetch("/api/binding/verify", {
      method: "POST",
      credentials: "same-origin",
      headers: { "x-csrf-token": csrfToken, "content-type": "application/json" },
      body: "{}"
    });
    const result = await response.json();
    if (response.status === 409) {
      showMessage(result.message || "This Discord account is already linked to another account.", "error");
      return;
    }
    if (!response.ok) {
      showMessage(result.message || "Unable to complete account binding.", "error");
      button.disabled = false;
      return;
    }
    showMessage(result.message, "success");
    status.textContent = "Account binding active · Discord access verified.";
    button.hidden = true;
  } catch (error) {
    showMessage(error.message, "error");
    button.disabled = false;
  }
});

load().catch(error => showMessage(error.message, "error"));
