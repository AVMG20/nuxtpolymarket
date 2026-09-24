<script setup lang="ts">
import { BUILDINGS, RESOURCES, UNITS, UPGRADES, UPGRADE_ORDER, WALL_RANGE_BONUS, WALL_TIER_NAMES, type Cost, type Resource, type Resources, type UnitKind, type UpgradeId } from '#shared/utils/holdfast/config'
import { costEntries, PLAYER, type HoldfastSim } from '#shared/utils/holdfast/sim'
import HoldfastCost from '~/components/holdfast/HoldfastCost.vue'
import { RESOURCE_META, SHORT_NAMES, TOOLBAR, shortAmount, type Tool, type ToolbarItem } from '~/utils/holdfast/ui'

const props = defineProps<{ sim: HoldfastSim, version: number, tool: Tool, upgradesOpen: boolean, hint?: string | null }>()
const emit = defineEmits<{ pick: [item: ToolbarItem], upgrades: [], buy: [id: UpgradeId] }>()

interface Stat {
    label: string
    value: string
    icon: string
    tone?: string
}

interface Card {
    item: ToolbarItem
    name: string
    short: string
    icon: string
    blurb: string
    cost: Cost
    locked: string | null
    affordable: boolean
    /** 0..1: how much of the cost is already in the bank. Fills the slot up like a cooldown. */
    ready: number
    active: boolean
    badge: string | null
    meta: string
    stats: Stat[]
    note: string | null
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V']

const UNIT_BLURBS: Partial<Record<UnitKind, string>> = {
    warrior: 'Sturdy melee pack. Holds gates and chokepoints.',
    archer: 'Ranged pack. Place them on a wall to shoot further and stay out of reach.',
    knight: 'Armoured melee pack. Shrugs off arrows and anchors the line.',
    catapult: 'Siege engine. Lobs stones that splash a crowd, but can\'t hit anything too close.'
}

function readiness(cost: Cost, have: Resources): number {
    let f = 1
    for (const [r, need] of costEntries(cost)) f = Math.min(f, need > 0 ? have[r] / need : 1)
    return Math.max(0, Math.min(1, f))
}

function rate(n: number): string {
    return n >= 1 ? n.toFixed(1) : n.toFixed(2)
}

const cards = computed<Card[]>(() => {
    void props.version
    const s = props.sim
    return TOOLBAR.map((item): Card => {
        if (item.type === 'deploy') {
            const def = UNITS[item.kind]
            const cost = s.packCost(item.kind)
            const capped = s.playerPacks >= s.packCap
            const st = s.unitStats(item.kind, PLAYER)
            const size = s.packSize(item.kind)
            const unlock = s.unitUnlocked(item.kind)
            const stats: Stat[] = [
                { label: 'Health', value: `${Math.round(st.hp)}`, icon: 'i-lucide-heart', tone: 'text-rose-300' },
                { label: 'Damage', value: `${Math.round(st.damage)} / ${def.cooldown}s`, icon: 'i-lucide-swords', tone: 'text-red-300' },
                { label: 'Range', value: def.ranged ? `${st.range.toFixed(1)}${def.minRange > 0 ? ` (min ${def.minRange})` : ''}` : 'Melee', icon: 'i-lucide-radius', tone: 'text-sky-300' }
            ]
            if (st.armor > 0) stats.push({ label: 'Armour', value: `${Math.round(st.armor * 100)}%`, icon: 'i-lucide-shield', tone: 'text-stone-300' })
            if (st.siege > 0) stats.push({ label: 'Siege', value: `${Math.round(st.siege)}`, icon: 'i-lucide-hammer', tone: 'text-orange-300' })
            stats.push({ label: 'Army', value: `${s.playerPacks} / ${s.packCap} packs`, icon: 'i-lucide-flag', tone: 'text-amber-200' })
            return {
                item,
                name: `${def.name} pack`,
                short: SHORT_NAMES[item.kind] ?? def.name,
                icon: def.icon,
                blurb: UNIT_BLURBS[item.kind] ?? (def.ranged ? 'Ranged pack. Keep them behind the line.' : 'Melee pack. Holds gates and chokepoints.'),
                cost,
                locked: !unlock.ok ? unlock.reason ?? 'Locked' : capped ? `Pack cap reached (${s.packCap})` : null,
                affordable: s.canAfford(cost),
                ready: readiness(cost, s.resources),
                active: props.tool?.type === 'deploy' && props.tool.kind === item.kind,
                badge: null,
                meta: `${item.group} · ${size} per pack`,
                stats,
                note: `Stats are per soldier.${item.kind === 'archer' ? ` +${WALL_RANGE_BONUS} range on a wall.` : ''}`
            }
        }
        const def = BUILDINGS[item.kind]
        const cost = def.segment ? def.cost : s.buildCost(item.kind)
        const count = s.count(item.kind)
        const hpMult = item.kind === 'wall' || item.kind === 'gate' || item.kind === 'tower' ? 1 + 0.3 * s.upgrades.masonry : 1
        const stats: Stat[] = []
        if (def.segment) {
            stats.push({ label: 'Health', value: def.hp.map(h => shortAmount(h * hpMult)).join(' / '), icon: 'i-lucide-heart', tone: 'text-rose-300' })
            stats.push({ label: 'Tiers', value: WALL_TIER_NAMES.join(' → '), icon: 'i-lucide-layers', tone: 'text-stone-300' })
        } else {
            stats.push({ label: 'Health', value: `${Math.round((def.hp[0] ?? 0) * hpMult)}`, icon: 'i-lucide-heart', tone: 'text-rose-300' })
        }
        if (def.produces) {
            const mult = 1 + 0.15 * s.upgrades.prosperity
            const meta = RESOURCE_META[def.produces.resource]
            const top = def.produces.rate[def.produces.rate.length - 1] ?? 0
            stats.push({ label: meta.name, value: `+${rate((def.produces.rate[0] ?? 0) * mult)}/s (max +${rate(top * mult)})`, icon: meta.icon, tone: meta.color })
            if (def.produces.consumes) {
                const c = RESOURCE_META[def.produces.consumes.resource]
                stats.push({ label: 'Consumes', value: `${def.produces.consumes.ratio} ${c.name.toLowerCase()} each`, icon: c.icon, tone: c.color })
            }
        }
        if (def.attack) {
            const dmg = (def.attack.damage[0] ?? 0) * (item.kind === 'tower' ? 1 + 0.3 * s.upgrades.fletching : 1)
            stats.push({ label: 'Damage', value: `${Math.round(dmg)} / ${def.attack.cooldown}s`, icon: 'i-lucide-crosshair', tone: 'text-red-300' })
            stats.push({ label: 'Range', value: `${def.attack.range[0]}`, icon: 'i-lucide-radius', tone: 'text-sky-300' })
        }
        if (def.packCap) stats.push({ label: 'Pack cap', value: `+${def.packCap}`, icon: 'i-lucide-users', tone: 'text-sky-300' })
        if (!def.segment && def.hp.length > 1) stats.push({ label: 'Levels', value: `${def.hp.length}`, icon: 'i-lucide-arrow-big-up', tone: 'text-emerald-300' })
        stats.push({ label: 'Footprint', value: `${def.size} × ${def.size}`, icon: 'i-lucide-grid-2x2', tone: 'text-(--hf-muted)' })
        let note: string | null = null
        if (def.segment) note = 'Cost is per segment.'
        else if (def.scale > 1) note = `${count > 0 ? `You have ${count}. ` : ''}Each one built makes the next ${Math.round((def.scale - 1) * 100)}% dearer.`
        return {
            item,
            name: def.name,
            short: SHORT_NAMES[item.kind] ?? def.name,
            icon: def.icon,
            blurb: def.blurb,
            cost,
            locked: s.keepLevel < def.keepLevel ? `Requires keep level ${ROMAN[def.keepLevel - 1]}` : null,
            affordable: s.canAfford(cost),
            ready: readiness(cost, s.resources),
            active: props.tool?.type === 'build' && props.tool.kind === item.kind,
            badge: !def.segment && count > 0 ? `${count}` : null,
            meta: `${item.group}${def.keepLevel > 1 ? ` · Keep ${ROMAN[def.keepLevel - 1]}` : ''}`,
            stats,
            note
        }
    })
})

const groups = computed(() => {
    const out: { name: string, cards: Card[] }[] = []
    for (const c of cards.value) {
        const last = out[out.length - 1]
        if (last && last.name === c.item.group) last.cards.push(c)
        else out.push({ name: c.item.group, cards: [c] })
    }
    return out
})

// ─── Hover card ──────────────────────────────────────────────────────────

const root = ref<HTMLElement | null>(null)
const slotEls = new Map<string, HTMLElement>()
const hoveredKey = ref<string | null>(null)

function setSlot(key: string, el: unknown) {
    if (el instanceof HTMLElement) slotEls.set(key, el)
    else slotEls.delete(key)
}

const hovered = computed(() => cards.value.find(c => c.item.kind === hoveredKey.value) ?? null)
const active = computed(() => cards.value.find(c => c.active) ?? null)
const detail = computed(() => hovered.value ?? active.value)
/** The active tool only gets a compact card, so it doesn't cover where you're building. */
const compact = computed(() => !hovered.value && !!active.value)

const shortfall = computed(() => {
    const d = detail.value
    if (!d || d.affordable) return []
    const have = props.sim.resources
    return costEntries(d.cost)
        .filter(([r, need]) => have[r] + 1e-9 < need)
        .map(([r, need]) => ({ r, missing: Math.ceil(need - have[r]), meta: RESOURCE_META[r] }))
})

function centerOf(key: string | null): number | null {
    const el = key ? slotEls.get(key) : null
    const box = root.value?.getBoundingClientRect()
    if (!el || !box) return null
    const r = el.getBoundingClientRect()
    return r.left + r.width / 2 - box.left
}

const tipLeft = computed(() => {
    void props.version
    const key = hoveredKey.value ?? active.value?.item.kind ?? null
    const x = centerOf(key)
    const w = root.value?.clientWidth ?? 0
    if (x === null || w === 0) return '50%'
    const half = 160
    return `${Math.max(half, Math.min(w - half, x))}px`
})

// ─── Upgrades drawer ─────────────────────────────────────────────────────

const upgrades = computed(() => {
    void props.version
    const s = props.sim
    return UPGRADE_ORDER.map((id) => {
        const def = UPGRADES[id]
        const level = s.upgrades[id]
        const cost = s.techCost(id)
        const check = s.canBuyUpgrade(id)
        return {
            id,
            def,
            level,
            max: def.cost.length,
            cost,
            ok: check.ok,
            reason: check.ok ? null : check.reason,
            source: BUILDINGS[def.building].name,
            ready: cost ? readiness(cost, s.resources) : 1
        }
    })
})

const upgradeReady = computed(() => upgrades.value.filter(u => u.ok).length)

// ─── Resource flashes: big jumps that aren't just income ────────────────

const flash = reactive(Object.fromEntries(RESOURCES.map(r => [r, { n: 0, dir: 'up' as 'up' | 'down' }])) as Record<Resource, { n: number, dir: 'up' | 'down' }>)
let prev: { t: number, res: Resources } | null = null

watch(() => [props.sim, props.version] as const, ([s], [oldSim]) => {
    if (s !== oldSim) prev = null
    const now = { ...s.resources }
    if (prev && s.time >= prev.t) {
        const dt = s.time - prev.t
        for (const r of RESOURCES) {
            const surprise = now[r] - prev.res[r] - s.rates[r] * dt
            if (Math.abs(surprise) >= Math.max(4, prev.res[r] * 0.03)) {
                flash[r].n++
                flash[r].dir = surprise > 0 ? 'up' : 'down'
            }
        }
    }
    prev = { t: s.time, res: now }
})
</script>

<template>
    <div ref="root" class="pointer-events-none relative flex flex-col items-center">
        <!-- Detail card for the hovered / active tool -->
        <Transition name="hf-tip">
            <div
                v-if="detail && !upgradesOpen"
                :key="compact ? 'compact' : 'full'"
                class="hf-panel hf-tip pointer-events-none absolute bottom-[calc(100%+10px)] w-80 -translate-x-1/2 text-left"
                :style="{ left: tipLeft }"
            >
                <div class="flex items-center gap-2.5 px-3 pb-2 pt-2.5">
                    <span class="hf-socket size-9" :class="detail.item.type === 'deploy' ? 'is-army' : ''">
                        <UIcon :name="detail.icon" class="size-5" />
                    </span>
                    <div class="min-w-0 flex-1">
                        <div class="hf-title truncate text-[15px]">{{ detail.name }}</div>
                        <div class="hf-caps mt-0.5 text-(--hf-muted)">{{ detail.meta }}</div>
                    </div>
                    <kbd class="hf-kbd">{{ detail.item.key }}</kbd>
                </div>

