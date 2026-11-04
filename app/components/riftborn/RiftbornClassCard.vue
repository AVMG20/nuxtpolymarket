<script setup lang="ts">
import { RIFTBORN_ACHIEVEMENTS } from '#shared/utils/gamelogic/riftborn'
import type { RiftbornClassDef } from '#shared/utils/gamelogic/riftborn'
import RiftbornPortrait from './RiftbornPortrait.vue'
import { hex, humanize } from './riftborn-ui'

const props = defineProps<{
  cls: RiftbornClassDef
  unlocked: boolean
  selected: boolean
  /** Just unlocked by an achievement: shatter the seal on mount */
  celebrate?: boolean
}>()

const emit = defineEmits<{
  select: []
  hover: []
  celebrated: []
}>()

const color = computed(() => hex(props.cls.color))
const requirement = computed(() => props.cls.unlockedBy ? RIFTBORN_ACHIEVEMENTS.find(a => a.id === props.cls.unlockedBy) ?? null : null)

const stats = computed(() => [
  { label: 'HP', value: props.cls.baseHp, pct: (props.cls.baseHp - 60) / 90 },
  { label: 'SPD', value: props.cls.baseSpeed, pct: (props.cls.baseSpeed - 150) / 90 },
  { label: 'MGT', value: `${Math.round(props.cls.might * 100)}%`, pct: (props.cls.might - 0.85) / 0.35 },
  { label: 'ARM', value: props.cls.armor, pct: (props.cls.armor + 0.6) / 3 }
].map(s => ({ ...s, pct: Math.max(0.08, Math.min(1, s.pct)) })))

/* Unlock: the seal shatters, a flash in the class colour, the portrait floods back to life */
const shattering = ref(false)
const sealed = ref(!!props.celebrate)
let shatterTimer: ReturnType<typeof setTimeout> | undefined
let startTimer: ReturnType<typeof setTimeout> | undefined
function shatter() {
  sealed.value = false
  shattering.value = true
  emit('celebrated')
  clearTimeout(shatterTimer)
  shatterTimer = setTimeout(() => (shattering.value = false), 1400)
}
watch(() => props.unlocked, (now, before) => {
  if (now && before === false) shatter()
})
onMounted(() => {
  if (props.celebrate && props.unlocked) startTimer = setTimeout(shatter, 700)
})
onBeforeUnmount(() => {
  clearTimeout(shatterTimer)
  clearTimeout(startTimer)
})
const looksLocked = computed(() => !props.unlocked || sealed.value)

const fragments = Array.from({ length: 14 }, (_, i) => {
  const angle = (i / 14) * Math.PI * 2 + (i % 2) * 0.2
  const dist = 70 + (i % 3) * 30
  return {
    '--dx': `${Math.cos(angle) * dist}px`,
    '--dy': `${Math.sin(angle) * dist}px`,
    '--rot': `${(i * 67) % 360}deg`,
    'animationDelay': `${(i % 4) * 0.02}s`
  }
})

