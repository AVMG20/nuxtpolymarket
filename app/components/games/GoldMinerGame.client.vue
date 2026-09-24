<script setup lang="ts">
// Gold Miner: swing the claw, reel in gold before the clock runs out, clear
// the goal, shop, and decide when to cash out. The run lives on the server
// (server/utils/gold-miner.ts); the Pixi scene (~/utils/gold-miner) is the
// winch, the dirt and everything in it. Every model is painted with Canvas2D
// and every sound is synthesised, so it loads no assets.
import { GoldMinerScene } from '~/utils/gold-miner/scene'
import { paintShopIconUrl, paintShopkeeperUrl, paintEmblemUrl } from '~/utils/gold-miner/art'

const game = provideGoldMiner()
const { state, sceneHooks, attachScene, fire, useDynamite } = game

const root = ref<HTMLDivElement>()
const host = ref<HTMLDivElement>()
const scene = new GoldMinerScene()
const art = reactive({
    shopkeeper: '',
    emblem: '',
    icons: {} as Record<string, string>
})
provide('gold-miner-art', art)

// ─── fullscreen ──────────────────────────────────────────────────────────────
const fullscreenSupported = ref(false)
const isFullscreen = ref(false)

function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void root.value?.requestFullscreen().catch(() => {})
}

function onFullscreenChange() {
    isFullscreen.value = document.fullscreenElement === root.value
}

// ─── input ───────────────────────────────────────────────────────────────────
function isTyping(target: EventTarget | null) {
    const el = target as HTMLElement | null
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

function onKey(e: KeyboardEvent) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || state.showRules) return
    if (state.phase !== 'playing') return
    if (e.code === 'Space' || e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault()
        fire()
    } else if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'KeyD') {
        e.preventDefault()
        useDynamite()
    }
}

function onStagePointer(e: PointerEvent) {
    if (e.button !== 0) return
    fire()
}

let resizeObserver: ResizeObserver | null = null

onMounted(async () => {
    fullscreenSupported.value = document.fullscreenEnabled
    document.addEventListener('fullscreenchange', onFullscreenChange)
    window.addEventListener('keydown', onKey)
    if (!(await scene.init(host.value!, sceneHooks))) return
    attachScene(scene)
    // Dev-only handle for driving the scene from browser automation.
    if (import.meta.dev) (window as unknown as { __goldMiner?: GoldMinerScene }).__goldMiner = scene
    art.shopkeeper = paintShopkeeperUrl()
    art.emblem = paintEmblemUrl()
    for (const item of ['dynamite', 'strength', 'clover', 'book', 'polish'] as const) art.icons[item] = paintShopIconUrl(item)
    for (const kind of ['goldS', 'goldM', 'goldL', 'goldXL', 'rockS', 'rockL', 'diamond', 'mole', 'moleDiamond', 'bag', 'bone', 'skull', 'tnt'] as const) {
        art.icons[kind] = scene.icon(kind)
    }
    resizeObserver = new ResizeObserver(() => scene.app.resize())
    resizeObserver.observe(host.value!)
    await game.load()
    state.ready = true
})

onBeforeUnmount(() => {
    document.removeEventListener('fullscreenchange', onFullscreenChange)
    window.removeEventListener('keydown', onKey)
    resizeObserver?.disconnect()
    game.dispose()
    scene.destroy()
})
</script>

