<template>
    <div class="df-hud pointer-events-none absolute inset-0" :class="{ off: !hud.started }">
        <!-- a telescopic sight: black around the eyepiece, a Zeiss post reticle over the world (the engine sets the vars) -->
        <div class="df-scope absolute inset-0" aria-hidden="true">
            <div class="lens">
                <svg class="reticle" viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet">
                    <rect x="-100" y="-2.2" width="86" height="4.4" />
                    <rect x="14" y="-2.2" width="86" height="4.4" />
                    <path d="M-2.6 100V9l2.6-7 2.6 7v91z" />
                    <rect x="-0.4" y="-100" width="0.8" height="86" />
                </svg>
            </div>
        </div>
        <!-- top-left: the objective + waypoint -->
        <div class="df-corner-tl absolute">
            <DfHudObjective :objective="hud.objective" />
            <DfHudChallenge v-if="hud.arsenal.challenge" :c="hud.arsenal.challenge" />
        </div>

        <!-- top-centre: the line -->
        <Transition name="df-drop">
            <div v-if="hud.connection !== 'ok'" class="df-banner absolute top-4 left-1/2">
                <span class="dot" />
                {{ hud.connection === 'lost' ? 'Line cut · waiting for the server' : 'Reconnecting' }}
            </div>
        </Transition>

        <!-- top-right: ping over the squad feed -->
        <div class="df-corner-tr absolute flex flex-col items-end gap-2">
            <div class="df-ping" :class="{ bad: hud.ping > 150 }">{{ hud.ping }} ms</div>
            <DfHudFeed :feed="hud.feed" />
        </div>

        <!-- round and event banners -->
        <div class="df-announce-wrap absolute inset-x-0 flex justify-center px-4">
            <div v-if="hud.announce && !shopOpen" :key="hud.announce.key" class="df-announce" :class="[hud.announce.tone, { round: isRoundBanner }]">
                <div class="title">{{ hud.announce.title }}</div>
                <div class="rule" aria-hidden="true"><i v-for="n in 9" :key="n" :style="{ animationDelay: `${120 + Math.abs(n - 5) * 40}ms` }" /></div>
                <div v-if="hud.announce.sub" class="sub">{{ hud.announce.sub }}</div>
            </div>
        </div>

        <!-- crosshair, hitmarker, kill pip, damage direction -->
        <div class="df-center">
            <div v-if="hud.life !== 'dead' && !shopOpen" class="df-xhair" :class="{ ads: hud.ads }">
                <i class="t" /><i class="b" /><i class="l" /><i class="r" />
                <b class="dot" />
            </div>
            <div v-if="hud.hitmarker.key > 0 && !shopOpen" :key="hud.hitmarker.key" class="df-hit" :class="hud.hitmarker.kind">
                <i /><i /><i /><i />
            </div>
            <Transition name="df-fade">
                <div v-if="hud.ammoHint && hud.life !== 'dead' && !shopOpen" :key="hud.ammoHint" class="df-ammo-hint" :class="{ out: /no ammo/i.test(hud.ammoHint) }">{{ hud.ammoHint }}</div>
            </Transition>
            <div v-if="hud.killKey > 0 && !shopOpen" :key="`k${hud.killKey}`" class="df-kill" :class="{ head: hud.hitmarker.kind === 'head' }">
                <svg viewBox="0 0 7 7" width="21" height="21" shape-rendering="crispEdges" aria-hidden="true">
                    <rect v-for="(r, i) in SKULL" :key="i" :x="r[0]" :y="r[1]" :width="r[2]" height="1" />
                </svg>
            </div>
            <div
                v-for="d in hud.damage"
                :key="d.id"
                class="df-dmg"
                :style="{ '--a': d.angle }"
            >
                <svg viewBox="0 0 160 24" width="160" height="24" shape-rendering="crispEdges" aria-hidden="true">
                    <path d="M44 0h72v8h20v8h16v8h-24v-8h-16v-8H52v8H36v8H12v-8h16V8h16z" />
                </svg>
            </div>
        </div>

        <!-- interaction prompt -->
        <div class="df-prompt-wrap absolute inset-x-0 flex justify-center px-4">
            <Transition name="df-plaque">
                <div v-if="hud.prompt && hud.life === 'alive'" class="df-prompt">
                    <div :key="hud.prompt.denyKey" class="plate" :class="{ deny: hud.prompt.denyKey > 0 }">
                        <span v-if="promptParts.verb" class="verb">{{ promptParts.verb }}</span>
                        <span v-if="promptParts.key" class="keycap" :class="{ holding: hud.prompt.hold > 0 }" :style="{ '--h': hud.prompt.hold }">
                            <b>{{ promptParts.key }}</b>
                        </span>
                        <span class="text" :style="hud.prompt.tint ? { color: hud.prompt.tint } : undefined">{{ promptParts.text }}</span>
                        <span v-if="hud.prompt.cost !== null" class="cost" :class="{ no: !hud.prompt.ok }">
                            {{ hud.prompt.cost.toLocaleString('en-US') }}
                        </span>
                        <span v-if="hud.prompt.hold > 0" class="hold df-seg" :style="{ '--p': hud.prompt.hold, '--c': '#ffd978' }" />
                    </div>
                    <div v-if="hud.prompt.sub" class="sub" :class="{ no: !hud.prompt.ok }">{{ hud.prompt.sub }}</div>
                </div>
            </Transition>
        </div>
        <!-- the workbench shop, centred while it is open -->
        <Transition name="df-fade">
            <div v-if="shopOpen && hud.arsenal.bench" class="df-bench-wrap absolute inset-0 flex items-center justify-center">
                <DfHudBench :bench="hud.arsenal.bench" :scrap="hud.arsenal.scrap" :deny-key="hud.arsenal.denyKey" />
            </div>
        </Transition>
        <!-- placing gear / calling in support, and short arsenal notices -->
        <Transition name="df-fade">
            <div v-if="hud.arsenal.targeting && hud.life === 'alive' && !shopOpen" :key="hud.arsenal.targeting" class="df-targeting absolute inset-x-0 text-center">{{ hud.arsenal.targeting }}</div>
        </Transition>
        <!-- points floating off the zombies we hit -->
        <DfHudHitPops v-if="hud.hitPops.length" :pops="hud.hitPops" />

        <!-- markers: the last zombies and downed teammates -->
        <DfHudMarkers v-if="hud.markers.length" :markers="hud.markers" />

        <!-- the last few zombies of a round -->
        <Transition name="df-drop">
            <div v-if="hud.lastZombies > 0" class="df-last absolute left-1/2">
                <svg v-for="n in hud.lastZombies" :key="n" viewBox="0 0 7 7" width="14" height="14" shape-rendering="crispEdges" aria-hidden="true">
                    <rect v-for="(r, i) in SKULL" :key="i" :x="r[0]" :y="r[1]" :width="r[2]" height="1" />
                </svg>
                <span>{{ hud.lastZombies === 1 ? 'Last one' : `Last ${hud.lastZombies}` }}</span>
            </div>
        </Transition>

        <!-- first-match coaching -->
        <div class="df-hint-wrap absolute inset-x-0 flex justify-center px-4">
            <Transition name="df-hint">
                <div v-if="hud.hint && hud.life === 'alive' && !shopOpen" :key="hud.hint.key" class="df-hint">
                    <div class="line">
                        <span v-if="hintParts.verb" class="verb">{{ hintParts.verb }}</span>
                        <span v-if="hintParts.key" class="keycap"><b>{{ hintParts.key }}</b></span>
                        <span class="text">{{ hintParts.text }}</span>
                    </div>
                    <div v-if="hud.hint.sub" class="sub">{{ hud.hint.sub }}</div>
                </div>
            </Transition>
        </div>

        <!-- reviving a teammate -->
        <div v-if="hud.reviving && hud.life === 'alive' && !hud.prompt" class="df-reviving absolute inset-x-0 flex flex-col items-center">
            <div class="label">Reviving <b>{{ hud.reviving.name }}</b></div>
            <div class="df-seg bar" :style="{ '--p': hud.reviving.progress, '--c': '#8ab052' }" />
        </div>

        <!-- downed: block timer ring -->
        <Transition name="df-fade">
            <div v-if="hud.life === 'down'" class="df-downed absolute inset-x-0 flex flex-col items-center" :class="{ reviving: hud.beingRevived > 0 }">
                <div class="dial">
                    <svg viewBox="-60 -60 120 120" width="116" height="116" aria-hidden="true">
                        <rect
                            v-for="n in RING"
                            :key="n"
                            x="-4"
                            y="-56"
                            width="8"
                            height="12"
                            class="seg"
                            :class="{ on: (n - 0.5) / RING <= bleedFrac }"
                            :transform="`rotate(${(n - 1) * (360 / RING)})`"
                        />
                        <rect
                            v-for="n in RING"
                            v-show="hud.beingRevived > 0"
                            :key="`r${n}`"
                            x="-3"
                            y="-40"
                            width="6"
                            height="7"
                            class="rev"
                            :class="{ on: (n - 0.5) / RING <= hud.beingRevived }"
                            :transform="`rotate(${(n - 1) * (360 / RING)})`"
                        />
                    </svg>
                    <span class="secs">{{ Math.max(0, Math.ceil(hud.bleedout)) }}</span>
                </div>
                <div class="title">{{ hud.beingRevived > 0 ? 'Being revived' : 'You are down' }}</div>
                <div class="sub">{{ hud.beingRevived > 0 ? 'Hold on' : hud.selfRevives > 0 ? 'Second Wind will pull you up' : 'Fight on with your pistol until a mate reaches you' }}</div>
            </div>
        </Transition>

        <!-- spectating -->
        <div v-if="hud.life === 'dead'" class="df-spectate absolute inset-x-0 text-center">
            <div class="title">You bled out</div>
            <div class="sub">{{ hud.spectating ? `Watching ${hud.spectating} · click to switch` : 'You return next round' }}</div>
        </div>

        <!-- power-ups -->
        <div class="df-pus absolute inset-x-0 flex justify-center gap-3">
            <TransitionGroup name="df-medal">
                <div v-for="p in hud.powerups" :key="p.kind" class="df-pu" :class="{ ending: p.ending }" :title="p.name">
                    <div class="tile">
                        <img :src="iconFor(p.kind)" alt="" width="40" height="40">
                    </div>
                    <div class="df-seg timer" :style="{ '--p': Math.min(1, p.seconds / DF_POWERUP_SECONDS), '--c': '#ffd978', '--seg': '5px' }" />
                    <span class="secs">{{ Math.ceil(p.seconds) }}</span>
                </div>
            </TransitionGroup>
        </div>

        <!-- bottom-left: perks over the round -->
        <div class="df-corner-bl absolute flex flex-col items-start gap-3">
            <DfHudArsenal v-if="hud.life !== 'dead'" :a="hud.arsenal" />
            <DfHudPerks :perks="hud.perks" :pulse="hud.perkPulse" />
            <DfHudRound :round="hud.round" :round-key="hud.roundKey" :phase="hud.phase" :phase-timer="hud.phaseTimer" />
        </div>

        <!-- bottom-right: squad points over the ammo counter -->
        <div class="df-corner-br absolute flex flex-col items-end gap-4">
            <DfHudPoints :players="hud.players" :popups="hud.popups" />
            <DfHudAmmo v-if="hud.life !== 'dead'" :ammo="hud.ammo" :grenades="hud.grenades" :low="hud.lowAmmo" :swap-key="hud.swapKey" />
        </div>

        <!-- chat -->
        <div class="df-chat absolute">
            <TransitionGroup name="df-tape">
                <div v-for="c in hud.chat" :key="c.id" class="msg"><b>{{ c.name }}</b> {{ c.text }}</div>
            </TransitionGroup>
        </div>

        <!-- stamina -->
        <div v-if="hud.stamina < 0.98 && hud.life === 'alive' && !shopOpen" class="df-stamina df-seg" :class="{ low: hud.stamina < 0.25 }" :style="{ '--p': Math.max(0, hud.stamina), '--c': hud.stamina < 0.25 ? '#e2412f' : '#f1e8cf', '--seg': '6px' }" />

        <!-- ledger -->
        <Transition name="df-ledger">
            <div v-if="hud.scoreboard" class="absolute inset-0 flex items-center justify-center p-4">
                <DfHudScoreboard :players="hud.players" :round="hud.round" :zombies-left="hud.zombiesLeft" :phase="hud.phase" />
            </div>
        </Transition>
    </div>
