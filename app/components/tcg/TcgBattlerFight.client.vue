<script setup lang="ts">
/**
 * The battle viewer (§12.5): the client re-runs the exact shared simulation
 * from the fight's inputs and animates the event list. Layout is an arena —
 * your side on the left, the opponent on the right, actives facing each
 * other in the middle — and every attack flies as an element-typed
 * projectile so weakness hits read as "very effective" at a glance.
 * Deterministic, so what you watch is exactly what the server scored.
 */
import { simulateBattle } from '#shared/utils/battler/combat'
import type { BattleUnit, BattleItem, BattleEvent } from '#shared/utils/battler/combat'
import type { BattlerStadiumEffect } from '#shared/utils/battler/items'
import type { BattlerUnitSpec } from '#shared/utils/battler/unit'
import { BATTLER, levelFor } from '#shared/utils/battler/shop'
import { legacySetOf } from '#shared/utils/tcg/legacy'

interface RenderedUnit extends BattleUnit {
    render: { bundle: string | null, plaatjesCardId: string | null, assetNumber: string | null }
}

const props = defineProps<{
    myBoard: RenderedUnit[]
    opponentName: string
    opponentBoard: RenderedUnit[]
    seed: number
    result: 'win' | 'loss' | 'draw'
    stadium?: { name: string, effect: BattlerStadiumEffect, source: 'mine' | 'theirs' } | null
}>()
const emit = defineEmits<{ done: [] }>()

// Energy identities — cosmetic, so the printed element colors are the point.
const TYPES: Record<string, { glyph: string, label: string, chip: string }> = {
    Fire: { glyph: '🔥', label: 'Fire', chip: 'bg-red-500/15 text-red-500' },
    Water: { glyph: '💧', label: 'Water', chip: 'bg-blue-500/15 text-blue-400' },
    Grass: { glyph: '🍃', label: 'Grass', chip: 'bg-green-500/15 text-green-500' },
    Lightning: { glyph: '⚡', label: 'Lightning', chip: 'bg-yellow-500/15 text-yellow-500' },
    Psychic: { glyph: '🔮', label: 'Psychic', chip: 'bg-purple-500/15 text-purple-400' },
    Fighting: { glyph: '👊', label: 'Fighting', chip: 'bg-orange-600/15 text-orange-500' },
    Darkness: { glyph: '🌑', label: 'Darkness', chip: 'bg-zinc-700/40 text-zinc-300' },
    Metal: { glyph: '⚙️', label: 'Metal', chip: 'bg-slate-500/20 text-slate-400' },
    Dragon: { glyph: '🐉', label: 'Dragon', chip: 'bg-amber-600/15 text-amber-500' },
    Fairy: { glyph: '✨', label: 'Fairy', chip: 'bg-pink-500/15 text-pink-400' },
    Colorless: { glyph: '⭐', label: 'Colorless', chip: 'bg-neutral-500/15 text-neutral-400' }
}
const FALLBACK_TYPE = { glyph: '⭐', label: '—', chip: 'bg-neutral-500/15 text-neutral-400' }
const typeInfo = (type: string | null) => (type && TYPES[type]) || FALLBACK_TYPE

interface ViewUnit {
    key: string
    name: string
    spec: BattlerUnitSpec
    render: RenderedUnit['render']
    maxHp: number
    hp: number
    charge: number
    chargeMax: number
    level: number
    type: string | null
    attackName: string
    attackDamage: number
    items: BattleItem[]
    noWeakness: boolean
    fainted: boolean
    flash: 'hit' | 'attack' | null
}

