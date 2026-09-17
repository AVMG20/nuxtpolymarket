<template>
    <div class="vf">
        <div class="vf-summary">
            <div><span>Power</span><b>{{ formatNumber(ship.power, false) }}</b></div>
            <div><span>Hull</span><b>{{ formatNumber(ship.stats.hull) }}</b></div>
            <div><span>Shield</span><b>{{ formatNumber(ship.stats.shield) }}</b></div>
            <div v-if="ship.stats.resist > 0"><span>Resist</span><b>{{ Math.round(ship.stats.resist * 100) }}%</b></div>
            <div><span>Hold</span><b>{{ formatNumber(ship.stats.cargo) }}</b></div>
        </div>
        <div class="vf-actions">
            <button class="vr-btn vr-btn-sm" :disabled="busy" @click="autoFit">Auto-fit best gear</button>
            <small>{{ ship.name }} · {{ ship.turrets }} turrets · {{ ship.armor }} armour · {{ ship.shields }} shield</small>
        </div>

        <section v-for="group in groups" :key="group.key" class="vf-group">
            <h2 class="vh-h">{{ group.label }} <small>{{ group.hint }}</small></h2>
            <div class="vf-slots" :class="{ 'vf-slots-one': group.slots.length === 1 }">
                <button
                    v-for="(id, i) in group.slots"
                    :key="`${group.key}-${i}`"
                    class="vf-slot"
                    :class="{ 'vf-open': open?.key === group.key && open.index === i, 'vf-empty': !itemById(id) }"
                    :style="slotStyle(id)"
                    @click="toggle(group.key, i)"
                >
                    <template v-if="itemById(id)">
                        <span class="vf-slot-top">
                            <i class="vf-tier">T{{ itemById(id)!.tier }}</i>
                            <b>{{ itemById(id)!.name }}</b>
                            <em v-if="itemById(id)!.level">+{{ itemById(id)!.level }}</em>
                        </span>
                        <span class="vf-slot-sub">
                            <span v-for="st in itemById(id)!.stats" :key="st.label">{{ st.label }} {{ st.value }}</span>
                            <UIcon v-if="itemById(id)!.modInfo" name="i-lucide-gem" class="size-3 vf-mod" :style="{ color: hex(itemById(id)!.modInfo!.color) }" />
                        </span>
                    </template>
                    <template v-else>
                        <span class="vf-slot-top"><b>Empty</b></span>
                        <span class="vf-slot-sub">Click to fit</span>
                    </template>
                </button>
            </div>
            <div v-if="open?.key === group.key" class="vf-picker">
                <button v-if="itemById(group.slots[open.index] ?? null)" class="vf-pick vf-pick-remove" @click="fit(group.key, open.index, null)">
                    <UIcon name="i-lucide-x" class="size-3" /> Remove
                </button>
                <button
                    v-for="item in candidates(group.kind)"
                    :key="item.id"
                    class="vf-pick"
                    :style="{ '--rc': item.rarityColor }"
                    @click="fit(group.key, open.index, item.id)"
                >
                    <i class="vf-tier">T{{ item.tier }}</i>
                    <b>{{ item.name }}<em v-if="item.level"> +{{ item.level }}</em></b>
                    <span class="vf-pick-stats">{{ item.stats.map(s => `${s.label} ${s.value}`).join(' · ') }}</span>
                    <span class="vf-delta" :class="deltaClass(item.score, group.slots[open.index] ?? null)">{{ deltaText(item.score, group.slots[open.index] ?? null) }}</span>
                    <small v-if="fittedElsewhere(item.id, group.key, open.index)">fitted</small>
                </button>
                <div v-if="!candidates(group.kind).length" class="vh-hint">No {{ group.label.toLowerCase() }} in the hangar. Craft some in the Workshop.</div>
            </div>
        </section>

        <h2 class="vh-h">Supplies <small>Keys 1-3 · each launch loads up to {{ state.supplyCarry }} of each, used or not</small></h2>
        <div class="vh-list">
            <div v-for="s in state.supplies" :key="s.id" class="vh-card vf-supply" :style="{ '--c': hex(s.color) }">
                <div class="vh-card-head">
                    <kbd>{{ s.key }}</kbd>
                    <UIcon :name="s.icon" class="size-4 vf-supply-icon" />
                    <b>{{ s.name }}</b>
                    <span class="vh-lvl">{{ s.stock }} / {{ state.supplyStockMax }}</span>
                </div>
                <p>{{ s.description }}</p>
                <div class="vh-card-foot">
                    <VoidCost :cost="s.cost.resources" :held="state.resources" :coins="s.cost.coins" :balance="state.balance" />
                    <button class="vr-btn vr-btn-sm" :disabled="busy || !s.affordable || s.stock >= state.supplyStockMax" @click="$emit('buy-supply', s.id, 1)">Buy</button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { InternalApi } from 'nitropack/types'
