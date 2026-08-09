<script setup lang="ts">
/**
 * The battle viewer (§12.5): the client re-runs the exact shared simulation
 * from the fight's inputs and animates the event list — two facing rows,
 * HP bars, charge pips, hit flashes. Deterministic, so what you watch is
 * exactly what the server scored.
 */
import { simulateBattle } from '#shared/utils/battler/combat'
import type { BattleUnit, BattleEvent } from '#shared/utils/battler/combat'
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
}>()
const emit = defineEmits<{ done: [] }>()

interface ViewUnit {
    key: string
    name: string
    render: RenderedUnit['render']
    maxHp: number
    hp: number
    charge: number
    chargeMax: number
    level: number
    bounty: number
    fainted: boolean
    flash: 'hit' | 'attack' | null
}

function toView(unit: RenderedUnit): ViewUnit {
    const level = levelFor(unit.instances)
    const multiplier = BATTLER.levelMultiplier[level] ?? 1
    const attack = unit.spec.attacks.find(entry => entry.attackId === unit.attackId) ?? unit.spec.attacks[0]!
    const hp = Math.max(1, Math.round(unit.spec.hp * multiplier))
    return {
        key: unit.key,
        name: unit.spec.name,
        render: unit.render,
        maxHp: hp,
        hp,
        charge: 0,
        chargeMax: attack.charge,
        level,
        bounty: unit.spec.bounty,
        fainted: false,
        flash: null
    }
}

const mine = ref<ViewUnit[]>([])
const theirs = ref<ViewUnit[]>([])
const round = ref(0)
const speed = ref(1)
const finished = ref(false)
const damageFloats = ref<{ id: number, key: string, amount: number }[]>([])
let floatId = 0

const replay = computed(() => simulateBattle(props.myBoard, props.opponentBoard, props.seed))

function unitByKey(key: string): ViewUnit | undefined {
    return mine.value.find(unit => unit.key === key) ?? theirs.value.find(unit => unit.key === key)
}

function thumbProps(render: RenderedUnit['render']) {
    if (render.bundle) return { bundle: render.bundle }
    const legacySet = render.plaatjesCardId ? legacySetOf(render.plaatjesCardId) : null
    return legacySet && render.assetNumber ? { legacySet, assetNumber: render.assetNumber } : null
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms / speed.value))

let cancelled = false
async function play() {
    mine.value = props.myBoard.map(toView)
    theirs.value = props.opponentBoard.map(toView)
    const events = replay.value.events
    const byRound = new Map<number, BattleEvent[]>()
    for (const event of events) {
        const list = byRound.get(event.round) ?? []
        list.push(event)
        byRound.set(event.round, list)
    }
    for (let r = 1; r <= replay.value.rounds && !cancelled; r++) {
        round.value = r
        // Charge tick.
        for (const unit of [...mine.value, ...theirs.value]) {
            if (!unit.fainted) unit.charge = Math.min(unit.chargeMax, unit.charge + 1)
        }
        await sleep(320)
        const roundEvents = byRound.get(r) ?? []
        const attacks = roundEvents.filter(event => event.kind === 'attack')
        for (const attack of attacks) {
            const from = unitByKey(attack.from)
            if (from) from.flash = 'attack'
        }
        await sleep(220)
        for (const attack of attacks) {
            const from = unitByKey(attack.from)
            const to = unitByKey(attack.to)
            if (from) {
                from.flash = null
                from.charge = 0
            }
            if (to) {
                to.hp = Math.max(0, to.hp - attack.amount)
                to.flash = 'hit'
                damageFloats.value.push({ id: ++floatId, key: to.key, amount: attack.amount })
            }
        }
        await sleep(360)
        for (const unit of [...mine.value, ...theirs.value]) unit.flash = null
        damageFloats.value = []
        for (const faint of roundEvents.filter(event => event.kind === 'faint')) {
            const unit = unitByKey(faint.unit)
            if (unit) unit.fainted = true
        }
        if (roundEvents.some(event => event.kind === 'faint')) await sleep(320)
    }
    finished.value = true
}

function skip() {
    cancelled = true
    // Jump every unit to its end state.
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

        <div
            v-for="(side, sideIndex) in [{ label: opponentName, units: theirs }, { label: 'You', units: mine }]"
            :key="sideIndex"
            class="rounded-xl p-3"
            :class="sideIndex === 0 ? 'bg-error/5' : 'bg-primary/5'"
        >
            <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{{ side.label }}</p>
            <div class="flex gap-2">
                <div
                    v-for="unit in side.units"
                    :key="unit.key"
                    class="relative w-20 transition-all duration-300"
                    :class="[
                        unit.fainted && 'scale-90 opacity-25 grayscale',
                        unit.flash === 'hit' && 'translate-y-0.5',
                        unit.flash === 'attack' && (sideIndex === 0 ? 'translate-y-1.5' : '-translate-y-1.5')
                    ]"
                >
                    <div
                        class="relative overflow-hidden rounded"
                        :class="unit.flash === 'hit' && 'ring-2 ring-error'"
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
                            v-for="float in damageFloats.filter(entry => entry.key === unit.key)"
                            :key="float.id"
                            class="absolute inset-x-0 top-1 text-center text-sm font-bold text-error drop-shadow"
                        >
                            −{{ float.amount }}
                        </span>
                    </div>
                    <UBadge
                        v-if="unit.level > 1"
                        color="secondary"
                        size="sm"
                        class="absolute -left-1.5 -top-1.5"
                    >
                        L{{ unit.level }}
                    </UBadge>
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
                </div>
            </div>
        </div>

        <div
            v-if="finished"
            class="flex items-center justify-between rounded-lg bg-elevated px-4 py-3"
        >
            <p class="text-sm font-semibold"
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
