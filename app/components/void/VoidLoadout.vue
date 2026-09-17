<template>
    <div class="vl">
        <!-- Ship summary -->
        <div class="vl-bar">
            <div class="vl-ship">
                <span>Flying</span>
                <b>{{ ship.name }}</b>
            </div>
            <div class="vl-stats">
                <div><span>Power</span><b>{{ formatNumber(ship.power, false) }}</b></div>
                <div><span>Hull</span><b>{{ formatNumber(ship.stats.hull) }}</b></div>
                <div><span>Shield</span><b>{{ formatNumber(ship.stats.shield) }}</b></div>
                <div v-if="ship.stats.resist > 0"><span>Resist</span><b>{{ Math.round(ship.stats.resist * 100) }}%</b></div>
                <div><span>Hold</span><b>{{ formatNumber(ship.stats.cargo) }}</b></div>
            </div>
            <div class="vl-bar-actions">
                <button class="vr-btn vr-btn-sm" :disabled="busy" title="Put your strongest item in every slot" @click="autoFit">
                    <UIcon name="i-lucide-wand-sparkles" class="size-4" /> Auto-fit best gear
                </button>
            </div>
        </div>

        <div class="vl-main">
            <!-- ═══ Hardpoints ═══ -->
            <section class="vl-frame">
                <h3 class="vl-title">Hardpoints <small>Click a slot, then pick gear on the right. You can also drag gear onto a slot.</small></h3>
                <div v-for="group in groups" :key="group.key" class="vl-group">
                    <div class="vl-group-head">
                        <UIcon :name="group.icon" class="size-4" />
                        <b>{{ group.label }}</b>
                        <kbd v-if="group.key_">{{ group.key_ }}</kbd>
                        <small>{{ group.hint }}</small>
                    </div>
                    <div class="vl-slots">
                        <button
                            v-for="(id, i) in group.slots"
                            :key="`${group.key}-${i}`"
                            class="vl-slot"
                            :class="{ 'vl-slot-on': selected.key === group.key && selected.index === i, 'vl-slot-empty': !itemById(id), 'vl-slot-drop': dropTarget === `${group.key}-${i}`, 'vl-slot-no': badTarget === `${group.key}-${i}` }"
                            :style="itemById(id) ? { '--rc': itemById(id)!.rarityColor } : {}"
                            @click="select(group.key, i)"
                            @dragover.prevent="onDragOver($event, group, i)"
                            @dragleave="clearDrag()"
                            @drop.prevent="onDrop(group, i)"
                        >
                            <template v-if="itemById(id)">
                                <span class="vl-slot-top">
                                    <i class="vf-tier">T{{ itemById(id)!.tier }}</i>
                                    <b>{{ itemById(id)!.name }}</b>
                                    <em v-if="itemById(id)!.level">+{{ itemById(id)!.level }}</em>
                                </span>
                                <span class="vl-slot-sub">
                                    <span>{{ itemById(id)!.rarityName }}</span>
                                    <span v-for="st in itemById(id)!.stats.slice(0, 2)" :key="st.label">{{ st.label }} {{ st.value }}</span>
                                    <UIcon v-if="itemById(id)!.modInfo" name="i-lucide-gem" class="size-3 vl-slot-mod" :style="{ color: itemById(id)!.modInfo!.color ? hex(itemById(id)!.modInfo!.color) : undefined }" :title="itemById(id)!.modInfo!.name" />
                                </span>
                            </template>
                            <template v-else>
                                <span class="vl-slot-top"><UIcon name="i-lucide-plus" class="size-4" /><b>Empty {{ group.single.toLowerCase() }} slot</b></span>
                                <span class="vl-slot-sub"><span>{{ countFor(group.kind) ? 'Click to fit one' : 'None owned yet' }}</span></span>
                            </template>
                        </button>
                    </div>
                </div>
            </section>

            <!-- ═══ Armory ═══ -->
            <section class="vl-armory">
                <h3 class="vl-title">
                    {{ current.group.label }}<template v-if="current.group.slots.length > 1"> · slot {{ selected.index + 1 }}</template>
                    <small>{{ current.group.hint }}</small>
                </h3>
                <div class="vl-current" :style="currentItem ? { '--rc': currentItem.rarityColor } : {}">
                    <span class="vl-current-label">In this slot</span>
                    <template v-if="currentItem">
                        <i class="vf-tier">T{{ currentItem.tier }}</i>
                        <b>{{ currentItem.name }}</b>
                        <em v-if="currentItem.level">+{{ currentItem.level }}</em>
                        <span class="vl-current-stats">{{ currentItem.stats.map(s => `${s.label} ${s.value}`).join(' · ') }}</span>
                        <button class="vr-btn vr-btn-sm" :disabled="busy" @click="fit(selected.key, selected.index, null)">Unequip</button>
                    </template>
                    <span v-else class="vl-current-none">Nothing fitted</span>
                </div>

                <div v-if="candidates.length" class="vl-grid">
                    <button
                        v-for="item in candidates"
                        :key="item.id"
                        class="vl-tile"
                        :class="{ 'vl-tile-here': item.id === currentItem?.id }"
                        :style="{ '--rc': item.rarityColor }"
                        :disabled="busy"
                        draggable="true"
                        @click="item.id === currentItem?.id ? undefined : fit(selected.key, selected.index, item.id)"
                        @dragstart="onDragStart($event, item.id)"
                        @dragend="dragged = null; dropTarget = null"
                    >
                        <span class="vl-tile-head">
                            <i class="vf-tier">T{{ item.tier }}</i>
                            <b>{{ item.name }}</b>
                            <em v-if="item.level">+{{ item.level }}</em>
                        </span>
                        <span class="vl-tile-rarity">{{ item.rarityName }}<template v-if="item.affixList.length"> · {{ item.affixList.length }} bonus</template><template v-if="item.modInfo"> · mod</template></span>
                        <span class="vl-tile-stats">
                            <span v-for="st in item.stats" :key="st.label">{{ st.label }} <b>{{ st.value }}</b></span>
                        </span>
                        <span class="vl-tile-foot">
                            <span v-if="item.id === currentItem?.id" class="vl-delta">Equipped here</span>
                            <span v-else class="vl-delta" :class="deltaClass(item.score)">{{ deltaText(item.score) }}</span>
                            <small v-if="placedElsewhere(item.id)">{{ placedElsewhere(item.id) }}</small>
                        </span>
                    </button>
                </div>
                <div v-else class="vw-empty">
                    <p>You don't own any {{ current.group.label.toLowerCase() }} yet.</p>
                    <button class="vr-btn vr-btn-sm vr-btn-primary" @click="$emit('craft')">Craft one in the Workshop</button>
                </div>
            </section>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { InternalApi } from 'nitropack/types'
