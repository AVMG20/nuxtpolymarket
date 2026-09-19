<template>
    <div class="vk">
        <div class="vk-pilot">
            <div class="vk-level">
                <span>Lv</span>
                <b>{{ pilot.level }}</b>
            </div>
            <div class="vk-pilot-main">
                <div class="vk-pilot-head">
                    <span>Pilot</span>
                    <small v-if="pilot.level < pilot.maxLevel">{{ formatNumber(pilot.into, false) }} / {{ formatNumber(pilot.span, false) }} XP</small>
                    <small v-else>Max level</small>
                </div>
                <div class="vk-xp"><div :style="{ width: `${pilot.progress * 100}%` }" /></div>
                <div class="vk-pilot-sub">
                    {{ pilot.points }} {{ pilot.points === 1 ? 'point' : 'points' }} per tree<template v-if="pilot.nextPointLevel"> · next at Lv {{ pilot.nextPointLevel }}</template>
                </div>
            </div>
        </div>

        <div class="vk-grid">
            <button
                v-for="s in skills"
                :key="s.id"
                class="vk-skill"
                :class="{ 'vk-on': selected?.id === s.id, 'vk-eq': equipped === s.id, 'vk-locked': !s.unlocked }"
                :style="{ '--c': hex(s.color) }"
                @click="select(s.id)"
            >
                <UIcon :name="s.unlocked ? s.icon : 'i-lucide-lock'" class="size-5" />
                <span>{{ s.name }}</span>
                <small v-if="equipped === s.id">Q</small>
            </button>
        </div>

        <div v-if="selected" class="vk-detail" :style="{ '--c': hex(selected.color) }">
            <div class="vk-detail-head">
                <UIcon :name="selected.icon" class="size-5" />
                <b>{{ selected.name }}</b>
                <span class="vk-cd">{{ cooldownOf(selected.id) }}s</span>
            </div>
            <p>{{ selected.description }}</p>

            <div v-if="!selected.unlocked" class="vh-card-foot">
                <template v-if="selected.available">
                    <VoidCost :cost="selected.cost" :held="resources" :coins="selected.coins" :gems="selected.gems" :balance="balance" :gems-held="gems" />
                    <button class="vr-btn vr-btn-sm" :disabled="busy || !selected.affordable" @click="$emit('unlock', selected.id)">Unlock</button>
                </template>
                <span v-else class="vh-tag vh-tag-bad">Clear sector {{ selected.requiresSector }}</span>
            </div>
            <div v-else-if="equipped !== selected.id" class="vh-card-foot">
                <span />
                <button class="vr-btn vr-btn-sm vr-btn-primary" :disabled="busy" @click="$emit('equip', selected.id)">Equip on Q</button>
            </div>

            <div class="vk-tree-head">
                <span>Tree</span>
                <small>{{ allocated.length }} / {{ pilot.points }}</small>
                <button v-if="selected.unlocked && allocated.length" class="vk-reset" :disabled="busy" @click="commit([])">Reset</button>
            </div>
            <div class="vk-tree" :class="{ 'vk-tree-locked': !selected.unlocked }">
                <svg class="vk-links" viewBox="0 0 300 320" preserveAspectRatio="none">
                    <line
                        v-for="l in links"
                        :key="l.key"
                        :x1="l.x1"
                        :y1="l.y1"
                        :x2="l.x2"
                        :y2="l.y2"
                        :class="{ 'vk-link-on': l.on }"
                    />
                </svg>
                <button
                    v-for="n in selected.nodes"
                    :key="n.id"
                    class="vk-node"
                    :class="{
                        'vk-node-on': allocated.includes(n.id),
                        'vk-node-open': canAdd(n.id),
                        'vk-key': n.keystone
                    }"
                    :style="{ left: `${pos(n).x / 3}%`, top: `${pos(n).y / 3.2}%` }"
                    :disabled="busy || !selected.unlocked"
                    @mouseenter="hover = n.id"
                    @mouseleave="hover = null"
                    @click="toggle(n.id)"
                >
                    <i />
                </button>
            </div>
            <div class="vk-tip">
                <template v-if="tipNode">
                    <b>{{ tipNode.name }}<small v-if="tipNode.keystone"> · keystone</small></b>
                    <span>{{ tipNode.description }}</span>
                </template>
                <span v-else class="vk-tip-idle">Hover a node. Only one keystone per tree.</span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { voidHex, type VoidResourceBundle } from '#shared/utils/gamelogic/void'
