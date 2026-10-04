<script setup lang="ts">
import TownAsset from '~/components/town/TownAsset.vue'
import TownBoostIcon from '~/components/town/TownBoostIcon.vue'
import TownChestArt from '~/components/town/TownChestArt.vue'
import TownCoin from '~/components/town/TownCoin.vue'
import type { TownStreakClaimResult, TownStreakPreview, TownStreakResetResult, TownStreakReward } from '~/composables/useTownStreak'
import { getTownResource } from '#shared/utils/gamelogic/town'
import { townBoostLabel, type TownBoostKind } from '#shared/utils/gamelogic/town-boosts'
import { TOWN_STREAK_DAYS, type TownStreakChest } from '#shared/utils/gamelogic/town-streak'

const emit = defineEmits<{
    claimed: [res: TownStreakClaimResult]
    reset: [res: TownStreakResetResult]
}>()

const sound = useTownSound()
const {
    streak,
    pending,
    step,
    status,
    track,
    claimedSteps,
    claimableSteps,
    claimableCount,
    canReset,
    nextDayAt,
    lucky,
    serverNow,
    claiming,
    resetting,
    claim,
    reset,
    applyWallet
} = useTownStreak()

// ─── Clock ───────────────────────────────────────────────────────────────────

const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | null = null
// The town's own motion switch, which starts from the OS setting.
const { reduced: reducedMotion } = useTownMotion()
onMounted(() => {
    now.value = serverNow()
    clock = setInterval(() => { now.value = serverNow() }, 1_000)
})
const countdown = computed(() => nextDayAt.value ? formatTownDuration(nextDayAt.value - now.value) : '…')

// ─── Tiles ───────────────────────────────────────────────────────────────────

type TileState = 'locked' | 'claimable' | 'claimed'

function stateOf(s: number): TileState {
    if (claimedSteps.value.has(s)) return 'claimed'
    if (claimableSteps.value.has(s) || s <= step.value) return 'claimable'
    return 'locked'
}

const isToday = (s: number) => status.value === 'active' && s === step.value
const isNext = (s: number) => status.value === 'active' && s === step.value + 1

function dayLabel(s: number) {
    if (isToday(s)) return 'Today'
    if (isNext(s)) return 'Tomorrow'
    return `Day ${s}`
}

function goodsOf(p: TownStreakPreview): string[] {
    return Object.keys(p.resources ?? {})
}

function goodName(id: string) {
    return getTownResource(id)?.name ?? id
}

function hoursText(p: TownStreakPreview) {
    if (!p.hours) return ''
    const [a, b] = p.hours
    return a === b ? `${a}h` : `${a}–${b}h`
}

function tileAmount(p: TownStreakPreview) {
    // Future steps follow the town as it grows, so their amounts are estimates.
    const about = p.fixed ? '' : '≈'
    switch (p.kind) {
        case 'coins': return `${about}${formatNumber(p.coins?.[0] ?? 0)}`
        case 'gems': return `×${p.gems?.[0] ?? 0}`
        case 'resources': {
            const good = fixedGood(p)
            return good ? formatNumber(good.qty) : `${hoursText(p)} output`
        }
        case 'chest': return p.label
        case 'boost': return p.label
    }
}