import { voidAutoFit, voidHex } from '#shared/utils/gamelogic/void'
import type { VoidItem } from '#shared/utils/gamelogic/void-items'

type State = InternalApi['/api/void/state']['get']
type Kind = 'gun' | 'turret' | 'armor' | 'shield' | 'secondary' | 'device'
type GroupKey = 'gun' | 'turrets' | 'armor' | 'shields' | 'secondary' | 'device'
type Fit = { gun: string | null, turrets: (string | null)[], armor: (string | null)[], shields: (string | null)[], secondary: string | null, device: string | null }
interface Group { key: GroupKey, kind: Kind, label: string, single: string, icon: string, hint: string, key_: string | null, slots: (string | null)[] }

const props = defineProps<{
    state: State
    busy: boolean
}>()

const emit = defineEmits<{
    'set-fit': [shipId: string, fit: Fit]
    'craft': []
}>()

const ship = computed(() => props.state.ships.find(s => s.equipped) ?? props.state.ships[0]!)
const byId = computed(() => new Map(props.state.items.map(i => [i.id, i])))

const groups = computed<Group[]>(() => {
    const f = ship.value.fit
    return [
        { key: 'gun', kind: 'gun', label: 'Primary gun', single: 'Gun', icon: 'i-lucide-crosshair', hint: 'You aim and fire it with left mouse', key_: 'LMB', slots: [f.gun] },
        { key: 'turrets', kind: 'turret', label: 'Turrets', single: 'Turret', icon: 'i-lucide-radar', hint: 'Pick targets and fire on their own', key_: null, slots: f.turrets },
        { key: 'secondary', kind: 'secondary', label: 'Secondary', single: 'Secondary', icon: 'i-lucide-rocket', hint: 'Hold to lock on, release to fire', key_: 'E', slots: [f.secondary] },
        { key: 'device', kind: 'device', label: 'Device', single: 'Device', icon: 'i-lucide-cpu', hint: 'A gadget like a shield boost or decoy', key_: 'G', slots: [f.device] },
        { key: 'armor', kind: 'armor', label: 'Armour', single: 'Armour', icon: 'i-lucide-shield-half', hint: 'More hull and damage resistance', key_: null, slots: f.armor },
        { key: 'shields', kind: 'shield', label: 'Shields', single: 'Shield', icon: 'i-lucide-shield', hint: 'A recharging pool that soaks hits first', key_: null, slots: f.shields }
    ]
})

