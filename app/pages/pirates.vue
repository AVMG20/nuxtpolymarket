<script setup lang="ts">
const route = useRoute()

const tabs = [
  { label: 'Set Sail', to: '/pirates', icon: 'i-lucide-sailboat' },
  { label: 'Armory', to: '/pirates/manage', icon: 'i-lucide-hammer' },
  { label: 'Log', to: '/pirates/history', icon: 'i-lucide-scroll-text' },
  { label: 'Almanac', to: '/pirates/wiki', icon: 'i-lucide-book-open' },
  { label: 'Legends', to: '/pirates/leaderboard', icon: 'i-lucide-trophy' }
]

const activeTab = computed(() => route.path)

useHead({
  link: [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
    { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;900&family=Pirata+One&display=swap' }
  ]
})
</script>

<template>
  <div class="pirate-theme flex min-h-full flex-col">
    <nav class="pr-nav shrink-0">
      <div class="mx-auto flex max-w-7xl items-center gap-3 px-3 sm:px-6">
        <NuxtLink to="/pirates" class="pr-brand hidden items-center gap-2 md:flex">
          <UIcon name="i-lucide-anchor" class="size-5 text-[var(--pr-gold)]" />
          <span class="pr-display text-2xl leading-none">Pirate Raid</span>
        </NuxtLink>
        <div class="flex flex-1 items-center gap-1 overflow-x-auto py-2 md:justify-end">
          <NuxtLink
            v-for="tab in tabs"
            :key="tab.to"
            :to="tab.to"
            class="pr-tab"
            :class="{ 'is-active': activeTab === tab.to }"
          >
            <UIcon :name="tab.icon" class="size-4 shrink-0" />
            <span class="hidden sm:inline">{{ tab.label }}</span>
          </NuxtLink>
        </div>
      </div>
      <div class="pr-rope" />
    </nav>

    <div class="relative flex-1 pt-6 pb-12">
      <NuxtPage />
    </div>
  </div>
</template>

<style>
/*
 * The Pirate Raid theme. Every /pirates page renders inside .pirate-theme, so
 * these classes are shared by the game, the armory, the log, the almanac and
 * the leaderboard. The palette is a fixed dark nautical one: it reads the same
 * whether the rest of the site is in light or dark mode.
 */
.pirate-theme {
  --pr-abyss: #050e17;
  --pr-deep: #0a1a27;
  --pr-sea: #0f2b3d;
  --pr-sea-2: #15394f;
  --pr-teal: #2dd4bf;
  --pr-foam: #bfeff0;
  --pr-wood: #24170f;
  --pr-wood-2: #342214;
  --pr-wood-3: #4a3120;
  --pr-brass: #c9973c;
  --pr-gold: #f3c35a;
  --pr-gold-2: #ffe29a;
  --pr-parchment: #efe0bd;
  --pr-ink: #eadfc6;
  --pr-muted: #93a8b6;
  --pr-dim: #5f7686;
  --pr-blood: #f0524f;
  --pr-emerald: #3ddc97;
  --pr-violet: #b392f0;
  --pr-sky: #6cb8ff;
  color: var(--pr-ink);
  background:
    radial-gradient(1200px 600px at 15% -10%, rgba(45, 212, 191, 0.08), transparent 60%),
    radial-gradient(900px 500px at 100% 0%, rgba(243, 195, 90, 0.07), transparent 55%),
    linear-gradient(180deg, var(--pr-deep) 0%, var(--pr-abyss) 70%);
  font-variant-numeric: tabular-nums;
}

.pirate-theme .pr-display {
  font-family: 'Pirata One', 'Cinzel', Georgia, serif;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: var(--pr-gold-2);
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.55), 0 0 22px rgba(243, 195, 90, 0.18);
}

.pirate-theme .pr-heading {
  font-family: 'Cinzel', Georgia, serif;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--pr-gold);
}

.pirate-theme .pr-muted { color: var(--pr-muted); }
.pirate-theme .pr-dim { color: var(--pr-dim); }
.pirate-theme .pr-gold { color: var(--pr-gold); }

/* ── Navigation ─────────────────────────────────────────────────────────── */
.pirate-theme .pr-nav {
  position: relative;
  background: linear-gradient(180deg, var(--pr-wood-2), var(--pr-wood));
  box-shadow: 0 10px 30px -18px rgba(0, 0, 0, 0.9);
}

