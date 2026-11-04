<script setup lang="ts">
import {
  RIFTBORN_BRANCHES,
  RIFTBORN_SKILLS,
  riftbornMetaEffects,
  riftbornSkillPointsSpent,
  riftbornSkillsError
} from '#shared/utils/gamelogic/riftborn'
import type { RiftbornSkillDef, RiftbornSkillRanks } from '#shared/utils/gamelogic/riftborn'
import type { Sfx } from './engine/types'
import { hex, riftbornEffectLines } from './riftborn-ui'
import type { RiftbornSaveStatus } from './riftborn-ui'

const props = defineProps<{
  ranks: RiftbornSkillRanks
  points: number
  status: RiftbornSaveStatus
  sfx: Sfx
}>()

const emit = defineEmits<{
  change: [ranks: RiftbornSkillRanks]
  save: []
  hover: []
}>()

const ROW = 92
const byId = new Map(RIFTBORN_SKILLS.map(s => [s.id, s]))
const rank = (id: string) => props.ranks[id] ?? 0
const spent = computed(() => riftbornSkillPointsSpent(props.ranks))
const available = computed(() => props.points - spent.value)
const reachable = (def: RiftbornSkillDef) => def.requires.length === 0 || def.requires.some(id => rank(id) > 0)

type NodeState = 'locked' | 'open' | 'taken' | 'maxed'
function nodeState(def: RiftbornSkillDef): NodeState {
  const r = rank(def.id)
  if (r >= def.maxRank) return 'maxed'
  if (r > 0) return 'taken'
  return reachable(def) ? 'open' : 'locked'
}

/* Branch canvases are measured so the connectors are drawn in real pixels */
const branchesEl = ref<HTMLElement | null>(null)
const width = ref(300)
let observer: ResizeObserver | null = null
onMounted(() => {
  const canvas = branchesEl.value?.querySelector<HTMLElement>('.rb-branch-canvas')
  if (!canvas) return
  width.value = canvas.clientWidth || 300
  observer = new ResizeObserver(([entry]) => {
    if (entry) width.value = entry.contentRect.width || 300
  })
  observer.observe(canvas)
})

const nodeX = (def: RiftbornSkillDef) => (def.col + 0.5) * (width.value / 3)
const nodeY = (def: RiftbornSkillDef) => (def.row + 0.5) * ROW

function edgePath(a: RiftbornSkillDef, b: RiftbornSkillDef) {
  const x1 = nodeX(a)
  const y1 = nodeY(a)
  const x2 = nodeX(b)
  const y2 = nodeY(b)
  const ym = (y1 + y2) / 2
  return `M${x1} ${y1} C${x1} ${ym} ${x2} ${ym} ${x2} ${y2}`
}

const branches = computed(() => RIFTBORN_BRANCHES.map((b) => {
  const skills = RIFTBORN_SKILLS.filter(s => s.branch === b.id)
  const edges = skills.flatMap(child => child.requires.map((pid) => {
    const parent = byId.get(pid)!
    return {
      id: `${pid}>${child.id}`,
      child: child.id,
      d: edgePath(parent, child),
      lit: rank(pid) > 0,
      active: rank(pid) > 0 && rank(child.id) > 0
    }
  }))
  return {
    ...b,
    hex: hex(b.color),
    skills,
    edges,
    spent: skills.reduce((n, s) => n + rank(s.id) * s.cost, 0),
    max: skills.reduce((n, s) => n + s.maxRank * s.cost, 0)
  }
}))

/* Feedback */
const pops = ref<Record<string, number>>({})
const surges = ref<Record<string, number>>({})
const shakes = ref<Record<string, number>>({})
const blockers = ref<string[]>([])
const notice = ref<string | null>(null)
const pointsKick = ref(0)
const selectedId = ref<string | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | undefined
let blockTimer: ReturnType<typeof setTimeout> | undefined

const bump = (map: typeof pops, id: string) => (map.value = { ...map.value, [id]: (map.value[id] ?? 0) + 1 })

function say(text: string) {
  notice.value = text
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = null), 2200)
}

function deny(def: RiftbornSkillDef, text: string) {
  bump(shakes, def.id)
  props.sfx.play('uiError')
  say(text)
}

