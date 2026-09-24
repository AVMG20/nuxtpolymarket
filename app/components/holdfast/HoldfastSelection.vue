<script setup lang="ts">
import { BUILDINGS, KEEP_PACK_CAP, TERRITORY, UNITS, UPGRADES, UPGRADE_ORDER, WALL_RANGE_BONUS, WALL_TIER_NAMES, type UpgradeId } from '#shared/utils/holdfast/config'
import { costEntries, PLAYER, scaleCost, type HoldfastSim } from '#shared/utils/holdfast/sim'
import HoldfastCost from '~/components/holdfast/HoldfastCost.vue'
import type { Selection } from '~/utils/holdfast/renderer'
import { RESOURCE_META } from '~/utils/holdfast/ui'

const props = defineProps<{ sim: HoldfastSim, version: number, selection: Selection }>()
const emit = defineEmits<{
    upgrade: [id: number]
    upgradeLine: [id: number]
    repair: [id: number]
    sell: [id: number]
    reinforce: [id: number]
    disband: [id: number]
    move: [id: number]
    buy: [id: UpgradeId]
    close: []
}>()

interface Stat {
    label: string
    icon: string
    tone: string
    value: string
    next?: string | null
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V']

function num(n: number): string {
    return n >= 10 || Number.isInteger(n) ? String(Math.round(n)) : n.toFixed(1)
}

const building = computed(() => {
    void props.version
    if (props.selection?.type !== 'building') return null
    const s = props.sim
    const b = s.building(props.selection.id)
    if (!b) return null
    const def = BUILDINGS[b.kind]
    const upgradeCost = s.upgradeCost(b)
    const canUp = s.canUpgrade(b)
    const lv = b.level
    const hasNext = !!upgradeCost
    const stats: Stat[] = []

    if (def.produces) {
        const mult = 1 + 0.15 * s.upgrades.prosperity
        const meta = RESOURCE_META[def.produces.resource]
        const now = (def.produces.rate[lv - 1] ?? 0) * mult
        const next = def.produces.rate[lv]
        stats.push({ label: meta.name, icon: meta.icon, tone: meta.color, value: `+${now.toFixed(now < 1 ? 2 : 1)}/s`, next: hasNext && next !== undefined ? `+${(next * mult).toFixed(next < 1 ? 2 : 1)}` : null })
        if (def.produces.consumes) {
            const c = RESOURCE_META[def.produces.consumes.resource]
            stats.push({ label: 'Uses', icon: c.icon, tone: c.color, value: `${(now * def.produces.consumes.ratio).toFixed(1)} ${c.name.toLowerCase()}/s` })
        }
    }
    if (def.attack) {
        const fire = 1 + 0.3 * s.upgrades.fletching
        const dmg = (def.attack.damage[lv - 1] ?? 0) * fire
        const nextDmg = def.attack.damage[lv]
        const range = def.attack.range[lv - 1] ?? 0
        const nextRange = def.attack.range[lv]
        stats.push({ label: 'Damage', icon: 'i-lucide-crosshair', tone: 'text-red-300', value: num(dmg), next: hasNext && nextDmg !== undefined ? num(nextDmg * fire) : null })
        stats.push({ label: 'Range', icon: 'i-lucide-radius', tone: 'text-sky-300', value: num(range), next: hasNext && nextRange !== undefined ? num(nextRange) : null })
        stats.push({ label: 'Fires', icon: 'i-lucide-timer', tone: 'text-(--hf-muted)', value: `every ${def.attack.cooldown}s` })
    }
    if (b.kind === 'keep') {
        const nextCap = KEEP_PACK_CAP[lv]
        const nextTerr = TERRITORY[lv]
        stats.push({ label: 'Packs', icon: 'i-lucide-users', tone: 'text-sky-300', value: `${s.playerPacks} / ${s.packCap}`, next: hasNext && nextCap !== undefined ? `${s.packCap + nextCap - (KEEP_PACK_CAP[lv - 1] ?? 0)}` : null })
        stats.push({ label: 'Territory', icon: 'i-lucide-circle-dashed', tone: 'text-amber-200', value: `${s.territory}`, next: hasNext && nextTerr !== undefined ? `${nextTerr}` : null })
    }
    if (def.packCap) stats.push({ label: 'Pack cap', icon: 'i-lucide-users', tone: 'text-sky-300', value: `+${def.packCap}` })

    const line = def.segment ? s.connectedSegments(b.id) : []
    const lineUpgradable = line.filter(o => s.upgradeCost(o))
    const lineCost = upgradeCost && lineUpgradable.length > 1 ? scaleCost(upgradeCost, lineUpgradable.length, false, true) : null
    const techs = UPGRADE_ORDER.filter(id => UPGRADES[id].building === b.kind).map((id) => {
        const cost = s.techCost(id)
        const check = s.canBuyUpgrade(id)
        return { id, def: UPGRADES[id], level: s.upgrades[id], max: UPGRADES[id].cost.length, cost, ok: check.ok }
    })
    const hpMult = b.kind === 'wall' || b.kind === 'gate' || b.kind === 'tower' ? 1 + 0.3 * s.upgrades.masonry : 1
    const nextHp = def.hp[lv]
    const repairCost = s.repairCost(b)
    const underAttack = s.time - b.lastHitAt < 3
    return {
        b,
        def,
        name: def.segment ? `${WALL_TIER_NAMES[lv - 1] ?? ''} ${def.name}` : def.name,
        maxLevel: def.hp.length,
        upgradeCost,
        canUp,
        upLabel: def.segment ? `Upgrade to ${WALL_TIER_NAMES[lv] ?? ''}` : `Upgrade to level ${ROMAN[lv] ?? lv + 1}`,
        upNote: nextHp !== undefined ? `Health ${b.maxHp} → ${Math.round(nextHp * hpMult)}` : null,
        stats,
        lineCount: lineUpgradable.length,
        lineCost,
        techs,
        repairCost,
        canRepair: !underAttack && s.canAfford(repairCost),
        damaged: b.hp < b.maxHp,
        underAttack,
        sell: s.sellValue(b),
        hpFrac: Math.max(0, b.hp / b.maxHp)
    }
})

const pack = computed(() => {
    void props.version
    if (props.selection?.type !== 'pack') return null
    const s = props.sim
    const p = s.packs.get(props.selection.id)
    if (!p) return null
    const units = p.unitIds.map(id => s.unit(id)).filter(u => !!u)
    const hp = units.reduce((a, u) => a + u.hp, 0)
    const max = units.reduce((a, u) => a + u.maxHp, 0)
    const size = s.packSize(p.kind)
    const cost = s.reinforceCost(p.id)
    const def = UNITS[p.kind]
    const st = s.unitStats(p.kind, PLAYER)
    const range = st.range + (def.ranged && p.wallBound ? WALL_RANGE_BONUS : 0)
    const fighting = units.some(u => u.targetUnit >= 0)
    const stats: Stat[] = [
        { label: 'Health', icon: 'i-lucide-heart', tone: 'text-rose-300', value: `${Math.round(st.hp)} each` },
        { label: 'Damage', icon: 'i-lucide-swords', tone: 'text-red-300', value: `${num(st.damage)} / ${def.cooldown}s` },
        { label: 'Range', icon: 'i-lucide-radius', tone: 'text-sky-300', value: def.ranged ? num(range) : 'Melee' },
        { label: 'Pack DPS', icon: 'i-lucide-flame', tone: 'text-orange-300', value: num((st.damage / def.cooldown) * units.length) }
    ]
    if (st.armor > 0) stats.push({ label: 'Armour', icon: 'i-lucide-shield', tone: 'text-stone-300', value: `${Math.round(st.armor * 100)}%` })
    if (st.siege > 0) stats.push({ label: 'Siege', icon: 'i-lucide-hammer', tone: 'text-orange-300', value: num(st.siege) })
    return {
        p,
        def,
        count: units.length,
        size,
        hp,
        max,
        hpFrac: max > 0 ? hp / max : 0,
        cost,
        canReinforce: !!cost && s.canAfford(cost),
        stats,
        status: p.moving
            ? { text: 'Marching', tone: 'is-info', icon: 'i-lucide-footprints' }
            : fighting
                ? { text: 'Fighting', tone: 'is-danger', icon: 'i-lucide-swords' }
                : p.wallBound
                    ? { text: 'On the wall', tone: 'is-gold', icon: 'i-lucide-brick-wall' }
                    : { text: 'Holding', tone: 'is-calm', icon: 'i-lucide-shield' }
    }
})

function hpTone(frac: number): string {
    return frac > 0.5 ? 'is-good' : frac > 0.25 ? 'is-warn' : 'is-bad'
}
</script>

<template>
    <Transition name="hf-tip" mode="out-in">
        <div v-if="building || pack" :key="selection ? `${selection.type}${selection.id}` : ''" class="hf-panel pointer-events-auto relative w-full text-left">
            <button class="hf-close absolute right-2 top-2" title="Deselect (Esc)" @click="emit('close')">
                <UIcon name="i-lucide-x" class="size-4" />
            </button>

