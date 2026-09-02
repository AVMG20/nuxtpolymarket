<template>
    <div class="relative h-screen w-full select-none overflow-hidden bg-black font-mono text-white">
        <div ref="viewport" class="absolute inset-0" />

        <!-- Floating damage / score numbers projected from world space -->
        <div class="pointer-events-none absolute inset-0 overflow-hidden">
            <div
                v-for="popup in hud.popups"
                :key="popup.id"
                class="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-black tabular-nums drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)]"
                :style="{ left: popup.left + 'px', top: popup.top + 'px', opacity: popup.opacity, color: popup.color, fontSize: popup.size + 'px' }"
            >{{ popup.text }}</div>
        </div>

        <!-- Vignettes -->
        <div class="pointer-events-none absolute inset-0" style="box-shadow: inset 0 0 160px 30px rgba(0,0,0,0.7)" />
        <div class="pointer-events-none absolute inset-0 transition-opacity duration-100" :style="{ opacity: hud.hurt, boxShadow: 'inset 0 0 220px 80px rgba(200,20,20,0.6)' }" />
        <div v-if="lowHealth && hud.phase === 'playing'" class="pointer-events-none absolute inset-0 animate-pulse" style="box-shadow: inset 0 0 260px 100px rgba(150,0,0,0.5)" />
        <div v-if="hud.overdrive > 0" class="pointer-events-none absolute inset-0" style="box-shadow: inset 0 0 200px 50px rgba(255,80,40,0.28)" />
        <div v-if="hud.chrono" class="pointer-events-none absolute inset-0" style="box-shadow: inset 0 0 240px 90px rgba(60,220,255,0.3)" />
        <!-- zoom vignette + dash speed lines -->
        <div class="pointer-events-none absolute inset-0 transition-opacity duration-100" :style="{ opacity: hud.ads * 0.9, boxShadow: 'inset 0 0 220px 60px rgba(0,0,0,0.85)' }" />
        <div v-if="hud.dashing > 0" class="pointer-events-none absolute inset-0 speed-lines" />
        <div v-if="hud.event === 'blackout' && hud.phase === 'playing'" class="pointer-events-none absolute inset-0" style="box-shadow: inset 0 0 300px 120px rgba(0,0,0,0.85)" />

        <!-- Crosshair -->
        <div v-if="hud.phase === 'playing' && hud.locked" class="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div class="relative size-14">
                <span
                    v-for="(rot, i) in [0, 90, 180, 270]"
                    :key="i"
                    class="absolute left-1/2 top-1/2 h-2.5 w-0.5 origin-center rounded-full transition-colors"
                    :class="hud.hitMarker > 0 ? hitColor : 'bg-white/85'"
                    :style="{ transform: `rotate(${rot}deg) translateY(${-(9 + (hud.hitMarker > 0 ? 5 : 0) - hud.ads * 4)}px) translateX(-50%)` }"
                />
                <span class="absolute left-1/2 top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300/90" />
                <span
                    v-if="hud.hitMarker > 0"
                    class="absolute inset-0 flex items-center justify-center text-xl font-black"
                    :class="hitTextColor"
                >{{ hud.hitKind === 'block' ? '◇' : hud.hitKind === 'head' ? '◎' : '✕' }}</span>
                <span v-if="hud.gliding" class="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] uppercase tracking-[0.3em] text-cyan-300">Aim glide</span>
            </div>
        </div>

        <!-- HUD -->
        <div v-if="hud.phase !== 'menu'" class="pointer-events-none absolute inset-0 p-4 sm:p-6">
            <!-- Wave + enemies: top-left -->
            <div class="absolute left-4 top-4 sm:left-6 sm:top-6">
                <div class="rounded-lg border border-white/10 bg-black/55 px-4 py-3 backdrop-blur-sm">
                    <div class="text-[9px] uppercase tracking-[0.35em] text-zinc-500">Wave</div>
                    <div class="flex items-baseline gap-3">
                        <span class="text-4xl font-black leading-none tabular-nums text-cyan-300">{{ hud.wave }}</span>
                        <span class="text-xs text-zinc-400"><span class="font-bold text-zinc-100 tabular-nums">{{ hud.remaining }}</span> hostiles</span>
                    </div>
                    <div class="mt-2 flex items-center gap-3 text-[10px] text-zinc-400">
                        <span><UIcon name="i-lucide-timer" class="mr-1 size-3 align-[-2px]" />{{ formatTime(hud.time) }}</span>
                        <span><UIcon name="i-lucide-skull" class="mr-1 size-3 align-[-2px]" />{{ hud.kills }}</span>
                        <span><UIcon name="i-lucide-crosshair" class="mr-1 size-3 align-[-2px]" />{{ hud.headshots }}</span>
                        <span class="text-zinc-600">{{ hud.fps }} fps</span>
                    </div>
                    <div v-if="hud.event !== 'none'" class="mt-2 inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest" :class="eventClass">{{ eventLabel }}</div>
                </div>
            </div>

            <!-- Score + combo: top-right -->
            <div class="absolute right-4 top-4 text-right sm:right-6 sm:top-6">
                <div class="rounded-lg border border-white/10 bg-black/55 px-4 py-3 backdrop-blur-sm">
                    <div class="text-[9px] uppercase tracking-[0.35em] text-zinc-500">Score</div>
                    <div class="text-3xl font-black leading-none tabular-nums text-amber-300">{{ formatNumber(hud.score, false) }}</div>
                    <div v-if="hud.combo > 1" class="mt-2">
                        <div class="text-sm font-black tabular-nums" :class="comboColor">{{ hud.combo }}× COMBO</div>
                        <div class="mt-1 h-1 w-32 overflow-hidden rounded-full bg-white/10">
                            <div class="h-full bg-current transition-[width] duration-75" :class="comboColor" :style="{ width: (hud.comboFill * 100) + '%' }" />
                        </div>
                    </div>
                </div>
                <div v-if="hud.overdrive > 0 || hud.frenzy > 0 || hud.chrono" class="mt-2 flex flex-col items-end gap-1 text-[11px] font-bold uppercase tracking-widest">
                    <span v-if="hud.overdrive > 0" class="rounded bg-red-500/80 px-2 py-0.5">Overdrive {{ hud.overdrive.toFixed(1) }}s</span>
                    <span v-if="hud.frenzy > 0" class="rounded bg-orange-500/80 px-2 py-0.5">Frenzy ×{{ hud.frenzy }}</span>
                    <span v-if="hud.chrono" class="rounded bg-cyan-500/80 px-2 py-0.5">Chrono</span>
                </div>
            </div>

            <!-- Boss bar -->
            <div v-if="hud.boss" class="absolute left-1/2 top-4 w-[min(640px,80vw)] -translate-x-1/2 sm:top-6">
                <div class="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.35em] text-orange-300">
                    <span><UIcon name="i-lucide-crown" class="mr-1 size-3 align-[-2px]" />{{ hud.boss.name }}</span>
                    <span class="tabular-nums">{{ Math.ceil(hud.boss.hp) }} / {{ hud.boss.maxHp }}</span>
                </div>
                <div class="h-3 overflow-hidden rounded-sm border border-orange-400/40 bg-black/60">
                    <div class="h-full bg-gradient-to-r from-orange-600 to-amber-300 transition-[width] duration-100" :style="{ width: (hud.boss.hp / hud.boss.maxHp * 100) + '%' }" />
                </div>
            </div>

            <!-- Vitals: bottom-left -->
            <div class="absolute bottom-4 left-4 sm:bottom-6 sm:left-6">
                <div class="rounded-lg border border-white/10 bg-black/55 px-4 py-3 backdrop-blur-sm">
                    <div class="flex items-baseline gap-2">
                        <span class="text-4xl font-black leading-none tabular-nums" :class="lowHealth ? 'text-red-500' : 'text-zinc-50'">{{ Math.ceil(hud.health) }}</span>
                        <span class="text-xs font-bold text-zinc-500">/ {{ hud.maxHealth }}</span>
                    </div>
                    <div class="relative mt-2 h-2.5 w-56 overflow-hidden rounded-sm bg-white/10">
                        <div class="h-full transition-[width] duration-100" :class="lowHealth ? 'bg-red-500' : 'bg-emerald-400'" :style="{ width: (hud.health / hud.maxHealth * 100) + '%' }" />
                    </div>
                    <div class="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.3em]" :class="hud.energy >= hud.abilityCost ? 'text-cyan-300' : 'text-zinc-500'">
                        <span class="rounded border border-current px-1 font-bold">Q</span>
                        <span>Nova</span>
                        <span class="ml-auto tabular-nums">{{ Math.floor(hud.energy) }} / {{ hud.energyMax }}</span>
                    </div>
                    <div class="relative mt-1 h-1.5 w-56 overflow-hidden rounded-sm bg-white/10">
                        <div class="h-full transition-[width] duration-100" :class="hud.energy >= hud.abilityCost ? 'bg-cyan-300' : 'bg-cyan-800'" :style="{ width: (hud.energy / hud.energyMax * 100) + '%' }" />
                        <div class="absolute inset-y-0 w-px bg-white/60" :style="{ left: (hud.abilityCost / hud.energyMax * 100) + '%' }" />
                    </div>
                    <div class="mt-2 flex items-center gap-1.5">
                        <span class="mr-1 text-[9px] uppercase tracking-[0.3em] text-zinc-500">Dash</span>
                        <span
                            v-for="i in hud.dashMax"
                            :key="i"
                            class="h-1.5 w-8 overflow-hidden rounded-sm bg-white/10"
                        >
                            <span class="block h-full bg-sky-300" :style="{ width: (i <= hud.dashCharges ? 100 : i === hud.dashCharges + 1 ? hud.dashFill * 100 : 0) + '%' }" />
                        </span>
                    </div>
                </div>
            </div>

            <!-- Weapons: bottom-right -->
            <div class="absolute bottom-4 right-4 flex flex-col items-end gap-1.5 sm:bottom-6 sm:right-6">
                <div
                    v-for="(w, i) in hud.weapons"
                    :key="w.id"
                    class="relative w-60 overflow-hidden rounded-lg border px-3 py-2 backdrop-blur-sm transition-all"
                    :class="i === hud.activeWeapon ? 'border-white/30 bg-black/70' : 'border-white/5 bg-black/40 opacity-60 scale-95'"
                >
                    <div v-if="w.reloading" class="absolute inset-x-0 bottom-0 h-0.5 bg-white/70" :style="{ width: (w.reloadProgress * 100) + '%' }" />
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <span class="rounded border px-1 text-[10px] font-bold" :style="{ borderColor: w.color, color: w.color }">{{ i + 1 }}</span>
                            <span class="text-xs font-bold uppercase tracking-wider">{{ w.name }}</span>
                        </div>
                        <span v-if="w.reloading" class="text-[10px] uppercase tracking-widest text-zinc-400">Reloading</span>
                        <span v-else class="text-lg font-black tabular-nums" :class="w.ammo === 0 ? 'text-red-400' : ''">{{ w.ammo }}<span class="text-xs text-zinc-500"> / {{ w.magazine }}</span></span>
                    </div>
                    <div v-if="i === hud.activeWeapon" class="mt-1.5 flex gap-px">
                        <span
                            v-for="n in Math.min(40, w.magazine)"
                            :key="n"
                            class="h-1 flex-1 rounded-[1px]"
                            :style="{ background: n <= Math.round(w.ammo / w.magazine * Math.min(40, w.magazine)) ? w.color : 'rgba(255,255,255,0.12)' }"
                        />
                    </div>
                </div>
                <div class="text-[9px] uppercase tracking-[0.3em] text-zinc-600">RMB aim · F slash · Ctrl slide · Shift dash · R reload</div>
            </div>

            <!-- Toasts -->
            <div class="absolute bottom-40 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1">
                <div
                    v-for="t in toasts"
                    :key="t.id"
                    class="rounded bg-black/60 px-3 py-1 text-xs font-bold uppercase tracking-widest backdrop-blur-sm"
                    :style="{ color: t.color }"
                >{{ t.text }}</div>
            </div>
        </div>

        <!-- Wave banner -->
        <Transition name="banner">
            <div v-if="banner" class="pointer-events-none absolute inset-x-0 top-[26%] flex flex-col items-center">
                <div
                    class="text-6xl font-black uppercase tracking-[0.2em] drop-shadow-[0_4px_20px_rgba(0,0,0,0.9)] sm:text-7xl"
                    :class="banner.tone === 'boss' ? 'text-orange-400' : banner.tone === 'clear' ? 'text-lime-300' : 'text-cyan-200'"
                >{{ banner.title }}</div>
                <div class="mt-2 text-sm uppercase tracking-[0.5em] text-zinc-300">{{ banner.subtitle }}</div>
            </div>
        </Transition>

        <!-- Main menu -->
        <div v-if="hud.phase === 'menu'" class="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
            <div class="mx-4 w-full max-w-2xl rounded-2xl border border-white/10 bg-zinc-950/85 p-8 shadow-2xl">
                <div class="text-[10px] uppercase tracking-[0.5em] text-cyan-400">Wave survival · rogue-like</div>
                <h1 class="mt-2 text-5xl font-black uppercase tracking-tight sm:text-6xl">
                    <span class="text-cyan-300">Voxel</span> Arena
                </h1>
                <p class="mt-3 max-w-lg text-sm text-zinc-400">
                    Hold the arena against endless waves of voxel constructs. Shoot, slash, slide and bullet-jump, then pick
                    up to three upgrades after every wave. Every fifth wave a Titan drops in, and the arena itself turns on
                    you in between. Everything you kill shatters into blocks.
                </p>
                <div class="mt-6 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-zinc-300 sm:grid-cols-3">
                    <div v-for="c in controls" :key="c[0]" class="flex items-center gap-2">
                        <span class="min-w-14 rounded border border-white/20 bg-white/5 px-1.5 py-0.5 text-center text-[10px] font-bold uppercase">{{ c[0] }}</span>
                        <span class="text-zinc-400">{{ c[1] }}</span>
                    </div>
                </div>
                <div class="mt-7 flex flex-wrap items-center gap-3">
                    <UButton size="xl" color="primary" icon="i-lucide-swords" class="font-black uppercase tracking-widest" @click="start">Deploy</UButton>
                    <UButton size="xl" color="neutral" variant="ghost" :icon="muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'" @click="toggleMute">{{ muted ? 'Unmute' : 'Mute' }}</UButton>
                    <UButton size="xl" color="neutral" variant="ghost" :icon="quality === 'high' ? 'i-lucide-sparkles' : 'i-lucide-sparkle'" @click="toggleQuality">FX: {{ quality }}</UButton>
                    <UButton size="xl" color="neutral" variant="ghost" icon="i-lucide-arrow-left" to="/">Back</UButton>
                    <div v-if="best" class="ml-auto text-right text-xs text-zinc-500">
                        <div class="uppercase tracking-[0.3em]">Best run</div>
                        <div class="text-zinc-200">Wave <b class="text-cyan-300">{{ best.wave }}</b> · <b class="text-amber-300">{{ formatNumber(best.score, false) }}</b> pts</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Pause -->
        <div v-else-if="hud.phase === 'paused'" class="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
            <div class="w-80 rounded-2xl border border-white/10 bg-zinc-950/90 p-6 text-center shadow-2xl">
                <div class="text-2xl font-black uppercase tracking-[0.3em]">Paused</div>
                <div class="mt-1 text-xs text-zinc-500">Wave {{ hud.wave }} · {{ formatNumber(hud.score, false) }} pts</div>
                <div class="mt-5 flex flex-col gap-2">
                    <UButton block size="lg" color="primary" icon="i-lucide-play" class="font-bold uppercase tracking-widest" @click="resume">Resume</UButton>
                    <UButton block size="lg" color="neutral" variant="soft" :icon="muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'" @click="toggleMute">{{ muted ? 'Unmute' : 'Mute' }}</UButton>
                    <UButton block size="lg" color="neutral" variant="soft" icon="i-lucide-sparkles" @click="toggleQuality">Effects: {{ quality }}</UButton>
                    <UButton block size="lg" color="error" variant="soft" icon="i-lucide-rotate-ccw" @click="start">Restart</UButton>
                    <UButton block size="lg" color="neutral" variant="ghost" icon="i-lucide-log-out" to="/">Leave arena</UButton>
                </div>
            </div>
        </div>

        <!-- Upgrade draft -->
        <div v-else-if="hud.phase === 'draft'" class="absolute inset-0 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-[3px]">
            <div class="w-full max-w-5xl">
                <div class="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <div class="text-[10px] uppercase tracking-[0.5em] text-lime-300">Wave {{ hud.wave }} cleared</div>
                        <h2 class="mt-1 text-3xl font-black uppercase tracking-tight">Choose your upgrades</h2>
                        <p class="mt-1 text-xs text-zinc-400">Pick up to <b class="text-white">{{ DRAFT_PICKS }}</b>. Weapon cards join your loadout (max 3 guns — a 4th replaces the one you're holding).</p>
                    </div>
                    <div class="flex items-center gap-3">
                        <span class="text-xs uppercase tracking-widest text-zinc-400">{{ selected.length }} / {{ DRAFT_PICKS }} selected</span>
                        <UButton size="xl" color="primary" icon="i-lucide-swords" class="font-black uppercase tracking-widest" @click="deploy">{{ selected.length ? 'Deploy' : 'Skip' }}</UButton>
                    </div>
                </div>
                <div class="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3">
                    <button
                        v-for="card in draft"
                        :key="card.draftKey"
                        type="button"
                        class="group relative flex flex-col rounded-xl border-2 bg-zinc-950/90 p-4 text-left transition-all hover:-translate-y-0.5"
                        :class="isSelected(card) ? 'shadow-[0_0_30px_-5px_var(--card-color)]' : 'border-white/10 opacity-90 hover:opacity-100'"
                        :style="{ '--card-color': RARITY_COLOR[card.rarity], 'border-color': isSelected(card) ? RARITY_COLOR[card.rarity] : undefined }"
                        @click="toggle(card)"
                    >
                        <div class="flex items-center justify-between">
                            <span class="text-[9px] font-bold uppercase tracking-[0.3em]" :style="{ color: RARITY_COLOR[card.rarity] }">{{ RARITY_LABEL[card.rarity] }} · {{ card.kind === 'weapon' ? 'weapon' : card.kind === 'crazy' ? 'mutation' : 'upgrade' }}</span>
                            <span v-if="isSelected(card)" class="flex size-5 items-center justify-center rounded-full text-[10px] font-black text-black" :style="{ background: RARITY_COLOR[card.rarity] }">{{ selected.indexOf(card.draftKey) + 1 }}</span>
                        </div>
                        <div class="mt-3 flex items-center gap-3">
                            <span class="flex size-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                                <UIcon :name="card.icon" class="size-6" :style="{ color: RARITY_COLOR[card.rarity] }" />
                            </span>
                            <span class="text-base font-black uppercase leading-tight tracking-wide">{{ card.name }}</span>
                        </div>
                        <p class="mt-3 text-xs leading-relaxed text-zinc-400">{{ card.description }}</p>
                    </button>
                </div>
            </div>
        </div>

        <!-- Game over -->
        <div v-else-if="hud.phase === 'dead' && summary" class="absolute inset-0 flex items-center justify-center bg-black/65 backdrop-blur-[3px]">
            <div class="mx-4 w-full max-w-xl rounded-2xl border border-red-500/30 bg-zinc-950/90 p-8 shadow-2xl">
                <div class="text-[10px] uppercase tracking-[0.5em] text-red-400">Signal lost</div>
                <h2 class="mt-1 text-4xl font-black uppercase tracking-tight">You were shattered</h2>
                <div v-if="summary.newBest" class="mt-2 inline-block rounded bg-amber-400/20 px-2 py-0.5 text-xs font-bold uppercase tracking-widest text-amber-300">New personal best</div>
                <div class="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <div v-for="s in summaryStats" :key="s.label" class="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                        <div class="text-[9px] uppercase tracking-[0.3em] text-zinc-500">{{ s.label }}</div>
                        <div class="text-xl font-black tabular-nums" :class="s.color">{{ s.value }}</div>
                    </div>
                </div>
                <div v-if="summary.upgrades.length" class="mt-4">
                    <div class="text-[9px] uppercase tracking-[0.3em] text-zinc-500">Build</div>
                    <div class="mt-1 flex flex-wrap gap-1">
                        <span v-for="(u, i) in summary.upgrades" :key="i" class="rounded bg-white/5 px-2 py-0.5 text-[11px] text-zinc-300">{{ u }}</span>
                    </div>
                </div>
                <div class="mt-4 text-xs text-zinc-500">Best: wave {{ summary.bestWave }} · {{ formatNumber(summary.bestScore, false) }} pts</div>
                <div class="mt-6 flex flex-wrap gap-3">
                    <UButton size="xl" color="primary" icon="i-lucide-rotate-ccw" class="font-black uppercase tracking-widest" @click="start">Run it back</UButton>
                    <UButton size="xl" color="neutral" variant="ghost" icon="i-lucide-arrow-left" to="/">Leave arena</UButton>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { VoxelArenaGame, createHud } from '~/utils/voxel-arena/engine'
import type { RunSummary } from '~/utils/voxel-arena/engine'
import type { DraftCard } from '~/utils/voxel-arena/types'
import { RARITY_COLOR, RARITY_LABEL, DRAFT_PICKS } from '~/utils/voxel-arena/upgrades'

const viewport = ref<HTMLDivElement | null>(null)
const hud = reactive(createHud())
let game: VoxelArenaGame | null = null

const banner = ref<{ title: string, subtitle: string, tone: string } | null>(null)
let bannerTimer: number | undefined
const toasts = ref<{ id: number, text: string, color: string }[]>([])
let toastId = 0
const draft = ref<DraftCard[]>([])
const selected = ref<string[]>([])
const summary = ref<RunSummary | null>(null)
const muted = ref(false)
const best = ref<{ wave: number, score: number } | null>(null)
const quality = ref<'high' | 'low'>('high')
const route = useRoute()

const controls: [string, string][] = [
    ['WASD', 'Move'],
    ['LMB', 'Shoot'],
    ['RMB', 'Aim: zoom + accuracy, glide in the air'],
    ['F / V', 'Slash combo · in the air: ground slam'],
    ['Ctrl', 'Slide'],
    ['Ctrl + Space', 'Bullet jump'],
    ['Shift', 'Dash (i-frames)'],
    ['Space', 'Jump / double jump'],
    ['Q', 'Nova Burst (energy)'],
    ['R', 'Reload'],
    ['1-3 / wheel', 'Switch weapon'],
    ['Esc', 'Pause']
]

const lowHealth = computed(() => hud.health / hud.maxHealth < 0.3)
const hitColor = computed(() => ({ kill: 'bg-lime-400', crit: 'bg-yellow-300', head: 'bg-orange-400', block: 'bg-cyan-300', hit: 'bg-red-400' })[hud.hitKind])
const hitTextColor = computed(() => ({ kill: 'text-lime-400', crit: 'text-yellow-300', head: 'text-orange-400', block: 'text-cyan-300', hit: 'text-red-400' })[hud.hitKind])
const eventLabel = computed(() => ({ meteors: 'Meteor storm', frenzy: 'Frenzy', blackout: 'Blackout', none: '' })[hud.event])
const eventClass = computed(() => ({ meteors: 'bg-orange-500/80', frenzy: 'bg-red-500/80', blackout: 'bg-indigo-500/80', none: '' })[hud.event])
const comboColor = computed(() => hud.combo >= 20 ? 'text-fuchsia-400' : hud.combo >= 10 ? 'text-orange-400' : 'text-yellow-300')

const summaryStats = computed(() => {
    const s = summary.value
    if (!s) return []
    return [
        { label: 'Wave', value: String(s.wave), color: 'text-cyan-300' },
        { label: 'Score', value: formatNumber(s.score, false), color: 'text-amber-300' },
        { label: 'Kills', value: String(s.kills), color: 'text-zinc-100' },
        { label: 'Headshots', value: String(s.headshots), color: 'text-orange-300' },
        { label: 'Survived', value: formatTime(s.time), color: 'text-zinc-100' }
    ]
})

function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
}

