<script setup lang="ts">
import { GOALS, goalMet, type Goal } from '#shared/utils/gridworks/goals'
import type { ItemId } from '#shared/utils/gridworks/defs'
import type { Solution } from '#shared/utils/gridworks/flow'
import type { GridState } from '#shared/utils/gridworks/game'
import { fmt } from '~/utils/gridworks/engine'
import type { GridSfx } from '~/utils/gridworks/sfx'

const props = defineProps<{ goal: Goal | null, state: GridState | null, sol: Solution | null, sfx?: GridSfx }>()
const emit = defineEmits<{ claim: [id: string], help: [] }>()

const minimized = ref(false)
const cheering = ref(false)
const typed = ref(0)
let typer: ReturnType<typeof setInterval> | null = null
let cheerTimer: ReturnType<typeof setTimeout> | null = null

const progress = computed<[number, number]>(() => props.goal && props.state ? props.goal.progress(props.state, props.sol) : [0, 1])
const met = computed(() => !!props.goal && !!props.state && goalMet(props.goal, props.state, props.sol))
const index = computed(() => props.goal ? GOALS.indexOf(props.goal) + 1 : GOALS.length)
const rewards = computed(() => Object.entries(props.goal?.reward ?? {}) as [ItemId, number][])
const text = computed(() => props.goal?.say ?? '')
const shown = computed(() => text.value.slice(0, typed.value))
const typing = computed(() => typed.value < text.value.length)

const pose = computed(() => {
    if (cheering.value) return 'cheer'
    if (met.value && rewards.value.length) return 'cheer'
    return props.goal?.pose ?? 'idle'
})
const avatar = computed(() => `/gridworks/sprites/mascot/cog${pose.value === 'idle' ? '' : `-${pose.value}`}.svg`)

function stopTyping() {
    if (typer) clearInterval(typer)
    typer = null
}

function startTyping() {
    stopTyping()
    typed.value = 0
    if (minimized.value || !text.value) {
        typed.value = text.value.length
        return
    }
    typer = setInterval(() => {
        typed.value = Math.min(text.value.length, typed.value + 1)
        const ch = text.value[typed.value - 1] ?? ''
        // Cosmetic pitch jitter for the talk blips.
        if (/[aeiouy]/i.test(ch)) props.sfx?.talk(Math.random())
        if (!typing.value) stopTyping()
    }, 22)
}

function skip() {
    if (!typing.value) return
    stopTyping()
    typed.value = text.value.length
}

function claim() {
    if (!props.goal || !met.value) return
    emit('claim', props.goal.id)
    cheering.value = true
    if (cheerTimer) clearTimeout(cheerTimer)
    cheerTimer = setTimeout(() => { cheering.value = false }, 1400)
}

function toggle() {
    minimized.value = !minimized.value
    localStorage.setItem('gridworks:guide', minimized.value ? 'min' : 'open')
    props.sfx?.select()
    if (!minimized.value) startTyping()
    else skip()
}

watch(() => props.goal?.id, startTyping)

onMounted(() => {
    minimized.value = localStorage.getItem('gridworks:guide') === 'min'
    startTyping()
})

onBeforeUnmount(() => {
    stopTyping()
    if (cheerTimer) clearTimeout(cheerTimer)
})

const itemUrl = (id: string) => `/gridworks/sprites/items/${id}.svg`
</script>

