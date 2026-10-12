<script setup lang="ts">
import TownAsset from '~/components/town/TownAsset.vue'
import TownCoin from '~/components/town/TownCoin.vue'
import type { TownResourceView } from '~/composables/useTown'
import type { TownContractDelivery, TownContractView } from '~/composables/useTownContracts'

const props = withDefaults(defineProps<{
    busy?: boolean
    resourceById?: Map<string, TownResourceView>
    /** The town's live inventory; falls back to the stock the contracts were fetched with. */
    inventory?: Record<string, number>
}>(), {
    busy: false,
    resourceById: undefined,
    inventory: undefined
})

const emit = defineEmits<{
    delivered: [res: TownContractDelivery]
}>()

const sound = useTownSound()
const fx = useTownFx()
const { reduced } = useTownMotion()
const { data, pending, contracts, bonus, deliveredCount, have, delivering, deliver, claimingBonus, claimBonus, resetAt, serverNow } = useTownContracts(() => props.inventory)

// The countdown ticks on its own clock; the composable refetches at the reset.
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | null = null
onMounted(() => {
    now.value = serverNow()
    clock = setInterval(() => { now.value = serverNow() }, 1_000)
})
const timers = new Set<ReturnType<typeof setTimeout>>()
function later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
        timers.delete(t)
        fn()
    }, ms)
    timers.add(t)
}
onBeforeUnmount(() => {
    if (clock) clearInterval(clock)
    for (const t of timers) clearTimeout(t)
})
const countdown = computed(() => resetAt.value ? formatTownDuration(resetAt.value - now.value) : '…')

/** The contract whose stamp is landing right now; only that one animates. */
const fresh = ref<string | null>(null)
const bonusFresh = ref(false)

function nameOf(c: TownContractView) {
    return props.resourceById?.get(c.resource)?.name ?? c.name
}

function shortBy(c: TownContractView) {
    return Math.max(0, c.quantity - have(c))
}

function pct(c: TownContractView) {
    if (c.delivered) return 100
    return c.quantity > 0 ? Math.min(100, (have(c) / c.quantity) * 100) : 0
}

function blockedReason(c: TownContractView): string | null {
    const short = shortBy(c)
    if (short > 0) return `Short ${formatNumber(short)} ${nameOf(c).toLowerCase()}`
    return null
}

async function onDeliver(c: TownContractView, ev: MouseEvent) {
    if (props.busy || delivering.value || shortBy(c) > 0) return
    const card = (ev.currentTarget as Element | null)?.closest('.tc-card') ?? null
    const res = await deliver(c.id)
    if (!res) return
    fresh.value = c.id
    sound.play('stamp')
    // The coins burst out as the stamp lands, a quarter second in.
    const rect = card?.getBoundingClientRect()
    later(reduced.value ? 0 : 260, () => fx.reward(rect, { coins: res.reward }, { scale: 1.3 }))
    if (res.bonusReady) bonusFresh.value = true
    emit('delivered', res)
}

const bonusBtn = ref<HTMLElement | null>(null)

async function onClaimBonus() {
    if (claimingBonus.value || !bonus.value.claimable) return
    const rect = bonusBtn.value?.getBoundingClientRect()
    const res = await claimBonus()
    if (!res) {
        sound.play('error')
        return
    }
    sound.play('gem')
    fx.flash(rect, 'gem', 220)
    fx.reward(rect, { gems: res.gems }, { scale: 1.4, big: true })
}
</script>

