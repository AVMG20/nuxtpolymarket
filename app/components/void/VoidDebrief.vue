<template>
    <div class="vx-screen">
        <div class="vx-panel vx-debrief" :class="summary.extracted ? 'vx-good' : 'vx-bad'">
            <div class="vx-kicker">{{ summary.extracted ? 'Extraction complete' : 'Signal lost' }}</div>
            <div class="vx-title">{{ title }}</div>
            <div v-if="summary.sectorCleared" class="vx-cleared">
                <UIcon name="i-lucide-trophy" />
                <b>Sector cleared</b>
                <span>{{ summary.sectorCleared }}<template v-if="summary.sectorOpened"> · {{ summary.sectorOpened }} unlocked</template></span>
            </div>
            <div class="vx-stats">
                <div class="vx-stat"><span>Time</span><b>{{ clock(summary.elapsedMs / 1000) }}</b></div>
                <div class="vx-stat"><span>Kills</span><b>{{ Math.round(kills) }}</b></div>
                <div class="vx-stat"><span>Units</span><b>{{ Math.round(units) }}</b></div>
                <div class="vx-stat"><span>Value</span><b>{{ formatNumber(Math.round(value)) }}</b></div>
            </div>
            <div v-if="summary.items.length" class="vx-haul">
                <div v-for="(item, i) in summary.items" :key="item.id" class="vx-haul-item" :style="{ '--c': item.hex, '--i': i }">
                    <i class="vr-gem" />
                    <span>{{ item.name }}</span>
                    <b>{{ item.amount }}</b>
                </div>
            </div>
            <div v-else-if="summary.extracted" class="vx-note">Nothing in the hold this time.</div>
            <div v-else-if="summary.lostValue > 0" class="vx-note vx-note-bad">Lost with the ship: <b>{{ formatNumber(summary.lostValue) }}</b></div>
            <div v-else class="vx-note">The hold was empty. Nothing lost but the pride.</div>
            <div v-if="summary.xp > 0" class="vx-xp" :class="{ 'vx-xp-up': levelShown > summary.levelBefore }">
                <div class="vx-xp-level"><span>{{ levelShown }}</span></div>
                <div class="vx-xp-bar"><div :style="{ width: `${xpFill * 100}%` }" /></div>
                <div class="vx-xp-gain">+{{ formatNumber(summary.xp, false) }} XP</div>
                <div v-if="levelShown > summary.levelBefore" class="vx-xp-note">Pilot level up</div>
            </div>
            <div v-if="summary.depth > 1 || summary.marks || summary.blueprint || summary.lore.length || summary.beacons" class="vx-loot vx-loot-trophy">
                <span v-if="summary.depth > 1">Jump {{ summary.depth }}</span>
                <b v-if="summary.beacons">{{ summary.beacons }}</b>
                <b v-if="summary.marks">+{{ summary.marks }} Command Mark{{ summary.marks === 1 ? '' : 's' }}</b>
                <b v-if="summary.blueprint">Blueprint: {{ summary.blueprint }} MkII</b>
                <b v-for="l in summary.lore" :key="l">Log: {{ l }}</b>
            </div>
            <div v-if="summary.gear.length || summary.gearEmpty || summary.gearLost" class="vx-loot vx-loot-gear">
                <span>Salvaged gear</span>
                <b v-for="(g, i) in summary.gear" :key="i" :style="{ color: g.color }">{{ g.rarity }} T{{ g.tier }} {{ g.name }}</b>
                <em v-if="summary.gearEmpty">{{ summary.gearEmpty }} cache{{ summary.gearEmpty === 1 ? '' : 's' }} came back empty (run or daily limit)</em>
                <em v-if="summary.gearLost">{{ summary.gearLost }} cache{{ summary.gearLost === 1 ? '' : 's' }} lost with the ship</em>
            </div>
            <div v-if="summary.relics.length" class="vx-loot">
                <span>Relics</span>
                <b v-for="(r, i) in summary.relics" :key="i" :style="{ color: r.hex }">{{ r.name }}</b>
            </div>
            <div v-if="summary.wardenRejected" class="vx-note">The warden kill was not counted: the run was too short for the station to accept it.</div>
            <div v-if="summary.trimmed" class="vx-note">Part of the hold was over this run's limits and stayed behind.</div>
            <div v-if="summary.pending" class="vx-note vx-filing"><i />Filing report</div>
            <div v-if="summary.failed" class="vx-note vx-note-bad">The station did not get your report. The hold is kept on this device and filed before your next launch.</div>
            <div class="vx-row">
                <button class="vr-btn vr-btn-primary" :disabled="summary.pending" @click="emit('close')">Return to hangar</button>
                <button v-if="summary.failed" class="vr-btn" @click="emit('retry')">Try again</button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { voidPilotProgress } from '#shared/utils/gamelogic/void-skills'

export interface VoidRunSummary {
    extracted: boolean
    pending: boolean
    /** The server never confirmed the report; the hold waits on this device. */
    failed: boolean
    trimmed: boolean
    kills: number
    elapsedMs: number
    units: number
    value: number
    sectorCleared: string | null
    sectorOpened: string | null
    wardenRejected: boolean
    beacons: string | null
    lostValue: number
    xp: number
    levelBefore: number
    levelAfter: number
    relics: { name: string, hex: string }[]
    marks: number
    blueprint: string | null
    lore: string[]
    depth: number
    gear: { name: string, tier: number, color: string, rarity: string }[]
    gearEmpty: number
    gearLost: number
    items: { id: string, name: string, hex: string, amount: number }[]
}

const props = defineProps<{
    summary: VoidRunSummary
    /** Pilot XP before this run, so the bar can fill from where it stood. */
    xpBefore: number
}>()
const emit = defineEmits<{ close: [], retry: [] }>()

const title = computed(() => {
    const s = props.summary
    if (!s.extracted) return 'Ship destroyed'
    return s.failed ? 'Hold not banked yet' : s.pending ? 'Banking hold' : 'Hold banked'
})

/**
 * Eases a shown number toward its target. A timer snaps it home as well, so a
 * throttled background tab still ends on the right figure.
 */
function useCountUp(target: () => number, ms = 900) {
    const shown = ref(0)
    let frame = 0
    let snap: ReturnType<typeof setTimeout> | undefined
    watch(target, (to) => {
        const from = shown.value
        const start = performance.now()
        cancelAnimationFrame(frame)
        clearTimeout(snap)
        const tick = (now: number) => {
            const k = Math.min(1, (now - start) / ms)
            shown.value = from + (to - from) * (1 - Math.pow(1 - k, 3))
            if (k < 1) frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
        snap = setTimeout(() => {
            shown.value = to
        }, ms + 150)
    }, { immediate: true })
    onBeforeUnmount(() => {
        cancelAnimationFrame(frame)
        clearTimeout(snap)
    })
    return shown
}

const kills = useCountUp(() => props.summary.kills, 700)
const units = useCountUp(() => props.summary.units, 900)
const value = useCountUp(() => props.summary.value, 1300)
// The XP bar runs on total XP, so a level-up is just the fill wrapping past the end of the bar.
const xpGain = useCountUp(() => props.summary.xp, 1600)
const xpView = computed(() => voidPilotProgress(props.xpBefore + Math.round(xpGain.value)))
const levelShown = computed(() => (props.summary.xp > 0 ? Math.min(props.summary.levelAfter, Math.max(props.summary.levelBefore, xpView.value.level)) : props.summary.levelBefore))
const xpFill = computed(() => xpView.value.progress)

function clock(seconds: number) {
    const s = Math.max(0, Math.floor(seconds))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
</script>
