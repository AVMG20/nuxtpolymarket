<template>
    <div class="arena relative h-screen w-full select-none overflow-hidden bg-black font-sans text-white">
        <div ref="viewport" class="absolute inset-0" />

        <!-- Floating damage / score numbers projected from world space -->
        <div class="pointer-events-none absolute inset-0 overflow-hidden">
            <div
                v-for="popup in hud.popups"
                :key="popup.id"
                class="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-mono font-bold tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
                :style="{ left: popup.left + 'px', top: popup.top + 'px', opacity: popup.opacity, color: popup.color, fontSize: popup.size + 'px' }"
            >{{ popup.text }}</div>
        </div>

        <!-- Screen-space feedback -->
        <div class="pointer-events-none absolute inset-0" style="box-shadow: inset 0 0 140px 20px rgba(0,0,0,0.55)" />
        <div class="pointer-events-none absolute inset-0 transition-opacity duration-100" :style="{ opacity: hud.hurt, boxShadow: 'inset 0 0 200px 60px rgba(220,30,40,0.55)' }" />
        <div v-if="lowHealth && hud.phase === 'playing'" class="pointer-events-none absolute inset-0 animate-pulse" style="box-shadow: inset 0 0 240px 80px rgba(160,0,10,0.45)" />
        <div class="pointer-events-none absolute inset-0 transition-opacity duration-150" :style="{ opacity: hud.ads * 0.85, boxShadow: 'inset 0 0 200px 50px rgba(0,0,0,0.8)' }" />
        <div v-if="hud.dashing > 0" class="pointer-events-none absolute inset-0 speed-lines" />
        <div v-if="hud.overdrive > 0" class="pointer-events-none absolute inset-0" style="box-shadow: inset 0 0 180px 40px rgba(255,70,40,0.22)" />
        <div v-if="hud.chrono" class="pointer-events-none absolute inset-0" style="box-shadow: inset 0 0 220px 70px rgba(60,220,255,0.25)" />
        <div v-if="hud.event === 'blackout' && hud.phase === 'playing'" class="pointer-events-none absolute inset-0" style="box-shadow: inset 0 0 280px 110px rgba(0,0,0,0.8)" />

        <!-- Crosshair -->
        <div v-if="hud.phase === 'playing' && hud.locked" class="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div class="relative size-16">
                <span
                    v-for="(rot, i) in [0, 90, 180, 270]"
                    :key="i"
                    class="absolute left-1/2 top-1/2 h-2 w-px origin-center transition-colors duration-75"
                    :class="hud.hitMarker > 0 ? hitColor : 'bg-white/80'"
                    :style="{ transform: `rotate(${rot + 45}deg) translateY(${-(11 - hud.ads * 4 + (hud.hitMarker > 0 ? 3 : 0))}px)` }"
                />
                <span class="absolute left-1/2 top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full" :class="hud.hitMarker > 0 ? hitColor : 'bg-cyan-300'" />
                <span v-if="hud.hitKind === 'head' && hud.hitMarker > 0" class="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] font-bold uppercase tracking-[0.35em] text-orange-300">Headshot</span>
                <span v-if="hud.gliding" class="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] uppercase tracking-[0.35em] text-cyan-300/80">Glide</span>
            </div>
        </div>

        <!-- HUD -->
        <div v-if="hud.phase !== 'menu'" class="pointer-events-none absolute inset-0">
            <!-- Wave: top centre -->
            <div class="absolute left-1/2 top-5 w-64 -translate-x-1/2 text-center sm:top-6">
                <div class="flex items-baseline justify-center gap-2">
                    <span class="text-[10px] uppercase tracking-[0.5em] text-white/50">Wave</span>
                    <span class="text-3xl font-black leading-none tabular-nums text-white drop-shadow-[0_0_14px_rgba(63,240,255,0.35)]">{{ hud.wave }}</span>
                </div>
                <div class="mx-auto mt-2 h-px w-48 overflow-hidden bg-white/15">
                    <div class="h-full bg-cyan-300 transition-[width] duration-200" :style="{ width: waveProgress + '%' }" />
                </div>
                <div class="mt-1.5 text-[10px] uppercase tracking-[0.3em] text-white/45">
                    <span class="tabular-nums text-white/80">{{ hud.remaining }}</span> hostiles
                </div>
                <div v-if="hud.event !== 'none'" class="mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.3em]" :class="eventClass">
                    <span class="size-1 rounded-full bg-current animate-pulse" />{{ eventLabel }}
                </div>
                <!-- Boss -->
                <div v-if="hud.boss" class="mt-4 w-[min(560px,76vw)] -translate-x-[calc(50%-8rem)]">
                    <div class="mb-1 flex items-end justify-between text-[10px] uppercase tracking-[0.4em] text-orange-300">
                        <span>{{ hud.boss.name }}</span>
                        <span class="tabular-nums text-orange-200/70">{{ Math.ceil(hud.boss.hp / hud.boss.maxHp * 100) }}%</span>
                    </div>
                    <div class="h-1 overflow-hidden rounded-full bg-white/10">
                        <div class="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-300 shadow-[0_0_12px_rgba(251,146,60,0.7)] transition-[width] duration-100" :style="{ width: (hud.boss.hp / hud.boss.maxHp * 100) + '%' }" />
                    </div>
                </div>
            </div>

            <!-- Run stats: top-left -->
            <div class="absolute left-5 top-5 flex items-center gap-4 font-mono text-[11px] tabular-nums text-white/55 sm:left-7 sm:top-7">
                <span class="flex items-center gap-1.5"><UIcon name="i-lucide-timer" class="size-3.5" />{{ formatTime(hud.time) }}</span>
                <span class="flex items-center gap-1.5"><UIcon name="i-lucide-skull" class="size-3.5" />{{ hud.kills }}</span>
                <span class="flex items-center gap-1.5"><UIcon name="i-lucide-crosshair" class="size-3.5" />{{ hud.headshots }}</span>
            </div>

            <!-- Score: top-right -->
            <div class="absolute right-5 top-5 text-right sm:right-7 sm:top-7">
                <div class="text-[10px] uppercase tracking-[0.5em] text-white/50">Score</div>
                <div class="font-mono text-3xl font-black leading-none tabular-nums text-amber-300">{{ formatNumber(hud.score, false) }}</div>
                <Transition name="fade">
                    <div v-if="hud.combo > 1" class="mt-2 flex flex-col items-end">
                        <div class="font-mono text-sm font-bold tabular-nums" :class="comboColor">×{{ hud.combo }}</div>
                        <div class="mt-1 h-px w-24 overflow-hidden bg-white/15">
                            <div class="h-full bg-current transition-[width] duration-75" :class="comboColor" :style="{ width: (hud.comboFill * 100) + '%' }" />
                        </div>
                    </div>
                </Transition>
            </div>

            <!-- Vitals: bottom-left -->
            <div class="absolute bottom-6 left-5 w-72 sm:bottom-8 sm:left-7">
                <div class="flex items-end justify-between">
                    <div class="flex items-baseline gap-1.5">
                        <span class="font-mono text-5xl font-black leading-none tabular-nums" :class="lowHealth ? 'text-red-400' : 'text-white'">{{ Math.ceil(hud.health) }}</span>
                        <span class="font-mono text-xs text-white/40">/ {{ hud.maxHealth }}</span>
                    </div>
                    <div class="flex items-center gap-1 pb-1">
                        <span
                            v-for="i in hud.dashMax"
                            :key="i"
                            class="h-1 w-6 overflow-hidden rounded-full bg-white/15"
                        >
                            <span class="block h-full rounded-full bg-sky-300 transition-[width] duration-75" :style="{ width: (i <= hud.dashCharges ? 100 : i === hud.dashCharges + 1 ? hud.dashFill * 100 : 0) + '%' }" />
                        </span>
                        <UIcon name="i-lucide-wind" class="ml-1 size-3 text-white/40" />
                    </div>
                </div>
                <Transition name="fade">
                    <div v-if="hud.shield > 0" class="mt-2 flex items-center gap-2">
                        <UIcon name="i-lucide-shield" class="size-3 text-sky-300" />
                        <div class="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                            <div class="h-full rounded-full bg-sky-300 shadow-[0_0_10px_rgba(125,211,252,0.8)] transition-[width] duration-100" :style="{ width: Math.min(100, hud.shield / 150 * 100) + '%' }" />
                        </div>
                        <span class="font-mono text-[10px] tabular-nums text-sky-200">{{ Math.ceil(hud.shield) }}</span>
                    </div>
                </Transition>
                <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                        class="h-full rounded-full transition-[width] duration-100"
                        :class="lowHealth ? 'bg-red-500 shadow-[0_0_14px_rgba(239,68,68,0.8)]' : 'bg-gradient-to-r from-emerald-400 to-lime-300 shadow-[0_0_14px_rgba(74,222,128,0.5)]'"
                        :style="{ width: (hud.health / hud.maxHealth * 100) + '%' }"
                    />
                </div>
                <div class="mt-2.5 flex items-center gap-2">
                    <span class="rounded border px-1.5 font-mono text-[10px] font-bold leading-4 transition-colors" :class="novaReady ? 'border-cyan-300 text-cyan-300 shadow-[0_0_10px_rgba(63,240,255,0.5)]' : 'border-white/20 text-white/40'">Q</span>
                    <div class="relative h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                        <div class="h-full rounded-full transition-[width] duration-100" :class="novaReady ? 'bg-cyan-300 shadow-[0_0_10px_rgba(63,240,255,0.7)]' : 'bg-cyan-700'" :style="{ width: (hud.energy / hud.energyMax * 100) + '%' }" />
                        <div class="absolute inset-y-0 w-px bg-white/50" :style="{ left: (hud.abilityCost / hud.energyMax * 100) + '%' }" />
                    </div>
                    <span class="font-mono text-[10px] tabular-nums text-white/40">{{ Math.floor(hud.energy) }}</span>
                </div>
                <div class="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.3em]" :class="hud.energy >= hud.turretCost ? 'text-cyan-200' : 'text-white/35'">
                    <span class="rounded border px-1.5 font-mono font-bold leading-4 transition-colors" :class="hud.energy >= hud.turretCost ? 'border-cyan-300/70 text-cyan-300' : 'border-white/20 text-white/40'">E</span>
                    <span>Sentry</span>
                    <span class="font-mono tabular-nums text-white/40">{{ hud.turretCost }}</span>
                    <span v-if="hud.turrets > 0" class="ml-auto flex items-center gap-1 text-cyan-300"><UIcon name="i-lucide-radar" class="size-3" />{{ hud.turrets }}</span>
                </div>
            </div>

            <!-- Weapon: bottom-right -->
            <div class="absolute bottom-6 right-5 flex flex-col items-end sm:bottom-8 sm:right-7">
                <div class="flex items-center gap-1.5">
                    <span
                        v-for="(w, i) in hud.weapons"
                        :key="w.id"
                        class="rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.25em] transition-all"
                        :class="i === hud.activeWeapon ? 'border-white/30 bg-white/10 text-white' : 'border-white/10 text-white/35'"
                    >{{ i + 1 }} · {{ w.name }}</span>
                </div>
                <div v-if="activeWeapon" class="mt-2 flex items-baseline gap-2">
                    <span v-if="activeWeapon.reloading" class="text-[10px] uppercase tracking-[0.4em] text-white/50">Reloading</span>
                    <span v-else class="font-mono text-5xl font-black leading-none tabular-nums" :class="activeWeapon.ammo === 0 ? 'text-red-400' : 'text-white'">{{ activeWeapon.ammo }}</span>
                    <span class="font-mono text-xs text-white/40">/ {{ activeWeapon.magazine }}</span>
                </div>
                <div v-if="activeWeapon" class="mt-2 h-1 w-56 overflow-hidden rounded-full bg-white/10">
                    <div
                        class="h-full rounded-full transition-[width] duration-75"
                        :style="{ width: (activeWeapon.reloading ? activeWeapon.reloadProgress : activeWeapon.ammo / activeWeapon.magazine) * 100 + '%', background: activeWeapon.color, boxShadow: `0 0 12px ${activeWeapon.color}` }"
                    />
                </div>
            </div>

            <!-- Status pills + toast: bottom centre -->
            <div class="absolute bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
                <Transition name="fade">
                    <div v-if="toast" class="rounded-full border border-white/10 bg-black/50 px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] backdrop-blur-md" :style="{ color: toast.color }">{{ toast.text }}</div>
                </Transition>
                <div v-if="hud.overdrive > 0 || hud.frenzy > 0 || hud.chrono || hud.haste > 0" class="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.3em]">
                    <span v-if="hud.overdrive > 0" class="rounded-full border border-red-400/50 px-2.5 py-0.5 text-red-300">Overdrive {{ hud.overdrive.toFixed(0) }}s</span>
                    <span v-if="hud.haste > 0" class="rounded-full border border-yellow-300/50 px-2.5 py-0.5 text-yellow-200">Haste {{ hud.haste.toFixed(0) }}s</span>
                    <span v-if="hud.frenzy > 0" class="rounded-full border border-orange-400/50 px-2.5 py-0.5 text-orange-300">Frenzy ×{{ hud.frenzy }}</span>
                    <span v-if="hud.chrono" class="rounded-full border border-cyan-300/50 px-2.5 py-0.5 text-cyan-200">Chrono</span>
                </div>
            </div>
        </div>

        <!-- Wave banner -->
        <Transition name="banner">
            <div v-if="banner" class="pointer-events-none absolute inset-x-0 top-[28%] flex flex-col items-center">
                <div class="text-[11px] uppercase tracking-[0.7em] text-white/60">{{ banner.subtitle }}</div>
                <div
                    class="mt-2 text-6xl font-black uppercase tracking-[0.18em] drop-shadow-[0_6px_30px_rgba(0,0,0,0.8)] sm:text-7xl"
                    :class="banner.tone === 'boss' ? 'text-orange-300' : banner.tone === 'clear' ? 'text-lime-300' : 'text-white'"
                >{{ banner.title }}</div>
                <div class="mt-3 h-px w-40 bg-gradient-to-r from-transparent via-white/70 to-transparent" />
            </div>
        </Transition>

        <!-- Main menu -->
        <div v-if="hud.phase === 'menu'" class="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-black/70 via-black/40 to-black/80">
            <div class="mx-4 w-full max-w-3xl rounded-3xl bg-gradient-to-r from-black/75 via-black/55 to-transparent p-8 sm:p-10">
                <div class="text-[11px] uppercase tracking-[0.7em] text-cyan-300/80">Wave survival · Rogue-like</div>
                <h1 class="mt-3 text-7xl font-black uppercase leading-none tracking-tight sm:text-8xl">
                    <span class="bg-gradient-to-r from-cyan-200 via-white to-cyan-300 bg-clip-text text-transparent drop-shadow-[0_0_40px_rgba(63,240,255,0.35)]">Voxel</span>
                    <span class="text-white/90"> Arena</span>
                </h1>
                <p class="mt-5 max-w-xl text-sm leading-relaxed text-white/60">
                    Hold the arena against waves of voxel constructs. Shoot, slash, slide and bullet-jump, then draft up to
                    three upgrades between waves. Every fifth wave a Titan drops in, and the arena itself turns on you in between.
                </p>
                <div class="mt-8 grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-3">
                    <div v-for="c in controls" :key="c[0]" class="flex items-center gap-3 text-xs">
                        <span class="min-w-16 rounded border border-white/15 bg-white/5 px-2 py-1 text-center font-mono text-[10px] font-semibold uppercase tracking-wider text-white/80">{{ c[0] }}</span>
                        <span class="text-white/55">{{ c[1] }}</span>
                    </div>
                </div>
                <div class="mt-8">
                    <div class="text-[10px] uppercase tracking-[0.5em] text-white/40">Loadout</div>
                    <div class="mt-2 grid grid-cols-3 gap-2">
                        <button
                            v-for="w in starters"
                            :key="w.id"
                            type="button"
                            class="rounded-xl border p-3 text-left transition-all"
                            :class="starter === w.id ? 'border-cyan-300/70 bg-cyan-300/10 shadow-[0_0_24px_-6px_rgba(63,240,255,0.7)]' : 'border-white/10 bg-white/5 hover:border-white/25'"
                            @click="starter = w.id"
                        >
                            <div class="text-xs font-black uppercase tracking-wider" :style="{ color: starter === w.id ? '#a5f3fc' : '#fff' }">{{ w.name }}</div>
                            <div class="mt-1 text-[11px] leading-snug text-white/50">{{ w.tagline }}</div>
                        </button>
                    </div>
                </div>
                <div class="mt-6 flex flex-wrap items-center gap-3">
                    <UButton size="xl" color="primary" icon="i-lucide-swords" class="px-7 font-black uppercase tracking-[0.3em]" @click="start">Deploy</UButton>
                    <UButton size="xl" color="neutral" variant="ghost" :icon="muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'" @click="toggleMute">{{ muted ? 'Unmute' : 'Sound' }}</UButton>
                    <UButton size="xl" color="neutral" variant="ghost" icon="i-lucide-sparkles" @click="toggleQuality">FX {{ quality }}</UButton>
                    <UButton size="xl" color="neutral" variant="ghost" icon="i-lucide-arrow-left" to="/">Back</UButton>
                    <div v-if="best" class="ml-auto text-right">
                        <div class="text-[10px] uppercase tracking-[0.4em] text-white/40">Best run</div>
                        <div class="mt-1 font-mono text-sm text-white/80">Wave <span class="font-bold text-cyan-300">{{ best.wave }}</span> · <span class="font-bold text-amber-300">{{ formatNumber(best.score, false) }}</span></div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Pause -->
        <div v-else-if="hud.phase === 'paused'" class="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div class="w-72 text-center">
                <div class="text-[11px] uppercase tracking-[0.7em] text-white/50">Wave {{ hud.wave }} · {{ formatNumber(hud.score, false) }}</div>
                <div class="mt-2 text-4xl font-black uppercase tracking-[0.3em]">Paused</div>
                <div class="mx-auto mt-4 h-px w-24 bg-gradient-to-r from-transparent via-white/60 to-transparent" />
                <div class="mt-6 flex flex-col gap-2">
                    <UButton block size="lg" color="primary" icon="i-lucide-play" class="font-bold uppercase tracking-[0.3em]" @click="resume">Resume</UButton>
                    <UButton block size="lg" color="neutral" variant="ghost" :icon="muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'" @click="toggleMute">{{ muted ? 'Unmute' : 'Mute' }}</UButton>
                    <UButton block size="lg" color="neutral" variant="ghost" icon="i-lucide-sparkles" @click="toggleQuality">Effects: {{ quality }}</UButton>
                    <UButton block size="lg" color="neutral" variant="ghost" icon="i-lucide-rotate-ccw" @click="start">Restart</UButton>
                    <UButton block size="lg" color="neutral" variant="ghost" icon="i-lucide-log-out" to="/">Leave arena</UButton>
                </div>
            </div>
        </div>

        <!-- Upgrade draft -->
        <div v-else-if="hud.phase === 'draft'" class="absolute inset-0 flex items-center justify-center overflow-y-auto bg-black/65 p-4 backdrop-blur-md sm:p-8">
            <div class="w-full max-w-5xl">
                <div class="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <div class="text-[11px] uppercase tracking-[0.7em] text-lime-300/80">Wave {{ hud.wave }} cleared</div>
                        <h2 class="mt-2 text-4xl font-black uppercase tracking-tight">Draft</h2>
                        <p class="mt-1 text-xs text-white/50">Choose up to {{ DRAFT_PICKS }}. Weapons join your loadout; a fourth replaces the one in your hands.</p>
                    </div>
                    <div class="flex items-center gap-4">
                        <UButton size="lg" color="neutral" variant="ghost" icon="i-lucide-dices" :disabled="hud.rerolls <= 0" class="uppercase tracking-[0.25em]" @click="reroll">Reroll {{ hud.rerolls > 0 ? '' : '· used' }}</UButton>
                        <div class="flex items-center gap-1.5">
                            <span v-for="i in DRAFT_PICKS" :key="i" class="size-2 rounded-full transition-colors" :class="i <= selected.length ? 'bg-cyan-300 shadow-[0_0_8px_rgba(63,240,255,0.8)]' : 'bg-white/20'" />
                        </div>
                        <UButton size="xl" color="primary" icon="i-lucide-swords" class="px-6 font-black uppercase tracking-[0.3em]" @click="deploy">{{ selected.length ? 'Deploy' : 'Skip' }}</UButton>
                    </div>
                </div>
                <div class="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
                    <button
                        v-for="card in draft"
                        :key="card.draftKey"
                        type="button"
                        class="draft-card group relative flex flex-col overflow-hidden rounded-2xl border bg-zinc-950/80 p-5 text-left transition-all duration-150 hover:-translate-y-0.5 hover:bg-zinc-900/80"
                        :class="isSelected(card) ? 'border-[var(--card-color)] shadow-[0_0_40px_-8px_var(--card-color)]' : 'border-white/10'"
                        :style="{ '--card-color': RARITY_COLOR[card.rarity] }"
                        @click="toggle(card)"
                    >
                        <div class="absolute inset-x-0 top-0 h-px opacity-80" :style="{ background: `linear-gradient(90deg, transparent, ${RARITY_COLOR[card.rarity]}, transparent)` }" />
                        <div class="flex items-center justify-between">
                            <span class="text-[9px] font-semibold uppercase tracking-[0.35em]" :style="{ color: RARITY_COLOR[card.rarity] }">{{ RARITY_LABEL[card.rarity] }} · {{ card.kind === 'weapon' ? 'weapon' : card.kind === 'crazy' ? 'mutation' : 'upgrade' }}</span>
                            <span v-if="isSelected(card)" class="flex size-5 items-center justify-center rounded-full font-mono text-[10px] font-black text-black" :style="{ background: RARITY_COLOR[card.rarity] }">{{ selected.indexOf(card.draftKey) + 1 }}</span>
                        </div>
                        <div class="mt-4 flex items-center gap-3">
                            <span class="flex size-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5">
                                <UIcon :name="card.icon" class="size-5" :style="{ color: RARITY_COLOR[card.rarity] }" />
                            </span>
                            <span class="text-base font-black uppercase leading-tight tracking-wide">{{ card.name }}</span>
                        </div>
                        <p class="mt-3 text-xs leading-relaxed text-white/55">{{ card.description }}</p>
                    </button>
                </div>
            </div>
        </div>

        <!-- Game over -->
        <div v-else-if="hud.phase === 'dead' && summary" class="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-md">
            <div class="mx-4 w-full max-w-2xl">
                <div class="text-[11px] uppercase tracking-[0.7em] text-red-400/80">Signal lost</div>
                <h2 class="mt-2 text-5xl font-black uppercase tracking-tight sm:text-6xl">Shattered</h2>
                <div v-if="summary.newBest" class="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-300/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-amber-300"><UIcon name="i-lucide-trophy" class="size-3" />New personal best</div>
                <div class="mt-7 grid grid-cols-2 gap-6 sm:grid-cols-5">
                    <div v-for="s in summaryStats" :key="s.label">
                        <div class="text-[10px] uppercase tracking-[0.4em] text-white/40">{{ s.label }}</div>
                        <div class="mt-1 font-mono text-2xl font-black tabular-nums" :class="s.color">{{ s.value }}</div>
                    </div>
                </div>
                <div v-if="summary.upgrades.length" class="mt-6">
                    <div class="text-[10px] uppercase tracking-[0.4em] text-white/40">Build</div>
                    <div class="mt-2 flex flex-wrap gap-1.5">
                        <span v-for="(u, i) in summary.upgrades" :key="i" class="rounded-full border border-white/10 px-2.5 py-0.5 text-[11px] text-white/70">{{ u }}</span>
                    </div>
                </div>
                <div class="mt-5 text-xs text-white/40">Best · wave {{ summary.bestWave }} · {{ formatNumber(summary.bestScore, false) }}</div>
                <div class="mt-7 flex flex-wrap gap-3">
                    <UButton size="xl" color="primary" icon="i-lucide-rotate-ccw" class="px-7 font-black uppercase tracking-[0.3em]" @click="start">Run it back</UButton>
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
import type { DraftCard, WeaponId } from '~/utils/voxel-arena/types'
import { RARITY_COLOR, RARITY_LABEL, DRAFT_PICKS } from '~/utils/voxel-arena/upgrades'
import { WEAPONS, STARTER_WEAPONS } from '~/utils/voxel-arena/data'

