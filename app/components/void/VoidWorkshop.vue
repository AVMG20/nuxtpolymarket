<template>
    <div class="vw">
        <!-- Two jobs: build new gear, and keep track of the mods you have found.
             Levelling, socketing and breaking down all live in the Loadout. -->
        <nav class="vw-views">
            <button v-for="v in views" :key="v.id" class="vw-view" :class="{ 'vw-on': view === v.id }" @click="setView(v.id)">
                <UIcon :name="v.icon" class="size-4" />
                <span>{{ v.label }}</span>
                <small v-if="v.count !== null">{{ v.count }}</small>
            </button>
        </nav>

        <!-- ═══ Craft ═══ -->
        <template v-if="view === 'craft'">
            <div class="vw-craft">
                <div class="vw-craft-steps">
                <div class="vw-step">What to build</div>
                <div class="vw-kinds">
                    <button v-for="k in kinds" :key="k.id" class="vw-kind" :class="{ 'vw-on': kind === k.id }" @click="setKind(k.id)">
                        <UIcon :name="k.icon" class="size-4" />
                        <span>{{ k.label }}</span>
                    </button>
                </div>
                <p class="vw-desc">{{ kindHint }}</p>

                <div class="vw-step">Model</div>
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
                        <VoidItemArt :type="t.id" size="sm" flat />
                        <span>{{ t.name }}</span>
                        <small v-if="t.minTier > 1">T{{ t.minTier }}+</small>
                        <em v-if="blueprintIds.has(t.id)" class="vw-bp" title="Blueprint owned: crafts come out as MkII">MkII</em>
                    </button>
                </div>

                <div class="vw-step">Tier<small>Clearing a sector opens the next tier</small></div>
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

                </div>

                <!-- What you are about to build: the real turret model where we
                     have one, the drawn silhouette everywhere else. -->
                <aside class="vw-preview">
                    <VoidTurretPreview v-if="kind === 'turret' && selectedType" :type="selectedType.id" />
                    <VoidItemArt v-else-if="selectedType" :type="selectedType.id" :tier="tier" size="lg" class="vw-preview-art" />
                    <div class="vw-preview-name">
                        <b>{{ selectedType?.name ?? 'Pick a model' }}</b>
                        <span v-if="selectedType">T{{ tier }}</span>
                    </div>
                    <p v-if="selectedType" class="vw-preview-desc">{{ selectedType.description }}</p>
                    <div v-if="damage" class="vw-dmg" :class="`vw-dmg-${damage.id}`" :title="`×${damage.shield} against shields, ×${damage.hull} against hull`">
                        <UIcon :name="damage.icon" class="size-4" />
                        <b>{{ damage.label }}</b>
                        <span>{{ damage.note }}</span>
                    </div>
                    <em v-if="selectedType && blueprintIds.has(selectedType.id)" class="vw-preview-bp">MkII blueprint owned · 12% stronger, never Common</em>
                    <div v-if="currentCost" class="vw-cost">
                        <small>Cost</small>
                        <VoidCost :cost="currentCost.resources" :held="state.resources" :coins="currentCost.coins" :gems="currentCost.gems" :balance="state.balance" :gems-held="state.gems" />
                    </div>
                    <button class="vr-btn vr-btn-primary vw-craft-go" :disabled="busy || !canCraft" @click="$emit('craft', kind, type, tier)">
                        <UIcon name="i-lucide-hammer" class="size-4" />
                        Craft T{{ tier }} {{ selectedType?.name ?? '' }}
                    </button>
                    <p v-if="craftBlocker" class="vw-blocker">{{ craftBlocker }}</p>
                    <div class="vw-odds-box" title="Every craft rolls a rarity. Each step up is stronger and carries one more bonus stat.">
                        <small>Rarity odds</small>
                        <div class="vw-odds">
                            <div v-for="r in state.crafting.rarities" :key="r.name" :style="{ flex: r.weight, background: r.color }" :title="`${r.name} ${oddsPct(r.weight)}%`" />
                        </div>
                        <div class="vw-odds-legend">
                            <span v-for="r in state.crafting.rarities" :key="r.name" :style="{ color: r.color }">{{ r.name }} {{ oddsPct(r.weight) }}%</span>
                        </div>
                    </div>
                </aside>
            </div>
        </template>

        <!-- ═══ Relic mods ═══ -->
        <template v-else>
            <p class="vw-intro">Relic caches from elites, wardens and vaults open into mods. Socket them onto gear in the <b>Loadout</b>.</p>
            <div v-if="ownedMods.length" class="vw-mods">
                <div v-for="m in ownedMods" :key="m.id" class="vw-mod" :style="{ '--c': hex(m.color) }">
                    <VoidItemArt :type="m.id" size="md" />
                    <div>
                        <b>{{ m.name }} <small>×{{ m.count }}</small></b>
                        <span>{{ m.description }}</span>
                        <em>Fits {{ m.kinds.map(k => kindLabel(k)).join(' / ') }}</em>
                    </div>
                </div>
            </div>
            <div v-else class="vw-empty"><p>No mods yet. Kill elites and wardens to find relic caches.</p></div>
            <h3 class="vw-sub">Still to find <small>{{ missingMods.length }}</small></h3>
            <div class="vw-mods">
                <div v-for="m in missingMods" :key="m.id" class="vw-mod vw-mod-none" :style="{ '--c': hex(m.color) }">
                    <VoidItemArt :type="m.id" size="md" />
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
import { voidCanAffordPrice, voidHex, voidResource, type VoidResourceBundle } from '#shared/utils/gamelogic/void'
import { VOID_DAMAGE_MULT, VOID_DAMAGE_TYPE, voidCraftCost, voidMod, type VoidDamageType } from '#shared/utils/gamelogic/void-items'
import VoidCost from './VoidCost.vue'
import VoidItemArt from './VoidItemArt.vue'
import VoidTurretPreview from './VoidTurretPreview.vue'