import { voidAutoFit, voidHex } from '#shared/utils/gamelogic/void'
import type { VoidItem } from '#shared/utils/gamelogic/void-items'
import VoidCost from './VoidCost.vue'

type State = InternalApi['/api/void/state']['get']
type Kind = 'gun' | 'turret' | 'armor' | 'shield'
type GroupKey = 'gun' | 'turrets' | 'armor' | 'shields'

const props = defineProps<{
    state: State
    busy: boolean
}>()

const emit = defineEmits<{
    'set-fit': [shipId: string, fit: { gun: string | null, turrets: (string | null)[], armor: (string | null)[], shields: (string | null)[] }]
    'buy-supply': [supplyId: string, count: number]
}>()

const open = ref<{ key: GroupKey, index: number } | null>(null)

const ship = computed(() => props.state.ships.find(s => s.equipped) ?? props.state.ships[0]!)
const byId = computed(() => new Map(props.state.items.map(i => [i.id, i])))

const groups = computed(() => {
    const f = ship.value.fit
    return [
        { key: 'gun' as const, kind: 'gun' as const, label: 'Primary gun', hint: 'You fire this', slots: [f.gun] },
        { key: 'turrets' as const, kind: 'turret' as const, label: 'Turrets', hint: 'Fire on their own', slots: f.turrets },
        { key: 'armor' as const, kind: 'armor' as const, label: 'Armour', hint: 'Hull and resist', slots: f.armor },
        { key: 'shields' as const, kind: 'shield' as const, label: 'Shields', hint: 'Recharging pool', slots: f.shields }
    ]
})

function hex(color: number) {
    return voidHex(color)
}

function itemById(id: string | null) {
    return id ? byId.value.get(id) ?? null : null
}

function slotStyle(id: string | null) {
    const item = itemById(id)
    return item ? { '--rc': item.rarityColor } : {}
}

function toggle(key: GroupKey, index: number) {
    open.value = open.value?.key === key && open.value.index === index ? null : { key, index }
}

function candidates(kind: Kind) {
    return props.state.items.filter(i => i.kind === kind)
}

function fittedElsewhere(itemId: string, key: GroupKey, index: number) {
    const f = ship.value.fit
    const lists: Record<GroupKey, (string | null)[]> = { gun: [f.gun], turrets: f.turrets, armor: f.armor, shields: f.shields }
    return Object.entries(lists).some(([k, list]) => list.some((id, i) => id === itemId && !(k === key && i === index)))
}

function deltaText(score: number, currentId: string | null) {
    const current = itemById(currentId)?.score ?? 0
    const d = score - current
    return d === 0 ? '=' : `${d > 0 ? '+' : ''}${d}`
}

function deltaClass(score: number, currentId: string | null) {
    const d = score - (itemById(currentId)?.score ?? 0)
    return d > 0 ? 'vf-up' : d < 0 ? 'vf-down' : ''
}

