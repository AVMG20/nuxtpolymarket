<script setup lang="ts">
import { GM_MAX_DYNAMITE, GM_SHOP_ITEMS, gmGoal, gmPayout, type GmShopItem } from '#shared/utils/gamelogic/gold-miner'

const { state, buy, nextLevel, cashOut } = useGoldMiner()
const art = inject<{ shopkeeper: string, icons: Record<string, string> }>('gold-miner-art')!

const run = computed(() => state.run)
const payout = computed(() => run.value ? gmPayout(run.value.stake, run.value.cash) : 0)
const nextGoal = computed(() => gmGoal((run.value?.level ?? 0) + 1))
const confirmCash = ref(false)

const lines = [
    'Fine wares for a fine prospector!',
    'Dynamite\'s fresh. Mostly.',
    'That clover? Picked it myself. Twice.',
    'Strong drink for strong arms, partner.',
    'Every diamond deserves a shine.'
]
const line = lines[Math.floor(Math.random() * lines.length)]

function canBuy(item: GmShopItem, price: number) {
    if (!run.value) return false
    if (run.value.bought.includes(item)) return false
    if (item === 'dynamite' && run.value.dynamite >= GM_MAX_DYNAMITE) return false
    return run.value.cash >= price
}

function owned(item: GmShopItem) {
    return !!run.value?.bought.includes(item)
}
</script>

<template>
    <div v-if="run" class="shop">
        <div class="panel frame">
            <div class="head">
                <img :src="art.shopkeeper" alt="The shopkeeper" class="keeper">
                <div class="bubble parchment">
                    <div class="display name">
                        The Trading Post
                    </div>
                    <div class="quote">
                        “{{ line }}”
                    </div>
                </div>
                <div class="wallet">
                    <div class="label">
                        Your cash
                    </div>
                    <div class="display gold-text cash">
                        ${{ run.cash.toLocaleString('en') }}
                    </div>
                    <div class="label dyn">
                        <img :src="art.icons.dynamite" alt="">×{{ run.dynamite }}
                    </div>
                </div>
            </div>

            <div class="shelf">
                <div v-for="o in run.offers" :key="o.item" class="parchment ware" :class="{ owned: owned(o.item) }">
                    <img :src="art.icons[o.item]" alt="" class="icon">
                    <div class="display wname">
                        {{ GM_SHOP_ITEMS[o.item].name }}
                    </div>
                    <div class="blurb">
                        {{ GM_SHOP_ITEMS[o.item].blurb }}
                    </div>
                    <button class="btn btn-gold buy" :disabled="!canBuy(o.item, o.price) || state.busy" @click="buy(o.item)">
                        <template v-if="owned(o.item)">
                            <UIcon name="i-lucide-check" /> Bought
                        </template>
                        <template v-else>
                            ${{ o.price.toLocaleString('en') }}
                        </template>
                    </button>
                </div>
            </div>

            <div class="foot">
                <div class="cashout">
                    <button v-if="!confirmCash" class="btn btn-wood" :disabled="state.busy" @click="confirmCash = true">
                        <UIcon name="i-lucide-coins" />
                        Cash out {{ formatNumber(payout) }}
                    </button>
                    <template v-else>
                        <span class="sure">End the run for <b>{{ formatNumber(payout) }}</b> coins?</span>
                        <button class="btn btn-gold small" :disabled="state.busy" @click="cashOut">
                            Cash out
                        </button>
                        <button class="btn btn-wood small" @click="confirmCash = false">
                            Keep digging
                        </button>
                    </template>
                </div>
                <div class="mystery">
                    <UIcon name="i-lucide-circle-help" />
                    The next vein is a mystery
                </div>
                <button class="btn btn-green next" :disabled="state.busy" @click="nextLevel">
                    Level {{ run.level + 1 }} · goal ${{ nextGoal.toLocaleString('en') }}
                    <UIcon name="i-lucide-pickaxe" />
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.shop {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 14px;
    background: rgba(20, 8, 0, 0.6);
    z-index: 20;
    overflow-y: auto;
}
.frame {
    width: min(980px, 100%);
    padding: 16px 18px 18px;
    display: grid;
    gap: 14px;
    animation: gm-in 0.45s cubic-bezier(0.2, 1.4, 0.4, 1);
}
@keyframes gm-in {
    from {
        transform: translateY(30px) scale(0.95);
        opacity: 0;
    }
}
.head {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 14px;
}
.keeper {
    width: 110px;
    height: 110px;
    border-radius: 50%;
    background: radial-gradient(circle at 50% 40%, #ffe6a8, #b87a3a);
    border: 3px solid #1e0f04;
    box-shadow: 0 6px 14px rgba(0, 0, 0, 0.4);
    animation: gm-nod 3s ease-in-out infinite;
}
@keyframes gm-nod {
    50% {
        transform: rotate(-3deg) translateY(-2px);
    }
}
.bubble {
    padding: 10px 16px;
    position: relative;
}
.name {
    font-size: 26px;
    color: #8a3a10;
}
.quote {
    font-weight: 700;
    font-style: italic;
}
.wallet {
    text-align: right;
}
.cash {
    font-size: 34px;
    line-height: 1;
}
.dyn {
    display: inline-flex;
    align-items: center;
    gap: 2px;
}
.dyn img {
    width: 22px;
    height: 22px;
}
.shelf {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
}
.ware {
    display: grid;
    justify-items: center;
    align-content: start;
    gap: 4px;
    padding: 12px 10px;
    text-align: center;
    transition: transform 0.15s;
}
.ware:hover {
    transform: translateY(-3px);
}
.ware.owned {
    opacity: 0.7;
}
.icon {
    width: 72px;
    height: 72px;
    filter: drop-shadow(0 4px 4px rgba(0, 0, 0, 0.3));
}
.wname {
    font-size: 19px;
    color: #5a2a08;
}
.blurb {
    font-size: 12.5px;
    font-weight: 700;
    min-height: 3.2em;
    opacity: 0.8;
}
.buy {
    margin-top: 4px;
    font-size: 18px;
    padding: 8px 16px;
    width: 100%;
}
.foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
}
.cashout {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}
.sure {
    font-weight: 800;
    color: #ffe6b8;
}
.small {
    font-size: 16px;
    padding: 8px 14px;
}
.next {
    font-size: 22px;
}
.mystery {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    font-weight: 800;
    font-size: 13px;
    color: rgba(255, 230, 184, 0.75);
}
@container gm (max-width: 700px) {
    .keeper {
        width: 64px;
        height: 64px;
    }
    .head {
        grid-template-columns: auto 1fr;
    }
    .wallet {
        grid-column: 1 / -1;
        text-align: left;
    }
    .blurb {
        display: none;
    }
}
</style>