type State = InternalApi['/api/void/state']['get']
type Kind = 'gun' | 'turret' | 'armor' | 'shield' | 'secondary' | 'device'
export type WorkshopView = 'craft' | 'mods'

const DAMAGE_NOTES: Record<VoidDamageType, { label: string, note: string, icon: string, shield: number, hull: number }> = {
    energy: { label: 'Energy', note: 'Strips shields, glances off hull', icon: 'i-lucide-zap', ...VOID_DAMAGE_MULT.energy },
    kinetic: { label: 'Kinetic', note: 'Tears hull, bounces off shields', icon: 'i-lucide-crosshair', ...VOID_DAMAGE_MULT.kinetic },
    explosive: { label: 'Explosive', note: 'Even against shields and hull', icon: 'i-lucide-bomb', ...VOID_DAMAGE_MULT.explosive }
}

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

const view = defineModel<WorkshopView>('view', { default: 'craft' })

const kinds = [
    { id: 'gun' as const, label: 'Guns', single: 'Gun', icon: 'i-lucide-crosshair', hint: 'Your primary gun. You aim and fire it with left mouse.' },
    { id: 'turret' as const, label: 'Turrets', single: 'Turret', icon: 'i-lucide-radar', hint: 'Turrets pick targets and fire on their own. Bigger hulls carry more.' },
    { id: 'armor' as const, label: 'Armour', single: 'Armour', icon: 'i-lucide-shield-half', hint: 'Armour adds hull and damage resistance.' },
    { id: 'shield' as const, label: 'Shields', single: 'Shield', icon: 'i-lucide-shield', hint: 'Shields add a pool that absorbs hits first and recharges.' },
    { id: 'secondary' as const, label: 'Secondary', single: 'Secondary', icon: 'i-lucide-rocket', hint: 'Missiles, rockets or mines, fired with E. Ammo refills every launch.' },
    { id: 'device' as const, label: 'Devices', single: 'Device', icon: 'i-lucide-cpu', hint: 'Boosters, decoys and cloaks, triggered with G.' }
]

const kind = ref<Kind>('turret')
const type = ref('pulse')
const tier = ref(Math.max(1, props.state.crafting.maxTier))

