import { APP } from "./config.js";

const status = document.getElementById("status");
const form = document.getElementById("fill");
const select = document.getElementById("role");
const open = document.getElementById("open");

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

function show(text, link) {
  status.textContent = text;
  form.hidden = true;
  if (link) {
    open.href = link;
    open.hidden = false;
  }
}

try {
  const response = await fetch(
    `${APP}/api/extension/roles?url=${encodeURIComponent(tab?.url ?? "")}`,
    { credentials: "include" },
  );
  if (response.status === 401) {
    show("Sign in to Job Agent in this browser, then try again.", APP);
  } else if (!response.ok) {
    show("Job Agent didn't answer. Try again in a moment.", APP);
  } else {
    const { match, roles } = await response.json();
    if (roles.length === 0) {
      show(
        "No roles to apply to yet. Job Agent picks them and writes their kits after each search.",
        `${APP}/jobs`,
      );
    } else {
      const ordered = [
        ...roles.filter((role) => role.id === match),
        ...roles.filter((role) => role.id !== match),
      ];
      for (const role of ordered) {
        const option = document.createElement("option");
        option.value = role.id;
        option.textContent = `${role.company} · ${role.title}${role.hasKit ? "" : " (no kit yet)"}`;
        select.append(option);
      }
      status.textContent = match
        ? "This is the form for:"
        : "Which role is this form for?";
      form.hidden = false;
    }
  }
} catch {
  show("Couldn't reach Job Agent. Check you're online.", APP);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  form.querySelector("button").disabled = true;
  chrome.runtime.sendMessage({
    type: "fill",
    tabId: tab.id,
    jobId: select.value,
  });
  window.close();
});