<template>
    <section class="g-sec tc" :class="{ 'is-calm': reduced }">
        <header>
            <span class="tc-title"><UIcon name="i-lucide-scroll-text" /> Town hall contracts</span>
            <span class="tc-timer" data-tip="A new set arrives at midnight UTC">
                <UIcon name="i-lucide-hourglass" /> New in <b>{{ countdown }}</b>
            </span>
        </header>

        <div v-if="!data && pending" class="tc-loading"><span class="g-spinner" /></div>
        <div v-else-if="!contracts.length" class="g-empty">No contracts today</div>

        <template v-else>
            <div class="tc-grid">
                <article
                    v-for="c in contracts"
                    :key="c.id"
                    class="tc-card"
                    :class="{ 'is-done': c.delivered, 'is-ready': !c.delivered && shortBy(c) === 0, 'is-slammed': fresh === c.id }"
                >
                    <span class="tc-no">No. {{ c.slot + 1 }}</span>

                    <div class="tc-art-wrap">
                        <TownAsset :id="c.resource" :label="nameOf(c)" class="tc-art" />
                    </div>

                    <div class="tc-want">
                        <b class="tc-qty">{{ formatNumber(c.quantity, false) }}</b>
                        <span class="tc-name">{{ nameOf(c) }}</span>
                    </div>

                    <div class="tc-have">
                        <div class="g-progress flex-1"><i :class="{ ok: pct(c) >= 100 }" :style="{ width: `${pct(c)}%` }" /></div>
                        <span class="tc-count" :class="{ 'is-short': !c.delivered && shortBy(c) > 0 }">
                            {{ formatNumber(c.delivered ? c.quantity : have(c)) }}/{{ formatNumber(c.quantity) }}
                        </span>
                    </div>

                    <div class="tc-reward">
                        <span class="tc-coins"><TownCoin /> {{ formatNumber(c.reward) }}</span>
                        <span class="g-tag g-tag-gold" :data-tip="`The floor pays ${formatNumber(c.floorValue)}`">2× floor</span>
                    </div>

                    <div class="tc-foot">
                        <template v-if="!c.delivered">
                            <button
                                class="g-btn w-full"
                                :class="shortBy(c) === 0 ? 'g-btn-primary' : ''"
                                :disabled="busy || !!delivering || shortBy(c) > 0"
                                @click="onDeliver(c, $event)"
                            >
                                <span v-if="delivering === c.id" class="g-spinner g-spinner-xs" />
                                <UIcon v-else name="i-lucide-package-check" />
                                Deliver
                            </button>
                            <span class="tc-reason">{{ blockedReason(c) ?? 'Ready to ship' }}</span>
                        </template>
                        <span v-else class="tc-reason is-done"><UIcon name="i-lucide-check" /> Paid {{ formatNumber(c.reward) }}</span>
                    </div>

                    <div v-if="c.delivered" class="tc-stamp" :class="{ 'is-fresh': fresh === c.id }" aria-hidden="true">
                        <span>Delivered</span>
                    </div>
                </article>
            </div>

            <div class="tc-bonus" :class="{ 'is-earned': bonus.claimed, 'is-ready': bonus.claimable, 'is-fresh': bonusFresh }">
                <span class="tc-pips" aria-hidden="true">
                    <i v-for="n in contracts.length" :key="n" :class="{ 'is-on': n <= deliveredCount }" />
                </span>
                <span class="tc-bonus-text">
                    <template v-if="bonus.claimed || bonus.claimable">All {{ contracts.length }} delivered</template>
                    <template v-else>Deliver all {{ contracts.length }}</template>
                </span>
                <button
                    v-if="bonus.claimable"
                    ref="bonusBtn"
                    type="button"
                    class="tc-bonus-claim"
                    :disabled="claimingBonus"
                    @click="onClaimBonus"
                >
                    <span v-if="claimingBonus" class="g-spinner g-spinner-xs" />
                    <UIcon v-else name="i-lucide-gem" class="tc-bonus-gem" />
                    Claim +{{ formatNumber(bonus.gems) }} {{ bonus.gems === 1 ? 'gem' : 'gems' }}
                </button>
                <template v-else>
                    <span class="g-tag g-tag-gem tc-gems"><UIcon name="i-lucide-gem" /> +{{ formatNumber(bonus.gems) }}</span>
                    <span v-if="bonus.claimed" class="g-tag g-tag-green tc-claimed"><UIcon name="i-lucide-check" /> Claimed</span>
                    <span v-else class="tc-bonus-left">{{ contracts.length - deliveredCount }} to go</span>
                </template>
            </div>
        </template>
    </section>