            <template v-if="building">
                <!-- Header -->
                <div class="flex items-center gap-3 px-3 pb-2.5 pt-3 pr-9">
                    <span class="hf-socket relative size-12 shrink-0">
                        <UIcon :name="building.def.icon" class="size-6" />
                        <span v-if="building.maxLevel > 1" class="hf-level">{{ ROMAN[building.b.level - 1] }}</span>
                    </span>
                    <div class="min-w-0">
                        <div class="hf-title truncate text-[15px]">{{ building.name }}</div>
                        <div class="mt-1 flex items-center gap-2">
                            <span v-if="building.maxLevel > 1" class="flex gap-[3px]">
                                <span v-for="n in building.maxLevel" :key="n" class="hf-pip" :class="n <= building.b.level ? 'is-on' : ''" />
                            </span>
                            <span class="hf-caps text-(--hf-muted)">{{ building.maxLevel > 1 ? `Level ${building.b.level} of ${building.maxLevel}` : 'Structure' }}</span>
                        </div>
                    </div>
                </div>

                <!-- Health -->
                <div class="px-3">
                    <div class="hf-bar" :class="hpTone(building.hpFrac)">
                        <div class="hf-bar-fill" :style="{ width: `${building.hpFrac * 100}%` }" />
                        <div class="hf-bar-text">
                            <UIcon name="i-lucide-heart" class="size-3" />
                            {{ Math.ceil(building.b.hp) }} / {{ building.b.maxHp }}
                        </div>
                    </div>
                    <div v-if="building.underAttack" class="hf-status is-danger mt-1.5">
                        <UIcon name="i-lucide-siren" class="size-3" /> Under attack
                    </div>
                </div>