const selected = ref<{ key: GroupKey, index: number }>({ key: 'gun', index: 0 })
const dragged = ref<string | null>(null)
const dropTarget = ref<string | null>(null)
/** A slot the dragged item does not fit, outlined in red so the refusal is visible. */
const badTarget = ref<string | null>(null)

const current = computed(() => {
    const group = groups.value.find(g => g.key === selected.value.key) ?? groups.value[0]!
    return { group, id: group.slots[selected.value.index] ?? null }
})
const currentItem = computed(() => itemById(current.value.id))
const candidates = computed(() => props.state.items
    .filter(i => i.kind === current.value.group.kind)
    .sort((a, b) => b.score - a.score))

// A hull swap can shrink a group; keep the selection on a real slot.
watch(groups, (list) => {
    const group = list.find(g => g.key === selected.value.key)
    if (!group) selected.value = { key: 'gun', index: 0 }
    else if (selected.value.index >= group.slots.length) selected.value = { key: group.key, index: Math.max(0, group.slots.length - 1) }
})

function hex(color: number) {
    return voidHex(color)
}

function itemById(id: string | null) {
    return id ? byId.value.get(id) ?? null : null
}

function countFor(kind: Kind) {
    return props.state.items.filter(i => i.kind === kind).length
}

function select(key: GroupKey, index: number) {
    selected.value = { key, index }
}

function deltaText(score: number) {
    const d = score - (currentItem.value?.score ?? 0)
    return d === 0 ? 'Same score' : `${d > 0 ? '▲ +' : '▼ '}${d} score`
}

function deltaClass(score: number) {
    const d = score - (currentItem.value?.score ?? 0)
    return d > 0 ? 'vf-up' : d < 0 ? 'vf-down' : ''
}

/** Where else an item sits: another slot on this hull, or another ship. */
function placedElsewhere(itemId: string) {
    for (const g of groups.value) {
        const i = g.slots.indexOf(itemId)
        if (i >= 0 && !(g.key === selected.value.key && i === selected.value.index)) return g.slots.length > 1 ? `Moves from ${g.single} ${i + 1}` : `Moves from ${g.single}`
    }
    const other = props.state.ships.find(s => s.owned && !s.equipped && [s.fit.gun, ...s.fit.turrets, ...s.fit.armor, ...s.fit.shields, s.fit.secondary, s.fit.device].includes(itemId))
    return other ? `Also on ${other.name}` : ''
}

/** Firefox only starts a drag once data is set, so always fill the transfer. */
function onDragStart(e: DragEvent, itemId: string) {
    dragged.value = itemId
    if (!e.dataTransfer) return
    e.dataTransfer.setData('text/plain', itemId)
    e.dataTransfer.effectAllowed = 'move'
}

function clearDrag() {
    dropTarget.value = null
    badTarget.value = null
}

