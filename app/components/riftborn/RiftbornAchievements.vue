<script setup lang="ts">
import { RIFTBORN_ACHIEVEMENTS, riftbornClass } from '#shared/utils/gamelogic/riftborn'
import { hex } from './riftborn-ui'

const props = defineProps<{
  achievements: string[]
  fresh: string[]
}>()

const emit = defineEmits<{
  hover: []
}>()

const done = computed(() => new Set(props.achievements))
const doneCount = computed(() => RIFTBORN_ACHIEVEMENTS.filter(a => done.value.has(a.id)).length)

const rows = computed(() => RIFTBORN_ACHIEVEMENTS.map((a) => {
  const cls = a.unlocks ? riftbornClass(a.unlocks) : undefined
  return {
    ...a,
    done: done.value.has(a.id),
    fresh: props.fresh.includes(a.id),
    cls: cls ? { name: cls.name, color: hex(cls.color) } : null
  }
}))
</script>

<template>
  <section class="rb-feats">
    <header class="rb-feats-head">
      <div>
        <h2 class="rb-h2">Achievements</h2>
        <p class="rb-feats-sub">Feats unlock new classes and grant bonus skill points.</p>
      </div>
      <div class="rb-feats-progress">
        <span>{{ doneCount }}/{{ RIFTBORN_ACHIEVEMENTS.length }}</span>
        <div class="rb-feats-track">
          <div :style="{ width: `${(doneCount / RIFTBORN_ACHIEVEMENTS.length) * 100}%` }" />
        </div>
      </div>
    </header>

    <div class="rb-feats-grid">
      <div
        v-for="(a, i) in rows"
        :key="a.id"
        class="rb-feat"
        :class="{ done: a.done, fresh: a.fresh }"
        :style="{ 'animationDelay': `${i * 0.03}s`, '--cc': a.cls?.color ?? '#ffc54d' }"
        @mouseenter="emit('hover')"
      >
        <span class="rb-feat-icon">
          <UIcon :name="a.icon" class="size-5" />
          <UIcon v-if="a.done" name="i-lucide-check" class="rb-feat-check" />
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="rb-feat-name">{{ a.name }}</span>
            <span v-if="a.fresh" class="rb-feat-new">New</span>
          </div>
          <p class="rb-feat-desc">{{ a.description }}</p>
          <div class="rb-feat-rewards">
            <span class="rb-feat-points">+{{ a.points }} pt{{ a.points === 1 ? '' : 's' }}</span>
            <span v-if="a.cls" class="rb-feat-class">
              <UIcon name="i-lucide-user-round-plus" class="size-3" />
              {{ a.cls.name }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.rb-feats {
  border-radius: 22px;
  padding: 18px;
  background: linear-gradient(180deg, rgba(20, 14, 38, 0.88), rgba(10, 7, 20, 0.88));
  box-shadow: inset 0 0 0 1px rgba(160, 130, 255, 0.14);
}
.rb-feats-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.rb-h2 {
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: 18px;
  font-weight: 800;
  line-height: 1;
  color: #fff;
}
.rb-feats-sub {
  margin-top: 6px;
  font-size: 12.5px;
  color: rgba(220, 212, 240, 0.6);
}
.rb-feats-progress {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 12px;
  font-weight: 700;
  color: rgba(220, 212, 240, 0.7);
}
.rb-feats-track {
  width: 120px;
  height: 5px;
  border-radius: 3px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
}
.rb-feats-track > div {
  height: 100%;
  background: linear-gradient(90deg, #ffe08a, #ffb627);
  transition: width 0.6s ease;
}
.rb-feats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
  gap: 10px;
}
.rb-feat {
  position: relative;
  display: flex;
  gap: 12px;
  padding: 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.025);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
  animation: rb-feat-in 0.4s ease-out backwards;
}
@keyframes rb-feat-in {
  from { opacity: 0; transform: translateY(8px); }
}
.rb-feat.done {
  background: linear-gradient(135deg, rgba(255, 197, 77, 0.08), rgba(255, 255, 255, 0.02));
  box-shadow: inset 0 0 0 1px rgba(255, 197, 77, 0.25);
}
.rb-feat.fresh {
  box-shadow: inset 0 0 0 1.5px #ffc54d, 0 0 26px -8px #ffc54d;
  animation: rb-feat-in 0.4s ease-out backwards, rb-fresh 1.4s 0.4s ease-in-out 3;
}
@keyframes rb-fresh {
  50% { box-shadow: inset 0 0 0 1.5px #fff1c2, 0 0 40px -4px #ffc54d; }
}
.rb-feat-icon {
  position: relative;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  color: rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.05);
}
.rb-feat.done .rb-feat-icon {
  color: #2a1400;
  background: linear-gradient(160deg, #ffe08a, #ff9b3d);
  box-shadow: 0 0 16px -4px #ffb627;
}
.rb-feat-check {
  position: absolute;
  right: -5px;
  bottom: -5px;
  width: 16px;
  height: 16px;
  padding: 2px;
  border-radius: 50%;
  color: #061418;
  background: #7ef0a8;
}
.rb-feat-name {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 13.5px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.7);
}
.rb-feat.done .rb-feat-name {
  color: #fff;
}
.rb-feat-new {
  padding: 1px 6px;
  border-radius: 999px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #2a1400;
  background: #ffc54d;
}
.rb-feat-desc {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.35;
  color: rgba(220, 212, 240, 0.55);
}
.rb-feat-rewards {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 7px;
}
.rb-feat-points,
.rb-feat-class {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 6px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.rb-feat-points {
  color: #8ef6ff;
  background: rgba(142, 246, 255, 0.1);
}
.rb-feat-class {
  color: var(--cc);
  background: color-mix(in srgb, var(--cc) 14%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cc) 35%, transparent);
}
</style>