function add(def: RiftbornSkillDef) {
  selectedId.value = def.id
  const r = rank(def.id)
  if (r >= def.maxRank) return deny(def, `${def.name} is maxed`)
  if (!reachable(def)) return deny(def, `Needs ${def.requires.map(id => byId.get(id)!.name).join(' or ')}`)
  if (available.value < def.cost) {
    pointsKick.value++
    return deny(def, `${def.name} costs ${def.cost} point${def.cost === 1 ? '' : 's'}`)
  }
  const next = { ...props.ranks, [def.id]: r + 1 }
  const error = riftbornSkillsError(next, props.points)
  if (error) return deny(def, error)
  emit('change', next)
  bump(pops, def.id)
  if (r === 0) bump(surges, def.id)
  props.sfx.play('uiBuy', { pitch: 0.9 + def.row * 0.07 + r * 0.05 })
  if (def.keystone && r === 0) props.sfx.play('legendary', { volume: 0.55 })
}

function remove(def: RiftbornSkillDef) {
  selectedId.value = def.id
  const r = rank(def.id)
  if (r <= 0) return
  const next = { ...props.ranks }
  if (r === 1) delete next[def.id]
  else next[def.id] = r - 1
  if (r === 1) {
    const blocked = RIFTBORN_SKILLS.filter(s => rank(s.id) > 0 && s.requires.includes(def.id) && !s.requires.some(id => (next[id] ?? 0) > 0))
    if (blocked.length) {
      blockers.value = blocked.map(b => b.id)
      clearTimeout(blockTimer)
      blockTimer = setTimeout(() => (blockers.value = []), 1200)
      return deny(def, `${blocked.map(b => b.name).join(' and ')} ${blocked.length === 1 ? 'depends' : 'depend'} on it`)
    }
  }
  emit('change', next)
  bump(pops, def.id)
  props.sfx.play('uiClick', { pitch: 0.75 })
}

function onNodeClick(e: MouseEvent, def: RiftbornSkillDef) {
  if (e.shiftKey) remove(def)
  else add(def)
}

/* Respec is free, but ask once */
const respecArmed = ref(false)
let respecTimer: ReturnType<typeof setTimeout> | undefined
function respec() {
  if (spent.value === 0) return
  if (!respecArmed.value) {
    respecArmed.value = true
    clearTimeout(respecTimer)
    respecTimer = setTimeout(() => (respecArmed.value = false), 2500)
    return
  }
  respecArmed.value = false
  emit('change', {})
  props.sfx.play('reroll')
  pointsKick.value++
}

const selected = computed(() => (selectedId.value ? byId.get(selectedId.value) : undefined) ?? null)
const selectedBranch = computed(() => selected.value ? RIFTBORN_BRANCHES.find(b => b.id === selected.value!.branch) : undefined)
const effects = computed(() => riftbornEffectLines(riftbornMetaEffects(props.ranks)))

function hover(def: RiftbornSkillDef) {
  selectedId.value = def.id
  emit('hover')
}

onBeforeUnmount(() => {
  observer?.disconnect()
  clearTimeout(noticeTimer)
  clearTimeout(blockTimer)
  clearTimeout(respecTimer)
})
</script>