</template>

<script setup lang="ts">
// The in-game HUD: everything is fed by the engine through `hud`; per-frame
// values (crosshair spread, damage yaw, waypoint) come through CSS variables
// the engine sets on the game root. Styled like the voxel world: black block
// frames, flat colour, hard pixel outlines on text over the scene.
import { DF_POWERUP_SECONDS } from '#shared/utils/dead-front/constants'
import type { DfPowerupKind } from '#shared/utils/dead-front/constants'
import type { DfHudState } from '~/utils/dead-front/engine/hud'
import { dfDrawPowerupIcon } from '~/utils/dead-front/engine/powerups'
import DfHudAmmo from './DfHudAmmo.vue'
import DfHudArsenal from './DfHudArsenal.vue'
import DfHudBench from './DfHudBench.vue'
import DfHudChallenge from './DfHudChallenge.vue'
import DfHudFeed from './DfHudFeed.vue'
import DfHudHitPops from './DfHudHitPops.vue'
import DfHudMarkers from './DfHudMarkers.vue'
import DfHudObjective from './DfHudObjective.vue'
import DfHudPerks from './DfHudPerks.vue'
import DfHudPoints from './DfHudPoints.vue'
import DfHudRound from './DfHudRound.vue'
import DfHudScoreboard from './DfHudScoreboard.vue'