                <template v-if="!compact">
                    <div class="hf-rule" />
                    <p class="px-3 pt-2 text-xs leading-relaxed text-(--hf-text)/80">{{ detail.blurb }}</p>
                    <div class="grid grid-cols-2 gap-x-3 gap-y-1 px-3 pt-2">
                        <div v-for="st in detail.stats" :key="st.label" class="flex min-w-0 items-center gap-1.5 text-[11px]">
                            <UIcon :name="st.icon" class="size-3.5 shrink-0" :class="st.tone" />
                            <span class="shrink-0 text-(--hf-muted)">{{ st.label }}</span>
                            <span class="ml-auto truncate font-semibold tabular-nums text-(--hf-text)">{{ st.value }}</span>
                        </div>
                    </div>
                    <p v-if="detail.note" class="px-3 pt-1.5 text-[10.5px] italic text-(--hf-muted)">{{ detail.note }}</p>
                </template>

                <div class="hf-tip-foot mt-2 px-3 py-2">
                    <div class="flex items-center gap-2">
                        <span class="hf-caps text-(--hf-muted)">Cost</span>
                        <HoldfastCost :cost="detail.cost" :have="sim.resources" size="sm" />
                        <span v-if="shortfall.length && !detail.locked" class="ml-auto text-[10.5px] text-red-300/90">
                            Need
                            <template v-for="(m, i) in shortfall" :key="m.r">{{ i ? ', ' : ' ' }}{{ shortAmount(m.missing) }} {{ m.meta.name.toLowerCase() }}</template>
                        </span>
                    </div>
                    <div v-if="detail.locked" class="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-red-300">
                        <UIcon name="i-lucide-lock" class="size-3.5" /> {{ detail.locked }}
                    </div>
                    <div v-if="compact && hint" class="mt-1.5 flex items-center gap-1.5 text-[11px] text-(--hf-text)/75">
                        <UIcon name="i-lucide-mouse-pointer-click" class="size-3.5 text-(--hf-gild)" /> {{ hint }}
                    </div>
                </div>
            </div>
        </Transition>