</template>

<style scoped>
.tc-title, .tc-timer { display: inline-flex; align-items: center; gap: 6px; }
.tc-timer { font-variant-numeric: tabular-nums; white-space: nowrap; }
.tc > header { flex-wrap: wrap; row-gap: 4px; }
.tc-timer b { color: var(--g-text); }
.tc-loading { display: flex; justify-content: center; padding: 28px 0; }

.tc-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
}
@media (max-width: 640px) {
    .tc-grid { grid-template-columns: 1fr; }
}

/* ── card ── */
.tc-card {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 18px 12px 12px;
    border-radius: var(--g-radius);
    background:
        radial-gradient(120% 70% at 50% 0%, var(--g-gold-bg), transparent 70%),
        var(--g-bg-2);
    border: 1px solid var(--g-line);
    box-shadow: var(--g-shadow);
    overflow: hidden;
    transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}
/* A deckled ticket edge along the top. */
.tc-card::before {
    content: '';
    position: absolute;
    inset: 0 0 auto;
    height: 4px;
    background: repeating-linear-gradient(90deg, color-mix(in srgb, var(--g-gold) 55%, transparent) 0 8px, transparent 8px 12px);
}
.tc-card.is-ready {
    border-color: color-mix(in srgb, var(--g-gold) 60%, transparent);
    box-shadow: var(--g-shadow), 0 0 0 3px color-mix(in srgb, var(--g-gold) 18%, transparent);
}
.tc-card.is-ready:hover { transform: translateY(-2px); }

.tc-no {
    position: absolute;
    top: 10px; left: 10px;
    padding: 2px 6px;
    border-radius: var(--g-radius-xs);
    background: var(--g-fill-2);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--g-muted);
}

.tc-art-wrap {
    width: 68px; height: 68px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%;
    background: var(--g-fill);
    border: 1px solid var(--g-line);
}
.tc-art { width: 48px; height: 48px; filter: drop-shadow(0 3px 4px rgba(0, 0, 0, 0.18)); }
.tc-card.is-ready .tc-art { animation: tc-bob 2.6s ease-in-out infinite; }

.tc-want { display: flex; flex-direction: column; align-items: center; line-height: 1.15; }
.tc-qty {
    font-family: var(--g-font-display);
    font-size: 24px;
    font-weight: 650;
    letter-spacing: -0.01em;
    font-variant-numeric: tabular-nums;
}
.tc-name { font-size: 12px; font-weight: 600; color: var(--g-text-2); }

.tc-have { display: flex; align-items: center; gap: 8px; width: 100%; }
.tc-count { font-size: 11px; color: var(--g-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.tc-count.is-short { color: var(--g-warn); }

.tc-reward {
    display: flex; align-items: center; justify-content: space-between; gap: 6px;
    width: 100%;
    padding: 7px 10px;
    border-radius: var(--g-radius-sm);
    background: var(--g-gold-bg);
    border: 1px solid color-mix(in srgb, var(--g-gold) 30%, transparent);
}
.tc-coins {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 15px; font-weight: 700;
    color: var(--g-gold);
    font-variant-numeric: tabular-nums;
}

.tc-foot { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 100%; margin-top: auto; }
.tc-reason { min-height: 15px; font-size: 11px; color: var(--g-muted); font-variant-numeric: tabular-nums; }
.tc-card.is-ready .tc-reason { color: var(--g-green); }
.tc-reason.is-done { display: inline-flex; align-items: center; gap: 4px; color: var(--g-green); font-weight: 600; padding: 9px 0; }

/* ── delivered ── */
.tc-card.is-done { box-shadow: none; }
.tc-card.is-done > :not(.tc-stamp) { opacity: 0.55; }
.tc-card.is-done .tc-art { filter: grayscale(0.5); }

.tc-stamp {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
}
.tc-stamp span {
    padding: 6px 14px;
    border: 3px double var(--g-green);
    border-radius: 8px;
    color: var(--g-green);
    background: color-mix(in srgb, var(--g-green-bg) 60%, transparent);
    font-family: var(--g-font-display);
    font-size: 22px;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    transform: rotate(-14deg);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--g-green) 35%, transparent);
}
.tc-stamp.is-fresh span { animation: tc-stamp 0.45s cubic-bezier(0.2, 1.5, 0.4, 1) both; }
.tc-stamp.is-fresh::after {
    content: '';
    position: absolute;
    width: 120px; height: 120px;
    border-radius: 50%;
    border: 2px solid var(--g-green);
    opacity: 0;
    animation: tc-ring 0.6s ease-out 0.12s;
}

