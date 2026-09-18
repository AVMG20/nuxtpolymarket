<template>
    <div class="vw">
        <!-- Three separate jobs, one at a time: what you own, what you can build, what you found. -->
        <nav class="vw-views">
            <button v-for="v in views" :key="v.id" class="vw-view" :class="{ 'vw-on': view === v.id }" @click="setView(v.id)">
                <UIcon :name="v.icon" class="size-4" />
                <span>{{ v.label }}</span>
                <small v-if="v.count !== null">{{ v.count }}</small>
            </button>
        </nav>

        <!-- ═══ My gear ═══ -->
        <template v-if="view === 'gear'">
            <p class="vw-intro">Everything you own. <b>Level up</b> items to make them stronger, <b>break down</b> spares for materials. Put gear on your ship in the <b>Loadout</b> tab.</p>
            <div v-if="modPick" class="vw-socket-hint">
                <UIcon name="i-lucide-gem" class="size-4" />
                <span>Pick an item with a gold outline to socket the <b>{{ modName(modPick) }}</b>. It replaces any mod already there.</span>
                <button class="vr-btn vr-btn-sm" @click="modPick = null">Cancel</button>
            </div>
            <div class="vw-filter">
                <button v-for="f in filters" :key="f.id" :class="{ 'vw-on': filter === f.id }" @click="filter = f.id">{{ f.label }}</button>
            </div>
            <div class="vh-list">
                <div
                    v-for="item in filtered"
                    :key="item.id"
                    class="vw-item"
                    :class="{ 'vw-item-socketable': modPick && modFits(modPick, item.kind), 'vw-item-new': item.id === highlightId }"
                    :style="{ '--rc': item.rarityColor, '--c': hex(item.color) }"
                >
                    <div class="vw-item-head">
                        <i class="vf-tier">T{{ item.tier }}</i>
                        <b>{{ item.name }}</b>
                        <em v-if="item.level">+{{ item.level }}</em>
                        <span class="vw-rarity">{{ item.rarityName }}</span>
                    </div>
                    <div class="vw-item-meta">
                        <span>{{ kindLabel(item.kind, true) }}</span>
                        <span v-if="fittedOn(item.id).length" class="vw-fitted"><UIcon name="i-lucide-check" class="size-3" /> On {{ fittedOn(item.id).join(', ') }}</span>
                        <span v-else class="vw-spare">Spare</span>
                    </div>
                    <div class="vw-item-stats">
                        <span v-for="st in item.stats" :key="st.label">{{ st.label }} <b>{{ st.value }}</b></span>
                    </div>
                    <div v-if="item.affixList.length || item.modInfo" class="vw-affixes">
                        <span v-for="a in item.affixList" :key="a.id">{{ a.text }} {{ a.name }}</span>
                        <span v-if="item.modInfo" class="vw-socket" :style="{ color: hex(item.modInfo.color) }"><UIcon name="i-lucide-gem" class="size-3" /> {{ item.modInfo.name }}</span>
                    </div>
                    <div class="vw-levels" :title="`Level ${item.level} / 10. Levels 5 and 10 each add a bonus stat.`">
                        <i v-for="n in 10" :key="n" :class="{ 'vw-lv-on': n <= item.level, 'vw-lv-star': n === 5 || n === 10 }" />
                    </div>
                    <div class="vh-card-foot">
                        <span v-if="item.upgradeCost" class="vw-cost">
                            <small>Next level</small>
                            <VoidCost :cost="item.upgradeCost.resources" :held="state.resources" :coins="item.upgradeCost.coins" :gems="item.upgradeCost.gems" :balance="state.balance" :gems-held="state.gems" />
                        </span>
                        <span v-else class="vh-maxed">Max level</span>
                        <div class="vw-buttons">
                            <button v-if="modPick && modFits(modPick, item.kind)" class="vr-btn vr-btn-sm vr-btn-primary" :disabled="busy" @click="socket(item.id)">Socket</button>
                            <button v-if="item.upgradeCost" class="vr-btn vr-btn-sm" :disabled="busy || !item.upgradeAffordable" :title="item.upgradeAffordable ? 'Level this item up' : 'Not enough materials'" @click="$emit('upgrade', item.id)">Level up</button>
                            <button
                                class="vr-btn vr-btn-sm vr-btn-danger"
                                :disabled="busy"
                                :title="`Destroys the item and returns ${salvageText(item.salvage)}`"
                                @click="salvage(item.id)"
                            >
                                {{ confirmSalvage === item.id ? 'Sure?' : 'Break down' }}
                            </button>
                        </div>
                    </div>
                </div>
                <div v-if="!filtered.length" class="vw-empty">
                    <p>{{ filter === 'all' ? 'No gear yet.' : `No ${kindLabel(filter).toLowerCase()} yet.` }}</p>
                    <button class="vr-btn vr-btn-sm vr-btn-primary" @click="setView('craft')">Craft some</button>
                </div>
            </div>
        </template>

        <!-- ═══ Craft ═══ -->
        <template v-else-if="view === 'craft'">
            <p class="vw-intro">Build new gear from the materials you bring home. Every craft rolls a random <b>rarity</b>; rarer items get bonus stats. New items appear in <b>My gear</b>.</p>
            <div class="vw-craft">
                <div class="vw-step"><i>1</i>What to build</div>
                <div class="vw-kinds">
                    <button v-for="k in kinds" :key="k.id" class="vw-kind" :class="{ 'vw-on': kind === k.id }" @click="setKind(k.id)">
                        <UIcon :name="k.icon" class="size-4" />
                        <span>{{ k.label }}</span>
                    </button>
                </div>
                <p class="vw-desc">{{ kindHint }}</p>

                <div class="vw-step"><i>2</i>Model</div>
                <div class="vw-types">
                    <button
                        v-for="t in typesForKind"
                        :key="t.id"
                        class="vw-type"
                        :class="{ 'vw-on': type === t.id, 'vw-locked': t.minTier > state.crafting.maxTier }"
                        :style="{ '--c': hex(t.color) }"
                        :title="t.minTier > state.crafting.maxTier ? `Unlocks at T${t.minTier}` : t.description"
                        @click="type = t.id"
                    >
                        <i class="vh-dotc" />
                        <span>{{ t.name }}</span>
                        <small v-if="t.minTier > 1">T{{ t.minTier }}+</small>
                        <em v-if="blueprintIds.has(t.id)" class="vw-bp" title="Blueprint owned: crafts come out as MkII">MkII</em>
                    </button>
                </div>
                <p v-if="selectedType" class="vw-desc">{{ selectedType.description }}</p>

                <div class="vw-step"><i>3</i>Tier<small>Higher tiers are stronger and need rarer materials</small></div>
                <div class="vw-tiers">
                    <button
                        v-for="t in tierCosts"
                        :key="t.tier"
                        class="vw-tier"
                        :class="{ 'vw-on': tier === t.tier, 'vw-locked': !t.unlocked || t.tier < (selectedType?.minTier ?? 1) }"
                        :disabled="!t.unlocked || t.tier < (selectedType?.minTier ?? 1)"
                        :title="!t.unlocked ? `Clear sector ${t.tier - 1} to unlock` : ''"
                        @click="tier = t.tier"
                    >
                        T{{ t.tier }}
                    </button>
                </div>

                <div class="vw-step"><i>4</i>Craft</div>
                <div class="vw-odds" title="Rarity odds">
                    <div v-for="r in state.crafting.rarities" :key="r.name" :style="{ flex: r.weight, background: r.color }" :title="`${r.name} ${oddsPct(r.weight)}%`" />
                </div>
                <div class="vw-odds-legend">
                    <span v-for="r in state.crafting.rarities" :key="r.name" :style="{ color: r.color }">{{ r.name }} {{ oddsPct(r.weight) }}%</span>
                </div>
                <p class="vw-odds-note">Each step up in rarity is stronger and carries one more bonus stat. A lucky T1 roll can beat a plain T2.</p>
                <div v-if="currentCost" class="vw-cost">
                    <small>Cost</small>
                    <VoidCost :cost="currentCost.resources" :held="state.resources" :coins="currentCost.coins" :gems="currentCost.gems" :balance="state.balance" :gems-held="state.gems" />
                </div>
                <button class="vr-btn vr-btn-primary vw-craft-go" :disabled="busy || !canCraft" @click="$emit('craft', kind, type, tier)">
                    <UIcon name="i-lucide-hammer" class="size-4" />
                    Craft T{{ tier }} {{ selectedType?.name ?? '' }}
                </button>
                <p v-if="craftBlocker" class="vw-blocker">{{ craftBlocker }}</p>
            </div>
        </template>

        <!-- ═══ Relic mods ═══ -->
        <template v-else>
            <p class="vw-intro">Mods give gear a special effect. Elites, wardens and vaults drop golden <b>relic caches</b>; bring them home to open them. Pick a mod you own, then the item to socket it into.</p>
            <div v-if="ownedMods.length" class="vw-mods">
                <button v-for="m in ownedMods" :key="m.id" class="vw-mod" :class="{ 'vw-on': modPick === m.id }" :style="{ '--c': hex(m.color) }" @click="pickMod(m.id)">
                    <UIcon name="i-lucide-gem" class="size-4" />
                    <div>
                        <b>{{ m.name }} <small>×{{ m.count }}</small></b>
                        <span>{{ m.description }}</span>
                        <em>Fits {{ m.kinds.map(k => kindLabel(k)).join(' / ') }}</em>
                    </div>
                </button>
            </div>
            <div v-else class="vw-empty"><p>No mods yet. Kill elites and wardens to find relic caches.</p></div>
            <h3 class="vw-sub">Still to find <small>{{ missingMods.length }}</small></h3>
            <div class="vw-mods">
                <div v-for="m in missingMods" :key="m.id" class="vw-mod vw-mod-none" :style="{ '--c': hex(m.color) }">
                    <UIcon name="i-lucide-gem" class="size-4" />
                    <div>
                        <b>{{ m.name }}</b>
                        <span>{{ m.description }}</span>
                        <em>Fits {{ m.kinds.map(k => kindLabel(k)).join(' / ') }}</em>
                    </div>
                </div>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import type { InternalApi } from 'nitropack/types'