<template>
    <div ref="root" class="gm" :class="{ 'is-fullscreen': isFullscreen }">
        <div ref="host" class="stage" @pointerdown="onStagePointer" />
        <div class="hud">
            <GoldMinerHud
                v-if="['intro', 'playing', 'submitting'].includes(state.phase)"
                :fullscreen="isFullscreen"
                :fullscreen-supported="fullscreenSupported"
                @toggle-fullscreen="toggleFullscreen"
            />
            <Transition name="gm-pop">
                <GoldMinerLevelCard v-if="state.phase === 'intro'" />
            </Transition>
            <Transition name="gm-pop">
                <div v-if="state.phase === 'submitting'" class="banner display">
                    {{ state.clock <= 0 ? 'Time\'s up!' : 'Level complete!' }}
                </div>
            </Transition>
            <Transition name="gm-fade">
                <GoldMinerLobby v-if="state.phase === 'lobby'" />
            </Transition>
            <Transition name="gm-fade">
                <GoldMinerLevelResult v-if="state.phase === 'result'" />
            </Transition>
            <Transition name="gm-fade">
                <GoldMinerShop v-if="state.phase === 'shop'" />
            </Transition>
            <Transition name="gm-fade">
                <GoldMinerCashout v-if="state.phase === 'cashout'" />
            </Transition>
            <div v-if="!['intro', 'playing', 'submitting'].includes(state.phase)" class="corner-tools">
                <button class="round-btn" :aria-label="state.sfx ? 'Mute sound effects' : 'Unmute sound effects'" @click="game.setSfx(!state.sfx)">
                    <UIcon :name="state.sfx ? 'i-lucide-volume-2' : 'i-lucide-volume-x'" />
                </button>
                <button class="round-btn" :aria-label="state.music ? 'Mute music' : 'Play music'" @click="game.setMusic(!state.music)">
                    <UIcon :name="state.music ? 'i-lucide-music' : 'i-lucide-music-2'" :class="{ 'opacity-40': !state.music }" />
                </button>
                <button v-if="fullscreenSupported" class="round-btn" aria-label="Toggle fullscreen" @click="toggleFullscreen">
                    <UIcon :name="isFullscreen ? 'i-lucide-minimize' : 'i-lucide-maximize'" />
                </button>
            </div>
        </div>
        <GoldMinerRules v-if="state.showRules" />
        <Transition name="gm-fade" :duration="600">
            <div v-if="!state.ready" class="loading">
                <div class="loading-nugget" />
                <div class="display loading-title gold-text">
                    Gold Miner
                </div>
                <div class="label">
                    Polishing the nuggets…
                </div>
            </div>
        </Transition>
    </div>
</template>

<style scoped>
.gm {
    position: relative;
    container: gm / size;
    width: min(100%, calc((100svh - 8rem) * 16 / 9));
    aspect-ratio: 16 / 9;
    min-height: 480px;
    margin-inline: auto;
    overflow: clip;
    isolation: isolate;
    border-radius: calc(var(--ui-radius) * 3);
    border: 1px solid var(--ui-border);
    background: #1a0f08;
}
@media (max-width: 720px) {
    .gm {
        width: 100%;
        aspect-ratio: auto;
        height: calc(100svh - 7rem);
        min-height: 420px;
    }
}
.gm.is-fullscreen {
    width: 100%;
    height: 100%;
    aspect-ratio: auto;
    min-height: 0;
    border: 0;
    border-radius: 0;
}
.stage {
    position: absolute;
    inset: 0;
    cursor: pointer;
    touch-action: manipulation;
}
.stage :deep(canvas) {
    display: block;
}
.hud {
    position: absolute;
    inset: 0;
    pointer-events: none;
}
.hud > :deep(*) {
    pointer-events: auto;
}
.banner {
    position: absolute;
    left: 50%;
    top: 42%;
    transform: translate(-50%, -50%);
    font-size: clamp(36px, 7cqw, 84px);
    color: #fff4c0;
    text-shadow:
        0 4px 0 #6a3a00,
        0 8px 24px rgba(0, 0, 0, 0.6);
    pointer-events: none !important;
    white-space: nowrap;
}
.corner-tools {
    position: absolute;
    left: 14px;
    bottom: 14px;
    display: flex;
    gap: 8px;
    z-index: 25;
}
.loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 10px;
    background:
        radial-gradient(ellipse at 50% 40%, rgba(255, 190, 80, 0.18), transparent 60%),
        linear-gradient(180deg, #3a2412, #140a04);
    z-index: 40;
}
.loading-title {
    font-size: 54px;
}
.loading-nugget {
    width: 64px;
    height: 54px;
    border-radius: 46% 54% 50% 50% / 55% 50% 50% 45%;
    background: radial-gradient(circle at 35% 30%, #fffbe0, #ffd23a 35%, #c47a0c 80%, #6e3a04);
    box-shadow: 0 6px 18px rgba(255, 180, 40, 0.4);
    animation: gm-bob 1s ease-in-out infinite alternate;
}
@keyframes gm-bob {
    to {
        transform: translateY(-10px) rotate(8deg);
    }
}
.gm-fade-enter-active,
.gm-fade-leave-active {
    transition: opacity 0.35s;
}
.gm-fade-enter-from,
.gm-fade-leave-to {
    opacity: 0;
}
.gm-pop-enter-active {
    transition:
        opacity 0.3s,
        transform 0.45s cubic-bezier(0.2, 1.6, 0.4, 1);
}
.gm-pop-leave-active {
    transition:
        opacity 0.25s,
        transform 0.25s;
}
.gm-pop-enter-from,
.gm-pop-leave-to {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.6);
}
</style>