const props = defineProps<{ hud: DfHudState }>()

const RING = 24

// 7x7 pixel skull: [x, y, width] runs
const SKULL: [number, number, number][] = [
    [1, 0, 5], [0, 1, 7], [0, 2, 1], [3, 2, 1], [6, 2, 1], [0, 3, 1], [3, 3, 1], [6, 3, 1],
    [0, 4, 3], [4, 4, 3], [1, 5, 5], [1, 6, 1], [3, 6, 1], [5, 6, 1]
]

const bleedFrac = computed(() => Math.max(0, Math.min(1, props.hud.bleedout / Math.max(1, props.hud.bleedoutMax))))
const isRoundBanner = computed(() => /^Round \d+$/.test(props.hud.announce?.title ?? ''))

/** Splits "Hold F to buy …" into a verb, a keycap and the rest of the line. */
function keyParts(text: string): { verb: string, key: string, text: string } {
    const m = /^(Hold|Press)\s+([A-Z0-9])\s+(.*)$/.exec(text)
    if (!m) return { verb: '', key: '', text }
    return { verb: m[1]!, key: m[2]!, text: m[3]! }
}
const promptParts = computed(() => keyParts(props.hud.prompt?.text ?? ''))
// the workbench shop is its own panel: the crosshair, hit pips, banners and hints step aside while it is open
const shopOpen = computed(() => !!props.hud.arsenal.bench && props.hud.life === 'alive')
const hintParts = computed(() => keyParts(props.hud.hint?.text ?? ''))