const viewport = ref<HTMLDivElement | null>(null)
const hud = reactive(createHud())
let game: VoxelArenaGame | null = null

const banner = ref<{ title: string, subtitle: string, tone: string } | null>(null)
let bannerTimer: number | undefined
const toast = ref<{ text: string, color: string } | null>(null)
let toastTimer: number | undefined
const draft = ref<DraftCard[]>([])
const selected = ref<string[]>([])
const summary = ref<RunSummary | null>(null)
const muted = ref(false)
const best = ref<{ wave: number, score: number } | null>(null)
const quality = ref<'high' | 'low'>('high')
const route = useRoute()
const starter = ref<WeaponId>('pulse')
const starters = STARTER_WEAPONS.map(id => WEAPONS[id])

const controls: [string, string][] = [
    ['WASD', 'Move'],
    ['LMB', 'Shoot'],
    ['RMB', 'Aim · glide in the air'],
    ['F', 'Slash combo · slam from the air'],
    ['Ctrl', 'Slide'],
    ['Ctrl + Space', 'Bullet jump'],
    ['Shift', 'Dash'],
    ['Space', 'Jump · double jump'],
    ['Q', 'Nova burst'],
    ['E', 'Sentry turret'],
    ['R', 'Reload'],
    ['1-3 / Wheel', 'Switch weapon'],
    ['Esc', 'Pause']
]