import { voidHex, voidResource, type VoidResourceBundle } from '#shared/utils/gamelogic/void'
import { voidMod } from '#shared/utils/gamelogic/void-items'
import VoidCost from './VoidCost.vue'

type State = InternalApi['/api/void/state']['get']
type Kind = 'gun' | 'turret' | 'armor' | 'shield' | 'secondary' | 'device'
export type WorkshopView = 'gear' | 'craft' | 'mods'

const props = defineProps<{
    state: State
    busy: boolean
    /** An item to flash, such as the one just crafted. */
    highlightId?: string | null
}>()

const emit = defineEmits<{
    craft: [kind: string, type: string, tier: number]
    upgrade: [itemId: string]
    salvage: [itemId: string]
    socket: [itemId: string, modId: string]
}>()

const view = defineModel<WorkshopView>('view', { default: 'gear' })

const kinds = [
    { id: 'gun' as const, label: 'Guns', single: 'Gun', icon: 'i-lucide-crosshair', hint: 'Your primary gun. You aim and fire it with left mouse.' },
    { id: 'turret' as const, label: 'Turrets', single: 'Turret', icon: 'i-lucide-radar', hint: 'Turrets pick targets and fire on their own. Bigger hulls carry more.' },
    { id: 'armor' as const, label: 'Armour', single: 'Armour', icon: 'i-lucide-shield-half', hint: 'Armour adds hull and damage resistance.' },
    { id: 'shield' as const, label: 'Shields', single: 'Shield', icon: 'i-lucide-shield', hint: 'Shields add a pool that absorbs hits first and recharges.' },
    { id: 'secondary' as const, label: 'Secondary', single: 'Secondary', icon: 'i-lucide-rocket', hint: 'Missiles, rockets or mines, fired with E. Ammo refills every launch.' },
    { id: 'device' as const, label: 'Devices', single: 'Device', icon: 'i-lucide-cpu', hint: 'Boosters, decoys and cloaks, triggered with G.' }
]
const filters = [{ id: 'all', label: 'All' }, ...kinds.map(k => ({ id: k.id, label: k.label }))]