const icons = new Map<DfPowerupKind, string>()
function iconFor(kind: DfPowerupKind): string {
    let url = icons.get(kind)
    if (url) return url
    const c = document.createElement('canvas')
    c.width = c.height = 96
    const g = c.getContext('2d')
    if (!g) return ''
    dfDrawPowerupIcon(g, kind, 96, '#ffd978', null)
    url = c.toDataURL()
    icons.set(kind, url)
    return url
}
</script>

<style scoped>
.df-hud {
    font-family: var(--df-font-stencil);
    color: var(--df-chalk);
    transition: opacity 0.6s;
    /* edge inset scales a little with the window */
    --edge: clamp(12px, 1.6vw, 28px);
}

.df-hud.off {
    opacity: 0;
}

.df-corner-tl {
    top: var(--edge);
    left: var(--edge);
}

.df-corner-tr {
    top: calc(var(--edge) - 6px);
    right: var(--edge);
}

.df-bench-wrap {
    z-index: 5;
    padding: var(--edge);
    pointer-events: none;
}

.df-targeting {
    top: calc(50% + 72px);
    font-family: var(--df-font-type);
    font-size: 0.85rem;
    letter-spacing: 0.06em;
    color: var(--df-chalk);
    text-shadow: 1px 1px 0 #000, -1px 1px 0 #000, 1px -1px 0 #000, -1px -1px 0 #000;
}

.df-corner-bl {
    bottom: var(--edge);
    left: var(--edge);
}

.df-corner-br {
    bottom: var(--edge);
    right: var(--edge);
}

/* connection banner */
.df-banner {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.4rem 0.9rem 0.35rem;
    transform: translateX(-50%);
    font-size: 0.85rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #1f170e;
    background: var(--df-paper);
    box-shadow: 0 -3px 0 #000, 0 3px 0 #000, -3px 0 0 #000, 3px 0 0 #000;
    white-space: nowrap;
}

.df-banner .dot {
    width: 8px;
    height: 8px;
    background: var(--df-blood-hi);
    animation: df-blink 0.9s steps(2) infinite;
}

