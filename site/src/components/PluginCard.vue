<script setup lang="ts">
import { computed } from "vue";
import type { CatalogPlugin } from "../data/catalog";
import { withBase } from "../lib/base";
import ChipList from "./ChipList.vue";

const props = withDefaults(
  defineProps<{
    plugin: CatalogPlugin;
    /** Skills of this plugin that matched the active query, shown so a hit on a skill explains itself. */
    matchedSkills?: string[];
  }>(),
  { matchedSkills: () => [] },
);

const href = computed(() => withBase(props.plugin.route));
</script>

<template>
  <li class="list-none">
    <a
      :href="href"
      :data-plugin-nav="plugin.name"
      class="flex h-full flex-col rounded-lg border border-border bg-surface p-4 transition-colors hover:border-accent"
    >
      <div class="mb-1 flex items-start justify-between gap-2">
        <h3 class="font-mono text-sm font-semibold">{{ plugin.name }}</h3>
        <span
          v-if="plugin.category"
          class="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted"
        >
          {{ plugin.category }}
        </span>
      </div>
      <p v-if="plugin.description" class="mb-3 line-clamp-2 text-sm text-muted">
        {{ plugin.description }}
      </p>
      <!-- Pinned to the bottom so badges line up across a row whether a card's
           description runs to one line or two. -->
      <div class="mt-auto pt-1">
        <ChipList :plugin="plugin" />
        <p v-if="matchedSkills.length > 0" class="mt-2 text-xs text-accent">
          Matched: {{ matchedSkills.join(", ") }}
        </p>
      </div>
    </a>
  </li>
</template>