const ownedMods = computed(() => props.state.mods.filter(m => m.count > 0))
const missingMods = computed(() => props.state.mods.filter(m => !m.count))
const views = computed(() => [
    { id: 'craft' as const, label: 'Craft', icon: 'i-lucide-hammer', count: null },
    { id: 'mods' as const, label: 'Relic mods', icon: 'i-lucide-gem', count: ownedMods.value.reduce((s, m) => s + m.count, 0) }
])

const blueprintIds = computed(() => new Set(props.state.blueprints.map(b => b.id)))
const typesForKind = computed(() => props.state.crafting.types.filter(t => t.kind === kind.value))
const selectedType = computed(() => typesForKind.value.find(t => t.id === type.value) ?? null)
const kindHint = computed(() => kinds.find(k => k.id === kind.value)?.hint ?? '')
const tierCosts = computed(() => props.state.crafting.costs.find(c => c.kind === kind.value)?.tiers ?? [])
/** Every model has its own price, so the bench prices the one you picked rather than the kind. */
const currentCost = computed(() => {
    const base = tierCosts.value.find(t => t.tier === tier.value)
    if (!base) return null
    const price = voidCraftCost(kind.value, tier.value, type.value)
    return { ...base, ...price, affordable: voidCanAffordPrice(price, props.state.resources, props.state.balance, props.state.gems) }
})
const damage = computed(() => {
    const id = selectedType.value && VOID_DAMAGE_TYPE[selectedType.value.id]
    return id ? { id, ...DAMAGE_NOTES[id] } : null
})
const canCraft = computed(() => !!currentCost.value?.unlocked && !!currentCost.value.affordable && !!selectedType.value && tier.value >= selectedType.value.minTier)
const craftBlocker = computed(() => {
    if (!selectedType.value) return 'Pick a model.'
    if (!currentCost.value?.unlocked) return `Clear sector ${tier.value - 1} to craft T${tier.value} gear.`
    if (tier.value < selectedType.value.minTier) return `The ${selectedType.value.name} starts at T${selectedType.value.minTier}.`
    if (!currentCost.value.affordable) return 'Not enough materials. Anything shown in red is what you are short of.'
    return null
})
const totalWeight = computed(() => props.state.crafting.rarities.reduce((s, r) => s + r.weight, 0))

watch(selectedType, (t) => {
    if (!t) return
    const max = props.state.crafting.maxTier
    // A model you cannot build yet still shows its real price, at the tier it starts from.
    if (tier.value < t.minTier) tier.value = t.minTier
    // Coming back from one of those, drop to the best tier you can actually craft.
    else if (tier.value > max && t.minTier <= max) tier.value = max
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
.vw-socket { cursor: help; }
.vw-socket-art { width: 18px; height: 18px; }
.vw-craft { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 340px); gap: 18px; align-items: start; }
.vw-craft-steps { min-width: 0; }
.vw-preview { position: sticky; top: 12px; display: grid; gap: 8px; padding: 14px; background: linear-gradient(160deg, rgba(94, 200, 255, 0.07), transparent 70%); border: 1px solid var(--vr-line); }
.vw-preview-art { justify-self: center; }
.vw-preview-name { display: flex; align-items: baseline; gap: 8px; }
.vw-preview-name b { font-size: 18px; font-weight: 700; letter-spacing: 0.06em; }
.vw-preview-name span { font: 700 12px 'JetBrains Mono', monospace; color: var(--vr-muted); }
.vw-preview-desc { margin: 0; font-size: 13px; line-height: 1.4; color: rgba(230, 241, 255, 0.72); }
.vw-preview-bp { font-style: normal; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--vr-gold); }
@media (max-width: 1100px) { .vw-craft { grid-template-columns: minmax(0, 1fr); } .vw-preview { position: static; } }
.vw-bench { display: flex; align-items: center; gap: 16px; margin-bottom: 10px; padding: 12px 14px; background: linear-gradient(120deg, rgba(94, 200, 255, 0.07), transparent 65%); border: 1px solid var(--vr-line); }
.vw-bench-art { box-shadow: 0 0 30px rgba(94, 200, 255, 0.12); }
.vw-bench-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.vw-bench-text b { font-size: 18px; font-weight: 700; letter-spacing: 0.06em; }
.vw-bench-text span { font-size: 13px; line-height: 1.35; color: rgba(230, 241, 255, 0.7); }
.vw-bench-text em { font-style: normal; font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--vr-gold); }
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