function fit(key: GroupKey, index: number, itemId: string | null) {
    const f = ship.value.fit
    const next = { gun: f.gun, turrets: [...f.turrets], armor: [...f.armor], shields: [...f.shields] }
    // An item lives in one slot on a hull: moving it clears the old slot.
    if (itemId) {
        if (next.gun === itemId) next.gun = null
        for (const list of [next.turrets, next.armor, next.shields]) {
            for (let i = 0; i < list.length; i++) if (list[i] === itemId) list[i] = null
        }
    }
    if (key === 'gun') next.gun = itemId
    else next[key][index] = itemId
    open.value = null
    emit('set-fit', ship.value.id, next)
}

function autoFit() {
    emit('set-fit', ship.value.id, voidAutoFit(ship.value.id, props.state.items as unknown as VoidItem[]))
}
</script>

<style>
.vf { display: grid; gap: 4px; }
.vf-summary { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; margin-top: 14px; }
.vf-summary div { padding: 6px 8px; border: 1px solid var(--vr-line); background: rgba(255, 255, 255, 0.025); }
.vf-summary span { display: block; font-size: 9px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--vr-muted); }
.vf-summary b { font: 600 14px 'JetBrains Mono', monospace; }
.vf-actions { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.vf-actions small { font-size: 11px; color: var(--vr-muted); }
.vf-slots { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.vf-slots-one { grid-template-columns: 1fr; }
.vf-slot { --rc: rgba(255, 255, 255, 0.2); display: flex; flex-direction: column; gap: 3px; min-height: 52px; padding: 7px 10px; text-align: left; background: linear-gradient(135deg, color-mix(in srgb, var(--rc) 12%, transparent), rgba(255, 255, 255, 0.02) 60%); border: 1px solid color-mix(in srgb, var(--rc) 45%, transparent); border-left: 3px solid var(--rc); cursor: pointer; transition: background 0.15s, transform 0.1s; }
.vf-slot:hover { background: linear-gradient(135deg, color-mix(in srgb, var(--rc) 22%, transparent), rgba(255, 255, 255, 0.04) 60%); }
.vf-empty { border-style: dashed; border-left-style: dashed; opacity: 0.7; }
.vf-open { box-shadow: 0 0 0 1px var(--rc), 0 0 18px color-mix(in srgb, var(--rc) 30%, transparent); }
.vf-slot-top { display: flex; align-items: baseline; gap: 6px; font-size: 14px; }
.vf-slot-top b { font-weight: 700; color: var(--rc); }
.vf-slot-top em { font-style: normal; font: 700 12px 'JetBrains Mono', monospace; color: var(--vr-gold); }
.vf-slot-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px; font: 600 11px 'JetBrains Mono', monospace; color: var(--vr-muted); }
.vf-tier { font-style: normal; font: 700 10px 'JetBrains Mono', monospace; padding: 0 4px; border: 1px solid var(--vr-line-strong); color: var(--vr-text); }
.vf-mod { filter: drop-shadow(0 0 4px currentColor); }
.vf-picker { display: grid; gap: 3px; margin-top: 6px; padding: 6px; background: #081120; border: 1px solid var(--vr-line-strong); max-height: 260px; overflow-y: auto; }
.vf-pick { --rc: #fff; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 2px 8px; padding: 6px 8px; text-align: left; border-left: 2px solid var(--rc); cursor: pointer; }
.vf-pick:hover { background: rgba(255, 255, 255, 0.06); }
.vf-pick b { color: var(--rc); font-size: 13px; }
.vf-pick b em { font-style: normal; color: var(--vr-gold); }
.vf-pick-stats { grid-column: 2; font: 600 10px 'JetBrains Mono', monospace; color: var(--vr-muted); }
.vf-pick small { grid-column: 3; font-size: 10px; color: var(--vr-muted); text-transform: uppercase; letter-spacing: 0.1em; }
.vf-delta { grid-row: 1; grid-column: 3; font: 700 12px 'JetBrains Mono', monospace; color: var(--vr-muted); }
.vf-up { color: var(--vr-good); }
.vf-down { color: var(--vr-bad); }
.vf-pick-remove { grid-template-columns: auto 1fr; color: var(--vr-muted); font-size: 12px; }
.vf-supply-icon { color: var(--c); }
</style>