function onDragOver(e: DragEvent, group: Group, index: number) {
    const item = itemById(dragged.value)
    const fits = !!item && item.kind === group.kind
    dropTarget.value = fits ? `${group.key}-${index}` : null
    badTarget.value = fits ? null : `${group.key}-${index}`
    if (e.dataTransfer) e.dataTransfer.dropEffect = fits ? 'move' : 'none'
}

function onDrop(group: Group, index: number) {
    const item = itemById(dragged.value)
    clearDrag()
    dragged.value = null
    if (!item || item.kind !== group.kind) return
    select(group.key, index)
    fit(group.key, index, item.id)
}

function fit(key: GroupKey, index: number, itemId: string | null) {
    const f = ship.value.fit
    const next: Fit = { gun: f.gun, turrets: [...f.turrets], armor: [...f.armor], shields: [...f.shields], secondary: f.secondary, device: f.device }
    // An item lives in one slot on a hull: moving it clears the old slot.
    if (itemId) {
        if (next.gun === itemId) next.gun = null
        if (next.secondary === itemId) next.secondary = null
        if (next.device === itemId) next.device = null
        for (const list of [next.turrets, next.armor, next.shields]) {
            for (let i = 0; i < list.length; i++) if (list[i] === itemId) list[i] = null
        }
    }
    if (key === 'gun' || key === 'secondary' || key === 'device') next[key] = itemId
    // Never write past the end of a list: a shorter hull would leave a hole the server drops.
    else next[key][Math.min(index, next[key].length - 1)] = itemId
    emit('set-fit', ship.value.id, next)
}

function autoFit() {
    emit('set-fit', ship.value.id, voidAutoFit(ship.value.id, props.state.items as unknown as VoidItem[]))
}
</script>

<style>
.vl { display: grid; gap: 14px; }
.vl-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px; padding: 12px 16px; border: 1px solid var(--vr-line-strong); background: linear-gradient(100deg, rgba(94, 200, 255, 0.1), rgba(255, 255, 255, 0.02) 60%); }
.vl-ship span { display: block; font-size: 10px; font-weight: 700; letter-spacing: 0.35em; text-transform: uppercase; color: var(--vr-accent); }
.vl-ship b { font-size: 26px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
.vl-stats { display: flex; flex-wrap: wrap; gap: 6px; }
.vl-stats div { min-width: 86px; padding: 5px 10px; border: 1px solid var(--vr-line); background: rgba(255, 255, 255, 0.03); }
.vl-stats span { display: block; font-size: 9px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--vr-muted); }
.vl-stats b { font: 600 16px 'JetBrains Mono', monospace; }
.vl-bar-actions { margin-left: auto; }

.vl-main { display: grid; grid-template-columns: minmax(340px, 5fr) minmax(0, 7fr); gap: 14px; align-items: start; }
.vl-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; margin: 0 0 10px; font-size: 14px; font-weight: 700; letter-spacing: 0.25em; text-transform: uppercase; }
.vl-title small { font-size: 12px; font-weight: 500; letter-spacing: 0.02em; text-transform: none; color: var(--vr-muted); }

