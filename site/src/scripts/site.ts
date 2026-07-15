import { relativeTime } from "../lib/relative-time";

type NavState = { view: "plugin"; name: string } | { view: "index" };

function upgradeRelativeTimes(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLTimeElement>("time[data-relative]")) {
    const iso = el.getAttribute("datetime");
    if (iso) el.textContent = relativeTime(iso);
  }
}

function initModal(): void {
  const dialog = document.querySelector<HTMLDialogElement>("#plugin-dialog");
  const content = document.querySelector<HTMLElement>("#plugin-dialog-content");
  if (!dialog || !content) return;

  let suppressClose = false;
  let lastFocused: HTMLElement | null = null;
  let returnHref = "";

  function templateFor(name: string) {
    return document.querySelector<HTMLTemplateElement>(
      `template[data-plugin-template="${CSS.escape(name)}"]`,
    );
  }

  function openPlugin(name: string, opts: { push: boolean; focusOrigin?: HTMLElement }) {
    if (!dialog || !content) return;
    const template = templateFor(name);
    if (!template) return;

    content.replaceChildren(template.content.cloneNode(true));
    // Template content is inert until cloned, so the page-load pass could not
    // reach these.
    upgradeRelativeTimes(content);
    const heading = content.querySelector<HTMLElement>("[id^='plugin-heading-']");
    if (heading) dialog.setAttribute("aria-labelledby", heading.id);

    if (!dialog.open) {
      lastFocused = opts.focusOrigin ?? (document.activeElement as HTMLElement | null);
      returnHref = `${location.pathname}${location.search}`;
      dialog.showModal();
    }
    content.scrollTop = 0;

    if (opts.push) {
      const href = template.dataset.href ?? "";
      const state: NavState = { view: "plugin", name };
      history.pushState(state, "", href);
    }
  }

  dialog.addEventListener("close", () => {
    if (!suppressClose) {
      const state: NavState = { view: "index" };
      history.replaceState(state, "", returnHref || location.pathname);
    }
    suppressClose = false;
    lastFocused?.focus();
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  dialog.querySelector("[data-dialog-close]")?.addEventListener("click", () => dialog.close());

  // Delegated so it also catches the cards the Vue island renders and re-renders.
  document.addEventListener("click", (event) => {
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-plugin-nav]")
        : null;
    if (!target) return;
    const name = target.getAttribute("data-plugin-nav");
    if (!name) return;
    event.preventDefault();
    openPlugin(name, { push: true, focusOrigin: target });
  });

  window.addEventListener("popstate", (event) => {
    const state = event.state as NavState | null;
    if (state?.view === "plugin") {
      openPlugin(state.name, { push: false });
    } else if (dialog.open) {
      suppressClose = true;
      dialog.close();
    }
  });
}

/**
 * Confirms a copy only once the clipboard has actually taken the text. The API
 * rejects when the page is not a secure context or the user denied
 * `clipboard-write`, and a check mark there would claim a copy that never
 * happened.
 */
async function copyToClipboard(button: HTMLElement, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }

  button.querySelector(".copy-icon")?.classList.add("hidden");
  button.querySelector(".check-icon")?.classList.remove("hidden");
  window.setTimeout(() => {
    button.querySelector(".copy-icon")?.classList.remove("hidden");
    button.querySelector(".check-icon")?.classList.add("hidden");
  }, 1500);
}

function initInstallInteractions(): void {
  document.addEventListener("click", (event) => {
    const target =
      event.target instanceof Element ? event.target.closest<HTMLElement>(".copy-button") : null;
    if (!target) return;
    const text = target.getAttribute("data-copy");
    if (!text) return;

    void copyToClipboard(target, text);
  });

  document.addEventListener("click", (event) => {
    const target =
      event.target instanceof Element ? event.target.closest<HTMLElement>(".scope-button") : null;
    const group = target?.closest(".install-cli");
    if (!target || !group) return;
    const scope = target.getAttribute("data-scope");
    if (!scope) return;

    for (const button of group.querySelectorAll<HTMLElement>(".scope-button")) {
      button.setAttribute("aria-checked", String(button === target));
    }
    for (const line of group.querySelectorAll<HTMLElement>("[data-cli-scope]")) {
      line.classList.toggle("hidden", line.getAttribute("data-cli-scope") !== scope);
    }
  });
}

/** Only opens and closes the help dialog. Search, sort, and card navigation keys belong to the PluginBrowser island. */
function initHelpDialog(): void {
  const helpDialog = document.querySelector<HTMLDialogElement>("#help-dialog");
  if (!helpDialog) return;

  helpDialog.addEventListener("click", (event) => {
    if (event.target === helpDialog) helpDialog.close();
  });

  document.addEventListener("keydown", (event) => {
    if (helpDialog.open) {
      if (event.key === "Escape" || event.key === "?") helpDialog.close();
      return;
    }
    if (event.key !== "?" || document.querySelector("dialog[open]")) return;

    const active = document.activeElement;
    const isTyping =
      active instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
    if (!isTyping) helpDialog.showModal();
  });
}

export function initSite(): void {
  upgradeRelativeTimes();
  initInstallInteractions();
  initModal();
  initHelpDialog();
}
