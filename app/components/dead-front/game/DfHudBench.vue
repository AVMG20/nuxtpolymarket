<template>
    <div class="df-shop" aria-live="polite">
        <header class="head">
            <div>
                <p class="eyebrow">Field workshop</p>
                <h2 class="title">Workbench</h2>
            </div>
            <div class="purse">
                <span class="coin" title="Scrap"><DfBenchIcon name="scrap" :size="18" /><b>{{ scrap }}</b> scrap</span>
            </div>
        </header>

        <ul class="cards">
            <li
                v-for="it in bench.items"
                :key="it.key"
                class="card"
                :class="{ sel: it.selected, no: !it.ok }"
                :style="{ '--df-icon-a': it.color }"
            >
                <div class="art">
                    <DfWeaponSilhouette v-if="it.weapon" :weapon="it.weapon.id" :width="104" tone="color" />
                    <DfBenchIcon v-else :name="it.key" :size="58" />
                    <DfBenchIcon v-if="it.weapon" name="upgrade" :size="26" class="badge" :style="{ color: it.color }" />
                </div>
                <div class="name" :style="it.tint ? { color: it.tint } : undefined">{{ it.key === 'upgrade' ? upgradeLabel(it) : it.name }}</div>
                <div v-if="it.scrap" class="price">
                    <span :class="{ short: it.shortScrap }"><DfBenchIcon name="scrap" :size="13" />{{ it.scrap }}</span>
                </div>
                <div v-else class="price muted">—</div>
                <div v-if="!it.ok && !it.shortScrap" class="tag">{{ tagFor(it) }}</div>
            </li>
        </ul>

        <section v-if="sel" :key="denyKey" class="detail" :class="{ no: !sel.ok, deny: denyKey > 0 }" :style="{ '--df-icon-a': sel.color }">
            <div class="detail-art">
                <DfWeaponSilhouette v-if="sel.weapon" :weapon="sel.weapon.id" :width="150" tone="color" />
                <DfBenchIcon v-else :name="sel.key" :size="88" />
            </div>
            <div class="info">
                <h3 :style="sel.tint ? { color: sel.tint } : undefined">{{ sel.name }}</h3>
                <p class="desc">{{ sel.desc }}</p>
                <p class="state">
                    <template v-if="sel.ok">{{ sel.cost ? `Costs ${sel.cost}` : 'Free' }}</template>
                    <template v-else>{{ sel.why }}</template>
                </p>
            </div>
            <div class="craft" :class="{ no: !sel.ok, holding: bench.hold > 0 }" :style="{ '--h': bench.hold }">
                <span class="fill" />
                <span class="keycap"><b>F</b></span>
                <span class="label">{{ sel.ok ? (sel.key === 'upgrade' ? 'Hold to upgrade' : 'Hold to craft') : 'Can\'t craft' }}</span>
            </div>
        </section>

        <footer class="keys">
            <span><i>Wheel</i><i>WASD</i><i>← ↑ ↓ →</i> pick</span>
            <span><i>F</i><i>LMB</i> hold to craft</span>
            <span><i>Esc</i><i>RMB</i> close</span>
        </footer>
    </div>
</template>

<script setup lang="ts">
// The workbench shop, centred while it is open: a card per recipe and the
// rarity upgrade of the weapon in hand, each with its icon and price (short
// costs in red), the selected one spelled out underneath with the hold-to-craft
// button. The engine picks and crafts (arsenal.ts); this only draws.
import type { DfHudArsenal, DfHudBenchItem } from '~/utils/dead-front/engine/arsenal-prompt'
import DfBenchIcon from '../ui/DfBenchIcon.vue'
import DfWeaponSilhouette from '../ui/DfWeaponSilhouette.vue'

const props = defineProps<{ bench: NonNullable<DfHudArsenal['bench']>, scrap: number, denyKey: number }>()

const sel = computed(() => props.bench.items.find(i => i.selected) ?? null)

function upgradeLabel(it: DfHudBenchItem): string {
    const to = it.name.split('→')[1]?.trim()
    return to ? `Upgrade → ${to}` : 'Upgrade weapon'
}

function tagFor(it: DfHudBenchItem): string {
    if (it.why.startsWith('Place your gear')) return 'Hands full'
    if (it.why.startsWith('Call in your support')) return 'Support full'
    if (it.why.startsWith('Already carrying')) return 'Carrying one'
    if (it.why.startsWith('Already Legendary')) return 'Maxed'
    return 'Unavailable'
}
</script>

<style scoped>
.df-shop {
    width: min(52rem, 94vw);
    padding: 16px 18px 12px;
    font-family: var(--df-font-type);
    color: var(--df-chalk);
    background:
        var(--df-grain),
        linear-gradient(180deg, rgba(30, 34, 37, 0.96), rgba(14, 16, 18, 0.96));
    box-shadow: 0 0 0 2px #000, inset 0 0 0 2px #4a3c26, 0 24px 60px rgba(0, 0, 0, 0.55);
}

.head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    padding-bottom: 10px;
    border-bottom: 2px solid #000;
    box-shadow: 0 1px 0 #4a3c26;
}

.eyebrow {
    font-size: 0.7rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: var(--df-chalk-3);
}