<template>
  <section class="rb-tree">
    <header class="rb-tree-head">
      <div :key="pointsKick" class="rb-points" :class="{ kick: pointsKick > 0, has: available > 0 }">
        <span class="rb-points-num">{{ available }}</span>
        <span class="rb-points-label">
          skill point{{ available === 1 ? '' : 's' }}<br>
          <span class="opacity-60">{{ spent }} / {{ points }} spent</span>
        </span>
      </div>

      <Transition name="rb-notice">
        <p v-if="notice" class="rb-notice">{{ notice }}</p>
      </Transition>

      <div class="ml-auto flex flex-wrap items-center gap-2">
        <span class="rb-status" :class="status">
          <UIcon
            :name="status === 'saving' ? 'i-lucide-loader-circle' : status === 'saved' ? 'i-lucide-check' : status === 'error' ? 'i-lucide-triangle-alert' : 'i-lucide-pencil'"
            class="size-3.5"
            :class="{ 'animate-spin': status === 'saving' }"
          />
          {{ status === 'saving' ? 'Saving' : status === 'saved' ? 'Saved' : status === 'error' ? 'Not saved' : 'Unsaved' }}
        </span>
        <button v-if="status === 'dirty' || status === 'error'" type="button" class="rb-tree-btn primary" @click="emit('save')">
          <UIcon name="i-lucide-save" class="size-4" /> Save
        </button>
        <button type="button" class="rb-tree-btn" :class="{ armed: respecArmed }" :disabled="spent === 0" @click="respec">
          <UIcon name="i-lucide-rotate-ccw" class="size-4" />
          {{ respecArmed ? 'Click to confirm' : 'Respec (free)' }}
        </button>
      </div>
    </header>

    <p class="rb-tree-help">
      <kbd>Click</kbd> add a rank · <kbd>Right click</kbd> or <kbd>Shift</kbd>+<kbd>Click</kbd> remove one · Diamonds are keystones that change how you play.
    </p>

    <div ref="branchesEl" class="rb-branches">
      <div
        v-for="b in branches"
        :key="b.id"
        class="rb-branch"
        :style="{ '--b': b.hex }"
      >
        <div class="rb-branch-head">
          <span class="rb-branch-icon"><UIcon :name="b.icon" class="size-4" /></span>
          <span class="rb-branch-name">{{ b.name }}</span>
          <span class="rb-branch-spent">{{ b.spent }}<span class="opacity-50">/{{ b.max }}</span></span>
        </div>

        <div class="rb-branch-canvas" :style="{ height: `${ROW * 5}px` }">
          <svg class="rb-edges" :viewBox="`0 0 ${width} ${ROW * 5}`" aria-hidden="true">
            <g v-for="e in b.edges" :key="e.id">
              <path :d="e.d" class="rb-edge-base" />
              <path v-if="e.lit" :d="e.d" class="rb-edge-glow" :class="{ active: e.active }" />
              <path v-if="e.lit" :d="e.d" class="rb-edge-lit" :class="{ active: e.active }" pathLength="1" />
              <path
                v-if="surges[e.child]"
                :key="`${e.id}-${surges[e.child]}`"
                :d="e.d"
                class="rb-edge-surge"
                pathLength="1"
              />
            </g>
          </svg>

          <button
            v-for="s in b.skills"
            :key="s.id"
            type="button"
            class="rb-node"
            :class="[nodeState(s), {
              keystone: s.keystone,
              poor: nodeState(s) === 'open' && available < s.cost,
              blocker: blockers.includes(s.id),
              chosen: selectedId === s.id
            }]"
            :style="{ left: `${nodeX(s)}px`, top: `${nodeY(s)}px` }"
            :aria-label="`${s.name}, rank ${rank(s.id)} of ${s.maxRank}`"
            @click="onNodeClick($event, s)"
            @contextmenu.prevent="remove(s)"
            @mouseenter="hover(s)"
            @focus="selectedId = s.id"
          >
            <span :key="`s${shakes[s.id] ?? 0}`" class="rb-node-shell" :class="{ shake: shakes[s.id] }">
              <span class="rb-node-core">
                <UIcon :name="s.keystone || nodeState(s) !== 'locked' ? s.icon : 'i-lucide-lock'" class="rb-node-icon" />
              </span>
            </span>
            <span v-if="pops[s.id]" :key="`p${pops[s.id]}`" class="rb-node-pop" />
            <span class="rb-node-rank">{{ rank(s.id) }}/{{ s.maxRank }}</span>
          </button>
        </div>
      </div>
    </div>

    <div class="rb-tree-foot">
      <div class="rb-inspect" :style="{ '--b': selectedBranch ? hex(selectedBranch.color) : '#8ef6ff' }">
        <template v-if="selected">
          <div class="flex items-start gap-3">
            <span class="rb-inspect-icon" :class="{ keystone: selected.keystone }"><UIcon :name="selected.icon" class="size-5" /></span>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="rb-inspect-name">{{ selected.name }}</h3>
                <span v-if="selected.keystone" class="rb-keystone-tag">Keystone</span>
              </div>
              <p class="rb-inspect-desc">{{ selected.description }}<template v-if="selected.maxRank > 1"> per rank</template></p>
              <p class="rb-inspect-meta">
                Rank {{ rank(selected.id) }}/{{ selected.maxRank }} · {{ selected.cost }} point{{ selected.cost === 1 ? '' : 's' }} per rank
                <template v-if="selected.requires.length"> · Needs {{ selected.requires.map(id => byId.get(id)!.name).join(' or ') }}</template>
              </p>
            </div>
            <div class="flex shrink-0 gap-1.5">
              <button type="button" class="rb-step" :disabled="rank(selected.id) === 0" aria-label="Remove a rank" @click="remove(selected)">
                <UIcon name="i-lucide-minus" class="size-4" />
              </button>
              <button type="button" class="rb-step plus" :disabled="nodeState(selected) === 'maxed'" aria-label="Add a rank" @click="add(selected)">
                <UIcon name="i-lucide-plus" class="size-4" />
              </button>
            </div>
          </div>
        </template>
        <p v-else class="rb-inspect-empty">Hover or tap a node to inspect it.</p>
      </div>

      <div class="rb-effects">
        <h3 class="rb-effects-title">Your build</h3>
        <ul v-if="effects.length" class="rb-effects-list">
          <li v-for="e in effects" :key="e.label" :class="{ keystone: e.keystone }">
            <span>{{ e.label }}</span>
            <b>{{ e.value }}</b>
          </li>
        </ul>
        <p v-else class="rb-inspect-empty">No skills taken yet. Every account level earns a point.</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.rb-tree {
  border-radius: 22px;
  padding: 18px;
  background:
    radial-gradient(100% 60% at 50% 0%, rgba(142, 246, 255, 0.06), transparent 60%),
    linear-gradient(180deg, rgba(20, 14, 38, 0.88), rgba(10, 7, 20, 0.88));
  box-shadow: inset 0 0 0 1px rgba(160, 130, 255, 0.14);
}
.rb-tree-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
}
.rb-points {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px 8px 10px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.04);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}
.rb-points.has {
  box-shadow: inset 0 0 0 1px rgba(142, 246, 255, 0.45), 0 0 24px -8px #8ef6ff;
}
.rb-points.kick {
  animation: rb-kick 0.4s cubic-bezier(0.2, 1.6, 0.4, 1);
}
@keyframes rb-kick {
  30% { transform: scale(1.1); }
}
.rb-points-num {
  display: grid;
  place-items: center;
  min-width: 44px;
  height: 44px;
  padding: 0 6px;
  clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
  background: linear-gradient(160deg, #8ef6ff, #6b5cff);
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: 18px;
  font-weight: 900;
  color: #061026;
}
.rb-points:not(.has) .rb-points-num {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.7);
}
.rb-points-label {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.35;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #fff;
}
.rb-notice {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: #ffb3bd;
}
.rb-notice-enter-active,
.rb-notice-leave-active {
  transition: opacity 0.2s ease, transform 0.25s ease;
}
.rb-notice-enter-from,
.rb-notice-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
.rb-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(220, 212, 240, 0.55);
}
.rb-status.saved { color: #7ef0a8; }
.rb-status.error { color: #ff8a9a; }
.rb-tree-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 10px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #fff;
  background: rgba(255, 255, 255, 0.06);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  cursor: pointer;
}
.rb-tree-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.11);
}
.rb-tree-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.rb-tree-btn.primary {
  color: #061026;
  background: linear-gradient(135deg, #8ef6ff, #b28cff);
}
.rb-tree-btn.armed {
  color: #fff;
  background: #c8193a;
}
.rb-tree-help {
  margin-top: 12px;
  font-size: 12px;
  color: rgba(220, 212, 240, 0.55);
}
.rb-tree-help kbd {
  padding: 1px 5px;
  border-radius: 4px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 10px;
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}

.rb-branches {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-top: 16px;
}
@media (max-width: 860px) {
  .rb-branches { grid-template-columns: minmax(0, 1fr); }
}
.rb-branch {
  --b: #fff;
  position: relative;
  border-radius: 18px;
  padding: 12px 6px 4px;
  background:
    radial-gradient(80% 50% at 50% 100%, color-mix(in srgb, var(--b) 10%, transparent), transparent 70%),
    rgba(6, 4, 14, 0.55);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--b) 18%, transparent);
}
.rb-branch-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
}
.rb-branch-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: var(--b);
  background: color-mix(in srgb, var(--b) 16%, transparent);
}
.rb-branch-name {
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: 15px;
  font-weight: 800;
  color: #fff;
}
.rb-branch-spent {
  margin-left: auto;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 12px;
  font-weight: 700;
  color: var(--b);
}
.rb-branch-canvas {
  position: relative;
  width: 100%;
}
.rb-edges {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}
.rb-edges path {
  fill: none;
  stroke-linecap: round;
}
.rb-edge-base {
  stroke: rgba(255, 255, 255, 0.08);
  stroke-width: 3;
}
.rb-edge-glow {
  stroke: var(--b);
  stroke-width: 9;
  opacity: 0.08;
}
.rb-edge-glow.active {
  opacity: 0.28;
}
.rb-edge-lit {
  stroke: color-mix(in srgb, var(--b) 70%, transparent);
  stroke-width: 2.5;
  stroke-dasharray: 0.03 0.05;
  animation: rb-flow 2.4s linear infinite;
}
.rb-edge-lit.active {
  stroke: var(--b);
  stroke-width: 3.5;
  stroke-dasharray: none;
  animation: none;
}
@keyframes rb-flow {
  to { stroke-dashoffset: -0.16; }
}
.rb-edge-surge {
  stroke: #fff;
  stroke-width: 5;
  stroke-dasharray: 0.3 1.4;
  stroke-dashoffset: 0.3;
  filter: drop-shadow(0 0 6px var(--b));
  animation: rb-surge 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}
