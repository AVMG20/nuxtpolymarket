<script setup lang="ts">
import type { HudItem } from './engine/types'
import { hex } from './riftborn-ui'

const props = withDefaults(defineProps<{
  item: HudItem
  size?: 'sm' | 'md' | 'lg'
}>(), {
  size: 'md'
})

const color = computed(() => props.item.evolved ? '#ffc54d' : hex(props.item.color))
const pips = computed(() => Math.min(props.item.maxLevel, 8))
</script>

<template>
  <div class="rb-item" :class="[size, { evolved: item.evolved }]" :style="{ '--c': color }" :title="`${item.name} · Lv ${item.level}`">
    <div class="rb-item-icon">
      <UIcon :name="item.icon" class="rb-item-glyph" />
    </div>
    <div v-if="!item.evolved" class="rb-item-pips">
      <span v-for="n in pips" :key="n" :class="{ on: n <= item.level }" />
    </div>
    <div v-else class="rb-item-evo">EVO</div>
  </div>
</template>

<style scoped>
.rb-item {
  --c: #fff;
  --s: 34px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  width: var(--s);
}
.rb-item.sm { --s: 26px; }
.rb-item.lg { --s: 44px; }
.rb-item-icon {
  position: relative;
  display: grid;
  place-items: center;
  width: var(--s);
  height: var(--s);
  border-radius: 9px;
  color: var(--c);
  background: radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--c) 30%, #0a0614), #0a0614 80%);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 45%, transparent), 0 2px 8px rgba(0, 0, 0, 0.6);
}
.rb-item-glyph {
  width: 55%;
  height: 55%;
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--c) 80%, transparent));
}
.rb-item.evolved .rb-item-icon {
  box-shadow: inset 0 0 0 1.5px #ffc54d, 0 0 12px rgba(255, 197, 77, 0.6);
  animation: rb-evo 1.8s ease-in-out infinite;
}
.rb-item.evolved .rb-item-icon::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 11px;
  background: conic-gradient(from var(--rb-evo-a, 0deg), transparent 0 75%, #fff4c2 88%, transparent);
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
  padding: 2px;
  animation: rb-evo-spin 2.2s linear infinite;
}
@property --rb-evo-a {
  syntax: '<angle>';
  inherits: false;
  initial-value: 0deg;
}
@keyframes rb-evo-spin {
  to { --rb-evo-a: 360deg; }
}
@keyframes rb-evo {
  50% { box-shadow: inset 0 0 0 1.5px #ffe08a, 0 0 20px rgba(255, 197, 77, 0.9); }
}
.rb-item-pips {
  display: flex;
  justify-content: center;
  gap: 2px;
  width: 100%;
}
.rb-item-pips span {
  flex: 1;
  max-width: 5px;
  height: 3px;
  border-radius: 1px;
  background: rgba(255, 255, 255, 0.15);
}
.rb-item-pips span.on {
  background: var(--c);
  box-shadow: 0 0 4px var(--c);
}
.rb-item-evo {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 8px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.14em;
  color: #ffc54d;
  text-shadow: 0 0 6px rgba(255, 197, 77, 0.8);
}
</style>
