<script setup lang="ts">
import { GM_CASH_PER_STAKE, GM_MAX_STAKE, GM_MIN_STAKE, gmGoal, gmPayout } from '#shared/utils/gamelogic/gold-miner'

const { state, balance, start } = useGoldMiner()
const art = inject<{ emblem: string, icons: Record<string, string> }>('gold-miner-art')!

const stake = toRef(state, 'stake')
const stakeText = useAmountInput(stake, { shorthand: true })
const chips = [100, 500, 1_000, 2_500, 5_000, 10_000]

const stakeError = computed(() => {
    if (!(stake.value >= GM_MIN_STAKE)) return `Minimum stake is ${formatNumber(GM_MIN_STAKE)}`
    if (stake.value > GM_MAX_STAKE) return `Maximum stake is ${formatNumber(GM_MAX_STAKE)}`
    if (stake.value > balance.value) return 'Not enough coins'
    return ''
})

function setStake(v: number) {
    stake.value = Math.min(GM_MAX_STAKE, Math.max(GM_MIN_STAKE, Math.floor(v)))
}

// The least you can hold after clearing each level, and what that pays.
const ladder = computed(() => [1, 2, 3, 5, 8].map((level) => {
    let least = 0
    for (let l = 1; l <= level; l++) least += gmGoal(l)
    return { level, goal: least, coins: gmPayout(stake.value || 0, least) }
}))
</script>

<template>
    <div class="lobby">
        <div class="title">
            <img :src="art.emblem" alt="" class="emblem">
            <div>
                <div class="display gold-text logo">
                    Gold Miner
                </div>
                <div class="tag">
                    Swing the claw. Beat the clock. Strike it rich.
                </div>
            </div>
        </div>

        <div class="panel card">
            <div class="stake-row">
                <label class="label" for="gm-stake">Stake</label>
                <span class="label bal">Balance <CoinBalance :value="balance" /></span>
            </div>
            <div class="input-wrap">
                <input
                    id="gm-stake"
                    v-model="stakeText"
                    class="stake-input display"
                    inputmode="decimal"
                    autocomplete="off"
                    @keydown.enter="!stakeError && start()"
                >
                <span class="preview">{{ amountPreview(stakeText) }}</span>
            </div>
            <div class="chips">
                <button v-for="c in chips" :key="c" class="chip" :class="{ on: stake === c }" @click="setStake(c)">
                    {{ formatNumber(c) }}
                </button>
                <button class="chip" @click="setStake(stake / 2)">
                    ½
                </button>
                <button class="chip" @click="setStake(stake * 2)">
                    2×
                </button>
            </div>
            <div v-if="stakeError" class="err">
                {{ stakeError }}
            </div>

            <button class="btn btn-gold go" :disabled="!!stakeError || state.busy" @click="start">
                <UIcon v-if="state.busy" name="i-lucide-loader-circle" class="animate-spin" />
                Start digging
            </button>

            <div class="ladder">
                <div class="label">
                    Cash out after clearing…
                </div>
                <div class="rungs">
                    <div v-for="r in ladder" :key="r.level" class="rung">
                        <span class="lv">Lv {{ r.level }}</span>
                        <span class="need">${{ r.goal.toLocaleString('en') }}+</span>
                        <span class="coins" :class="{ up: r.coins > stake }">{{ formatNumber(r.coins) }}</span>
                    </div>
                </div>
                <div class="fine">
                    Every ${{ GM_CASH_PER_STAKE.toLocaleString('en') }} you hold is worth one stake. Each level rolls a hidden vein, thin to mother lode, so nobody knows how deep a run goes. Miss a goal and the stake is gone.
                </div>
            </div>
        </div>

        <div class="footer">
            <div v-if="state.stats" class="stats">
                <span><b>{{ state.stats.bestLevel }}</b> best level</span>
                <span><b>{{ formatNumber(state.stats.bestPayout) }}</b> best cash-out</span>
                <span><b>{{ state.stats.runsPlayed }}</b> runs</span>
            </div>
            <button class="btn btn-wood how" @click="state.showRules = true">
                <UIcon name="i-lucide-book-open" />
                How to play
            </button>
        </div>
    </div>