<style>
/* Page redesign: soft panels, pills instead of boxed steps. */
.vh-page .vw { gap: 0; }
.vh-page .vw-views { position: static; display: inline-flex; justify-self: start; gap: 2px; margin: 0 0 16px; padding: 3px; background: var(--vr-panel); border: 1px solid var(--vr-line); border-radius: 10px; }
.vh-page .vw-view { padding: 7px 16px; font-size: 14px; letter-spacing: 0.03em; text-transform: none; border: 0; border-radius: 7px; }
.vh-page .vw-view.vw-on { background: var(--vr-panel-2); box-shadow: inset 0 0 0 1px var(--vr-line-strong); }
.vh-page .vw-view small { border-radius: 8px; }
.vh-page .vw-craft { grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; padding: 0; border: 0; background: none; }
.vh-page .vw-craft-steps { display: grid; gap: 8px; padding: 18px; background: var(--vr-panel); border: 1px solid var(--vr-line); border-radius: 12px; }
.vh-page .vw-step { margin-top: 12px; font-size: 12px; letter-spacing: 0.1em; color: var(--vr-muted); }
.vh-page .vw-step:first-child { margin-top: 0; }
.vh-page .vw-step small { letter-spacing: 0; }
.vh-page .vw-kinds { grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px; }
.vh-page .vw-kind { padding: 10px 4px; letter-spacing: 0.04em; text-transform: none; font-size: 13px; background: var(--vr-panel-2); border: 1px solid transparent; border-radius: 9px; }
.vh-page .vw-kind.vw-on { border-color: var(--vr-accent); background: rgba(94, 200, 255, 0.12); }
.vh-page .vw-desc { font-size: 13px; color: var(--vr-muted); }
.vh-page .vw-types { gap: 6px; }
.vh-page .vw-type { padding: 7px 12px; font-size: 13px; background: var(--vr-panel-2); border: 1px solid transparent; border-radius: 9px; }
.vh-page .vw-type.vw-on { border-color: var(--c); }
.vh-page .vw-tiers { gap: 6px; }
.vh-page .vw-tier { padding: 8px 0; background: var(--vr-panel-2); border: 1px solid transparent; border-radius: 9px; }
.vh-page .vw-tier.vw-on { border-color: var(--vr-gold); }
.vh-page .vw-preview { padding: 16px; background: var(--vr-panel); border: 1px solid var(--vr-line); border-radius: 12px; }
.vh-page .vtp { border: 0; border-radius: 9px; overflow: hidden; }
.vh-page .vw-craft-go { border-radius: 9px; }
.vw-dmg { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 8px 10px; font-size: 13px; background: var(--vr-panel-2); border-radius: 9px; cursor: help; }
.vw-dmg b { font-weight: 700; }
.vw-dmg span { color: var(--vr-muted); }
.vw-dmg-energy { color: #6fd8ff; }
.vw-dmg-kinetic { color: #ffd35e; }
.vw-dmg-explosive { color: #ff8a5e; }
.vw-odds-box { display: grid; gap: 6px; margin-top: 4px; padding-top: 12px; border-top: 1px solid var(--vr-line); cursor: help; }
.vw-odds-box > small { font-size: 12px; color: var(--vr-muted); }
.vh-page .vw-odds { height: 6px; border-radius: 3px; overflow: hidden; }
.vh-page .vw-mod { padding: 12px; background: var(--vr-panel); border: 1px solid var(--vr-line); border-radius: 10px; cursor: default; }
.vh-page .vw-mod b { font-size: 14px; }
.vh-page .vw-mod span { font-size: 12px; }
.vh-page .vw-empty { border-radius: 10px; }
@media (max-width: 1100px) { .vh-page .vw-craft { grid-template-columns: minmax(0, 1fr); } .vh-page .vw-kinds { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
</style>
