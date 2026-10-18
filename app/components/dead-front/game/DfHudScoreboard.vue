<template>
    <div class="df-ledger">
        <div class="head">
            <div>
                <p class="eyebrow">Company ledger · Sainte-Croix</p>
                <p class="round">Round {{ round }}</p>
            </div>
            <span class="zl">
                <template v-if="phase === 'intermission'">Between waves</template>
                <template v-else><b>{{ zombiesLeft }}</b> still walking</template>
            </span>
        </div>
        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th class="l">Soldier</th>
                        <th>Points</th>
                        <th>Kills</th>
                        <th>Heads</th>
                        <th>Downs</th>
                        <th>Revives</th>
                        <th>Ping</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(p, i) in sorted" :key="p.pid" :class="{ me: p.me, out: p.life === 'dead' || !p.connected }" :style="{ '--c': p.color }">
                        <td class="l">
                            <span class="who">
                                <span class="rank">{{ i + 1 }}</span>
                            <span class="chip" />
                            <span class="nm">{{ p.name }}</span>
                            <span v-if="p.life === 'down'" class="tag red">Down</span>
                            <span v-else-if="p.life === 'dead'" class="tag">Fallen</span>
                            <span v-else-if="!p.connected" class="tag">Away</span>
                            </span>
                        </td>
                        <td class="pts">{{ p.points.toLocaleString('en-US') }}</td>
                        <td>{{ p.kills }}</td>
                        <td>{{ p.headshots }}</td>
                        <td>{{ p.downs }}</td>
                        <td>{{ p.revives }}</td>
                        <td :class="{ bad: (p.ping ?? 0) > 150 }">{{ p.ping ?? '—' }}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>

<script setup lang="ts">
// Tab scoreboard: the company ledger in a block frame, sorted by points.
import type { DfHudPlayer } from '~/utils/dead-front/engine/hud'

const props = defineProps<{ players: DfHudPlayer[], round: number, zombiesLeft: number, phase: 'intermission' | 'active' }>()
const sorted = computed(() => [...props.players].sort((a, b) => b.points - a.points))
</script>

<style scoped>
.df-ledger {
    width: min(42rem, 94vw);
    background: rgba(9, 11, 13, 0.9);
    box-shadow: 0 -3px 0 #000, 0 3px 0 #000, -3px 0 0 #000, 3px 0 0 #000, 0 12px 0 rgba(0, 0, 0, 0.4);
}

.head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.7rem 1rem 0.6rem;
    color: #1f170e;
    background: var(--df-fibre), linear-gradient(180deg, #e6d8b4, #d6c49a);
    box-shadow: inset 0 -4px 0 rgba(90, 64, 26, 0.4);
}

.eyebrow {
    font-family: var(--df-font-type);
    font-size: 0.62rem;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: #6f5c42;
}

.round {
    font-family: var(--df-font-stencil);
    font-size: 1.6rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    line-height: 1.1;
}

.zl {
    font-family: var(--df-font-type);
    font-size: 0.82rem;
    color: #8e1d13;
}

.zl b {
    font-family: var(--df-font-stencil);
    font-weight: 400;
    font-size: 1.05rem;
}

.table-wrap {
    padding: 0.4rem 0.6rem 0.7rem;
    overflow-x: auto;
}

table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--df-font-stencil);
    font-size: 1rem;
    font-variant-numeric: tabular-nums;
    color: #f1e8cf;
}

th {
    padding: 0.35rem 0.5rem;
    font-family: var(--df-font-type);
    font-size: 0.62rem;
    font-weight: 400;
    letter-spacing: 0.18em;
    text-align: right;
    text-transform: uppercase;
    color: #8f866c;
}

td {
    height: 36px;
    padding: 0 0.5rem;
    text-align: right;
    white-space: nowrap;
    border-top: 2px solid rgba(255, 255, 255, 0.05);
}

.l {
    text-align: left;
}

.who {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.nm {
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: 0.06em;
}

.pts {
    color: #ffd978;
}

tr.me td {
    background: rgba(226, 178, 79, 0.14);
}

tr.out td {
    opacity: 0.45;
}

.rank {
    width: 1.1rem;
    color: #8f866c;
}

.chip {
    width: 10px;
    height: 10px;
    background: var(--c);
    box-shadow: 0 0 0 2px #000;
}

.tag {
    padding: 0.1rem 0.35rem 0.05rem;
    font-size: 0.62rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #1f170e;
    background: #c4b898;
}

.tag.red {
    color: #fff2dc;
    background: #b3271b;
}

.bad {
    color: #ff7a5c;
}
</style>