const kind = ref<Kind>('turret')
const type = ref('pulse')
const tier = ref(Math.max(1, props.state.crafting.maxTier))
const filter = ref('all')
const modPick = ref<string | null>(null)
const confirmSalvage = ref<string | null>(null)

const ownedMods = computed(() => props.state.mods.filter(m => m.count > 0))
const missingMods = computed(() => props.state.mods.filter(m => !m.count))
const views = computed(() => [
    { id: 'gear' as const, label: 'My gear', icon: 'i-lucide-package', count: props.state.items.length },
    { id: 'craft' as const, label: 'Craft', icon: 'i-lucide-hammer', count: null },
    { id: 'mods' as const, label: 'Relic mods', icon: 'i-lucide-gem', count: ownedMods.value.reduce((s, m) => s + m.count, 0) }
])

const blueprintIds = computed(() => new Set(props.state.blueprints.map(b => b.id)))
const typesForKind = computed(() => props.state.crafting.types.filter(t => t.kind === kind.value))
const selectedType = computed(() => typesForKind.value.find(t => t.id === type.value) ?? null)
const kindHint = computed(() => kinds.find(k => k.id === kind.value)?.hint ?? '')
const tierCosts = computed(() => props.state.crafting.costs.find(c => c.kind === kind.value)?.tiers ?? [])
const currentCost = computed(() => tierCosts.value.find(t => t.tier === tier.value) ?? null)
const canCraft = computed(() => !!currentCost.value?.unlocked && !!currentCost.value.affordable && !!selectedType.value && tier.value >= selectedType.value.minTier)
const craftBlocker = computed(() => {
    if (!selectedType.value) return 'Pick a model.'
    if (!currentCost.value?.unlocked) return `Clear sector ${tier.value - 1} to craft T${tier.value} gear.`
    if (tier.value < selectedType.value.minTier) return `The ${selectedType.value.name} starts at T${selectedType.value.minTier}.`
    if (!currentCost.value.affordable) return 'Not enough materials. Anything shown in red is what you are short of.'
    return null
})
const totalWeight = computed(() => props.state.crafting.rarities.reduce((s, r) => s + r.weight, 0))
const filtered = computed(() => props.state.items.filter(i => filter.value === 'all' || i.kind === filter.value))