/* ── bonus ── */
.tc-bonus {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
    padding: 10px 14px;
    border-radius: var(--g-radius-sm);
    border: 1px dashed var(--g-line-2);
    font-size: 13px;
    transition: background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
}
.tc-bonus-text { font-weight: 600; margin-right: auto; }
.tc-bonus-left { font-size: 11.5px; color: var(--g-muted); }
.tc-bonus.is-earned {
    border-style: solid;
    border-color: color-mix(in srgb, var(--g-gem) 55%, transparent);
    background: var(--g-gem-bg);
    box-shadow: 0 0 18px color-mix(in srgb, var(--g-gem) 25%, transparent);
}
.tc-bonus.is-ready {
    border-style: solid;
    border-color: color-mix(in srgb, var(--g-gem) 55%, transparent);
    background: var(--g-gem-bg);
}
.tc-bonus.is-ready .tc-pips i { background: var(--g-gem); border-color: var(--g-gem); }
.tc-bonus.is-earned .tc-claimed { animation: tc-gem-pop 0.6s cubic-bezier(0.2, 1.6, 0.4, 1) both; }

/* The bonus waiting: a big glowing gem button with a shimmer sweeping across. */
.tc-bonus-claim {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 9px 18px;
    overflow: hidden;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--g-gem) 70%, white);
    background: linear-gradient(180deg, color-mix(in srgb, var(--g-gem) 82%, white), var(--g-gem));
    color: #fff;
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 0.01em;
    white-space: nowrap;
    cursor: pointer;
    text-shadow: 0 1px 1px color-mix(in srgb, var(--g-gem) 60%, black);
    animation: tc-bonus-glow 1.6s ease-in-out infinite;
    transition: transform 0.15s ease;
}
.tc-bonus-claim::after {
    content: '';
    position: absolute;
    inset: 0;
    width: 40%;
    background: linear-gradient(100deg, transparent, rgb(255 255 255 / 55%), transparent);
    transform: translateX(-160%) skewX(-18deg);
    animation: tc-shimmer 2.4s ease-in-out infinite;
    pointer-events: none;
}
.tc-bonus-claim:hover { transform: translateY(-1px) scale(1.04); }
.tc-bonus-claim:active { transform: scale(0.97); }
.tc-bonus-claim:disabled { cursor: default; opacity: 0.8; }
.tc-bonus-gem { width: 17px; height: 17px; }
.tc-bonus.is-fresh .tc-bonus-claim { animation: tc-bonus-in 0.6s cubic-bezier(0.2, 1.6, 0.4, 1) 0.5s backwards, tc-bonus-glow 1.6s ease-in-out 1.1s infinite; }

/* Delivered: the card jolts as the stamp lands. */
.tc-card.is-slammed { animation: tc-slam 0.42s ease-out 0.24s; }

