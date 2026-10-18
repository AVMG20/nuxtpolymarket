<template>
    <div class="df-theme df-hud-preview fixed inset-0 z-[300] overflow-hidden select-none">
        <div class="scene" aria-hidden="true" />
        <DfHud :hud="hud" />
        <div class="bar">
            <button v-for="m in MODES" :key="m" type="button" :class="{ on: mode === m }" @click="mode = m">{{ m }}</button>
        </div>
    </div>
</template>

<script setup lang="ts">
// Development-only HUD harness (`/dead-front?hud`): drives DfHud with mock
// state so the hard-to-reach states (downed, revive, power-ups, the feed,
// the scoreboard, hold prompts) can be checked without a match.
import type { DfPerkId } from '#shared/utils/dead-front/types'
import { DF_PERKS } from '#shared/utils/dead-front/perks'
import { dfCreateHudState, dfHudFeedLine, dfHudPushFeed } from '~/utils/dead-front/engine/hud'
import type { DfHudFeedContext } from '~/utils/dead-front/engine/hud'
import DfHud from './DfHud.vue'

const MODES = ['play', 'down', 'dead', 'board', 'round'] as const
type Mode = typeof MODES[number]
const route = useRoute()
const mode = ref<Mode>((MODES as readonly string[]).includes(String(route.query.hud)) ? route.query.hud as Mode : 'play')

const hud = reactive(dfCreateHudState())
const COLORS = ['#e2b24f', '#6fa8dc', '#8ab052', '#d0605e']
const NAMES = ['AVMG', 'Pvt. Hale', 'Cpl. Moreau', 'Sgt. Brandt']

function setup() {
    hud.started = true
    hud.locked = true
    hud.round = 7
    hud.roundKey = 1
    hud.phase = 'active'
    hud.zombiesLeft = 18
    hud.players = NAMES.map((name, pid) => ({
        pid, name, color: COLORS[pid]!, me: pid === 0, points: [4210, 2890, 1560, 980][pid]!, kills: [41, 28, 17, 9][pid]!,
        headshots: [12, 6, 3, 1][pid]!, downs: [0, 1, 2, 0][pid]!, revives: [2, 1, 0, 0][pid]!,
        life: pid === 2 ? 'down' : 'alive', connected: pid !== 3, ping: [24, 61, 180, null][pid]!
    }))
    hud.ammo = { weapon: 'thompson', name: 'M1921 Thompson', mag: 22, magSize: 30, reserve: 210, pap: 0, reloading: false, infinite: false }
    hud.grenades = 3
    hud.perks = (['ironhide', 'quickhand', 'twinfire', 'secondwind'] as DfPerkId[]).map(id => ({ id, name: DF_PERKS[id].name, color: DF_PERKS[id].color }))
    hud.powerups = [
        { kind: 'double', name: 'Double Points', seconds: 21, ending: false },
        { kind: 'insta', name: 'Insta-Kill', seconds: 4, ending: true }
    ]
    hud.objective = { visible: true, step: 'fuses', text: 'Recover the Tesla fuses', fuses: '1/3', charge: null, label: 'Tesla fuse', distance: 23, hasTarget: true }
    hud.ping = 24
    hud.chat = [{ id: 1, name: 'Pvt. Hale', text: 'door by the chapel, need 750', born: 0 }]
}

const feedCtx: DfHudFeedContext = {
    me: 0,
    name: pid => NAMES[pid] ?? '?',
    color: pid => COLORS[pid] ?? '#fff',
    doorLabel: () => 'Chapel Nave',
    weaponName: () => 'Kar98k',
    powerupName: () => 'Max Ammo'
}

let t = 0
let timer: ReturnType<typeof setInterval> | null = null
let popId = 0