<style>
/* Game theme, scoped to the game box so it never leaks into the rest of the app. */
.gm {
    --gold-1: #fff6c2;
    --gold-2: #ffd54a;
    --gold-3: #f2a51c;
    --gold-4: #9a5a06;
    --wood-1: #8a5a30;
    --wood-2: #5a3418;
    --wood-3: #2e1a0a;
    --red: #e0392a;
    --green: #6dff8a;
    --display: 'Lilita One', 'Arial Black', sans-serif;
    --ui: 'Nunito', system-ui, sans-serif;
    color: #fff;
    font-family: var(--ui);
    user-select: none;
    -webkit-user-select: none;
}
.gm *,
.gm *::before,
.gm *::after {
    box-sizing: border-box;
    -webkit-tap-highlight-color: transparent;
}
.gm button {
    font-family: inherit;
    color: inherit;
    border: 0;
    background: none;
    cursor: pointer;
    padding: 0;
}
.gm button:disabled {
    cursor: not-allowed;
}
.gm .display {
    font-family: var(--display);
    letter-spacing: 0.02em;
}
.gm .gold-text {
    background: linear-gradient(180deg, #fffbe0 0%, #ffe066 38%, #f5a623 62%, #fff0a8 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    filter: drop-shadow(0 3px 0 #6a3a00) drop-shadow(0 6px 10px rgba(0, 0, 0, 0.45));
}
.gm .panel {
    background:
        linear-gradient(180deg, rgba(255, 220, 160, 0.08), rgba(0, 0, 0, 0.1)),
        repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.06) 0 2px, transparent 2px 22px),
        linear-gradient(180deg, #6b4020, #3e2210);
    border: 2px solid #1e0f04;
    box-shadow:
        inset 0 2px 0 rgba(255, 220, 160, 0.35),
        inset 0 -3px 0 rgba(0, 0, 0, 0.35),
        0 10px 30px rgba(0, 0, 0, 0.45);
    border-radius: 16px;
}
.gm .parchment {
    background:
        radial-gradient(ellipse at 30% 20%, rgba(255, 255, 255, 0.5), transparent 60%),
        linear-gradient(180deg, #fbefcf, #e9d3a0);
    color: #3a2410;
    border: 2px solid #6a4418;
    box-shadow:
        inset 0 0 30px rgba(120, 70, 20, 0.25),
        0 10px 30px rgba(0, 0, 0, 0.4);
    border-radius: 14px;
}
.gm .label {
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(255, 230, 190, 0.75);
}
.gm .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px 22px;
    border-radius: 14px;
    font-family: var(--display);
    font-size: 20px;
    letter-spacing: 0.03em;
    text-shadow: 0 2px 0 rgba(0, 0, 0, 0.35);
    transition:
        transform 0.12s,
        filter 0.12s;
}
.gm .btn:hover:not(:disabled) {
    filter: brightness(1.1);
}
.gm .btn:active:not(:disabled) {
    transform: translateY(2px) scale(0.98);
}
.gm .btn:disabled {
    filter: grayscale(0.7) brightness(0.8);
}
.gm .btn-gold {
    color: #4a2400;
    text-shadow: 0 1px 0 rgba(255, 255, 255, 0.5);
    background: linear-gradient(180deg, #fff3a8, #ffcf3a 45%, #e8920c);
    box-shadow:
        inset 0 2px 0 rgba(255, 255, 255, 0.7),
        inset 0 -4px 0 rgba(140, 70, 0, 0.5),
        0 6px 0 #7a4200,
        0 10px 20px rgba(0, 0, 0, 0.4);
}
.gm .btn-green {
    background: linear-gradient(180deg, #8af07a, #34b24a 50%, #1f7a30);
    box-shadow:
        inset 0 2px 0 rgba(255, 255, 255, 0.5),
        inset 0 -4px 0 rgba(0, 60, 10, 0.5),
        0 6px 0 #11501c,
        0 10px 20px rgba(0, 0, 0, 0.4);
}
.gm .btn-wood {
    background: linear-gradient(180deg, #a0703e, #6b4020);
    box-shadow:
        inset 0 2px 0 rgba(255, 220, 160, 0.4),
        inset 0 -4px 0 rgba(0, 0, 0, 0.35),
        0 5px 0 #2e1a0a,
        0 8px 16px rgba(0, 0, 0, 0.4);
}
.gm .round-btn {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: linear-gradient(180deg, #8a5a30, #4a2a12);
    border: 2px solid #1e0f04;
    box-shadow:
        inset 0 2px 0 rgba(255, 220, 160, 0.35),
        0 4px 10px rgba(0, 0, 0, 0.35);
    transition: transform 0.12s;
}
.gm .round-btn:active {
    transform: scale(0.92);
}
.gm .round-btn svg,
.gm .round-btn .iconify {
    width: 20px;
    height: 20px;
}
</style>
