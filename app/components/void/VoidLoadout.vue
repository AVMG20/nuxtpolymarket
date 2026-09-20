<template>
    <div class="vl">
        <!-- Ship summary -->
        <div class="vl-bar">
            <b class="vl-ship">{{ ship.name }}</b>
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
                <div v-for="group in groups" :key="group.key" class="vl-group">
                    <div class="vl-group-head" :title="group.hint">
                        <UIcon :name="group.icon" class="size-4" />
                        <b>{{ group.label }}</b>
                        <kbd v-if="group.key_">{{ group.key_ }}</kbd>
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
                            <i v-if="group.slots.length > 1" class="vl-slot-num">{{ i + 1 }}</i>
                            <template v-if="itemById(id)">
                                <VoidItemArt :type="itemById(id)!.type" :tier="itemById(id)!.tier" :level="itemById(id)!.level" :rarity-color="itemById(id)!.rarityColor" size="sm" />
                                <span class="vl-slot-text">
                                    <span class="vl-slot-top">
                                        <b>{{ itemById(id)!.name }}</b>
                                        <span v-if="itemById(id)!.modInfo" class="vl-slot-mod vl-tip" :data-tip="`${itemById(id)!.modInfo!.name}: ${itemById(id)!.modInfo!.description}`"><VoidItemArt :type="itemById(id)!.modInfo!.id" size="sm" flat class="vl-mod-art" /></span>
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
                            <UIcon name="i-lucide-chevron-right" class="vl-slot-arrow size-4" />
                        </button>
                    </div>
                </div>
            </section>

            <!-- ═══ Armory ═══ -->
            <section class="vl-armory">
                <h3 class="vl-title">
                    {{ current.group.label }}<template v-if="current.group.slots.length > 1"> · slot {{ selected.index + 1 }}</template>
                    <small>{{ current.group.hint }}</small>
                    <button v-if="currentItem" class="vr-btn vr-btn-sm vl-unequip" :disabled="busy" @click="fit(selected.key, selected.index, null)">Unequip</button>
                </h3>

                <div v-if="candidates.length" class="vl-grid">
                    <div
                        v-for="item in candidates"
                        :key="item.id"
                        class="vl-tile"
                        :class="{ 'vl-tile-here': item.id === currentItem?.id, 'vl-tile-fitted': item.place?.tone === 'fitted' }"
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
                                <em v-if="item.place" class="vl-tag" :class="`vl-tag-${item.place.tone}`" :title="item.place.hint">
                                    <UIcon :name="item.place.icon" class="size-3" />{{ item.place.label }}
                                </em>
                            </span>
                            <span class="vl-tile-rarity">{{ item.rarityName }}<template v-if="item.affixList.length"> · {{ item.affixList.length }} bonus</template></span>
                            <span v-if="item.modInfo" class="vl-tile-mod vl-tip" :style="{ color: hex(item.modInfo.color) }" :data-tip="item.modInfo.description"><VoidItemArt :type="item.modInfo.id" size="sm" flat class="vl-mod-art" />{{ item.modInfo.name }}</span>
                            <span class="vl-tile-stats">
                                <span v-for="st in item.stats" :key="st.label">{{ st.label }} <b>{{ st.value }}</b></span>
                            </span>
                            <!-- Kept on the fitted tile too, empty, so every tile's level bar lines up. -->
                            <span class="vl-tile-foot">
                                <template v-if="item.id !== currentItem?.id">
                                    <span class="vl-delta" :class="deltaClass(item.score)">{{ deltaText(item.score) }}</span>
                                    <small class="vl-equip-hint">{{ item.place?.tone === 'fitted' ? 'Click to move here' : 'Click to equip' }}</small>
                                </template>
                            </span>
                            <!-- Levelling, socketing and breaking down all happen here, beside the fitting. -->
                            <span class="vl-tile-levels" :title="`Level ${item.level} / 10. Levels 5 and 10 each add a bonus stat.`">
                                <i v-for="n in 10" :key="n" :class="{ 'vl-lv-on': n <= item.level }" />
                            </span>
                            <span v-if="item.upgradeCost" class="vl-tile-cost" title="Cost of the next level">
                                <VoidCost :cost="item.upgradeCost.resources" :held="state.resources" :coins="item.upgradeCost.coins" :gems="item.upgradeCost.gems" :balance="state.balance" :gems-held="state.gems" />
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
                                    {{ confirmSalvage === item.id ? 'Sure?' : 'Scrap' }}
                                </button>
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
    .sort((a, b) => b.score - a.score)
    .map(i => ({ ...i, place: placement(i.id) })))

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

