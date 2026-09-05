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
        <div class="pointer-events-none absolute inset-0" style="box-shadow: inset 0 0 140px 20px rgba(0,0,0,0.5)" />
        <div class="pointer-events-none absolute inset-0 transition-opacity duration-100" :style="{ opacity: hud.hurt, boxShadow: 'inset 0 0 200px 60px rgba(220,30,40,0.55)' }" />
        <div v-if="lowHealth && hud.phase === 'playing'" class="pointer-events-none absolute inset-0 animate-pulse" style="box-shadow: inset 0 0 240px 80px rgba(160,0,10,0.45)" />
        <div v-if="hud.shield > 0" class="pointer-events-none absolute inset-0" style="box-shadow: inset 0 0 120px 10px rgba(125,211,252,0.22)" />
        <div v-if="hud.dashing > 0" class="pointer-events-none absolute inset-0 speed-lines" />
        <div v-if="hud.overdrive > 0" class="pointer-events-none absolute inset-0" style="box-shadow: inset 0 0 180px 40px rgba(255,70,40,0.22)" />
        <div v-if="hud.chrono" class="pointer-events-none absolute inset-0" style="box-shadow: inset 0 0 220px 70px rgba(60,220,255,0.25)" />
        <div v-if="hud.event === 'blackout' && hud.phase === 'playing'" class="pointer-events-none absolute inset-0" style="box-shadow: inset 0 0 280px 110px rgba(0,0,0,0.8)" />

        <!-- Damage direction: a red wedge on the side the hit came from -->
        <div v-if="hud.phase === 'playing'" class="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
                v-for="h in hud.hits"
                :key="h.id"
                class="hit-marker absolute"
                :style="{ transform: `rotate(${h.angle}rad) translateY(-${110 + (1 - h.life) * 30}px)`, opacity: Math.min(1, h.life * 1.6) }"
            />
        </div>

        <!-- Crosshair: opens with real spread, fades out while aiming -->
        <div v-if="hud.phase === 'playing' && hud.locked" class="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div class="relative size-24 transition-opacity duration-100" :style="{ opacity: Math.max(0, 1 - hud.ads * 2) }">
                <span
                    v-for="(rot, i) in [0, 90, 180, 270]"
                    :key="i"
                    class="absolute left-1/2 top-1/2 h-2.5 w-px origin-center transition-colors duration-75"
                    :class="hud.hitMarker > 0 ? hitColor : 'bg-white/85'"
                    :style="{ transform: `rotate(${rot}deg) translateY(${-(6 + spreadGap + (hud.hitMarker > 0 ? 3 : 0))}px)` }"
                />
                <span class="absolute left-1/2 top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full" :class="hud.hitMarker > 0 ? hitColor : 'bg-white'" />
            </div>
            <div class="absolute left-1/2 top-1/2 -translate-x-1/2 translate-y-8 text-center">
                <span v-if="hud.hitKind === 'head' && hud.hitMarker > 0" class="block text-[9px] font-bold uppercase tracking-[0.35em] text-orange-300">Headshot</span>
                <span v-if="hud.gliding" class="block text-[9px] uppercase tracking-[0.35em] text-cyan-300/80">Glide</span>
                <span v-if="hud.lance >= 1" class="block animate-pulse text-[9px] font-bold uppercase tracking-[0.35em] text-amber-200">Sun lance ready</span>
            </div>
            <div v-if="hud.lance > 0 && hud.lance < 1" class="absolute left-1/2 top-1/2 mt-8 h-px w-16 -translate-x-1/2 translate-y-2 overflow-hidden bg-white/10">
                <div class="h-full bg-amber-300" :style="{ width: (hud.lance * 100) + '%' }" />
            </div>
        </div>

        <!-- Sights: deliberately minimal so the target stays visible -->
        <div v-if="hud.phase === 'playing' && sightOpacity > 0" class="pointer-events-none absolute inset-0 flex items-center justify-center" :style="{ opacity: sightOpacity }">
            <template v-if="hud.sight === 'reddot'">
                <div class="relative flex size-14 items-center justify-center rounded-full border border-white/10">
                    <span class="size-1.5 rounded-full bg-red-500 shadow-[0_0_5px_1px_rgba(255,40,40,0.9)]" />
                </div>
            </template>
            <template v-else-if="hud.sight === 'holo'">
                <div class="relative flex size-12 items-center justify-center rounded-full border border-red-500/80 shadow-[0_0_6px_rgba(255,60,60,0.5)]">
                    <span class="size-1 rounded-full bg-red-500 shadow-[0_0_5px_1px_rgba(255,40,40,0.9)]" />
                </div>
            </template>
            <template v-else-if="hud.sight === 'ring'">
                <div class="relative flex size-14 items-center justify-center rounded-full border border-lime-300/80 shadow-[0_0_6px_rgba(125,255,90,0.5)]">
                    <span class="size-1.5 rounded-full bg-lime-300 shadow-[0_0_5px_1px_rgba(125,255,90,0.9)]" />
                </div>
            </template>
            <template v-else-if="hud.sight === 'iron'">
                <div class="relative flex size-10 items-center justify-center">
                    <span class="absolute left-1/2 top-1/2 h-3 w-0.5 -translate-x-1/2 bg-orange-300 shadow-[0_0_4px_rgba(255,162,58,0.9)]" />
                </div>
            </template>
            <template v-else-if="hud.sight === 'scope'">
                <div class="scope-mask absolute inset-0" />
                <div class="relative flex size-[76vmin] items-center justify-center rounded-full border border-white/10">
                    <span class="absolute left-1/2 top-0 h-full w-px bg-black/60" />
                    <span class="absolute top-1/2 left-0 h-px w-full bg-black/60" />
                    <span class="size-1.5 rounded-full bg-red-500 shadow-[0_0_6px_2px_rgba(255,40,40,0.9)]" />
                    <span class="absolute bottom-[12%] font-mono text-[10px] tracking-[0.4em] text-white/40">BOLT · 4×</span>
                </div>
            </template>
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

            <!-- Run stats + minimap: top-left -->
            <div class="absolute left-5 top-5 sm:left-7 sm:top-7">
                <div class="flex items-center gap-4 font-mono text-[11px] tabular-nums text-white/55">
                    <span class="flex items-center gap-1.5"><UIcon name="i-lucide-timer" class="size-3.5" />{{ formatTime(hud.time) }}</span>
                    <span class="flex items-center gap-1.5"><UIcon name="i-lucide-skull" class="size-3.5" />{{ hud.kills }}</span>
                    <span class="flex items-center gap-1.5"><UIcon name="i-lucide-crosshair" class="size-3.5" />{{ hud.headshots }}</span>
                </div>
                <canvas ref="minimap" width="150" height="150" class="mt-3 size-[150px] rounded-full opacity-90 shadow-[0_0_24px_rgba(0,0,0,0.6)]" />
            </div>

            <!-- Score + credits: top-right -->
            <div class="absolute right-5 top-5 text-right sm:right-7 sm:top-7">
                <div class="text-[10px] uppercase tracking-[0.5em] text-white/50">Score</div>
                <div class="font-mono text-3xl font-black leading-none tabular-nums text-amber-300">{{ formatNumber(hud.score, false) }}</div>
                <div class="mt-2 flex items-center justify-end gap-1.5 font-mono text-sm font-bold tabular-nums text-amber-200">
                    <UIcon name="i-lucide-coins" class="size-3.5" />{{ hud.credits }}
                </div>
                <Transition name="fade">
                    <div v-if="hud.combo > 1" class="mt-2 flex flex-col items-end">
                        <div class="font-mono text-sm font-bold tabular-nums" :class="comboColor">×{{ hud.combo }}</div>
                        <div class="mt-1 h-px w-24 overflow-hidden bg-white/15">
                            <div class="h-full bg-current transition-[width] duration-75" :class="comboColor" :style="{ width: (hud.comboFill * 100) + '%' }" />
                        </div>
                    </div>
                </Transition>
            </div>

            <!-- Vitals + abilities: bottom-left -->
            <div class="absolute bottom-6 left-5 w-72 sm:bottom-8 sm:left-7">
                <div class="flex items-end justify-between">
                    <div class="flex items-baseline gap-1.5">
                        <span class="font-mono text-5xl font-black leading-none tabular-nums" :class="lowHealth ? 'text-red-400' : 'text-white'">{{ Math.ceil(hud.health) }}</span>
                        <span class="font-mono text-xs text-white/40">/ {{ hud.maxHealth }}</span>
                    </div>
                    <div class="flex items-center gap-1 pb-1">
                        <span v-for="i in hud.dashMax" :key="i" class="h-1 w-6 overflow-hidden rounded-full bg-white/15">
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
                <template v-if="hasAbilities">
                    <div class="mt-2.5 flex items-center gap-2">
                        <UIcon name="i-lucide-battery-charging" class="size-3 text-cyan-300/70" />
                        <div class="relative h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                            <div class="h-full rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(63,240,255,0.6)] transition-[width] duration-100" :style="{ width: (hud.energy / hud.energyMax * 100) + '%' }" />
                        </div>
                        <span class="font-mono text-[10px] tabular-nums text-white/40">{{ Math.floor(hud.energy) }}</span>
                    </div>
                    <div class="mt-2 flex gap-2">
                        <div
                            v-for="(a, i) in hud.abilities"
                            :key="i"
                            class="flex flex-1 items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors"
                            :class="a ? (hud.energy >= a.cost ? 'border-white/25 bg-white/5' : 'border-white/10 opacity-50') : 'border-dashed border-white/10 opacity-40'"
                        >
                            <span class="rounded border px-1.5 font-mono text-[10px] font-bold leading-4" :style="a && hud.energy >= a.cost ? { borderColor: a.color, color: a.color, boxShadow: `0 0 8px ${a.color}66` } : {}">{{ i === 0 ? 'Q' : 'E' }}</span>
                            <template v-if="a">
                                <UIcon :name="a.icon" class="size-3.5" :style="{ color: a.color }" />
                                <span class="truncate text-[10px] font-semibold uppercase tracking-[0.2em]">{{ a.name }}</span>
                                <span class="ml-auto font-mono text-[10px] tabular-nums text-white/40">{{ a.cost }}</span>
                            </template>
                            <span v-else class="text-[10px] uppercase tracking-[0.2em] text-white/50">Empty</span>
                        </div>
                    </div>
                </template>
            </div>

            <!-- Weapon: bottom-right -->
            <div class="absolute bottom-6 right-5 flex flex-col items-end sm:bottom-8 sm:right-7">
                <div class="flex items-center gap-1.5">
                    <span
                        v-for="(w, i) in hud.weapons"
                        :key="w.id"
                        class="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.25em] transition-all"
                        :class="i === hud.activeWeapon ? 'border-white/30 bg-white/10 text-white' : w.ammo + w.reserve === 0 ? 'border-red-400/30 text-red-300/50' : 'border-white/10 text-white/35'"
                    >{{ i + 1 }} · {{ w.name }}<span v-if="i !== hud.activeWeapon" class="font-mono tracking-normal opacity-70">{{ w.ammo + w.reserve }}</span></span>
                </div>
                <div v-if="activeWeapon" class="mt-2 flex items-baseline gap-2 transition-opacity" :class="hud.held === 'melee' ? 'opacity-50' : ''">
                    <span v-if="activeWeapon.reloading" class="text-[10px] uppercase tracking-[0.4em] text-white/50">Reloading</span>
                    <span v-else class="font-mono text-5xl font-black leading-none tabular-nums" :class="activeWeapon.ammo === 0 ? 'text-red-400' : 'text-white'">{{ activeWeapon.ammo }}</span>
                    <span class="font-mono text-xs text-white/40">/ {{ activeWeapon.magazine }}</span>
                    <span class="ml-1 font-mono text-sm tabular-nums" :class="activeWeapon.reserve === 0 ? 'text-red-400' : 'text-white/60'">{{ activeWeapon.reserve }}</span>
                    <span class="text-[9px] uppercase tracking-[0.3em] text-white/35">reserve</span>
                </div>
                <div v-if="activeWeapon" class="mt-2 h-1 w-56 overflow-hidden rounded-full bg-white/10">
                    <div
                        class="h-full rounded-full transition-[width] duration-75"
                        :style="{ width: (activeWeapon.reloading ? activeWeapon.reloadProgress : activeWeapon.ammo / activeWeapon.magazine) * 100 + '%', background: activeWeapon.color, boxShadow: `0 0 12px ${activeWeapon.color}` }"
                    />
                </div>
                <div class="mt-2 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.25em] transition-colors" :class="hud.held === 'melee' ? 'text-white' : 'text-white/50'">
                    <span class="rounded border px-1.5 font-mono leading-4" :class="hud.held === 'melee' ? 'border-white/60' : 'border-white/15'">F</span>
                    <span :style="{ color: hud.melee.color }">{{ hud.melee.name }}</span>
                    <span class="ml-1 flex items-center gap-1">
                        <span v-for="i in 3" :key="i" class="h-1 w-3 rounded-full transition-colors" :class="i <= hud.combo3 ? 'bg-white' : 'bg-white/15'" />
                    </span>
                </div>
            </div>

            <!-- Status pills + toast: bottom centre -->
            <div class="absolute bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
                <Transition name="fade">
                    <div v-if="toast" class="rounded-full border border-white/10 bg-black/50 px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] backdrop-blur-md" :style="{ color: toast.color }">{{ toast.text }}</div>
                </Transition>
                <div v-if="hud.overdrive > 0 || hud.frenzy > 0 || hud.chrono || hud.haste > 0 || hud.turrets > 0" class="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.3em]">
                    <span v-if="hud.overdrive > 0" class="rounded-full border border-red-400/50 px-2.5 py-0.5 text-red-300">Overdrive {{ hud.overdrive.toFixed(0) }}s</span>
                    <span v-if="hud.haste > 0" class="rounded-full border border-yellow-300/50 px-2.5 py-0.5 text-yellow-200">Haste {{ hud.haste.toFixed(0) }}s</span>
                    <span v-if="hud.frenzy > 0" class="rounded-full border border-orange-400/50 px-2.5 py-0.5 text-orange-300">Frenzy ×{{ hud.frenzy }}</span>
                    <span v-if="hud.chrono" class="rounded-full border border-cyan-300/50 px-2.5 py-0.5 text-cyan-200">Chrono</span>
                    <span v-if="hud.turrets > 0" class="rounded-full border border-amber-300/50 px-2.5 py-0.5 text-amber-200">Sentry ×{{ hud.turrets }}</span>
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
                    Hold the arena against waves of voxel constructs. Shoot, slash, slide and bullet-jump. Every cleared wave pays
                    credits; spend them in the arsenal on guns, ammo, blades, abilities and three random boons. Only boons make you stronger.
                </p>
                <div class="mt-8 grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-3">
                    <div v-for="c in controls" :key="c[0]" class="flex items-center gap-3 text-xs">
                        <span class="min-w-16 rounded border border-white/15 bg-white/5 px-2 py-1 text-center font-mono text-[10px] font-semibold uppercase tracking-wider text-white/80">{{ c[0] }}</span>
                        <span class="text-white/55">{{ c[1] }}</span>
                    </div>
                </div>
                <div class="mt-8 flex flex-wrap items-center gap-3">
                    <UButton size="xl" color="primary" icon="i-lucide-swords" class="px-7 font-black uppercase tracking-[0.3em]" @click="start">Deploy</UButton>
                    <UButton size="xl" color="neutral" variant="ghost" :icon="muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'" @click="toggleMute">{{ muted ? 'Unmute' : 'Sound' }}</UButton>
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
                    <UButton block size="lg" color="neutral" variant="ghost" icon="i-lucide-rotate-ccw" @click="start">Restart</UButton>
                    <UButton block size="lg" color="neutral" variant="ghost" icon="i-lucide-log-out" to="/">Leave arena</UButton>
                </div>
            </div>
        </div>

        <!-- Arsenal -->
        <div v-else-if="hud.phase === 'draft' && shop" class="absolute inset-0 overflow-y-auto bg-black/75 backdrop-blur-md">
            <div class="mx-auto flex min-h-full w-full max-w-7xl flex-col p-4 sm:p-6">
                <div class="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <div class="text-[11px] uppercase tracking-[0.7em] text-lime-300/80">Wave {{ shop.wave }} cleared · <span class="text-amber-200">+{{ shop.income }} credits</span></div>
                        <h2 class="mt-1 text-4xl font-black uppercase tracking-tight">Arsenal</h2>
                    </div>
                    <div class="flex items-center gap-5">
                        <div class="text-right">
                            <div class="text-[10px] uppercase tracking-[0.4em] text-white/40">Credits</div>
                            <div class="flex items-center justify-end gap-1.5 font-mono text-3xl font-black tabular-nums text-amber-200"><UIcon name="i-lucide-coins" class="size-5" />{{ shop.credits }}</div>
                        </div>
                        <UButton size="xl" color="primary" icon="i-lucide-swords" class="px-7 font-black uppercase tracking-[0.3em]" @click="deploy">Deploy</UButton>
                    </div>
                </div>

                <div class="mt-5 grid gap-4 lg:grid-cols-12">
                    <!-- Boons -->
                    <section class="lg:col-span-3">
                        <div class="flex items-center justify-between">
                            <h3 class="text-[10px] font-semibold uppercase tracking-[0.4em] text-white/50">Boons</h3>
                            <button type="button" class="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.2em] transition-colors" :class="shop.credits >= shop.rerollCost ? 'text-white/70 hover:text-white' : 'text-white/25'" :disabled="shop.credits < shop.rerollCost" @click="reroll"><UIcon name="i-lucide-dices" class="size-3.5" />Reroll · {{ shop.rerollCost }}</button>
                        </div>
                        <div class="mt-3 flex flex-col gap-3">
                            <button
                                v-for="card in shop.boons"
                                :key="card.draftKey"
                                type="button"
                                class="boon relative flex flex-col overflow-hidden rounded-2xl border p-4 text-left transition-all duration-150"
                                :class="shop.credits >= card.cost ? 'cursor-pointer border-white/10 hover:-translate-y-0.5 hover:border-[var(--card-color)]' : 'cursor-not-allowed border-white/5 opacity-45'"
                                :style="{ '--card-color': RARITY_COLOR[card.rarity] }"
                                @click="buyBoon(card)"
                            >
                                <div class="absolute inset-x-0 top-0 h-px opacity-90" :style="{ background: `linear-gradient(90deg, transparent, ${RARITY_COLOR[card.rarity]}, transparent)` }" />
                                <div class="flex items-center justify-between">
                                    <span class="text-[9px] font-semibold uppercase tracking-[0.35em]" :style="{ color: RARITY_COLOR[card.rarity] }">{{ RARITY_LABEL[card.rarity] }}<template v-if="card.owned"> · ×{{ card.owned }} owned</template></span>
                                    <span class="flex items-center gap-1 font-mono text-xs font-bold tabular-nums" :class="shop.credits >= card.cost ? 'text-amber-200' : 'text-white/40'"><UIcon name="i-lucide-coins" class="size-3" />{{ card.cost }}</span>
                                </div>
                                <div class="mt-3 flex items-center gap-3">
                                    <span class="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 shadow-[inset_0_0_18px_-6px_var(--card-color)]">
                                        <UIcon :name="card.icon" class="size-5" :style="{ color: RARITY_COLOR[card.rarity] }" />
                                    </span>
                                    <span class="text-sm font-black uppercase leading-tight tracking-wide">{{ card.name }}</span>
                                </div>
                                <p class="mt-2 text-[11px] leading-relaxed text-white/55">{{ card.description }}</p>
                            </button>
                            <div v-if="shop.boons.length === 0" class="rounded-2xl border border-dashed border-white/10 p-6 text-center text-[10px] uppercase tracking-[0.3em] text-white/40">All taken — reroll or deploy</div>
                        </div>
                    </section>

                    <!-- Catalogue -->
                    <section class="lg:col-span-4">
                        <div class="flex rounded-xl border border-white/10 bg-white/5 p-0.5 text-[10px] font-semibold uppercase tracking-[0.25em]">
                            <button v-for="tab in shopTabs" :key="tab.id" type="button" class="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 transition-colors" :class="shopTab === tab.id ? 'bg-white/15 text-white' : 'text-white/45 hover:text-white/80'" @click="shopTab = tab.id"><UIcon :name="tab.icon" class="size-3.5" />{{ tab.label }}</button>
                        </div>
                        <div class="mt-3 flex flex-col gap-1">
                            <template v-if="shopTab === 'weapon'">
                                <button
                                    v-for="w in listedGuns"
                                    :key="w.id"
                                    type="button"
                                    class="flex items-center gap-3 rounded-xl border px-2 py-1.5 text-left transition-colors"
                                    :class="isSelected('weapon', w.id) ? 'border-[var(--card-color)] bg-white/10' : 'border-transparent hover:bg-white/5'"
                                    :style="{ '--card-color': RARITY_COLOR[w.rarity] }"
                                    @click="select('weapon', w.id)"
                                >
                                    <img :src="thumbs['weapon:' + w.id]" alt="" class="h-9 w-16 shrink-0 object-contain" draggable="false">
                                    <div class="min-w-0 flex-1">
                                        <div class="truncate text-xs font-black uppercase tracking-wider" :style="{ color: RARITY_COLOR[w.rarity] }">{{ w.name }}</div>
                                        <div class="text-[9px] uppercase tracking-[0.25em] text-white/40">{{ RARITY_LABEL[w.rarity] }} · {{ w.magazine }} / {{ w.reserveMax }}</div>
                                    </div>
                                    <span v-if="w.owned" class="flex items-center gap-1 rounded border border-white/25 px-1.5 font-mono text-[10px] font-bold leading-4" :class="w.reserve === 0 ? 'text-red-300' : ''">{{ w.slot + 1 }}<span class="text-white/40">·</span>{{ w.reserve }}</span>
                                    <span v-else class="flex items-center gap-1 font-mono text-[11px] tabular-nums" :class="shop.credits >= w.price ? 'text-amber-200' : 'text-white/35'"><UIcon name="i-lucide-coins" class="size-3" />{{ w.price }}</span>
                                </button>
                            </template>
                            <template v-else-if="shopTab === 'melee'">
                                <button
                                    v-for="m in shop.melee"
                                    :key="m.id"
                                    type="button"
                                    class="flex items-center gap-3 rounded-xl border px-2 py-1.5 text-left transition-colors"
                                    :class="isSelected('melee', m.id) ? 'border-[var(--card-color)] bg-white/10' : 'border-transparent hover:bg-white/5'"
                                    :style="{ '--card-color': RARITY_COLOR[m.rarity] }"
                                    @click="select('melee', m.id)"
                                >
                                    <img :src="thumbs['melee:' + m.id]" alt="" class="h-9 w-16 shrink-0 object-contain" draggable="false">
                                    <div class="min-w-0 flex-1">
                                        <div class="truncate text-xs font-black uppercase tracking-wider" :style="{ color: RARITY_COLOR[m.rarity] }">{{ m.name }}</div>
                                        <div class="text-[9px] uppercase tracking-[0.25em] text-white/40">{{ RARITY_LABEL[m.rarity] }}</div>
                                    </div>
                                    <span v-if="m.owned" class="rounded border border-white/25 px-1.5 font-mono text-[9px] uppercase leading-4 tracking-widest">In hand</span>
                                    <span v-else class="flex items-center gap-1 font-mono text-[11px] tabular-nums" :class="shop.credits >= m.price ? 'text-amber-200' : 'text-white/35'"><UIcon name="i-lucide-coins" class="size-3" />{{ m.price }}</span>
                                </button>
                            </template>
                            <template v-else>
                                <button
                                    v-for="a in shop.abilities"
                                    :key="a.id"
                                    type="button"
                                    class="flex items-center gap-3 rounded-xl border px-2 py-2 text-left transition-colors"
                                    :class="isSelected('ability', a.id) ? 'border-[var(--card-color)] bg-white/10' : 'border-transparent hover:bg-white/5'"
                                    :style="{ '--card-color': a.color }"
                                    @click="select('ability', a.id)"
                                >
                                    <span class="flex size-9 w-16 shrink-0 items-center justify-center"><UIcon :name="a.icon" class="size-6" :style="{ color: a.color }" /></span>
                                    <div class="min-w-0 flex-1">
                                        <div class="truncate text-xs font-black uppercase tracking-wider">{{ a.name }}</div>
                                        <div class="text-[9px] uppercase tracking-[0.25em] text-white/40">{{ a.energy }} energy</div>
                                    </div>
                                    <span v-if="a.owned" class="rounded border border-white/25 px-1.5 font-mono text-[10px] font-bold leading-4">{{ abilityKey(a.id) }}</span>
                                    <span v-else class="flex items-center gap-1 font-mono text-[11px] tabular-nums" :class="shop.credits >= a.price ? 'text-amber-200' : 'text-white/35'"><UIcon name="i-lucide-coins" class="size-3" />{{ a.price }}</span>
                                </button>
                            </template>
                        </div>
                    </section>

                    <!-- Detail -->
                    <section class="lg:col-span-5">
                        <!-- Gun -->
                        <div v-if="detailGun" class="flex flex-col rounded-3xl border border-white/10 bg-zinc-950/70" :style="{ '--card-color': RARITY_COLOR[detailGun.rarity] }">
                            <div class="relative h-56 overflow-hidden rounded-t-3xl">
                                <div class="absolute inset-0" :style="{ background: `radial-gradient(ellipse at 50% 60%, ${RARITY_COLOR[detailGun.rarity]}33, transparent 65%)` }" />
                                <div ref="previewBox" class="absolute inset-0" />
                                <div class="pointer-events-none absolute inset-x-5 top-4 flex items-start justify-between">
                                    <div>
                                        <div class="text-[9px] font-semibold uppercase tracking-[0.4em]" :style="{ color: RARITY_COLOR[detailGun.rarity] }">{{ RARITY_LABEL[detailGun.rarity] }} · {{ WEAPONS[detailGun.id].auto ? 'full auto' : WEAPONS[detailGun.id].burst > 1 ? `${WEAPONS[detailGun.id].burst}-round burst` : 'semi auto' }}</div>
                                        <div class="mt-1 text-2xl font-black uppercase tracking-tight">{{ detailGun.name }}</div>
                                    </div>
                                    <span v-if="detailGun.owned" class="rounded-lg border border-white/25 bg-black/40 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest">Slot {{ detailGun.slot + 1 }}</span>
                                </div>
                                <p class="pointer-events-none absolute inset-x-5 bottom-4 text-[11px] leading-snug text-white/60">{{ detailGun.tagline }}</p>
                            </div>
                            <div class="flex flex-col gap-4 p-5">
                                <div class="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                                    <div v-for="b in gunBars" :key="b.label" class="flex items-center gap-3">
                                        <span class="w-20 shrink-0 whitespace-nowrap text-[9px] uppercase tracking-[0.25em] text-white/45">{{ b.label }}</span>
                                        <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                                            <div class="h-full rounded-full transition-[width] duration-300" :style="{ width: (b.value * 100) + '%', background: RARITY_COLOR[detailGun.rarity], boxShadow: `0 0 10px ${RARITY_COLOR[detailGun.rarity]}88` }" />
                                        </div>
                                        <span class="w-12 shrink-0 text-right font-mono text-[10px] tabular-nums text-white/70">{{ b.text }}</span>
                                    </div>
                                </div>

                                <template v-if="detailGun.owned">
                                    <div class="rounded-2xl border border-white/10 bg-black/30 p-3">
                                        <div class="flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-white/50">
                                            <span>Reserve ammo</span>
                                            <span class="font-mono tabular-nums" :class="detailGun.reserve === 0 ? 'text-red-400' : 'text-white/80'">{{ detailGun.reserve }} / {{ detailGun.reserveMax }}</span>
                                        </div>
                                        <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                                            <div class="h-full rounded-full bg-amber-300 transition-[width]" :style="{ width: (detailGun.reserveMax > 0 ? detailGun.reserve / detailGun.reserveMax * 100 : 0) + '%' }" />
                                        </div>
                                        <div class="mt-3 flex items-center justify-between gap-2">
                                            <span class="text-[10px] text-white/40">Magazine {{ detailGun.magazine }} · crates drop from kills · boons raise damage and capacity</span>
                                            <UButton size="xs" color="neutral" variant="soft" :disabled="detailGun.refillPrice === 0 || shop.credits < detailGun.refillPrice" class="font-mono" @click="refill(detailGun.id)">
                                                <UIcon name="i-lucide-package" class="size-3" />Refill<template v-if="detailGun.refillPrice > 0"> · {{ detailGun.refillPrice }}</template><template v-else> · full</template>
                                            </UButton>
                                        </div>
                                    </div>
                                </template>
                                <template v-else>
                                    <div class="flex items-center justify-between gap-3">
                                        <span class="text-[10px] text-white/45">Loadout {{ ownedGuns.length }}/{{ shop.maxWeapons }} · comes with a full reserve</span>
                                        <UButton size="lg" color="primary" :disabled="shop.credits < detailGun.price" class="px-5 font-black uppercase tracking-[0.25em]" @click="buyWeapon(detailGun.id)"><UIcon name="i-lucide-coins" class="size-4" />Buy · {{ detailGun.price }}</UButton>
                                    </div>
                                    <div v-if="weaponPrompt === detailGun.id" class="rounded-2xl border border-amber-200/30 bg-black/40 p-3">
                                        <div class="text-[10px] uppercase tracking-[0.3em] text-amber-200/80">Loadout full — which gun does it replace?</div>
                                        <div class="mt-2 grid grid-cols-3 gap-2">
                                            <button v-for="(slotId, i) in shop.slots" :key="i" type="button" class="flex flex-col items-center gap-1 rounded-xl border border-white/15 p-2 transition-colors hover:border-white/50 hover:bg-white/5" @click="buyWeapon(detailGun.id, i)">
                                                <img v-if="slotId" :src="thumbs['weapon:' + slotId]" alt="" class="h-8 w-14 object-contain" draggable="false">
                                                <span class="font-mono text-[9px] uppercase tracking-widest text-white/70">{{ i + 1 }} · {{ slotId ? weaponName(slotId) : 'empty' }}</span>
                                            </button>
                                        </div>
                                        <button type="button" class="mt-2 w-full text-center text-[10px] uppercase tracking-[0.3em] text-white/40 hover:text-white/70" @click="weaponPrompt = null">Cancel</button>
                                    </div>
                                </template>
                            </div>
                        </div>

                        <!-- Blade -->
                        <div v-else-if="detailMelee" class="flex flex-col rounded-3xl border border-white/10 bg-zinc-950/70" :style="{ '--card-color': RARITY_COLOR[detailMelee.rarity] }">
                            <div class="relative h-56 overflow-hidden rounded-t-3xl">
                                <div class="absolute inset-0" :style="{ background: `radial-gradient(ellipse at 50% 60%, ${RARITY_COLOR[detailMelee.rarity]}33, transparent 65%)` }" />
                                <div ref="previewBox" class="absolute inset-0" />
                                <div class="pointer-events-none absolute inset-x-5 top-4 flex items-start justify-between">
                                    <div>
                                        <div class="text-[9px] font-semibold uppercase tracking-[0.4em]" :style="{ color: RARITY_COLOR[detailMelee.rarity] }">{{ RARITY_LABEL[detailMelee.rarity] }} · {{ MELEE_WEAPONS[detailMelee.id].finisher }} finisher</div>
                                        <div class="mt-1 text-2xl font-black uppercase tracking-tight">{{ detailMelee.name }}</div>
                                    </div>
                                    <span v-if="detailMelee.owned" class="rounded-lg border border-white/25 bg-black/40 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest">In hand</span>
                                </div>
                                <p class="pointer-events-none absolute inset-x-5 bottom-4 text-[11px] leading-snug text-white/60">{{ detailMelee.tagline }}</p>
                            </div>
                            <div class="flex flex-col gap-4 p-5">
                                <div class="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                                    <div v-for="b in meleeBars" :key="b.label" class="flex items-center gap-3">
                                        <span class="w-20 shrink-0 whitespace-nowrap text-[9px] uppercase tracking-[0.25em] text-white/45">{{ b.label }}</span>
                                        <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                                            <div class="h-full rounded-full" :style="{ width: (b.value * 100) + '%', background: RARITY_COLOR[detailMelee.rarity], boxShadow: `0 0 10px ${RARITY_COLOR[detailMelee.rarity]}88` }" />
                                        </div>
                                        <span class="w-12 shrink-0 text-right font-mono text-[10px] tabular-nums text-white/70">{{ b.text }}</span>
                                    </div>
                                </div>
                                <div v-if="!detailMelee.owned" class="flex items-center justify-between gap-3">
                                    <span class="text-[10px] text-white/45">Replaces the {{ hud.melee.name }}. Blades never run out of ammo.</span>
                                    <UButton size="lg" color="primary" :disabled="shop.credits < detailMelee.price" class="px-5 font-black uppercase tracking-[0.25em]" @click="buyMelee(detailMelee.id)"><UIcon name="i-lucide-coins" class="size-4" />Buy · {{ detailMelee.price }}</UButton>
                                </div>
                            </div>
                        </div>

                        <!-- Ability -->
                        <div v-else-if="detailAbility" class="flex flex-col rounded-3xl border border-white/10 bg-zinc-950/70" :style="{ '--card-color': detailAbility.color }">
                            <div class="relative flex h-56 items-center justify-center overflow-hidden rounded-t-3xl">
                                <div class="absolute inset-0" :style="{ background: `radial-gradient(ellipse at 50% 60%, ${detailAbility.color}33, transparent 65%)` }" />
                                <UIcon :name="detailAbility.icon" class="relative size-24" :style="{ color: detailAbility.color, filter: `drop-shadow(0 0 24px ${detailAbility.color}aa)` }" />
                                <div class="pointer-events-none absolute inset-x-5 top-4 flex items-start justify-between">
                                    <div>
                                        <div class="text-[9px] font-semibold uppercase tracking-[0.4em]" :style="{ color: detailAbility.color }">Ability · {{ detailAbility.energy }} energy</div>
                                        <div class="mt-1 text-2xl font-black uppercase tracking-tight">{{ detailAbility.name }}</div>
                                    </div>
                                    <span v-if="detailAbility.owned" class="rounded-lg border border-white/25 bg-black/40 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest">Bound to {{ abilityKey(detailAbility.id) }}</span>
                                </div>
                            </div>
                            <div class="flex flex-col gap-4 p-5">
                                <p class="text-xs leading-relaxed text-white/60">{{ detailAbility.description }}</p>
                                <div v-if="!detailAbility.owned" class="flex items-center justify-between gap-3">
                                    <span class="text-[10px] text-white/45">Energy builds from kills. Two abilities fit, on Q and E.</span>
                                    <UButton size="lg" color="primary" :disabled="shop.credits < detailAbility.price" class="px-5 font-black uppercase tracking-[0.25em]" @click="buyAbility(detailAbility.id)"><UIcon name="i-lucide-coins" class="size-4" />Buy · {{ detailAbility.price }}</UButton>
                                </div>
                                <div v-if="abilityPrompt === detailAbility.id" class="rounded-2xl border border-amber-200/30 bg-black/40 p-3">
                                    <div class="text-[10px] uppercase tracking-[0.3em] text-amber-200/80">Both slots are taken — which one does it replace?</div>
                                    <div class="mt-2 grid grid-cols-2 gap-2">
                                        <button v-for="(slot, i) in hud.abilities" :key="i" type="button" class="rounded-xl border border-white/15 p-2 font-mono text-[10px] uppercase tracking-widest text-white/70 transition-colors hover:border-white/50 hover:bg-white/5" @click="buyAbility(detailAbility.id, i)">{{ i === 0 ? 'Q' : 'E' }} · {{ slot?.name }}</button>
                                    </div>
                                    <button type="button" class="mt-2 w-full text-center text-[10px] uppercase tracking-[0.3em] text-white/40 hover:text-white/70" @click="abilityPrompt = null">Cancel</button>
                                </div>
                            </div>
                        </div>
                    </section>
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
import { ref, reactive, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue'
import { VoxelArenaGame, createHud } from '~/utils/voxel-arena/engine'
import type { RunSummary } from '~/utils/voxel-arena/engine'
import type { AbilityId, DraftCard, MeleeId, ShopState, WeaponId } from '~/utils/voxel-arena/types'
import { RARITY_COLOR, RARITY_LABEL } from '~/utils/voxel-arena/upgrades'
import { WEAPONS, WEAPON_IDS, MELEE_WEAPONS, MELEE_IDS } from '~/utils/voxel-arena/data'
import { ArsenalPreview } from '~/utils/voxel-arena/preview'
import type { PreviewKind } from '~/utils/voxel-arena/preview'

const viewport = ref<HTMLDivElement | null>(null)
const minimap = ref<HTMLCanvasElement | null>(null)
const hud = reactive(createHud())
let game: VoxelArenaGame | null = null

const banner = ref<{ title: string, subtitle: string, tone: string } | null>(null)
let bannerTimer: number | undefined
const toast = ref<{ text: string, color: string } | null>(null)
let toastTimer: number | undefined
const shop = ref<ShopState | null>(null)
const weaponPrompt = ref<WeaponId | null>(null)
const abilityPrompt = ref<AbilityId | null>(null)
type ShopTab = 'weapon' | 'melee' | 'ability'
const shopTabs: { id: ShopTab, label: string, icon: string }[] = [
    { id: 'weapon', label: 'Guns', icon: 'i-lucide-target' },
    { id: 'melee', label: 'Blades', icon: 'i-lucide-sword' },
    { id: 'ability', label: 'Abilities', icon: 'i-lucide-sparkles' }
]
const shopTab = ref<ShopTab>('weapon')
const selected = ref<{ kind: ShopTab, id: string } | null>(null)
const thumbs = ref<Record<string, string>>({})
const previewBox = ref<HTMLDivElement | null>(null)
let preview: ArsenalPreview | null = null
const summary = ref<RunSummary | null>(null)
const muted = ref(false)
const best = ref<{ wave: number, score: number } | null>(null)
const route = useRoute()
const viewportHeight = ref(720)

const controls: [string, string][] = [
    ['WASD', 'Move'],
    ['LMB', 'Shoot'],
    ['RMB', 'Aim down sights · glide in the air'],
    ['F', '3-hit melee combo · slam from the air'],
    ['Ctrl', 'Slide'],
    ['Ctrl + Space', 'Bullet jump'],
    ['Shift', 'Dash'],
    ['Space', 'Jump · double jump'],
    ['Q / E', 'Abilities (buy in the arsenal)'],
    ['R', 'Reload'],
    ['1-3 / Wheel', 'Switch weapon'],
    ['Esc', 'Pause']
]

const lowHealth = computed(() => hud.health / hud.maxHealth < 0.3)
const hasAbilities = computed(() => hud.abilities.some(a => a !== null))
const waveProgress = computed(() => hud.waveTotal > 0 ? Math.max(0, Math.min(100, (1 - hud.remaining / hud.waveTotal) * 100)) : 0)
const activeWeapon = computed(() => hud.weapons[hud.activeWeapon] ?? null)
const comboColor = computed(() => hud.combo >= 20 ? 'text-fuchsia-300' : hud.combo >= 10 ? 'text-orange-300' : 'text-amber-200')
const hitColor = computed(() => ({ kill: 'bg-lime-300', crit: 'bg-yellow-300', head: 'bg-orange-300', block: 'bg-cyan-300', hit: 'bg-red-400' })[hud.hitKind])
const eventLabel = computed(() => ({ meteors: 'Meteor storm', frenzy: 'Frenzy', blackout: 'Blackout', bounty: 'Bounty', none: '' })[hud.event])
const eventClass = computed(() => ({ meteors: 'border-orange-400/50 text-orange-300', frenzy: 'border-red-400/50 text-red-300', blackout: 'border-indigo-300/50 text-indigo-200', bounty: 'border-amber-300/60 text-amber-200', none: '' })[hud.event])
const sightOpacity = computed(() => Math.max(0, (hud.ads - 0.45) / 0.55))
/** Crosshair gap in pixels: the projected radius of the current spread cone. */
const spreadGap = computed(() => {
    const focal = (viewportHeight.value / 2) / Math.tan((hud.fov * Math.PI / 180) / 2)
    return Math.min(60, Math.tan(hud.spread) * focal)
})

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

const ownedGuns = computed(() => (shop.value?.weapons ?? []).filter(w => w.owned).sort((a, b) => a.slot - b.slot))
/** Owned guns first, then the rest in catalogue order. */
const listedGuns = computed(() => [...ownedGuns.value, ...(shop.value?.weapons ?? []).filter(w => !w.owned)])
const detailGun = computed(() => selected.value?.kind === 'weapon' ? shop.value?.weapons.find(w => w.id === selected.value!.id) ?? null : null)
const detailMelee = computed(() => selected.value?.kind === 'melee' ? shop.value?.melee.find(m => m.id === selected.value!.id) ?? null : null)
const detailAbility = computed(() => selected.value?.kind === 'ability' ? shop.value?.abilities.find(a => a.id === selected.value!.id) ?? null : null)

/** Effective rounds per second, bursts included. */
function rateOf(id: WeaponId): number {
    const d = WEAPONS[id]
    return d.burst > 1 ? d.burst / (d.burst / d.fireRate + d.burstGap) : d.fireRate
}

function dpsOf(id: WeaponId): number {
    const d = WEAPONS[id]
    return d.damage * d.pellets * rateOf(id) + (d.burn > 0 ? 9 : 0) + (d.explosionRadius > 0 ? d.damage * 0.5 : 0)
}

const gunMax = {
    dps: Math.max(...WEAPON_IDS.map(dpsOf)),
    rate: Math.max(...WEAPON_IDS.map(rateOf)),
    magazine: Math.max(...WEAPON_IDS.map(id => WEAPONS[id].magazine)),
    reserve: Math.max(...WEAPON_IDS.map(id => WEAPONS[id].reserve))
}

const gunBars = computed(() => {
    const g = detailGun.value
    if (!g) return []
    const d = WEAPONS[g.id]
    return [
        { label: 'Damage', value: Math.min(1, dpsOf(g.id) / gunMax.dps), text: d.pellets > 1 ? `${d.damage}×${d.pellets}` : String(d.damage) },
        { label: 'Fire rate', value: Math.min(1, rateOf(g.id) / gunMax.rate), text: `${rateOf(g.id).toFixed(1)}/s` },
        { label: 'Accuracy', value: Math.max(0.05, 1 - d.spread / 0.12), text: d.spread === 0 ? 'laser' : d.spread < 0.02 ? 'tight' : d.spread < 0.05 ? 'fair' : 'wide' },
        { label: 'Magazine', value: Math.min(1, g.magazine / gunMax.magazine), text: String(g.magazine) },
        { label: 'Reserve', value: Math.min(1, g.reserveMax / (gunMax.reserve * 1.4)), text: String(g.reserveMax) },
        { label: 'Reload', value: Math.max(0.1, 1 - d.reloadTime / 4), text: `${d.reloadTime.toFixed(1)}s` }
    ]
})

const meleeMax = {
    damage: Math.max(...MELEE_IDS.map(id => MELEE_WEAPONS[id].damage)),
    range: Math.max(...MELEE_IDS.map(id => MELEE_WEAPONS[id].range)),
    speed: Math.max(...MELEE_IDS.map(id => 1 / MELEE_WEAPONS[id].swingTime)),
    finisher: Math.max(...MELEE_IDS.map(id => MELEE_WEAPONS[id].finisherMult))
}

const meleeBars = computed(() => {
    const m = detailMelee.value
    if (!m) return []
    const d = MELEE_WEAPONS[m.id]
    return [
        { label: 'Damage', value: d.damage / meleeMax.damage, text: String(d.damage) },
        { label: 'Reach', value: d.range / meleeMax.range, text: `${d.range.toFixed(1)}m` },
        { label: 'Speed', value: (1 / d.swingTime) / meleeMax.speed, text: `${(1 / d.swingTime).toFixed(1)}/s` },
        { label: 'Finisher', value: d.finisherMult / meleeMax.finisher, text: `×${d.finisherMult.toFixed(1)}` }
    ]
})

function isSelected(kind: ShopTab, id: string): boolean {
    return selected.value?.kind === kind && selected.value.id === id
}

function select(kind: ShopTab, id: string): void {
    selected.value = { kind, id }
    weaponPrompt.value = null
    abilityPrompt.value = null
}

/** Builds the WebGL preview on first use and renders every thumbnail once. */
function ensurePreview(): ArsenalPreview {
    if (!preview) {
        preview = new ArsenalPreview()
        const all: Record<string, string> = {}
        for (const id of WEAPON_IDS) all[`weapon:${id}`] = preview.thumbnail('weapon', id)
        for (const id of MELEE_IDS) all[`melee:${id}`] = preview.thumbnail('melee', id)
        thumbs.value = all
    }
    return preview
}

function syncPreview(): void {
    const box = previewBox.value
    const sel = selected.value
    if (!box || !sel || sel.kind === 'ability') {
        preview?.unmount()
        return
    }
    const p = ensurePreview()
    p.mount(box)
    p.show(sel.kind as PreviewKind, sel.id)
}

watch([previewBox, selected], () => nextTick(syncPreview))
watch(shopTab, tab => {
    const s = shop.value
    if (!s) return
    if (tab === 'weapon') select('weapon', listedGuns.value[0]?.id ?? 'pistol')
    else if (tab === 'melee') select('melee', s.melee.find(m => m.owned)?.id ?? s.melee[0]!.id)
    else select('ability', s.abilities.find(a => a.owned)?.id ?? s.abilities[0]!.id)
})

function weaponName(id: WeaponId): string {
    return WEAPONS[id].name
}

function abilityKey(id: AbilityId): string {
    const i = hud.abilities.findIndex(a => a?.id === id)
    return i === 0 ? 'Q' : i === 1 ? 'E' : ''
}


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
    game?.start()
}