/* centre stack */
.df-scope {
    --dark: var(--df-scope-dark, 0);
    --view: var(--df-scope-view, 0);
    opacity: var(--dark);
    background: radial-gradient(circle at 50% 50%, transparent 0 38.5vmin, #000 39vmin);
}

.df-scope .lens {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 78vmin;
    height: 78vmin;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    /* black until the picture opens, then only the lens edge stays dark */
    background: rgba(0, 0, 0, calc(1 - var(--view)));
    box-shadow: inset 0 0 5vmin 1.5vmin rgba(0, 0, 0, calc(0.85 * var(--view)));
}

.df-scope .reticle {
    width: 100%;
    height: 100%;
    opacity: var(--view);
    fill: #0b0b0b;
}

.df-center {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 0;
    height: 0;
}

.df-xhair {
    position: absolute;
    opacity: var(--df-xhair, 1);
    transition: opacity 0.08s;
}

.df-xhair i {
    position: absolute;
    background: #f6efdc;
    box-shadow: 0 0 0 1px #000;
}

.df-xhair .t,
.df-xhair .b {
    width: 2px;
    height: 9px;
    left: -1px;
}

.df-xhair .l,
.df-xhair .r {
    width: 9px;
    height: 2px;
    top: -1px;
}

.df-xhair .t { top: calc(-1 * var(--df-spread, 8px) - 9px); }
.df-xhair .b { top: var(--df-spread, 8px); }
.df-xhair .l { left: calc(-1 * var(--df-spread, 8px) - 9px); }
.df-xhair .r { left: var(--df-spread, 8px); }

.df-xhair .dot {
    position: absolute;
    left: -1px;
    top: -1px;
    width: 2px;
    height: 2px;
    background: #ffb45c;
    box-shadow: 0 0 0 1px #000;
}

/* hitmarker: four square ticks on the diagonals */
.df-hit {
    position: absolute;
    animation: df-hit 0.28s steps(4, end) forwards;
}

.df-hit i {
    position: absolute;
    width: 3px;
    height: 8px;
    left: -1.5px;
    top: -4px;
    background: #fff;
    box-shadow: 0 0 0 1px #000;
}

.df-hit i:nth-child(1) { transform: rotate(45deg) translateY(-11px); }
.df-hit i:nth-child(2) { transform: rotate(135deg) translateY(-11px); }
.df-hit i:nth-child(3) { transform: rotate(225deg) translateY(-11px); }
.df-hit i:nth-child(4) { transform: rotate(315deg) translateY(-11px); }

.df-hit.kill i,
.df-hit.head i {
    width: 4px;
    height: 12px;
    left: -2px;
    top: -6px;
    background: #ff3b24;
}

.df-hit.head i {
    background: #ffd23f;
}

.df-hit.kill,
.df-hit.head {
    animation-duration: 0.45s;
}

/* kill pip: a pixel skull that pops under the crosshair */
.df-kill {
    position: absolute;
    left: -10.5px;
    top: 22px;
    animation: df-kill 0.75s cubic-bezier(0.2, 1.5, 0.4, 1) forwards;
}

.df-kill svg {
    display: block;
    fill: #f6efdc;
    filter: drop-shadow(1px 0 0 #000) drop-shadow(-1px 0 0 #000) drop-shadow(0 1px 0 #000) drop-shadow(0 -1px 0 #000);
}

.df-kill.head svg {
    fill: #ffd23f;
}

/* damage direction: a stepped red arc around the centre */
.df-dmg {
    position: absolute;
    left: 0;
    top: 0;
    transform: rotate(calc((var(--df-yaw, 0) - var(--a)) * 1rad)) translate(-80px, -150px);
    transform-origin: 0 0;
    animation: df-dmg 1.5s ease-in forwards;
}

.df-dmg svg {
    display: block;
    fill: #e2271a;
    filter: drop-shadow(2px 0 0 #000) drop-shadow(-2px 0 0 #000) drop-shadow(0 2px 0 #000) drop-shadow(0 -2px 0 #000);
}

/* announcement */
.df-announce-wrap {
    top: 17%;
}

.df-announce {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    animation: df-announce 3.2s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
}

.df-announce .title {
    font-size: clamp(1.5rem, 3vw, 2.5rem);
    letter-spacing: 0.22em;
    padding-left: 0.22em;
    text-transform: uppercase;
    line-height: 1.05;
    text-shadow: var(--df-outline), 0 5px 0 rgba(0, 0, 0, 0.6);
}

.df-announce.round .title {
    font-size: clamp(2.4rem, 5.2vw, 4.4rem);
}

.df-announce .rule {
    display: flex;
    gap: 4px;
    margin-top: 0.45rem;
}

.df-announce .rule i {
    width: 14px;
    height: 5px;
    background: currentColor;
    box-shadow: 0 0 0 2px #000;
    opacity: 0;
    animation: df-block-in 0.2s steps(2, end) forwards;
}

.df-announce .sub {
    margin-top: 0.5rem;
    font-family: var(--df-font-type);
    font-size: 0.95rem;
    letter-spacing: 0.08em;
    color: #efe6cc;
    text-shadow: var(--df-outline);
}

.df-announce.gold {
    color: #ffd23f;
}

.df-announce.red {
    color: #ff3b24;
}

.df-announce.pale {
    color: #f1e8cf;
}

.df-announce.pale .title {
    font-size: clamp(1.1rem, 2vw, 1.6rem);
}

/* ammo hint under the crosshair */
.df-ammo-hint {
    position: absolute;
    left: 50%;
    top: 34px;
    transform: translateX(-50%);
    font-family: var(--df-font-stencil);
    font-size: 0.78rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    white-space: nowrap;
    color: #ffd978;
    text-shadow: var(--df-outline);
}

.df-ammo-hint.out {
    color: #ff6a50;
    animation: df-ammo-blink 0.8s steps(2, jump-none) infinite;
}

@keyframes df-ammo-blink {
    50% { opacity: 0.45; }
}

/* the last zombies */
.df-last {
    top: calc(var(--edge) + 2.6rem);
    display: flex;
    align-items: center;
    gap: 4px;
    transform: translateX(-50%);
    padding: 0.2rem 0.5rem;
    font-family: var(--df-font-stencil);
    font-size: 0.78rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: #f1e8cf;
    background: var(--df-hud-bg);
    box-shadow: 0 -2px 0 #000, 0 2px 0 #000, -2px 0 0 #000, 2px 0 0 #000;
}

.df-last svg {
    fill: #e2412f;
}

.df-last span {
    margin-left: 0.3rem;
}

/* first-match coaching: quiet, lower centre */
.df-hint-wrap {
    top: 73%;
}

.df-hint {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    opacity: 0.92;
}

.df-hint .line {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.25rem 0.6rem;
    background: rgba(8, 7, 6, 0.55);
}

.df-hint .keycap b {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding-bottom: 2px;
    font-size: 0.82rem;
    color: #1f170e;
    background: #efe3c2;
    box-shadow: inset 0 -3px 0 rgba(90, 64, 26, 0.55), 0 0 0 2px #000;
}

.df-hint .verb,
.df-hint .text {
    font-size: 0.82rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    text-shadow: var(--df-outline);
}

.df-hint .verb {
    color: #b9ad8c;
}

.df-hint .text {
    color: #efe6cf;
}

.df-hint .sub {
    margin-top: 0.3rem;
    font-family: var(--df-font-type);
    font-size: 0.78rem;
    color: #cfc5a8;
    text-shadow: var(--df-outline);
}

.df-hint-enter-active {
    transition: opacity 0.4s ease-out, transform 0.4s cubic-bezier(0.2, 1.2, 0.4, 1);
}

.df-hint-leave-active {
    transition: opacity 0.6s ease-in;
}

.df-hint-enter-from {
    opacity: 0;
    transform: translateY(8px);
}

.df-hint-leave-to {
    opacity: 0;
}

/* interaction prompt */
.df-prompt-wrap {
    top: 61%;
}

.df-prompt {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
}

.df-prompt .plate {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.4rem 0.75rem 0.45rem 0.55rem;
    background: var(--df-hud-bg);
    box-shadow: 0 -3px 0 #000, 0 3px 0 #000, -3px 0 0 #000, 3px 0 0 #000, inset 0 2px 0 rgba(255, 255, 255, 0.06);
}

.df-prompt .plate.deny {
    animation: df-shake 0.3s steps(6, end);
    box-shadow: 0 -3px 0 #8e130b, 0 3px 0 #8e130b, -3px 0 0 #8e130b, 3px 0 0 #8e130b;
}

.df-prompt .keycap {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
}

.df-prompt .keycap b {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding-bottom: 3px;
    font-size: 1rem;
    color: #1f170e;
    background: linear-gradient(0deg, #ffd978 0 calc(var(--h, 0) * 100%), #efe3c2 calc(var(--h, 0) * 100%));
    box-shadow: inset 0 -4px 0 rgba(90, 64, 26, 0.55), 0 0 0 2px #000;
}

.df-prompt .verb,
.df-prompt .text {
    font-size: 1rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
}

.df-prompt .verb {
    margin-left: 0.15rem;
    color: #b9ad8c;
}

.df-prompt .text {
    color: #f6efdc;
}

.df-prompt .cost {
    padding: 0.2rem 0.45rem 0.15rem;
    font-size: 1rem;
    letter-spacing: 0.06em;
    color: #261a05;
    background: #e2b24f;
    box-shadow: inset 0 2px 0 rgba(255, 250, 220, 0.6), inset 0 -3px 0 rgba(110, 70, 10, 0.5);
    font-variant-numeric: tabular-nums;
}

.df-prompt .cost.no {
    color: #fff2dc;
    background: #b3271b;
    box-shadow: inset 0 2px 0 rgba(255, 170, 140, 0.4), inset 0 -3px 0 rgba(60, 0, 0, 0.55);
}

.df-prompt .hold {
    position: absolute;
    left: 0;
    right: 0;
    bottom: -12px;
    height: 5px;
    --seg: 6px;
}

.df-prompt .sub {
    margin-top: 0.5rem;
    font-family: var(--df-font-type);
    font-size: 0.85rem;
    letter-spacing: 0.04em;
    color: #e2d8bc;
    text-shadow: var(--df-outline);
}

.df-prompt .sub.no {
    color: #ff8a70;
}

.df-plaque-enter-active {
    animation: df-plaque-in 0.22s cubic-bezier(0.2, 1.5, 0.4, 1);
}

.df-plaque-leave-active {
    transition: opacity 0.12s;
}

.df-plaque-leave-to {
    opacity: 0;
}

/* reviving */
.df-reviving {
    top: 66%;
}

.df-reviving .label {
    font-size: 0.9rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    text-shadow: var(--df-outline);
}

.df-reviving .label b {
    color: #b8e07a;
    font-weight: 400;
}

.df-reviving .bar {
    width: 12rem;
    height: 8px;
    margin-top: 0.5rem;
}

/* downed ring */
.df-downed {
    top: 22%;
}

.df-downed .dial {
    position: relative;
    animation: df-heart 1.1s steps(3, end) infinite;
}

.df-downed svg {
    display: block;
    filter: drop-shadow(2px 2px 0 rgba(0, 0, 0, 0.8));
}

.df-downed .seg {
    fill: rgba(30, 6, 4, 0.75);
    stroke: #000;
    stroke-width: 2;
}

.df-downed .seg.on {
    fill: #e2271a;
}

.df-downed .rev {
    fill: rgba(0, 0, 0, 0.5);
    stroke: #000;
    stroke-width: 1.5;
}

.df-downed .rev.on {
    fill: #b8e07a;
}

.df-downed .secs {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding-top: 0.2rem;
    font-size: 2.4rem;
    color: #fff;
    text-shadow: var(--df-outline);
    font-variant-numeric: tabular-nums;
}

.df-downed.reviving .dial {
    animation: none;
}

.df-downed .title,
.df-spectate .title {
    margin-top: 0.6rem;
    font-size: 1.7rem;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: #ff3b24;
    text-shadow: var(--df-outline), 0 5px 0 rgba(0, 0, 0, 0.6);
}

.df-downed.reviving .title {
    color: #b8e07a;
}

.df-downed .sub,
.df-spectate .sub {
    margin-top: 0.3rem;
    font-family: var(--df-font-type);
    font-size: 0.9rem;
    color: #efe6cc;
    text-shadow: var(--df-outline);
}

.df-spectate {
    bottom: 24%;
}

/* power-ups */
.df-pus {
    bottom: var(--edge);
}

.df-pu {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
}

.df-pu .tile {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 50px;
    height: 50px;
    background: rgba(40, 28, 6, 0.85);
    box-shadow: 0 -3px 0 #000, 0 3px 0 #000, -3px 0 0 #000, 3px 0 0 #000, inset 0 0 0 2px #e2b24f, inset 0 0 14px rgba(255, 200, 80, 0.45);
}

.df-pu .tile img {
    width: 38px;
    height: 38px;
    filter: drop-shadow(2px 2px 0 rgba(0, 0, 0, 0.8));
}

.df-pu .timer {
    width: 50px;
    height: 5px;
}

.df-pu .secs {
    margin-top: -2px;
    font-size: 0.85rem;
    color: #ffd978;
    text-shadow: var(--df-outline);
    font-variant-numeric: tabular-nums;
}

.df-pu.ending .tile {
    animation: df-blink 0.5s steps(2) infinite;
}

.df-medal-enter-active {
    animation: df-medal-in 0.45s cubic-bezier(0.2, 1.6, 0.4, 1);
}

.df-medal-leave-active {
    transition: opacity 0.25s, transform 0.25s steps(3);
}

.df-medal-leave-to {
    opacity: 0;
    transform: scale(0.5);
}

/* chat */
.df-chat {
    left: var(--edge);
    bottom: 38%;
    max-width: min(24rem, 60vw);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
}

.df-chat .msg {
    padding: 0.25rem 0.55rem;
    font-family: var(--df-font-type);
    font-size: 0.8rem;
    color: #f1e8cf;
    background: var(--df-hud-bg);
    box-shadow: 0 -2px 0 #000, 0 2px 0 #000, -2px 0 0 #000, 2px 0 0 #000;
}

.df-chat .msg b {
    font-family: var(--df-font-stencil);
    font-weight: 400;
    letter-spacing: 0.08em;
    color: #ffb45c;
    text-transform: uppercase;
}

.df-tape-enter-active {
    animation: df-tape-in 0.25s steps(4, end);
}

.df-tape-leave-active {
    transition: opacity 0.4s;
}

.df-tape-leave-to {
    opacity: 0;
}

/* stamina */
.df-stamina {
    position: absolute;
    left: 50%;
    bottom: calc(var(--edge) + 6.5rem);
    width: 8rem;
    height: 5px;
    transform: translateX(-50%);
}

.df-ping {
    font-family: var(--df-font-type);
    font-size: 0.68rem;
    color: rgba(241, 232, 207, 0.55);
    text-shadow: 1px 1px 0 #000;
    font-variant-numeric: tabular-nums;
}

.df-ping.bad {
    color: #ff7a5c;
}

.df-ledger-enter-active,
.df-ledger-leave-active {
    transition: opacity 0.12s, transform 0.16s steps(3);
}

.df-ledger-enter-from,
.df-ledger-leave-to {
    opacity: 0;
    transform: translateY(8px);
}

.df-drop-enter-active,
.df-drop-leave-active {
    transition: transform 0.25s steps(4), opacity 0.25s;
}

.df-drop-enter-from,
.df-drop-leave-to {
    opacity: 0;
    transform: translate(-50%, -12px);
}

.df-fade-enter-active,
.df-fade-leave-active {
    transition: opacity 0.3s;
}

.df-fade-enter-from,
.df-fade-leave-to {
    opacity: 0;
}

/* Small laptop windows: tighten the corners and lift the centre pieces. */
@media (max-height: 800px), (max-width: 1100px) {
    .df-corner-bl,
    .df-corner-br {
        transform: scale(0.85);
    }

    .df-corner-bl {
        transform-origin: bottom left;
    }

    .df-corner-br {
        transform-origin: bottom right;
    }

    .df-corner-tl {
        transform: scale(0.9);
        transform-origin: top left;
    }

    .df-announce-wrap {
        top: 14%;
    }

    .df-downed {
        top: 18%;
    }
}

@keyframes df-hit {
    0% { transform: scale(1.45); opacity: 1; }
    100% { transform: scale(1); opacity: 0; }
}

@keyframes df-kill {
    0% { transform: scale(2.2); opacity: 0; }
    15% { transform: scale(1); opacity: 1; }
    70% { transform: scale(1); opacity: 1; }
    100% { transform: translateY(6px); opacity: 0; }
}

@keyframes df-dmg {
    0%, 30% { opacity: 1; }
    100% { opacity: 0; }
}

@keyframes df-shake {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-6px); }
    40% { transform: translateX(6px); }
    60% { transform: translateX(-3px); }
    80% { transform: translateX(3px); }
}

@keyframes df-plaque-in {
    0% { opacity: 0; transform: translateY(6px) scale(0.92); }
    100% { opacity: 1; transform: none; }
}

@keyframes df-announce {
    0% { opacity: 0; transform: scale(1.35); }
    8% { opacity: 1; transform: scale(0.96); }
    14% { transform: none; }
    80% { opacity: 1; }
    100% { opacity: 0; transform: translateY(-8px); }
}

@keyframes df-block-in {
    0% { opacity: 0; transform: scaleY(0); }
    100% { opacity: 1; transform: none; }
}

@keyframes df-heart {
    0%, 100% { transform: scale(1); }
    15% { transform: scale(1.05); }
    30% { transform: scale(1); }
}

@keyframes df-medal-in {
    0% { opacity: 0; transform: translateY(20px) scale(0.5); }
    100% { opacity: 1; transform: none; }
}

@keyframes df-tape-in {
    0% { opacity: 0; transform: translateX(-16px); }
    100% { opacity: 1; transform: none; }
}

@keyframes df-blink {
    to { visibility: hidden; }
}
</style>