/** Where an item already sits: this slot, another slot on this hull, or another ship. */
function placement(itemId: string) {
    for (const g of groups.value) {
        const i = g.slots.indexOf(itemId)
        if (i < 0) continue
        if (g.key === selected.value.key && i === selected.value.index) return { tone: 'here', icon: 'i-lucide-check', label: 'Equipped', hint: 'Fitted in the selected slot' }
        const label = g.slots.length > 1 ? `${g.single} ${i + 1}` : g.single
        return { tone: 'fitted', icon: 'i-lucide-check', label, hint: `Already fitted in ${label.toLowerCase()}; picking it moves it here` }
    }
    const other = props.state.ships.find(s => s.owned && !s.equipped && [s.fit.gun, ...s.fit.turrets, ...s.fit.armor, ...s.fit.shields, s.fit.secondary, s.fit.device].includes(itemId))
    return other ? { tone: 'away', icon: 'i-lucide-rocket', label: other.name, hint: `Also fitted on your ${other.name}` } : null
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
.vl { display: grid; gap: 16px; }
.vl-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 28px; padding: 12px 18px; background: var(--vr-panel); border: 1px solid var(--vr-line); border-radius: 12px; }
.vl-ship { font-size: 20px; font-weight: 700; letter-spacing: 0.04em; }
.vl-stats { display: flex; flex-wrap: wrap; gap: 6px 26px; }
.vl-stats div { display: flex; align-items: baseline; gap: 8px; }
.vl-stats span { font-size: 13px; color: var(--vr-muted); }
.vl-stats b { font: 600 15px 'JetBrains Mono', monospace; }
.vl-bar-actions { margin-left: auto; }

.vl-main { display: grid; grid-template-columns: minmax(300px, 380px) minmax(0, 1fr); gap: 16px; align-items: start; }
.vl-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin: 4px 0 12px; font-size: 18px; font-weight: 700; letter-spacing: 0.03em; }
.vl-title small { font-size: 13px; font-weight: 500; color: var(--vr-muted); }
.vl-unequip { margin-left: auto; }