.tc-pips { display: inline-flex; gap: 4px; }
.tc-pips i {
    width: 10px; height: 10px;
    border-radius: 50%;
    background: var(--g-fill-2);
    border: 1px solid var(--g-line-2);
    transition: background 0.3s ease, border-color 0.3s ease;
}
.tc-pips i.is-on { background: var(--g-green); border-color: var(--g-green); }
.tc-bonus.is-earned .tc-pips i { background: var(--g-gem); border-color: var(--g-gem); }

@keyframes tc-stamp {
    0% { opacity: 0; transform: rotate(-24deg) scale(2.6); }
    60% { opacity: 1; transform: rotate(-12deg) scale(0.92); }
    100% { opacity: 1; transform: rotate(-14deg) scale(1); }
}
@keyframes tc-ring {
    0% { opacity: 0.7; transform: scale(0.4); }
    100% { opacity: 0; transform: scale(1.4); }
}
@keyframes tc-bob {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-3px); }
}
@keyframes tc-slam {
    0% { transform: translate(0, 0); }
    15% { transform: translate(-3px, 3px) rotate(-0.6deg); }
    35% { transform: translate(3px, -2px) rotate(0.5deg); }
    55% { transform: translate(-2px, 1px); }
    75% { transform: translate(1px, 0); }
    100% { transform: translate(0, 0); }
}
@keyframes tc-bonus-glow {
    0%, 100% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--g-gem) 22%, transparent), 0 4px 14px color-mix(in srgb, var(--g-gem) 35%, transparent); }
    50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--g-gem) 14%, transparent), 0 4px 26px color-mix(in srgb, var(--g-gem) 60%, transparent); }
}
@keyframes tc-shimmer {
    0%, 35% { transform: translateX(-160%) skewX(-18deg); }
    75%, 100% { transform: translateX(320%) skewX(-18deg); }
}
@keyframes tc-bonus-in {
    0% { opacity: 0; transform: scale(0.4); }
    100% { opacity: 1; transform: scale(1); }
}
@keyframes tc-gem-pop {
    0% { transform: scale(1); }
    40% { transform: scale(1.35) rotate(-6deg); }
    100% { transform: scale(1); }
}

/* Reduced motion: the OS setting, or the town's own switch (.is-calm). */
.tc.is-calm :is(.tc-card, .tc-bonus, .tc-pips i) { transition: none; }
.tc.is-calm .tc-card.is-ready:hover { transform: none; }
.tc.is-calm .tc-card.is-ready .tc-art,
.tc.is-calm .tc-card.is-slammed,
.tc.is-calm .tc-stamp.is-fresh span,
.tc.is-calm .tc-stamp.is-fresh::after,
.tc.is-calm .tc-bonus.is-earned .tc-claimed,
.tc.is-calm .tc-bonus-claim,
.tc.is-calm .tc-bonus-claim::after,
.tc.is-calm .tc-bonus.is-fresh .tc-bonus-claim { animation: none; }
.tc.is-calm .tc-bonus-claim { box-shadow: 0 0 0 3px color-mix(in srgb, var(--g-gem) 25%, transparent); }
.tc.is-calm .tc-bonus-claim::after { display: none; }

@media (prefers-reduced-motion: reduce) {
    .tc-card, .tc-bonus, .tc-pips i { transition: none; }
    .tc-card.is-ready:hover { transform: none; }
    .tc-card.is-ready .tc-art,
    .tc-card.is-slammed,
    .tc-stamp.is-fresh span,
    .tc-stamp.is-fresh::after,
    .tc-bonus.is-earned .tc-claimed,
    .tc-bonus-claim,
    .tc-bonus.is-fresh .tc-bonus-claim { animation: none; }
    .tc-bonus-claim { box-shadow: 0 0 0 3px color-mix(in srgb, var(--g-gem) 25%, transparent); }
    .tc-bonus-claim::after { display: none; }
}
</style>
