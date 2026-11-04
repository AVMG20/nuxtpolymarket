<script setup lang="ts">
import type { RunHud } from './engine/types'
import RiftbornItemIcon from './RiftbornItemIcon.vue'
import { formatClock } from './riftborn-ui'

defineProps<{
  hud: RunHud | null
  muted: boolean
  className: string
}>()

const emit = defineEmits<{
  resume: []
  toggleMute: []
  forfeit: []
  hover: []
}>()

const confirming = ref(false)
let confirmTimer: ReturnType<typeof setTimeout> | undefined

function forfeit() {
  if (!confirming.value) {
    confirming.value = true
    clearTimeout(confirmTimer)
    confirmTimer = setTimeout(() => (confirming.value = false), 3000)
    return
  }
  clearTimeout(confirmTimer)
  emit('forfeit')
}

onBeforeUnmount(() => clearTimeout(confirmTimer))
</script>

<template>
  <div class="rb-pause" @contextmenu.prevent>
    <div class="rb-pause-backdrop" @click="emit('resume')" />
    <div class="rb-pause-panel">
      <p class="rb-pause-kicker">{{ className }}</p>
      <h2 class="rb-pause-title">Paused</h2>

      <div v-if="hud" class="rb-pause-stats">
        <div><span>Time</span><b>{{ formatClock(hud.time) }}</b></div>
        <div><span>Level</span><b>{{ hud.level }}</b></div>
        <div><span>Kills</span><b>{{ formatNumber(hud.kills) }}</b></div>
        <div><span>Rift XP</span><b>+{{ formatNumber(hud.riftXp) }}</b></div>
      </div>

      <div v-if="hud && (hud.weapons.length || hud.passives.length)" class="rb-pause-build">
        <RiftbornItemIcon v-for="w in hud.weapons" :key="w.id" :item="w" />
        <span v-if="hud.weapons.length && hud.passives.length" class="rb-pause-sep" />
        <RiftbornItemIcon v-for="p in hud.passives" :key="p.id" :item="p" size="sm" />
        <template v-if="hud.abilities?.length">
          <span class="rb-pause-sep" />
          <RiftbornItemIcon v-for="a in hud.abilities" :key="a.id" :item="{ ...a, evolved: false }" />
        </template>
      </div>

      <div class="rb-pause-actions">
        <button type="button" class="rb-btn primary" @mouseenter="emit('hover')" @click="emit('resume')">
          <UIcon name="i-lucide-play" class="size-4" />
          Resume
          <kbd>Esc</kbd>
        </button>
        <button type="button" class="rb-btn" @mouseenter="emit('hover')" @click="emit('toggleMute')">
          <UIcon :name="muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'" class="size-4" />
          {{ muted ? 'Unmute' : 'Mute' }}
        </button>
        <button type="button" class="rb-btn danger" :class="{ armed: confirming }" @mouseenter="emit('hover')" @click="forfeit">
          <UIcon name="i-lucide-flag" class="size-4" />
          {{ confirming ? 'Confirm' : 'Forfeit' }}
        </button>
      </div>
      <p class="rb-pause-note">Forfeit counts as a defeat. You keep what you earned.</p>
    </div>
  </div>
</template>

<style scoped>
.rb-pause {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: 16px;
}
.rb-pause-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(4, 2, 10, 0.72);
  backdrop-filter: blur(6px) grayscale(0.6);
  animation: rb-fade 0.2s ease-out;
}
@keyframes rb-fade {
  from { opacity: 0; }
}
.rb-pause-panel {
  position: relative;
  width: min(100%, 380px);
  padding: 24px;
  border-radius: 22px;
  text-align: center;
  background: linear-gradient(180deg, #170f2c, #0b0716);
  box-shadow: inset 0 0 0 1px rgba(160, 130, 255, 0.22), 0 30px 80px -20px #000;
  animation: rb-panel 0.35s cubic-bezier(0.2, 1.4, 0.4, 1);
}
@keyframes rb-panel {
  from { opacity: 0; transform: scale(0.9) translateY(10px); }
}
.rb-pause-kicker {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: #b28cff;
}
.rb-pause-title {
  margin-top: 8px;
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: 34px;
  font-weight: 900;
  line-height: 1;
  text-transform: uppercase;
  color: #fff;
}
.rb-pause-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-top: 18px;
}
.rb-pause-stats div {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 4px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
}
.rb-pause-stats span {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(220, 212, 240, 0.55);
}
.rb-pause-stats b {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 15px;
  font-weight: 700;
  line-height: 1;
  color: #fff;
}
.rb-pause-build {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: center;
  gap: 5px;
  margin-top: 14px;
}
.rb-pause-sep {
  width: 1px;
  height: 30px;
  margin: 0 4px;
  background: rgba(255, 255, 255, 0.1);
}
.rb-pause-actions {
  display: grid;
  gap: 8px;
  margin-top: 20px;
}
.rb-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 16px;
  border-radius: 12px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #fff;
  background: rgba(255, 255, 255, 0.06);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  cursor: pointer;
  transition: background 0.15s ease, transform 0.15s ease;
}
.rb-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}
.rb-btn:active {
  transform: scale(0.98);
}
.rb-btn kbd {
  padding: 2px 6px;
  border-radius: 5px;
  font-size: 10px;
  background: rgba(0, 0, 0, 0.25);
}
.rb-btn.primary {
  color: #0b0716;
  background: linear-gradient(135deg, #8ef6ff, #b28cff);
  box-shadow: 0 0 24px -6px #8ef6ff;
}
.rb-btn.primary:hover {
  filter: brightness(1.1);
}
.rb-btn.danger {
  color: #ff9aa8;
  box-shadow: inset 0 0 0 1px rgba(255, 80, 100, 0.3);
}
.rb-btn.danger.armed {
  color: #fff;
  background: #c8193a;
  box-shadow: 0 0 24px -4px rgba(255, 40, 70, 0.8);
  animation: rb-armed 0.5s ease-in-out infinite alternate;
}
@keyframes rb-armed {
  to { filter: brightness(1.25); }
}
.rb-pause-note {
  margin-top: 12px;
  font-size: 11.5px;
  color: rgba(220, 212, 240, 0.5);
}
</style>