function toView(unit: RenderedUnit): ViewUnit {
    const level = levelFor(unit.instances)
    const multiplier = BATTLER.levelMultiplier[level] ?? 1
    const attack = unit.spec.attacks.find(entry => entry.attackId === unit.attackId) ?? unit.spec.attacks[0]!
    // Mirror the engine's toLive: level multiplier, then items, then stadium.
    let hp = Math.max(1, Math.round(unit.spec.hp * multiplier))
    let damage = Math.max(1, Math.round(attack.damage * multiplier))
    let chargeMax = attack.charge
    let noWeakness = false
    const stadium = props.stadium?.effect
    for (const item of unit.items ?? []) {
        hp += item.effect.hp ?? 0
        damage += item.effect.atk ?? 0
        chargeMax += item.effect.charge ?? 0
        if (item.effect.noWeakness) noWeakness = true
    }
    if (stadium) {
        hp += stadium.allHp ?? 0
        damage += stadium.allAtk ?? 0
        chargeMax += stadium.allCharge ?? 0
        if (stadium.noWeakness) noWeakness = true
    }
    hp = Math.max(1, hp)
    return {
        key: unit.key,
        name: unit.spec.name,
        spec: unit.spec,
        render: unit.render,
        maxHp: hp,
        hp,
        charge: 0,
        chargeMax: Math.max(1, chargeMax),
        level,
        type: unit.spec.type,
        attackName: attack.name,
        attackDamage: Math.max(1, damage),
        items: unit.items ?? [],
        noWeakness,
        fainted: false,
        flash: null
    }
}

const mine = ref<ViewUnit[]>([])
const theirs = ref<ViewUnit[]>([])
// Your row reads bench → active left-to-right, so the active leads the
// charge toward the enemy's corner.
const mineOrdered = computed(() => [...mine.value].reverse())
const round = ref(0)
const speed = ref(1)
const finished = ref(false)

interface DamageFloat { id: number, key: string, amount: number, note: 'super' | 'resist' | null }
const damageFloats = ref<DamageFloat[]>([])
const prizeFloats = ref<{ id: number, key: string }[]>([])
let floatId = 0

interface Projectile {
    id: number
    glyph: string
    path: string
    duration: number
    launched: boolean
}
const projectiles = ref<Projectile[]>([])

/** Expanding rings at the point of impact; 'super' is louder, 'ko' is red. */
const impacts = ref<{ id: number, key: string, kind: 'hit' | 'super' | 'ko' }[]>([])
const splash = ref<string | null>(null)
const arenaShaking = ref(false)

const replay = computed(() => simulateBattle(props.myBoard, props.opponentBoard, props.seed, props.stadium?.effect ?? null))

function unitByKey(key: string): ViewUnit | undefined {
    return mine.value.find(unit => unit.key === key) ?? theirs.value.find(unit => unit.key === key)
}

function thumbProps(render: RenderedUnit['render']) {
    if (render.bundle) return { bundle: render.bundle }
    const legacySet = render.plaatjesCardId ? legacySetOf(render.plaatjesCardId) : null
    return legacySet && render.assetNumber ? { legacySet, assetNumber: render.assetNumber } : null
}

/** The printed matchup, for the impact caption — weakness beats resistance. */
function effectivenessOf(attackerType: string | null, target: ViewUnit): 'super' | 'resist' | null {
    if (!attackerType) return null
    if (!target.noWeakness && target.spec.weaknesses.some(entry => entry.type === attackerType)) return 'super'
    if (target.spec.resistances.some(entry => entry.type === attackerType)) return 'resist'
    return null
}

// ── Geometry for the projectile flight path ────────────────────────────────
const arenaEl = ref<HTMLElement | null>(null)
const unitEls = new Map<string, HTMLElement>()
function setUnitEl(key: string, el: unknown) {
    if (el instanceof HTMLElement) unitEls.set(key, el)
    else unitEls.delete(key)
}
function centerOf(key: string): { x: number, y: number } | null {
    const el = unitEls.get(key)
    const arena = arenaEl.value
    if (!el || !arena) return null
    const rect = el.getBoundingClientRect()
    const frame = arena.getBoundingClientRect()
    return { x: rect.left + rect.width / 2 - frame.left, y: rect.top + rect.height / 2 - frame.top }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms / speed.value))
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve))

