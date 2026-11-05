import { APP } from "./config.js";

// Fills the form in the current tab when the popup asks, and tells the app
// when the owner submits it. Never presses Submit itself.

const WAIT_FOR_ANSWERS_MS = 4 * 60 * 1000;
const POLL_MS = 4000;
/** How long after Submit a page the tab loads can still be the confirmation. */
const SUBMIT_WINDOW_MS = 2 * 60 * 1000;
/** What a confirmation says, as a regular expression the pages can rebuild. */
const DONE =
  "thank you for (applying|your application)|application (has been |was )?(submitted|received|sent)|we('ve| have) received your application|successfully (submitted|applied)";

class SignedOut extends Error {}

async function api(path, body) {
  const response = await fetch(`${APP}${path}`, {
    method: body ? "POST" : "GET",
    credentials: "include",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401) throw new SignedOut();
  if (!response.ok) throw new Error(`Job Agent answered ${response.status}.`);
  return response.json();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function banner(tabId, text, tone = "info") {
  return chrome.scripting
    .executeScript({ target: { tabId }, func: showBanner, args: [text, tone] })
    .catch(() => {});
}

async function toBase64(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function fill(tabId, jobId) {
  await banner(tabId, "Job Agent is reading the form…");
  const scans = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: scanForm,
  });
  const fields = scans.flatMap(({ frameId, result }) =>
    (result ?? []).map((field) => ({
      ...field,
      key: `${frameId}:${field.key}`,
    })),
  );
  if (fields.length === 0) {
    await banner(tabId, "Job Agent found no form fields on this page.", "warn");
    return;
  }

  let plan = await api("/api/extension/fill", { jobId, fields });
  if (plan.writing) {
    await banner(
      tabId,
      "Claude is writing answers to this form's questions. It takes about a minute; keep this tab open.",
    );
    const started = Date.now();
    while (Date.now() - started < WAIT_FOR_ANSWERS_MS) {
      await sleep(POLL_MS);
      const state = await api(`/api/extension/status?jobId=${jobId}`);
      if (state.done) break;
    }
    plan = await api("/api/extension/fill", { jobId, fields });
  }

  const files = await Promise.all(
    plan.files.map(async (file) => {
      const response = await fetch(`${APP}${file.url}`, {
        credentials: "include",
      });
      if (!response.ok) return null;
      return { ...file, data: await toBase64(response) };
    }),
  );

  const frames = new Map();
  const forFrame = (key) => {
    const [frameId, local] = key.split(":");
    if (!frames.has(frameId)) {
      frames.set(frameId, { values: [], files: [], left: [] });
    }
    return { frame: frames.get(frameId), local };
  };
  for (const { key, value } of plan.values) {
    const { frame, local } = forFrame(key);
    frame.values.push({ key: local, value });
  }
  for (const file of files.filter(Boolean)) {
    const { frame, local } = forFrame(file.key);
    frame.files.push({ ...file, key: local });
  }
  for (const key of plan.left) {
    const { frame, local } = forFrame(key);
    frame.left.push(local);
  }

  const totals = { filled: 0, attached: 0, left: 0 };
  for (const [frameId, frame] of frames) {
    const [done] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [Number(frameId)] },
      func: fillForm,
      args: [frame, jobId, DONE],
    });
    totals.filled += done?.result?.filled ?? 0;
    totals.attached += done?.result?.attached ?? 0;
    totals.left += done?.result?.left ?? 0;
  }

  const parts = [
    `Filled ${totals.filled} field${totals.filled === 1 ? "" : "s"}`,
  ];
  if (totals.attached > 0) {
    parts.push(
      `attached ${totals.attached} PDF${totals.attached === 1 ? "" : "s"}`,
    );
  }
  const left =
    totals.left > 0
      ? ` ${totals.left} field${totals.left === 1 ? " is" : "s are"} outlined in amber for you.`
      : "";
  await banner(
    tabId,
    `${parts.join(" and ")}.${left} Check everything, then press Submit yourself.`,
    "done",
  );
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "fill") {
    fill(message.tabId, message.jobId).catch((error) =>
      banner(
        message.tabId,
        error instanceof SignedOut
          ? "Sign in to Job Agent in this browser, then try again."
          : `Job Agent couldn't fill the form. ${error.message ?? ""}`,
        "warn",
      ),
    );
  }
  if (message?.type === "submitting" && sender.tab?.id !== undefined) {
    // The site may send the form itself and load its confirmation as a new
    // page, which the old page's watcher doesn't live to see.
    chrome.storage.session.set({
      [`submit:${sender.tab.id}`]: {
        jobId: message.jobId,
        frameId: sender.frameId ?? 0,
        until: Date.now() + SUBMIT_WINDOW_MS,
      },
    });
  }
  if (message?.type === "submitted" && sender.tab?.id !== undefined) {
    markApplied(sender.tab.id, message.jobId);
  }
});