                <!-- Stats -->
                <div v-if="building.stats.length" class="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 px-3">
                    <div v-for="st in building.stats" :key="st.label" class="flex min-w-0 items-center gap-1.5 text-[11px]">
                        <UIcon :name="st.icon" class="size-3.5 shrink-0" :class="st.tone" />
                        <span class="shrink-0 text-(--hf-muted)">{{ st.label }}</span>
                        <span class="ml-auto truncate font-semibold tabular-nums text-(--hf-text)">
                            {{ st.value }}<span v-if="st.next" class="font-medium text-emerald-300/90"> › {{ st.next }}</span>
                        </span>
                    </div>
                </div>

                <!-- Actions -->
                <div class="hf-rule mt-3" />
                <div class="flex flex-col gap-1 p-2">
                    <button
                        v-if="building.upgradeCost"
                        class="hf-action"
                        :class="building.canUp.ok ? 'is-go' : 'is-off'"
                        :disabled="!building.canUp.ok"
                        @click="emit('upgrade', building.b.id)"
                    >
                        <UIcon name="i-lucide-arrow-big-up-dash" class="size-4 shrink-0" />
                        <span class="min-w-0 flex-1">
                            <span class="block truncate">{{ building.upLabel }}</span>
                            <span v-if="building.canUp.ok || building.canUp.reason === 'Not enough resources'" class="hf-action-sub">{{ building.upNote }}</span>
                            <span v-else class="hf-action-sub text-red-300/90">{{ building.canUp.reason }}</span>
                        </span>
                        <HoldfastCost :cost="building.upgradeCost" :have="sim.resources" stack class="items-end!" />
                    </button>
                    <div v-else-if="building.maxLevel > 1" class="hf-caps flex items-center justify-center gap-1.5 py-1 text-emerald-300/90">
                        <UIcon name="i-lucide-crown" class="size-3.5" /> Fully upgraded
                    </div>
                    <button
                        v-if="building.lineCost"
                        class="hf-action"
                        :class="building.canUp.ok && sim.canAfford(building.lineCost) ? 'is-go' : 'is-off'"
                        :disabled="!building.canUp.ok"
                        @click="emit('upgradeLine', building.b.id)"
                    >
                        <UIcon name="i-lucide-brick-wall" class="size-4 shrink-0" />
                        <span class="min-w-0 flex-1">
                            <span class="block truncate">Whole wall line</span>
                            <span class="hf-action-sub">{{ building.lineCount }} segments, as many as you can afford</span>
                        </span>
                        <HoldfastCost :cost="building.lineCost" :have="sim.resources" stack class="items-end!" />
                    </button>