let cancelled = false

async function playAttack(attack: Extract<BattleEvent, { kind: 'attack' }>) {
    const from = unitByKey(attack.from)
    const to = unitByKey(attack.to)
    if (!from || !to) return
    from.flash = 'attack'
    await sleep(140)

    // The elemental payload arcs from attacker to target.
    const start = centerOf(attack.from)
    const end = centerOf(attack.to)
    if (start && end) {
        const duration = 380 / speed.value
        const distance = Math.hypot(end.x - start.x, end.y - start.y)
        const lift = 26 + distance * 0.18
        const midX = (start.x + end.x) / 2
        const midY = Math.min(start.y, end.y) - lift
        const shot: Projectile = {
            id: ++floatId,
            glyph: typeInfo(from.type).glyph,
            path: `path('M ${start.x} ${start.y} Q ${midX} ${midY} ${end.x} ${end.y}')`,
            duration,
            launched: false
        }
        projectiles.value.push(shot)
        await nextTick()
        await nextFrame()
        const live = projectiles.value.find(entry => entry.id === shot.id)
        if (live) live.launched = true
        await sleep(380)
        projectiles.value = projectiles.value.filter(entry => entry.id !== shot.id)
    }

    from.flash = null
    from.charge = 0
    to.hp = Math.max(0, to.hp - attack.amount)
    // The engine retargets past fallen units, so a dead card is never hit —
    // faint it visually the moment its HP empties.
    if (to.hp === 0) to.fainted = true
    to.flash = 'hit'
    const note = effectivenessOf(from.type, to)
    impacts.value.push({ id: ++floatId, key: to.key, kind: note === 'super' ? 'super' : 'hit' })
    damageFloats.value.push({ id: ++floatId, key: to.key, amount: attack.amount, note })
    await sleep(300)
    to.flash = null
}

async function play() {
    mine.value = props.myBoard.map(toView)
    theirs.value = props.opponentBoard.map(toView)
    const byRound = new Map<number, BattleEvent[]>()
    for (const event of replay.value.events) {
        const list = byRound.get(event.round) ?? []
        list.push(event)
        byRound.set(event.round, list)
    }
    splash.value = 'Fight!'
    await sleep(650)
    splash.value = null
    for (let r = 1; r <= replay.value.rounds && !cancelled; r++) {
        round.value = r
        for (const unit of [...mine.value, ...theirs.value]) {
            if (!unit.fainted) unit.charge = Math.min(unit.chargeMax, unit.charge + 1)
        }
        await sleep(300)
        const roundEvents = byRound.get(r) ?? []
        // Attacks resolve simultaneously in the sim; playing them one by one
        // is what makes the fight readable. But an attacker that dies this
        // round declared before dying — let it fire first (trades launch
        // together) so a card never attacks after its HP shows empty.
        const attacks = roundEvents.filter(event => event.kind === 'attack')
        const faintingKeys = new Set(roundEvents.filter(event => event.kind === 'faint').map(event => event.unit))
        const trades = attacks.filter(attack => faintingKeys.has(attack.from))
        if (trades.length > 0 && !cancelled) await Promise.all(trades.map(attack => playAttack(attack)))
        for (const attack of attacks.filter(entry => !faintingKeys.has(entry.from))) {
            if (cancelled) break
            await playAttack(attack)
        }
        damageFloats.value = []
        impacts.value = []
        const faints = roundEvents.filter(event => event.kind === 'faint')
        for (const faint of faints) {
            const unit = unitByKey(faint.unit)
            if (unit) unit.fainted = true
            impacts.value.push({ id: ++floatId, key: faint.unit, kind: 'ko' })
        }
        if (faints.length > 0 && !cancelled) {
            arenaShaking.value = true
            void sleep(400).then(() => { arenaShaking.value = false })
        }
        for (const prize of roundEvents.filter(event => event.kind === 'prize')) {
            prizeFloats.value.push({ id: ++floatId, key: prize.unit })
        }
        if (roundEvents.some(event => event.kind !== 'attack')) await sleep(420)
        prizeFloats.value = []
    }
    finished.value = true
}

