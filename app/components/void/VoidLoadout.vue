<template>
    <div class="vl">
        <!-- Ship summary -->
        <div class="vl-bar">
            <div class="vl-ship">
                <span>Flying</span>
                <b>{{ ship.name }}</b>
            </div>
            <div class="vl-stats">
                <div title="Rough combat rating: gun and turret damage plus hull and shields."><span>Power</span><b>{{ formatNumber(ship.power, false) }}</b></div>
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
                                <VoidItemArt :type="itemById(id)!.type" :tier="itemById(id)!.tier" :level="itemById(id)!.level" :rarity-color="itemById(id)!.rarityColor" size="sm" />
                                <span class="vl-slot-text">
                                    <span class="vl-slot-top">
                                        <b>{{ itemById(id)!.name }}</b>
                                        <span v-if="itemById(id)!.modInfo" class="vl-slot-mod" :title="`${itemById(id)!.modInfo!.name}: ${itemById(id)!.modInfo!.description}`"><VoidItemArt :type="itemById(id)!.modInfo!.id" size="sm" flat class="vl-mod-art" /></span>
                                    </span>
                                    <span class="vl-slot-sub">
                                        <span>{{ itemById(id)!.rarityName }}</span>
                                        <span v-for="st in itemById(id)!.stats.slice(0, 2)" :key="st.label">{{ st.label }} {{ st.value }}</span>
                                    </span>
                                </span>
                            </template>
                            <template v-else>
                                <span class="vl-slot-blank"><UIcon name="i-lucide-plus" class="size-4" /></span>
                                <span class="vl-slot-text">
                                    <span class="vl-slot-top"><b>Empty {{ group.single.toLowerCase() }} slot</b></span>
                                    <span class="vl-slot-sub"><span>{{ countFor(group.kind) ? 'Click to fit one' : 'None owned yet' }}</span></span>
                                </span>
                            </template>
                        </button>
                    </div>
                </div>
            </section>

            <!-- ═══ Armory ═══ -->
            <section class="vl-armory">
                <h3 class="vl-title">
                    {{ current.group.label }}<template v-if="current.group.slots.length > 1"> · slot {{ selected.index + 1 }}</template>
                    <small>{{ current.group.hint }} · score is a rough all-round rating, green beats what you have fitted</small>
                </h3>
                <div class="vl-current" :style="currentItem ? { '--rc': currentItem.rarityColor } : {}">
                    <span class="vl-current-label">In this slot</span>
                    <template v-if="currentItem">
                        <VoidItemArt :type="currentItem.type" :rarity-color="currentItem.rarityColor" size="sm" />
                        <i class="vf-tier">T{{ currentItem.tier }}</i>
                        <b>{{ currentItem.name }}</b>
                        <em v-if="currentItem.level">+{{ currentItem.level }}</em>
                        <span class="vl-current-stats">{{ currentItem.stats.map(s => `${s.label} ${s.value}`).join(' · ') }}</span>
                        <button class="vr-btn vr-btn-sm" :disabled="busy" @click="fit(selected.key, selected.index, null)">Unequip</button>
                    </template>
                    <span v-else class="vl-current-none">Nothing fitted</span>
                </div>

                <div v-if="candidates.length" class="vl-grid">
                    <div
                        v-for="item in candidates"
                        :key="item.id"
                        class="vl-tile"
                        :class="{ 'vl-tile-here': item.id === currentItem?.id }"
                        :style="{ '--rc': item.rarityColor }"
                        draggable="true"
                        role="button"
                        tabindex="0"
                        @click="item.id === currentItem?.id || busy ? undefined : fit(selected.key, selected.index, item.id)"
                        @keydown.enter="item.id === currentItem?.id || busy ? undefined : fit(selected.key, selected.index, item.id)"
                        @dragstart="onDragStart($event, item.id)"
                        @dragend="dragged = null; dropTarget = null"
                    >
                        <VoidItemArt :type="item.type" :tier="item.tier" :level="item.level" :rarity-color="item.rarityColor" size="md" class="vl-tile-art" />
                        <span class="vl-tile-body">
                            <span class="vl-tile-head">
                                <b>{{ item.name }}</b>
                            </span>
                            <span class="vl-tile-rarity">{{ item.rarityName }}<template v-if="item.affixList.length"> · {{ item.affixList.length }} bonus</template></span>
                            <span v-if="item.modInfo" class="vl-tile-mod" :style="{ color: hex(item.modInfo.color) }" :title="item.modInfo.description"><VoidItemArt :type="item.modInfo.id" size="sm" flat class="vl-mod-art" />{{ item.modInfo.name }}</span>
                            <span class="vl-tile-stats">
                                <span v-for="st in item.stats" :key="st.label">{{ st.label }} <b>{{ st.value }}</b></span>
                            </span>
                            <span class="vl-tile-foot">
                                <span v-if="item.id === currentItem?.id" class="vl-delta">Equipped here</span>
                                <span v-else class="vl-delta" :class="deltaClass(item.score)">{{ deltaText(item.score) }}</span>
                                <small v-if="placedElsewhere(item.id)">{{ placedElsewhere(item.id) }}</small>
                            </span>
                            <!-- Levelling, socketing and breaking down all happen here, beside the fitting. -->
                            <span class="vl-tile-levels" :title="`Level ${item.level} / 10. Levels 5 and 10 each add a bonus stat.`">
                                <i v-for="n in 10" :key="n" :class="{ 'vl-lv-on': n <= item.level, 'vl-lv-star': n === 5 || n === 10 }" />
                            </span>
                            <span class="vl-tile-actions" @click.stop>
                                <button
                                    v-if="item.upgradeCost"
                                    class="vr-btn vr-btn-sm"
                                    :disabled="busy || !item.upgradeAffordable"
                                    :title="item.upgradeAffordable ? 'Level this item up' : 'Not enough materials'"
                                    @click="$emit('upgrade', item.id)"
                                >
                                    Level up
                                </button>
                                <span v-else class="vl-maxed">Max level</span>
                                <button
                                    v-if="modsFor(item.kind).length"
                                    class="vr-btn vr-btn-sm"
                                    :disabled="busy"
                                    title="Socket a relic mod"
                                    @click="modMenu = modMenu === item.id ? null : item.id"
                                >
                                    Mod
                                </button>
                                <button
                                    class="vr-btn vr-btn-sm vr-btn-danger"
                                    :disabled="busy"
                                    :title="`Destroys the item and returns ${salvageText(item.salvage)}`"
                                    @click="salvage(item.id)"
                                >
                                    {{ confirmSalvage === item.id ? 'Sure?' : 'Break down' }}
                                </button>
                            </span>
                            <span v-if="item.upgradeCost" class="vl-tile-cost">
                                <small>Next level</small>
                                <VoidCost :cost="item.upgradeCost.resources" :held="state.resources" :coins="item.upgradeCost.coins" :gems="item.upgradeCost.gems" :balance="state.balance" :gems-held="state.gems" />
                            </span>
                            <span v-if="modMenu === item.id" class="vl-mods" @click.stop>
                                <button v-for="m in modsFor(item.kind)" :key="m.id" class="vl-mod-opt" :style="{ color: hex(m.color) }" :title="m.description" @click="socket(item.id, m.id)">
                                    <VoidItemArt :type="m.id" size="sm" flat class="vl-mod-art" />
                                    <b>{{ m.name }}</b>
                                    <em>×{{ m.count }}</em>
                                </button>
                            </span>
                        </span>
                    </div>
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
import { voidAutoFit, voidHex, voidResource } from '#shared/utils/gamelogic/void'
import type { VoidItem } from '#shared/utils/gamelogic/void-items'
import VoidCost from './VoidCost.vue'
import VoidItemArt from './VoidItemArt.vue'

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
    'upgrade': [itemId: string]
    'salvage': [itemId: string]
    'socket': [itemId: string, modId: string]
}>()

