<template>
    <div class="vw">
        <!-- Craft -->
        <h2 class="vh-h">Fabricator <small>Rarity is rolled on craft</small></h2>
        <div class="vw-craft">
            <div class="vw-kinds">
                <button v-for="k in kinds" :key="k.id" class="vw-kind" :class="{ 'vw-on': kind === k.id }" @click="setKind(k.id)">
                    <UIcon :name="k.icon" class="size-4" />
                    <span>{{ k.label }}</span>
                </button>
            </div>
            <div class="vw-types">
                <button
                    v-for="t in typesForKind"
                    :key="t.id"
                    class="vw-type"
                    :class="{ 'vw-on': type === t.id, 'vw-locked': t.minTier > state.crafting.maxTier }"
                    :style="{ '--c': hex(t.color) }"
                    @click="type = t.id"
                >
                    <i class="vh-dotc" />
                    <span>{{ t.name }}</span>
                    <small v-if="t.minTier > 1">T{{ t.minTier }}+</small>
                </button>
            </div>
            <p v-if="selectedType" class="vw-desc">{{ selectedType.description }}</p>
            <div class="vw-tiers">
                <button
                    v-for="t in tierCosts"
                    :key="t.tier"
                    class="vw-tier"
                    :class="{ 'vw-on': tier === t.tier, 'vw-locked': !t.unlocked || t.tier < (selectedType?.minTier ?? 1) }"
                    :disabled="!t.unlocked || t.tier < (selectedType?.minTier ?? 1)"
                    @click="tier = t.tier"
                >
                    T{{ t.tier }}
                </button>
            </div>
            <div class="vw-odds">
                <div v-for="r in state.crafting.rarities" :key="r.name" :style="{ flex: r.weight, background: r.color }" :title="`${r.name} ${oddsPct(r.weight)}%`" />
            </div>
            <div class="vw-odds-legend">
                <span v-for="r in state.crafting.rarities" :key="r.name" :style="{ color: r.color }">{{ r.name }} {{ oddsPct(r.weight) }}%</span>
            </div>
            <div v-if="currentCost" class="vh-card-foot">
                <VoidCost :cost="currentCost.resources" :held="state.resources" :coins="currentCost.coins" :gems="currentCost.gems" :balance="state.balance" :gems-held="state.gems" />
                <button class="vr-btn vr-btn-primary vr-btn-sm" :disabled="busy || !canCraft" @click="$emit('craft', kind, type, tier)">Craft</button>
            </div>
            <div v-if="!currentCost?.unlocked" class="vh-hint">Clear sector {{ tier - 1 }} to craft T{{ tier }} gear.</div>
        </div>

        <!-- Relics -->
        <h2 class="vh-h">Relic mods <small>Found in runs</small></h2>
        <div class="vw-mods">
            <div v-for="m in state.mods" :key="m.id" class="vw-mod" :class="{ 'vw-mod-none': !m.count, 'vw-on': modPick === m.id }" :style="{ '--c': hex(m.color) }" @click="m.count && (modPick = modPick === m.id ? null : m.id)">
                <UIcon name="i-lucide-gem" class="size-4" />
                <div>
                    <b>{{ m.name }} <small v-if="m.count">×{{ m.count }}</small></b>
                    <span>{{ m.description }}</span>
                    <em>{{ m.kinds.map(k => kindLabel(k)).join(' / ') }}</em>
                </div>
            </div>
        </div>
        <p v-if="modPick" class="vh-hint">Pick an item below to socket the {{ modName(modPick) }}. It replaces any mod already in the socket.</p>

        <!-- Inventory -->
        <h2 class="vh-h">Hangar stores <small>{{ state.items.length }} items</small></h2>
        <div class="vw-filter">
            <button v-for="f in filters" :key="f.id" :class="{ 'vw-on': filter === f.id }" @click="filter = f.id">{{ f.label }}</button>
        </div>
        <div class="vh-list">
            <div
                v-for="item in filtered"
                :key="item.id"
                class="vw-item"
                :class="{ 'vw-item-socketable': modPick && modFits(modPick, item.kind) }"
                :style="{ '--rc': item.rarityColor, '--c': hex(item.color) }"
            >
                <div class="vw-item-head">
                    <i class="vf-tier">T{{ item.tier }}</i>
                    <b>{{ item.name }}</b>
                    <em v-if="item.level">+{{ item.level }}</em>
                    <span class="vw-rarity">{{ item.rarityName }}</span>
                </div>
                <div class="vw-item-stats">
                    <span v-for="st in item.stats" :key="st.label">{{ st.label }} <b>{{ st.value }}</b></span>
                    <span v-if="fittedOn(item.id).length" class="vw-fitted">on {{ fittedOn(item.id).join(', ') }}</span>
                </div>
                <div v-if="item.affixList.length || item.modInfo" class="vw-affixes">
                    <span v-for="a in item.affixList" :key="a.id">{{ a.text }} {{ a.name }}</span>
                    <span v-if="item.modInfo" class="vw-socket" :style="{ color: hex(item.modInfo.color) }"><UIcon name="i-lucide-gem" class="size-3" /> {{ item.modInfo.name }}</span>
                </div>
                <div class="vw-levels" :title="'+5 and +10 each add a bonus affix'">
                    <i v-for="n in 10" :key="n" :class="{ 'vw-lv-on': n <= item.level, 'vw-lv-star': n === 5 || n === 10 }" />
                </div>
                <div class="vh-card-foot">
                    <template v-if="item.upgradeCost">
                        <VoidCost :cost="item.upgradeCost.resources" :held="state.resources" :coins="item.upgradeCost.coins" :gems="item.upgradeCost.gems" :balance="state.balance" :gems-held="state.gems" />
                    </template>
                    <span v-else class="vh-maxed">Max level</span>
                    <div class="vw-buttons">
                        <button v-if="modPick && modFits(modPick, item.kind)" class="vr-btn vr-btn-sm vr-btn-primary" :disabled="busy" @click="socket(item.id)">Socket</button>
                        <button v-if="item.upgradeCost" class="vr-btn vr-btn-sm" :disabled="busy || !item.upgradeAffordable" @click="$emit('upgrade', item.id)">+1</button>
                        <button
                            class="vr-btn vr-btn-sm vr-btn-danger"
                            :disabled="busy"
                            :title="`Returns ${salvageText(item.salvage)}`"
                            @click="salvage(item.id)"
                        >
                            {{ confirmSalvage === item.id ? 'Sure?' : 'Scrap' }}
                        </button>
                    </div>
                </div>
            </div>
            <div v-if="!filtered.length" class="vh-hint">Nothing here yet.</div>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { InternalApi } from 'nitropack/types'