function showBanner(title: string, subtitle: string, tone: string): void {
    banner.value = { title, subtitle, tone }
    if (bannerTimer) window.clearTimeout(bannerTimer)
    bannerTimer = window.setTimeout(() => { banner.value = null }, 2400)
}

function showToast(text: string, color: string): void {
    const id = ++toastId
    toasts.value.push({ id, text, color })
    if (toasts.value.length > 4) toasts.value.shift()
    window.setTimeout(() => {
        toasts.value = toasts.value.filter(t => t.id !== id)
    }, 2600)
}

function start(): void {
    summary.value = null
    game?.start()
}

function resume(): void {
    game?.resume()
}

function toggleMute(): void {
    muted.value = !muted.value
    game?.setMuted(muted.value)
}

function toggleQuality(): void {
    quality.value = quality.value === 'high' ? 'low' : 'high'
    game?.setQuality(quality.value)
    try {
        localStorage.setItem('voxel-arena-fx', quality.value)
    } catch {
        // storage is a convenience only
    }
}

function loadQuality(): void {
    const fromQuery = route.query.fx
    if (fromQuery === 'low' || fromQuery === 'high') {
        quality.value = fromQuery
        return
    }
    try {
        const stored = localStorage.getItem('voxel-arena-fx')
        if (stored === 'low' || stored === 'high') quality.value = stored
    } catch {
        quality.value = 'high'
    }
}