.vl-frame { position: sticky; top: 12px; display: grid; gap: 14px; padding: 16px; background: var(--vr-panel); border: 1px solid var(--vr-line); border-radius: 12px; }
.vl-group-head { display: flex; align-items: center; gap: 7px; margin-bottom: 6px; color: var(--vr-muted); }
.vl-group-head b { font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
.vl-slots { display: grid; gap: 5px; }
.vl-slot { --rc: rgba(255, 255, 255, 0.25); display: flex; align-items: center; gap: 10px; padding: 7px 10px; text-align: left; background: var(--vr-panel-2); border: 1px solid transparent; border-radius: 9px; cursor: pointer; transition: background 0.15s, border-color 0.15s; }
.vl-slot:hover { background: rgba(255, 255, 255, 0.08); }
.vl-slot-empty { background: transparent; border: 1px dashed var(--vr-line-strong); color: var(--vr-muted); }
.vl-slot-empty .vl-slot-blank { border: none; }
.vl-slot-on { border-color: var(--vr-accent); background: rgba(94, 200, 255, 0.1); box-shadow: inset 3px 0 0 var(--vr-accent); }
.vl-slot-drop { border-color: var(--vr-good); background: rgba(61, 255, 176, 0.1); }
.vl-slot-no { border-color: var(--vr-bad); cursor: not-allowed; }
.vl-slot-mod { display: inline-flex; cursor: help; filter: drop-shadow(0 0 4px currentColor); }
.vl-slot-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.vl-slot-blank { display: grid; place-items: center; width: 44px; height: 44px; flex-shrink: 0; color: var(--vr-muted); border: 1px dashed var(--vr-line-strong); border-radius: 6px; }
.vl-slot > .vart-sm { width: 44px; height: 44px; }
.vl-slot-num { flex-shrink: 0; width: 10px; font: 700 11px 'JetBrains Mono', monospace; font-style: normal; text-align: center; color: var(--vr-muted); }
.vl-slot-on .vl-slot-num { color: var(--vr-accent); }
.vl-slot-arrow { flex-shrink: 0; margin-left: auto; color: var(--vr-accent); opacity: 0; transform: translateX(-4px); transition: opacity 0.15s, transform 0.15s; }
.vl-slot-on .vl-slot-arrow { opacity: 1; transform: none; }
.vl-slot-top { display: flex; align-items: center; gap: 6px; font-size: 14px; min-width: 0; }
.vl-slot-top b { font-weight: 700; color: var(--rc); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vl-slot-empty .vl-slot-top b { color: var(--vr-muted); font-weight: 600; }
.vl-slot-sub { display: flex; flex-wrap: wrap; gap: 0 10px; font: 500 11px 'JetBrains Mono', monospace; color: var(--vr-muted); }

.vl-armory { min-width: 0; }
.vl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
.vl-tile { --rc: #fff; display: flex; align-items: flex-start; gap: 12px; padding: 14px; text-align: left; background: var(--vr-panel); border: 1px solid var(--vr-line); border-radius: 12px; cursor: grab; transition: border-color 0.15s, transform 0.1s; }
.vl-tile:hover { border-color: color-mix(in srgb, var(--rc) 55%, transparent); transform: translateY(-1px); }
.vl-tile-here, .vl-tile-here:hover { border-color: var(--vr-good); background: linear-gradient(160deg, rgba(61, 255, 176, 0.1), var(--vr-panel) 60%); box-shadow: 0 0 0 1px var(--vr-good), 0 0 22px rgba(61, 255, 176, 0.12); cursor: default; transform: none; }
.vl-tile-fitted { border-color: rgba(94, 200, 255, 0.55); background: linear-gradient(160deg, rgba(94, 200, 255, 0.08), var(--vr-panel) 60%); }
.vl-tile-art { align-self: start; }
.vl-tile .vl-tile-art { width: 68px; height: 68px; }
.vl-tag { display: inline-flex; flex-shrink: 0; align-items: center; gap: 4px; margin-left: auto; padding: 2px 7px 2px 5px; font: 700 10px 'Rajdhani', system-ui, sans-serif; font-style: normal; letter-spacing: 0.1em; text-transform: uppercase; border: 1px solid currentColor; border-radius: 999px; }
.vl-tag-here { color: #04121c; background: var(--vr-good); border-color: var(--vr-good); }
.vl-tag-fitted { color: var(--vr-accent); background: rgba(94, 200, 255, 0.1); }
.vl-tag-away { color: var(--vr-warn); background: rgba(255, 194, 77, 0.08); }
.vl-tile-body { display: flex; flex: 1; flex-direction: column; gap: 4px; min-width: 0; }
.vl-tile-head { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 16px; }
.vl-tile-head b { color: var(--rc); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vl-tile-rarity { font-size: 12px; font-weight: 600; color: var(--rc); opacity: 0.85; }
.vl-tile-stats { display: flex; flex-wrap: wrap; gap: 2px 12px; font-size: 13px; color: var(--vr-muted); }
.vl-tile-stats b { font-family: 'JetBrains Mono', monospace; font-weight: 600; color: var(--vr-text); }
.vl-tile-foot { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; min-height: 18px; }
.vl-delta { font: 700 12px 'JetBrains Mono', monospace; color: var(--vr-muted); }
.vl-equip-hint { margin-left: auto; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; color: var(--vr-accent); opacity: 0; transition: opacity 0.15s; }
.vl-tile:hover .vl-equip-hint, .vl-tile:focus-visible .vl-equip-hint { opacity: 1; }
.vl-tile-levels { display: flex; gap: 2px; margin-top: 4px; }
.vl-tile-levels i { flex: 1; height: 3px; border-radius: 2px; background: rgba(255, 255, 255, 0.1); }
.vl-lv-on { background: var(--vr-good) !important; }
.vl-tile-cost { display: flex; margin-top: 6px; padding-top: 8px; border-top: 1px solid var(--vr-line); font-size: 12px; }
.vl-tile-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.vl-tile-actions .vr-btn:first-child { flex: 1; }
.vl-maxed { flex: 1; align-self: center; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--vr-good); }
.vl-mods { display: grid; gap: 4px; margin-top: 6px; padding: 8px; background: var(--vr-panel-2); border-radius: 9px; }
.vl-mod-opt { display: flex; align-items: center; gap: 8px; padding: 4px 6px; text-align: left; font-size: 13px; border-radius: 6px; cursor: pointer; }
.vl-mod-opt:hover { background: rgba(255, 255, 255, 0.06); }
.vl-mod-opt em { margin-left: auto; font-style: normal; font: 600 11px 'JetBrains Mono', monospace; color: var(--vr-muted); }
.vl-tile-mod { display: flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 700; cursor: help; }
.vl-mod-art { width: 18px; height: 18px; }
/* Native title tooltips don't show in fullscreen, so mods carry their own. */
.vl-tip { position: relative; }
.vl-tip::after { content: attr(data-tip); position: absolute; left: 0; top: calc(100% + 6px); z-index: 30; width: max-content; max-width: 240px; padding: 6px 9px; font-size: 12px; font-weight: 500; line-height: 1.35; letter-spacing: 0; text-transform: none; white-space: normal; color: var(--vr-text, #e6eef7); background: #0b111b; border: 1px solid var(--vr-line-strong); border-radius: 7px; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5); opacity: 0; pointer-events: none; transition: opacity 0.12s; }
.vl-tip:hover::after { opacity: 1; }

@media (max-width: 900px) {
    .vl-main { grid-template-columns: minmax(0, 1fr); }
    .vl-frame { position: static; }
}
</style>