        <!-- Hint without a card (moving a pack) -->
        <Transition name="hf-tip">
            <div
                v-if="hint && !detail && !upgradesOpen"
                class="hf-panel pointer-events-none absolute bottom-[calc(100%+10px)] left-1/2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap px-3 py-1.5 text-xs text-(--hf-text)/85"
            >
                <UIcon name="i-lucide-move" class="size-3.5 text-sky-300" /> {{ hint }}
            </div>
        </Transition>

        <!-- Upgrades drawer -->
        <Transition name="hf-tip">
            <div v-if="upgradesOpen" class="hf-panel pointer-events-auto absolute bottom-[calc(100%+10px)] left-1/2 w-[min(920px,96vw)] -translate-x-1/2">
                <div class="flex items-center gap-2.5 px-3.5 pb-2 pt-3">
                    <span class="hf-socket is-tech size-8">
                        <UIcon name="i-lucide-sparkles" class="size-4" />
                    </span>
                    <div>
                        <div class="hf-title text-[15px]">Upgrades</div>
                        <div class="text-[11px] text-(--hf-muted)">Permanent for this run. Crystals come from the Crystal Mine.</div>
                    </div>
                    <kbd class="hf-kbd ml-auto">U</kbd>
                    <button class="hf-close" title="Close (Esc)" @click="emit('upgrades')">
                        <UIcon name="i-lucide-x" class="size-4" />
                    </button>
                </div>
                <div class="hf-rule" />
                <div class="grid max-h-[50vh] grid-cols-1 gap-1.5 overflow-y-auto p-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    <button
                        v-for="u in upgrades"
                        :key="u.id"
                        class="hf-tech group"
                        :class="u.ok ? 'is-ok' : !u.cost ? 'is-max' : 'is-off'"
                        :disabled="!u.ok"
                        @click="emit('buy', u.id)"
                    >
                        <span class="hf-socket is-tech relative size-9 shrink-0 overflow-hidden">
                            <UIcon :name="u.def.icon" class="size-[18px]" />
                            <span v-if="u.cost && !u.ok" class="hf-dim" :style="{ height: `${(1 - u.ready) * 100}%` }" />
                        </span>
                        <span class="min-w-0 flex-1">
                            <span class="flex items-center gap-2">
                                <span class="truncate text-[13px] font-semibold text-(--hf-text)">{{ u.def.name }}</span>
                                <span class="flex gap-[3px]">
                                    <span v-for="n in u.max" :key="n" class="hf-pip" :class="n <= u.level ? 'is-on is-tech' : ''" />
                                </span>
                                <span class="hf-caps ml-auto shrink-0 text-(--hf-faint)">{{ u.source }}</span>
                            </span>
                            <span class="mt-0.5 block text-[11px] leading-snug text-(--hf-text)/70">{{ u.def.blurb }}</span>
                            <span class="mt-1.5 flex items-center gap-2">
                                <HoldfastCost v-if="u.cost" :cost="u.cost" :have="sim.resources" />
                                <span v-else class="hf-caps text-emerald-300">Mastered</span>
                                <span v-if="u.reason && u.cost && u.reason !== 'Not enough resources'" class="ml-auto flex items-center gap-1 text-[10.5px] text-red-300/90">
                                    <UIcon name="i-lucide-lock" class="size-3" /> {{ u.reason }}
                                </span>
                                <span v-else-if="u.ok" class="hf-caps ml-auto text-violet-200 opacity-0 transition-opacity group-hover:opacity-100">Research</span>
                            </span>
                        </span>
                    </button>
                </div>
            </div>
        </Transition>

