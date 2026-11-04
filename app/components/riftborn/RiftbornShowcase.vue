<script setup lang="ts">
import type { RiftbornClassDef } from '#shared/utils/gamelogic/riftborn'
import { WEAPON_DEFS } from './engine/weapons'
import RiftbornPortrait from './RiftbornPortrait.vue'
import { hex, humanize } from './riftborn-ui'

/** The selected class, big: idle portrait, aura and motes in the class colour. */
const props = defineProps<{
  cls: RiftbornClassDef
  unlocked: boolean
}>()

const color = computed(() => hex(props.cls.color))
const weapon = computed(() => WEAPON_DEFS[props.cls.startingWeapon] ?? null)

const stats = computed(() => [
  { label: 'HP', value: String(props.cls.baseHp), pct: (props.cls.baseHp - 60) / 90 },
  { label: 'Speed', value: String(props.cls.baseSpeed), pct: (props.cls.baseSpeed - 150) / 90 },
  { label: 'Might', value: `${Math.round(props.cls.might * 100)}%`, pct: (props.cls.might - 0.85) / 0.35 },
  { label: 'Armor', value: String(props.cls.armor), pct: (props.cls.armor + 0.6) / 3 }
].map(s => ({ ...s, pct: Math.max(0.08, Math.min(1, s.pct)) })))

/* Cosmetic motes */
const motes = Array.from({ length: 22 }, (_, i) => ({
  'left': `${8 + ((i * 41) % 84)}%`,
  'width': `${2 + (i % 3)}px`,
  'height': `${2 + (i % 3)}px`,
  'animationDelay': `${((i * 0.37) % 4).toFixed(2)}s`,
  'animationDuration': `${3 + (i % 5) * 0.6}s`,
  '--drift': `${((i % 7) - 3) * 8}px`
}))
</script>

<template>
  <section class="rb-show" :class="{ locked: !unlocked }" :style="{ '--c': color }">
    <div class="rb-show-stage">
      <Transition name="rb-swap" mode="out-in">
        <div :key="cls.id" class="rb-show-hero">
          <RiftbornPortrait :class-id="cls.id" :color="color" :locked="!unlocked" />
        </div>
      </Transition>
      <div class="rb-show-aura" />
      <div class="rb-show-floor" />
      <div class="rb-show-motes" aria-hidden="true">
        <i v-for="(m, i) in motes" :key="i" :style="m" />
      </div>
      <div class="rb-show-frame" />
    </div>

    <Transition name="rb-info" mode="out-in">
      <div :key="cls.id" class="rb-show-info">
        <p class="rb-show-title">{{ cls.title }}</p>
        <h2 class="rb-show-name">{{ cls.name }}</h2>
        <p class="rb-show-desc">{{ cls.description }}</p>

        <div class="rb-show-stats">
          <div v-for="(s, i) in stats" :key="s.label" class="rb-show-stat">
            <span class="rb-show-stat-label">{{ s.label }}</span>
            <span class="rb-show-stat-track">
              <i :style="{ width: `${s.pct * 100}%`, animationDelay: `${0.1 + i * 0.07}s` }" />
            </span>
            <b class="rb-show-stat-value">{{ s.value }}</b>
          </div>
        </div>

        <div class="rb-show-facts">
          <div class="rb-show-fact">
            <span class="rb-show-fact-icon"><UIcon :name="weapon?.icon ?? 'i-lucide-sword'" class="size-4" /></span>
            <div class="min-w-0">
              <small>Weapon</small>
              <b>{{ weapon?.name ?? humanize(cls.startingWeapon) }}</b>
            </div>
          </div>
          <div class="rb-show-fact">
            <span class="rb-show-fact-icon"><UIcon name="i-lucide-zap" class="size-4" /></span>
            <div class="min-w-0">
              <small>Ultimate <kbd>E</kbd></small>
              <b>{{ cls.ultimate }}</b>
            </div>
          </div>
          <div class="rb-show-fact wide">
            <span class="rb-show-fact-icon"><UIcon name="i-lucide-sparkle" class="size-4" /></span>
            <div class="min-w-0">
              <small>Trait</small>
              <b>{{ cls.trait }}</b>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.rb-show {
  --c: #b28cff;
  position: relative;
  display: grid;
  gap: 18px;
  align-items: center;
  padding: 16px;
  border-radius: 24px;
  overflow: hidden;
  background:
    radial-gradient(60% 90% at 20% 50%, color-mix(in srgb, var(--c) 16%, transparent), transparent 70%),
    linear-gradient(180deg, rgba(20, 14, 38, 0.85), rgba(10, 7, 20, 0.85));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 25%, rgba(160, 130, 255, 0.14));
  transition: box-shadow 0.6s ease;
}
@media (min-width: 760px) {
  .rb-show {
    grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
    gap: 28px;
    padding: 20px 28px 20px 20px;
  }
}