function markApplied(tabId, jobId) {
  chrome.storage.session.remove(`submit:${tabId}`);
  return api("/api/extension/applied", { jobId })
    .then(({ marked }) =>
      marked
        ? banner(tabId, "Marked as applied in Job Agent.", "done")
        : undefined,
    )
    .catch(() => {});
}

// After Submit, each page the form's frame (or the tab) loads is checked
// for a confirmation.
chrome.webNavigation.onCompleted.addListener(async ({ tabId, frameId }) => {
  const key = `submit:${tabId}`;
  const { [key]: pending } = await chrome.storage.session.get(key);
  if (!pending) return;
  if (Date.now() > pending.until) {
    await chrome.storage.session.remove(key);
    return;
  }
  if (frameId !== pending.frameId && frameId !== 0) return;
  const [check] = await chrome.scripting
    .executeScript({
      target: { tabId, frameIds: [frameId] },
      func: thanked,
      args: [DONE],
    })
    .catch(() => []);
  if (check?.result === true) await markApplied(tabId, pending.jobId);
});

// ---------------------------------------------------------------------------
// The functions below run inside the page, so each stands alone.
// ---------------------------------------------------------------------------

/** Reads the form's fields and remembers them for fillForm. */
function scanForm() {
  // The app's limits (lib/schemas/extension.ts).
  const MAX_FIELDS = 150;
  const MAX_OPTION = 300;
  const SKIP =
    /^(hidden|submit|button|reset|image|checkbox|password|range|color|search)$/;
  const KINDS = {
    text: "text",
    email: "email",
    tel: "tel",
    url: "url",
    number: "number",
    date: "date",
  };
  const clean = (text) =>
    (text ?? "")
      .replace(/\s+/g, " ")
      // Required-field markers: "Email *", "Full name✱", "Phone (required)".
      .replace(/(\s*([*✱]|\(required\)))+\s*$/iu, "")
      .trim()
      .slice(0, 1000);
  const textOf = (node) => {
    const copy = node.cloneNode(true);
    copy
      .querySelectorAll(
        "select, option, textarea, input, button, script, style, [aria-hidden=true]",
      )
      .forEach((child) => child.remove());
    return clean(copy.textContent);
  };
  const isField = (node) =>
    node.matches("input, textarea, select") &&
    !SKIP.test((node.getAttribute("type") ?? "").toLowerCase());
  const visible = (node) => {
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      box.width + box.height > 0
    );
  };

  /** The text around a field, from the largest box that holds no other field. */
  const nearbyText = (node, group) => {
    let best = "";
    for (
      let box = node.parentElement, depth = 0;
      box && depth < 6;
      box = box.parentElement, depth += 1
    ) {
      const others = [
        ...box.querySelectorAll("input, textarea, select"),
      ].filter((other) => isField(other) && !group.includes(other));
      if (others.length > 0) break;
      const copy = box.cloneNode(true);
      // A radio group's own choices aren't its question.
      copy.querySelectorAll("label").forEach((label) => {
        if (group.length > 1 && label.querySelector("input")) label.remove();
      });
      for (const member of group) {
        if (member.id)
          copy
            .querySelectorAll(`label[for="${CSS.escape(member.id)}"]`)
            .forEach((l) => l.remove());
      }
      const text = textOf(copy);
      if (text) best = text;
    }
    return best;
  };
  const labelOf = (node, group) => {
    const by = node.getAttribute("aria-labelledby");
    if (by) {
      const text = clean(
        by
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" "),
      );
      if (text) return text;
    }
    if (group.length > 1) {
      const legend = node.closest("fieldset")?.querySelector("legend");
      if (legend) return textOf(legend);
      const radiogroup = node.closest("[role=radiogroup]");
      const label = radiogroup?.getAttribute("aria-label");
      if (label) return clean(label);
      return nearbyText(node, group);
    }
    if (node.labels?.length) return textOf(node.labels[0]);
    if (node.getAttribute("aria-label"))
      return clean(node.getAttribute("aria-label"));
    return nearbyText(node, group) || clean(node.getAttribute("placeholder"));
  };
  const optionText = (radio) =>
    clean(
      radio.labels?.[0]?.textContent ||
        radio.getAttribute("aria-label") ||
        radio.value,
    );

  const handles = [];
  const fields = [];
  const groups = new Set();
  for (const node of document.querySelectorAll("input, textarea, select")) {
    if (fields.length >= MAX_FIELDS) break;
    if (!isField(node) || node.disabled) continue;
    const type = (node.getAttribute("type") ?? "text").toLowerCase();
    if (type !== "file" && (!visible(node) || node.readOnly)) continue;
    let kind;
    let group = [node];
    let options = [];
    if (node.tagName === "TEXTAREA") kind = "textarea";
    else if (node.tagName === "SELECT") {
      kind = "select";
      options = [...node.options]
        .filter((o) => o.value !== "" && !o.disabled)
        .map((o) => clean(o.text).slice(0, MAX_OPTION));
    } else if (type === "radio") {
      if (!node.name || groups.has(node.name)) continue;
      groups.add(node.name);
      kind = "radio";
      group = [
        ...(node.form ?? document).querySelectorAll(
          `input[type=radio][name="${CSS.escape(node.name)}"]`,
        ),
      ];
      options = group.map((radio) => optionText(radio).slice(0, MAX_OPTION));
    } else if (type === "file") kind = "file";
    else kind = KINDS[type] ?? "text";

    handles.push(group);
    fields.push({
      key: String(handles.length - 1),
      kind,
      label: labelOf(node, group),
      name: (node.name ?? "").slice(0, 200),
      autocomplete: (node.getAttribute("autocomplete") ?? "").slice(0, 100),
      options: options.slice(0, 100),
    });
  }
  window.__jobAgent = { handles };
  return fields;
}