        <!-- The command panel -->
        <div class="hf-panel hf-command pointer-events-auto max-w-[98vw]">
            <div class="hf-ribbon">
                <slot name="resources" :flash="flash" />
            </div>
            <div class="flex items-start overflow-x-auto px-2 pb-2 pt-1">
                <template v-for="(g, gi) in groups" :key="g.name">
                    <div v-if="gi > 0" class="hf-sep" />
                    <div class="flex flex-col items-center">
                        <span class="hf-group">{{ g.name }}</span>
                        <div class="flex gap-1">
                            <button
                                v-for="c in g.cards"
                                :key="c.item.kind"
                                :ref="el => setSlot(c.item.kind, el)"
                                class="hf-slot"
                                :class="{ 'is-active': c.active, 'is-locked': !!c.locked, 'is-poor': !c.locked && !c.affordable, 'is-army': c.item.type === 'deploy' }"
                                :aria-label="`${c.name} (${c.item.key})`"
                                @click="emit('pick', c.item)"
                                @mouseenter="hoveredKey = c.item.kind"
                                @mouseleave="hoveredKey = null"
                            >
                                <span class="hf-slot-tile">
                                    <UIcon :name="c.icon" class="hf-slot-icon" />
                                    <span v-if="!c.locked && !c.affordable" class="hf-dim" :style="{ height: `${(1 - c.ready) * 100}%` }" />
                                    <span class="hf-slot-key">{{ c.item.key }}</span>
                                    <span v-if="c.badge" class="hf-slot-badge">{{ c.badge }}</span>
                                    <span v-if="c.locked" class="hf-slot-lock"><UIcon name="i-lucide-lock" class="size-3.5" /></span>
                                </span>
                                <span class="hf-slot-name">{{ c.short }}</span>
                                <HoldfastCost :cost="c.cost" :have="sim.resources" stack class="mt-0.5 self-center" />
                            </button>
                        </div>
                    </div>
                </template>
                <div class="hf-sep" />
                <div class="flex flex-col items-center">
                    <span class="hf-group">Tech</span>
                    <button
                        class="hf-slot is-tech"
                        :class="{ 'is-active': upgradesOpen }"
                        aria-label="Upgrades (U)"
                        @click="emit('upgrades')"
                    >
                        <span class="hf-slot-tile">
                            <UIcon name="i-lucide-sparkles" class="hf-slot-icon" />
                            <span class="hf-slot-key">U</span>
                            <span v-if="upgradeReady" class="hf-slot-badge is-tech">{{ upgradeReady }}</span>
                        </span>
                        <span class="hf-slot-name">Upgrades</span>
                        <span class="mt-0.5 text-[10px] leading-tight" :class="upgradeReady ? 'text-violet-200' : 'text-(--hf-faint)'">{{ upgradeReady ? 'Ready' : 'None' }}</span>
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.hf-command {
    --slot: 48px;
}
@media (min-width: 1600px) {
    .hf-command {
        --slot: 54px;
    }
}

.hf-ribbon {
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid rgba(201, 163, 90, 0.22);
    background: linear-gradient(180deg, rgba(255, 236, 200, 0.045), rgba(0, 0, 0, 0.12));
    border-radius: 5px 5px 0 0;
}

.hf-group {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    height: 16px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--hf-faint);
}