                    <button
                        v-for="t in building.techs"
                        :key="t.id"
                        class="hf-action"
                        :class="t.ok ? 'is-tech' : 'is-off'"
                        :disabled="!t.ok"
                        @click="emit('buy', t.id)"
                    >
                        <UIcon :name="t.def.icon" class="size-4 shrink-0 text-violet-300" />
                        <span class="min-w-0 flex-1">
                            <span class="flex items-center gap-1.5">
                                <span class="truncate">{{ t.def.name }}</span>
                                <span class="flex gap-[3px]">
                                    <span v-for="n in t.max" :key="n" class="hf-pip is-sm" :class="n <= t.level ? 'is-on is-tech' : ''" />
                                </span>
                            </span>
                            <span class="hf-action-sub">{{ t.def.blurb }}</span>
                        </span>
                        <HoldfastCost v-if="t.cost" :cost="t.cost" :have="sim.resources" stack class="items-end!" />
                        <span v-else class="hf-caps text-emerald-300">Max</span>
                    </button>

                    <div v-if="building.damaged || building.b.kind !== 'keep'" class="mt-0.5 flex gap-1">
                        <button
                            v-if="building.damaged"
                            class="hf-action flex-1"
                            :class="building.canRepair ? 'is-plain' : 'is-off'"
                            :disabled="!building.canRepair"
                            :title="building.underAttack ? 'Can\'t repair while under attack' : 'Repair to full health'"
                            @click="emit('repair', building.b.id)"
                        >
                            <UIcon name="i-lucide-wrench" class="size-4 shrink-0" />
                            <span>Repair</span>
                            <HoldfastCost class="ml-auto" :cost="building.repairCost" :have="sim.resources" />
                        </button>
                        <button
                            v-if="building.b.kind !== 'keep'"
                            class="hf-action is-danger flex-1"
                            title="Demolish for a partial refund"
                            @click="emit('sell', building.b.id)"
                        >
                            <UIcon name="i-lucide-trash-2" class="size-4 shrink-0" />
                            <span>{{ costEntries(building.sell).length ? 'Sell' : 'Demolish' }}</span>
                            <HoldfastCost v-if="costEntries(building.sell).length" class="ml-auto" :cost="building.sell" />
                        </button>
                    </div>
                </div>
            </template>