/** "1h", "2h 30m". */
function boostDuration(p: TownStreakPreview) {
    const mins = Math.round((p.boostMs ?? 0) / 60_000)
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`
}

/** The one good a supplies day pays, once its amount is locked in. */
function fixedGood(p: TownStreakPreview): { id: string, qty: number } | null {
    if (!p.fixed || p.kind !== 'resources') return null
    const entries = Object.entries(p.resources ?? {})
    if (entries.length !== 1) return null
    const [id, [qty]] = entries[0]!
    return { id, qty }
}

// ─── Status ──────────────────────────────────────────────────────────────────

const statusTag = computed(() => {
    switch (status.value) {
        case 'broken': return { cls: 'g-tag-red', icon: 'i-lucide-heart-crack', text: 'Streak broken' }
        case 'finished': return { cls: 'g-tag-gold', icon: 'i-lucide-crown', text: 'Track complete' }
        default: return { cls: 'g-tag-green', icon: 'i-lucide-flame', text: 'On a roll' }
    }
})

const progressPct = computed(() => Math.min(100, (step.value / TOWN_STREAK_DAYS) * 100))

// ─── Detail strip ────────────────────────────────────────────────────────────

/** The tile the detail strip describes: the one last touched, else the first claimable, else today. */
const inspected = ref<number | null>(null)
const focusStep = computed(() => inspected.value
    ?? streak.value?.claimableSteps[0]
    ?? Math.min(TOWN_STREAK_DAYS, Math.max(1, status.value === 'active' ? step.value + 1 : step.value)))
const focus = computed(() => track.value[focusStep.value - 1] ?? null)

// ─── Scrolling ───────────────────────────────────────────────────────────────

const scroller = ref<HTMLElement | null>(null)

function scrollToStep(s: number, smooth: boolean) {
    const box = scroller.value
    const el = box?.querySelector<HTMLElement>(`[data-step="${s}"]`)
    if (!box || !el) return
    const left = el.offsetLeft - box.clientWidth / 2 + el.offsetWidth / 2
    box.scrollTo({ left: Math.max(0, left), behavior: smooth && !reducedMotion.value ? 'smooth' : 'auto' })
}

let scrolledOnce = false
watch(() => track.value.length, async (n) => {
    if (!n || scrolledOnce) return
    scrolledOnce = true
    await nextTick()
    scrollToStep(Math.max(1, step.value), false)
}, { immediate: true })

/** A mouse wheel scrolls the track sideways; a trackpad already does. */
function onWheel(e: WheelEvent) {
    const box = scroller.value
    if (!box || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
    if (box.scrollWidth <= box.clientWidth) return
    e.preventDefault()
    box.scrollLeft += e.deltaY
}

// ─── New day ─────────────────────────────────────────────────────────────────

/** The day whose unlock has been celebrated, shared so a remount does not replay it. */
const announced = useState<string | null>('town-streak-announced', () => null)
const freshStep = ref<number | null>(null)
watch(streak, (s) => {
    if (!s?.advancedToday || announced.value === s.day || import.meta.server) return
    announced.value = s.day
    freshStep.value = s.step
    sound.play('streak')
    setTimeout(() => { if (freshStep.value === s.step) freshStep.value = null }, 2_400)
}, { immediate: true })

// ─── Claiming ────────────────────────────────────────────────────────────────

const fx = useTownFx()

/** Timers that must not outlive the panel. */
const timers = new Set<ReturnType<typeof setTimeout>>()
function later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
        timers.delete(t)
        fn()
    }, ms)
    timers.add(t)
}

/** The tile that was just claimed: it squashes, rings and gets its tick stamped on. */
const popped = ref<number | null>(null)
function popTile(s: number) {
    popped.value = null
    void nextTick(() => {
        popped.value = s
        later(1_000, () => { if (popped.value === s) popped.value = null })
    })
}

/**
 * A chest's or reset's wallet waits until the player collects it in the
 * chest opening, so the balance ticks up as the coins land.
 */
const opening = useTownChestOpening()

const TIER_RANK: Record<TownStreakChest, number> = { wooden: 0, silver: 1, golden: 2 }

async function openChest(p: TownStreakPreview) {
    const chest = p.chest ?? 'wooden'
    // The show starts at once and rattles until the server has paid.
    const show = opening.start({ mode: 'chest', chest, step: p.step, days: 1, chests: 1 })
    const res = await claim(p.step, { deferWallet: true })
    if (!res) {
        show.cancel()
        sound.play('error')
        return
    }
    const r = res.reward
    show.resolve({
        coins: r.coins,
        gems: r.gems,
        resources: r.resources as Record<string, number>,
        extras: r.extras ?? [],
        chest: r.chest ?? chest,
        upgradedFrom: r.upgradedFrom
    }, () => {
        applyWallet(res)
        emit('claimed', res)
        popTile(p.step)
    })
}

async function onTile(p: TownStreakPreview, ev: MouseEvent) {
    inspected.value = p.step
    if (stateOf(p.step) !== 'claimable' || claiming.value !== null || resetting.value || opening.current.value) return
    if (p.kind === 'chest') return openChest(p)
    const tile = ev.currentTarget as Element | null
    const res = await claim(p.step)
    if (!res) {
        sound.play('error')
        return
    }
    sound.play(p.kind === 'boost' ? 'rush' : p.step >= 25 ? 'bigcoin' : res.reward.gems > 0 ? 'gem' : 'reward')
    popTile(p.step)
    fx.reward(tile, {
        coins: res.reward.coins,
        gems: res.reward.gems,
        resources: res.reward.resources as Record<string, number>
    }, { scale: p.milestone ? 1.6 : 1, big: p.milestone })
    if (p.kind === 'boost' && p.boost) fx.float(tile, [{ text: `${townBoostLabel(p.boost)} on`, tone: 'green' }])
    emit('claimed', res)
}

// ─── Reset ───────────────────────────────────────────────────────────────────

const confirming = ref(false)

async function onReset() {
    const res = await reset({ deferWallet: true })
    confirming.value = false
    if (!res) {
        sound.play('error')
        return
    }
    sound.play('reset')
    inspected.value = null
    const pay = () => {
        applyWallet(res)
        emit('reset', res)
    }
    await nextTick()
    scrollToStep(1, true)
    if (!res.paid.length) return pay()
    // Collecting the track opens its chests: the show plays the best one, with everything collected as its cards.
    const chests = res.paid.filter(r => r.chest)
    const best = chests.reduce<TownStreakReward | null>((b, r) => !b || TIER_RANK[r.chest!] > TIER_RANK[b.chest!] ? r : b, null)
    opening.start({
        mode: 'reset',
        chest: best?.upgradedFrom ?? best?.chest ?? null,
        step: 0,
        days: res.paid.length,
        chests: chests.length,
        loot: {
            coins: res.total.coins,
            gems: res.total.gems,
            resources: res.total.resources,
            // A boost day pays its boost outside the extras: deal it as a card too.
            extras: res.paid.flatMap(r => r.extras ?? (Object.entries(r.boosts ?? {}) as [TownBoostKind, number][]).map(([kind, ms]) => ({ kind, ms }))),
            chest: best?.chest ?? 'wooden',
            upgradedFrom: best?.upgradedFrom
        },
        onCollect: pay
    })
}

// Esc closes the reset prompt first, not the whole Daily window under it:
// caught on the way down, before the town's own key handler.
function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !confirming.value || opening.current.value) return
    e.stopImmediatePropagation()
    e.preventDefault()
    confirming.value = false
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))

onBeforeUnmount(() => {
    if (clock) clearInterval(clock)
    for (const t of timers) clearTimeout(t)
})
</script>

<template>
    <section class="sk" :class="{ 'is-calm': reducedMotion }">
        <div v-if="!streak && pending" class="sk-loading"><span class="g-spinner" /></div>

        <div v-else-if="!streak" class="sk-empty">
            <UIcon name="i-lucide-flame" />
            <p>Found your town to start the Mayor streak.</p>
        </div>

        <template v-else>
            <!-- Header strip -->
            <div class="sk-head">
                <div class="sk-day">
                    <span class="g-label"><UIcon name="i-lucide-flame" /> Mayor streak</span>
                    <b>Day {{ step }}<small> of {{ TOWN_STREAK_DAYS }}</small></b>
                </div>
                <div class="sk-tags">
                    <span class="g-tag" :class="statusTag.cls"><UIcon :name="statusTag.icon" /> {{ statusTag.text }}</span>
                    <span v-if="streak.cycle > 0" class="g-tag" data-tip="Runs you have reset so far">Run {{ streak.cycle + 1 }}</span>
                    <span v-if="claimableCount" class="g-tag g-tag-gold"><UIcon name="i-lucide-gift" /> {{ claimableCount }} to claim</span>
                    <span v-if="lucky > 0" class="g-tag sk-lucky">
                        <TownBoostIcon kind="lucky" :size="16" />
                        {{ lucky === 1 ? 'Next chest upgraded' : `Next ${lucky} chests upgraded` }}
                    </span>
                </div>
                <div class="sk-side">
                    <span v-if="status === 'active'" class="sk-timer" data-tip="Open Polytown on the next UTC day to unlock it">
                        <UIcon name="i-lucide-hourglass" /> Next day in <b>{{ countdown }}</b>
                    </span>
                    <button
                        v-if="canReset && !confirming"
                        class="g-btn g-btn-primary sk-reset"
                        :disabled="resetting || claiming !== null || !!opening.current.value"
                        @click="confirming = true"
                    >
                        <UIcon name="i-lucide-rotate-ccw" /> Reset streak
                    </button>
                </div>
            </div>

            <div class="g-progress sk-progress"><i :class="{ ok: status === 'finished' }" :style="{ width: `${progressPct}%` }" /></div>

            <div v-if="canReset" class="sk-banner" :class="`is-${status}`">
                <UIcon :name="status === 'broken' ? 'i-lucide-heart-crack' : 'i-lucide-trophy'" class="sk-banner-icon" />
                <div class="min-w-0 flex-1">
                    <p v-if="!confirming && status === 'broken'">
                        You missed a day, so the streak stopped at day {{ step }}. Reset it to start again from day 1.
                    </p>
                    <p v-else-if="!confirming">
                        All {{ TOWN_STREAK_DAYS }} days unlocked. Reset to start a new run.
                    </p>
                    <template v-else>
                        <p>
                            <b>Start over at day 1?</b>
                            <template v-if="claimableCount">
                                Your {{ claimableCount }} unclaimed {{ claimableCount === 1 ? 'day is' : 'days are' }} collected for you first, chests included.
                            </template>
                            <!-- A track finished today has already used today, so its day 1 can be tomorrow. -->
                            <template v-if="status === 'broken'">Today counts as day 1 of the new run.</template>
                        </p>
                        <div class="sk-confirm">
                            <button class="g-btn g-btn-primary g-btn-sm" :disabled="resetting" @click="onReset">
                                <span v-if="resetting" class="g-spinner g-spinner-xs" />
                                <UIcon v-else name="i-lucide-rotate-ccw" />
                                {{ claimableCount ? 'Collect and reset' : 'Reset' }}
                            </button>
                            <button class="g-btn g-btn-ghost g-btn-sm" :disabled="resetting" @click="confirming = false">Cancel</button>
                        </div>
                    </template>
                </div>
            </div>

            <!-- Track -->
            <div ref="scroller" class="sk-track" @wheel="onWheel">
                <div class="sk-row">
                    <div
                        v-for="p in track"
                        :key="p.step"
                        class="sk-col"
                        :class="[`is-${stateOf(p.step)}`, { 'is-milestone': p.milestone, 'is-today': isToday(p.step), 'is-next': isNext(p.step) }]"
                        :data-step="p.step"
                    >
                        <span class="sk-col-day">
                            <UIcon v-if="isToday(p.step)" name="i-lucide-map-pin" />
                            {{ dayLabel(p.step) }}
                        </span>
                        <div class="sk-lane">
                            <i v-if="p.step > 1" class="sk-rail sk-rail-l" :class="{ on: p.step <= step }" />
                            <i v-if="p.step < TOWN_STREAK_DAYS" class="sk-rail sk-rail-r" :class="{ on: p.step < step }" />
                            <button
                                type="button"
                                class="sk-tile"
                                :class="[`kind-${p.kind}`, p.chest ? `chest-${p.chest}` : '', { 'is-fresh': freshStep === p.step, 'is-busy': claiming === p.step, 'is-focus': focusStep === p.step, 'is-popped': popped === p.step }]"
                                :aria-label="`${dayLabel(p.step)}: ${p.label}${stateOf(p.step) === 'claimable' ? ', claim' : ''}`"
                                @click="onTile(p, $event)"
                                @mouseenter="inspected = p.step"
                                @focus="inspected = p.step"
                            >
                                <span class="sk-art">
                                    <TownCoin v-if="p.kind === 'coins'" class="sk-coin" />
                                    <UIcon v-else-if="p.kind === 'gems'" name="i-lucide-gem" class="sk-gem" />
                                    <span v-else-if="p.kind === 'resources'" class="sk-goods">
                                        <TownAsset v-for="g in goodsOf(p).slice(0, 3)" :id="g" :key="g" :label="goodName(g)" />
                                    </span>
                                    <TownBoostIcon v-else-if="p.kind === 'boost' && p.boost" :kind="p.boost" :size="p.milestone ? 44 : 32" class="sk-boost" />
                                    <TownChestArt v-else :tier="p.chest ?? 'wooden'" :size="p.milestone ? 60 : 42" class="sk-chest" />
                                </span>
                                <span v-if="p.kind === 'boost'" class="sk-amount sk-boost-label">{{ p.label }}<small> · {{ boostDuration(p) }}</small></span>
                                <span v-else class="sk-amount">{{ tileAmount(p) }}</span>
                                <span v-if="stateOf(p.step) === 'claimed'" class="sk-badge sk-badge-done"><UIcon name="i-lucide-check" /></span>
                                <span v-else-if="stateOf(p.step) === 'locked'" class="sk-badge sk-badge-lock"><UIcon name="i-lucide-lock" /></span>
                                <span v-else class="sk-claim">{{ claiming === p.step ? '…' : 'Claim' }}</span>
                            </button>
                        </div>
                        <span v-if="isNext(p.step)" class="sk-col-foot">in {{ countdown }}</span>
                        <span v-else-if="p.milestone" class="sk-col-foot is-milestone">Milestone</span>
                    </div>
                </div>
            </div>

            <!-- Detail strip -->
            <div v-if="focus" class="sk-detail">
                <span class="g-label">Day {{ focus.step }}</span>
                <b>{{ focus.label }}</b>
                <span v-if="focus.kind === 'coins'" class="sk-detail-amount is-gold"><TownCoin /> {{ tileAmount(focus) }}</span>
                <span v-else-if="focus.kind === 'resources'" class="sk-detail-amount">
                    <template v-if="fixedGood(focus)">
                        <TownAsset :id="fixedGood(focus)!.id" /> {{ formatNumber(fixedGood(focus)!.qty) }} {{ goodName(fixedGood(focus)!.id).toLowerCase() }}
                    </template>
                    <template v-else>{{ hoursText(focus) }} of output</template>
                </span>
                <span v-else-if="focus.kind === 'boost'" class="sk-detail-amount"><TownBoostIcon v-if="focus.boost" :kind="focus.boost" :size="18" /> {{ boostDuration(focus) }}</span>
                <span v-else-if="focus.kind === 'chest' && stateOf(focus.step) === 'claimable'" class="sk-detail-note">Open it to see what's inside</span>
                <span v-if="stateOf(focus.step) === 'claimed'" class="g-tag g-tag-green sk-detail-tag"><UIcon name="i-lucide-check" /> Claimed</span>
                <span v-else-if="stateOf(focus.step) === 'claimable'" class="g-tag g-tag-gold sk-detail-tag">Ready</span>
                <span v-else class="g-tag sk-detail-tag"><UIcon name="i-lucide-lock" /> Locked</span>
            </div>
        </template>

    </section>
</template>

<style scoped>
.sk {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
}

.sk-loading, .sk-empty {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
    min-height: 220px;
    color: var(--g-muted);
    font-size: 13px;
}
.sk-empty .iconify { font-size: 28px; color: var(--g-gold); }

/* ── Header ─────────────────────────────────────────────────────────────── */
.sk-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
}
.sk-day { display: flex; flex-direction: column; gap: 2px; }
.sk-day .g-label .iconify { color: var(--g-gold); }
.sk-day b {
    font-family: var(--g-font-display);
    font-size: 24px;
    font-weight: 600;
    line-height: 1.1;
    letter-spacing: -0.01em;
    font-variant-numeric: tabular-nums;
}
.sk-day small { font-size: 14px; color: var(--g-muted); font-weight: 500; }
.sk-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.sk-side { margin-left: auto; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.sk-timer {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 12px; color: var(--g-text-2);
    font-variant-numeric: tabular-nums;
}
.sk-timer b { color: var(--g-text); }
.sk-reset { box-shadow: 0 0 0 3px color-mix(in srgb, var(--g-accent) 22%, transparent); }
.sk-progress { height: 8px; }
.sk-progress i { background: linear-gradient(90deg, color-mix(in srgb, var(--g-gold) 70%, var(--g-warn)), var(--g-gold)); }

.sk-banner {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 10px 12px;
    border-radius: var(--g-radius-sm);
    border: 1px solid var(--g-line);
    background: var(--g-fill);
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--g-text-2);
}
.sk-banner b { color: var(--g-text); }
.sk-banner.is-broken { background: var(--g-red-bg); border-color: color-mix(in srgb, var(--g-red) 35%, transparent); }
.sk-banner.is-finished { background: var(--g-gold-bg); border-color: color-mix(in srgb, var(--g-gold) 40%, transparent); }
.sk-banner-icon { flex-shrink: 0; font-size: 18px; margin-top: 1px; }
.sk-banner.is-broken .sk-banner-icon { color: var(--g-red); }
.sk-banner.is-finished .sk-banner-icon { color: var(--g-gold); }
.sk-confirm { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }

/* ── Track ──────────────────────────────────────────────────────────────── */
.sk-track {
    overflow-x: auto;
    overflow-y: hidden;
    margin: 0 -4px;
    padding: 4px 4px 10px;
    scrollbar-width: thin;
    overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
    mask-image: linear-gradient(90deg, transparent 0, black 18px, black calc(100% - 18px), transparent 100%);
}
.sk-row {
    display: flex;
    align-items: stretch;
    width: max-content;
    padding: 0 14px;
    /* One lane height for every column, so the rail runs straight through tiles of both sizes. */
    --lane-h: 138px;
}
.sk-col {
    --tile-w: 76px;
    --tile-h: 92px;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: calc(var(--tile-w) + 14px);
    flex-shrink: 0;
}
.sk-col.is-milestone { --tile-w: 98px; --tile-h: 118px; }
.sk-col-day {
    display: inline-flex; align-items: center; gap: 3px;
    height: 18px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--g-muted);
    white-space: nowrap;
}
.sk-col.is-today .sk-col-day { color: var(--g-accent); }
.sk-col.is-next .sk-col-day { color: var(--g-text-2); }
.sk-col-foot {
    height: 16px;
    font-size: 10.5px;
    color: var(--g-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}
.sk-col-foot.is-milestone { color: var(--g-gold); font-weight: 600; }

.sk-lane {
    position: relative;
    width: 100%;
    height: var(--lane-h);
    display: flex;
    align-items: center;
    justify-content: center;
}
.sk-rail {
    position: absolute;
    top: 50%;
    height: 6px;
    margin-top: -3px;
    background: var(--g-fill-2);
}
.sk-rail-l { left: 0; right: 50%; }
.sk-rail-r { left: 50%; right: 0; }
.sk-rail.on {
    background: linear-gradient(90deg, color-mix(in srgb, var(--g-gold) 75%, var(--g-warn)), var(--g-gold));
    box-shadow: 0 0 10px color-mix(in srgb, var(--g-gold) 45%, transparent);
}

/* ── Tiles ──────────────────────────────────────────────────────────────── */
.sk-tile {
    position: relative;
    z-index: 1;
    width: var(--tile-w);
    height: var(--tile-h);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 6px 18px;
    border-radius: var(--g-radius);
    border: 1px solid var(--g-line);
    background: var(--g-bg-2);
    box-shadow: var(--g-shadow);
    color: var(--g-text);
    cursor: default;
    transition: transform 0.15s ease, box-shadow 0.2s ease, opacity 0.2s ease, border-color 0.2s ease;
}
.sk-tile.kind-coins { background: linear-gradient(180deg, var(--g-gold-bg), var(--g-bg-2) 70%); }
.sk-tile.kind-gems { background: linear-gradient(180deg, var(--g-gem-bg), var(--g-bg-2) 70%); }
.sk-tile.kind-resources { background: linear-gradient(180deg, var(--g-green-bg), var(--g-bg-2) 70%); }
.sk-tile.kind-chest { background: radial-gradient(circle at 50% 35%, var(--g-gold-bg), var(--g-bg-2) 75%); }
.sk-col.is-milestone .sk-tile { border-width: 2px; border-color: color-mix(in srgb, var(--g-gold) 45%, var(--g-line)); }
.sk-tile.is-focus { outline: 2px solid color-mix(in srgb, var(--g-accent) 45%, transparent); outline-offset: 2px; }

.sk-art { display: flex; align-items: center; justify-content: center; height: 36px; }
.sk-col.is-milestone .sk-art { height: 52px; }
.sk-coin { font-size: 30px; filter: drop-shadow(0 2px 2px color-mix(in srgb, var(--g-gold) 35%, transparent)); }
.sk-gem { font-size: 28px; color: var(--g-gem); filter: drop-shadow(0 2px 3px color-mix(in srgb, var(--g-gem) 45%, transparent)); }
.sk-goods { display: inline-flex; font-size: 20px; }
.sk-goods > * + * { margin-left: -0.55em; }
.sk-amount {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11.5px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
}
.sk-tile.kind-coins .sk-amount { color: var(--g-gold); }
.sk-tile.kind-gems .sk-amount { color: var(--g-gem); }
.sk-tile.kind-chest .sk-amount { font-size: 10.5px; color: var(--g-text-2); }

.sk-badge {
    position: absolute;
    top: -7px;
    right: -7px;
    width: 22px; height: 22px;
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 999px;
    font-size: 12px;
    border: 2px solid var(--g-bg-2);
}
.sk-badge-done { background: var(--g-green); color: var(--g-bg-2); }
.sk-badge-lock { background: var(--g-fill-2); color: var(--g-muted); }
.sk-claim {
    position: absolute;
    left: 50%;
    bottom: -9px;
    transform: translateX(-50%);
    padding: 2px 10px;
    border-radius: 999px;
    background: var(--g-gold);
    color: var(--g-bg-2);
    font-size: 10.5px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    box-shadow: 0 2px 8px color-mix(in srgb, var(--g-gold) 50%, transparent);
    white-space: nowrap;
}

/* Locked: muted art, nothing to click. */
.sk-col.is-locked .sk-tile { box-shadow: none; background: var(--g-fill); }
.sk-col.is-locked .sk-art,
.sk-col.is-locked .sk-amount { opacity: 0.45; filter: grayscale(0.7); }

/* Claimed: dimmed with a tick. */
.sk-col.is-claimed .sk-tile { box-shadow: none; }
.sk-col.is-claimed .sk-art,
.sk-col.is-claimed .sk-amount { opacity: 0.45; }

/* Claimable: glowing, pulsing, clickable. */
.sk-col.is-claimable .sk-tile {
    cursor: pointer;
    border-color: color-mix(in srgb, var(--g-gold) 70%, transparent);
    animation: sk-glow 1.8s ease-in-out infinite;
}
.sk-col.is-claimable .sk-tile:hover { transform: translateY(-3px) scale(1.03); }
.sk-col.is-claimable .sk-tile:active { transform: scale(0.98); }
.sk-tile.is-busy { animation: none; opacity: 0.75; }

.sk-col.is-today .sk-tile::before {
    content: '';
    position: absolute;
    inset: -6px;
    border-radius: calc(var(--g-radius) + 5px);
    border: 2px dashed color-mix(in srgb, var(--g-accent) 60%, transparent);
    pointer-events: none;
}
.sk-tile.is-fresh { animation: sk-unlock 1.2s cubic-bezier(.2, .9, .3, 1.3) both, sk-glow 1.8s ease-in-out 1.2s infinite; }

@keyframes sk-glow {
    0%, 100% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--g-gold) 22%, transparent), 0 0 14px color-mix(in srgb, var(--g-gold) 30%, transparent); }
    50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--g-gold) 30%, transparent), 0 0 26px color-mix(in srgb, var(--g-gold) 55%, transparent); }
}
@keyframes sk-unlock {
    0% { transform: scale(0.6) rotate(-6deg); opacity: 0; }
    60% { transform: scale(1.12) rotate(2deg); opacity: 1; }
    100% { transform: none; }
}

/* Just claimed: the tile squashes and springs back, a ring rolls out and the tick slams on. */
.sk-tile.is-popped { animation: sk-squash 0.6s cubic-bezier(.3, .7, .4, 1) both; }
.sk-tile.is-popped::after {
    content: '';
    position: absolute;
    inset: -2px;
    border-radius: inherit;
    border: 2px solid var(--g-gold);
    box-shadow: 0 0 16px color-mix(in srgb, var(--g-gold) 60%, transparent);
    pointer-events: none;
    animation: sk-ring 0.7s ease-out both;
}
.sk-tile.is-popped .sk-badge-done { animation: sk-stamp 0.42s cubic-bezier(.2, 1.5, .4, 1) 0.12s both; }
.sk-tile.is-popped.kind-gems::after { border-color: var(--g-gem); box-shadow: 0 0 16px color-mix(in srgb, var(--g-gem) 60%, transparent); }
.sk-tile.is-popped.kind-resources::after { border-color: var(--g-green); box-shadow: 0 0 16px color-mix(in srgb, var(--g-green) 50%, transparent); }

@keyframes sk-squash {
    0% { transform: scale(1); }
    18% { transform: scale(1.14, 0.84); }
    40% { transform: scale(0.92, 1.1); }
    62% { transform: scale(1.04, 0.97); }
    80% { transform: scale(0.99, 1.01); }
    100% { transform: scale(1); }
}
@keyframes sk-ring {
    0% { opacity: 0.9; transform: scale(0.9); }
    100% { opacity: 0; transform: scale(1.45); }
}
@keyframes sk-stamp {
    0% { opacity: 0; transform: scale(2.8) rotate(-35deg); }
    60% { opacity: 1; transform: scale(0.85) rotate(6deg); }
    100% { opacity: 1; transform: scale(1) rotate(0); }
}

/* ── Chest and boost art ────────────────────────────────────────────────── */
.sk-chest { filter: drop-shadow(0 3px 4px rgba(40, 25, 5, 0.25)); }
.sk-col.is-claimable .sk-chest { animation: sk-chest-wiggle 2.6s ease-in-out infinite; transform-origin: 50% 100%; }
@keyframes sk-chest-wiggle {
    0%, 78%, 100% { transform: none; }
    82% { transform: rotate(-6deg) scale(1.04); }
    86% { transform: rotate(6deg) scale(1.06); }
    90% { transform: rotate(-4deg) scale(1.04); }
    94% { transform: rotate(2deg); }
}
.sk-boost { filter: drop-shadow(0 3px 4px rgba(40, 25, 5, 0.2)); }
.sk-tile.kind-boost { background: linear-gradient(180deg, var(--g-warn-bg), var(--g-bg-2) 70%); }
.sk-boost-label {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    white-space: normal;
    text-align: center;
    font-size: 10px;
    line-height: 1.2;
    color: var(--g-text);
}
.sk-boost-label small { font-size: inherit; font-weight: 600; color: var(--g-muted); }
.sk-col.is-milestone .sk-boost-label { font-size: 10.5px; }
.sk-lucky {
    gap: 5px;
    padding-left: 3px;
    background: color-mix(in srgb, #14b8a6 14%, transparent);
    border-color: color-mix(in srgb, #14b8a6 40%, transparent);
    color: color-mix(in srgb, #0f766e 80%, var(--g-text));
}
.dark .sk-lucky { color: #99f6e4; }

/* ── Detail strip ───────────────────────────────────────────────────────── */
.sk-detail {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    padding: 9px 12px;
    border-radius: var(--g-radius-sm);
    background: var(--g-fill);
    border: 1px solid var(--g-line);
    font-size: 13px;
}
.sk-detail-amount { display: inline-flex; align-items: center; gap: 5px; font-weight: 700; font-variant-numeric: tabular-nums; }
.sk-detail-note { font-size: 12px; color: var(--g-muted); }
.sk-detail-tag { margin-left: auto; }

/* ── Phone ──────────────────────────────────────────────────────────────── */
@media (max-width: 560px) {
    .sk-row { --lane-h: 122px; }
    .sk-col { --tile-w: 66px; --tile-h: 84px; }
    .sk-col.is-milestone { --tile-w: 84px; --tile-h: 104px; }
    .sk-day b { font-size: 20px; }
    .sk-side { margin-left: 0; width: 100%; justify-content: space-between; }
}

/* Reduced motion: the OS setting, or the town's own switch (.is-calm). */
.sk.is-calm .sk-tile,
.sk.is-calm .sk-tile.is-fresh,
.sk.is-calm .sk-col.is-claimable .sk-tile,
.sk.is-calm .sk-tile.is-popped,
.sk.is-calm .sk-tile.is-popped::after,
.sk.is-calm .sk-tile.is-popped .sk-badge-done,
.sk.is-calm .sk-col.is-claimable .sk-chest { animation: none !important; transition: none !important; }
.sk.is-calm .sk-col.is-claimable .sk-tile { box-shadow: 0 0 0 3px color-mix(in srgb, var(--g-gold) 30%, transparent); }
.sk.is-calm .sk-col.is-claimable .sk-tile:hover { transform: none; }
.sk.is-calm .sk-tile.is-popped::after { display: none; }

@media (prefers-reduced-motion: reduce) {
    .sk-tile,
    .sk-tile.is-fresh,
    .sk-col.is-claimable .sk-tile,
    .sk-tile.is-popped,
    .sk-tile.is-popped::after,
    .sk-tile.is-popped .sk-badge-done,
    .sk-col.is-claimable .sk-chest { animation: none !important; transition: none !important; }
    .sk-col.is-claimable .sk-tile { box-shadow: 0 0 0 3px color-mix(in srgb, var(--g-gold) 30%, transparent); }
    .sk-col.is-claimable .sk-tile:hover { transform: none; }
    .sk-tile.is-popped::after { display: none; }
}
</style>