const lowHealth = computed(() => hud.health / hud.maxHealth < 0.3)
const novaReady = computed(() => hud.energy >= hud.abilityCost)
const waveProgress = computed(() => hud.waveTotal > 0 ? Math.max(0, Math.min(100, (1 - hud.remaining / hud.waveTotal) * 100)) : 0)
const activeWeapon = computed(() => hud.weapons[hud.activeWeapon] ?? null)
const comboColor = computed(() => hud.combo >= 20 ? 'text-fuchsia-300' : hud.combo >= 10 ? 'text-orange-300' : 'text-amber-200')
const hitColor = computed(() => ({ kill: 'bg-lime-300', crit: 'bg-yellow-300', head: 'bg-orange-300', block: 'bg-cyan-300', hit: 'bg-red-400' })[hud.hitKind])
const eventLabel = computed(() => ({ meteors: 'Meteor storm', frenzy: 'Frenzy', blackout: 'Blackout', bounty: 'Bounty', none: '' })[hud.event])
const eventClass = computed(() => ({ meteors: 'border-orange-400/50 text-orange-300', frenzy: 'border-red-400/50 text-red-300', blackout: 'border-indigo-300/50 text-indigo-200', bounty: 'border-amber-300/60 text-amber-200', none: '' })[hud.event])