function resume(): void {
    game?.resume()
}

function toggleMute(): void {
    muted.value = !muted.value
    game?.setMuted(muted.value)
}

function buyBoon(card: DraftCard): void {
    game?.buyBoon(card)
}

function buyWeapon(id: WeaponId, slot?: number): void {
    if (!game) return
    const result = game.buyWeapon(id, slot)
    weaponPrompt.value = result === 'slot' ? id : null
}

function refill(id: WeaponId | 'all'): void {
    game?.refillAmmo(id)
}

function buyMelee(id: MeleeId): void {
    game?.buyMelee(id)
}

function buyAbility(id: AbilityId, slot?: number): void {
    if (!game) return
    const result = game.buyAbility(id, slot)
    abilityPrompt.value = result === 'slot' ? id : null
}

function reroll(): void {
    game?.rerollBoons()
}

function deploy(): void {
    weaponPrompt.value = null
    abilityPrompt.value = null
    shop.value = null
    preview?.unmount()
    game?.finishShop()
}

function loadBest(): void {
    try {
        const raw = localStorage.getItem('voxel-arena-best')
        if (raw) best.value = JSON.parse(raw) as { wave: number, score: number }
    } catch {
        best.value = null
    }
}

function onResize(): void {
    viewportHeight.value = window.innerHeight
}