            <template v-else-if="pack">
                <div class="flex items-center gap-3 px-3 pb-2.5 pt-3 pr-9">
                    <span class="hf-socket is-army relative size-12 shrink-0">
                        <UIcon :name="pack.def.icon" class="size-6" />
                        <span class="hf-level is-army">{{ pack.count }}</span>
                    </span>
                    <div class="min-w-0">
                        <div class="hf-title truncate text-[15px]">{{ pack.def.name }}</div>
                        <div class="mt-1 flex items-center gap-2">
                            <span class="hf-caps text-(--hf-muted)">{{ pack.count }} of {{ pack.size }} soldiers</span>
                            <span class="hf-status" :class="pack.status.tone">
                                <UIcon :name="pack.status.icon" class="size-3" /> {{ pack.status.text }}
                            </span>
                        </div>
                    </div>
                </div>

                <div class="px-3">
                    <div class="hf-bar" :class="hpTone(pack.hpFrac)">
                        <div class="hf-bar-fill" :style="{ width: `${pack.hpFrac * 100}%` }" />
                        <div class="hf-bar-text">
                            <UIcon name="i-lucide-heart" class="size-3" />
                            {{ Math.ceil(pack.hp) }} / {{ Math.round(pack.max) }}
                        </div>
                    </div>
                    <div class="mt-1 flex gap-[3px]">
                        <span v-for="n in pack.size" :key="n" class="h-1 flex-1 rounded-full" :class="n <= pack.count ? 'bg-sky-300/80' : 'bg-white/10'" />
                    </div>
                </div>

                <div class="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 px-3">
                    <div v-for="st in pack.stats" :key="st.label" class="flex min-w-0 items-center gap-1.5 text-[11px]">
                        <UIcon :name="st.icon" class="size-3.5 shrink-0" :class="st.tone" />
                        <span class="shrink-0 text-(--hf-muted)">{{ st.label }}</span>
                        <span class="ml-auto truncate font-semibold tabular-nums text-(--hf-text)">{{ st.value }}</span>
                    </div>
                </div>
                <p class="px-3 pt-2 text-[10.5px] leading-snug text-(--hf-muted)">
                    Right-click the ground to move. They fight anything that comes near their post.
                </p>

                <div class="hf-rule mt-2.5" />
                <div class="flex flex-col gap-1 p-2">
                    <button class="hf-action is-plain" @click="emit('move', pack.p.id)">
                        <UIcon name="i-lucide-move" class="size-4 shrink-0" />
                        <span class="flex-1">Move</span>
                        <kbd class="hf-kbd">M</kbd>
                    </button>
                    <button
                        v-if="pack.cost"
                        class="hf-action"
                        :class="pack.canReinforce ? 'is-go' : 'is-off'"
                        :disabled="!pack.canReinforce"
                        @click="emit('reinforce', pack.p.id)"
                    >
                        <UIcon name="i-lucide-user-plus" class="size-4 shrink-0" />
                        <span class="min-w-0 flex-1">
                            <span class="block truncate">Reinforce</span>
                            <span class="hf-action-sub">Refill to {{ pack.size }} soldiers</span>
                        </span>
                        <HoldfastCost :cost="pack.cost" :have="sim.resources" stack class="items-end!" />
                    </button>
                    <button class="hf-action is-danger" @click="emit('disband', pack.p.id)">
                        <UIcon name="i-lucide-user-x" class="size-4 shrink-0" />
                        <span class="flex-1">Disband</span>
                    </button>
                </div>
            </template>
        </div>
    </Transition>
</template>

<style scoped>
.hf-level {
    position: absolute;
    right: -5px;
    bottom: -5px;
    min-width: 18px;
    padding: 0 4px;
    border-radius: 3px;
    font-size: 9.5px;
    font-weight: 800;
    line-height: 16px;
    text-align: center;
    color: #1b150d;
    background: linear-gradient(180deg, #f5dc9c, #c9a35a);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.7), 0 1px 3px rgba(0, 0, 0, 0.5);
}

.hf-level.is-army {
    color: #06202e;
    background: linear-gradient(180deg, #cdeafc, #6fb7e0);
}

/* ─── Health bar ────────────────────────────────────────── */

.hf-bar {
    --fill: #4ade80;
    --fill-dark: #15803d;
    position: relative;
    height: 16px;
    overflow: hidden;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.55);
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(201, 163, 90, 0.25);
}

.hf-bar.is-warn {
    --fill: #fbbf24;
    --fill-dark: #b45309;
}

.hf-bar.is-bad {
    --fill: #f87171;
    --fill-dark: #991b1b;
}

.hf-bar-fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: linear-gradient(180deg, var(--fill), var(--fill-dark));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
    transition: width 0.3s ease, background 0.3s;
}

/* Segment ticks every 10%. */
.hf-bar::after {
    content: '';
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(90deg, transparent 0 calc(10% - 1px), rgba(0, 0, 0, 0.35) calc(10% - 1px) 10%);
    pointer-events: none;
}

.hf-bar-text {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    font-size: 10.5px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: #fff;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
}

/* ─── Status tags ───────────────────────────────────────── */

.hf-status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    border: 1px solid currentColor;
}