function skip() {
    cancelled = true
    finished.value = true
}

onMounted(() => {
    void play()
})
onUnmounted(() => {
    cancelled = true
})
</script>

<template>
    <div class="flex flex-col gap-4">
        <div class="flex items-center justify-between">
            <span class="text-xs uppercase tracking-wider text-muted">Round {{ round }}</span>
            <div class="flex items-center gap-1.5">
                <UButton
                    v-for="option in [1, 2, 4]"
                    :key="option"
                    size="xs"
                    :color="speed === option ? 'primary' : 'neutral'"
                    :variant="speed === option ? 'solid' : 'ghost'"
                    :label="`${option}×`"
                    @click="speed = option"
                />
                <UButton
                    v-if="!finished"
                    size="xs"
                    color="neutral"
                    variant="subtle"
                    label="Skip"
                    @click="skip"
                />
            </div>
        </div>

        <p
            v-if="stadium"
            class="rounded-lg bg-elevated px-3 py-1.5 text-center text-xs text-muted"
        >
            🏟️ <b class="text-highlighted">{{ stadium.name }}</b> is in play ({{ stadium.source === 'mine' ? 'yours' : 'theirs' }}) — it affects both teams.
        </p>

        <!-- The arena: you on the left, them on the right, actives center. -->
        <div
            ref="arenaEl"
            class="relative rounded-xl bg-elevated/40 p-4"
            :class="arenaShaking && 'bt-arena-shake'"
            :style="{ '--spd': 1 / speed }"
        >
            <div
                v-if="splash"
                class="bt-splash pointer-events-none absolute inset-0 z-30 grid place-items-center text-5xl font-black uppercase tracking-widest text-highlighted"
            >
                {{ splash }}
            </div>
            <div class="flex flex-col gap-2">
                <div class="w-full min-w-0 sm:w-[72%]">
                    <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">You</p>
                    <div class="grid grid-cols-6 gap-1.5">
                        <div
                            v-for="unit in mineOrdered"
                            :key="unit.key"
                            :ref="el => setUnitEl(unit.key, el)"
                            class="relative min-w-0 transition-all duration-300"
                            :class="[
                                unit.fainted && 'bt-faint',
                                unit.flash === 'hit' && 'bt-shake',
                                unit.flash === 'attack' && 'translate-x-1.5 translate-y-1.5'
                            ]"
                        >
                            <div
                                class="relative overflow-hidden rounded"
                                :class="[
                                    unit.flash === 'hit' && 'ring-2 ring-error',
                                    unit.charge >= unit.chargeMax && !unit.fainted && 'bt-ready'
                                ]"
                            >
                                <template v-if="thumbProps(unit.render)">
                                    <TcgCardThumb v-bind="thumbProps(unit.render)!" />
                                </template>
                                <div
                                    v-else
                                    class="flex aspect-[0.718] w-full items-center justify-center rounded bg-elevated text-[9px] text-muted"
                                >
                                    {{ unit.name }}
                                </div>
                                <span
                                    v-for="impact in impacts.filter(entry => entry.key === unit.key)"
                                    :key="impact.id"
                                    class="bt-burst pointer-events-none absolute inset-0 z-10 m-auto"
                                    :class="impact.kind === 'super' ? 'bt-burst-super' : impact.kind === 'ko' ? 'bt-burst-ko' : ''"
                                />
                            </div>
                            <UBadge
                                v-if="unit.level > 1"
                                color="secondary"
                                size="sm"
                                class="absolute -left-1.5 -top-1.5 z-10"
                            >
                                L{{ unit.level }}
                            </UBadge>
                            <UTooltip
                                v-if="unit.items.length > 0"
                                :text="unit.items.map(item => item.name).join(', ')"
                            >
                                <span class="absolute -right-1 bottom-9 z-10 text-sm drop-shadow">🔧</span>
                            </UTooltip>
                            <template
                                v-for="float in damageFloats.filter(entry => entry.key === unit.key)"
                                :key="float.id"
                            >
                                <span class="battler-float pointer-events-none absolute inset-x-0 -top-6 z-20 text-center text-base font-bold text-error drop-shadow">
                                    −{{ float.amount }}
                                </span>
                                <span
                                    v-if="float.note"
                                    class="battler-float pointer-events-none absolute inset-x-0 -top-10 z-20 whitespace-nowrap text-center text-[10px] font-bold uppercase drop-shadow"
                                    :class="float.note === 'super' ? 'text-warning' : 'text-info'"
                                >
                                    {{ float.note === 'super' ? 'Very effective!' : 'Resisted' }}
                                </span>
                            </template>
                            <span
                                v-for="float in prizeFloats.filter(entry => entry.key === unit.key)"
                                :key="float.id"
                                class="battler-float pointer-events-none absolute inset-x-0 -top-6 z-20 text-center text-[10px] font-bold text-warning drop-shadow"
                            >
                                +1 ATK
                            </span>
                            <div class="mt-1 h-1.5 overflow-hidden rounded bg-elevated">
                                <div
                                    class="h-full rounded bg-success transition-all duration-300"
                                    :class="unit.hp / unit.maxHp < 0.35 && 'bg-error'"
                                    :style="{ width: `${(unit.hp / unit.maxHp) * 100}%` }"
                                />
                            </div>
                            <div class="mt-1 flex justify-center gap-0.5">
                                <span
                                    v-for="pip in unit.chargeMax"
                                    :key="pip"
                                    class="size-1.5 rounded-full"
                                    :class="pip <= unit.charge ? 'bg-warning' : 'bg-elevated'"
                                />
                            </div>
                            <p
                                class="mt-1 flex items-center justify-center gap-1 truncate rounded px-1 py-0.5 text-center text-[10px]"
                                :class="typeInfo(unit.type).chip"
                            >
                                <span>{{ typeInfo(unit.type).glyph }}</span>
                                <span class="truncate">{{ unit.attackName }}</span>
                                <b class="tabular-nums">{{ unit.attackDamage }}</b>
                            </p>
                        </div>
                    </div>
                </div>

                <div class="self-center text-sm font-black uppercase tracking-widest text-dimmed">vs</div>

                <div class="ml-auto w-full min-w-0 sm:w-[72%]">
                    <p class="mb-2 text-right text-xs font-semibold uppercase tracking-wider text-error">{{ opponentName }}</p>
                    <div class="grid grid-cols-6 gap-1.5">
                        <div
                            v-for="(unit, index) in theirs"
                            :key="unit.key"
                            :ref="el => setUnitEl(unit.key, el)"
                            class="relative min-w-0 transition-all duration-300"
                            :style="index === 0 ? { gridColumnStart: 7 - theirs.length } : undefined"
                            :class="[
                                unit.fainted && 'bt-faint',
                                unit.flash === 'hit' && 'bt-shake',
                                unit.flash === 'attack' && '-translate-x-1.5 -translate-y-1.5'
                            ]"
                        >
                            <div
                                class="relative overflow-hidden rounded"
                                :class="[
                                    unit.flash === 'hit' && 'ring-2 ring-error',
                                    unit.charge >= unit.chargeMax && !unit.fainted && 'bt-ready'
                                ]"
                            >
                                <template v-if="thumbProps(unit.render)">
                                    <TcgCardThumb v-bind="thumbProps(unit.render)!" />
                                </template>
                                <div
                                    v-else
                                    class="flex aspect-[0.718] w-full items-center justify-center rounded bg-elevated text-[9px] text-muted"
                                >
                                    {{ unit.name }}
                                </div>
                                <span
                                    v-for="impact in impacts.filter(entry => entry.key === unit.key)"
                                    :key="impact.id"
                                    class="bt-burst pointer-events-none absolute inset-0 z-10 m-auto"
                                    :class="impact.kind === 'super' ? 'bt-burst-super' : impact.kind === 'ko' ? 'bt-burst-ko' : ''"
                                />
                            </div>
                            <UBadge
                                v-if="unit.level > 1"
                                color="secondary"
                                size="sm"
                                class="absolute -left-1.5 -top-1.5 z-10"
                            >
                                L{{ unit.level }}
                            </UBadge>
                            <UTooltip
                                v-if="unit.items.length > 0"
                                :text="unit.items.map(item => item.name).join(', ')"
                            >
                                <span class="absolute -right-1 bottom-9 z-10 text-sm drop-shadow">🔧</span>
                            </UTooltip>
                            <template
                                v-for="float in damageFloats.filter(entry => entry.key === unit.key)"
                                :key="float.id"
                            >
                                <span class="battler-float pointer-events-none absolute inset-x-0 -top-6 z-20 text-center text-base font-bold text-error drop-shadow">
                                    −{{ float.amount }}
                                </span>
                                <span
                                    v-if="float.note"
                                    class="battler-float pointer-events-none absolute inset-x-0 -top-10 z-20 whitespace-nowrap text-center text-[10px] font-bold uppercase drop-shadow"
                                    :class="float.note === 'super' ? 'text-warning' : 'text-info'"
                                >
                                    {{ float.note === 'super' ? 'Very effective!' : 'Resisted' }}
                                </span>
                            </template>
                            <span
                                v-for="float in prizeFloats.filter(entry => entry.key === unit.key)"
                                :key="float.id"
                                class="battler-float pointer-events-none absolute inset-x-0 -top-6 z-20 text-center text-[10px] font-bold text-warning drop-shadow"
                            >
                                +1 ATK
                            </span>
                            <div class="mt-1 h-1.5 overflow-hidden rounded bg-elevated">
                                <div
                                    class="h-full rounded bg-success transition-all duration-300"
                                    :class="unit.hp / unit.maxHp < 0.35 && 'bg-error'"
                                    :style="{ width: `${(unit.hp / unit.maxHp) * 100}%` }"
                                />
                            </div>
                            <div class="mt-1 flex justify-center gap-0.5">
                                <span
                                    v-for="pip in unit.chargeMax"
                                    :key="pip"
                                    class="size-1.5 rounded-full"
                                    :class="pip <= unit.charge ? 'bg-warning' : 'bg-elevated'"
                                />
                            </div>
                            <p
                                class="mt-1 flex items-center justify-center gap-1 truncate rounded px-1 py-0.5 text-center text-[10px]"
                                :class="typeInfo(unit.type).chip"
                            >
                                <span>{{ typeInfo(unit.type).glyph }}</span>
                                <span class="truncate">{{ unit.attackName }}</span>
                                <b class="tabular-nums">{{ unit.attackDamage }}</b>
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Projectiles arcing along their flight path. -->
            <div
                v-for="shot in projectiles"
                :key="shot.id"
                class="bt-shot pointer-events-none absolute left-0 top-0 z-20 text-3xl"
                :style="{
                    offsetPath: shot.path,
                    offsetRotate: '0deg',
                    offsetDistance: shot.launched ? '100%' : '0%',
                    transition: shot.launched ? `offset-distance ${shot.duration}ms cubic-bezier(.35,.1,.65,1)` : 'none'
                }"
            >
                <span class="bt-tumble inline-block">{{ shot.glyph }}</span>
            </div>
        </div>

        <div
            v-if="finished"
            class="flex items-center justify-between rounded-lg bg-elevated px-4 py-3"
        >
            <p
                class="text-sm font-semibold"
                :class="result === 'win' ? 'text-success' : result === 'loss' ? 'text-error' : 'text-muted'"
            >
                {{ result === 'win' ? 'Victory!' : result === 'loss' ? 'Defeat' : 'Draw' }}
            </p>
            <UButton
                label="Continue"
                @click="emit('done')"
            />
        </div>
    </div>