.hf-sep {
    align-self: stretch;
    width: 1px;
    margin: 18px 5px 4px;
    background: linear-gradient(180deg, transparent, rgba(201, 163, 90, 0.35) 30%, rgba(201, 163, 90, 0.35) 70%, transparent);
}

/* ─── Slots ─────────────────────────────────────────────── */

.hf-slot {
    display: flex;
    width: var(--slot);
    flex-direction: column;
    align-items: stretch;
    cursor: pointer;
    outline: none;
}

.hf-slot-tile {
    position: relative;
    display: flex;
    height: var(--slot);
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-radius: 4px;
    border: 1px solid rgba(201, 163, 90, 0.28);
    background:
        radial-gradient(120% 90% at 50% 0%, rgba(255, 226, 170, 0.1), transparent 60%),
        linear-gradient(180deg, #2b241c, #17130f);
    box-shadow: inset 0 1px 0 rgba(255, 236, 200, 0.08), inset 0 -8px 14px rgba(0, 0, 0, 0.35), 0 1px 0 rgba(0, 0, 0, 0.6);
    transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}

.hf-slot-icon {
    position: relative;
    z-index: 1;
    width: calc(var(--slot) * 0.46);
    height: calc(var(--slot) * 0.46);
    color: #f3dca6;
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.7));
    transition: transform 0.15s, color 0.15s, filter 0.15s;
}