<template>
  <div class="pointer-events-none flex items-end gap-2">
    <button
      class="gw-cog pointer-events-auto relative shrink-0 transition active:scale-90"
      :class="{ 'gw-cog-cheer': cheering }"
      :title="minimized ? 'Show Cog' : 'Hide Cog'"
      @click="toggle"
    >
      <img :src="avatar" class="size-16 drop-shadow-[0_6px_10px_rgba(0,0,0,0.5)]" alt="Cog">
      <span
        v-if="minimized && met"
        class="absolute -right-0.5 top-1 grid size-5 place-items-center rounded-full bg-teal-400 text-xs font-bold text-teal-950 shadow-lg"
      >!</span>
    </button>

    <Transition name="gw-bubble">
      <div
        v-if="!minimized && goal"
        class="pointer-events-auto relative mb-2 w-72 rounded-2xl border border-teal-300/25 bg-[#0f1115]/90 p-3 shadow-2xl backdrop-blur"
      >
        <!-- Tail pointing at Cog -->
        <div class="absolute -left-[7px] bottom-6 size-3 rotate-45 border-b border-l border-teal-300/25 bg-[#0f1115]" />

        <div class="mb-1 flex items-center gap-2">
          <span class="rounded-md bg-teal-400/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-teal-200">
            Goal {{ index }}/{{ GOALS.length }}
          </span>
          <span class="truncate font-semibold">{{ goal.title }}</span>
          <div class="ml-auto flex items-center gap-1">
            <button class="grid size-6 place-items-center rounded-md text-white/40 transition hover:bg-white/10 hover:text-white" title="Controls" @click="emit('help')">
              <UIcon name="i-lucide-keyboard" class="size-3.5" />
            </button>
            <button class="grid size-6 place-items-center rounded-md text-white/40 transition hover:bg-white/10 hover:text-white" title="Hide" @click="toggle">
              <UIcon name="i-lucide-minus" class="size-3.5" />
            </button>
          </div>
        </div>

        <p class="min-h-[3.75rem] cursor-default text-[13px] leading-snug text-white/80" @click="skip">
          {{ shown }}<span v-if="typing" class="gw-caret">▍</span>
        </p>

        <div v-if="progress[1] > 1" class="mt-2">
          <div class="mb-0.5 flex justify-between text-[11px] text-white/50">
            <span>Progress</span>
            <span class="tabular-nums">{{ fmt(Math.min(progress[0], progress[1])) }} / {{ fmt(progress[1]) }}</span>
          </div>
          <div class="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div class="h-full rounded-full bg-teal-400 transition-[width] duration-500" :style="{ width: `${Math.min(1, progress[0] / progress[1]) * 100}%` }" />
          </div>
        </div>

        <div class="mt-2.5 flex items-center gap-2">
          <div v-if="rewards.length" class="flex flex-wrap items-center gap-1.5 text-xs">
            <span class="text-white/40">Reward</span>
            <span v-for="[k, v] in rewards" :key="k" class="flex items-center gap-1 rounded-md bg-white/5 px-1.5 py-0.5">
              <img :src="itemUrl(k)" class="size-4" alt="">{{ fmt(v) }}
            </span>
          </div>
          <button
            v-if="met"
            class="gw-claim ml-auto rounded-lg bg-teal-400 px-3 py-1 text-xs font-semibold text-teal-950 transition hover:bg-teal-300 active:scale-95"
            @click="claim"
          >
            {{ rewards.length ? 'Claim' : 'Let\'s go' }}
          </button>
          <span v-else class="ml-auto flex items-center gap-1 text-[11px] text-white/40">
            <UIcon name="i-lucide-loader-circle" class="size-3 animate-spin [animation-duration:2.5s]" /> In progress
          </span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.gw-cog img { animation: gw-bob 2.6s ease-in-out infinite; }
.gw-cog:hover img { animation-duration: 1.2s; }
.gw-cog-cheer img { animation: gw-hop 0.5s cubic-bezier(.3, 1.6, .5, 1) 2; }
@keyframes gw-bob {
  0%, 100% { transform: translateY(0) rotate(-2deg); }
  50% { transform: translateY(-4px) rotate(2deg); }
}
@keyframes gw-hop {
  0%, 100% { transform: translateY(0) scale(1); }
  40% { transform: translateY(-14px) scale(1.06, 0.96); }
}
.gw-caret { animation: gw-blink 0.8s steps(2) infinite; color: rgb(94 234 212); }
@keyframes gw-blink { 50% { opacity: 0; } }
.gw-claim { animation: gw-glow 1.4s ease-in-out infinite; }
@keyframes gw-glow {
  0%, 100% { box-shadow: 0 0 0 0 rgb(45 212 191 / 0.5); }
  50% { box-shadow: 0 0 0 6px rgb(45 212 191 / 0); }
}
.gw-bubble-enter-active, .gw-bubble-leave-active { transition: opacity 180ms, transform 260ms cubic-bezier(.3, 1.5, .5, 1); transform-origin: bottom left; }
.gw-bubble-enter-from, .gw-bubble-leave-to { opacity: 0; transform: translateX(-10px) scale(0.9); }
</style>