/** Fills what scanForm found, outlines what's left, and watches for Submit. */
function fillForm(frame, jobId, done) {
  const handles = window.__jobAgent?.handles ?? [];
  const FILLED = "2px solid #2f5bd3";
  const LEFT = "2px solid #d97706";
  const mark = (node, outline) => {
    const target =
      node.type === "file" || node.type === "radio"
        ? (node.parentElement ?? node)
        : node;
    target.style.outline = outline;
    target.style.outlineOffset = "2px";
  };
  const setValue = (node, value) => {
    const proto =
      node.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : node.tagName === "SELECT"
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    node.dispatchEvent(new FocusEvent("blur"));
  };
  const same = (a, b) =>
    a.replace(/\s+/g, " ").trim().toLowerCase() ===
    b.replace(/\s+/g, " ").trim().toLowerCase();
  const optionText = (radio) =>
    radio.labels?.[0]?.textContent ||
    radio.getAttribute("aria-label") ||
    radio.value;

  let filled = 0;
  let attached = 0;
  for (const { key, value } of frame.values) {
    const group = handles[Number(key)];
    const node = group?.[0];
    if (!node) continue;
    if (node.type === "radio") {
      const choice = group.find((radio) => same(optionText(radio), value));
      if (!choice) continue;
      if (!choice.checked) choice.click();
    } else if (node.tagName === "SELECT") {
      const option = [...node.options].find((o) => same(o.text, value));
      if (!option) continue;
      setValue(node, option.value);
    } else {
      // Something the owner typed, or the site filled in, stays.
      if (node.value.trim() !== "") continue;
      setValue(node, value);
    }
    mark(node, FILLED);
    filled += 1;
  }
  for (const file of frame.files) {
    const node = handles[Number(file.key)]?.[0];
    if (!node || node.files?.length) continue;
    const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([bytes], file.filename, { type: "application/pdf" }),
    );
    node.files = transfer.files;
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    mark(node, FILLED);
    attached += 1;
  }
  let left = 0;
  for (const key of frame.left) {
    const node = handles[Number(key)]?.[0];
    if (!node) continue;
    if (node.type !== "file" && node.type !== "radio" && node.value?.trim())
      continue;
    mark(node, LEFT);
    left += 1;
  }

  if (!window.__jobAgentWatching) {
    window.__jobAgentWatching = true;
    let sent = false;
    const submitted = () => {
      if (sent) return;
      sent = true;
      chrome.runtime.sendMessage({ type: "submitted", jobId });
    };
    const DONE = new RegExp(done, "i");
    // Sites that send the form with script show a thank-you message instead,
    // here or on a new page the background checks.
    let watching = false;
    const watch = () => {
      if (watching) return;
      watching = true;
      let tries = 0;
      const timer = setInterval(() => {
        tries += 1;
        if (DONE.test(document.body?.innerText ?? "")) {
          clearInterval(timer);
          submitted();
        } else if (tries >= 30) {
          clearInterval(timer);
          watching = false;
        }
      }, 1000);
    };
    const attempt = () => {
      chrome.runtime.sendMessage({ type: "submitting", jobId });
      watch();
    };
    document.addEventListener(
      "submit",
      (event) =>
        setTimeout(() => {
          if (event.defaultPrevented) attempt();
          else submitted();
        }, 0),
      true,
    );
    document.addEventListener(
      "click",
      (event) => {
        const button = event.target.closest?.(
          "button, input[type=submit], input[type=button], [role=button]",
        );
        const text = (button?.textContent || button?.value || "").trim();
        if (button && /^(submit|apply|send)\b/i.test(text)) attempt();
      },
      true,
    );
  }
  return { filled, attached, left };
}

/** Whether the page says the application went through, once it has rendered. */
async function thanked(done) {
  const pattern = new RegExp(done, "i");
  for (let tries = 0; tries < 10; tries += 1) {
    if (pattern.test(document.body?.innerText ?? "")) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

/** A note pinned to the top of the page, saying what Job Agent did. */
function showBanner(text, tone) {
  const COLORS = { info: "#2f5bd3", done: "#1f7a4d", warn: "#b45309" };
  let note = document.getElementById("job-agent-banner");
  if (!note) {
    note = document.createElement("div");
    note.id = "job-agent-banner";
    note.setAttribute("role", "status");
    Object.assign(note.style, {
      position: "fixed",
      top: "12px",
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: "2147483647",
      maxWidth: "min(560px, calc(100vw - 32px))",
      padding: "10px 14px",
      borderRadius: "10px",
      color: "#fff",
      font: "500 14px/1.4 system-ui, sans-serif",
      boxShadow: "0 6px 24px rgba(0,0,0,.2)",
      cursor: "pointer",
    });
    note.title = "Click to hide";
    note.addEventListener("click", () => note.remove());
    document.documentElement.append(note);
  }
  note.style.background = COLORS[tone] ?? COLORS.info;
  note.textContent = text;
}