.hf-slot.is-army .hf-slot-icon {
    color: #a5d8f5;
}

.hf-slot.is-tech .hf-slot-icon {
    color: #d4c3ff;
}

.hf-slot:hover .hf-slot-tile,
.hf-slot:focus-visible .hf-slot-tile {
    border-color: rgba(240, 209, 138, 0.7);
    box-shadow: inset 0 1px 0 rgba(255, 236, 200, 0.14), inset 0 -8px 14px rgba(0, 0, 0, 0.3), 0 0 12px rgba(240, 190, 90, 0.18);
}

.hf-slot:hover .hf-slot-icon {
    transform: scale(1.08);
}

.hf-slot:active .hf-slot-tile {
    transform: translateY(1px);
}

.hf-slot.is-active .hf-slot-tile {
    border-color: #f0d18a;
    background:
        radial-gradient(120% 90% at 50% 10%, rgba(255, 210, 120, 0.3), transparent 65%),
        linear-gradient(180deg, #43341f, #211a11);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.7), 0 0 16px rgba(250, 200, 100, 0.4), inset 0 0 12px rgba(250, 200, 100, 0.25);
}

.hf-slot.is-active .hf-slot-icon {
    color: #fff3d0;
}

.hf-slot.is-tech.is-active .hf-slot-tile {
    border-color: #c4b5fd;
    background: radial-gradient(120% 90% at 50% 10%, rgba(167, 139, 250, 0.35), transparent 65%), linear-gradient(180deg, #2f2645, #17121f);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.7), 0 0 16px rgba(167, 139, 250, 0.4);
}

/* Can't afford yet: desaturated, and the dark veil shrinks as the bank fills. */
.hf-slot.is-poor .hf-slot-icon {
    filter: grayscale(0.7) brightness(0.8) drop-shadow(0 1px 1px rgba(0, 0, 0, 0.7));
}


.hf-slot.is-locked {
    cursor: not-allowed;
}

.hf-slot.is-locked .hf-slot-tile {
    border-color: rgba(255, 255, 255, 0.08);
    background: repeating-linear-gradient(-45deg, rgba(255, 255, 255, 0.025) 0 4px, transparent 4px 8px), linear-gradient(180deg, #1e1a16, #121010);
}

.hf-slot.is-locked .hf-slot-icon {
    filter: grayscale(1) brightness(0.55);
}

.hf-slot.is-locked .hf-slot-name,
.hf-slot.is-locked :deep(.hf-cost) {
    opacity: 0.45;
}

.hf-slot-lock {
    position: absolute;
    z-index: 3;
    right: 2px;
    bottom: 2px;
    display: flex;
    padding: 2px;
    border-radius: 3px;
    color: #fca5a5;
    background: rgba(0, 0, 0, 0.6);
}

.hf-slot-key {
    position: absolute;
    z-index: 3;
    left: 2px;
    top: 2px;
    min-width: 13px;
    padding: 0 3px;
    border-radius: 2px;
    font-size: 9px;
    font-weight: 700;
    line-height: 13px;
    text-align: center;
    color: rgba(239, 230, 210, 0.75);
    background: rgba(0, 0, 0, 0.55);
    box-shadow: inset 0 0 0 1px rgba(201, 163, 90, 0.25);
}

.hf-slot-badge {
    position: absolute;
    z-index: 3;
    right: 2px;
    top: 2px;
    min-width: 14px;
    padding: 0 3px;
    border-radius: 7px;
    font-size: 9px;
    font-weight: 800;
    line-height: 14px;
    text-align: center;
    color: #1b150d;
    background: linear-gradient(180deg, #f5dc9c, #c9a35a);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}

.hf-slot-badge.is-tech {
    color: #1a1030;
    background: linear-gradient(180deg, #ddd0ff, #a78bfa);
    animation: hf-breathe 1.8s ease-in-out infinite;
}

.hf-slot-name {
    margin-top: 3px;
    overflow: hidden;
    font-size: 10px;
    font-weight: 600;
    line-height: 1.1;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: rgba(239, 230, 210, 0.85);
}

.hf-slot.is-active .hf-slot-name {
    color: #f0d18a;
}

/* ─── Tooltip ───────────────────────────────────────────── */

.hf-tip-foot {
    border-top: 1px solid rgba(201, 163, 90, 0.2);
    background: rgba(0, 0, 0, 0.22);
    border-radius: 0 0 5px 5px;
}

/* ─── Upgrades ──────────────────────────────────────────── */

.hf-tech {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.55rem 0.6rem;
    border-radius: 5px;
    border: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(255, 255, 255, 0.025);
    text-align: left;
    transition: border-color 0.15s, background-color 0.15s, transform 0.15s;
}

.hf-tech.is-ok {
    border-color: rgba(167, 139, 250, 0.4);
    background: linear-gradient(180deg, rgba(167, 139, 250, 0.12), rgba(167, 139, 250, 0.04));
    cursor: pointer;
}

.hf-tech.is-ok:hover {
    border-color: rgba(196, 181, 253, 0.8);
    background: linear-gradient(180deg, rgba(167, 139, 250, 0.2), rgba(167, 139, 250, 0.07));
    transform: translateY(-1px);
}

.hf-tech.is-off {
    cursor: not-allowed;
}

.hf-tech.is-off > :last-child {
    opacity: 0.75;
}

.hf-tech.is-max {
    border-color: rgba(110, 231, 183, 0.2);
    cursor: default;
}

@keyframes hf-breathe {
    0%, 100% { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.6), 0 0 0 0 rgba(167, 139, 250, 0.5); }
    50% { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.6), 0 0 0 4px rgba(167, 139, 250, 0); }
}
</style>
