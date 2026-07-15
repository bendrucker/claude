<script setup lang="ts">
import { ChevronDown, Search } from "lucide-vue-next";
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch } from "vue";
import type { CatalogPlugin } from "../data/catalog";
import { type SearchRecord, search } from "../lib/search-index";
import { SORT_KEYS, type SortKey, sortLabel } from "../lib/sort";
import PluginCard from "./PluginCard.vue";

const props = defineProps<{
  plugins: CatalogPlugin[];
  records: SearchRecord[];
  categories: string[];
}>();

const query = ref("");
const category = ref("");
const sortIndex = ref(0);
const searchInput = useTemplateRef<HTMLInputElement>("searchInput");
const grid = useTemplateRef<HTMLUListElement>("grid");

const sortKey = computed<SortKey>(() => SORT_KEYS[sortIndex.value] ?? "name");

const matches = computed(() => search(props.records, query.value));

const matchedPlugins = computed(() => new Set(matches.value.map((m) => m.record.pluginName)));

const matchedSkillsByPlugin = computed(() => {
  const byPlugin = new Map<string, string[]>();
  for (const { record } of matches.value) {
    if (record.type !== "skill") continue;
    const list = byPlugin.get(record.pluginName) ?? [];
    list.push(record.name);
    byPlugin.set(record.pluginName, list);
  }
  return byPlugin;
});

function updatedAt(plugin: CatalogPlugin): string {
  return plugin.history?.lastCommit ?? plugin.history?.firstCommit ?? "";
}

const visible = computed(() => {
  const hasQuery = query.value.trim().length > 0;
  const filtered = props.plugins.filter((plugin) => {
    const matchesQuery = !hasQuery || matchedPlugins.value.has(plugin.name);
    const matchesCategory = !category.value || plugin.category === category.value;
    return matchesQuery && matchesCategory;
  });

  return [...filtered].sort((a, b) => {
    if (sortKey.value === "category") {
      return (a.category ?? "").localeCompare(b.category ?? "") || a.name.localeCompare(b.name);
    }
    if (sortKey.value === "updated") {
      return updatedAt(b).localeCompare(updatedAt(a));
    }
    return a.name.localeCompare(b.name);
  });
});

const countLabel = computed(
  () => `${visible.value.length} plugin${visible.value.length === 1 ? "" : "s"}`,
);

function cycleSort() {
  sortIndex.value = (sortIndex.value + 1) % SORT_KEYS.length;
}

function moveFocus(delta: number) {
  const links = [...(grid.value?.querySelectorAll<HTMLAnchorElement>("[data-plugin-nav]") ?? [])];
  if (links.length === 0) return;
  const current = links.findIndex((link) => link === document.activeElement);
  const next = Math.min(Math.max(current + delta, 0), links.length - 1);
  links[next]?.focus();
}

function onKeydown(event: KeyboardEvent) {
  // The plugin and help dialogs own the keyboard while either is open.
  if (document.querySelector("dialog[open]")) return;

  const active = document.activeElement;
  const isTyping =
    active instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);

  if (event.key === "/" && !isTyping) {
    event.preventDefault();
    searchInput.value?.focus();
    return;
  }
  if (isTyping) {
    if (event.key === "Escape" && active instanceof HTMLElement) active.blur();
    return;
  }

  if (event.key === "j" || event.key === "ArrowDown") {
    event.preventDefault();
    moveFocus(1);
  } else if (event.key === "k" || event.key === "ArrowUp") {
    event.preventDefault();
    moveFocus(-1);
  } else if (event.key === "s") {
    cycleSort();
  }
}

// Sort and filter refine the current view rather than navigate, so they replace
// the entry instead of pushing a new one.
function syncUrl() {
  const params = new URLSearchParams(location.search);
  const setOrDelete = (key: string, value: string) =>
    value ? params.set(key, value) : params.delete(key);

  setOrDelete("q", query.value.trim());
  setOrDelete("category", category.value);
  setOrDelete("sort", sortKey.value === "name" ? "" : sortKey.value);

  const qs = params.toString();
  history.replaceState(history.state, "", qs ? `${location.pathname}?${qs}` : location.pathname);
}

onMounted(() => {
  const initial = new URLSearchParams(location.search);
  query.value = initial.get("q") ?? "";
  category.value = initial.get("category") ?? "";
  const initialSort = initial.get("sort");
  if (initialSort && (SORT_KEYS as string[]).includes(initialSort)) {
    sortIndex.value = SORT_KEYS.indexOf(initialSort as SortKey);
  }

  watch([query, category, sortKey], syncUrl);
  document.addEventListener("keydown", onKeydown);
});

onUnmounted(() => document.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div>
    <div class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div class="relative flex-1">
        <Search
          class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          aria-hidden="true"
        />
        <input
          ref="searchInput"
          v-model="query"
          type="search"
          aria-label="Search plugins and skills"
          placeholder="Search plugins and skills (press /)"
          class="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm outline-none focus-visible:border-accent"
        />
      </div>
      <div class="relative">
        <select
          v-model="category"
          aria-label="Filter by category"
          class="h-9 w-full appearance-none rounded-md border border-border bg-surface pl-3 pr-8 text-sm outline-none focus-visible:border-accent"
        >
          <option value="">All categories</option>
          <option v-for="name in categories" :key="name" :value="name">{{ name }}</option>
        </select>
        <ChevronDown
          class="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          aria-hidden="true"
        />
      </div>
      <button
        type="button"
        class="grid h-9 shrink-0 rounded-md border border-border bg-surface px-3 text-sm outline-none focus-visible:border-accent"
        @click="cycleSort"
      >
        <!-- Every label shares one grid cell, so the button is as wide as the
             longest and cycling sorts cannot resize the row. -->
        <span
          v-for="key in SORT_KEYS"
          :key="key"
          class="invisible col-start-1 row-start-1 self-center whitespace-nowrap"
          aria-hidden="true"
          >{{ sortLabel(key) }}</span
        >
        <span class="col-start-1 row-start-1 self-center whitespace-nowrap">{{
          sortLabel(sortKey)
        }}</span>
      </button>
    </div>

    <p class="mb-3 text-xs text-muted" aria-live="polite">{{ countLabel }}</p>

    <ul ref="grid" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <PluginCard
        v-for="plugin in visible"
        :key="plugin.name"
        :plugin="plugin"
        :matched-skills="matchedSkillsByPlugin.get(plugin.name) ?? []"
      />
    </ul>

    <p v-if="visible.length === 0" class="py-16 text-center text-sm text-muted">
      No plugins match your search.
    </p>
  </div>
</template>