function isSelected(card: DraftCard): boolean {
    return selected.value.includes(card.draftKey)
}

function toggle(card: DraftCard): void {
    const idx = selected.value.indexOf(card.draftKey)
    if (idx >= 0) {
        selected.value.splice(idx, 1)
    } else if (selected.value.length < DRAFT_PICKS) {
        selected.value.push(card.draftKey)
    }
    game?.audio.play('select', 0.6)
}

function deploy(): void {
    const cards = selected.value
        .map(key => draft.value.find(c => c.draftKey === key))
        .filter((c): c is DraftCard => !!c)
    selected.value = []
    draft.value = []
    game?.applyDraft(cards)
}

function loadBest(): void {
    try {
        const raw = localStorage.getItem('voxel-arena-best')
        if (raw) best.value = JSON.parse(raw) as { wave: number, score: number }
    } catch {
        best.value = null
    }
}

onMounted(async () => {
    // `.client` components render their real template a tick after mount, so
    // the viewport ref is only populated after nextTick.
    await nextTick()
    loadBest()
    loadQuality()
    if (!viewport.value) return
    game = new VoxelArenaGame({
        hud,
        banner: showBanner,
        toast: showToast,
        draft: cards => {
            draft.value = cards
            selected.value = []
        },
        dead: s => {
            summary.value = s
            best.value = { wave: s.bestWave, score: s.bestScore }
        }
    })
    game.mount(viewport.value, quality.value)
    if (import.meta.dev && route.query.debug === '1') {
        (window as unknown as { __voxelArena: VoxelArenaGame }).__voxelArena = game
    }
})

onBeforeUnmount(() => {
    if (bannerTimer) window.clearTimeout(bannerTimer)
    game?.dispose()
    game = null
})
</script>

<style scoped>
.banner-enter-active,
.banner-leave-active {
    transition: opacity 0.35s ease, transform 0.35s ease;
}

.banner-enter-from {
    opacity: 0;
    transform: translateY(-16px) scale(1.08);
}

.banner-leave-to {
    opacity: 0;
    transform: translateY(8px);
}

.speed-lines {
    background: repeating-conic-gradient(from 0deg at 50% 50%, rgba(255, 255, 255, 0.16) 0deg 1.2deg, transparent 1.2deg 9deg);
    mask-image: radial-gradient(circle at 50% 50%, transparent 32%, black 78%);
    -webkit-mask-image: radial-gradient(circle at 50% 50%, transparent 32%, black 78%);
    opacity: 0.6;
}
</style>
