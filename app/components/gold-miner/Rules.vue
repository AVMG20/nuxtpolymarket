<script setup lang="ts">
import { GM_CASH_PER_STAKE, GM_ITEMS, GM_LEVEL_MS, type GmKind } from '#shared/utils/gamelogic/gold-miner'

const { state } = useGoldMiner()
const art = inject<{ icons: Record<string, string> }>('gold-miner-art')!

const rows: { kind: GmKind, note?: string }[] = [
    { kind: 'goldS' },
    { kind: 'goldM' },
    { kind: 'goldL' },
    { kind: 'goldXL', note: 'very heavy' },
    { kind: 'diamond', note: 'light and pricey' },
    { kind: 'moleDiamond' },
    { kind: 'rockS', note: 'worth little, slow' },
    { kind: 'rockL', note: 'dead weight' },
    { kind: 'bag', note: 'cash, strength or dynamite' },
    { kind: 'tnt', note: 'blows up its neighbours' }
]

function close() {
    state.showRules = false
}
</script>

<template>
    <div class="wrap" @click.self="close">
        <div class="parchment card" role="dialog" aria-label="How to play Gold Miner">
            <button class="x" aria-label="Close" @click="close">
                <UIcon name="i-lucide-x" />
            </button>
            <div class="display title">
                How to play
            </div>
            <ol class="steps">
                <li>The claw swings back and forth. <b>Click, tap or press Space</b> to drop it.</li>
                <li>It grabs the first thing it touches and winches it up. <b>Heavy things come up slowly.</b></li>
                <li>Each level lasts <b>{{ GM_LEVEL_MS / 1000 }} seconds</b> and has its own goal: dig up that much <b>on that level</b> to open the shop. Your cash keeps adding up for the cash-out.</li>
                <li>Every level rolls a hidden <b>vein</b>: a thin vein barely holds the goal, a mother lode is packed with gold. Thin veins get commoner the deeper you go.</li>
                <li>Hauling junk? Press <b>↑</b> to throw dynamite at it and reel back at full speed.</li>
                <li>At the shop, buy boosts for the next level, or <b>cash out</b>: every ${{ GM_CASH_PER_STAKE.toLocaleString('en') }} you hold pays one stake.</li>
                <li>Miss a goal and the run ends. The stake is lost.</li>
            </ol>
            <div class="grid">
                <div v-for="r in rows" :key="r.kind" class="cell">
                    <img :src="art.icons[r.kind]" alt="">
                    <div>
                        <div class="n">
                            {{ GM_ITEMS[r.kind].label }}
                        </div>
                        <div class="v">
                            <template v-if="r.kind === 'bag'">
                                ?
                            </template>
                            <template v-else>
                                ${{ GM_ITEMS[r.kind].value }}
                            </template>
                            <span v-if="r.note" class="note">· {{ r.note }}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.wrap {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(10, 4, 0, 0.7);
    z-index: 50;
    padding: 16px;
    overflow-y: auto;
}
.card {
    position: relative;
    width: min(720px, 100%);
    padding: 20px 24px;
    max-height: 100%;
    overflow-y: auto;
}
.x {
    position: absolute;
    top: 10px;
    right: 12px;
    font-size: 22px;
}
.title {
    font-size: 32px;
    color: #8a3a10;
}
.steps {
    margin: 8px 0 14px;
    padding-left: 20px;
    display: grid;
    gap: 4px;
    font-weight: 600;
    list-style: decimal;
}
.grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 8px;
}
.cell {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 10px;
    background: rgba(120, 70, 20, 0.1);
}
.cell img {
    width: 44px;
    height: 44px;
    object-fit: contain;
}
.n {
    font-weight: 900;
}
.v {
    font-weight: 700;
    font-size: 13px;
}
.note {
    opacity: 0.7;
}
</style>