const confirmSalvage = ref<string | null>(null)
const modMenu = ref<string | null>(null)

/** Relic mods you own that fit this kind of gear. */
function modsFor(kind: string) {
    return props.state.mods.filter(m => m.count > 0 && m.kinds.includes(kind as never))
}

function socket(itemId: string, modId: string) {
    modMenu.value = null
    emit('socket', itemId, modId)
}

/** Breaking gear down is destructive, so the button asks once. */
function salvage(id: string) {
    if (confirmSalvage.value !== id) {
        confirmSalvage.value = id
        setTimeout(() => {
            if (confirmSalvage.value === id) confirmSalvage.value = null
        }, 3000)
        return
    }
    confirmSalvage.value = null
    emit('salvage', id)
}

function salvageText(bundle: Record<string, number | undefined>) {
    return Object.entries(bundle).map(([id, n]) => `${n} ${voidResource(id).name}`).join(', ')
}

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
.vl-slot { --rc: rgba(255, 255, 255, 0.25); display: flex; align-items: center; gap: 10px; min-height: 58px; padding: 8px 10px; text-align: left; background: linear-gradient(135deg, color-mix(in srgb, var(--rc) 14%, transparent), rgba(255, 255, 255, 0.02) 60%); border: 1px solid color-mix(in srgb, var(--rc) 45%, transparent); border-left: 3px solid var(--rc); cursor: pointer; transition: background 0.15s, box-shadow 0.15s, transform 0.1s; }
.vl-slot:hover { transform: translateY(-1px); background: linear-gradient(135deg, color-mix(in srgb, var(--rc) 24%, transparent), rgba(255, 255, 255, 0.04) 60%); }
.vl-slot-empty { border-style: dashed; color: var(--vr-muted); }
.vl-slot-on { box-shadow: 0 0 0 2px var(--vr-accent), 0 0 22px rgba(94, 200, 255, 0.35); }
.vl-slot-drop { box-shadow: 0 0 0 2px var(--vr-good), 0 0 22px rgba(61, 255, 176, 0.4); }
.vl-slot-no { box-shadow: 0 0 0 2px var(--vr-bad); cursor: not-allowed; }
.vl-slot-mod { filter: drop-shadow(0 0 4px currentColor); }
.vl-slot-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.vl-slot-blank { display: grid; place-items: center; width: 34px; height: 34px; flex-shrink: 0; color: var(--vr-muted); border: 1px dashed var(--vr-line-strong); }
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
.vl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px; }
.vl-tile-art { align-self: start; }
.vl-tile-levels { display: flex; gap: 2px; margin-top: 2px; }
.vl-tile-levels i { flex: 1; height: 3px; background: rgba(255, 255, 255, 0.12); }
.vl-lv-on { background: var(--rc) !important; }
.vl-lv-star { box-shadow: 0 0 0 1px rgba(255, 210, 122, 0.5); }
.vl-tile-cost { display: flex; align-items: center; gap: 8px; margin-top: 2px; font-size: 12px; }
.vl-tile-cost small { font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--vr-muted); }
.vl-tile-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.vl-maxed { align-self: center; font-size: 11px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--vr-good); }
.vl-mods { display: grid; gap: 4px; margin-top: 6px; padding: 8px; background: rgba(4, 9, 18, 0.85); border: 1px solid var(--vr-line-strong); }
.vl-mod-opt { display: flex; align-items: center; gap: 8px; padding: 4px 6px; text-align: left; font-size: 13px; cursor: pointer; }
.vl-mod-opt:hover { background: rgba(255, 255, 255, 0.06); }
.vl-mod-opt em { margin-left: auto; font-style: normal; font: 600 11px 'JetBrains Mono', monospace; color: var(--vr-muted); }
.vl-tile-mod { display: flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 700; cursor: help; }
.vl-mod-art { width: 18px; height: 18px; }
.vl-slot-mod { display: inline-flex; cursor: help; }
.vl-tile-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.vl-tile { --rc: #fff; display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; text-align: left; background: linear-gradient(160deg, color-mix(in srgb, var(--rc) 12%, transparent), rgba(255, 255, 255, 0.02) 55%); border: 1px solid color-mix(in srgb, var(--rc) 35%, transparent); border-top: 3px solid var(--rc); cursor: grab; transition: transform 0.1s, box-shadow 0.15s; }
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