@keyframes rb-surge {
  to { stroke-dashoffset: -1; }
}

.rb-node {
  --s: 54px;
  position: absolute;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  translate: -50% calc(var(--s) / -2);
  cursor: pointer;
  outline: none;
  -webkit-tap-highlight-color: transparent;
}
.rb-node.keystone {
  --s: 64px;
}
.rb-node-shell {
  position: relative;
  display: grid;
  place-items: center;
  width: var(--s);
  height: var(--s);
  border-radius: 50%;
  padding: 3px;
  background: rgba(255, 255, 255, 0.1);
  transition: transform 0.2s cubic-bezier(0.2, 1.6, 0.4, 1), background 0.3s ease, box-shadow 0.3s ease;
}
.rb-node.keystone .rb-node-shell {
  border-radius: 14px;
  rotate: 45deg;
  width: calc(var(--s) * 0.78);
  height: calc(var(--s) * 0.78);
  margin: calc(var(--s) * 0.11);
}
.rb-node:hover .rb-node-shell,
.rb-node:focus-visible .rb-node-shell {
  transform: scale(1.1);
}
.rb-node:active .rb-node-shell {
  transform: scale(0.94);
}
.rb-node-core {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: radial-gradient(circle at 50% 35%, #1d1436, #0a0614 75%);
  color: rgba(255, 255, 255, 0.35);
  transition: color 0.3s ease, background 0.3s ease;
}
.rb-node-icon {
  width: 42%;
  height: 42%;
}
.rb-node.keystone .rb-node-icon {
  rotate: -45deg;
  width: 48%;
  height: 48%;
}
.rb-node.keystone .rb-node-shell {
  background: linear-gradient(135deg, color-mix(in srgb, var(--b) 35%, #000), rgba(255, 255, 255, 0.12));
}
.rb-node.locked {
  cursor: not-allowed;
}
.rb-node.locked .rb-node-core {
  color: rgba(255, 255, 255, 0.2);
}
.rb-node.open .rb-node-shell {
  background: color-mix(in srgb, var(--b) 45%, transparent);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--b) 60%, transparent);
  animation: rb-open 1.8s ease-out infinite;
}
.rb-node.open .rb-node-core {
  color: color-mix(in srgb, var(--b) 80%, #fff);
}
.rb-node.open.poor .rb-node-shell {
  animation: none;
  background: color-mix(in srgb, var(--b) 22%, transparent);
}
@keyframes rb-open {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--b) 55%, transparent); }
  70%, 100% { box-shadow: 0 0 0 12px transparent; }
}
.rb-node.taken .rb-node-shell,
.rb-node.maxed .rb-node-shell {
  background: var(--b);
  box-shadow: 0 0 18px color-mix(in srgb, var(--b) 70%, transparent), 0 0 40px -8px var(--b);
}
.rb-node.taken .rb-node-core,
.rb-node.maxed .rb-node-core {
  color: #fff;
  background: radial-gradient(circle at 50% 35%, color-mix(in srgb, var(--b) 55%, #1d1436), #120a22 80%);
}
.rb-node.taken .rb-node-icon,
.rb-node.maxed .rb-node-icon {
  filter: drop-shadow(0 0 6px var(--b));
}
.rb-node.maxed .rb-node-shell {
  background: linear-gradient(135deg, #fff, var(--b) 45%, #fff 90%);
  box-shadow: 0 0 22px var(--b), 0 0 60px -6px var(--b);
}
.rb-node.blocker .rb-node-shell {
  animation: rb-blocker 0.4s ease-in-out 3;
}
@keyframes rb-blocker {
  50% { box-shadow: 0 0 0 4px #ff4d6a, 0 0 30px #ff4d6a; }
}
.rb-node.chosen .rb-node-rank {
  color: #fff;
}
.rb-node-shell.shake {
  animation: rb-shake 0.35s ease-in-out;
}
@keyframes rb-shake {
  20% { translate: -5px 0; }
  40% { translate: 5px 0; }
  60% { translate: -3px 0; }
  80% { translate: 3px 0; }
}
.rb-node-pop {
  position: absolute;
  left: 50%;
  top: calc(var(--s) / 2);
  width: var(--s);
  height: var(--s);
  margin: calc(var(--s) / -2) 0 0 calc(var(--s) / -2);
  border-radius: 50%;
  border: 3px solid var(--b);
  pointer-events: none;
  animation: rb-pop 0.6s ease-out forwards;
}
.rb-node-pop::after {
  content: '';
  position: absolute;
  inset: 20%;
  border-radius: 50%;
  background: radial-gradient(circle, #fff, var(--b) 50%, transparent 70%);
  animation: rb-pop-core 0.45s ease-out forwards;
}
@keyframes rb-pop {
  0% { transform: scale(0.8); opacity: 1; }
  100% { transform: scale(2.2); opacity: 0; border-width: 0.5px; }
}
@keyframes rb-pop-core {
  0% { transform: scale(0.4); opacity: 1; }
  100% { transform: scale(2); opacity: 0; }
}
.rb-node-rank {
  margin-top: 4px;
  padding: 1px 6px;
  border-radius: 6px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: rgba(220, 212, 240, 0.6);
  background: rgba(6, 4, 14, 0.8);
}
.rb-node.taken .rb-node-rank,
.rb-node.maxed .rb-node-rank {
  color: var(--b);
}

.rb-tree-foot {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 14px;
  margin-top: 14px;
}
@media (max-width: 860px) {
  .rb-tree-foot { grid-template-columns: minmax(0, 1fr); }
}
.rb-inspect,
.rb-effects {
  border-radius: 16px;
  padding: 14px;
  background: rgba(6, 4, 14, 0.55);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}
.rb-inspect {
  --b: #8ef6ff;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--b) 25%, transparent);
}
.rb-inspect-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  color: var(--b);
  background: color-mix(in srgb, var(--b) 18%, transparent);
}
.rb-inspect-icon.keystone {
  border-radius: 10px;
}
.rb-inspect-name {
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: 15px;
  font-weight: 800;
  color: #fff;
}
.rb-keystone-tag {
  padding: 2px 7px;
  border-radius: 999px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #0b0716;
  background: var(--b);
}
.rb-inspect-desc {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.45;
  color: rgba(240, 236, 250, 0.85);
}
.rb-inspect-meta {
  margin-top: 6px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: rgba(220, 212, 240, 0.55);
}
.rb-inspect-empty {
  font-size: 12.5px;
  color: rgba(220, 212, 240, 0.5);
}
.rb-step {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  color: #fff;
  background: rgba(255, 255, 255, 0.07);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  cursor: pointer;
}
.rb-step.plus {
  color: #061026;
  background: var(--b);
}
.rb-step:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.rb-effects-title {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(220, 212, 240, 0.6);
  margin-bottom: 8px;
}
.rb-effects-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 170px), 1fr));
  gap: 4px 14px;
}
.rb-effects-list li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 3px 0;
  font-size: 12.5px;
  color: rgba(220, 212, 240, 0.75);
  border-bottom: 1px dashed rgba(255, 255, 255, 0.06);
}
.rb-effects-list b {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-weight: 800;
  color: #8ef6ff;
}
.rb-effects-list li.keystone b {
  color: #ffc54d;
}
@media (prefers-reduced-motion: reduce) {
  .rb-tree * { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }
}
</style>