</template>

<style scoped>
@keyframes battler-float-rise {
    from {
        opacity: 0;
        transform: translateY(8px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}
.battler-float {
    animation: battler-float-rise calc(var(--spd, 1) * 0.25s) ease-out;
}

/* Impact rings, clipped to the card. */
.bt-burst {
    width: 30%;
    aspect-ratio: 1;
    border-radius: 9999px;
    border: 3px solid rgb(255 255 255 / 0.9);
    animation: bt-burst calc(var(--spd, 1) * 0.45s) ease-out forwards;
}
.bt-burst-super {
    border-width: 4px;
    border-color: rgb(245 158 11 / 0.95);
}
.bt-burst-ko {
    border-color: rgb(239 68 68 / 0.95);
}
@keyframes bt-burst {
    from {
        opacity: 0.95;
        transform: scale(0.3);
    }
    to {
        opacity: 0;
        transform: scale(4);
    }
}

/* Getting hit rattles the card. */
.bt-shake {
    animation: bt-shake calc(var(--spd, 1) * 0.3s) ease-in-out;
}
@keyframes bt-shake {
    0%, 100% { transform: none; }
    25% { transform: translateX(-4px) rotate(-1.5deg); }
    50% { transform: translateX(4px) rotate(1.5deg); }
    75% { transform: translateX(-2px); }
}

/* Faints fall over instead of just dimming. */
.bt-faint {
    animation: bt-faint calc(var(--spd, 1) * 0.5s) ease-in forwards;
}
@keyframes bt-faint {
    to {
        transform: translateY(10px) rotate(8deg) scale(0.88);
        opacity: 0.22;
        filter: grayscale(1);
    }
}

/* Fully charged units telegraph the next volley. */
.bt-ready {
    animation: bt-ready calc(var(--spd, 1) * 1.1s) ease-in-out infinite;
}
@keyframes bt-ready {
    0%, 100% { box-shadow: 0 0 0 2px rgb(245 158 11 / 0.85), 0 0 14px rgb(245 158 11 / 0.35); }
    50% { box-shadow: 0 0 0 2px rgb(245 158 11 / 0.35), 0 0 4px rgb(245 158 11 / 0.1); }
}

/* Projectiles glow and tumble as they arc. */
.bt-shot {
    filter: drop-shadow(0 0 6px rgb(255 255 255 / 0.35));
}
.bt-tumble {
    animation: bt-tumble calc(var(--spd, 1) * 0.5s) ease-in-out infinite alternate;
}
@keyframes bt-tumble {
    from { transform: rotate(-16deg) scale(0.95); }
    to { transform: rotate(16deg) scale(1.15); }
}

/* KOs rattle the whole arena. */
.bt-arena-shake {
    animation: bt-arena calc(var(--spd, 1) * 0.35s) ease-in-out;
}
@keyframes bt-arena {
    25% { transform: translate(3px, -2px); }
    50% { transform: translate(-3px, 2px); }
    75% { transform: translate(2px, 0); }
}

/* Opening splash. */
.bt-splash {
    animation: bt-splash calc(var(--spd, 1) * 0.65s) cubic-bezier(.2,.9,.3,1) forwards;
    text-shadow: 0 2px 24px rgb(0 0 0 / 0.4);
}
@keyframes bt-splash {
    0% { opacity: 0; transform: scale(2.4); }
    35% { opacity: 1; transform: scale(1); }
    80% { opacity: 1; }
    100% { opacity: 0; transform: scale(0.96); }
}
</style>
