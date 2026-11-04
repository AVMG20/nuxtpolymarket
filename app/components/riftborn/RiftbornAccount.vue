<script setup lang="ts">
import { RIFTBORN_MAX_LEVEL } from '#shared/utils/gamelogic/riftborn'
import RiftbornNumber from './RiftbornNumber.vue'

const props = defineProps<{
  level: number
  xpIntoLevel: number
  xpForNext: number | null
  available: number
}>()

const emit = defineEmits<{
  openTree: []
}>()

const pct = computed(() => props.xpForNext ? Math.max(0, Math.min(1, props.xpIntoLevel / props.xpForNext)) : 1)
const maxed = computed(() => props.level >= RIFTBORN_MAX_LEVEL || props.xpForNext === null)
</script>

<template>
  <div class="rb-acct">
    <div class="rb-acct-badge" :title="`Rift level ${level}`">
      <span class="rb-acct-badge-label">Rank</span>
      <span class="rb-acct-badge-num">{{ level }}</span>
    </div>
    <div class="rb-acct-body">
      <div class="rb-acct-row">
        <span class="rb-acct-title">Rift level {{ level }}</span>
        <span class="rb-acct-xp">
          <template v-if="maxed">Max level</template>
          <template v-else><RiftbornNumber :value="xpIntoLevel" /> / {{ formatNumber(xpForNext ?? 0) }} XP</template>
        </span>
      </div>
      <div class="rb-acct-track">
        <div class="rb-acct-fill" :style="{ width: `${pct * 100}%` }" />
      </div>
    </div>
    <button
      v-if="available > 0"
      type="button"
      class="rb-acct-nudge"
      @click="emit('openTree')"
    >
      <span class="rb-acct-nudge-num">{{ available }}</span>
      unspent point{{ available === 1 ? '' : 's' }}
      <UIcon name="i-lucide-arrow-right" class="size-3.5" />
    </button>
  </div>
</template>

<style scoped>
.rb-acct {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
  min-width: 0;
  padding: 6px 12px 6px 6px;
  border-radius: 18px;
  background: rgba(10, 7, 20, 0.72);
  box-shadow: inset 0 0 0 1px rgba(142, 246, 255, 0.18);
  backdrop-filter: blur(6px);
}
.rb-acct-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 46px;
  height: 50px;
  clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
  background: linear-gradient(160deg, #8ef6ff, #6b5cff 60%, #2a1a6e);
  color: #061026;
}
.rb-acct-badge-label {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 7.5px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.rb-acct-badge-num {
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: 17px;
  font-weight: 900;
  line-height: 1;
}
.rb-acct-body {
  flex: 1;
  min-width: 160px;
}
.rb-acct-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.rb-acct-title {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #fff;
}
.rb-acct-xp {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 600;
  color: rgba(220, 212, 240, 0.6);
  white-space: nowrap;
}
.rb-acct-track {
  height: 7px;
  margin-top: 6px;
  border-radius: 4px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
}
.rb-acct-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #6b5cff, #8ef6ff);
  box-shadow: 0 0 12px #8ef6ff;
  transition: width 0.8s cubic-bezier(0.2, 0.9, 0.3, 1);
}
.rb-acct-nudge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px 6px 6px;
  border-radius: 999px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #fff;
  background: rgba(142, 246, 255, 0.12);
  box-shadow: inset 0 0 0 1px rgba(142, 246, 255, 0.5), 0 0 20px -6px #8ef6ff;
  cursor: pointer;
  animation: rb-nudge 1.6s ease-in-out infinite;
}
.rb-acct-nudge:hover {
  background: rgba(142, 246, 255, 0.2);
}
.rb-acct-nudge-num {
  display: grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: 999px;
  color: #061026;
  background: #8ef6ff;
}
@keyframes rb-nudge {
  50% { box-shadow: inset 0 0 0 1px rgba(142, 246, 255, 0.9), 0 0 28px -2px #8ef6ff; }
}
</style>