/* Pointer-driven tilt, written straight to CSS vars */
function tilt(e: PointerEvent) {
  if (e.pointerType === 'touch') return
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  const px = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  const py = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
  el.style.setProperty('--rx', `${((0.5 - py) * 10).toFixed(2)}deg`)
  el.style.setProperty('--ry', `${((px - 0.5) * 12).toFixed(2)}deg`)
  el.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`)
  el.style.setProperty('--my', `${(py * 100).toFixed(1)}%`)
}

function untilt(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  el.style.setProperty('--rx', '0deg')
  el.style.setProperty('--ry', '0deg')
}

function onClick() {
  if (props.unlocked && !sealed.value) emit('select')
}
</script>

<template>
  <div
    class="rb-class"
    :class="{ selected, locked: looksLocked, shattering }"
    :style="{ '--c': color }"
    role="button"
    :tabindex="unlocked ? 0 : -1"
    :aria-pressed="selected"
    @click="onClick"
    @keydown.enter.prevent="onClick"
    @mouseenter="emit('hover')"
    @pointermove="tilt"
    @pointerleave="untilt"
  >
    <div class="rb-class-frame" />
    <div class="rb-class-glare" />
    <div class="rb-class-portrait">
      <RiftbornPortrait :class-id="cls.id" :color="color" :locked="looksLocked" />
      <div class="rb-class-portrait-fade" />
      <div v-if="selected" class="rb-class-chosen">
        <UIcon name="i-lucide-check" class="size-3.5" /> Chosen
      </div>

      <div v-if="looksLocked || shattering" class="rb-seal" :class="{ breaking: shattering }">
        <div class="rb-seal-ring">
          <UIcon name="i-lucide-lock" class="rb-seal-icon" />
        </div>
        <span v-for="(f, i) in fragments" :key="i" class="rb-frag" :style="f" />
      </div>
      <div v-if="shattering" class="rb-flash" />
    </div>

    <div class="rb-class-body">
      <div class="flex items-baseline justify-between gap-2">
        <h3 class="rb-class-name">{{ cls.name }}</h3>
        <span class="rb-class-title">{{ cls.title }}</span>
      </div>
      <p class="rb-class-desc">{{ cls.description }}</p>

      <div class="rb-stats">
        <div v-for="s in stats" :key="s.label" class="rb-stat">
          <span class="rb-stat-label">{{ s.label }}</span>
          <div class="rb-stat-track">
            <div class="rb-stat-fill" :style="{ width: `${s.pct * 100}%` }" />
          </div>
          <span class="rb-stat-value">{{ s.value }}</span>
        </div>
      </div>

      <dl class="rb-facts">
        <div>
          <dt><UIcon name="i-lucide-sword" class="size-3" /> Weapon</dt>
          <dd>{{ humanize(cls.startingWeapon) }}</dd>
        </div>
        <div>
          <dt><UIcon name="i-lucide-zap" class="size-3" /> Ultimate</dt>
          <dd :title="cls.ultimateDescription">{{ cls.ultimate }}</dd>
        </div>
        <div class="col-span-2">
          <dt><UIcon name="i-lucide-sparkle" class="size-3" /> Trait</dt>
          <dd>{{ cls.trait }}</dd>
        </div>
      </dl>

      <div v-if="!unlocked && requirement" class="rb-req">
        <span class="rb-req-icon"><UIcon :name="requirement.icon" class="size-4" /></span>
        <div class="min-w-0">
          <div class="rb-req-label">Unlock with <b>{{ requirement.name }}</b></div>
          <div class="rb-req-desc">{{ requirement.description }}</div>
        </div>
      </div>
      <div v-else-if="shattering" class="rb-req fresh">
        <span class="rb-req-icon"><UIcon name="i-lucide-sparkles" class="size-4" /></span>
        <div class="rb-req-label"><b>Awakened!</b></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rb-class {
  --c: #fff;
  --rx: 0deg;
  --ry: 0deg;
  --mx: 50%;
  --my: 50%;
  --lift: 0px;
  position: relative;
  display: flex;
  flex-direction: column;
  border-radius: 18px;
  background: linear-gradient(180deg, #120c22 0%, #0b0716 100%);
  box-shadow: 0 0 0 1px rgba(160, 130, 255, 0.14), 0 18px 40px -24px rgba(0, 0, 0, 0.9);
  overflow: hidden;
  cursor: pointer;
  transform: perspective(900px) rotateX(var(--rx)) rotateY(var(--ry)) translateY(var(--lift));
  transition: transform 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.2), box-shadow 0.25s ease;
  outline: none;
  isolation: isolate;
}
.rb-class:hover {
  --lift: -4px;
  transition: transform 0.1s linear, box-shadow 0.25s ease;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--c) 55%, transparent), 0 24px 50px -24px color-mix(in srgb, var(--c) 60%, transparent);
}
.rb-class:focus-visible {
  box-shadow: 0 0 0 2px var(--c);
}
.rb-class.locked {
  cursor: default;
}
.rb-class.selected {
  --lift: -4px;
  box-shadow: 0 0 0 2px var(--c), 0 0 34px -6px color-mix(in srgb, var(--c) 70%, transparent), 0 24px 50px -20px color-mix(in srgb, var(--c) 50%, transparent);
}
.rb-class-frame {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  border-radius: inherit;
  opacity: 0;
  background: conic-gradient(from var(--rb-angle, 0deg), transparent 0 70%, var(--c) 85%, transparent 100%);
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
  padding: 2px;
  transition: opacity 0.3s ease;
}
.rb-class-glare {
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
  border-radius: inherit;
  opacity: 0;
  mix-blend-mode: soft-light;
  background: radial-gradient(circle at var(--mx) var(--my), rgba(255, 255, 255, 0.55), transparent 50%);
  transition: opacity 0.25s ease;
}
.rb-class:not(.locked):hover .rb-class-glare {
  opacity: 1;
}
.rb-class.selected .rb-class-frame {
  opacity: 1;
  animation: rb-orbit 3s linear infinite;
}
@property --rb-angle {
  syntax: '<angle>';
  inherits: false;
  initial-value: 0deg;
}
@keyframes rb-orbit {
  to { --rb-angle: 360deg; }
}

.rb-class-portrait {
  position: relative;
  aspect-ratio: 16 / 11;
  overflow: hidden;
}
.rb-class-portrait :deep(svg) {
  transition: transform 0.6s cubic-bezier(0.2, 0.9, 0.3, 1);
}
.rb-class:hover .rb-class-portrait :deep(svg),
.rb-class.selected .rb-class-portrait :deep(svg) {
  transform: scale(1.06);
}
.rb-class-portrait-fade {
  position: absolute;
  inset: auto 0 0;
  height: 45%;
  background: linear-gradient(180deg, transparent, #120c22);
}
.rb-class-chosen {
  position: absolute;
  top: 10px;
  right: 10px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px 3px 7px;
  border-radius: 999px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #0b0716;
  background: var(--c);
  box-shadow: 0 0 18px var(--c);
  animation: rb-pop 0.35s cubic-bezier(0.2, 1.4, 0.4, 1);
}
@keyframes rb-pop {
  from { transform: scale(0.4); opacity: 0; }
}

.rb-seal {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  z-index: 2;
}
.rb-seal-ring {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: radial-gradient(circle, rgba(10, 6, 20, 0.95), rgba(10, 6, 20, 0.6));
  box-shadow: 0 0 0 6px rgba(255, 255, 255, 0.04), 0 0 30px rgba(0, 0, 0, 0.8);
}
.rb-seal-icon {
  width: 26px;
  height: 26px;
  color: rgba(255, 255, 255, 0.75);
}
.rb-frag {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 10px;
  height: 6px;
  margin: -3px 0 0 -5px;
  background: var(--c);
  clip-path: polygon(0 0, 100% 30%, 60% 100%);
  opacity: 0;
}
.rb-seal.breaking .rb-seal-ring {
  animation: rb-seal-break 0.7s cubic-bezier(0.3, 0, 0.6, 1) forwards;
}
.rb-seal.breaking .rb-frag {
  animation: rb-frag 0.9s cubic-bezier(0.1, 0.8, 0.3, 1) forwards;
}
@keyframes rb-seal-break {
  0% { transform: scale(1) rotate(0); }
  25% { transform: scale(1.15) rotate(-8deg); }
  45% { transform: scale(0.9) rotate(6deg); opacity: 1; }
  100% { transform: scale(2.2) rotate(30deg); opacity: 0; }
}
@keyframes rb-frag {
  0% { transform: translate(0, 0) rotate(0); opacity: 0; }
  30% { opacity: 1; }
  100% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); opacity: 0; }
}
.rb-flash {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: radial-gradient(circle at 50% 50%, #fff, var(--c) 30%, transparent 70%);
  mix-blend-mode: screen;
  animation: rb-flash 1.1s ease-out forwards;
}
@keyframes rb-flash {
  0% { opacity: 0; }
  15% { opacity: 1; }
  100% { opacity: 0; }
}
.rb-class.shattering {
  animation: rb-card-jolt 0.5s ease-out;
}
@keyframes rb-card-jolt {
  0%, 100% { transform: translate(0, -4px); }
  20% { transform: translate(-3px, -2px) rotate(-0.6deg); }
  40% { transform: translate(3px, -6px) rotate(0.6deg); }
  60% { transform: translate(-2px, -3px); }
}

.rb-class-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  padding: 2px 16px 16px;
  margin-top: -18px;
  position: relative;
  z-index: 2;
}
.rb-class-name {
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: 20px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.01em;
  color: #fff;
  text-shadow: 0 0 18px color-mix(in srgb, var(--c) 60%, transparent);
}
.rb-class-title {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--c);
  white-space: nowrap;
}
.rb-class-desc {
  font-size: 12.5px;
  line-height: 1.45;
  color: rgba(220, 212, 240, 0.7);
}
.rb-stats {
  display: grid;
  gap: 5px;
}
.rb-stat {
  display: grid;
  grid-template-columns: 30px 1fr 34px;
  align-items: center;
  gap: 8px;
}
.rb-stat-label,
.rb-stat-value {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.1em;
  color: rgba(220, 212, 240, 0.55);
}
.rb-stat-value {
  text-align: right;
  color: rgba(255, 255, 255, 0.85);
}
.rb-stat-track {
  height: 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.07);
  overflow: hidden;
}
.rb-stat-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, color-mix(in srgb, var(--c) 50%, transparent), var(--c));
  box-shadow: 0 0 10px var(--c);
  transition: width 0.6s cubic-bezier(0.2, 0.9, 0.3, 1);
}
.locked .rb-stat-fill {
  background: rgba(255, 255, 255, 0.25);
  box-shadow: none;
}
.rb-facts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.rb-facts dt {
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 9.5px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--c) 75%, #fff);
  margin-bottom: 3px;
}
.locked .rb-facts dt {
  color: rgba(220, 212, 240, 0.45);
}
.rb-facts dd {
  font-size: 12px;
  line-height: 1.35;
  color: rgba(240, 236, 250, 0.88);
}
.rb-req {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 197, 77, 0.06);
  box-shadow: inset 0 0 0 1px rgba(255, 197, 77, 0.22);
}
.rb-req.fresh {
  background: color-mix(in srgb, var(--c) 18%, transparent);
  box-shadow: inset 0 0 0 1px var(--c), 0 0 24px -6px var(--c);
  animation: rb-pop 0.4s cubic-bezier(0.2, 1.6, 0.4, 1);
}
.rb-req-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  color: #ffc54d;
  background: rgba(255, 197, 77, 0.12);
}
.rb-req.fresh .rb-req-icon {
  color: #fff;
  background: var(--c);
}
.rb-req-label {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(220, 212, 240, 0.65);
}
.rb-req-label b {
  color: #ffd56a;
}
.rb-req.fresh .rb-req-label b {
  color: #fff;
}
.rb-req-desc {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.35;
  color: rgba(240, 236, 250, 0.85);
}
@media (prefers-reduced-motion: reduce) {
  .rb-class, .rb-class * { animation: none !important; transition: none !important; }
}
</style>
