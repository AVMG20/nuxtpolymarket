<script setup lang="ts">
import { GM_VEINS } from '#shared/utils/gamelogic/gold-miner'

const { state, goal } = useGoldMiner()
const art = inject<{ icons: Record<string, string> }>('gold-miner-art')!
</script>

<template>
    <div class="card parchment">
        <div class="lvl display">
            Level {{ state.run?.level }}
        </div>
        <div v-if="state.vein" class="vein display" :class="state.vein">
            {{ GM_VEINS[state.vein].label }}
        </div>
        <div class="goal-label">
            Dig up
        </div>
        <div class="goal display">
            ${{ goal.toLocaleString('en') }}
        </div>
        <div class="carried">
            <template v-if="state.run && state.run.cash > 0">
                ${{ state.run.cash.toLocaleString('en') }} in the bank ·
            </template>
            60 seconds on the clock
        </div>
        <div class="perks">
            <span v-if="state.run?.perks.strength"><img :src="art.icons.strength" alt="">Strength</span>
            <span v-if="state.run?.perks.clover"><img :src="art.icons.clover" alt="">Lucky clover</span>
            <span v-if="state.run?.perks.book"><img :src="art.icons.book" alt="">Rock book</span>
            <span v-if="state.run?.perks.polish"><img :src="art.icons.polish" alt="">Diamond polish</span>
        </div>
    </div>
</template>

<style scoped>
.card {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    padding: 18px 44px 20px;
    text-align: center;
    pointer-events: none !important;
    min-width: 280px;
}
.lvl {
    font-size: 26px;
    color: #8a3a10;
}
.vein {
    display: inline-block;
    margin: 2px 0 6px;
    padding: 2px 12px;
    border-radius: 999px;
    font-size: 16px;
    color: #fff;
    text-shadow: 0 1px 0 rgba(0, 0, 0, 0.35);
}
.vein.thin {
    background: linear-gradient(180deg, #d0553a, #8a2a14);
}
.vein.steady {
    background: linear-gradient(180deg, #c89a3a, #7a5410);
}
.vein.rich {
    background: linear-gradient(180deg, #ffd24a, #d08a0c);
    color: #4a2400;
    text-shadow: 0 1px 0 rgba(255, 255, 255, 0.5);
    box-shadow: 0 0 18px rgba(255, 200, 60, 0.7);
}
.goal-label {
    font-weight: 800;
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    opacity: 0.7;
}
.goal {
    font-size: 58px;
    line-height: 1;
    color: #2f7a1a;
    text-shadow: 0 3px 0 rgba(0, 0, 0, 0.15);
}
.carried {
    margin-top: 4px;
    font-weight: 800;
    font-size: 14px;
    opacity: 0.75;
}
.perks {
    display: flex;
    gap: 10px;
    justify-content: center;
    margin-top: 8px;
    font-weight: 800;
    font-size: 13px;
}
.perks span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}
.perks img {
    width: 22px;
    height: 22px;
}
</style>
