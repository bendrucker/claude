import { relativeTime } from "../lib/relative-time";
import { type SearchRecord, search } from "../lib/search-index";

type SortKey = "name" | "category" | "updated";
const SORT_KEYS: SortKey[] = ["name", "category", "updated"];
const SORT_LABELS: Record<SortKey, string> = {
  name: "Name",
  category: "Category",
  updated: "Recently updated",
};

type NavState = { view: "plugin"; name: string } | { view: "index" };

function upgradeRelativeTimes(): void {
  for (const el of document.querySelectorAll<HTMLTimeElement>("time[data-relative]")) {
    const iso = el.getAttribute("datetime");
    if (iso) el.textContent = relativeTime(iso);
  }
}

function readSearchIndex(): SearchRecord[] {
  const el = document.getElementById("search-index-data");
  if (!el?.textContent) return [];
  return JSON.parse(el.textContent) as SearchRecord[];
}

interface FilterHandle {
  searchInput: HTMLInputElement;
  cardLinks: () => HTMLAnchorElement[];
  cycleSort: () => void;
}

function initFilters(records: SearchRecord[]): FilterHandle | undefined {
  const grid = document.getElementById("plugin-grid");
  const searchInput = document.querySelector<HTMLInputElement>("#search-input");
  const categorySelect = document.querySelector<HTMLSelectElement>("#category-filter");
  const sortButton = document.querySelector<HTMLButtonElement>("#sort-button");
  const resultCount = document.getElementById("result-count");
  const emptyState = document.getElementById("empty-state");
  if (!grid || !searchInput || !categorySelect || !sortButton) return undefined;

  const cards = [...grid.querySelectorAll<HTMLLIElement>("[data-plugin-card]")];
  let sortIndex = 0;
  const currentSort = () => SORT_KEYS[sortIndex] ?? "name";

  function apply() {
    const query = searchInput?.value.trim().toLowerCase() ?? "";
    const category = categorySelect?.value ?? "";
    const matches = query ? search(records, query) : [];
    const matchedSkillsByPlugin = new Map<string, string[]>();
    const matchedPlugins = new Set<string>();
    for (const { record } of matches) {
      matchedPlugins.add(record.pluginName);
      if (record.type === "skill") {
        const list = matchedSkillsByPlugin.get(record.pluginName) ?? [];
        list.push(record.name);
        matchedSkillsByPlugin.set(record.pluginName, list);
      }
    }

    let visible = 0;
    for (const card of cards) {
      const name = card.dataset.name ?? "";
      const cat = card.dataset.category ?? "";
      const matchesQuery = !query || matchedPlugins.has(name);
      const matchesCategory = !category || cat === category;
      const show = matchesQuery && matchesCategory;
      card.classList.toggle("hidden", !show);
      if (show) visible++;

      const note = card.querySelector<HTMLElement>("[data-match-note]");
      const matchedSkills = matchedSkillsByPlugin.get(name);
      if (note) {
        if (matchedSkills && matchedSkills.length > 0) {
          note.textContent = `Matched: ${matchedSkills.join(", ")}`;
          note.classList.remove("hidden");
        } else {
          note.classList.add("hidden");
        }
      }
    }

    const sortKey = currentSort();
    const sorted = [...cards].sort((a, b) => {
      if (sortKey === "category") {
        return (
          (a.dataset.category ?? "").localeCompare(b.dataset.category ?? "") ||
          (a.dataset.name ?? "").localeCompare(b.dataset.name ?? "")
        );
      }
      if (sortKey === "updated") {
        return (b.dataset.updated ?? "").localeCompare(a.dataset.updated ?? "");
      }
      return (a.dataset.name ?? "").localeCompare(b.dataset.name ?? "");
    });
    sorted.forEach((card, i) => {
      card.style.order = String(i);
    });

    if (resultCount) resultCount.textContent = `${visible} plugin${visible === 1 ? "" : "s"}`;
    if (emptyState) emptyState.classList.toggle("hidden", visible !== 0);

    const params = new URLSearchParams(location.search);
    if (query) params.set("q", query);
    else params.delete("q");
    if (category) params.set("category", category);
    else params.delete("category");
    if (sortKey !== "name") params.set("sort", sortKey);
    else params.delete("sort");
    const qs = params.toString();
    history.replaceState(history.state, "", qs ? `${location.pathname}?${qs}` : location.pathname);
  }

  const initial = new URLSearchParams(location.search);
  const initialQuery = initial.get("q");
  if (initialQuery) searchInput.value = initialQuery;
  const initialCategory = initial.get("category");
  if (initialCategory) categorySelect.value = initialCategory;
  const initialSort = initial.get("sort");
  if (initialSort && (SORT_KEYS as string[]).includes(initialSort)) {
    sortIndex = SORT_KEYS.indexOf(initialSort as SortKey);
  }
  sortButton.textContent = `Sort: ${SORT_LABELS[currentSort()]}`;

  searchInput.addEventListener("input", apply);
  categorySelect.addEventListener("change", apply);
  const cycleSort = () => {
    sortIndex = (sortIndex + 1) % SORT_KEYS.length;
    sortButton.textContent = `Sort: ${SORT_LABELS[currentSort()]}`;
    apply();
  };
  sortButton.addEventListener("click", cycleSort);

  apply();

  const cardLinks = () =>
    [...cards]
      .filter((card) => !card.classList.contains("hidden"))
      .sort((a, b) => Number(a.style.order || "0") - Number(b.style.order || "0"))
      .map((card) => card.querySelector<HTMLAnchorElement>("[data-plugin-nav]"))
      .filter((link): link is HTMLAnchorElement => link !== null);

  return { searchInput, cardLinks, cycleSort };
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

function initInstallInteractions(): void {
  document.addEventListener("click", (event) => {
    const target =
      event.target instanceof Element ? event.target.closest<HTMLElement>(".copy-button") : null;
    if (!target) return;
    const text = target.getAttribute("data-copy");
    if (!text) return;

    navigator.clipboard.writeText(text).then(() => {
      target.querySelector(".copy-icon")?.classList.add("hidden");
      target.querySelector(".check-icon")?.classList.remove("hidden");
      window.setTimeout(() => {
        target.querySelector(".copy-icon")?.classList.remove("hidden");
        target.querySelector(".check-icon")?.classList.add("hidden");
      }, 1500);
    });
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

function initKeyboard(handle: FilterHandle): void {
  const helpDialog = document.querySelector<HTMLDialogElement>("#help-dialog");
  let focusedIndex = -1;

  function moveFocus(delta: number) {
    const links = handle.cardLinks();
    if (links.length === 0) return;
    focusedIndex = Math.min(Math.max(focusedIndex + delta, 0), links.length - 1);
    links[focusedIndex]?.focus();
  }

  helpDialog?.addEventListener("click", (event) => {
    if (event.target === helpDialog) helpDialog.close();
  });

  document.addEventListener("keydown", (event) => {
    if (helpDialog?.open) {
      if (event.key === "Escape" || event.key === "?") helpDialog.close();
      return;
    }
    if (document.querySelector("#plugin-dialog[open]")) return;

    const active = document.activeElement;
    const isTyping =
      active instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);

    if (event.key === "/" && !isTyping) {
      event.preventDefault();
      handle.searchInput.focus();
      return;
    }
    if (isTyping) {
      if (event.key === "Escape") active?.blur();
      return;
    }

    if (event.key === "j" || event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(1);
    } else if (event.key === "k" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(-1);
    } else if (event.key === "s") {
      handle.cycleSort();
    } else if (event.key === "?") {
      helpDialog?.showModal();
    }
  });
}

export function initSite(): void {
  upgradeRelativeTimes();
  initInstallInteractions();
  initModal();

  const filters = initFilters(readSearchIndex());
  if (filters) initKeyboard(filters);
}
