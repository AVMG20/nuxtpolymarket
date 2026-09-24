<script setup lang="ts">
defineProps<{ bonus?: boolean }>()
</script>

<template>
  <div class="ag-logo" :class="{ 'is-bonus': bonus }" role="img" aria-label="Aether Gates">
    <svg class="ag-logo-mark" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <circle cx="32" cy="32" r="28" stroke="currentColor" stroke-width="0.7" stroke-dasharray="2 5" />
      <path d="M17 48V28a15 15 0 0 1 30 0v20M22 48V28a10 10 0 0 1 20 0v20M13 48h38M32 17v5M32 38v6M21 32h5M38 32h5" stroke="currentColor" stroke-width="1.4" />
      <path d="m32 24 2.5 5.5L40 32l-5.5 2.5L32 40l-2.5-5.5L24 32l5.5-2.5Z" fill="currentColor" />
    </svg>
    <div>
      <span class="ag-logo-word">Aether</span>
      <span class="ag-logo-sub"><i />Gates<i /></span>
    </div>
  </div>
</template>

<style scoped>
.ag-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: var(--ag-gold);
}
.ag-logo-mark {
  width: 58px;
  height: 58px;
}
.ag-logo-word {
  display: block;
  font-family: 'Cinzel', Georgia, serif;
  font-size: 42px;
  font-weight: 700;
  letter-spacing: 0.12em;
  line-height: 1.2;
}
.ag-logo-sub {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 3px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5em;
}
.ag-logo-sub i {
  width: 30px;
  height: 1px;
  background: currentColor;
  opacity: 0.35;
}
.is-bonus {
  color: var(--ag-accent);
}
@media (max-width: 600px) {
  .ag-logo-word { font-size: 30px; }
  .ag-logo-mark { width: 44px; height: 44px; }
}
</style>
