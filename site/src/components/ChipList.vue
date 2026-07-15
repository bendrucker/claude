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
  <ul class="flex flex-wrap gap-1.5">
    <li
      v-for="chip in chips"
      :key="chip.key"
      class="inline-flex items-center gap-1 rounded-full border border-border bg-surface-raised px-2 py-0.5 text-xs text-muted"
    >
      <component
        :is="ICONS[chip.iconName]"
        v-if="chip.iconName"
        class="h-3 w-3"
        aria-hidden="true"
      />
      {{ chip.text }}
    </li>
  </ul>
</template>