/* stage */
.rb-show-stage {
  position: relative;
  width: min(100%, 300px);
  aspect-ratio: 1;
  margin: 0 auto;
  border-radius: 22px;
  overflow: hidden;
  isolation: isolate;
  background: #07050d;
}
.rb-show-aura {
  position: absolute;
  inset: -30%;
  opacity: 0.45;
  mix-blend-mode: screen;
  pointer-events: none;
  background: conic-gradient(from 0deg, transparent, color-mix(in srgb, var(--c) 50%, transparent), transparent 35%, color-mix(in srgb, var(--c) 30%, transparent), transparent 70%);
  filter: blur(18px);
  animation: rb-spin 9s linear infinite;
}
.rb-show-floor {
  position: absolute;
  left: 10%;
  right: 10%;
  bottom: -12%;
  height: 34%;
  border-radius: 50%;
  mix-blend-mode: screen;
  pointer-events: none;
  background: radial-gradient(ellipse, color-mix(in srgb, var(--c) 55%, transparent), transparent 70%);
  filter: blur(6px);
  animation: rb-floor 3.2s ease-in-out infinite;
}
.rb-show-hero {
  position: absolute;
  inset: 0;
  animation: rb-idle 3.2s ease-in-out infinite;
}
.rb-show-hero :deep(svg) {
  background: transparent;
}
.rb-show-frame {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--c) 55%, transparent), inset 0 0 40px rgba(0, 0, 0, 0.6);
}
.rb-show-motes i {
  position: absolute;
  bottom: -4px;
  border-radius: 50%;
  background: var(--c);
  box-shadow: 0 0 8px var(--c), 0 0 2px #fff;
  opacity: 0;
  animation: rb-mote linear infinite;
}
.locked .rb-show-motes,
.locked .rb-show-aura {
  display: none;
}
@keyframes rb-spin {
  to { transform: rotate(360deg); }
}
@keyframes rb-idle {
  0%, 100% { transform: translateY(0) scale(1.05); }
  50% { transform: translateY(-5px) scale(1.075); }
}
@keyframes rb-floor {
  50% { opacity: 0.6; transform: scaleX(0.9); }
}
@keyframes rb-mote {
  0% { transform: translate(0, 0); opacity: 0; }
  15% { opacity: 0.9; }
  100% { transform: translate(var(--drift), -300px); opacity: 0; }
}
.rb-swap-enter-active {
  transition: opacity 0.35s ease, transform 0.45s cubic-bezier(0.2, 1.3, 0.4, 1), filter 0.45s ease;
}
.rb-swap-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.rb-swap-enter-from {
  opacity: 0;
  transform: scale(1.15);
  filter: brightness(2.5) blur(4px);
}
.rb-swap-leave-to {
  opacity: 0;
  transform: scale(0.92);
}

/* info */
.rb-show-info {
  min-width: 0;
}
.rb-info-enter-active {
  transition: opacity 0.3s ease, transform 0.35s cubic-bezier(0.2, 0.9, 0.3, 1);
}
.rb-info-leave-active {
  transition: opacity 0.12s ease;
}
.rb-info-enter-from {
  opacity: 0;
  transform: translateX(14px);
}
.rb-info-leave-to {
  opacity: 0;
}
.rb-show-title {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--c);
}
.rb-show-name {
  margin-top: 8px;
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: clamp(30px, 5vw, 48px);
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.01em;
  color: #fff;
  text-shadow: 0 0 28px color-mix(in srgb, var(--c) 60%, transparent);
}
.rb-show-desc {
  margin-top: 8px;
  font-size: 13.5px;
  line-height: 1.45;
  color: rgba(220, 212, 240, 0.72);
}
.rb-show-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 18px;
  margin-top: 16px;
}
.rb-show-stat {
  display: grid;
  grid-template-columns: 46px 1fr 38px;
  align-items: center;
  gap: 8px;
}
.rb-show-stat-label,
.rb-show-stat-value {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 10.5px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(220, 212, 240, 0.55);
}
.rb-show-stat-value {
  text-align: right;
  font-size: 12px;
  color: #fff;
}
.rb-show-stat-track {
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.07);
}
.rb-show-stat-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, color-mix(in srgb, var(--c) 45%, transparent), var(--c));
  box-shadow: 0 0 10px var(--c);
  transform-origin: left;
  animation: rb-grow 0.6s cubic-bezier(0.2, 0.9, 0.3, 1) backwards;
}
.locked .rb-show-stat-track i {
  background: rgba(255, 255, 255, 0.3);
  box-shadow: none;
}
@keyframes rb-grow {
  from { transform: scaleX(0); }
}
.rb-show-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 16px;
}
.rb-show-fact {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 9px 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}
.rb-show-fact.wide {
  grid-column: 1 / -1;
}
.rb-show-fact-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  color: var(--c);
  background: color-mix(in srgb, var(--c) 14%, transparent);
}
.rb-show-fact small {
  display: flex;
  align-items: center;
  gap: 5px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 9.5px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(220, 212, 240, 0.5);
}
.rb-show-fact kbd {
  padding: 1px 4px;
  border-radius: 4px;
  font-size: 9px;
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}
.rb-show-fact b {
  display: block;
  margin-top: 4px;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.3;
  color: rgba(240, 236, 250, 0.92);
}
@media (max-width: 520px) {
  .rb-show-stats { grid-template-columns: minmax(0, 1fr); }
  .rb-show-stage { width: min(100%, 240px); }
}
.rb-show-hero {
  transform-origin: 50% 90%;
}
@media (prefers-reduced-motion: reduce) {
  .rb-show * { animation: none !important; }
}
</style>