import { voidSkillCooldown, voidSkillParams, voidSkill, type VoidSkillNode } from '#shared/utils/gamelogic/void-skills'
import VoidCost from './VoidCost.vue'

interface SkillView {
    id: string
    name: string
    description: string
    color: number
    icon: string
    requiresSector: number
    cost: VoidResourceBundle
    coins: number
    gems: number
    nodes: VoidSkillNode[]
    unlocked: boolean
    available: boolean
    affordable: boolean
    nodesAllocated: string[]
}

const props = defineProps<{
    skills: SkillView[]
    equipped: string
    pilot: { level: number, maxLevel: number, points: number, nextPointLevel: number | null, into: number, span: number, progress: number }
    resources: VoidResourceBundle
    balance: number
    gems: number
    busy: boolean
}>()

const emit = defineEmits<{
    unlock: [skillId: string]
    equip: [skillId: string]
    nodes: [skillId: string, nodes: string[]]
}>()

const selectedId = ref(props.equipped)
const hover = ref<string | null>(null)
const selected = computed(() => props.skills.find(s => s.id === selectedId.value) ?? props.skills[0] ?? null)
const allocated = computed(() => selected.value?.nodesAllocated ?? [])
const tipNode = computed(() => selected.value?.nodes.find(n => n.id === hover.value) ?? null)

function hex(color: number) {
    return voidHex(color)
}

function select(id: string) {
    selectedId.value = id
}

function cooldownOf(id: string) {
    const nodes = props.skills.find(s => s.id === id)?.nodesAllocated ?? []
    return Math.round(voidSkillCooldown(voidSkillParams(id, nodes)) * 10) / 10
}

function pos(n: VoidSkillNode) {
    return { x: 50 + n.x * 100, y: 40 + n.y * 80 }
}