.hf-status.is-danger {
    color: #fca5a5;
    background: rgba(220, 38, 38, 0.15);
    animation: hf-alarm 1s ease-in-out infinite;
}

.hf-status.is-info {
    color: #7dd3fc;
    background: rgba(56, 189, 248, 0.1);
}

.hf-status.is-gold {
    color: #f0d18a;
    background: rgba(240, 209, 138, 0.1);
}

.hf-status.is-calm {
    color: rgba(239, 230, 210, 0.6);
    background: rgba(255, 255, 255, 0.04);
}

@keyframes hf-alarm {
    50% { background: rgba(220, 38, 38, 0.35); }
}

/* ─── Actions ───────────────────────────────────────────── */

.hf-action {
    display: flex;
    min-height: 36px;
    align-items: center;
    gap: 0.55rem;
    padding: 0.35rem 0.55rem;
    border-radius: 4px;
    border: 1px solid transparent;
    font-size: 12px;
    font-weight: 600;
    text-align: left;
    color: var(--hf-text);
    transition: background-color 0.15s, border-color 0.15s, transform 0.12s, box-shadow 0.15s;
}

.hf-action:not(:disabled):active {
    transform: translateY(1px);
}

.hf-action-sub {
    display: block;
    overflow: hidden;
    font-size: 10px;
    font-weight: 500;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--hf-muted);
}

.hf-action.is-go {
    border-color: rgba(240, 209, 138, 0.45);
    background: linear-gradient(180deg, rgba(240, 209, 138, 0.16), rgba(240, 209, 138, 0.05));
}

.hf-action.is-go:hover {
    border-color: rgba(240, 209, 138, 0.85);
    box-shadow: 0 0 12px rgba(240, 190, 90, 0.18);
}

.hf-action.is-go > :first-child {
    color: #f0d18a;
}

.hf-action.is-tech {
    border-color: rgba(167, 139, 250, 0.4);
    background: linear-gradient(180deg, rgba(167, 139, 250, 0.14), rgba(167, 139, 250, 0.04));
}

.hf-action.is-tech:hover {
    border-color: rgba(196, 181, 253, 0.8);
}

.hf-action.is-plain {
    border-color: rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.04);
}

.hf-action.is-plain:hover {
    border-color: rgba(240, 209, 138, 0.5);
    background: rgba(255, 255, 255, 0.07);
}

.hf-action.is-danger {
    border-color: rgba(248, 113, 113, 0.22);
    background: rgba(248, 113, 113, 0.06);
    color: #fecaca;
}

.hf-action.is-danger:hover {
    border-color: rgba(248, 113, 113, 0.55);
    background: rgba(248, 113, 113, 0.14);
}

.hf-action.is-off {
    border-color: rgba(255, 255, 255, 0.06);
    background: rgba(255, 255, 255, 0.02);
    color: rgba(239, 230, 210, 0.6);
    cursor: not-allowed;
}
</style>