.vl-frame { position: sticky; top: 12px; padding: 14px; border: 1px solid var(--vr-line-strong); background: radial-gradient(ellipse at 50% 0%, rgba(94, 200, 255, 0.1), transparent 70%), rgba(6, 12, 24, 0.6); clip-path: polygon(16px 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%, 0 16px); }
.vl-group { margin-top: 12px; }
.vl-group:first-of-type { margin-top: 0; }
.vl-group-head { display: flex; align-items: center; gap: 7px; margin-bottom: 5px; color: var(--vr-accent); }
.vl-group-head b { font-size: 12px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: var(--vr-text); }
.vl-group-head small { margin-left: auto; font-size: 11px; color: var(--vr-muted); text-align: right; }
.vl-slots { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 6px; }
.vl-slot { --rc: rgba(255, 255, 255, 0.25); display: flex; flex-direction: column; gap: 3px; min-height: 58px; padding: 8px 10px; text-align: left; background: linear-gradient(135deg, color-mix(in srgb, var(--rc) 14%, transparent), rgba(255, 255, 255, 0.02) 60%); border: 1px solid color-mix(in srgb, var(--rc) 45%, transparent); border-left: 3px solid var(--rc); cursor: pointer; transition: background 0.15s, box-shadow 0.15s, transform 0.1s; }
.vl-slot:hover { transform: translateY(-1px); background: linear-gradient(135deg, color-mix(in srgb, var(--rc) 24%, transparent), rgba(255, 255, 255, 0.04) 60%); }
.vl-slot-empty { border-style: dashed; color: var(--vr-muted); }
.vl-slot-on { box-shadow: 0 0 0 2px var(--vr-accent), 0 0 22px rgba(94, 200, 255, 0.35); }
.vl-slot-drop { box-shadow: 0 0 0 2px var(--vr-good), 0 0 22px rgba(61, 255, 176, 0.4); }
.vl-slot-no { box-shadow: 0 0 0 2px var(--vr-bad); cursor: not-allowed; }
.vl-slot-mod { filter: drop-shadow(0 0 4px currentColor); }
.vl-slot-top { display: flex; align-items: center; gap: 6px; font-size: 14px; min-width: 0; }
.vl-slot-top b { font-weight: 700; color: var(--rc); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vl-slot-empty .vl-slot-top b { color: var(--vr-muted); }
.vl-slot-top em { font-style: normal; font: 700 12px 'JetBrains Mono', monospace; color: var(--vr-gold); }
.vl-slot-sub { display: flex; flex-wrap: wrap; gap: 2px 10px; font: 600 11px 'JetBrains Mono', monospace; color: var(--vr-muted); }

.vl-armory { min-width: 0; }
.vl-current { --rc: var(--vr-line-strong); display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin-bottom: 12px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--rc) 50%, transparent); border-left: 3px solid var(--rc); background: rgba(255, 255, 255, 0.03); }
.vl-current-label { font-size: 10px; font-weight: 700; letter-spacing: 0.25em; text-transform: uppercase; color: var(--vr-muted); }
.vl-current b { color: var(--rc); font-size: 15px; }
.vl-current em { font-style: normal; font: 700 12px 'JetBrains Mono', monospace; color: var(--vr-gold); }
.vl-current-stats { font: 600 11px 'JetBrains Mono', monospace; color: var(--vr-muted); }
.vl-current .vr-btn { margin-left: auto; }
.vl-current-none { font-size: 13px; color: var(--vr-muted); }
.vl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 8px; }
.vl-tile { --rc: #fff; display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; text-align: left; background: linear-gradient(160deg, color-mix(in srgb, var(--rc) 12%, transparent), rgba(255, 255, 255, 0.02) 55%); border: 1px solid color-mix(in srgb, var(--rc) 35%, transparent); border-top: 3px solid var(--rc); cursor: grab; transition: transform 0.1s, box-shadow 0.15s; }
.vl-tile:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 6px 20px color-mix(in srgb, var(--rc) 25%, transparent); }
.vl-tile:disabled { cursor: default; }
.vl-tile-here { box-shadow: 0 0 0 1px var(--vr-good); }
.vl-tile-head { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 15px; }
.vl-tile-head b { color: var(--rc); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vl-tile-head em { font-style: normal; font: 700 12px 'JetBrains Mono', monospace; color: var(--vr-gold); }
.vl-tile-rarity { font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: var(--rc); }
.vl-tile-stats { display: flex; flex-wrap: wrap; gap: 2px 10px; font-size: 12px; color: var(--vr-muted); }
.vl-tile-stats b { font-family: 'JetBrains Mono', monospace; color: var(--vr-text); }
.vl-tile-foot { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; margin-top: auto; padding-top: 4px; border-top: 1px solid var(--vr-line); }
.vl-delta { font: 700 12px 'JetBrains Mono', monospace; color: var(--vr-muted); }
.vl-tile-here .vl-delta { color: var(--vr-good); }
.vl-tile-foot small { margin-left: auto; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--vr-warn); }

@media (max-width: 900px) {
    .vl-main { grid-template-columns: minmax(0, 1fr); }
    .vl-frame { position: static; }
}
</style>