import { voidHex, voidResource, type VoidResourceBundle } from '#shared/utils/gamelogic/void'
import { voidMod } from '#shared/utils/gamelogic/void-items'
import VoidCost from './VoidCost.vue'

type State = InternalApi['/api/void/state']['get']
type Kind = 'gun' | 'turret' | 'armor' | 'shield'

const props = defineProps<{
    state: State
    busy: boolean
}>()

const emit = defineEmits<{
    craft: [kind: string, type: string, tier: number]
    upgrade: [itemId: string]
    salvage: [itemId: string]
    socket: [itemId: string, modId: string]
}>()

const kinds = [
    { id: 'gun' as const, label: 'Guns', icon: 'i-lucide-crosshair' },
    { id: 'turret' as const, label: 'Turrets', icon: 'i-lucide-radar' },
    { id: 'armor' as const, label: 'Armour', icon: 'i-lucide-shield-half' },
    { id: 'shield' as const, label: 'Shields', icon: 'i-lucide-shield' }
]
const filters = [{ id: 'all', label: 'All' }, ...kinds.map(k => ({ id: k.id, label: k.label }))]

const kind = ref<Kind>('turret')
const type = ref('pulse')
const tier = ref(Math.max(1, props.state.crafting.maxTier))
const filter = ref('all')
const modPick = ref<string | null>(null)
const confirmSalvage = ref<string | null>(null)

const typesForKind = computed(() => props.state.crafting.types.filter(t => t.kind === kind.value))
const selectedType = computed(() => typesForKind.value.find(t => t.id === type.value) ?? null)
const tierCosts = computed(() => props.state.crafting.costs.find(c => c.kind === kind.value)?.tiers ?? [])
const currentCost = computed(() => tierCosts.value.find(t => t.tier === tier.value) ?? null)
const canCraft = computed(() => !!currentCost.value?.unlocked && !!currentCost.value.affordable && !!selectedType.value && tier.value >= selectedType.value.minTier)
const totalWeight = computed(() => props.state.crafting.rarities.reduce((s, r) => s + r.weight, 0))
const filtered = computed(() => props.state.items.filter(i => filter.value === 'all' || i.kind === filter.value))

watch(selectedType, (t) => {
    if (t && tier.value < t.minTier) tier.value = Math.min(props.state.crafting.maxTier, t.minTier)
})

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

function kindLabel(k: string) {
    return kinds.find(x => x.id === k)?.label ?? k
}

function modName(id: string) {
    return voidMod(id)?.name ?? id
}

function modFits(modId: string, itemKind: string) {
    return !!voidMod(modId)?.kinds.includes(itemKind as Kind)
}

function fittedOn(itemId: string) {
    return props.state.ships.filter(s => s.owned && [s.fit.gun, ...s.fit.turrets, ...s.fit.armor, ...s.fit.shields].includes(itemId)).map(s => s.name)
}