const links = computed(() => {
    const s = selected.value
    if (!s) return []
    const out: { key: string, x1: number, y1: number, x2: number, y2: number, on: boolean }[] = []
    for (const n of s.nodes) {
        for (const r of n.requires) {
            const parent = s.nodes.find(x => x.id === r)!
            const a = pos(parent)
            const b = pos(n)
            out.push({ key: `${r}-${n.id}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y, on: allocated.value.includes(r) && allocated.value.includes(n.id) })
        }
    }
    return out
})

function canAdd(id: string) {
    const s = selected.value
    if (!s?.unlocked || allocated.value.includes(id)) return false
    if (allocated.value.length >= props.pilot.points) return false
    const node = s.nodes.find(n => n.id === id)!
    if (node.keystone && s.nodes.some(n => n.keystone && allocated.value.includes(n.id))) return false
    return !node.requires.length || node.requires.some(r => allocated.value.includes(r))
}

/** Removing a node also drops anything that hung off it. */
function withoutNode(id: string) {
    const s = voidSkill(selected.value!.id)
    let set = new Set(allocated.value.filter(x => x !== id))
    let changed = true
    while (changed) {
        changed = false
        for (const n of s.nodes) {
            if (set.has(n.id) && n.requires.length && !n.requires.some(r => set.has(r))) {
                set.delete(n.id)
                changed = true
            }
        }
    }
    set = new Set(s.nodes.filter(n => set.has(n.id)).map(n => n.id))
    return [...set]
}

function toggle(id: string) {
    if (!selected.value?.unlocked) return
    if (allocated.value.includes(id)) commit(withoutNode(id))
    else if (canAdd(id)) commit([...allocated.value, id])
}

function commit(nodes: string[]) {
    emit('nodes', selected.value!.id, nodes)
}
</script>

<style>
.vk { display: grid; gap: 12px; margin-top: 14px; }
.vk-pilot { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid rgba(255, 210, 122, 0.3); background: linear-gradient(90deg, rgba(255, 210, 122, 0.08), transparent); }
.vk-level { display: grid; place-items: center; width: 50px; height: 50px; clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%); background: rgba(255, 210, 122, 0.14); color: var(--vr-gold); line-height: 1; }
.vk-level span { font-size: 9px; letter-spacing: 0.2em; text-transform: uppercase; margin-top: 8px; }
.vk-level b { font-size: 20px; margin-bottom: 6px; }
.vk-pilot-main { flex: 1; }
.vk-pilot-head { display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; font-weight: 700; letter-spacing: 0.25em; text-transform: uppercase; }
.vk-pilot-head small { font: 600 11px 'JetBrains Mono', monospace; letter-spacing: 0; color: var(--vr-muted); }
.vk-xp { height: 4px; margin: 6px 0 5px; background: rgba(255, 255, 255, 0.08); }
.vk-xp div { height: 100%; background: linear-gradient(90deg, #ffb347, var(--vr-gold)); box-shadow: 0 0 8px rgba(255, 210, 122, 0.6); }
.vk-pilot-sub { font-size: 12px; color: var(--vr-muted); }

.vk-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px; }
.vk-skill { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 4px 8px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--vr-line); color: var(--c); cursor: pointer; transition: background 0.15s, border-color 0.15s; }
.vk-skill span { font-size: 12px; font-weight: 700; line-height: 1.1; text-align: center; color: var(--vr-text); }
.vk-skill small { position: absolute; top: 3px; right: 5px; font: 700 10px 'JetBrains Mono', monospace; color: var(--c); }
.vk-skill:hover { background: rgba(255, 255, 255, 0.07); }
.vk-on { border-color: var(--c); background: color-mix(in srgb, var(--c) 12%, transparent); }
.vk-eq { box-shadow: inset 0 -2px 0 var(--c); }
.vk-locked { color: var(--vr-muted); }
.vk-locked span { color: var(--vr-muted); }

.vk-detail { padding: 10px 12px; border: 1px solid var(--vr-line); border-top: 2px solid var(--c); background: rgba(255, 255, 255, 0.025); }
.vk-detail-head { display: flex; align-items: center; gap: 8px; font-size: 17px; color: var(--c); }
.vk-detail-head b { color: var(--vr-text); letter-spacing: 0.06em; }
.vk-cd { margin-left: auto; font: 600 12px 'JetBrains Mono', monospace; color: var(--vr-muted); }
.vk-detail p { margin: 4px 0 6px; font-size: 13px; line-height: 1.3; color: rgba(230, 241, 255, 0.7); }
.vk-tree-head { display: flex; align-items: baseline; gap: 8px; margin-top: 12px; font-size: 12px; font-weight: 700; letter-spacing: 0.3em; text-transform: uppercase; }
.vk-tree-head small { font: 600 11px 'JetBrains Mono', monospace; letter-spacing: 0; color: var(--vr-gold); }
.vk-reset { margin-left: auto; font-size: 11px; letter-spacing: 0.15em; color: var(--vr-muted); cursor: pointer; }
.vk-reset:hover { color: var(--vr-text); }
.vk-tree { position: relative; height: 290px; margin-top: 6px; }
.vk-tree-locked { opacity: 0.45; }
.vk-links { position: absolute; inset: 0; width: 100%; height: 100%; }
.vk-links line { stroke: rgba(255, 255, 255, 0.12); stroke-width: 2; }
.vk-links .vk-link-on { stroke: var(--c); filter: drop-shadow(0 0 3px var(--c)); }
.vk-node { position: absolute; width: 34px; height: 34px; margin: -17px 0 0 -17px; display: grid; place-items: center; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.18); background: #0a1322; cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s, transform 0.1s; }
.vk-node i { width: 12px; height: 12px; border-radius: 50%; background: rgba(255, 255, 255, 0.12); transition: background 0.15s; }
.vk-node:hover:not(:disabled) { transform: scale(1.1); }
.vk-node:disabled { cursor: default; }
.vk-node-open { border-color: color-mix(in srgb, var(--c) 70%, transparent); animation: vk-breathe 1.8s ease-in-out infinite; }
.vk-node-on { border-color: var(--c); box-shadow: 0 0 14px color-mix(in srgb, var(--c) 70%, transparent); }
.vk-node-on i { background: var(--c); box-shadow: 0 0 8px var(--c); }
.vk-key { width: 42px; height: 42px; margin: -21px 0 0 -21px; border-radius: 4px; transform: rotate(45deg); }
.vk-key:hover:not(:disabled) { transform: rotate(45deg) scale(1.1); }
.vk-key i { width: 14px; height: 14px; border-radius: 2px; }
@keyframes vk-breathe { 50% { box-shadow: 0 0 10px color-mix(in srgb, var(--c) 45%, transparent); } }
.vk-tip { min-height: 40px; margin-top: 6px; padding-top: 8px; border-top: 1px solid var(--vr-line); font-size: 13px; }
.vk-tip b { display: block; font-weight: 700; color: var(--c); }
.vk-tip b small { color: var(--vr-gold); font-weight: 600; }
.vk-tip span { color: rgba(230, 241, 255, 0.78); }
.vk-tip .vk-tip-idle { color: var(--vr-muted); }
</style>

<style>
/* Page redesign: skills down the left, the tree on the right. */
.vh-page .vk { grid-template-columns: 280px minmax(0, 1fr); grid-template-rows: auto 1fr; gap: 16px; margin-top: 0; align-items: start; }
.vh-page .vk-pilot { grid-column: 1; padding: 14px; background: var(--vr-panel); border: 1px solid var(--vr-line); border-radius: 12px; }
.vh-page .vk-pilot-head { font-size: 14px; letter-spacing: 0.03em; text-transform: none; }
.vh-page .vk-xp { border-radius: 2px; overflow: hidden; }
.vh-page .vk-grid { grid-column: 1; grid-template-columns: minmax(0, 1fr); gap: 4px; padding: 6px; background: var(--vr-panel); border: 1px solid var(--vr-line); border-radius: 12px; }
.vh-page .vk-skill { flex-direction: row; gap: 10px; padding: 10px 12px; background: none; border: 1px solid transparent; border-radius: 8px; }
.vh-page .vk-skill span { font-size: 15px; text-align: left; }
.vh-page .vk-skill small { position: static; margin-left: auto; padding: 1px 7px; color: #04121c; background: var(--c); border-radius: 5px; }
.vh-page .vk-skill:hover { background: rgba(255, 255, 255, 0.05); }
.vh-page .vk-on { border-color: var(--c); background: color-mix(in srgb, var(--c) 10%, transparent); }
.vh-page .vk-eq { box-shadow: none; }
.vh-page .vk-detail { grid-column: 2; grid-row: 1 / span 2; padding: 20px 24px; background: var(--vr-panel); border: 1px solid var(--vr-line); border-radius: 12px; }
.vh-page .vk-detail-head { font-size: 20px; }
.vh-page .vk-detail p { font-size: 14px; }
.vh-page .vk-tree-head { letter-spacing: 0.1em; color: var(--vr-muted); }
.vh-page .vk-tree { height: 340px; max-width: 560px; margin: 10px auto 0; }
@media (max-width: 900px) { .vh-page .vk { grid-template-columns: minmax(0, 1fr); } .vh-page .vk-detail { grid-column: 1; grid-row: auto; } }
</style>