.pirate-theme .pr-rope {
  height: 5px;
  background:
    repeating-linear-gradient(-55deg, #b0874a 0 5px, #6b4a26 5px 8px, #d8b073 8px 10px);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

.pirate-theme .pr-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  white-space: nowrap;
  border-radius: 0.6rem;
  padding: 0.55rem 0.9rem;
  font-family: 'Cinzel', Georgia, serif;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #c8b28c;
  transition: color 0.15s, background 0.15s, box-shadow 0.15s;
}
.pirate-theme .pr-tab:hover { color: var(--pr-gold-2); background: rgba(243, 195, 90, 0.07); }
.pirate-theme .pr-tab.is-active {
  color: #1c1208;
  background: linear-gradient(180deg, var(--pr-gold-2), var(--pr-gold) 45%, var(--pr-brass));
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5), 0 6px 16px -6px rgba(243, 195, 90, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.6);
}

/* ── Panels ─────────────────────────────────────────────────────────────── */
.pirate-theme .pr-panel {
  position: relative;
  border-radius: 0.9rem;
  border: 1px solid rgba(201, 151, 60, 0.45);
  background:
    repeating-linear-gradient(92deg, rgba(255, 255, 255, 0.018) 0 2px, transparent 2px 9px),
    linear-gradient(180deg, rgba(58, 38, 22, 0.92), rgba(30, 20, 12, 0.95));
  box-shadow:
    inset 0 1px 0 rgba(255, 226, 154, 0.12),
    inset 0 0 0 1px rgba(0, 0, 0, 0.4),
    0 18px 40px -24px rgba(0, 0, 0, 0.9);
}
.pirate-theme .pr-panel::before,
.pirate-theme .pr-panel::after {
  content: '';
  position: absolute;
  top: 8px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: radial-gradient(circle at 35% 35%, var(--pr-gold-2), var(--pr-brass) 60%, #5a3d17);
  box-shadow: 0 1px 1px rgba(0, 0, 0, 0.7);
  pointer-events: none;
}
.pirate-theme .pr-panel::before { left: 8px; }
.pirate-theme .pr-panel::after { right: 8px; }

.pirate-theme .pr-sea-panel {
  position: relative;
  border-radius: 0.9rem;
  border: 1px solid rgba(45, 212, 191, 0.22);
  background: linear-gradient(180deg, rgba(21, 57, 79, 0.75), rgba(10, 26, 39, 0.9));
  box-shadow: inset 0 1px 0 rgba(191, 239, 240, 0.08), 0 18px 40px -26px rgba(0, 0, 0, 0.9);
}

.pirate-theme .pr-parchment {
  border-radius: 0.8rem;
  color: #3b2a16;
  background:
    radial-gradient(120% 80% at 50% 0%, #f7ecd0, #e6d1a4 70%, #d4b97f);
  box-shadow: inset 0 0 30px rgba(120, 80, 30, 0.35), 0 12px 30px -18px rgba(0, 0, 0, 0.8);
}

.pirate-theme .pr-divider {
  height: 3px;
  border-radius: 999px;
  background: repeating-linear-gradient(-55deg, rgba(201, 151, 60, 0.8) 0 4px, rgba(90, 60, 25, 0.8) 4px 7px);
  opacity: 0.7;
}

.pirate-theme .pr-inset {
  border-radius: 0.6rem;
  background: rgba(0, 0, 0, 0.28);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.6), 0 1px 0 rgba(255, 226, 154, 0.06);
}

/* ── Buttons & tags ─────────────────────────────────────────────────────── */
.pirate-theme .pr-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  border-radius: 0.6rem;
  padding: 0.5rem 0.95rem;
  font-family: 'Cinzel', Georgia, serif;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  line-height: 1.1;
  transition: transform 0.08s, filter 0.15s, box-shadow 0.15s, opacity 0.15s;
  cursor: pointer;
  user-select: none;
}
.pirate-theme .pr-btn:active:not(:disabled) { transform: translateY(1px); }
.pirate-theme .pr-btn:disabled { cursor: not-allowed; opacity: 0.45; filter: saturate(0.5); }
.pirate-theme .pr-btn--gold {
  color: #241604;
  background: linear-gradient(180deg, var(--pr-gold-2), var(--pr-gold) 45%, var(--pr-brass));
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55), 0 8px 18px -10px rgba(243, 195, 90, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.65);
}
.pirate-theme .pr-btn--gold:hover:not(:disabled) { filter: brightness(1.08); }
.pirate-theme .pr-btn--teal {
  color: #032320;
  background: linear-gradient(180deg, #8ff5e6, var(--pr-teal) 50%, #179b8b);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55), 0 8px 18px -10px rgba(45, 212, 191, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.55);
}
.pirate-theme .pr-btn--teal:hover:not(:disabled) { filter: brightness(1.08); }
.pirate-theme .pr-btn--wood {
  color: var(--pr-ink);
  background: linear-gradient(180deg, var(--pr-wood-3), var(--pr-wood-2));
  box-shadow: 0 0 0 1px rgba(201, 151, 60, 0.45), inset 0 1px 0 rgba(255, 226, 154, 0.15);
}
.pirate-theme .pr-btn--wood:hover:not(:disabled) { color: var(--pr-gold-2); filter: brightness(1.12); }
.pirate-theme .pr-btn--ghost {
  color: var(--pr-muted);
  background: rgba(255, 255, 255, 0.03);
  box-shadow: 0 0 0 1px rgba(147, 168, 182, 0.25);
}
.pirate-theme .pr-btn--ghost:hover:not(:disabled) { color: var(--pr-ink); background: rgba(255, 255, 255, 0.07); }
.pirate-theme .pr-btn--danger {
  color: #fff1f0;
  background: linear-gradient(180deg, #f87171, #c2302c);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.35);
}
.pirate-theme .pr-btn--gem {
  color: #f5f0ff;
  background: linear-gradient(180deg, #a78bfa, #6d28d9);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55), 0 8px 18px -10px rgba(167, 139, 250, 0.9), inset 0 1px 0 rgba(255, 255, 255, 0.4);
}
.pirate-theme .pr-btn--sm { padding: 0.35rem 0.65rem; font-size: 0.68rem; }
.pirate-theme .pr-btn--lg { padding: 0.8rem 1.4rem; font-size: 1rem; border-radius: 0.8rem; }
.pirate-theme .pr-btn--block { display: flex; width: 100%; }
.pirate-theme .pr-btn--icon { padding: 0.45rem; }

.pirate-theme .pr-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--tag, var(--pr-gold));
  background: color-mix(in srgb, var(--tag, var(--pr-gold)) 14%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tag, var(--pr-gold)) 45%, transparent);
  white-space: nowrap;
}

