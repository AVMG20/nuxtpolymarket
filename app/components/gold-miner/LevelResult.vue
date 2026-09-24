<script setup lang="ts">
import { gmPayout } from '#shared/utils/gamelogic/gold-miner'

const { state, continueFromResult } = useGoldMiner()

const r = computed(() => state.result)
const payout = computed(() => state.run ? gmPayout(state.run.stake, state.run.cash) : 0)
const title = computed(() => {
    if (!r.value) return ''
    if (r.value.cleared) return 'Goal reached!'
    if (r.value.error) return 'Level not settled'
    return r.value.reason === 'timeout' ? 'Claim abandoned' : 'Goal missed'
})
</script>

<template>
    <div v-if="r" class="wrap">
        <div class="parchment card" :class="{ win: r.cleared }">
            <div class="display title" :class="r.cleared ? 'good' : 'bad'">
                {{ title }}
            </div>
            <template v-if="r.cleared">
                <div class="line">
                    Level {{ r.level }} haul <b>+${{ r.earned.toLocaleString('en') }}</b> (goal ${{ r.goal.toLocaleString('en') }})
                </div>
                <div class="big display">
                    ${{ r.cash.toLocaleString('en') }}
                </div>
                <div class="line">
                    Worth <b>{{ formatNumber(payout) }} coins</b> if you cash out now
                </div>
                <button class="btn btn-gold" @click="continueFromResult">
                    <UIcon name="i-lucide-store" />
                    To the shop
                </button>
            </template>
            <template v-else>
                <div v-if="r.error" class="line">
                    {{ r.error }}
                </div>
                <div v-else class="line">
                    You needed <b>${{ r.goal.toLocaleString('en') }}</b> on this level and dug up <b>${{ r.earned.toLocaleString('en') }}</b>.
                </div>
                <div class="line lost">
                    Your stake is lost.
                </div>
                <button class="btn btn-wood" @click="continueFromResult">
                    <UIcon name="i-lucide-tent" />
                    Back to camp
                </button>
            </template>
        </div>
    </div>
</template>

<style scoped>
.wrap {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(20, 8, 0, 0.55);
    z-index: 20;
    padding: 16px;
}
.card {
    display: grid;
    justify-items: center;
    gap: 8px;
    padding: 22px 36px 26px;
    text-align: center;
    min-width: min(360px, 100%);
    animation: gm-in 0.5s cubic-bezier(0.2, 1.5, 0.4, 1);
}
@keyframes gm-in {
    from {
        transform: scale(0.7) rotate(-3deg);
        opacity: 0;
    }
}
.title {
    font-size: 42px;
    line-height: 1;
}
.good {
    color: #2f7a1a;
}
.bad {
    color: #a02a14;
}
.big {
    font-size: 54px;
    line-height: 1;
    color: #8a5a00;
}
.line {
    font-weight: 700;
}
.lost {
    color: #a02a14;
}
.btn {
    margin-top: 8px;
}
</style>
