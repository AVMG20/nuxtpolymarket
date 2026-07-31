<script setup lang="ts">
const props = defineProps<{ skinId: string, name: string }>()

const design = computed(() => ({
  'warden-stone': { wall: '#64748b', roof: '#94a3b8', trim: '#cbd5e1', accent: '#06b6d4', shape: 'classic' },
  'ember-court': { wall: '#7f1d1d', roof: '#1c1917', trim: '#fb923c', accent: '#ef4444', shape: 'forge' },
  'verdant-crown': { wall: '#047857', roof: '#065f46', trim: '#fde68a', accent: '#facc15', shape: 'garden' },
  'royal-amethyst': { wall: '#6d28d9', roof: '#2e1065', trim: '#e2e8f0', accent: '#c084fc', shape: 'crystal' },
  'sun-king': { wall: '#d97706', roof: '#facc15', trim: '#fef3c7', accent: '#2563eb', shape: 'palace' }
}[props.skinId] ?? { wall: '#64748b', roof: '#94a3b8', trim: '#cbd5e1', accent: '#06b6d4', shape: 'classic' }))
</script>

<template>
  <div class="skin-preview" :style="{ '--wall': design.wall, '--roof': design.roof, '--trim': design.trim, '--accent': design.accent }">
    <svg viewBox="0 0 260 170" role="img" :aria-label="`${name} citadel preview`">
      <ellipse cx="130" cy="148" rx="91" ry="16" fill="rgb(2 6 23 / .28)" />
      <path d="m38 121 92-47 92 47-92 47z" fill="var(--ui-color-success-600)" />
      <path d="m69 102 61-31 61 31v44l-61 22-61-22z" fill="var(--wall)" />
      <path d="m69 102 61 31v35l-61-22z" fill="color-mix(in srgb, var(--wall) 72%, black)" />
      <path d="m191 102-61 31v35l61-22z" fill="color-mix(in srgb, var(--wall) 80%, white)" />
      <path d="m69 102 61-32 61 32-61 31z" fill="var(--roof)" />
      <g fill="var(--trim)">
        <rect v-for="x in [76, 96, 116, 136, 156, 176]" :key="x" :x="x" :y="92 + Math.abs(126 - x) * .12" width="11" height="18" />
      </g>
      <g v-if="design.shape === 'forge'">
        <path d="M91 91 105 48l12 42M145 89l11-49 15 52" fill="var(--roof)" stroke="var(--accent)" stroke-width="5" />
        <path d="M102 45q8-20 15 0M154 38q10-22 17 2" fill="none" stroke="var(--accent)" stroke-width="5" />
      </g>
      <g v-else-if="design.shape === 'garden'">
        <circle cx="100" cy="70" r="22" fill="var(--roof)" /><circle cx="160" cy="70" r="22" fill="var(--roof)" />
        <path d="M130 35 146 65 130 91 114 65z" fill="var(--accent)" stroke="var(--trim)" stroke-width="3" />
      </g>
      <g v-else-if="design.shape === 'crystal'" fill="var(--accent)" stroke="var(--trim)" stroke-width="2">
        <path d="m94 90 12-56 17 56zM137 88l18-70 18 73zM113 86l18-81 17 83z" />
      </g>
      <g v-else-if="design.shape === 'palace'">
        <path d="M87 92V50h28v40M145 90V43h28v50M114 88V21h34v70" fill="var(--roof)" stroke="var(--trim)" stroke-width="4" />
        <circle cx="131" cy="19" r="10" fill="var(--accent)" />
      </g>
      <g v-else>
        <path d="M91 91V51h28v40M142 91V51h28v40M115 91V31h31v61" fill="var(--wall)" stroke="var(--trim)" stroke-width="4" />
      </g>
      <path d="M116 155v-19q14-20 28 0v19z" fill="#1e293b" stroke="var(--trim)" stroke-width="3" />
      <path d="M130 31v-22M132 12l28 11-28 10z" stroke="var(--trim)" stroke-width="3" fill="var(--accent)" />
    </svg>
  </div>
</template>

<style scoped>
.skin-preview {
  overflow: hidden;
  border-radius: .9rem;
  background:
    radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--accent) 26%, transparent), transparent 50%),
    linear-gradient(160deg, var(--ui-bg-elevated), var(--ui-bg));
}
svg { display: block; width: 100%; min-height: 11rem; }
</style>