/* ── Meters ─────────────────────────────────────────────────────────────── */
.pirate-theme .pr-bar {
  position: relative;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.45);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(201, 151, 60, 0.3);
}
.pirate-theme .pr-bar > i {
  position: absolute;
  inset: 0 auto 0 0;
  display: block;
  border-radius: inherit;
  background: linear-gradient(180deg, color-mix(in srgb, var(--fill, var(--pr-gold)) 70%, white), var(--fill, var(--pr-gold)) 60%);
  box-shadow: 0 0 12px -2px var(--fill, var(--pr-gold));
  transition: width 0.25s ease;
}

.pirate-theme .pr-range {
  appearance: none;
  height: 6px;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--pr-gold) var(--pct, 50%), rgba(0, 0, 0, 0.5) var(--pct, 50%));
  box-shadow: inset 0 0 0 1px rgba(201, 151, 60, 0.35);
  cursor: pointer;
}
.pirate-theme .pr-range::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: radial-gradient(circle at 35% 35%, var(--pr-gold-2), var(--pr-brass));
  box-shadow: 0 0 0 2px #2a1a08;
}
.pirate-theme .pr-range::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: 999px;
  background: radial-gradient(circle at 35% 35%, var(--pr-gold-2), var(--pr-brass));
  box-shadow: 0 0 0 2px #2a1a08;
}
.pirate-theme .pr-range:disabled { opacity: 0.4; cursor: not-allowed; }

/* Rarity / accent glow: set --glow on the element. */
.pirate-theme .pr-glow {
  box-shadow: 0 0 0 1px var(--glow), 0 0 22px -6px var(--glow), inset 0 0 18px -10px var(--glow);
}

.pirate-theme .pr-skeleton {
  border-radius: 0.9rem;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.03));
  background-size: 200% 100%;
  animation: pr-shimmer 1.4s linear infinite;
}
@keyframes pr-shimmer {
  to { background-position: -200% 0; }
}

@media (prefers-reduced-motion: reduce) {
  .pirate-theme .pr-skeleton { animation: none; }
}
</style>