function tick() {
    t += 0.1
    const m = mode.value
    hud.life = m === 'down' ? 'down' : m === 'dead' ? 'dead' : 'alive'
    hud.scoreboard = m === 'board'
    hud.bleedoutMax = 30
    hud.bleedout = 30 - ((t * 3) % 30)
    hud.beingRevived = m === 'down' && (t % 8) > 4 ? ((t % 8) - 4) / 4 : 0
    hud.spectating = m === 'dead' ? 'Pvt. Hale' : null
    // the prompt cycles between a buy, a broke buy and a hold
    const phase = Math.floor(t / 3) % 3
    hud.prompt = m === 'play'
        ? phase === 0
            ? { text: 'Hold F to buy M1897 Trench Gun', sub: '', cost: 1200, ok: true, denyKey: 0, hold: 0 }
            : phase === 1
                ? { text: 'Hold F to open the Chapel Nave', sub: 'Not enough points', cost: 1250, ok: false, denyKey: 0, hold: 0 }
                : { text: 'Hold F to revive Cpl. Moreau', sub: '', cost: null, ok: true, denyKey: 0, hold: (t % 3) / 3 }
        : null
    hud.stamina = 0.5 + Math.sin(t) * 0.5
    hud.objective.charge = null
    for (const p of hud.powerups) {
        p.seconds = Math.max(0.5, p.seconds - 0.1)
        if (p.seconds <= 0.6) p.seconds = 30
        p.ending = p.seconds < 5
    }
    hud.ammo.mag = 30 - Math.floor((t * 4) % 31)
    hud.lowAmmo = hud.ammo.mag <= 7
    // hits, kills and points
    if (Math.round(t * 10) % 7 === 0) {
        const kill = Math.round(t * 10) % 21 === 0
        hud.hitmarker = { key: hud.hitmarker.key + 1, kind: kill ? (Math.round(t) % 2 ? 'head' : 'kill') : 'hit' }
        if (kill) hud.killKey++
        hud.popups.push({ id: ++popId, pid: 0, amount: kill ? 100 : 10, gold: false, dx: Math.random() * 2 - 1, born: t })
        hud.players[0]!.points += kill ? 100 : 10
    }
    if (Math.round(t * 10) % 25 === 0) hud.popups.push({ id: ++popId, pid: 1, amount: 60, gold: false, dx: Math.random() * 2 - 1, born: t })
    while (hud.popups.length && t - hud.popups[0]!.born > 1.3) hud.popups.shift()
    if (Math.round(t * 10) % 18 === 0) hud.damage.push({ id: ++popId, angle: Math.random() * Math.PI * 2, born: t })
    while (hud.damage.length && t - hud.damage[0]!.born > 1.6) hud.damage.shift()
    // feed
    if (Math.round(t * 10) % 22 === 0) {
        const evs = [
            { k: 'down', p: 2 }, { k: 'revived', p: 2, by: 1 }, { k: 'buy', p: 1, what: 'door:nave' },
            { k: 'power' }, { k: 'powerup', p: 0, kind: 'maxammo' }, { k: 'bleedout', p: 3 }
        ] as const
        const line = dfHudFeedLine(evs[Math.floor(t / 2.2) % evs.length]!, feedCtx)
        if (line) dfHudPushFeed(hud.feed, line, performance.now())
    }
}

watch(mode, (m) => {
    if (m === 'round') {
        hud.round++
        hud.roundKey++
        hud.announce = { key: (hud.announce?.key ?? 0) + 1, title: `Round ${hud.round}`, sub: 'They are coming through the wire', tone: 'red' }
    }
})

onMounted(() => {
    setup()
    hud.announce = { key: 1, title: 'Round 7', sub: 'Hold the line', tone: 'red' }
    timer = setInterval(tick, 100)
})

onBeforeUnmount(() => {
    if (timer) clearInterval(timer)
})
</script>

<style scoped>
.scene {
    position: absolute;
    inset: 0;
    background:
        linear-gradient(180deg, transparent 55%, rgba(0, 0, 0, 0.5)),
        repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.03) 0 24px, transparent 24px 48px),
        linear-gradient(180deg, #1b2236 0%, #2a2c3a 45%, #3a3226 46%, #2b241b 100%);
}

.bar {
    position: absolute;
    left: 50%;
    top: 8px;
    z-index: 5;
    display: flex;
    gap: 4px;
    transform: translateX(-50%);
}

.bar button {
    padding: 2px 8px;
    font: 12px monospace;
    color: #fff;
    background: #000a;
    cursor: pointer;
}

.bar button.on {
    background: #b3271b;
}
</style>
