<script setup lang="ts">
const { state, continueFromResult } = useGoldMiner()

// Cosmetic coin rain.
const coins = Array.from({ length: 28 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 1.6,
    dur: 1.6 + Math.random() * 1.4,
    size: 18 + Math.random() * 18
}))
</script>

<template>
    <div v-if="state.cashout" class="wrap">
        <div class="rain" aria-hidden="true">
            <span
                v-for="c in coins"
                :key="c.id"
                class="coin"
                :style="{ left: `${c.left}%`, animationDelay: `${c.delay}s`, animationDuration: `${c.dur}s`, width: `${c.size}px`, height: `${c.size}px` }"
            />
        </div>
        <div class="parchment card">
            <div class="display title">
                Cashed out!
            </div>
            <div class="line">
                ${{ state.cashout.cash.toLocaleString('en') }} of gold after {{ state.cashout.level }} level{{ state.cashout.level === 1 ? '' : 's' }}
            </div>
            <div class="payout display">
                <UIcon name="i-lucide-coins" />
                {{ formatNumber(state.cashout.payout) }}
            </div>
            <button class="btn btn-gold" @click="continueFromResult">
                <UIcon name="i-lucide-pickaxe" />
                Dig again
            </button>
        </div>
    </div>
</template>

<style scoped>
.wrap {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(20, 8, 0, 0.6);
    z-index: 20;
    overflow: hidden;
}
.card {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 8px;
    padding: 24px 40px 26px;
    text-align: center;
    animation: gm-in 0.6s cubic-bezier(0.2, 1.6, 0.4, 1);
}
@keyframes gm-in {
    from {
        transform: scale(0.5);
        opacity: 0;
    }
}
.title {
    font-size: 44px;
    color: #2f7a1a;
}
.line {
    font-weight: 700;
}
.payout {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 64px;
    line-height: 1;
    color: #a86a00;
}
.rain {
    position: absolute;
    inset: 0;
    pointer-events: none;
}
.coin {
    position: absolute;
    top: -40px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #fffbe0, #ffd23a 40%, #c47a0c 85%);
    border: 2px solid #7a4200;
    animation: gm-fall linear infinite;
}
@keyframes gm-fall {
    to {
        transform: translateY(120cqh) rotateY(720deg);
    }
}
</style>