watch(selectedType, (t) => {
    if (t && tier.value < t.minTier) tier.value = Math.min(props.state.crafting.maxTier, t.minTier)
})

function setView(v: WorkshopView) {
    view.value = v
}

function setKind(k: Kind) {
    kind.value = k
    type.value = typesForKind.value[0]?.id ?? ''
}

function hex(color: number) {
    return voidHex(color)
}

function oddsPct(weight: number) {
    const pct = (weight / totalWeight.value) * 100
    return pct < 2 ? pct.toFixed(1) : Math.round(pct)
}

function kindLabel(k: string, single = false) {
    const found = kinds.find(x => x.id === k)
    return (single ? found?.single : found?.label) ?? k
}

function modName(id: string) {
    return voidMod(id)?.name ?? id
}

function modFits(modId: string, itemKind: string) {
    return !!voidMod(modId)?.kinds.includes(itemKind as Kind)
}

function fittedOn(itemId: string) {
    return props.state.ships
        .filter(s => s.owned && [s.fit.gun, ...s.fit.turrets, ...s.fit.armor, ...s.fit.shields, s.fit.secondary, s.fit.device].includes(itemId))
        .map(s => s.name)
}

function salvageText(bundle: VoidResourceBundle) {
    return Object.entries(bundle).map(([id, n]) => `${n} ${voidResource(id).name}`).join(', ')
}

/** Picking a mod jumps to your gear with the items it fits outlined. */
function pickMod(id: string) {
    modPick.value = id
    filter.value = 'all'
    view.value = 'gear'
}

function socket(itemId: string) {
    if (!modPick.value) return
    emit('socket', itemId, modPick.value)
    modPick.value = null
}

let confirmTimer: ReturnType<typeof setTimeout> | undefined
function salvage(itemId: string) {
    if (confirmSalvage.value !== itemId) {
        confirmSalvage.value = itemId
        clearTimeout(confirmTimer)
        confirmTimer = setTimeout(() => {
            confirmSalvage.value = null
        }, 2500)
        return
    }
    confirmSalvage.value = null
    emit('salvage', itemId)
}
</script>