.title {
    font-family: var(--df-font-stencil);
    font-size: 2rem;
    line-height: 1;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--df-brass-hi);
    text-shadow: var(--df-outline);
}

.purse {
    display: flex;
    gap: 10px;
}

.coin {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 5px 10px;
    font-size: 0.85rem;
    color: var(--df-chalk-2);
    background: rgba(0, 0, 0, 0.4);
    box-shadow: inset 0 0 0 1px #3a3024;
}

.coin :deep(svg) {
    color: #c08a4a;
}

.coin b {
    font-family: var(--df-font-stencil);
    font-size: 1.25rem;
    color: var(--df-chalk);
}

.cards {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    margin-top: 14px;
}

.card {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 12px 8px 10px;
    color: var(--df-chalk);
    background: rgba(0, 0, 0, 0.35);
    box-shadow: inset 0 0 0 2px #2c2a25;
    transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.12s ease;
}

.card .art {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 64px;
    color: var(--df-chalk);
}

.card .badge {
    position: absolute;
    right: -6px;
    bottom: -4px;
}

.card .name {
    max-width: 100%;
    overflow: hidden;
    font-family: var(--df-font-stencil);
    font-size: 0.95rem;
    letter-spacing: 0.04em;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.price {
    display: flex;
    gap: 10px;
    font-size: 0.85rem;
    color: var(--df-chalk-2);
}

.price span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}

.price span :deep(svg) {
    color: #c08a4a;
}

.price .short {
    color: #ff7a62;
}

.price.muted {
    color: var(--df-chalk-3);
}

.tag {
    position: absolute;
    top: 6px;
    right: 6px;
    padding: 1px 5px;
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--df-chalk-2);
    background: rgba(0, 0, 0, 0.6);
    box-shadow: inset 0 0 0 1px #3a3024;
}

.card.no .art {
    opacity: 0.45;
    filter: saturate(0.4);
}

.card.no .name {
    color: var(--df-chalk-3);
}

.card.sel {
    background: color-mix(in srgb, var(--df-icon-a) 16%, rgba(0, 0, 0, 0.4));
    box-shadow: inset 0 0 0 2px var(--df-icon-a), 0 0 22px color-mix(in srgb, var(--df-icon-a) 35%, transparent);
    transform: translateY(-2px);
}

.card.sel.no {
    box-shadow: inset 0 0 0 2px var(--df-blood-hi), 0 0 18px rgba(226, 65, 47, 0.25);
}

.card.sel .art {
    opacity: 1;
    filter: none;
}

.detail {
    display: grid;
    grid-template-columns: 9.5rem 1fr 13rem;
    align-items: center;
    gap: 16px;
    margin-top: 14px;
    padding: 12px 14px;
    background: rgba(0, 0, 0, 0.4);
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--df-icon-a) 55%, #2c2a25);
}

.detail.no {
    box-shadow: inset 0 0 0 2px #5a2018;
}

.detail.deny {
    animation: df-shop-shake 0.3s ease;
}

.detail-art {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 88px;
    overflow: hidden;
    color: var(--df-chalk);
}

/* every line keeps its height, so switching cards never resizes the panel */
.info {
    min-width: 0;
}

.info h3,
.info .state {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.info h3 {
    font-family: var(--df-font-stencil);
    font-size: 1.35rem;
    letter-spacing: 0.04em;
    line-height: 1.1;
}

.info .desc {
    display: -webkit-box;
    height: 2.7em;
    margin-top: 4px;
    overflow: hidden;
    font-size: 0.85rem;
    line-height: 1.35;
    color: var(--df-chalk-2);
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
}

.info .state {
    margin-top: 6px;
    font-size: 0.85rem;
    color: var(--df-moss);
}

.detail.no .state {
    color: #ff7a62;
}

.craft {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    height: 52px;
    overflow: hidden;
    font-family: var(--df-font-stencil);
    font-size: 1.05rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #1d1508;
    background: var(--df-brass);
    box-shadow: inset 0 0 0 2px #000, inset 0 -4px 0 rgba(0, 0, 0, 0.25);
}

.craft .fill {
    position: absolute;
    inset: 0 auto 0 0;
    width: calc(var(--h, 0) * 100%);
    background: rgba(255, 248, 220, 0.6);
}

.craft .keycap,
.craft .label {
    position: relative;
}

.craft .keycap {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    font-family: var(--df-font-type);
    color: var(--df-chalk);
    background: #1a1612;
    box-shadow: inset 0 0 0 2px #000, inset 0 -3px 0 #000;
}

.craft.no {
    color: var(--df-chalk-3);
    background: #2a2622;
}

.keys {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px 22px;
    margin-top: 12px;
    font-size: 0.72rem;
    letter-spacing: 0.06em;
    color: var(--df-chalk-3);
}

.keys span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
}

.keys i {
    padding: 1px 6px;
    font-style: normal;
    color: var(--df-chalk);
    background: #1a1612;
    box-shadow: inset 0 0 0 1px #000, inset 0 -2px 0 #000;
}

@keyframes df-shop-shake {
    20% { transform: translateX(-6px); }
    40% { transform: translateX(5px); }
    60% { transform: translateX(-3px); }
    80% { transform: translateX(2px); }
}
</style>