</template>

<style scoped>
.lobby {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-rows: auto auto auto;
    justify-items: center;
    align-content: center;
    gap: 12px;
    padding: 18px 18px 18px max(18px, 4cqw);
    width: min(560px, 100%);
    /* The left side holds the menu; the miner keeps playing on the right. */
    background: linear-gradient(90deg, rgba(20, 8, 0, 0.82) 0%, rgba(20, 8, 0, 0.6) 70%, rgba(20, 8, 0, 0) 100%);
    z-index: 20;
    overflow-y: auto;
}
.title {
    display: flex;
    align-items: center;
    gap: 14px;
}
.emblem {
    width: 88px;
    filter: drop-shadow(0 8px 14px rgba(0, 0, 0, 0.5));
    animation: gm-float 2.4s ease-in-out infinite alternate;
}
@keyframes gm-float {
    to {
        transform: translateY(-6px) rotate(-6deg);
    }
}
.logo {
    font-size: clamp(36px, 5.6cqw, 64px);
    line-height: 0.95;
}
.tag {
    font-weight: 800;
    color: #ffe6b8;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.6);
}
.card {
    width: min(440px, 100%);
    padding: 16px 18px 18px;
    display: grid;
    gap: 10px;
    align-self: start;
}
.stake-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.bal {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    text-transform: none;
    letter-spacing: 0.04em;
}
.input-wrap {
    position: relative;
}
.stake-input {
    width: 100%;
    font-size: 30px;
    padding: 8px 14px;
    border-radius: 12px;
    border: 2px solid #1e0f04;
    background: #1e0f04;
    color: #ffe066;
    box-shadow: inset 0 3px 8px rgba(0, 0, 0, 0.6);
    outline: none;
}
.stake-input:focus {
    border-color: #ffcf3a;
}
.preview {
    position: absolute;
    right: 14px;
    top: 50%;
    transform: translateY(-50%);
    font-weight: 800;
    color: rgba(255, 230, 184, 0.6);
    pointer-events: none;
}
.chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
.chip {
    padding: 5px 10px;
    border-radius: 999px;
    font-weight: 900;
    font-size: 13px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 220, 160, 0.25) !important;
}
.chip.on {
    background: #ffcf3a;
    color: #4a2400;
}
.err {
    color: #ff8a7a;
    font-weight: 800;
    font-size: 13px;
}
.go {
    font-size: 26px;
    padding: 14px;
    margin-top: 4px;
}
.ladder {
    margin-top: 4px;
    display: grid;
    gap: 6px;
}
.rungs {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
}
.rung {
    display: grid;
    justify-items: center;
    padding: 6px 2px;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.25);
    font-size: 12px;
    font-weight: 800;
}
.lv {
    color: #ffe6b8;
}
.need {
    opacity: 0.6;
    font-size: 11px;
}
.coins {
    font-family: var(--display);
    font-size: 15px;
    color: #ffb4a8;
}
.coins.up {
    color: var(--green);
}
.fine {
    font-size: 12px;
    font-weight: 700;
    color: rgba(255, 230, 184, 0.7);
}
.footer {
    display: flex;
    gap: 16px;
    align-items: center;
    flex-wrap: wrap;
    justify-content: center;
}
.stats {
    display: flex;
    gap: 14px;
    font-weight: 700;
    color: #ffe6b8;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.7);
}
.stats b {
    font-family: var(--display);
    font-weight: 400;
    color: #ffe066;
}
.how {
    font-size: 16px;
    padding: 8px 14px;
}
@container gm (max-width: 760px) {
    .lobby {
        width: 100%;
        background: rgba(20, 8, 0, 0.72);
    }
}
@container gm (max-height: 600px) {
    .emblem {
        width: 56px;
    }
    .ladder {
        display: none;
    }
}
</style>