<style>
.vw { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; }
.vw-views { position: sticky; top: -6px; z-index: 2; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; margin: 0 -18px 6px; padding: 12px 18px 10px; background: linear-gradient(180deg, rgba(6, 12, 24, 0.96), rgba(6, 12, 24, 0.88)); border-bottom: 1px solid var(--vr-line); }
.vw-view { display: flex; align-items: center; justify-content: center; gap: 6px; min-width: 0; padding: 8px 6px; font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--vr-muted); border: 1px solid var(--vr-line); cursor: pointer; transition: all 0.15s; }
.vw-view span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vw-view small { padding: 0 5px; font: 700 10px 'JetBrains Mono', monospace; color: var(--vr-text); background: rgba(255, 255, 255, 0.08); }
.vw-view:hover { color: var(--vr-text); border-color: var(--vr-line-strong); }
.vw-view.vw-on { color: #fff; border-color: var(--vr-accent); background: rgba(94, 200, 255, 0.14); box-shadow: inset 0 -2px 0 var(--vr-accent); }
.vw-intro { margin: 2px 0 10px; font-size: 13px; line-height: 1.4; color: rgba(230, 241, 255, 0.75); }
.vw-intro b { color: #fff; }
.vw-sub { display: flex; align-items: baseline; gap: 8px; margin: 16px 0 8px; font-size: 12px; font-weight: 700; letter-spacing: 0.25em; text-transform: uppercase; color: var(--vr-muted); }
.vw-sub small { font: 600 11px 'JetBrains Mono', monospace; letter-spacing: 0; }

.vw-craft { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; gap: 8px; padding: 12px; border: 1px solid var(--vr-line-strong); background: linear-gradient(160deg, rgba(94, 200, 255, 0.07), rgba(255, 255, 255, 0.02)); }
.vw-step { display: flex; align-items: baseline; gap: 8px; margin-top: 6px; font-size: 12px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; }
.vw-step:first-child { margin-top: 0; }
.vw-step i { display: inline-grid; place-items: center; width: 18px; height: 18px; font: 700 11px 'JetBrains Mono', monospace; font-style: normal; letter-spacing: 0; color: #02040a; background: var(--vr-accent); }
.vw-step small { font-size: 11px; font-weight: 500; letter-spacing: 0.02em; text-transform: none; color: var(--vr-muted); }
.vw-kinds { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }
.vw-kind { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 7px 4px; font-size: 11px; font-weight: 700; letter-spacing: clamp(0.02em, 0.5vw, 0.12em); min-width: 0; overflow: hidden; text-transform: uppercase; color: var(--vr-muted); border: 1px solid var(--vr-line); cursor: pointer; }
.vw-kind span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vw-kind:hover { color: var(--vr-text); }
.vw-kind.vw-on { color: #fff; border-color: var(--vr-accent); background: rgba(94, 200, 255, 0.12); }
.vw-types { display: flex; flex-wrap: wrap; gap: 4px; }
.vw-type { display: flex; align-items: center; gap: 6px; padding: 5px 9px; font-size: 12px; font-weight: 700; border: 1px solid var(--vr-line); cursor: pointer; }
.vw-type small { font: 600 9px 'JetBrains Mono', monospace; color: var(--vr-muted); }
.vw-bp { font-style: normal; font: 700 9px 'JetBrains Mono', monospace; color: #e3c7ff; padding: 0 3px; border: 1px solid rgba(192, 123, 255, 0.6); }
.vw-type.vw-on { border-color: var(--c); background: color-mix(in srgb, var(--c) 14%, transparent); }
.vw-locked { opacity: 0.4; }
.vw-desc { margin: 0; font-size: 12px; color: rgba(230, 241, 255, 0.7); }
.vw-tiers { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; }
.vw-tier { min-width: 0; padding: 6px 0; font: 700 13px 'JetBrains Mono', monospace; border: 1px solid var(--vr-line); cursor: pointer; }
.vw-tier.vw-on { border-color: var(--vr-gold); color: var(--vr-gold); background: rgba(255, 210, 122, 0.1); }
.vw-tier:disabled { cursor: not-allowed; }
.vw-odds { display: flex; height: 5px; gap: 1px; }
.vw-odds div { min-width: 3px; }
.vw-odds-legend { display: flex; flex-wrap: wrap; gap: 2px 10px; font: 600 10px 'JetBrains Mono', monospace; }
.vw-odds-note { margin: 6px 0 0; font-size: 12px; line-height: 1.35; color: var(--vr-muted); }
.vw-cost { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
.vw-cost > small { font-size: 10px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: var(--vr-muted); }
.vw-craft-go { width: 100%; padding: 12px 18px; font-size: 14px; }
.vw-blocker { margin: 0; font-size: 12px; color: #ffb3c0; }

.vw-mods { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; }
.vw-mod { display: flex; gap: 8px; padding: 7px 8px; text-align: left; border: 1px solid var(--vr-line); color: var(--c); cursor: pointer; }
.vw-mod b { display: block; font-size: 12px; color: var(--vr-text); }
.vw-mod b small { color: var(--c); font-family: 'JetBrains Mono', monospace; }
.vw-mod span { display: block; font-size: 11px; line-height: 1.25; color: rgba(230, 241, 255, 0.6); }
.vw-mod em { display: block; font-style: normal; font-size: 9px; letter-spacing: 0.15em; text-transform: uppercase; color: var(--vr-muted); margin-top: 2px; }
.vw-mod-none { opacity: 0.35; cursor: default; }
.vw-mod.vw-on { border-color: var(--c); box-shadow: 0 0 14px color-mix(in srgb, var(--c) 40%, transparent); }
.vw-socket-hint { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding: 8px 10px; font-size: 12px; color: var(--vr-gold); border: 1px solid rgba(255, 210, 122, 0.45); background: rgba(255, 210, 122, 0.08); }
.vw-socket-hint span { flex: 1; color: rgba(230, 241, 255, 0.85); }

.vw-filter { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.vw-filter button { padding: 4px 9px; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--vr-muted); border: 1px solid var(--vr-line); cursor: pointer; }
.vw-filter .vw-on { color: #fff; border-color: var(--vr-accent); }
.vw-item { --rc: #fff; padding: 8px 10px; background: linear-gradient(120deg, color-mix(in srgb, var(--rc) 10%, transparent), rgba(255, 255, 255, 0.02) 55%); border: 1px solid color-mix(in srgb, var(--rc) 35%, transparent); border-left: 3px solid var(--rc); }
.vw-item-socketable { box-shadow: 0 0 0 1px var(--vr-gold); }
.vw-item-new { animation: vw-new 1.6s ease-out 2; }
@keyframes vw-new { 0% { box-shadow: 0 0 0 1px var(--rc), 0 0 24px color-mix(in srgb, var(--rc) 60%, transparent); } 100% { box-shadow: none; } }
.vw-item-head { display: flex; align-items: baseline; gap: 6px; font-size: 15px; }
.vw-item-head b { color: var(--rc); }
.vw-item-head em { font-style: normal; font: 700 12px 'JetBrains Mono', monospace; color: var(--vr-gold); }
.vw-rarity { margin-left: auto; font-size: 10px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: var(--rc); }
.vw-item-meta { display: flex; align-items: center; gap: 10px; margin-top: 2px; font-size: 10px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: var(--vr-muted); }
.vw-fitted { display: inline-flex; align-items: center; gap: 3px; color: var(--vr-good); }
.vw-spare { color: rgba(200, 220, 245, 0.4); }
.vw-item-stats { display: flex; flex-wrap: wrap; gap: 2px 12px; margin-top: 3px; font-size: 12px; color: var(--vr-muted); }
.vw-item-stats b { font-family: 'JetBrains Mono', monospace; color: var(--vr-text); }
.vw-affixes { display: flex; flex-wrap: wrap; gap: 2px 10px; margin-top: 3px; font: 600 11px 'JetBrains Mono', monospace; color: #b8ffe3; }
.vw-socket { display: inline-flex; align-items: center; gap: 4px; }
.vw-levels { display: flex; gap: 2px; margin: 6px 0 2px; }
.vw-levels i { flex: 1; height: 3px; background: rgba(255, 255, 255, 0.08); }
.vw-levels .vw-lv-star { height: 5px; margin-top: -1px; outline: 1px solid rgba(255, 210, 122, 0.45); }
.vw-levels .vw-lv-on { background: var(--vr-gold); box-shadow: 0 0 5px rgba(255, 210, 122, 0.6); }
.vw-buttons { display: flex; gap: 4px; flex-shrink: 0; margin-left: auto; }
</style>
