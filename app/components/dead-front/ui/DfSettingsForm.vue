<template>
    <div class="df-settings">
        <label class="setting">
            <span class="row"><span>Mouse sensitivity</span><b>{{ local.sensitivity.toFixed(2) }}</b></span>
            <input v-model.number="local.sensitivity" type="range" class="df-range" min="0.2" max="3" step="0.05" :style="fill(local.sensitivity, 0.2, 3)">
        </label>
        <label class="setting">
            <span class="row"><span>Field of view</span><b>{{ local.fov }}°</b></span>
            <input v-model.number="local.fov" type="range" class="df-range" min="70" max="100" step="1" :style="fill(local.fov, 70, 100)">
        </label>
        <label class="setting">
            <span class="row"><span>Master volume</span><b>{{ Math.round(local.volume * 100) }}%</b></span>
            <input v-model.number="local.volume" type="range" class="df-range" min="0" max="1" step="0.01" :style="fill(local.volume, 0, 1)">
        </label>
        <!-- optional engine settings: shown as soon as the engine's settings carry them -->
        <label v-if="typeof ext.sfxVolume === 'number'" class="setting">
            <span class="row"><span>Effects volume</span><b>{{ Math.round(ext.sfxVolume * 100) }}%</b></span>
            <input v-model.number="ext.sfxVolume" type="range" class="df-range" min="0" max="1" step="0.01" :style="fill(ext.sfxVolume, 0, 1)">
        </label>
        <div v-if="ext.quality !== undefined" class="setting">
            <span id="df-quality-label" class="row"><span>Graphics</span></span>
            <div class="seg-pick" role="radiogroup" aria-labelledby="df-quality-label">
                <button
                    v-for="q in QUALITIES"
                    :key="q.value"
                    type="button"
                    role="radio"
                    :aria-checked="ext.quality === q.value"
                    :class="{ on: ext.quality === q.value }"
                    @click="ext.quality = q.value"
                >
                    {{ q.label }}
                </button>
            </div>
            <p class="note">Takes effect from the next match.</p>
        </div>
        <div class="setting flex items-center justify-between gap-4">
            <span id="df-invert-label" class="row !mb-0"><span>Invert mouse Y</span></span>
            <button
                type="button"
                role="switch"
                class="lever"
                :class="{ on: local.invertY }"
                :aria-checked="local.invertY"
                aria-labelledby="df-invert-label"
                @click="local.invertY = !local.invertY"
            >
                <span class="knob" />
                <span class="lbl off">Off</span>
                <span class="lbl on">On</span>
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
// The settings form, shared by the pause menu and the main menu. Edits are
// emitted sanitised as they happen; the caller saves and applies them.
import { dfSanitizeSettings } from '~/utils/dead-front/engine/settings'
import type { DfSettings } from '~/utils/dead-front/engine/settings'

/** Fields the engine may add later; the form shows them only when present. */
type DfSettingsExt = DfSettings & { sfxVolume?: number, quality?: 'auto' | 'low' | 'high' }

const props = defineProps<{ settings: DfSettings }>()
const emit = defineEmits<{ 'update:settings': [DfSettings] }>()

const QUALITIES: { value: 'auto' | 'low' | 'high', label: string }[] = [
    { value: 'auto', label: 'Auto' },
    { value: 'low', label: 'Low' },
    { value: 'high', label: 'High' }
]

const local = reactive<DfSettings>({ ...props.settings })
const ext = local as DfSettingsExt

function fill(v: number, lo: number, hi: number) {
    return { '--p': `${((v - lo) / (hi - lo)) * 100}%` }
}

watch(local, (v) => {
    emit('update:settings', { ...v, ...dfSanitizeSettings({ ...v }) })
}, { deep: true })
</script>

<style scoped>
.df-settings {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
}

.setting .row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.45rem;
    font-family: var(--df-font-stencil);
    font-size: 0.85rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
}

.setting .row b {
    font-family: var(--df-font-type);
    font-weight: 400;
    letter-spacing: 0.04em;
    color: var(--df-ink-2);
    font-variant-numeric: tabular-nums;
}

.note {
    margin-top: 0.35rem;
    font-family: var(--df-font-type);
    font-size: 0.72rem;
    color: var(--df-ink-3);
}

/* block slider: a dark track with a red fill and a square brass knob */
.df-range {
    width: 100%;
    height: 24px;
    background: transparent;
    appearance: none;
    cursor: pointer;
}

.df-range::-webkit-slider-runnable-track {
    height: 8px;
    background: linear-gradient(90deg, #b3271b 0 var(--p), #2a241c var(--p) 100%);
    box-shadow: 0 0 0 2px #120d07;
}

.df-range::-moz-range-track {
    height: 8px;
    background: #2a241c;
    box-shadow: 0 0 0 2px #120d07;
}

.df-range::-moz-range-progress {
    height: 8px;
    background: #b3271b;
}

.df-range::-webkit-slider-thumb {
    width: 16px;
    height: 22px;
    margin-top: -7px;
    border-radius: 0;
    appearance: none;
    background: #e2b24f;
    box-shadow: inset 0 3px 0 rgba(255, 250, 220, 0.6), inset 0 -4px 0 rgba(110, 70, 10, 0.55), 0 0 0 2px #120d07;
}

.df-range::-moz-range-thumb {
    width: 16px;
    height: 22px;
    border: none;
    border-radius: 0;
    background: #e2b24f;
    box-shadow: inset 0 3px 0 rgba(255, 250, 220, 0.6), inset 0 -4px 0 rgba(110, 70, 10, 0.55), 0 0 0 2px #120d07;
}

.df-range:focus-visible {
    outline: 3px solid var(--df-blood);
    outline-offset: 3px;
}

.seg-pick {
    display: flex;
    gap: 6px;
}

.seg-pick button {
    flex: 1;
    padding: 0.45rem 0.5rem 0.5rem;
    font-family: var(--df-font-stencil);
    font-size: 0.8rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--df-ink-2);
    background: rgba(60, 40, 15, 0.12);
    box-shadow: inset 0 -3px 0 rgba(60, 40, 15, 0.25), 0 0 0 2px #120d07;
    cursor: pointer;
}

.seg-pick button.on {
    color: #fff2dc;
    background: #b3271b;
    box-shadow: inset 0 3px 0 rgba(255, 170, 140, 0.45), inset 0 -3px 0 rgba(60, 0, 0, 0.55), 0 0 0 2px #120d07;
}

.seg-pick button:focus-visible {
    outline: 3px solid var(--df-blood);
    outline-offset: 2px;
}

.lever {
    position: relative;
    width: 76px;
    height: 30px;
    flex-shrink: 0;
    background: #1b1712;
    box-shadow: inset 0 3px 0 rgba(0, 0, 0, 0.5), 0 0 0 2px #120d07;
    cursor: pointer;
}

.lever:focus-visible {
    outline: 3px solid var(--df-blood);
    outline-offset: 3px;
}

.lever .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 34px;
    height: 24px;
    background: #e2b24f;
    box-shadow: inset 0 3px 0 rgba(255, 250, 220, 0.6), inset 0 -4px 0 rgba(110, 70, 10, 0.55);
    transition: transform 0.18s steps(4, end);
    z-index: 1;
}

.lever.on .knob {
    transform: translateX(36px);
}

.lever .lbl {
    position: absolute;
    top: 50%;
    font-family: var(--df-font-stencil);
    font-size: 0.66rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    transform: translateY(-50%);
}

.lever .lbl.off {
    right: 8px;
    color: #8f866c;
}

.lever .lbl.on {
    left: 9px;
    color: #ffb45c;
}
</style>