const summaryStats = computed(() => {
    const s = summary.value
    if (!s) return []
    return [
        { label: 'Wave', value: String(s.wave), color: 'text-cyan-300' },
        { label: 'Score', value: formatNumber(s.score, false), color: 'text-amber-300' },
        { label: 'Kills', value: String(s.kills), color: 'text-white' },
        { label: 'Headshots', value: String(s.headshots), color: 'text-orange-300' },
        { label: 'Survived', value: formatTime(s.time), color: 'text-white' }
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
    toast.value = { text, color }
    if (toastTimer) window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => { toast.value = null }, 2200)
}

function start(): void {
    summary.value = null
    game?.start(starter.value)
}

function reroll(): void {
    selected.value = []
    game?.rerollDraft()
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
    if (toastTimer) window.clearTimeout(toastTimer)
    game?.dispose()
    game = null
})
</script>

<style scoped>
.banner-enter-active,
.banner-leave-active {
    transition: opacity 0.4s ease, transform 0.4s ease;
}

.banner-enter-from {
    opacity: 0;
    transform: translateY(-14px);
    letter-spacing: 0.4em;
}

.banner-leave-to {
    opacity: 0;
    transform: translateY(10px);
}

.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}

.speed-lines {
    background: repeating-conic-gradient(from 0deg at 50% 50%, rgba(255, 255, 255, 0.14) 0deg 1.2deg, transparent 1.2deg 9deg);
    mask-image: radial-gradient(circle at 50% 50%, transparent 34%, black 80%);
    -webkit-mask-image: radial-gradient(circle at 50% 50%, transparent 34%, black 80%);
    opacity: 0.55;
}
</style>
