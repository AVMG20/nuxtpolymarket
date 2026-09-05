<script setup lang="ts">
// The loot jar sitting in the terrarium corner. Fills with the item emojis
// waiting inside; rattles when something's ready to collect.
const props = withDefaults(defineProps<{
  items: Array<{ emoji: string; quantity: number }>
  size?: number
}>(), { size: 84 })

const total = computed(() => props.items.reduce((s, i) => s + i.quantity, 0))
const hasLoot = computed(() => total.value > 0)

// Up to 7 emoji "pieces" stacked in the jar, weighted by quantity.
const pieces = computed(() => {
  const out: Array<{ emoji: string; x: number; y: number; rot: number }> = []
  const sorted = [...props.items].filter(i => i.quantity > 0).sort((a, b) => b.quantity - a.quantity)
  const slots = [[34, 66], [50, 68], [42, 56], [58, 58], [30, 54], [50, 46], [40, 44]]
  let idx = 0
  for (const item of sorted) {
    const n = Math.min(3, Math.max(1, Math.round(Math.log10(item.quantity + 1))))
    for (let k = 0; k < n && idx < slots.length; k++, idx++) {
      const [x, y] = slots[idx]!
      out.push({ emoji: item.emoji, x: x!, y: y!, rot: ((idx * 47) % 40) - 20 })
    }
  }
  return out
})
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 88 88"
    fill="none"
    aria-hidden="true"
    class="colony-lootjar"
    :class="{ 'colony-lootjar-full': hasLoot }"
  >
    <ellipse
      cx="44"
      cy="82"
      rx="24"
      ry="3.5"
      fill="black"
      fill-opacity="0.35"
    />
    <!-- jar back -->
    <path
      d="M22 24h44v44a10 10 0 0 1-10 10H32a10 10 0 0 1-10-10V24z"
      fill="var(--ui-bg)"
      fill-opacity="0.55"
    />
    <!-- pieces -->
    <text
      v-for="(p, i) in pieces"
      :key="i"
      :x="p.x"
      :y="p.y"
      text-anchor="middle"
      font-size="14"
      :transform="`rotate(${p.rot} ${p.x} ${p.y})`"
      class="colony-lootjar-piece"
      :style="{ animationDelay: `${i * 0.15}s` }"
    >{{ p.emoji }}</text>
    <!-- glass -->
    <path
      d="M22 24h44v44a10 10 0 0 1-10 10H32a10 10 0 0 1-10-10V24z"
      :stroke="hasLoot ? '#f5b342' : 'var(--ui-border)'"
      stroke-width="2"
    />
    <path
      d="M28 30v34"
      stroke="white"
      stroke-opacity="0.35"
      stroke-width="2"
      stroke-linecap="round"
    />
    <!-- cork -->
    <rect
      x="26"
      y="12"
      width="36"
      height="14"
      rx="4"
      fill="#b8895a"
    />
    <rect
      x="30"
      y="14"
      width="28"
      height="3"
      rx="1.5"
      fill="#8a5a2b"
    />
    <!-- glow when full -->
    <path
      v-if="hasLoot"
      d="M22 24h44v44a10 10 0 0 1-10 10H32a10 10 0 0 1-10-10V24z"
      fill="#f5b342"
      fill-opacity="0.12"
      class="colony-lootjar-glow"
    />
  </svg>
</template>

<style scoped>
.colony-lootjar { overflow: visible; filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.4)); transition: transform 0.15s; }
.colony-lootjar-full { animation: colony-lootjar-rattle 2.4s ease-in-out infinite; filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.4)) drop-shadow(0 0 10px rgba(245, 179, 66, 0.5)); }
.colony-lootjar-piece { animation: colony-bob 2s ease-in-out infinite; }
.colony-lootjar-glow { animation: colony-glow-pulse 1.6s ease-in-out infinite; }
@keyframes colony-lootjar-rattle {
  0%, 80%, 100% { transform: rotate(0); }
  84% { transform: rotate(-5deg); }
  88% { transform: rotate(5deg); }
  92% { transform: rotate(-4deg); }
  96% { transform: rotate(3deg); }
}
</style>
