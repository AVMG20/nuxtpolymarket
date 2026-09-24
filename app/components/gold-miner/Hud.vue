<script setup lang="ts">
defineProps<{ fullscreen: boolean, fullscreenSupported: boolean }>()
defineEmits<{ toggleFullscreen: [] }>()

const { state, cash, goal, goalReached, useDynamite, finishEarly, setSfx, setMusic } = useGoldMiner()
const art = inject<{ icons: Record<string, string> }>('gold-miner-art')!

// The money readout counts up rather than jumping.
const shown = ref(cash.value)
let raf = 0
watch(cash, (to) => {
    cancelAnimationFrame(raf)
    const from = shown.value
    const t0 = performance.now()
    const step = (now: number) => {
        const k = Math.min(1, (now - t0) / 450)
        shown.value = Math.round(from + (to - from) * (1 - (1 - k) ** 3))
        if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
})
onBeforeUnmount(() => cancelAnimationFrame(raf))

const progress = computed(() => Math.min(1, state.earned / Math.max(1, goal.value)))
const urgent = computed(() => state.phase === 'playing' && state.clock <= 10)
const money = (v: number) => `$${Math.round(v).toLocaleString('en')}`
</script>

<template>
    <div class="gm-hud">
        <div class="panel box left">
            <div class="row">
                <span class="label">Money</span>
                <span class="display money gold-text" :class="{ flash: state.goalFlash }">{{ money(shown) }}</span>
            </div>
            <div class="row">
                <span class="label">This level</span>
                <span class="display goal" :class="{ met: goalReached }">{{ money(state.earned) }} <small>/ {{ money(goal) }}</small></span>
            </div>
            <div class="bar">
                <div class="fill" :class="{ met: goalReached }" :style="{ width: `${progress * 100}%` }" />
            </div>
        </div>

        <div class="panel box right">
            <div class="row">
                <span class="label">Time</span>
                <span class="display time" :class="{ urgent }">{{ state.clock }}</span>
            </div>
            <div class="row">
                <span class="label">Level</span>
                <span class="display lvl">{{ state.run?.level ?? 1 }}</span>
            </div>
            <div class="perks">
                <img v-if="state.strength" :src="art.icons.strength" alt="Strength drink active" title="Strength drink">
                <img v-if="state.run?.perks.clover" :src="art.icons.clover" alt="Lucky clover active" title="Lucky clover">
                <img v-if="state.run?.perks.book" :src="art.icons.book" alt="Rock collector's book active" title="Rock collector's book">
                <img v-if="state.run?.perks.polish" :src="art.icons.polish" alt="Diamond polish active" title="Diamond polish">
            </div>
        </div>

        <div class="tools">
            <button class="round-btn" :aria-label="state.sfx ? 'Mute sound effects' : 'Unmute sound effects'" @click="setSfx(!state.sfx)">
                <UIcon :name="state.sfx ? 'i-lucide-volume-2' : 'i-lucide-volume-x'" />
            </button>
            <button class="round-btn" :aria-label="state.music ? 'Mute music' : 'Play music'" @click="setMusic(!state.music)">
                <UIcon name="i-lucide-music" :class="{ 'opacity-40': !state.music }" />
            </button>
            <button v-if="fullscreenSupported" class="round-btn" aria-label="Toggle fullscreen" @click="$emit('toggleFullscreen')">
                <UIcon :name="fullscreen ? 'i-lucide-minimize' : 'i-lucide-maximize'" />
            </button>
        </div>

        <div class="actions">
            <Transition name="gm-slide">
                <button v-if="goalReached && state.phase === 'playing'" class="btn btn-green finish" @click="finishEarly">
                    Finish level
                    <UIcon name="i-lucide-chevrons-right" />
                </button>
            </Transition>
            <button
                class="dyn panel"
                :disabled="state.dynamite <= 0 || state.phase !== 'playing'"
                aria-label="Throw dynamite"
                @click="useDynamite"
            >
                <img :src="art.icons.dynamite" alt="">
                <span class="display count">×{{ state.dynamite }}</span>
                <span class="key">↑</span>
            </button>
        </div>

        <div v-if="state.phase === 'playing' && state.clock > 55" class="hint">
            Click, tap or <kbd>Space</kbd> to drop the claw · <kbd>↑</kbd> throws dynamite at whatever you're hauling
        </div>
    </div>
</template>

<style scoped>
.gm-hud {
    position: absolute;
    inset: 0;
    pointer-events: none;
}
.gm-hud > * {
    pointer-events: auto;
}
.box {
    position: absolute;
    top: 12px;
    padding: 10px 16px 12px;
    min-width: 190px;
    display: grid;
    gap: 2px;
}
.left {
    left: 12px;
}
.right {
    right: 12px;
    min-width: 150px;
}
.row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
}
.money {
    font-size: 30px;
    line-height: 1.05;
    transition: transform 0.2s;
}
.money.flash {
    animation: gm-flash 0.5s ease-in-out 3;
}
@keyframes gm-flash {
    50% {
        transform: scale(1.18);
        filter: drop-shadow(0 0 12px #ffe066);
    }
}
.goal {
    font-size: 20px;
    color: #ffe6b8;
}
.goal.met {
    color: var(--green);
}
.goal small {
    font-size: 0.7em;
    opacity: 0.75;
}
.bar {
    margin-top: 6px;
    height: 8px;
    border-radius: 99px;
    background: rgba(0, 0, 0, 0.45);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.6);
    overflow: hidden;
}
.fill {
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #f5a623, #ffe066);
    transition: width 0.45s cubic-bezier(0.2, 1, 0.3, 1);
}
.fill.met {
    background: linear-gradient(90deg, #34b24a, #8af07a);
}
.time {
    font-size: 30px;
    line-height: 1.05;
    color: #fff4d8;
    min-width: 2ch;
    text-align: right;
}
.time.urgent {
    color: #ff5a4a;
    animation: gm-pulse 1s ease-in-out infinite;
}
@keyframes gm-pulse {
    50% {
        transform: scale(1.2);
    }
}
.lvl {
    font-size: 20px;
    color: #ffe6b8;
}
.perks {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
    min-height: 0;
}
.perks img {
    width: 26px;
    height: 26px;
    filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.5));
}
.tools {
    position: absolute;
    left: 14px;
    bottom: 14px;
    display: flex;
    gap: 8px;
}
.actions {
    position: absolute;
    right: 14px;
    bottom: 14px;
    display: flex;
    align-items: flex-end;
    gap: 12px;
}
.dyn {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 14px 6px 8px;
    transition: transform 0.12s;
}
.dyn:active:not(:disabled) {
    transform: scale(0.94);
}
.dyn:disabled {
    opacity: 0.55;
}
.dyn img {
    width: 42px;
    height: 42px;
}
.count {
    font-size: 24px;
}
.key {
    position: absolute;
    top: -8px;
    right: -6px;
    font-size: 11px;
    font-weight: 900;
    padding: 1px 6px;
    border-radius: 6px;
    background: #1e0f04;
    color: #ffe6b8;
}
.finish {
    font-size: 18px;
    padding: 10px 18px;
}
.hint {
    position: absolute;
    left: 50%;
    bottom: 18px;
    transform: translateX(-50%);
    padding: 8px 14px;
    border-radius: 999px;
    background: rgba(20, 10, 4, 0.72);
    font-size: 13px;
    font-weight: 700;
    color: #ffe6b8;
    white-space: nowrap;
    pointer-events: none !important;
}
.hint kbd {
    font-family: inherit;
    padding: 0 6px;
    border-radius: 5px;
    background: rgba(255, 255, 255, 0.15);
}
.gm-slide-enter-active {
    transition:
        opacity 0.3s,
        transform 0.4s cubic-bezier(0.2, 1.6, 0.4, 1);
}
.gm-slide-enter-from {
    opacity: 0;
    transform: translateY(20px);
}
@container gm (max-width: 700px) {
    .box {
        min-width: 0;
        padding: 6px 10px 8px;
    }
    .money,
    .time {
        font-size: 22px;
    }
    .goal,
    .lvl {
        font-size: 16px;
    }
    .hint {
        display: none;
    }
}
</style>
