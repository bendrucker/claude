<script setup lang="ts">
import { Bot, Github, Plug, Sparkles, Terminal, Webhook } from "lucide-vue-next";
import { computed } from "vue";
import type { CatalogPlugin } from "../data/catalog";
import { chipsFor, type ComponentIconName } from "../lib/component-types";

const props = defineProps<{ plugin: CatalogPlugin }>();

const ICONS: Record<ComponentIconName, unknown> = {
  Sparkles,
  Terminal,
  Bot,
  Webhook,
  Plug,
  Github,
};

const chips = computed(() => chipsFor(props.plugin));
</script>

<template>
  <ul class="flex flex-wrap gap-2">
    <li
      v-for="chip in chips"
      :key="chip.key"
      :title="chip.label"
      class="relative inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface-raised text-muted"
    >
      <component :is="ICONS[chip.iconName]" v-if="chip.iconName" class="h-4 w-4" aria-hidden="true" />
      <span
        v-if="chip.count !== undefined"
        aria-hidden="true"
        class="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-bg bg-accent px-1 text-[10px] font-semibold leading-none text-accent-fg tabular-nums"
      >
        {{ chip.count }}
      </span>
      <span class="sr-only">{{ chip.label }}</span>
    </li>
  </ul>
</template>