function salvageText(bundle: VoidResourceBundle) {
    return Object.entries(bundle).map(([id, n]) => `${n} ${voidResource(id).name}`).join(', ')
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
.vw { display: grid; gap: 2px; }
.vw-craft { display: grid; gap: 8px; padding: 10px 12px; border: 1px solid var(--vr-line-strong); background: linear-gradient(160deg, rgba(94, 200, 255, 0.07), rgba(255, 255, 255, 0.02)); }
.vw-kinds { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; }
.vw-kind { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 7px 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--vr-muted); border: 1px solid var(--vr-line); cursor: pointer; }
.vw-kind:hover { color: var(--vr-text); }
.vw-kind.vw-on { color: #fff; border-color: var(--vr-accent); background: rgba(94, 200, 255, 0.12); }
.vw-types { display: flex; flex-wrap: wrap; gap: 4px; }
.vw-type { display: flex; align-items: center; gap: 6px; padding: 5px 9px; font-size: 12px; font-weight: 700; border: 1px solid var(--vr-line); cursor: pointer; }
.vw-type small { font: 600 9px 'JetBrains Mono', monospace; color: var(--vr-muted); }
.vw-type.vw-on { border-color: var(--c); background: color-mix(in srgb, var(--c) 14%, transparent); }
.vw-locked { opacity: 0.4; }
.vw-desc { margin: 0; font-size: 12px; color: rgba(230, 241, 255, 0.7); }
.vw-tiers { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; }
.vw-tier { padding: 6px 0; font: 700 13px 'JetBrains Mono', monospace; border: 1px solid var(--vr-line); cursor: pointer; }
.vw-tier.vw-on { border-color: var(--vr-gold); color: var(--vr-gold); background: rgba(255, 210, 122, 0.1); }
.vw-tier:disabled { cursor: not-allowed; }
.vw-odds { display: flex; height: 5px; gap: 1px; }
.vw-odds div { min-width: 3px; }
.vw-odds-legend { display: flex; flex-wrap: wrap; gap: 2px 10px; font: 600 10px 'JetBrains Mono', monospace; }

.vw-mods { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; }
.vw-mod { display: flex; gap: 8px; padding: 7px 8px; border: 1px solid var(--vr-line); color: var(--c); cursor: pointer; }
.vw-mod b { display: block; font-size: 12px; color: var(--vr-text); }
.vw-mod b small { color: var(--c); font-family: 'JetBrains Mono', monospace; }
.vw-mod span { display: block; font-size: 11px; line-height: 1.25; color: rgba(230, 241, 255, 0.6); }
.vw-mod em { display: block; font-style: normal; font-size: 9px; letter-spacing: 0.15em; text-transform: uppercase; color: var(--vr-muted); margin-top: 2px; }
.vw-mod-none { opacity: 0.35; cursor: default; }
.vw-mod.vw-on { border-color: var(--c); box-shadow: 0 0 14px color-mix(in srgb, var(--c) 40%, transparent); }

.vw-filter { display: flex; gap: 4px; margin-bottom: 6px; }
.vw-filter button { padding: 4px 9px; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--vr-muted); border: 1px solid var(--vr-line); cursor: pointer; }
.vw-filter .vw-on { color: #fff; border-color: var(--vr-accent); }
.vw-item { --rc: #fff; padding: 8px 10px; background: linear-gradient(120deg, color-mix(in srgb, var(--rc) 10%, transparent), rgba(255, 255, 255, 0.02) 55%); border: 1px solid color-mix(in srgb, var(--rc) 35%, transparent); border-left: 3px solid var(--rc); }
.vw-item-socketable { box-shadow: 0 0 0 1px var(--vr-gold); }
.vw-item-head { display: flex; align-items: baseline; gap: 6px; font-size: 15px; }
.vw-item-head b { color: var(--rc); }
.vw-item-head em { font-style: normal; font: 700 12px 'JetBrains Mono', monospace; color: var(--vr-gold); }
.vw-rarity { margin-left: auto; font-size: 10px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: var(--rc); }
.vw-item-stats { display: flex; flex-wrap: wrap; gap: 2px 12px; margin-top: 3px; font-size: 12px; color: var(--vr-muted); }
.vw-item-stats b { font-family: 'JetBrains Mono', monospace; color: var(--vr-text); }
.vw-fitted { margin-left: auto; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--vr-good); }
.vw-affixes { display: flex; flex-wrap: wrap; gap: 2px 10px; margin-top: 3px; font: 600 11px 'JetBrains Mono', monospace; color: #b8ffe3; }
.vw-socket { display: inline-flex; align-items: center; gap: 4px; }
.vw-levels { display: flex; gap: 2px; margin: 6px 0 2px; }
.vw-levels i { flex: 1; height: 3px; background: rgba(255, 255, 255, 0.08); }
.vw-levels .vw-lv-star { height: 5px; margin-top: -1px; outline: 1px solid rgba(255, 210, 122, 0.45); }
.vw-levels .vw-lv-on { background: var(--vr-gold); box-shadow: 0 0 5px rgba(255, 210, 122, 0.6); }
.vw-buttons { display: flex; gap: 4px; flex-shrink: 0; }
</style>