onMounted(async () => {
    // `.client` components render their real template a tick after mount, so
    // the viewport ref is only populated after nextTick.
    await nextTick()
    loadBest()
    onResize()
    window.addEventListener('resize', onResize)
    if (!viewport.value) return
    game = new VoxelArenaGame({
        hud,
        banner: showBanner,
        toast: showToast,
        shop: state => {
            const opening = shop.value === null
            shop.value = state
            if (opening) {
                ensurePreview()
                shopTab.value = 'weapon'
                select('weapon', state.weapons.filter(w => w.owned).sort((a, b) => a.slot - b.slot)[0]?.id ?? 'pistol')
            }
        },
        dead: s => {
            summary.value = s
            best.value = { wave: s.bestWave, score: s.bestScore }
        }
    })
    game.mount(viewport.value)
    game.attachMinimap(minimap.value)
    watch(minimap, canvas => game?.attachMinimap(canvas))
    if (import.meta.dev && route.query.debug === '1') {
        (window as unknown as { __voxelArena: VoxelArenaGame }).__voxelArena = game
    }
})

onBeforeUnmount(() => {
    window.removeEventListener('resize', onResize)
    if (bannerTimer) window.clearTimeout(bannerTimer)
    if (toastTimer) window.clearTimeout(toastTimer)
    game?.dispose()
    game = null
    preview?.dispose()
    preview = null
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

.boon {
    background: linear-gradient(160deg, rgba(24, 24, 27, 0.9), rgba(9, 9, 11, 0.85));
}

.boon:not(:disabled):hover {
    box-shadow: 0 0 40px -12px var(--card-color);
}

.hit-marker {
    width: 64px;
    height: 18px;
    border-radius: 50% 50% 8px 8px / 100% 100% 8px 8px;
    background: radial-gradient(ellipse at 50% 100%, rgba(255, 60, 60, 0.95), rgba(255, 40, 40, 0.35) 60%, transparent 75%);
    filter: drop-shadow(0 0 8px rgba(255, 40, 40, 0.8));
}

.scope-mask {
    background: radial-gradient(circle at 50% 50%, transparent 37vmin, rgba(0, 0, 0, 0.55) 37.5vmin, #000 39vmin);
}
</style>
