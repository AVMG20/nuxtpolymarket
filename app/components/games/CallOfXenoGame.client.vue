<template>
    <div class="relative h-screen w-full select-none overflow-hidden bg-black">
        <div ref="viewport" class="absolute inset-0" />

        <!-- Floating damage and point numbers, projected from world space. -->
        <div class="pointer-events-none absolute inset-0 overflow-hidden">
            <div
                v-for="popup in popups"
                :key="popup.id"
                class="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-mono font-bold tabular-nums drop-shadow-[0_2px_3px_rgba(0,0,0,0.9)]"
                :style="{ left: popup.left + 'px', top: popup.top + 'px', opacity: popup.opacity, color: popup.color, fontSize: popup.size + 'px' }"
            >{{ popup.text }}</div>
        </div>

        <div class="pointer-events-none absolute inset-0" style="box-shadow: inset 0 0 180px 40px rgba(0,0,0,0.75)" />
        <div
            class="pointer-events-none absolute inset-0"
            :style="{ opacity: hurtVeil, boxShadow: 'inset 0 0 200px 70px rgba(190,10,10,0.9)' }"
        />

        <!-- Directional damage indicators, rotated toward the source. -->
        <div
            v-for="mark in hurtMarks"
            :key="mark.id"
            class="pointer-events-none absolute inset-0 flex items-center justify-center"
            :style="{ transform: `rotate(${mark.angle}deg)`, opacity: Math.min(1, mark.life * 1.3) }"
        >
            <div class="relative size-80">
                <div class="absolute left-1/2 top-0 h-9 w-28 -translate-x-1/2 rounded-t-full border-x-4 border-t-4 border-red-500/80 drop-shadow-[0_0_6px_rgba(220,38,38,0.8)]" />
            </div>
        </div>

        <div v-if="lowHealth" class="pointer-events-none absolute inset-0 animate-pulse" style="box-shadow: inset 0 0 260px 90px rgba(140,0,0,0.55)" />
        <div
            v-if="instakillOn"
            class="pointer-events-none absolute inset-0"
            style="box-shadow: inset 0 0 200px 60px rgba(255,60,60,0.28)"
        />

        <!-- Crosshair -->
        <div v-if="phase === 'playing' && locked" class="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div class="relative size-16">
                <span
                    v-for="(rot, i) in [0, 90, 180, 270]"
                    :key="i"
                    class="absolute left-1/2 top-1/2 h-2.5 w-0.5 origin-center rounded-full transition-colors"
                    :class="hitMarker > 0 ? 'bg-red-400' : 'bg-white/80'"
                    :style="{ transform: `rotate(${rot}deg) translateY(${-crossGap}px) translateX(-50%)` }"
                />
                <span class="absolute left-1/2 top-1/2 size-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70" />
                <span
                    v-if="hitMarker > 0"
                    class="absolute inset-0 flex items-center justify-center text-lg font-bold"
                    :class="lastHitKind === 'weak' ? 'text-amber-300' : lastHitKind === 'head' ? 'text-amber-200' : 'text-red-400'"
                    :style="{ opacity: hitMarker / 0.18 }"
                >✕</span>
            </div>
        </div>

        <!-- HUD -->
        <div v-if="phase !== 'menu'" class="pointer-events-none absolute inset-0 p-5 font-mono text-white sm:p-6">
            <!-- Vitals: bottom-left, where a shooter keeps it -->
            <div class="absolute bottom-5 left-5 sm:bottom-6 sm:left-6">
                <div class="rounded-lg border border-white/10 bg-black/55 px-4 py-3 backdrop-blur-sm">
                    <div class="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.35em]" :class="lowHealth ? 'text-red-400' : 'text-zinc-500'">
                        <UIcon name="i-lucide-heart-pulse" class="size-3.5" :class="lowHealth ? 'animate-pulse' : ''" />
                        Vitals
                    </div>
                    <div class="mt-1 flex items-baseline gap-1.5">
                        <span class="text-4xl font-black leading-none tabular-nums" :class="lowHealth ? 'text-red-500' : 'text-zinc-50'">
                            {{ Math.ceil(health) }}
                        </span>
                        <span class="text-xs font-bold text-zinc-500">/ {{ maxHealth }}</span>
                    </div>
                    <!-- segmented bar: fill + segment dividers over it -->
                    <div class="relative mt-2 h-2 w-52 overflow-hidden rounded-sm bg-white/10">
                        <div
                            class="h-full transition-[width] duration-100"
                            :class="lowHealth ? 'bg-red-500' : 'bg-emerald-400'"
                            :style="{ width: (health / maxHealth * 100) + '%' }"
                        />
                        <div class="absolute inset-0" style="background-image: repeating-linear-gradient(90deg, transparent 0 calc(10% - 2px), rgba(0,0,0,0.65) calc(10% - 2px) 10%)" />
                    </div>
                </div>

                <!-- Perks -->
                <div v-if="ownedPerks.length" class="mt-2.5 flex gap-2">
                    <div
                        v-for="perk in ownedPerks"
                        :key="perk.id"
                        class="flex size-11 items-center justify-center rounded-lg border-2 text-[10px] font-black uppercase shadow-lg backdrop-blur-sm"
                        :style="{ borderColor: perkCss(perk.color), color: perkCss(perk.color), background: perkCss(perk.color) + '26' }"
                    >
                        {{ perkShort(perk.id) }}
                    </div>
                </div>
            </div>

            <!-- Top-left: active power-ups and deployed equipment -->
            <div class="absolute left-5 top-5 space-y-1.5 sm:left-6 sm:top-6">
                <div
                    v-for="buff in activePowerUps"
                    :key="buff.id"
                    class="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-widest backdrop-blur-sm"
                    :style="{ color: buff.color, borderColor: buff.color + '55', background: buff.color + '14' }"
                >
                    <span class="inline-block size-1.5 animate-pulse rounded-full" :style="{ background: buff.color }" />
                    {{ buff.name }}
                    <span class="tabular-nums opacity-60">{{ Math.ceil(buff.remaining) }}s</span>
                </div>
                <div
                    v-for="unit in activeEquipment"
                    :key="unit.key"
                    class="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-widest backdrop-blur-sm"
                    :style="{ color: unit.color, borderColor: unit.color + '55', background: unit.color + '14' }"
                >
                    <UIcon :name="unit.icon" class="size-3.5" />
                    {{ unit.label }}
                    <span class="tabular-nums opacity-60">{{ Math.ceil(unit.remaining) }}s</span>
                </div>
            </div>

            <!-- Top-right: points, then combat state -->
            <div class="absolute right-5 top-5 text-right sm:right-6 sm:top-6">
                <div class="text-4xl font-black leading-none tabular-nums text-amber-300 drop-shadow-[0_2px_6px_rgba(251,191,36,0.25)]">
                    {{ points.toLocaleString() }}
                </div>
                <div class="mt-0.5 text-[9px] uppercase tracking-[0.35em] text-zinc-500">Points</div>

                <div class="mt-4 border-r-2 pr-2" :class="specialRound ? 'border-fuchsia-500' : 'border-red-600'">
                    <div class="text-[9px] uppercase tracking-[0.35em] text-zinc-500">Round</div>
                    <div class="text-4xl font-black leading-none tabular-nums" :class="specialRound ? 'text-fuchsia-400' : 'text-red-500'">
                        {{ round }}
                    </div>
                    <div class="mt-0.5 flex items-center justify-end gap-1 text-[9px] uppercase tracking-[0.2em] text-zinc-500">
                        <span class="rounded-sm border border-white/10 bg-white/5 px-1.5 py-px">{{ runDifficultyName }}</span>
                    </div>
                </div>

                <div class="mt-2.5 flex items-center justify-end gap-1.5 text-[11px] font-bold uppercase tracking-[0.2em]" :class="enemiesLeft > 0 ? 'text-red-400' : 'text-zinc-600'">
                    <UIcon name="i-lucide-skull" class="size-3.5" :class="enemiesLeft > 0 ? 'animate-pulse' : ''" />
                    <span class="tabular-nums">{{ enemiesLeft }}</span>
                    <span class="text-zinc-500">hostiles</span>
                </div>
                <div v-if="modifierName" class="mt-1.5 flex items-center justify-end gap-1 rounded-sm border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.25em] text-cyan-300">
                    <UIcon name="i-lucide-radio" class="size-3" />
                    {{ modifierName }}
                </div>
            </div>

            <!-- Weapon + ammo: bottom-right -->
            <div class="absolute bottom-5 right-5 text-right sm:bottom-6 sm:right-6">
                <div class="flex items-end justify-end gap-2.5">
                    <!-- Carried equipment: a miniature of the unit, deploy key at its foot -->
                    <div v-if="equipmentStock.length" class="flex items-end gap-1.5">
                        <div
                            v-for="(item, i) in equipmentStock"
                            :key="i"
                            class="relative flex flex-col items-center rounded-md border border-white/10 bg-black/55 px-1.5 pb-3.5 pt-1 backdrop-blur-sm"
                            :style="{ color: perkCss(CALL_OF_XENO_EQUIPMENT[item].color) }"
                        >
                            <svg v-if="item === 'sentry'" class="size-9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 12.5 6.5 21M12 12.5l5.5 8.5M12 12.5V21" />
                                <rect x="8" y="7" width="8" height="4.6" rx="1" />
                                <path d="M16 9.3h4.5" />
                                <circle cx="12" cy="5" r="0.9" fill="currentColor" stroke="none" />
                            </svg>
                            <svg v-else-if="item === 'drone'" class="size-9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="8" y="10.5" width="8" height="3.8" rx="1.4" />
                                <path d="M12 10.5V8.8M4.5 8.4h4M15.5 8.4h4" />
                                <circle cx="12" cy="14.3" r="0.8" fill="currentColor" stroke="none" />
                            </svg>
                            <svg v-else class="size-9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
                                <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
                                <circle cx="12" cy="12" r="7.2" stroke-dasharray="3 2.4" />
                            </svg>
                            <span class="absolute bottom-1 left-1/2 -translate-x-1/2 rounded-sm border border-white/25 bg-zinc-900 px-1 text-[9px] font-bold leading-none text-zinc-100">E</span>
                        </div>
                    </div>
                    <div class="rounded-lg border border-white/10 bg-black/55 px-4 py-3 backdrop-blur-sm">
                    <div class="flex items-center justify-end gap-2">
                        <span class="text-xs font-black uppercase tracking-[0.2em]" :class="papTier === 3 ? 'text-pink-300' : papTier === 2 ? 'text-cyan-300' : papTier === 1 ? 'text-purple-300' : 'text-zinc-100'">
                            {{ weaponName }}
                        </span>
                        <span
                            v-if="papTier > 0"
                            class="rounded-sm border px-1.5 py-px text-[9px] font-black tracking-[0.15em]"
                            :class="papTier === 3 ? 'border-pink-400/50 text-pink-300' : papTier === 2 ? 'border-cyan-400/50 text-cyan-300' : 'border-purple-400/50 text-purple-300'"
                        >PaP {{ papTier }}/3</span>
                    </div>
                    <div class="mt-1 flex items-baseline justify-end gap-2">
                        <span class="text-5xl font-black leading-none tabular-nums" :class="!reloading && magAmmo === 0 ? 'text-red-500 animate-pulse' : reloading ? 'text-zinc-400' : 'text-zinc-50'">{{ magAmmo }}</span>
                        <span class="text-lg font-bold tabular-nums text-zinc-500">/ {{ reserveAmmo }}</span>
                    </div>
                    <!-- Ammo bar: amber = rounds left; while reloading the same
                         bar fills muted-orange with the reload progress, so
                         the card never grows and the state is read in place. -->
                    <div class="relative mt-2 h-2 w-44 overflow-hidden rounded-sm bg-white/10">
                        <div
                            v-if="reloading"
                            class="h-full animate-pulse bg-orange-400/60"
                            :style="{ width: reloadFraction + '%', animationDuration: '1.6s' }"
                        />
                        <div
                            v-else
                            class="h-full transition-[width] duration-150"
                            :class="magFraction <= 25 ? 'bg-red-500' : 'bg-amber-300/90'"
                            :style="{ width: magFraction + '%' }"
                        />
                        <div class="absolute inset-0" style="background-image: repeating-linear-gradient(90deg, transparent 0 calc(20% - 2px), rgba(0,0,0,0.65) calc(20% - 2px) 20%)" />
                    </div>
                    <!-- Fixed-height status row: reserve every state a line, so
                         the card below never jumps. -->
                    <div class="mt-1.5 flex h-4 items-center justify-end">
                        <span v-if="reloading" class="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-600">—</span>
                        <span v-else-if="magAmmo === 0 && reserveAmmo > 0" class="text-[10px] font-bold uppercase tracking-[0.25em] text-red-400 animate-pulse">
                            Reload [R]
                        </span>
                        <span v-else-if="magAmmo === 0 && reserveAmmo === 0" class="text-[10px] font-bold uppercase tracking-[0.25em] text-red-500 animate-pulse">
                            No ammo
                        </span>
                    </div>
                </div>
                </div>
                <div v-if="stowedName" class="mt-2 inline-flex items-center gap-2 rounded-md border border-white/10 bg-black/55 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 backdrop-blur-sm">
                    <span class="rounded-sm border border-white/15 bg-white/5 px-1.5 py-px text-zinc-200">Q</span>
                    {{ stowedName }}
                </div>
            </div>

            <div
                v-if="prompt"
                class="absolute left-1/2 top-[60%] -translate-x-1/2 rounded-md border px-4 py-2 text-center text-sm font-medium backdrop-blur-sm"
                :class="promptAffordable ? 'border-white/15 bg-black/70 text-zinc-100' : 'border-red-500/40 bg-red-950/60 text-red-300'"
            >
                {{ prompt }}
            </div>

            <Transition enter-active-class="transition duration-300" enter-from-class="opacity-0 scale-90" leave-active-class="transition duration-500" leave-to-class="opacity-0">
                <div v-if="banner" class="absolute left-1/2 top-[20%] -translate-x-1/2 text-center">
                    <div
                        class="text-5xl font-black uppercase tracking-[0.2em] drop-shadow-[0_3px_8px_rgba(0,0,0,0.9)]"
                        :style="{ color: bannerColor }"
                    >{{ banner }}</div>
                    <div v-if="subBanner" class="mt-1 text-sm uppercase tracking-[0.3em] text-white/50">{{ subBanner }}</div>
                </div>
            </Transition>

            <div v-if="!powerOn" class="absolute left-1/2 top-5 flex -translate-x-1/2 items-center gap-1.5 rounded-md border border-amber-400/25 bg-black/60 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.3em] text-amber-300/70 backdrop-blur-sm sm:top-6">
                <UIcon name="i-lucide-zap-off" class="size-3.5" />
                Power offline
            </div>

            <button
                class="pointer-events-auto absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded border border-white/10 bg-black/50 px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-zinc-500 backdrop-blur-sm transition-colors hover:text-zinc-200 sm:bottom-6"
                @click="toggleMute"
            >
                <UIcon :name="muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'" class="size-3.5" />
                {{ muted ? 'Sound off [M]' : 'Sound on [M]' }}
            </button>
        </div>

        <!-- Intro menu: full game menu -->
        <div
            v-if="phase === 'menu'"
            class="absolute inset-0 overflow-y-auto bg-black/80 p-4 backdrop-blur-sm sm:p-8"
            style="background-image: radial-gradient(ellipse at 30% 20%, rgba(220,38,38,0.08), transparent 55%)"
        >
            <div class="mx-auto my-auto flex min-h-full w-full max-w-6xl items-center font-mono">
                <div class="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/90 shadow-[0_0_120px_rgba(0,0,0,0.9)]">
                    <!-- scanlines -->
                    <div
                        class="pointer-events-none absolute inset-0 z-10 opacity-[0.35]"
                        style="background-image: repeating-linear-gradient(0deg, transparent 0 2px, rgba(0,0,0,0.3) 2px 4px)"
                    />

                    <!-- top strip -->
                    <div class="relative flex items-center justify-between gap-4 border-b border-white/10 bg-black/60 px-5 py-3">
                        <div class="flex items-center gap-1">
                            <button
                                class="rounded-sm px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.2em] transition-colors"
                                :class="menuTab === 'loadout' ? 'bg-white/10 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'"
                                @click="menuTab = 'loadout'"
                            >Loadout</button>
                            <button
                                class="flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.2em] transition-colors"
                                :class="menuTab === 'leaderboard' ? 'bg-white/10 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'"
                                @click="menuTab = 'leaderboard'"
                            >
                                <UIcon name="i-lucide-trophy" class="size-3" />
                                Leaderboard
                            </button>
                        </div>
                        <div v-if="!guestMode" class="flex items-center gap-2 rounded-full border border-amber-400/25 bg-amber-400/10 px-3.5 py-1.5 text-sm text-amber-300">
                            <UIcon name="i-lucide-coins" class="size-4" />
                            <span class="font-bold tabular-nums">{{ formatCoins(metaBalance) }}</span>
                            <span class="text-[9px] uppercase tracking-[0.25em] text-amber-300/50">reserves</span>
                        </div>
                        <div v-else class="flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-zinc-500">
                            <UIcon name="i-lucide-lock" class="size-3.5" />
                            guest — no cash payout
                        </div>
                    </div>

                    <div v-if="menuTab === 'loadout'" class="grid lg:grid-cols-[5fr_7fr]">
                        <!-- LEFT: the game at a glance -->
                        <div class="relative border-b border-white/10 p-7 sm:p-9 lg:border-b-0 lg:border-r">
                            <h1 class="bg-gradient-to-b from-zinc-50 via-zinc-300 to-zinc-600 bg-clip-text text-5xl font-black uppercase leading-[0.95] tracking-tight text-transparent sm:text-6xl">
                                Call<br>of Xeno
                            </h1>

                            <!-- Perks -->
                            <div class="mt-7">
                                <div class="text-[9px] uppercase tracking-[0.4em] text-zinc-600">Perks — on with the power</div>
                                <div class="mt-2.5 space-y-1.5">
                                    <div v-for="perk in CALL_OF_XENO_PERK_LIST" :key="perk.id" class="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5">
                                        <span class="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-zinc-200">
                                            <span class="size-2 rounded-full" :style="{ backgroundColor: perkCss(perk.color) }" />
                                            {{ perk.name }}
                                        </span>
                                        <span class="text-right text-[10px] leading-tight text-zinc-500">{{ perk.description }}</span>
                                    </div>
                                </div>
                            </div>

                            <!-- Weapons -->
                            <div class="mt-6">
                                <div class="text-[9px] uppercase tracking-[0.4em] text-zinc-600">Weapons — walls and the box</div>
                                <div class="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                                    <div v-for="weapon in CALL_OF_XENO_WEAPON_LIST" :key="weapon.id" class="flex items-baseline justify-between gap-2 border-b border-white/5 pb-0.5">
                                        <span class="font-bold uppercase tracking-wide text-zinc-300">{{ weapon.name }}</span>
                                        <span class="shrink-0 text-zinc-600">{{ weapon.type }}</span>
                                    </div>
                                </div>
                            </div>

                            <!-- Pay rates -->
                            <div class="mt-6">
                                <div class="text-[9px] uppercase tracking-[0.4em] text-zinc-600">Points</div>
                                <div class="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                                    <span class="rounded-sm border border-white/10 bg-white/[0.04] px-2 py-1 text-zinc-300">hit <span class="font-bold text-amber-300">+10</span></span>
                                    <span class="rounded-sm border border-white/10 bg-white/[0.04] px-2 py-1 text-zinc-300">kill <span class="font-bold text-amber-300">+100</span></span>
                                    <span class="rounded-sm border border-white/10 bg-white/[0.04] px-2 py-1 text-zinc-300">headshot <span class="font-bold text-amber-300">+120</span></span>
                                    <span class="rounded-sm border border-white/10 bg-white/[0.04] px-2 py-1 text-zinc-300">knife <span class="font-bold text-amber-300">+130</span></span>
                                    <span class="rounded-sm border border-white/10 bg-white/[0.04] px-2 py-1 text-zinc-300">board <span class="font-bold text-amber-300">+{{ CALL_OF_XENO_REPAIR_POINTS }}</span></span>
                                </div>
                            </div>

                            <div class="mt-6 border-t border-white/10 pt-4">
                                <div class="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] text-zinc-500">
                                    <div><span class="text-zinc-200">WASD</span> move</div>
                                    <div><span class="text-zinc-200">LMB</span> fire</div>
                                    <div><span class="text-zinc-200">Space</span> jump</div>
                                    <div><span class="text-zinc-200">RMB</span> aim</div>
                                    <div><span class="text-zinc-200">Shift</span> sprint</div>
                                    <div><span class="text-zinc-200">R</span> reload</div>
                                    <div><span class="text-zinc-200">F</span> buy / board up</div>
                                    <div><span class="text-zinc-200">Q</span> swap weapon</div>
                                    <div><span class="text-zinc-200">E</span> deploy equipment</div>
                                    <div><span class="text-zinc-200">V</span> knife</div>
                                    <div><span class="text-zinc-200">Esc</span> pause</div>
                                </div>
                            </div>
                        </div>

                        <!-- RIGHT: deployment -->
                        <div class="max-h-[70vh] overflow-y-auto p-7 sm:p-9 lg:max-h-[75vh]">
                            <!-- crashed-run resume -->
                            <div v-if="resumableSave && resumableRun" class="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-400/30 bg-cyan-400/[0.07] px-4 py-3.5">
                                <div class="min-w-0">
                                    <div class="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.3em] text-cyan-300">
                                        <UIcon name="i-lucide-rotate-ccw" class="size-4" />
                                        Deployment in progress
                                    </div>
                                    <div class="mt-1 text-[11px] leading-relaxed text-zinc-400">
                                        You went dark on round {{ resumableSave.round }} of
                                        <span class="font-bold uppercase">{{ resumableDifficultyName }}</span>
                                        — pick up where the outpost lost you. A fresh deploy abandons it.
                                    </div>
                                </div>
                                <button
                                    class="flex shrink-0 items-center gap-2 rounded-lg bg-cyan-500 px-5 py-2.5 text-[11px] font-black uppercase tracking-[0.2em] text-black transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                                    :disabled="deploying"
                                    @click="resumeRun()"
                                >
                                    <UIcon :name="deploying ? 'i-lucide-loader-circle' : 'i-lucide-play'" class="size-3.5" :class="deploying ? 'animate-spin' : ''" />
                                    Resume — Round {{ resumableSave.round }}
                                </button>
                            </div>

                            <!-- difficulty -->
                            <div class="flex items-center justify-between">
                                <div class="flex items-center gap-2 text-[9px] uppercase tracking-[0.4em] text-zinc-500">
                                    <UIcon name="i-lucide-swords" class="size-3.5 text-zinc-400" />
                                    Select difficulty
                                </div>
                                <span class="text-[9px] uppercase tracking-[0.2em] text-zinc-600">
                                    cash rate {{ payoutRateLabel }} of points earned
                                </span>
                            </div>
                            <div class="mt-3 grid grid-cols-2 gap-2.5">
                                <button
                                    v-for="difficulty in metaDifficulties"
                                    :key="difficulty.id"
                                    class="group relative rounded-xl border p-3.5 text-left transition-all disabled:cursor-not-allowed"
                                    :class="selectedDifficulty === difficulty.id && difficulty.unlocked
                                        ? 'border-amber-400/60 bg-amber-400/10 shadow-[0_0_24px_rgba(251,191,36,0.12)]'
                                        : 'border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]'"
                                    :disabled="!difficulty.unlocked || cooldownRemainingMs > 0"
                                    @click="selectedDifficulty = difficulty.id"
                                >
                                    <div class="flex items-center justify-between">
                                        <UIcon
                                            :name="difficultyIcons[difficulty.id]"
                                            class="size-5"
                                            :class="difficulty.unlocked ? difficultyAccent[difficulty.id] : 'text-zinc-600'"
                                        />
                                        <span
                                            v-if="difficulty.unlocked"
                                            class="font-bold tabular-nums"
                                            :class="selectedDifficulty === difficulty.id ? 'text-amber-300' : 'text-zinc-400'"
                                        >×{{ difficulty.reward }}</span>
                                        <UIcon v-else name="i-lucide-lock" class="size-3.5 text-zinc-600" />
                                    </div>
                                    <div class="mt-2.5 text-sm font-bold uppercase tracking-wider" :class="difficulty.unlocked ? 'text-zinc-100' : 'text-zinc-500'">
                                        {{ difficulty.name }}
                                    </div>
                                    <div class="mt-1 text-[10px] leading-relaxed text-zinc-500">
                                        <template v-if="difficulty.unlocked">{{ difficulty.description }}</template>
                                        <template v-else>
                                            Reach round {{ difficulty.requiredBestRound }} on
                                            <span class="uppercase">{{ difficulty.previous }}</span>
                                        </template>
                                    </div>
                                </button>
                            </div>

                            <!-- upgrades -->
                            <div v-if="!guestMode" class="mt-7">
                                <div class="flex items-center justify-between">
                                    <div class="flex items-center gap-2 text-[9px] uppercase tracking-[0.4em] text-zinc-500">
                                        <UIcon name="i-lucide-chevrons-up" class="size-3.5 text-zinc-400" />
                                        Permanent upgrades
                                    </div>
                                    <span class="text-[9px] uppercase tracking-[0.2em] text-zinc-600">carry over between runs</span>
                                </div>
                                <div class="mt-3 space-y-2">
                                    <div
                                        v-for="upgrade in metaUpgrades"
                                        :key="upgrade.id"
                                        class="flex items-center gap-3.5 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 transition-colors hover:border-white/20"
                                    >
                                        <div class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/50">
                                            <UIcon :name="upgradeIcons[upgrade.id]" class="size-5 text-amber-300/90" />
                                        </div>
                                        <div class="min-w-0 flex-1">
                                            <div class="flex items-center justify-between gap-2">
                                                <span class="text-[13px] font-bold text-zinc-100">{{ upgrade.name }}</span>
                                                <!-- level pips -->
                                                <span class="flex shrink-0 gap-[3px]">
                                                    <span
                                                        v-for="i in upgrade.max"
                                                        :key="i"
                                                        class="h-1.5 w-2 rounded-full"
                                                        :class="i <= upgrade.level ? 'bg-amber-400' : 'bg-white/15'"
                                                    />
                                                </span>
                                            </div>
                                            <div class="mt-0.5 truncate text-[11px] text-zinc-500">{{ upgrade.description }}</div>
                                        </div>
                                        <button
                                            class="shrink-0 rounded-md border px-3 py-1.5 text-xs font-bold tabular-nums transition-colors disabled:cursor-not-allowed"
                                            :class="upgrade.cost !== null && metaBalance >= upgrade.cost
                                                ? 'border-amber-400/50 text-amber-300 hover:bg-amber-400/15'
                                                : 'border-white/10 text-zinc-600'"
                                            :disabled="upgrade.cost === null || metaBalance < upgrade.cost"
                                            @click="buyUpgrade(upgrade.id)"
                                        >
                                            {{ upgrade.cost === null ? 'MAX' : formatCoins(upgrade.cost) }}
                                        </button>
                                    </div>
                                </div>

                                <div v-if="metaStats.runsPlayed > 0" class="mt-4 flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-[0.2em] text-zinc-600">
                                    <span class="flex items-center gap-1.5">
                                        <UIcon name="i-lucide-trophy" class="size-3.5 text-amber-400/70" />
                                        {{ metaStats.runsPlayed }} runs · best cash {{ formatCoins(metaStats.bestEarned) }}
                                    </span>
                                    <span class="flex items-center gap-2.5">
                                        <span :class="difficultyAccent.recruit">R{{ metaBestRounds.recruit }}</span>
                                        <span :class="difficultyAccent.veteran">V{{ metaBestRounds.veteran }}</span>
                                        <span :class="difficultyAccent.survivor">S{{ metaBestRounds.survivor }}</span>
                                        <span :class="difficultyAccent.nightmare">N{{ metaBestRounds.nightmare }}</span>
                                    </span>
                                </div>

                                <!-- starting sidearm picker -->
                                <div class="mt-6">
                                    <div class="flex items-center justify-between">
                                        <div class="flex items-center gap-2 text-[9px] uppercase tracking-[0.4em] text-zinc-500">
                                            <UIcon name="i-lucide-crosshair" class="size-3.5 text-zinc-400" />
                                            Starting sidearm
                                        </div>
                                        <span class="text-[9px] uppercase tracking-[0.2em] text-zinc-600">M1911 always carried</span>
                                    </div>
                                    <div class="mt-3 grid grid-cols-4 gap-2.5">
                                        <button
                                            v-for="choice in sidearmChoices"
                                            :key="choice.id"
                                            class="group relative rounded-xl border p-3 text-center transition-all disabled:cursor-not-allowed"
                                            :class="choice.id === chosenSidearm && choice.unlocked
                                                ? 'border-amber-400/60 bg-amber-400/10 shadow-[0_0_20px_rgba(251,191,36,0.1)]'
                                                : 'border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]'"
                                            :disabled="!choice.unlocked || cooldownRemainingMs > 0"
                                            @click="chosenSidearm = choice.id"
                                        >
                                            <UIcon
                                                :name="choice.unlocked ? 'i-lucide-crosshair' : 'i-lucide-lock'"
                                                class="mx-auto size-4"
                                                :class="choice.unlocked ? 'text-zinc-300' : 'text-zinc-600'"
                                            />
                                            <div class="mt-2 text-[11px] font-bold uppercase tracking-wider" :class="choice.unlocked ? 'text-zinc-100' : 'text-zinc-500'">
                                                {{ CALL_OF_XENO_WEAPONS[choice.id].name }}
                                            </div>
                                            <div v-if="choice.unlocked" class="mt-1 font-mono text-[9px] tabular-nums text-zinc-500">
                                                {{ CALL_OF_XENO_WEAPONS[choice.id].damage }} dmg
                                            </div>
                                            <div v-else class="mt-1 text-[9px] uppercase tracking-wider text-zinc-600">
                                                Sidearm {{ STARTER_IDS.indexOf(choice.id) + 1 }}
                                            </div>
                                            <span
                                                v-if="choice.id === chosenSidearm && choice.unlocked"
                                                class="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-amber-400 text-black"
                                            >
                                                <UIcon name="i-lucide-check" class="size-3" />
                                            </span>
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <!-- guest sign-in note -->
                            <div v-else class="mt-7 flex items-center gap-3.5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4">
                                <UIcon name="i-lucide-user-round" class="size-5 shrink-0 text-zinc-500" />
                                <div class="text-[11px] leading-relaxed text-zinc-500">
                                    Sign in to bank cash from your runs, buy permanent upgrades and
                                    unlock the harder difficulties.
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- leaderboard tab -->
                    <div v-else class="relative p-7 sm:p-9">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-2 text-[10px] uppercase tracking-[0.5em] text-amber-400/90">
                                <span class="h-px w-8 bg-amber-400/70" />
                                Best runs
                            </div>
                            <span class="text-[9px] uppercase tracking-[0.2em] text-zinc-600">ranked by difficulty, then rounds</span>
                        </div>

                        <div v-if="leaderboardLoading" class="flex items-center justify-center gap-2 py-16 text-xs uppercase tracking-[0.3em] text-zinc-500">
                            <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
                            Pulling records…
                        </div>
                        <div v-else-if="!leaderboard?.length" class="py-16 text-center text-xs uppercase tracking-[0.3em] text-zinc-600">
                            No runs on the board yet — be the first.
                        </div>
                        <div v-else class="mt-5 overflow-hidden rounded-xl border border-white/10">
                            <div class="grid grid-cols-[3rem_1fr_7rem_4.5rem_6rem] items-center gap-2 border-b border-white/10 bg-white/[0.04] px-4 py-2 text-[9px] font-bold uppercase tracking-[0.25em] text-zinc-500">
                                <span>#</span>
                                <span>Operator</span>
                                <span>Difficulty</span>
                                <span class="text-right">Rounds</span>
                                <span class="text-right">Time</span>
                            </div>
                            <div
                                v-for="entry in leaderboard"
                                :key="entry.rank"
                                class="grid grid-cols-[3rem_1fr_7rem_4.5rem_6rem] items-center gap-2 border-b border-white/5 px-4 py-2.5 text-[13px] last:border-b-0"
                                :class="entry.isCurrentUser ? 'bg-amber-400/[0.07]' : 'hover:bg-white/[0.02]'"
                            >
                                <span class="font-black tabular-nums" :class="entry.rank <= 3 ? 'text-amber-300' : 'text-zinc-500'">{{ entry.rank }}</span>
                                <span class="flex items-center gap-2 truncate font-bold" :class="entry.isCurrentUser ? 'text-amber-300' : 'text-zinc-200'">
                                    <UIcon v-if="entry.rank === 1" name="i-lucide-crown" class="size-3.5 shrink-0 text-amber-400" />
                                    {{ entry.name }}
                                </span>
                                <span class="text-[10px] font-bold uppercase tracking-[0.15em]" :class="difficultyAccent[entry.difficulty] ?? 'text-zinc-400'">
                                    {{ entry.difficulty }}
                                </span>
                                <span class="text-right font-black tabular-nums text-zinc-100">{{ entry.rounds }}</span>
                                <span class="text-right tabular-nums text-zinc-400">{{ formatDuration(entry.durationSeconds) }}</span>
                            </div>
                        </div>
                    </div>

                    <!-- footer deploy bar -->
                    <div class="relative flex flex-wrap items-center justify-between gap-4 border-t border-white/10 bg-black/60 px-5 py-4">
                        <div class="min-w-0 text-[11px]">
                            <p v-if="menuError" class="rounded border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                                {{ menuError }}
                            </p>
                            <p v-else-if="cooldownRemainingMs > 0" class="flex items-center gap-2 text-amber-300/80">
                                <UIcon name="i-lucide-clock" class="size-4" />
                                Outpost resupplying — next deployment in {{ cooldownLabel }}.
                            </p>
                            <p v-else class="text-zinc-600">Your mouse is captured while playing. Esc gives it back.</p>
                        </div>
                        <button
                            class="group flex items-center gap-3 rounded-lg bg-red-600 px-9 py-3.5 text-sm font-black uppercase tracking-[0.3em] text-white shadow-[0_0_36px_rgba(220,38,38,0.35)] transition-all hover:bg-red-500 hover:shadow-[0_0_46px_rgba(220,38,38,0.5)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                            :disabled="deploying || (!guestMode && cooldownRemainingMs > 0)"
                            @click="begin()"
                        >
                            <UIcon :name="deploying ? 'i-lucide-loader-circle' : staleRunConflict ? 'i-lucide-trash-2' : 'i-lucide-chevrons-right'" class="size-4" :class="deploying ? 'animate-spin' : 'transition-transform group-hover:translate-x-0.5'" />
                            {{ deploying ? 'Deploying' : staleRunConflict ? 'Abandon run & deploy' : 'Deploy' }}
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Workbench: in-game shopping, the round keeps running behind it -->
        <div
            v-if="workbenchOpen"
            class="pointer-events-none absolute inset-0 flex items-center justify-end bg-black/25 p-4 sm:p-8"
        >
            <div class="pointer-events-auto w-full max-w-md overflow-hidden rounded-2xl border border-amber-400/25 bg-zinc-950/95 font-mono shadow-[0_0_80px_rgba(0,0,0,0.85)] backdrop-blur-sm">
                <div class="flex items-center justify-between gap-4 border-b border-white/10 bg-black/60 px-5 py-3">
                    <div class="flex items-center gap-2.5 text-[10px] uppercase tracking-[0.35em] text-zinc-500">
                        <UIcon name="i-lucide-wrench" class="size-4 text-amber-400/90" />
                        Workbench // Equipment
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="flex items-center gap-1.5 text-sm font-bold tabular-nums text-amber-300">
                            <UIcon name="i-lucide-coins" class="size-3.5" />
                            {{ points.toLocaleString() }}
                        </span>
                        <button
                            class="rounded-md border border-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 transition-colors hover:text-zinc-100"
                            @click="closeWorkbench()"
                        >F close</button>
                    </div>
                </div>

                <div class="space-y-2.5 p-5">
                    <div
                        v-for="(row, index) in equipmentRows"
                        :key="row.equipment.id"
                        class="flex items-center gap-3.5 rounded-xl border px-3.5 py-3"
                        :class="row.affordable
                            ? 'border-white/10 bg-white/[0.03] transition-colors hover:border-amber-400/40'
                            : 'border-white/5 bg-white/[0.01] opacity-60'"
                    >
                        <div class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/50">
                            <UIcon :name="equipmentIcons[row.equipment.id]" class="size-5 text-amber-300/90" />
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="flex items-baseline justify-between gap-2">
                                <span class="text-[13px] font-bold text-zinc-100">{{ row.equipment.name }}</span>
                                <span class="text-[10px] tabular-nums text-zinc-500">
                                    {{ row.dpsLabel }} max-HP/s · {{ row.equipment.duration }}s
                                </span>
                            </div>
                            <div class="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{{ row.equipment.description }}</div>
                        </div>
                        <button
                            class="flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-bold tabular-nums transition-colors disabled:cursor-not-allowed"
                            :class="row.affordable
                                ? 'border-amber-400/50 text-amber-300 hover:bg-amber-400/15'
                                : 'border-white/10 text-zinc-600'"
                            :disabled="!row.affordable"
                            @click="buyEquipment(row.equipment.id)"
                        >
                            <span class="text-[9px] opacity-60">{{ index + 1 }}</span>
                            {{ row.equipment.cost.toLocaleString() }}
                        </button>
                    </div>
                    <p class="pt-1 text-center text-[10px] uppercase tracking-[0.25em] text-red-400/70">
                        The horde does not wait — F close · E deploy · slots {{ equipmentStock.length }}/{{ runEffects.equipmentSlots }}
                    </p>
                </div>
            </div>
        </div>

        <!-- Pause / death -->
        <div
            v-else-if="phase === 'over' || (phase === 'playing' && !locked && !relockPending)"
            class="absolute inset-0 overflow-y-auto bg-black/85 p-4 backdrop-blur-sm sm:p-8"
            style="background-image: radial-gradient(ellipse at 30% 20%, rgba(220,38,38,0.07), transparent 55%)"
        >
            <div class="mx-auto my-auto flex min-h-full w-full max-w-2xl items-center font-mono">
                <div class="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/90 shadow-[0_0_120px_rgba(0,0,0,0.9)]">
                    <!-- scanlines -->
                    <div
                        class="pointer-events-none absolute inset-0 z-10 opacity-[0.35]"
                        style="background-image: repeating-linear-gradient(0deg, transparent 0 2px, rgba(0,0,0,0.3) 2px 4px)"
                    />

                    <!-- top strip -->
                    <div class="relative flex items-center justify-between gap-4 border-b border-white/10 bg-black/60 px-5 py-3">
                        <div class="flex items-center gap-2.5 text-[10px] uppercase tracking-[0.35em] text-zinc-500">
                            <UIcon :name="phase === 'over' ? 'i-lucide-skull' : 'i-lucide-pause'" class="size-4" :class="phase === 'over' ? 'text-red-500/90' : 'text-zinc-400'" />
                            Outpost 13 // {{ phase === 'over' ? 'After Action' : 'Standby' }}
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="rounded-sm border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-400">Round {{ round }}</span>
                            <span class="rounded-sm border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-400">{{ runDifficultyName }}</span>
                        </div>
                    </div>

                    <div class="relative p-7 sm:p-9">
                        <template v-if="phase === 'over'">
                            <h1 class="text-center text-5xl font-black uppercase tracking-tight text-red-500 drop-shadow-[0_2px_12px_rgba(220,38,38,0.35)]">
                                You Died
                            </h1>
                            <p class="mt-1.5 text-center text-[11px] uppercase tracking-[0.3em] text-zinc-500">
                                Overrun on round {{ round }} · {{ runDifficultyName }}
                            </p>

                            <!-- Cash settlement -->
                            <div v-if="payoutResult" class="mx-auto mt-6 max-w-sm rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3.5 text-left text-sm">
                                <div class="flex items-center justify-between text-zinc-500">
                                    <span class="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.25em]">
                                        <UIcon name="i-lucide-trophy" class="size-3.5" />
                                        Points earned
                                    </span>
                                    <span class="tabular-nums font-bold text-zinc-200">{{ payoutResult.gross.toLocaleString() }}</span>
                                </div>
                                <div v-if="payoutResult.capped" class="mt-1 flex justify-between text-[11px] text-amber-400/80">
                                    <span class="uppercase tracking-[0.2em]">Verified</span>
                                    <span class="tabular-nums">{{ payoutResult.counted.toLocaleString() }}</span>
                                </div>
                                <div class="mt-2 flex items-baseline justify-between border-t border-white/10 pt-2">
                                    <span class="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.25em] text-amber-300/80">
                                        <UIcon name="i-lucide-coins" class="size-3.5" />
                                        Cash paid out
                                    </span>
                                    <span class="text-2xl font-black tabular-nums text-amber-300">
                                        +{{ payoutResult.awarded.toLocaleString() }}
                                    </span>
                                </div>
                            </div>
                            <div v-else-if="!guestMode" class="mt-6 flex items-center justify-center gap-2 text-xs uppercase tracking-[0.3em] text-zinc-500">
                                <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
                                Settling…
                            </div>

                            <div class="mx-auto mt-7 grid max-w-md grid-cols-2 gap-x-8 gap-y-2 text-left text-[13px]">
                                <div v-for="stat in summary" :key="stat.label" class="flex justify-between border-b border-white/10 pb-1">
                                    <span class="text-zinc-500">{{ stat.label }}</span>
                                    <span class="font-bold tabular-nums text-zinc-100">{{ stat.value }}</span>
                                </div>
                            </div>
                            <p v-if="round >= bestRound" class="mt-5 flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.3em] text-amber-300">
                                <UIcon name="i-lucide-medal" class="size-4" />
                                Best round yet
                            </p>
                        </template>
                        <template v-else>
                            <h1 class="text-center text-4xl font-black uppercase tracking-tight text-zinc-100">Paused</h1>
                            <div class="mt-4 flex flex-wrap items-center justify-center gap-3 text-sm">
                                <span class="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-zinc-300">
                                    <UIcon name="i-lucide-swords" class="size-4 text-red-400" />
                                    Round <span class="font-black tabular-nums">{{ round }}</span>
                                </span>
                                <span class="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-zinc-300">
                                    <UIcon name="i-lucide-coins" class="size-4 text-amber-400/80" />
                                    <span class="font-black tabular-nums text-amber-300">{{ points.toLocaleString() }}</span>
                                    <span class="text-[10px] uppercase tracking-[0.2em] text-zinc-500">points</span>
                                </span>
                            </div>
                            <div v-if="pausePayoutPreview" class="mx-auto mt-3 max-w-sm rounded-xl border border-amber-400/20 bg-amber-400/[0.07] px-4 py-3">
                                <div class="flex items-center justify-between gap-3">
                                    <span class="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.25em] text-amber-300/80">
                                        <UIcon name="i-lucide-banknote" class="size-3.5" />
                                        Run value if you die now
                                    </span>
                                    <span class="text-2xl font-black tabular-nums text-amber-300">
                                        {{ pausePayoutPreview.awarded.toLocaleString() }}
                                    </span>
                                </div>
                                <div class="mt-1.5 border-t border-amber-400/10 pt-1.5 text-[10px] leading-relaxed text-zinc-500">
                                    <template v-if="pausePayoutPreview.capped">
                                        Verified down to {{ pausePayoutPreview.counted.toLocaleString() }} of {{ Math.round(grossEarned).toLocaleString() }} points — the wall clock caps what a run this long can claim
                                    </template>
                                    <template v-else>
                                        {{ Math.round(grossEarned).toLocaleString() }} points earned ×
                                        {{ (CALL_OF_XENO_PAYOUT_RATE * runDifficulty.reward * runEffects.payoutMult).toFixed(2) }} cash per point ({{ runDifficultyName }})
                                        — paid to your balance when this run ends.
                                    </template>
                                </div>
                            </div>

                            <div v-if="phase === 'playing'" class="mx-auto mt-4 flex max-w-sm items-center justify-between gap-3">
                                <span class="text-[10px] uppercase tracking-[0.25em] text-zinc-600">Esc to resume</span>
                                <button
                                    class="flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-amber-300 transition-colors hover:bg-amber-400/20"
                                    :disabled="exiting"
                                    @click="exitRun()"
                                >
                                    <UIcon :name="exiting ? 'i-lucide-loader-circle' : 'i-lucide-log-out'" class="size-3.5" :class="exiting ? 'animate-spin' : ''" />
                                    {{ exiting ? 'Cashing out' : 'Cash out & exit' }}
                                </button>
                            </div>
                        </template>

                        <div v-if="phase !== 'over'" class="mx-auto mt-8 grid max-w-sm grid-cols-2 gap-x-6 gap-y-2 text-left text-[12px] text-zinc-500">
                            <div><span class="rounded-sm border border-white/15 bg-white/5 px-1.5 py-0.5 font-bold text-zinc-200">WASD</span> move</div>
                            <div><span class="rounded-sm border border-white/15 bg-white/5 px-1.5 py-0.5 font-bold text-zinc-200">Space</span> jump</div>
                            <div><span class="rounded-sm border border-white/15 bg-white/5 px-1.5 py-0.5 font-bold text-zinc-200">Shift</span> sprint</div>
                            <div><span class="rounded-sm border border-white/15 bg-white/5 px-1.5 py-0.5 font-bold text-zinc-200">LMB</span> fire</div>
                            <div><span class="rounded-sm border border-white/15 bg-white/5 px-1.5 py-0.5 font-bold text-zinc-200">RMB</span> aim</div>
                            <div><span class="rounded-sm border border-white/15 bg-white/5 px-1.5 py-0.5 font-bold text-zinc-200">R</span> reload</div>
                            <div><span class="rounded-sm border border-white/15 bg-white/5 px-1.5 py-0.5 font-bold text-zinc-200">Q</span> swap weapon</div>
                            <div><span class="rounded-sm border border-white/15 bg-white/5 px-1.5 py-0.5 font-bold text-zinc-200">E</span> deploy equipment</div>
                            <div><span class="rounded-sm border border-white/15 bg-white/5 px-1.5 py-0.5 font-bold text-zinc-200">F</span> buy / board up</div>
                            <div><span class="rounded-sm border border-white/15 bg-white/5 px-1.5 py-0.5 font-bold text-zinc-200">V</span> knife</div>
                            <div><span class="rounded-sm border border-white/15 bg-white/5 px-1.5 py-0.5 font-bold text-zinc-200">Esc</span> pause</div>
                        </div>

                        <p v-if="initError" class="mx-auto mt-6 max-w-md rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-center text-xs text-red-300">
                            Could not start the renderer: {{ initError }}
                        </p>
                    </div>

                    <!-- footer -->
                    <div class="relative flex items-center justify-between gap-4 border-t border-white/10 bg-black/60 px-5 py-4">
                        <p class="text-[10px] uppercase tracking-[0.2em] text-zinc-600">
                            {{ phase === 'over' ? 'The horde does not wait.' : 'Your mouse is captured while playing. Esc gives it back.' }}
                        </p>
                        <button
                            class="group flex shrink-0 items-center gap-3 rounded-lg bg-red-600 px-8 py-3 text-sm font-black uppercase tracking-[0.3em] text-white shadow-[0_0_36px_rgba(220,38,38,0.35)] transition-all hover:bg-red-500 hover:shadow-[0_0_46px_rgba(220,38,38,0.5)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                            :disabled="deploying"
                            @click="phase === 'over' ? restart() : begin()"
                        >
                            <UIcon :name="deploying ? 'i-lucide-loader-circle' : 'i-lucide-chevrons-right'" class="size-4" :class="deploying ? 'animate-spin' : 'transition-transform group-hover:translate-x-0.5'" />
                            {{ phase === 'over' ? (guestMode ? 'Run It Back' : 'Back to Outpost') : 'Resume' }}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import * as THREE from 'three'
import {
    CALL_OF_XENO_WEAPONS,
    CALL_OF_XENO_PERKS,
    CALL_OF_XENO_ENEMIES,
    CALL_OF_XENO_POWERUPS,
    CALL_OF_XENO_MODIFIERS,
    CALL_OF_XENO_BOX_COST,
    CALL_OF_XENO_BOX_POOL,
    CALL_OF_XENO_BASE_HEALTH,
    CALL_OF_XENO_JUGGERNOG_HEALTH,
    CALL_OF_XENO_REGEN_RATE,
    CALL_OF_XENO_HIT_POINTS,
    CALL_OF_XENO_KILL_POINTS,
    CALL_OF_XENO_HEADSHOT_POINTS,
    CALL_OF_XENO_STARTING_POINTS,
    CALL_OF_XENO_KNIFE_KILL_POINTS,
    CALL_OF_XENO_BLAST_SELF_FRACTION,
    CALL_OF_XENO_BLAST_SELF_CAP,
    perkPrice,
    CALL_OF_XENO_QUICK_REVIVE_MAX_BUYS,
    CALL_OF_XENO_POWERUP_CHANCE,
    CALL_OF_XENO_POWERUP_LIFETIME,
    CALL_OF_XENO_NUKE_POINTS,
    CALL_OF_XENO_SPECIAL_ROUND_BONUS,
    CALL_OF_XENO_FRENZY_SPEED,
    CALL_OF_XENO_ROUND_BREAK,
    packAPunch,
    packAPunchCost,
    ammoCost,
    xenoRayFalloff,
    xenoDamageFalloff,
    roundComposition,
    isSpecialRound,
    specialRoundEnemy,
    roundModifier,
    multiKillBonus,
    CALL_OF_XENO_EQUIPMENT,
    CALL_OF_XENO_BLACKHOLE_RADIUS,
    CALL_OF_XENO_BLACKHOLE_TICK,
    CALL_OF_XENO_EQUIPMENT_DROP_CHANCE,
    CALL_OF_XENO_EQUIPMENT_DROP_LIFETIME,
    equipmentDamage,
    zombieHealth,
    zombieCount,
    zombieSpeed,
    zombieSpawnInterval,
    zombieDamage,
    maxAlive,
    type CallOfXenoEnemy,
    type CallOfXenoEnemyId,
    type CallOfXenoEquipment,
    type CallOfXenoEquipmentId,
    type CallOfXenoModifier,
    type CallOfXenoPerk,
    type CallOfXenoPerkId,
    type CallOfXenoPowerUpId,
    type CallOfXenoWeapon,
    type CallOfXenoWeaponId
} from '#shared/utils/gamelogic/call-of-xeno'
import {
    CALL_OF_XENO_DOORS,
    CALL_OF_XENO_INTERACTABLES,
    CALL_OF_XENO_WINDOWS,
    CALL_OF_XENO_WINDOW_BARRIERS,
    CALL_OF_XENO_WINDOW_BOARDS,
    CALL_OF_XENO_WINDOW_SILL,
    CALL_OF_XENO_WINDOW_HEAD,
    CALL_OF_XENO_TEAR_TIME,
    CALL_OF_XENO_CLIMB_TIME,
    CALL_OF_XENO_WINDOW_SLOT_RADIUS,
    windowApproachSlot,
    CALL_OF_XENO_REPAIR_TIME,
    CALL_OF_XENO_REPAIR_POINTS,
    CALL_OF_XENO_PLAYER_START,
    CALL_OF_XENO_BARREL_SPOTS,
    CALL_OF_XENO_STEP_UP,
    buildNavTable,
    bannedNodesFor,
    reachableWindows,
    nearestNode,
    collisionSolids,
    solidsInBand,
    groundHeight,
    rampUnderBody,
    waypointFootingOk,
    rayBlockDistance,
    resolveCircle,
    type CallOfXenoBox,
    type CallOfXenoSolid,
    type CallOfXenoWindow
} from '#shared/utils/gamelogic/call-of-xeno-map'
import {
    buildNavGrid,
    findNavPath,
    navLineClear,
    navLevelOf,
    type CallOfXenoNavPoint
} from '#shared/utils/gamelogic/call-of-xeno-nav'
import {
    CALL_OF_XENO_DIFFICULTIES,
    CALL_OF_XENO_EMPTY_LEVELS,
    CALL_OF_XENO_PAYOUT_RATE,
    CALL_OF_XENO_SIDEARM_LADDER,
    callOfXenoDifficulty,
    callOfXenoPayoutForRun,
    callOfXenoSidearmUnlocked,
    callOfXenoUpgradeEffects,
    type CallOfXenoBestRounds,
    type CallOfXenoDifficulty,
    type CallOfXenoDifficultyId,
    type CallOfXenoUpgradeEffects,
    type CallOfXenoUpgradeId,
    type CallOfXenoUpgradeLevels
} from '#shared/utils/gamelogic/call-of-xeno-meta'
import { CALL_OF_XENO_SAVE_VERSION, type CallOfXenoRunSave } from '#shared/utils/gamelogic/call-of-xeno-save'
import { randomFloat, randomWeighted } from '#shared/utils/random'
import { CallOfXenoAudio } from '~/utils/call-of-xeno/sounds'
import { CallOfXenoEffects } from '~/utils/call-of-xeno/effects'
import { makeFlashTexture } from '~/utils/call-of-xeno/textures'
import { buildLevel, type LevelHandles } from '~/utils/call-of-xeno/level'
import {
    buildEnemy,
    flashEnemy,
    buildWeaponModel,
    buildPowerUp,
    buildProjectile,
    buildBulletProjectile,
    buildExplosiveBarrel,
    buildSentry,
    buildCompanionDrone,
    buildBlackHole,
    buildEquipmentDrop,
    type EnemyModel,
    type SentryModel,
    type CompanionDroneModel,
    type BlackHoleModel
} from '~/utils/call-of-xeno/models'

// ---------------------------------------------------------------------------
// HUD state
// ---------------------------------------------------------------------------

const viewport = ref<HTMLDivElement | null>(null)
const phase = ref<'menu' | 'playing' | 'over'>('menu')
const locked = ref(false)
const health = ref(CALL_OF_XENO_BASE_HEALTH)
const maxHealth = ref(CALL_OF_XENO_BASE_HEALTH)
const points = ref(CALL_OF_XENO_STARTING_POINTS)
const round = ref(1)
const bestRound = ref(0)
const enemiesLeft = ref(0)
const weaponName = ref(CALL_OF_XENO_WEAPONS.m1911.name)
const papTier = ref(0)
const stowedName = ref('')
const magAmmo = ref(0)
const reserveAmmo = ref(0)
const magFraction = ref(100)
const reloading = ref(false)
/** 0-100 progress of the reload, drives the ammo bar fill while reloading. */
const reloadFraction = ref(0)
const prompt = ref('')
const promptAffordable = ref(true)
const banner = ref('')
const subBanner = ref('')
const bannerColor = ref('#dc2626')
const powerOn = ref(false)
const hitMarker = ref(0)
const lastHitKind = ref<'body' | 'head' | 'weak'>('body')
const hurtOpacity = ref(0)
const hurtVeil = ref(0)
const damageFlash = ref(0)
const hurtMarks = shallowRef<{ id: number, angle: number, life: number }[]>([])
const crossGap = ref(8)
const muted = ref(false)
const specialRound = ref(false)
const modifierName = ref('')
const instakillOn = ref(false)
const ownedPerks = shallowRef<CallOfXenoPerk[]>([])
const activePowerUps = shallowRef<{ id: string, name: string, color: string, remaining: number }[]>([])
/** In-game workbench menu — the sim keeps running while it is up. */
const workbenchOpen = ref(false)
/**
 * True between closing the workbench and the pointer lock actually landing.
 * The re-lock request is asynchronous and can be refused (browsers rate-limit
 * it), and without this flag the pause overlay would flash open for exactly
 * that gap — Esc is meant to close the bench, and only a second Esc pauses.
 */
const relockPending = ref(false)
/** Where the player stood when the bench opened — walk away and it shuts. */
let workbenchAnchorX = 0
let workbenchAnchorZ = 0
/** Equipment bought but not yet deployed. */
const equipmentStock = shallowRef<CallOfXenoEquipmentId[]>([])
/** Deployed units still on the field, one chip each. */
const activeEquipment = shallowRef<{ key: string, label: string, color: string, icon: string, remaining: number }[]>([])
const equipmentIcons: Record<CallOfXenoEquipmentId, string> = {
    sentry: 'i-lucide-crosshair',
    drone: 'i-lucide-send',
    blackhole: 'i-lucide-circle-dot'
}
const summary = shallowRef<{ label: string, value: string }[]>([])
const initError = ref('')

// ---------------------------------------------------------------------------
// Account meta-progression (upgrades, difficulties, payouts)
// ---------------------------------------------------------------------------

interface MetaUpgradeRow {
    id: CallOfXenoUpgradeId
    name: string
    description: string
    max: number
    level: number
    cost: number | null
}

interface MetaDifficultyRow extends CallOfXenoDifficulty {
    unlocked: boolean
}

const { fetchSession } = useAuth()
const metaReady = ref(false)
const guestMode = ref(false)
const metaBalance = ref(0)
const metaUpgrades = shallowRef<MetaUpgradeRow[]>([])
const metaDifficulties = shallowRef<MetaDifficultyRow[]>([])
const metaBestRounds = shallowRef<CallOfXenoBestRounds>({ recruit: 0, veteran: 0, survivor: 0, nightmare: 0 })
const metaStats = shallowRef({ runsPlayed: 0, totalEarned: '0', bestEarned: 0 })
const selectedDifficulty = ref<CallOfXenoDifficultyId>('recruit')
const cooldownRemainingMs = ref(0)
const menuError = ref('')
const deploying = ref(false)
/** Set when the server reports a stuck run — the next deploy abandons it. */
const staleRunConflict = ref(false)
/** Pause-menu cash-out in flight. */
const exiting = ref(false)
const payoutResult = shallowRef<{ awarded: number, counted: number, capped: boolean, gross: number } | null>(null)
const runDifficultyName = ref('Recruit')

/** Snapshot of the account power this deployed run actually runs on. */
let runDifficulty: CallOfXenoDifficulty = CALL_OF_XENO_DIFFICULTIES[0]!
let runEffects: CallOfXenoUpgradeEffects = callOfXenoUpgradeEffects(CALL_OF_XENO_EMPTY_LEVELS)
/** Lifetime points earned this run — the number the payout is settled on. */
const grossEarned = ref(0)
/** True while a server-armed run is in flight and owes a finish-run. */
let serverRunActive = false
/** Wall-clock start of the current run — drives the honest payout preview. */
let runStartMs = 0

// Round-boundary checkpoint of the active run. Saved after every completed
// round so a crash or lost connection resumes at the round's start instead
// of losing the run outright.
let saveRevision = 0
let pendingSave: Promise<void> | null = null
const resumableSave = shallowRef<CallOfXenoRunSave | null>(null)
const resumableRun = shallowRef<{
    difficulty: CallOfXenoDifficultyId
    startedAt: string
    payoutMult: number
    revision: number
} | null>(null)

/** Chosen starting weapon for the next run. Kept across menu visits, reset to the best unlocked one after buys. */
const chosenSidearm = ref<CallOfXenoWeaponId>('m1911')

/** Menu tab: loadout briefing or the best-runs board. */
const menuTab = ref<'loadout' | 'leaderboard'>('loadout')
const leaderboard = shallowRef<{ rank: number, isCurrentUser: boolean, name: string, rounds: number, durationSeconds: number, difficulty: CallOfXenoDifficultyId }[] | null>(null)
const leaderboardLoading = ref(false)

async function loadLeaderboard() {
    if (leaderboard.value !== null || leaderboardLoading.value) return
    leaderboardLoading.value = true
    try {
        leaderboard.value = await $fetch('/api/call-of-xeno/leaderboard')
    } catch {
        leaderboard.value = []
    } finally {
        leaderboardLoading.value = false
    }
}

watch(menuTab, (tab) => {
    if (tab === 'leaderboard') void loadLeaderboard()
})

function formatDuration(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60)
    if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    const seconds = totalSeconds % 60
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

const sidearmChoices = computed(() => {
    const sidearmLevel = metaUpgrades.value.find(u => u.id === 'sidearm')?.level ?? 0
    // The M1911 is always in your pocket and not shown here — these are the
    // extra drop-in weapons the Sidearm upgrade stacks on top of it.
    return CALL_OF_XENO_SIDEARM_LADDER.map(id => ({ id, unlocked: callOfXenoSidearmUnlocked(id, sidearmLevel) }))
})

// Keeps the selection on the best weapon the account still owns (a downgrade
// after the ladder resets would otherwise stick on a locked card). The
// sentinel 'm1911' means "pistol only" and is always legal.
watch(sidearmChoices, (choices) => {
    if (chosenSidearm.value !== 'm1911' && !choices.some(c => c.id === chosenSidearm.value && c.unlocked)) {
        chosenSidearm.value = [...choices].reverse().find(c => c.unlocked)?.id ?? 'm1911'
    }
}, { immediate: true })

const STARTER_IDS: CallOfXenoWeaponId[] = CALL_OF_XENO_SIDEARM_LADDER

async function refreshMeta() {
    try {
        const state = await $fetch('/api/call-of-xeno/state')
        guestMode.value = false
        metaReady.value = true
        metaBalance.value = Number(state.balance) || 0
        metaUpgrades.value = state.upgrades
        metaDifficulties.value = state.difficulties
        metaBestRounds.value = state.stats.bestRounds
        metaStats.value = state.stats
        cooldownRemainingMs.value = state.runCooldown?.remainingMs ?? 0
        if (serverRunActive && state.activeRun && CALL_OF_XENO_DIFFICULTIES.some(d => d.id === state.activeRun?.difficulty)) {
            selectedDifficulty.value = state.activeRun.difficulty as CallOfXenoDifficultyId
        }
        // A crashed run with a checkpoint is offered back as a resume; a run
        // without one is dead weight the deploy flow already knows how to
        // clear. Only meaningful from the menu — mid-run refreshes keep the
        // live run's state untouched.
        const active = state.activeRun
        if (!serverRunActive && active?.save && active.save.version === CALL_OF_XENO_SAVE_VERSION) {
            resumableSave.value = active.save
            resumableRun.value = {
                difficulty: (CALL_OF_XENO_DIFFICULTIES.some(d => d.id === active.difficulty)
                    ? active.difficulty
                    : 'recruit') as CallOfXenoDifficultyId,
                startedAt: String(active.startedAt),
                payoutMult: active.payoutMult,
                revision: active.revision ?? 0
            }
        } else {
            resumableSave.value = null
            resumableRun.value = null
        }
        if (!state.difficulties.some((d: MetaDifficultyRow) => d.id === selectedDifficulty.value && d.unlocked)) {
            selectedDifficulty.value = 'recruit'
        }
    } catch {
        // 401 or offline: the game stays fully playable, just bankless.
        guestMode.value = true
        metaReady.value = true
        metaUpgrades.value = []
        cooldownRemainingMs.value = 0
        resumableSave.value = null
        resumableRun.value = null
    }
}

async function buyUpgrade(id: CallOfXenoUpgradeId) {
    if (guestMode.value) return
    try {
        await $fetch('/api/call-of-xeno/upgrade', { method: 'POST', body: { upgradeId: id } })
        await fetchSession()
        await refreshMeta()
    } catch (error) {
        menuError.value = error instanceof Error ? error.message : 'Upgrade failed'
    }
}

/** In-run price after the Scavenger discount. */
function price(base: number) {
    return Math.max(1, Math.round(base * runEffects.costMult))
}

const cooldownLabel = computed(() => {
    const ms = cooldownRemainingMs.value
    if (ms <= 0) return ''
    const minutes = Math.ceil(ms / 60_000)
    return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`
})

const payoutRateLabel = computed(() => {
    const difficulty = metaDifficulties.value.find(d => d.id === selectedDifficulty.value)
    const reward = difficulty?.reward ?? 1
    return `×${(CALL_OF_XENO_PAYOUT_RATE * reward).toFixed(2)}`
})

/** What dying right now would pay — same ceiling and caps the server settle uses. */
const pausePayoutPreview = computed(() => {
    if (guestMode.value) return null
    return callOfXenoPayoutForRun(grossEarned.value, Date.now() - runStartMs, runDifficulty, runEffects.payoutMult)
})

const upgradeIcons: Record<CallOfXenoUpgradeId, string> = {
    warChest: 'i-lucide-package',
    bodyArmor: 'i-lucide-shield',
    adrenaline: 'i-lucide-heart-pulse',
    scavenger: 'i-lucide-wrench',
    contract: 'i-lucide-scroll-text',
    sidearm: 'i-lucide-crosshair',
    rig: 'i-lucide-backpack'
}

const difficultyIcons: Record<CallOfXenoDifficultyId, string> = {
    recruit: 'i-lucide-shield',
    veteran: 'i-lucide-crosshair',
    survivor: 'i-lucide-flame',
    nightmare: 'i-lucide-skull'
}

/** Accent per tier, shared by the difficulty cards and the record chips. */
const difficultyAccent: Record<CallOfXenoDifficultyId, string> = {
    recruit: 'text-emerald-300',
    veteran: 'text-amber-300',
    survivor: 'text-orange-400',
    nightmare: 'text-red-400'
}

function formatCoins(value: number) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

interface ScreenPopup {
    id: number
    left: number
    top: number
    opacity: number
    color: string
    size: number
    text: string
}
const popups = shallowRef<ScreenPopup[]>([])

const lowHealth = computed(() => health.value / maxHealth.value < 0.34)

function perkCss(color: number) {
    return '#' + color.toString(16).padStart(6, '0')
}

/** Menu-display lists, frozen once — the roster does not change mid-session. */
const CALL_OF_XENO_PERK_LIST = Object.values(CALL_OF_XENO_PERKS)

/** Tier name of the run the server is holding for a resume. */
const resumableDifficultyName = computed(() =>
    metaDifficulties.value.find(d => d.id === resumableRun.value?.difficulty)?.name
    ?? CALL_OF_XENO_DIFFICULTIES.find(d => d.id === resumableRun.value?.difficulty)?.name
    ?? ''
)
const CALL_OF_XENO_WEAPON_TYPE: Record<CallOfXenoWeaponId, string> = {
    m1911: 'pistol',
    skorpion: 'SMG',
    magnum: 'pistol',
    trench: 'shotgun',
    mp40: 'SMG',
    ak74: 'assault',
    bar: 'rifle',
    rpk: 'LMG',
    m60: 'LMG',
    fnmag: 'LMG',
    xenoray: 'wonder'
}
const CALL_OF_XENO_WEAPON_LIST = (Object.keys(CALL_OF_XENO_WEAPONS) as CallOfXenoWeaponId[])
    .map(id => ({ id, name: CALL_OF_XENO_WEAPONS[id].name, type: CALL_OF_XENO_WEAPON_TYPE[id] }))

function perkShort(id: CallOfXenoPerkId) {
    return { juggernog: 'JUG', speedcola: 'SPD', doubletap: '2TAP', quickrevive: 'REV' }[id]
}

// ---------------------------------------------------------------------------
// Types and tuning
// ---------------------------------------------------------------------------

interface WeaponSlot {
    base: CallOfXenoWeaponId
    def: CallOfXenoWeapon
    tier: number
    mag: number
    reserve: number
}

/**
 * Where an enemy is in the business of getting at the player. Everything
 * spawns `outside` at a window, tears its boards off, `breaching` climbs
 * through the opening, and only then does it join the navigation graph.
 */
type EnemyStage = 'outside' | 'breaching' | 'inside'

interface Enemy {
    def: CallOfXenoEnemy
    model: EnemyModel
    stage: EnemyStage
    /** The window it came in by. Null once it is inside. */
    window: CallOfXenoWindow | null
    /** Spawn order. Fixes the queue at a window: first in line, first through. */
    seq: number
    /** Place in that queue. 0 is the body actually working the boards. */
    slot: number
    /**
     * True once it has reached its queue slot. A posted body is anchored:
     * the separation pass may not shove it, because shoving it off the slot
     * is exactly what used to stall a barricade indefinitely.
     */
    posted: boolean
    /** Seconds left on the board it is currently prising off. */
    tearTimer: number
    /** Progress of the climb-through animation, 0 to 1. */
    climb: number
    x: number
    y: number
    z: number
    vy: number
    yaw: number
    health: number
    maxHealth: number
    speed: number
    attackCooldown: number
    fireCooldown: number
    flash: number
    phase: number
    groanIn: number
    /** Hit stagger: movement paused while positive. */
    stagger: number
    /** Accumulator for stuck-detection steering. */
    stuck: number
    /** Which way the wall-slide steers: +1 or -1. */
    stuckSide: number
    /** Waypoints of the route the zombie is currently walking. */
    path: CallOfXenoNavPoint[]
    /** Seconds until the route is replanned. Staggered per zombie. */
    repathIn: number
}

/** Live state of one boarded window. */
interface WindowState {
    def: CallOfXenoWindow
    boards: number
    /** Seconds of repair effort banked toward the next board. */
    repair: number
}

interface Corpse {
    model: EnemyModel
    life: number
    fall: number
    spin: number
}

interface Projectile {
    mesh: THREE.Mesh
    x: number
    y: number
    z: number
    vx: number
    vy: number
    vz: number
    damage: number
    life: number
}

interface GroundPowerUp {
    id: CallOfXenoPowerUpId
    group: THREE.Group
    light: THREE.PointLight
    x: number
    y: number
    z: number
    life: number
    spin: number
}

/** A shootable fuel barrel. Solid until it explodes. */
interface Barrel {
    x: number
    z: number
    solid: CallOfXenoSolid
    group: THREE.Group
    alive: boolean
}

interface WorldPopup {
    id: number
    x: number
    y: number
    z: number
    vy: number
    life: number
    maxLife: number
    text: string
    color: string
    size: number
}

/**
 * DEBUG — testing only. While true the player cannot drop below 1 HP: every
 * hit still lands, shakes, flashes and plays its sound, but the run never
 * ends. Flip back to false before committing.
 */
const DEBUG_GOD_MODE = false

const PLAYER_RADIUS = 0.35
const PLAYER_HEIGHT = 1.8
const PLAYER_EYE = 1.68
const GRAVITY = 24
const JUMP_SPEED = 7.8
const WALK_SPEED = 4.4
const SPRINT_SPEED = 6.9
const INTERACT_RANGE = 2.8
const BOX_SPIN_TIME = 3.2
const BOX_READY_TIME = 9

// ---------------------------------------------------------------------------
// three.js objects
// ---------------------------------------------------------------------------

let renderer: THREE.WebGLRenderer | null = null
let scene!: THREE.Scene
let camera!: THREE.PerspectiveCamera
let fog!: THREE.Fog
let effects!: CallOfXenoEffects
let level!: LevelHandles
const audio = new CallOfXenoAudio()

let weaponRoot!: THREE.Group
let weaponModel: THREE.Group | null = null
let boxPreview: THREE.Group | null = null
let muzzleFlash!: THREE.Sprite
let muzzleLight!: THREE.PointLight
let flashTexture!: THREE.Texture

let frameHandle = 0
let disposed = false
/** True once the renderer, scene and first run are up. */
let ready = false

// ---------------------------------------------------------------------------
// Simulation state
// ---------------------------------------------------------------------------

const keys = new Set<string>()
let px = CALL_OF_XENO_PLAYER_START.x
let pz = CALL_OF_XENO_PLAYER_START.z
let feetY = 0
let vy = 0
let grounded = true
let yaw = 0
let pitch = 0
let bob = 0
let swayX = 0
let swayY = 0
let shake = 0
let recoilPitch = 0
let hp = CALL_OF_XENO_BASE_HEALTH
let hpMax = CALL_OF_XENO_BASE_HEALTH
let sinceDamage = 99
/** Seconds of breathing room after a Quick Revive — claws cannot land. */
let reviveGrace = 0
let score = CALL_OF_XENO_STARTING_POINTS
let currentRound = 1
let modifier: CallOfXenoModifier = 'none'
let spawnQueue = 0
let spawnTimer = 0
let breakTimer = 0
let inBreak = false
let bannerTimer = 0
let powered = false
let firing = false
let fireTimer = 0
let reloadTimer = 0
let reloadTotal = 0
let recoil = 0
let bloom = 0
let markerTimer = 0
let swapTimer = 0
let swapTotal = 0.22
let slots: WeaponSlot[] = []
let activeSlot = 0
let popupId = 0
let runTime = 0

// Aim, melee and movement feel.
let aiming = false
let aimBlend = 0
let fovCurrent = 80
let meleeTimer = 0
let meleeCooldown = 0
let stepTimer = 0
let landOff = 0
let landVel = 0
let hbTimer = 0
let isMoving = false
let isSprinting = false
let hurtMarkId = 0
const hurtSources: { id: number, dx: number, dz: number, life: number }[] = []

// Run stats for the summary screen.
let statKills = 0
let statHeadshots = 0
let statSpins = 0
let statDoors = 0
let statBarrels = 0
let statBoards = 0

// Power-up state.
const powerUpTimers: Record<CallOfXenoPowerUpId, number> = {
    instakill: 0, doublepoints: 0, maxammo: 0, nuke: 0
}

// Mystery box state.
let boxState: 'idle' | 'spinning' | 'ready' = 'idle'
let boxTimer = 0
let boxPrize: CallOfXenoWeaponId | null = null
let boxCycle = 0

const perks = new Set<CallOfXenoPerkId>()
/** Quick Revive purchases this run — three, then the machine goes quiet. */
let quickReviveBuys = 0
const openDoors = new Set<string>()
const enemies: Enemy[] = []
/** Window id -> the bodies queued outside it. Rebuilt every frame, reused. */
const windowQueues = new Map<string, Enemy[]>()
const corpses: Corpse[] = []
const projectiles: Projectile[] = []

/** A live player-fired explosive round: a Sally shell or a Xeno Ray bolt. */
interface PlayerRound {
    mesh: THREE.Mesh
    x: number
    y: number
    z: number
    vx: number
    vy: number
    vz: number
    damage: number
    blastRadius: number
    kind: 'sally' | 'ray'
    tier: number
    life: number
    traveled: number
    range: number
    trailTimer: number
    scored: Set<Enemy>
}
const playerRounds: PlayerRound[] = []
const groundPowerUps: GroundPowerUp[] = []
const worldPopups: WorldPopup[] = []
const barrels: Barrel[] = []

// Workbench equipment deployed on the field.
interface SentryUnit {
    model: SentryModel
    x: number
    y: number
    z: number
    life: number
    fireTimer: number
    scored: Set<Enemy>
}
interface EscortUnit {
    model: CompanionDroneModel
    x: number
    y: number
    z: number
    yaw: number
    life: number
    fireTimer: number
    bob: number
    scored: Set<Enemy>
}
interface BlackHoleUnit {
    model: BlackHoleModel
    x: number
    y: number
    z: number
    life: number
    tick: number
    spin: number
    burstTimer: number
    scored: Set<Enemy>
}
const sentries: SentryUnit[] = []
const escorts: EscortUnit[] = []
const blackHoles: BlackHoleUnit[] = []

/** A workbench unit waiting on the floor to be picked up. */
interface GroundEquipment {
    id: CallOfXenoEquipmentId
    group: THREE.Group
    light: THREE.PointLight
    x: number
    y: number
    z: number
    life: number
    spin: number
}
const groundEquipment: GroundEquipment[] = []
const windowStates = new Map<string, WindowState>(
    CALL_OF_XENO_WINDOWS.map(w => [w.id, { def: w, boards: CALL_OF_XENO_WINDOW_BOARDS, repair: 0 }])
)
let solids: CallOfXenoSolid[] = []
let navTable = buildNavTable(new Set())
/** Nodes inside shut doors — never valid waypoints for actors. */
let bannedNodes: ReadonlySet<number> = new Set()
/** Walkability grid the zombies route through. Rebuilt with the solids. */
let navGrid = buildNavGrid(new Set())
let focused: { kind: 'door' | 'interactable', id: string } | null = null
/** The barricade the player is stood at, if any. Drives the repair prompt. */
let focusedWindow: CallOfXenoWindow | null = null

function makeSlot(id: CallOfXenoWeaponId, tier = 0): WeaponSlot {
    const base = CALL_OF_XENO_WEAPONS[id]
    const def = packAPunch(base, tier)
    return { base: id, def, tier, mag: def.magSize, reserve: def.reserveAmmo }
}

function active(): WeaponSlot {
    return slots[activeSlot]!
}

function fireDelayOf(slot: WeaponSlot) {
    return perks.has('doubletap') ? slot.def.fireDelay * 0.75 : slot.def.fireDelay
}

function damageOf(slot: WeaponSlot) {
    return perks.has('doubletap') ? slot.def.damage * 1.5 : slot.def.damage
}

/**
 * Effective spread cone, interpolated by how far the sight has actually
 * settled (aimBlend — the same curve the view model animates on, so an
 * LMG lugging its gun up is still shooting from the hip mid-raise and the
 * crosshair says so). No sight is a laser even fully aimed: every weapon
 * keeps a small residual cone so distant targets stay a real shot, and
 * bloom keeps biting a little mid-spray. Hip fire carries a big penalty
 * that grows with bloom; walking adds to it and sprinting adds more. The
 * crosshair renders this cone exactly, so what you see is where the
 * pellets go.
 */
function spreadOf(slot: WeaponSlot) {
    const hip = slot.def.spread * (0.55 + bloom * 0.85) * (isSprinting ? 5.4 : isMoving ? 3.6 : 2.4)
    const ads = (slot.def.adsSpread ?? slot.def.spread * 0.3) * (0.85 + bloom * 0.5)
    return hip + (ads - hip) * aimBlend
}

function reloadTimeOf(slot: WeaponSlot) {
    return perks.has('speedcola') ? slot.def.reloadTime * 0.5 : slot.def.reloadTime
}

function shootSound(slot: WeaponSlot) {
    switch (slot.base) {
        case 'm1911': return 'shoot-pistol' as const
        case 'skorpion': return 'shoot-smg' as const
        case 'magnum': return 'shoot-rifle' as const
        case 'trench': return 'shoot-shotgun' as const
        case 'mp40': return 'shoot-smg' as const
        case 'ak74': return 'shoot-rifle' as const
        case 'bar': return 'shoot-rifle' as const
        case 'rpk': return 'shoot-lmg' as const
        case 'm60': return 'shoot-lmg' as const
        case 'fnmag': return 'shoot-lmg' as const
        case 'xenoray': return 'shoot-wonder' as const
    }
}

/** Boxes the player can walk into at their current height.
 * The window barriers ride along here and nowhere else: they plug the
 * jump-through-the-window escape without touching enemy pathing, scripted
 * climbs or bullet rays. */
function playerBoxes(): CallOfXenoBox[] {
    return [
        ...solidsInBand(solids, feetY, PLAYER_HEIGHT),
        ...solidsInBand(CALL_OF_XENO_WINDOW_BARRIERS, feetY, PLAYER_HEIGHT)
    ]
}

function rebuildCollision() {
    solids = collisionSolids(openDoors, barrels.filter(b => b.alive).map(b => b.solid))
    navTable = buildNavTable(openDoors)
    bannedNodes = bannedNodesFor(openDoors)
    navGrid = buildNavGrid(openDoors, barrels.filter(b => b.alive).map(b => b.solid))
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

function updatePlayer(dt: number) {
    let fx = 0
    let fz = 0
    if (keys.has('keyw')) fz += 1
    if (keys.has('keys')) fz -= 1
    if (keys.has('keyd')) fx += 1
    if (keys.has('keya')) fx -= 1

    isMoving = fx !== 0 || fz !== 0
    isSprinting = isMoving && (keys.has('shiftleft') || keys.has('shiftright')) && !aiming
    let speed = 0
    if (isMoving) {
        const len = Math.hypot(fx, fz)
        fx /= len
        fz /= len
        const sin = Math.sin(yaw)
        const cos = Math.cos(yaw)
        const dirX = -sin * fz + cos * fx
        const dirZ = -cos * fz - sin * fx
        // Heavier weapons drag: the mobility multiplier is per weapon, small
        // by design — a pistol jogs, a belt-fed trudges, nothing crawls.
        const mobility = slots.length > 0 ? (active().def.mobility ?? 1) : 1
        speed = (isSprinting ? SPRINT_SPEED : aiming ? WALK_SPEED * 0.65 : WALK_SPEED) * mobility
        px += dirX * speed * dt
        pz += dirZ * speed * dt
    }

    const solved = resolveCircle(px, pz, PLAYER_RADIUS, playerBoxes())
    px = solved.x
    pz = solved.z

    // Footsteps keep time with the legs, faster while sprinting.
    if (isMoving && grounded) {
        stepTimer -= dt * (isSprinting ? 1.5 : 1)
        if (stepTimer <= 0) {
            stepTimer = 0.44
            audio.play('footstep')
        }
    } else {
        stepTimer = 0.18
    }

    // Vertical: while grounded the floor is followed — steps up and shallow
    // drops snap. Airborne actors only land when they actually reach the
    // floor; snapping mid-fall from step range is what used to cut jumps
    // short and make landings feel like a vacuum.
    const ground = groundHeight(px, pz, feetY)
    if (grounded) {
        if (vy <= 0 && feetY - ground < CALL_OF_XENO_STEP_UP) {
            feetY = ground
            vy = 0
        } else {
            grounded = false
            vy -= GRAVITY * dt
            feetY += vy * dt
        }
    } else {
        vy -= GRAVITY * dt
        feetY += vy * dt
        if (vy <= 0 && feetY <= ground) {
            const impact = Math.min(1, -vy / 13)
            feetY = ground
            vy = 0
            grounded = true
            landVel = -impact * 2.4
            recoilPitch += impact * 0.035
            if (impact > 0.12) audio.play('land')
        }
    }

    // Landing dip spring: a quick crouch-and-recover instead of a dead stop.
    if (landOff !== 0 || landVel !== 0) {
        landVel += (-landOff * 130 - landVel * 14) * dt
        landOff += landVel * dt
        if (Math.abs(landOff) < 0.0005 && Math.abs(landVel) < 0.005) {
            landOff = 0
            landVel = 0
        }
    }

    bob += dt * speed * 1.6
    const bobAmount = isMoving && grounded ? Math.min(0.055, speed * 0.008) : 0
    const bobY = Math.sin(bob * 2) * bobAmount
    const bobX = Math.cos(bob) * bobAmount * 0.6

    shake = Math.max(0, shake - dt * 4)
    // Recoil recovery is proportional, never a fixed drain: a fixed rate
    // faster than a gun's kicks-per-second cancels the climb entirely (an
    // SMG's spray recovered fully between shots and stayed laser-flat).
    // Pure proportional decay means a sustained spray climbs until the
    // decay matches the kicks — an equilibrium the player pulls down on.
    recoilPitch = recoilPitch > 0.0004 ? Math.max(0, recoilPitch - dt * recoilPitch * 2) : 0

    camera.position.set(
        px + bobX + (Math.random() - 0.5) * shake * 0.4,
        feetY + PLAYER_EYE + bobY + landOff + (Math.random() - 0.5) * shake * 0.4,
        pz
    )
    camera.rotation.set(pitch + recoilPitch, yaw, Math.sin(bob) * 0.006)

    sinceDamage += dt
    if (sinceDamage > runEffects.regenDelaySeconds && hp < hpMax) {
        hp = Math.min(hpMax, hp + CALL_OF_XENO_REGEN_RATE * runEffects.regenRateMult * dt)
    }
}

function jump() {
    if (!grounded) return
    vy = JUMP_SPEED
    grounded = false
}

function updateViewModel(dt: number) {
    swayX += ((keys.has('keya') ? 0.03 : keys.has('keyd') ? -0.03 : 0) - swayX) * Math.min(1, dt * 6)
    swayY += ((keys.has('keyw') ? -0.012 : keys.has('keys') ? 0.012 : 0) - swayY) * Math.min(1, dt * 6)

    // Weight class decides how fast the sight settles: SMGs and the pistol
    // snap in, the BAR leans in, the belt-feds lug. Pack-a-Punch tiers glass
    // up the sights on top of the weapon's own pace, so an upgraded gun
    // still feels like an upgrade the moment you aim.
    const aimSpeed = (active().def.aimSpeed ?? 9) + active().tier * 3
    aimBlend += ((aiming ? 1 : 0) - aimBlend) * Math.min(1, dt * aimSpeed)
    recoil = Math.max(0, recoil - dt * 7)
    const reloadPhase = reloadTotal > 0 ? 1 - Math.abs(reloadTimer / reloadTotal - 0.5) * 2 : 0
    const swapPhase = swapTimer > 0 ? Math.min(1, swapTimer / swapTotal) : 0
    const dip = reloadPhase * 0.22 + swapPhase * 0.3
    const lunge = meleeTimer > 0 ? Math.sin((1 - meleeTimer / 0.28) * Math.PI) : 0

    weaponRoot.position.set(
        0.3 * (1 - aimBlend) + swayX * (1 - aimBlend * 0.7) + Math.cos(bob) * 0.012,
        -0.24 + 0.04 * aimBlend + swayY - dip + Math.sin(bob * 2) * 0.01 + recoil * 0.02,
        -0.55 + 0.13 * aimBlend + recoil * 0.1 - lunge * 0.3
    )
    weaponRoot.rotation.set(
        recoil * 0.28 + reloadPhase * 0.5 + swapPhase * 0.7 - lunge * 0.9,
        swayX * 2 + lunge * 0.35,
        reloadPhase * 0.35
    )

    muzzleFlash.material.opacity = Math.max(0, muzzleFlash.material.opacity - dt * 22)
    muzzleFlash.visible = muzzleFlash.material.opacity > 0.01
    muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 60)
}

function equipModel() {
    if (weaponModel) {
        weaponRoot.remove(weaponModel)
        disposeObject(weaponModel)
    }
    const slot = active()
    weaponModel = buildWeaponModel(slot.base, slot.tier)
    weaponRoot.add(weaponModel)

    // Heavy weapons take longer to shoulder — the swap lock scales with them.
    swapTotal = slot.def.swapTime ?? 0.22
    swapTimer = swapTotal
}

// ---------------------------------------------------------------------------
// Shooting
// ---------------------------------------------------------------------------

const rayOrigin = new THREE.Vector3()
const rayDir = new THREE.Vector3()
const pelletDir = new THREE.Vector3()
const impactPoint = new THREE.Vector3()
const impactNormal = new THREE.Vector3()
const muzzleWorld = new THREE.Vector3()
const rightVector = new THREE.Vector3()
const ROUND_UP = new THREE.Vector3(0, 1, 0)

function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number) {
    const mx = ox - cx
    const my = oy - cy
    const mz = oz - cz
    const b = mx * dx + my * dy + mz * dz
    const c = mx * mx + my * my + mz * mz - r * r
    if (c > 0 && b > 0) return -1
    const disc = b * b - c
    if (disc < 0) return -1
    const t = -b - Math.sqrt(disc)
    return t < 0 ? 0 : t
}

/** A sphere crossing: entry distance plus how deep through the sphere the ray flies. */
interface SphereZone {
    t: number
    /** 0 = grazing the surface, 1 = dead through the centre. */
    depth: number
}

function raySphereZone(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number): SphereZone | null {
    const mx = ox - cx
    const my = oy - cy
    const mz = oz - cz
    const b = mx * dx + my * dy + mz * dz
    const c = mx * mx + my * my + mz * mz - r * r
    if (c > 0 && b > 0) return null
    const disc = b * b - c
    if (disc < 0) return null
    const t = -b - Math.sqrt(disc)
    // Perpendicular miss distance off the ray line is sqrt(r² − disc), so
    // the chord depth ratio falls out of the discriminant directly.
    const depth = 1 - Math.sqrt(Math.max(0, r * r - disc)) / r
    return { t: t < 0 ? 0 : t, depth }
}

/**
 * Nearest hit on an enemy along a ray, distinguishing body, head and weak
 * point. The zone is picked by which sphere the ray passes deepest through,
 * not by which surface it crosses first: the tall types' body sphere swells
 * up behind the head sphere, so a close-range shot aimed square at a
 * Brute's face clips the body's shoulder fringe first and used to score as
 * a body hit — headshotting one inside ~2.5m was impossible. Depth says
 * what the player aimed at; a fringe graze loses to a core pass.
 */
function hitEnemy(enemy: Enemy, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) {
    const scale = enemy.def.scale
    const base = enemy.y

    if (enemy.def.flies) {
        const t = raySphere(ox, oy, oz, dx, dy, dz, enemy.x, base + 1.3 * scale, enemy.z, 0.46 * scale)
        return t < 0 ? null : { t, kind: 'body' as const }
    }

    const body = raySphereZone(ox, oy, oz, dx, dy, dz, enemy.x, base + 1.12 * scale, enemy.z, 0.56 * scale)
    const head = raySphereZone(ox, oy, oz, dx, dy, dz, enemy.x, base + 1.73 * scale, enemy.z, 0.3 * scale)

    let weak: SphereZone | null = null
    if (enemy.def.weakPoint) {
        // The plate is on the enemy's back, so it only counts for a shooter
        // standing behind it — no ray from the front can claim it. Depth
        // then decides against body/head like any other zone. (Entry-order
        // gating used to be the rule, but the body sphere's bulge shades
        // the inset plate even from dead behind, so the weak point was
        // all but unhittable.)
        const bx = enemy.x - Math.sin(enemy.yaw) * 0.24 * scale
        const bz = enemy.z - Math.cos(enemy.yaw) * 0.24 * scale
        weak = raySphereZone(ox, oy, oz, dx, dy, dz, bx, base + 1.24 * scale, bz, 0.3 * scale)
        const behind = (ox - enemy.x) * Math.sin(enemy.yaw) + (oz - enemy.z) * Math.cos(enemy.yaw) < 0
        if (weak && !behind) weak = null
    }

    let best: { t: number, depth: number, kind: 'body' | 'head' | 'weak' } | null = null
    for (const zone of [body && { ...body, kind: 'body' as const }, head && { ...head, kind: 'head' as const }, weak && { ...weak, kind: 'weak' as const }]) {
        if (!zone) continue
        if (!best
            || zone.depth > best.depth + 1e-6
            || (Math.abs(zone.depth - best.depth) <= 1e-6 && zone.t < best.t)) {
            best = zone
        }
    }
    return best
}

/** The enemy a live round struck head-on, and where it struck them. */
interface DirectHit {
    enemy: Enemy
    kind: 'body' | 'head' | 'weak'
}

/**
 * Splash damage of an explosive round at the impact point. Returns the number
 * of enemies killed so callers can award multi-kill bonuses.
 *
 * `direct` is the enemy the round actually hit, if any. They are resolved
 * as a hit on the zone the round entered — full damage, head and weak-point
 * multipliers, no distance falloff — rather than being left to the splash
 * pass. The splash measures from a point half a torso up, which on the tall
 * types sits further from the skull than a small blast radius reaches: a
 * Xeno Ray bolt landing square on a Brute's head is 1.7 units from that
 * reference against a 1.5 radius, so before this the shot did nothing at
 * all. Everything else in range still takes ordinary body splash.
 */
function detonateRound(x: number, y: number, z: number, damage: number, blastRadius: number, scored: Set<Enemy>, kind: 'sally' | 'ray', direct: DirectHit | null = null): number {
    impactPoint.set(x, y, z)
    effects.explosion(impactPoint, kind === 'ray' ? 0x44ffcc : 0xffa040, blastRadius)
    audio.play('explosion')
    shake = Math.min(0.4, shake + 0.18)

    let kills = 0
    if (direct && enemies.includes(direct.enemy)) {
        const multiplier = direct.kind === 'head' ? 1.5 : direct.kind === 'weak' ? (direct.enemy.def.weakPoint ?? 1) : 1
        impactPoint.set(x, y, z)
        if (applyHit(direct.enemy, damage * multiplier, direct.kind, scored, impactPoint)) kills++
    }
    for (const enemy of [...enemies]) {
        if (direct && enemy === direct.enemy) continue
        const dist = Math.hypot(enemy.x - x, enemy.y + enemy.model.torsoY * 0.5 - y, enemy.z - z)
        if (dist > blastRadius) continue
        const falloff = Math.max(0.3, 1 - dist / blastRadius)
        impactPoint.set(enemy.x, enemy.y + enemy.model.torsoY, enemy.z)
        if (applyHit(enemy, damage * falloff, 'body', scored, impactPoint)) kills++
    }
    // The blast sets off any fuel barrel caught in it.
    for (const barrel of [...barrels]) {
        if (!barrel.alive) continue
        if (Math.hypot(barrel.x - x, barrel.z - z) <= blastRadius) explodeBarrel(barrel)
    }
    // Own blasts bite back: standing inside the radius costs a sliver of
    // health, so the launchers stay strong but never free to fire at your feet.
    const selfDist = Math.hypot(px - x, feetY + PLAYER_HEIGHT * 0.5 - y, pz - z)
    if (selfDist < blastRadius + 0.4 && hp > 0) {
        const falloff = Math.max(0.25, 1 - selfDist / (blastRadius + 0.4))
        const self = Math.round(Math.min(CALL_OF_XENO_BLAST_SELF_CAP, damage * CALL_OF_XENO_BLAST_SELF_FRACTION * falloff))
        if (self >= 1) takeDamage(self, x, z)
    }
    return kills
}

/** Launches a live round — the Sally shell arcs, the ray bolt flies flat. */
function spawnPlayerRound(slot: WeaponSlot, damage: number) {
    const ray = slot.base === 'xenoray'
    pelletDir.copy(rayDir)
    const spread = spreadOf(slot)
    if (spread > 0) {
        const angle = randomFloat() * Math.PI * 2
        const radius = Math.sqrt(randomFloat()) * spread
        pelletDir.x += Math.cos(angle) * radius
        pelletDir.y += Math.sin(angle) * radius
        pelletDir.z += (randomFloat() - 0.5) * radius
        pelletDir.normalize()
    }

    muzzleFlash.getWorldPosition(muzzleWorld)
    pelletDir.multiplyScalar(0.35).add(muzzleWorld)
    const speed = ray ? 90 : 33
    const mesh = ray ? buildProjectile(0x44ffcc) : buildBulletProjectile()
    if (ray) mesh.scale.setScalar(0.55)
    mesh.position.copy(pelletDir)
    scene.add(mesh)
    playerRounds.push({
        mesh,
        x: pelletDir.x,
        y: pelletDir.y,
        z: pelletDir.z,
        vx: rayDir.x * speed,
        vy: rayDir.y * speed,
        vz: rayDir.z * speed,
        damage,
        blastRadius: slot.def.blastRadius ?? 2.6,
        kind: ray ? 'ray' : 'sally',
        tier: slot.tier,
        life: 3,
        traveled: 0,
        range: slot.def.range,
        trailTimer: 0,
        scored: new Set()
    })
}

/**
 * Flies every live player round and pops it on the first thing it touches —
 * wall, floor, enemy, barrel or the end of its fuse. The ray bolt keeps the
 * beam's distance falloff: the further it flew, the softer it pops.
 */
function updatePlayerRounds(dt: number) {
    for (let i = playerRounds.length - 1; i >= 0; i--) {
        const round = playerRounds[i]!
        round.life -= dt
        // The shell drops under gravity like a launched grenade; the energy
        // bolt does not.
        if (round.kind === 'sally') round.vy -= 11 * dt

        const speed = Math.hypot(round.vx, round.vy, round.vz) || 1
        const dirx = round.vx / speed
        const diry = round.vy / speed
        const dirz = round.vz / speed
        const step = speed * dt
        const block = rayBlockDistance(round.x, round.y, round.z, dirx, diry, dirz, solids, step + 0.15)

        let hitEnemyAt = -1
        // The nearest enemy the round runs into this step, and the zone it
        // entered them through — carried to the detonation so a direct hit
        // scores as the head or weak-point shot it was.
        let struck: DirectHit | null = null
        for (const enemy of enemies) {
            const hit = hitEnemy(enemy, round.x, round.y, round.z, dirx, diry, dirz)
            if (hit && hit.t <= step && (hitEnemyAt < 0 || hit.t < hitEnemyAt)) {
                hitEnemyAt = hit.t
                struck = { enemy, kind: hit.kind }
            }
        }

        // Trails: the shell draws a thin faint line with a whisper of smoke
        // behind it; the bolt drags a faint teal streak that lingers briefly.
        rayOrigin.set(round.x, round.y, round.z)
        round.x += round.vx * dt
        round.y += round.vy * dt
        round.z += round.vz * dt
        impactPoint.set(round.x, round.y, round.z)
        if (round.kind === 'ray') {
            effects.tracer(rayOrigin, impactPoint, 0x2fae96, 0.02, 0.22)
        } else {
            effects.tracer(rayOrigin, impactPoint, 0x8a6f4a, 0.008, 0.05)
            round.trailTimer -= dt
            if (round.trailTimer <= 0) {
                round.trailTimer = 0.035
                effects.trailSmoke(impactPoint)
            }
        }
        round.traveled += step

        let pop = false
        let pxHit = round.x
        let pyHit = round.y
        let pzHit = round.z
        // Only a pop that came from running into an enemy is a direct hit —
        // a round that ends on a wall or its own fuse is pure splash.
        let direct: DirectHit | null = null

        if (hitEnemyAt >= 0 && hitEnemyAt < block.distance) {
            pxHit = round.x - dirx * (step - hitEnemyAt)
            pyHit = round.y - diry * (step - hitEnemyAt)
            pzHit = round.z - dirz * (step - hitEnemyAt)
            direct = struck
            pop = true
        } else if (block.distance <= step + 0.05) {
            // Solids include fuel barrels — a direct bite sets them off.
            hitBarrel(round.x, round.y, round.z, dirx, diry, dirz, Math.max(0, block.distance - 0.05))
            pxHit = round.x - dirx * Math.max(0, step - block.distance)
            pyHit = round.y - diry * Math.max(0, step - block.distance)
            pzHit = round.z - dirz * Math.max(0, step - block.distance)
            pop = true
        } else if (round.y <= 0.06 && round.vy < 0) {
            // The ground is not a solid box — catch the floor here.
            pyHit = 0.06
            pop = true
        } else if (round.life <= 0 || round.traveled >= round.range) {
            pop = true
        }

        round.mesh.position.set(round.x, round.y, round.z)
        if (round.kind === 'sally') {
            impactNormal.set(round.vx, round.vy, round.vz).normalize()
            round.mesh.quaternion.setFromUnitVectors(ROUND_UP, impactNormal)
        }

        if (pop) {
            scene.remove(round.mesh)
            disposeObject(round.mesh)
            playerRounds.splice(i, 1)
            const falloff = round.kind === 'ray' ? xenoRayFalloff(round.traveled, round.tier) : 1
            const kills = detonateRound(pxHit, pyHit, pzHit, round.damage * falloff, round.blastRadius, round.scored, round.kind, direct)
            announceMultiKill(kills)
        }
    }
}

function shoot() {
    const slot = active()
    if (reloadTimer > 0 || swapTimer > 0) return
    if (slot.mag <= 0) {
        if (slot.reserve > 0) startReload()
        else audio.play('dry-fire')
        return
    }

    slot.mag--
    fireTimer = fireDelayOf(slot)
    bloom = Math.min(1, bloom + (aiming ? 0.22 : 0.34))
    shake = Math.min(0.09, shake + (slot.def.explosive ? 0.05 : slot.base === 'trench' || slot.base === 'rpk' ? 0.05 : 0.025))
    // Per-weapon recoil: every shot kicks UP (a mild ±15% so it sways
    // rather than ticks), aiming soaks a quarter, and the sideways tug is
    // a fraction of the climb so the pattern reads up-and-drift, not
    // symmetric jitter cancelling itself in place.
    const kick = (slot.def.recoilKick ?? 0.012) * (0.85 + randomFloat() * 0.3) * (aiming ? 0.75 : 1)
    recoilPitch += kick
    yaw += (randomFloat() - 0.5) * kick * 0.9
    recoil = Math.min(1.5, recoil * 0.55 + kick * 55)
    audio.play(shootSound(slot))

    muzzleFlash.material.opacity = 1
    muzzleFlash.scale.setScalar(slot.base === 'trench' ? 0.5 : slot.def.explosive ? 0.42 : 0.32)
    muzzleFlash.material.rotation = Math.random() * Math.PI * 2
    muzzleLight.intensity = slot.def.explosive ? 14 : slot.base === 'xenoray' ? 12 : 9
    muzzleLight.color.setHex(slot.base === 'xenoray' ? 0x44ffcc : slot.def.explosive ? 0xff9040 : 0xffbb55)

    const damage = damageOf(slot)
    camera.getWorldPosition(rayOrigin)
    camera.getWorldDirection(rayDir)

    // Launcher-type weapons lob a live round and let it fly; everything else
    // resolves as a hitscan ray in the loop below.
    if (slot.def.projectile) {
        spawnPlayerRound(slot, damage)
        if (slot.mag === 0) startReload()
        return
    }

    muzzleFlash.getWorldPosition(muzzleWorld)
    rightVector.set(1, 0, 0).applyQuaternion(camera.quaternion)
    effects.ejectCasing(muzzleWorld, rightVector)

    const scored = new Set<Enemy>()
    let killsThisShot = 0

    for (let pellet = 0; pellet < slot.def.pellets; pellet++) {
        pelletDir.copy(rayDir)
        // See spreadOf: aiming is the accuracy answer, movement is the tax.
        const spread = spreadOf(slot)
        if (spread > 0) {
            const angle = randomFloat() * Math.PI * 2
            const radius = Math.sqrt(randomFloat()) * spread
            pelletDir.x += Math.cos(angle) * radius
            pelletDir.y += Math.sin(angle) * radius
            pelletDir.z += (randomFloat() - 0.5) * radius
            pelletDir.normalize()
        }

        const block = rayBlockDistance(
            rayOrigin.x, rayOrigin.y, rayOrigin.z,
            pelletDir.x, pelletDir.y, pelletDir.z,
            solids, slot.def.range
        )
        const maxDist = Math.min(slot.def.range, block.distance)

        // A round that bites a live barrel detonates it instead of the wall.
        if (block.distance < slot.def.range
            && hitBarrel(rayOrigin.x, rayOrigin.y, rayOrigin.z, pelletDir.x, pelletDir.y, pelletDir.z, block.distance)) {
            continue
        }

        const hits: { enemy: Enemy, t: number, kind: 'body' | 'head' | 'weak' }[] = []
        for (const enemy of enemies) {
            const hit = hitEnemy(enemy, rayOrigin.x, rayOrigin.y, rayOrigin.z, pelletDir.x, pelletDir.y, pelletDir.z)
            if (!hit || hit.t > maxDist) continue
            hits.push({ enemy, t: hit.t, kind: hit.kind })
        }
        hits.sort((a, b) => a.t - b.t)
        const landed = hits.slice(0, slot.def.penetration)

        for (const hit of landed) {
            impactPoint.copy(pelletDir).multiplyScalar(hit.t).add(rayOrigin)
            // Point blank hits full; long shots slide down the weapon's
            // falloff curve, so range is a real decision per gun.
            const multiplier = (hit.kind === 'head' ? 1.5 : hit.kind === 'weak' ? (hit.enemy.def.weakPoint ?? 1) : 1)
                * xenoDamageFalloff(slot.def, hit.t)
            effects.bloodBurst(impactPoint, pelletDir, hit.kind === 'body' ? 1.2 : 2)
            if (applyHit(hit.enemy, damage * multiplier, hit.kind, scored, impactPoint)) killsThisShot++
        }

        const endDist = landed.length >= slot.def.penetration && landed.length > 0
            ? landed[landed.length - 1]!.t
            : maxDist
        impactPoint.copy(pelletDir).multiplyScalar(endDist).add(rayOrigin)

        if (endDist >= block.distance - 0.001 && block.distance < slot.def.range) {
            impactNormal.set(block.nx, block.ny, block.nz)
            effects.wallImpact(impactPoint, impactNormal)
        }

        if (pellet < 3) {
            muzzleFlash.getWorldPosition(muzzleWorld)
            effects.tracer(muzzleWorld, impactPoint, slot.tier > 0 ? 0xff88ee : 0xffd27a, 0.014, 0.06)
        }
    }

    announceMultiKill(killsThisShot)

    if (slot.mag === 0) startReload()
}

/** Splash and banner for clearing several hostiles with one detonation. */
function announceMultiKill(kills: number) {
    const bonus = multiKillBonus(kills)
    if (bonus <= 0) return
    award(bonus)
    banner.value = `${kills} in one shot`
    subBanner.value = `+${bonus}`
    bannerColor.value = '#fb923c'
    bannerTimer = 1.4
}

/** Applies a points award through the double-points and special-round multipliers. */
function award(base: number) {
    const multiplier = (powerUpTimers.doublepoints > 0 ? 2 : 1)
        * (isSpecialRound(currentRound) ? CALL_OF_XENO_SPECIAL_ROUND_BONUS : 1)
    const total = Math.round(base * multiplier)
    score += total
    // Gross income over the run's life — what the end-of-run payout is
    // settled on. Spending later does not subtract from it.
    grossEarned.value += total
    return total
}

/**
 * Orders the bodies waiting at each window into a queue, front to back.
 *
 * Spawn order decides the ranking, not distance: ranking by distance would
 * have two bodies swap places every time the separation pass nudged them,
 * and each swap would send both walking to the other's slot.
 *
 * Enemies that have started climbing drop out of the queue on the same
 * frame, so the body behind is promoted to the breach slot and walks up
 * while the one ahead is still going through the window.
 */
function assignWindowQueues() {
    windowQueues.clear()
    for (const enemy of enemies) {
        if (enemy.stage !== 'outside' || !enemy.window) continue
        const line = windowQueues.get(enemy.window.id)
        if (line) line.push(enemy)
        else windowQueues.set(enemy.window.id, [enemy])
    }
    for (const line of windowQueues.values()) {
        line.sort((a, b) => a.seq - b.seq)
        for (let rank = 0; rank < line.length; rank++) line[rank]!.slot = rank
    }
}

/** Returns true when the hit killed. */
function applyHit(enemy: Enemy, damage: number, kind: 'body' | 'head' | 'weak', scored: Set<Enemy>, at: THREE.Vector3, source: 'gun' | 'knife' = 'gun') {
    const lethal = powerUpTimers.instakill > 0
    enemy.health -= lethal ? Number.MAX_SAFE_INTEGER : damage
    enemy.flash = 0.1
    markerTimer = 0.18
    lastHitKind.value = kind

    // Non-lethal hits stagger and shove, so heavy rounds feel heavy.
    if (enemy.health > 0) {
        enemy.stagger = Math.min(0.35, enemy.stagger + (isStaunch(enemy) ? 0.08 : 0.18))
        const kx = enemy.x - px
        const kz = enemy.z - pz
        const kl = Math.hypot(kx, kz) || 1
        enemy.x += (kx / kl) * 0.22
        enemy.z += (kz / kl) * 0.22
    }

    let hitPaid = 0
    if (!scored.has(enemy)) {
        scored.add(enemy)
        hitPaid = award(CALL_OF_XENO_HIT_POINTS)
        audio.play(kind === 'body' ? 'hit' : 'headshot')
    }

    if (enemy.health > 0) {
        // Call of Duty grammar: a muted damage figure and, in front of it,
        // the bright money figure that actually matters.
        spawnPopup(at.x, at.y + 0.22, at.z, String(Math.round(damage)), kind === 'body' ? '#94a3b8' : '#c4b489', kind === 'body' ? 13 : 15)
        if (hitPaid > 0) {
            spawnPopup(at.x, at.y, at.z, `+${hitPaid}`, '#ffd75e', 19)
        }
        return false
    }

    if (kind === 'head') statHeadshots++
    const base = source === 'knife'
        ? CALL_OF_XENO_KNIFE_KILL_POINTS
        : kind === 'body' ? CALL_OF_XENO_KILL_POINTS : CALL_OF_XENO_HEADSHOT_POINTS
    registerKill(enemy, base, kind)
    return true
}

/** Brutes and drones shrug off most of the shove; everything else reels. */
function isStaunch(enemy: Enemy) {
    return enemy.def.id === 'brute' || enemy.def.flies === true
}

function registerKill(enemy: Enemy, basePoints: number, kind: 'body' | 'head' | 'weak' | 'nuke') {
    statKills++

    const paid = award(basePoints)
    spawnPopup(
        enemy.x, enemy.y + enemy.model.torsoY + 0.5, enemy.z,
        `+${paid}`,
        kind === 'nuke' ? '#9ae66e' : '#ffd75e',
        kind === 'nuke' ? 26 : kind === 'body' ? 23 : 26
    )
    killEnemy(enemy)
    if (kind !== 'nuke') audio.play('kill')

    if (randomFloat() < CALL_OF_XENO_POWERUP_CHANCE) dropPowerUp(enemy.x, enemy.z, enemy.y)
    else if (randomFloat() < CALL_OF_XENO_EQUIPMENT_DROP_CHANCE) dropEquipment(enemy.x, enemy.z, enemy.y)
}

function spawnPopup(x: number, y: number, z: number, text: string, color: string, size: number) {
    if (worldPopups.length > 30) worldPopups.shift()
    worldPopups.push({
        id: popupId++,
        x: x + (Math.random() - 0.5) * 0.3,
        y,
        z: z + (Math.random() - 0.5) * 0.3,
        vy: 1.1,
        life: 0.85,
        maxLife: 0.85,
        text,
        color,
        size
    })
}

function startReload() {
    const slot = active()
    if (slot.reserve <= 0 || slot.mag >= slot.def.magSize || reloadTimer > 0 || swapTimer > 0) return
    reloadTotal = reloadTimeOf(slot)
    reloadTimer = reloadTotal
    audio.play('reload-start')
}

function finishReload() {
    const slot = active()
    const take = Math.min(slot.def.magSize - slot.mag, slot.reserve)
    slot.mag += take
    slot.reserve -= take
    reloadTotal = 0
    audio.play('reload-end')
}

/** Knife lunge: short cone in front of the player, hard damage, no ammo. */
function melee() {
    if (meleeCooldown > 0 || swapTimer > 0) return
    meleeCooldown = 0.9
    meleeTimer = 0.28
    audio.play('melee')

    camera.getWorldDirection(rayDir)
    const scored = new Set<Enemy>()
    let hitAny = false
    for (const enemy of [...enemies]) {
        const dx = enemy.x - px
        const dz = enemy.z - pz
        const dist = Math.hypot(dx, dz)
        if (dist > 2.4 + enemy.def.scale * 0.4) continue
        if (dist < 1e-4) continue
        const dot = (dx / dist) * rayDir.x + (dz / dist) * rayDir.z
        if (dot < 0.45) continue
        if (Math.abs(enemy.y - feetY) > 2.4) continue

        enemy.x += (dx / dist) * 0.7
        enemy.z += (dz / dist) * 0.7
        impactPoint.set(enemy.x, enemy.y + enemy.model.torsoY, enemy.z)
        effects.bloodBurst(impactPoint, rayDir, 2)
        hitAny = true
        applyHit(enemy, 250, 'body', scored, impactPoint, 'knife')
    }
    if (hitAny) audio.play('melee-hit')
}

// ---------------------------------------------------------------------------
// Power-ups
// ---------------------------------------------------------------------------

function dropPowerUp(x: number, z: number, y: number) {
    const spec = randomWeighted(Object.values(CALL_OF_XENO_POWERUPS), p => p.weight, randomFloat)
    const model = buildPowerUp(spec)
    model.group.position.set(x, y + 0.9, z)
    scene.add(model.group)
    groundPowerUps.push({
        id: spec.id,
        group: model.group,
        light: model.light,
        x,
        y: y + 0.9,
        z,
        life: CALL_OF_XENO_POWERUP_LIFETIME,
        spin: 0
    })
}

function collectPowerUp(entry: GroundPowerUp) {
    const spec = CALL_OF_XENO_POWERUPS[entry.id]
    scene.remove(entry.group)
    disposeObject(entry.group)
    groundPowerUps.splice(groundPowerUps.indexOf(entry), 1)

    bannerColor.value = perkCss(spec.color)
    banner.value = spec.name
    subBanner.value = ''
    bannerTimer = 1.8
    audio.play('perk')

    if (spec.duration > 0) {
        powerUpTimers[entry.id] = spec.duration
        return
    }

    if (entry.id === 'maxammo') {
        for (const slot of slots) {
            slot.mag = slot.def.magSize
            slot.reserve = slot.def.reserveAmmo
        }
        reloadTimer = 0
        reloadTotal = 0
        return
    }

    if (entry.id === 'nuke') {
        for (const enemy of [...enemies]) {
            impactPoint.set(enemy.x, enemy.y, enemy.z)
            effects.deathBurst(impactPoint)
            registerKill(enemy, Math.round(CALL_OF_XENO_NUKE_POINTS / Math.max(1, enemies.length + 1)), 'nuke')
        }
        award(CALL_OF_XENO_NUKE_POINTS)
        shake = 0.2
    }
}

function updatePowerUps(dt: number) {
    for (const id of Object.keys(powerUpTimers) as CallOfXenoPowerUpId[]) {
        if (powerUpTimers[id] > 0) powerUpTimers[id] = Math.max(0, powerUpTimers[id] - dt)
    }
    instakillOn.value = powerUpTimers.instakill > 0

    for (let i = groundPowerUps.length - 1; i >= 0; i--) {
        const entry = groundPowerUps[i]!
        entry.life -= dt
        entry.spin += dt * 2.4
        entry.group.rotation.set(entry.spin * 0.6, entry.spin, entry.spin * 0.3)
        entry.group.position.y = entry.y + Math.sin(entry.spin * 1.6) * 0.12
        entry.light.intensity = 3 + Math.sin(entry.spin * 4) * 1.5
        // Blink out over the last few seconds so a miss feels like a miss.
        entry.group.visible = entry.life > 4 || Math.sin(entry.life * 14) > -0.2

        if (Math.hypot(entry.x - px, entry.z - pz) < 2.2 && Math.abs(entry.y - feetY) < 3) {
            collectPowerUp(entry)
            continue
        }
        if (entry.life <= 0) {
            scene.remove(entry.group)
            disposeObject(entry.group)
            groundPowerUps.splice(i, 1)
        }
    }
}

// ---------------------------------------------------------------------------
// Explosive barrels
// ---------------------------------------------------------------------------

function initBarrels() {
    for (const spot of CALL_OF_XENO_BARREL_SPOTS) {
        const group = buildExplosiveBarrel()
        group.position.set(spot.x, 0, spot.z)
        group.rotation.y = randomFloat() * Math.PI * 2
        scene.add(group)
        barrels.push({
            x: spot.x,
            z: spot.z,
            solid: {
                box: { minX: spot.x - 0.38, maxX: spot.x + 0.38, minZ: spot.z - 0.38, maxZ: spot.z + 0.38 },
                baseY: 0,
                height: 1.1
            },
            group,
            alive: true
        })
    }
}

/** Detonates a barrel: area damage, chain reactions, a proper bang. */
function explodeBarrel(barrel: Barrel) {
    barrel.alive = false
    barrel.group.visible = false
    rebuildCollision()
    statBarrels++
    audio.play('explosion')
    shake = Math.min(0.5, shake + 0.35)

    impactPoint.set(barrel.x, 0.6, barrel.z)
    effects.energyBurst(impactPoint, 0xffa030)
    impactPoint.set(barrel.x, 1, barrel.z)
    effects.energyBurst(impactPoint, 0xff5510)
    impactPoint.set(barrel.x, 0.4, barrel.z)
    effects.wallImpact(impactPoint, new THREE.Vector3(0, 1, 0))

    const scored = new Set<Enemy>()
    for (const enemy of [...enemies]) {
        const dist = Math.hypot(enemy.x - barrel.x, enemy.z - barrel.z)
        if (dist > 3.8) continue
        const damage = Math.round((380 + currentRound * 25) * Math.max(0.25, 1 - dist / 4.4))
        impactPoint.set(enemy.x, enemy.y + enemy.model.torsoY, enemy.z)
        applyHit(enemy, damage, 'body', scored, impactPoint)
    }

    // Chain into neighbours; the alive flag stops the recursion looping.
    for (const other of barrels) {
        if (!other.alive) continue
        if (Math.hypot(other.x - barrel.x, other.z - barrel.z) < 3.2) explodeBarrel(other)
    }
}

/** Did a shot that stopped at `t` along its ray clip a live barrel? */
function hitBarrel(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, t: number): boolean {
    const hx = ox + dx * t
    const hy = oy + dy * t
    const hz = oz + dz * t
    for (const barrel of barrels) {
        if (!barrel.alive) continue
        const b = barrel.solid.box
        if (hx < b.minX - 0.05 || hx > b.maxX + 0.05) continue
        if (hz < b.minZ - 0.05 || hz > b.maxZ + 0.05) continue
        if (hy < -0.05 || hy > barrel.solid.height + 0.05) continue
        explodeBarrel(barrel)
        return true
    }
    return false
}

// ---------------------------------------------------------------------------
// Mystery box
// ---------------------------------------------------------------------------

function clearBoxPreview() {
    if (!boxPreview) return
    level.mysteryBox.mount.remove(boxPreview)
    disposeObject(boxPreview)
    boxPreview = null
}

function showBoxPreview(id: CallOfXenoWeaponId) {
    clearBoxPreview()
    boxPreview = buildWeaponModel(id, 0)
    boxPreview.scale.setScalar(1.5)
    level.mysteryBox.mount.add(boxPreview)
}

function spinBox() {
    boxState = 'spinning'
    boxTimer = BOX_SPIN_TIME
    boxCycle = 0
    boxPrize = randomWeighted(CALL_OF_XENO_BOX_POOL, entry => entry.weight, randomFloat).weapon
    statSpins++
    audio.play('papunch')
}

function updateBox(dt: number) {
    const box = level.mysteryBox
    box.lid.rotation.x = THREE.MathUtils.lerp(
        box.lid.rotation.x,
        boxState === 'idle' ? 0 : -1.5,
        Math.min(1, dt * 6)
    )
    if (box.light) box.light.intensity = boxState === 'idle' ? 0 : boxState === 'ready' ? 6 : 3
    // The price sign steps aside while weapons are on show.
    box.sign.visible = boxState === 'idle'
    for (const material of box.glow) {
        material.color.setHex(boxState === 'idle' ? 0x1a1206 : boxState === 'ready' ? 0xffc457 : 0x7a5418)
    }

    if (boxState === 'idle') return
    boxTimer -= dt
    if (boxPreview) {
        boxPreview.rotation.y += dt * 3
        boxPreview.position.y = Math.sin(boxTimer * 4) * 0.08
    }

    if (boxState === 'spinning') {
        // Cycle through the pool fast, then slow down into the prize.
        boxCycle -= dt
        if (boxCycle <= 0) {
            const progress = 1 - boxTimer / BOX_SPIN_TIME
            boxCycle = 0.06 + progress * progress * 0.4
            const pool = CALL_OF_XENO_BOX_POOL
            showBoxPreview(pool[Math.floor(randomFloat() * pool.length)]!.weapon)
        }
        if (boxTimer <= 0) {
            boxState = 'ready'
            boxTimer = BOX_READY_TIME
            showBoxPreview(boxPrize!)
            audio.play('buy')
        }
        return
    }

    if (boxTimer <= 0) {
        boxState = 'idle'
        boxPrize = null
        clearBoxPreview()
    }
}

function takeBoxPrize() {
    if (boxState !== 'ready' || !boxPrize) return
    giveWeapon(makeSlot(boxPrize))
    boxState = 'idle'
    boxPrize = null
    clearBoxPreview()
    audio.play('buy')
}

function giveWeapon(slot: WeaponSlot) {
    if (slots.length < 2) {
        slots.push(slot)
        activeSlot = slots.length - 1
    } else {
        slots[activeSlot] = slot
    }
    reloadTimer = 0
    reloadTotal = 0
    equipModel()
}

// ---------------------------------------------------------------------------
// Workbench equipment
// ---------------------------------------------------------------------------

const equipmentRows = computed(() => {
    const order: CallOfXenoEquipmentId[] = ['sentry', 'drone', 'blackhole']
    return order.map(id => {
        const equipment = CALL_OF_XENO_EQUIPMENT[id]
        const perSecond = equipment.fireDelay > 0 ? equipment.damagePct / equipment.fireDelay : equipment.damagePct
        return {
            equipment,
            affordable: points.value >= equipment.cost && equipmentStock.value.length < runEffects.equipmentSlots,
            dpsLabel: `×${perSecond.toFixed(2)}`
        }
    })
})

/**
 * The workbench menu is not the pause menu: opening it releases the mouse
 * but the simulation keeps running, so shopping is done under pressure.
 */
function openWorkbench() {
    workbenchOpen.value = true
    relockPending.value = false
    workbenchAnchorX = px
    workbenchAnchorZ = pz
    if (document.pointerLockElement) document.exitPointerLock()
}

function closeWorkbench() {
    if (!workbenchOpen.value) return
    workbenchOpen.value = false
    relockPending.value = true
    // Re-capture the mouse straight away; the flag above hides the pause
    // overlay until the request resolves either way.
    const canvas = viewport.value?.querySelector('canvas')
    const request = canvas?.requestPointerLock() as unknown as Promise<void> | undefined
    if (request && typeof request.then === 'function') {
        request.then(
            () => { relockPending.value = false },
            () => { relockPending.value = false }
        )
    } else {
        window.setTimeout(() => { relockPending.value = false }, 400)
    }
}

function buyEquipment(id: CallOfXenoEquipmentId) {
    if (equipmentStock.value.length >= runEffects.equipmentSlots) return
    const equipment = CALL_OF_XENO_EQUIPMENT[id]
    if (!spend(equipment.cost)) return
    equipmentStock.value = [...equipmentStock.value, id]
    audio.play('buy')
}

/** Spends one carried unit and drops it into the world. */
function deployEquipment() {
    const id = equipmentStock.value[0]
    if (!id) return
    equipmentStock.value = equipmentStock.value.slice(1)
    const equipment = CALL_OF_XENO_EQUIPMENT[id]

    if (id === 'drone') {
        const model = buildCompanionDrone()
        model.group.position.set(px, feetY + 2, pz)
        scene.add(model.group)
        escorts.push({
            model,
            x: px,
            y: feetY + 2,
            z: pz,
            yaw: 0,
            life: equipment.duration,
            fireTimer: 0.6,
            bob: randomFloat() * Math.PI * 2,
            scored: new Set()
        })
    } else {
        // Ground placement a couple of metres ahead, clamped against walls.
        const forwardX = -Math.sin(yaw)
        const forwardZ = -Math.cos(yaw)
        const block = rayBlockDistance(px, feetY + 1.2, pz, forwardX, 0, forwardZ, solids, 3.2)
        const dist = Math.max(1, Math.min(2.4, block.distance - 0.6))
        const x = px + forwardX * dist
        const z = pz + forwardZ * dist
        const ground = groundHeight(x, z, feetY)
        if (id === 'sentry') {
            const model = buildSentry()
            model.group.position.set(x, ground, z)
            scene.add(model.group)
            sentries.push({ model, x, y: ground, z, life: equipment.duration, fireTimer: 0.8, scored: new Set() })
        } else {
            const model = buildBlackHole()
            const y = Math.max(ground + 1.4, feetY + 1.2)
            model.group.position.set(x, y, z)
            scene.add(model.group)
            blackHoles.push({ model, x, y, z, life: equipment.duration, tick: 0, spin: 0, burstTimer: 0, scored: new Set() })
            audio.play('power')
            shake = Math.min(0.3, shake + 0.15)
        }
    }
    audio.play('papunch')
    spawnPopup(px, feetY + 1.2, pz, equipment.name, perkCss(equipment.color), 17)
}

/** Nearest enemy a unit at (x, y, z) could reasonably shoot at. */
function nearestEnemyInRange(x: number, y: number, z: number, range: number): Enemy | null {
    let best: Enemy | null = null
    let bestDist = range
    for (const enemy of enemies) {
        if (enemy.stage !== 'inside') continue
        const dist = Math.hypot(enemy.x - x, enemy.z - z)
        if (dist >= bestDist) continue
        if (Math.abs(enemy.y - y) > 5) continue
        bestDist = dist
        best = enemy
    }
    return best
}

/** True when nothing solid stands between the unit's muzzle and the target. */
function hasLineOfFire(ox: number, oy: number, oz: number, target: Enemy): boolean {
    const tx = target.x
    const ty = target.y + target.model.torsoY
    const tz = target.z
    const dx = tx - ox
    const dy = ty - oy
    const dz = tz - oz
    const len = Math.hypot(dx, dy, dz) || 1
    return rayBlockDistance(ox, oy, oz, dx / len, dy / len, dz / len, solids, len).distance >= len - 0.3
}

const equipMuzzle = new THREE.Vector3()

/**
 * One unit's shot: a fraction of the target's max health, so the equipment
 * reads as strong on round 5 and on round 50 alike. Kills and hit points
 * still pay the player through applyHit.
 */
function fireEquipmentAt(target: Enemy, equipment: CallOfXenoEquipment, ox: number, oy: number, oz: number, scored: Set<Enemy>, color: number) {
    const damage = target.maxHealth * equipmentDamage(equipment, target.def.id)
    impactPoint.set(target.x, target.y + target.model.torsoY, target.z)
    equipMuzzle.set(ox, oy, oz)
    effects.tracer(equipMuzzle, impactPoint, color, 0.016, 0.05)
    applyHit(target, damage, 'body', scored, impactPoint)
}

function lerpAngle(from: number, to: number, t: number): number {
    let delta = (to - from) % (Math.PI * 2)
    if (delta > Math.PI) delta -= Math.PI * 2
    if (delta < -Math.PI) delta += Math.PI * 2
    return from + delta * t
}

/** A rare kill leaves a random workbench unit lying on the floor. */
function dropEquipment(x: number, z: number, y: number) {
    const ids = Object.keys(CALL_OF_XENO_EQUIPMENT) as CallOfXenoEquipmentId[]
    const id = ids[Math.floor(randomFloat() * ids.length)]!
    const spec = CALL_OF_XENO_EQUIPMENT[id]
    const model = buildEquipmentDrop(spec)
    model.group.position.set(x, y + 0.5, z)
    scene.add(model.group)
    groundEquipment.push({
        id,
        group: model.group,
        light: model.light,
        x,
        y: y + 0.5,
        z,
        life: CALL_OF_XENO_EQUIPMENT_DROP_LIFETIME,
        spin: 0
    })
}

/** Floor drops: spin, blink out, and are pocketed on touch — stock permitting. */
function updateGroundEquipment(dt: number) {
    for (let i = groundEquipment.length - 1; i >= 0; i--) {
        const entry = groundEquipment[i]!
        entry.life -= dt
        entry.spin += dt * 2
        entry.group.rotation.set(0, entry.spin, Math.sin(entry.spin * 0.8) * 0.12)
        entry.group.position.y = entry.y + Math.sin(entry.spin * 1.6) * 0.1
        entry.light.intensity = 2.5 + Math.sin(entry.spin * 4) * 1.2
        entry.group.visible = entry.life > 4 || Math.sin(entry.life * 14) > -0.2

        const inReach = Math.hypot(entry.x - px, entry.z - pz) < 2.2 && Math.abs(entry.y - feetY) < 3
        if (inReach && equipmentStock.value.length < runEffects.equipmentSlots) {
            equipmentStock.value = [...equipmentStock.value, entry.id]
            const spec = CALL_OF_XENO_EQUIPMENT[entry.id]
            spawnPopup(px, feetY + 1.1, pz, spec.name, perkCss(spec.color), 17)
            audio.play('buy')
            scene.remove(entry.group)
            disposeObject(entry.group)
            groundEquipment.splice(i, 1)
            continue
        }
        // Hands full: the crate stays where it is until there is room.

        if (entry.life <= 0) {
            scene.remove(entry.group)
            disposeObject(entry.group)
            groundEquipment.splice(i, 1)
        }
    }
}

function updateEquipment(dt: number) {
    const sentrySpec = CALL_OF_XENO_EQUIPMENT.sentry
    for (let i = sentries.length - 1; i >= 0; i--) {
        const unit = sentries[i]!
        unit.life -= dt
        if (unit.life <= 0) {
            scene.remove(unit.model.group)
            disposeObject(unit.model.group)
            sentries.splice(i, 1)
            continue
        }
        unit.fireTimer -= dt
        const target = nearestEnemyInRange(unit.x, unit.y, unit.z, sentrySpec.range)
        if (!target) continue
        // The model's barrel points down local -Z, so the head yaw is the
        // look direction mirrored.
        const want = Math.atan2(-(target.x - unit.x), -(target.z - unit.z))
        unit.model.head.rotation.y = lerpAngle(unit.model.head.rotation.y, want, Math.min(1, dt * 10))
        if (unit.fireTimer <= 0 && hasLineOfFire(unit.x, unit.y + 1.1, unit.z, target)) {
            unit.fireTimer = sentrySpec.fireDelay
            fireEquipmentAt(target, sentrySpec, unit.x, unit.y + 1.1, unit.z, unit.scored, 0xffd27a)
            audio.play('shoot-smg')
        }
    }

    const escortSpec = CALL_OF_XENO_EQUIPMENT.drone
    for (let i = escorts.length - 1; i >= 0; i--) {
        const unit = escorts[i]!
        unit.life -= dt
        if (unit.life <= 0) {
            scene.remove(unit.model.group)
            disposeObject(unit.model.group)
            escorts.splice(i, 1)
            continue
        }
        unit.bob += dt
        unit.model.rotor.rotation.y += dt * 16

        // Anchor: a pace behind the player's right shoulder.
        const forwardX = -Math.sin(yaw)
        const forwardZ = -Math.cos(yaw)
        const rightX = Math.cos(yaw)
        const rightZ = -Math.sin(yaw)
        const wantX = px - forwardX * 1.2 + rightX * 0.95
        const wantZ = pz - forwardZ * 1.2 + rightZ * 0.95
        const wantY = feetY + 2 + Math.sin(unit.bob * 1.8) * 0.12
        const follow = Math.min(1, dt * 3.5)
        unit.x += (wantX - unit.x) * follow
        unit.y += (wantY - unit.y) * follow
        unit.z += (wantZ - unit.z) * follow
        unit.model.group.position.set(unit.x, unit.y, unit.z)

        unit.fireTimer -= dt
        const target = nearestEnemyInRange(unit.x, unit.y, unit.z, escortSpec.range)
        if (!target) continue
        const face = Math.atan2(target.x - unit.x, target.z - unit.z)
        unit.yaw = lerpAngle(unit.yaw, face, Math.min(1, dt * 8))
        unit.model.group.rotation.y = unit.yaw
        unit.model.group.rotation.z = Math.sin(unit.bob * 0.9) * 0.08
        if (unit.fireTimer <= 0 && hasLineOfFire(unit.x, unit.y - 0.1, unit.z, target)) {
            unit.fireTimer = escortSpec.fireDelay
            fireEquipmentAt(target, escortSpec, unit.x, unit.y - 0.1, unit.z, unit.scored, 0x7dd3fc)
            audio.play('shoot-pistol')
        }
    }

    const holeSpec = CALL_OF_XENO_EQUIPMENT.blackhole
    for (let i = blackHoles.length - 1; i >= 0; i--) {
        const unit = blackHoles[i]!
        unit.life -= dt
        unit.spin += dt
        unit.model.ring.rotation.z += dt * 2.6
        unit.model.core.scale.setScalar(1 + Math.sin(unit.spin * 7) * 0.08)
        unit.model.light.intensity = 4.5 + Math.sin(unit.spin * 6) * 1.5
        unit.burstTimer -= dt
        if (unit.burstTimer <= 0) {
            unit.burstTimer = 0.35
            impactPoint.set(unit.x, unit.y, unit.z)
            effects.energyBurst(impactPoint, 0xa855f7)
        }

        if (unit.life <= 0) {
            impactPoint.set(unit.x, unit.y, unit.z)
            effects.energyBurst(impactPoint, 0xc084fc)
            audio.play('explosion')
            scene.remove(unit.model.group)
            disposeObject(unit.model.group)
            blackHoles.splice(i, 1)
            continue
        }

        // The pull: everything inside the radius is dragged toward the core,
        // harder the closer it already is. Only enemies that have made it
        // inside are on the graph — the ones still outside a window are on
        // their scripted approach and stay on it.
        for (const enemy of enemies) {
            if (enemy.stage !== 'inside') continue
            const dx = unit.x - enemy.x
            const dz = unit.z - enemy.z
            const dist = Math.hypot(dx, dz)
            if (dist > CALL_OF_XENO_BLACKHOLE_RADIUS || dist < 1.3) continue
            const strength = 3 + 9 * (1 - dist / CALL_OF_XENO_BLACKHOLE_RADIUS)
            enemy.x += (dx / dist) * strength * dt
            enemy.z += (dz / dist) * strength * dt
            enemy.yaw = Math.atan2(dx, dz)
        }

        // Damage ticks on the same rhythm the pull drags on.
        unit.tick -= dt
        if (unit.tick <= 0) {
            unit.tick = CALL_OF_XENO_BLACKHOLE_TICK
            for (const enemy of [...enemies]) {
                if (enemy.stage !== 'inside') continue
                if (Math.hypot(enemy.x - unit.x, enemy.z - unit.z) > CALL_OF_XENO_BLACKHOLE_RADIUS) continue
                const damage = enemy.maxHealth * equipmentDamage(holeSpec, enemy.def.id) * CALL_OF_XENO_BLACKHOLE_TICK
                impactPoint.set(enemy.x, enemy.y + enemy.model.torsoY, enemy.z)
                applyHit(enemy, damage, 'body', unit.scored, impactPoint)
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function pickEnemyType(): CallOfXenoEnemyId {
    if (isSpecialRound(currentRound)) return specialRoundEnemy(currentRound)
    const composition = roundComposition(currentRound)
    return randomWeighted(composition, entry => entry.weight, randomFloat).enemy
}

/** Hands each enemy its queue order at a window. Reset with the run. */
let enemySeq = 0

/** Puts one enemy outside a live window. False when there is nowhere to put it. */
function spawnEnemy(): boolean {
    // Only windows in rooms the player can actually be reached from are live,
    // so nothing queues up outside a wing that is still sealed off.
    const open = reachableWindows(navTable, nearestNode(px, pz, feetY, bannedNodes))
    if (open.length === 0) return false

    // Prefer a window that is not the one the player is stood at, so a round
    // does not funnel entirely into whichever barricade they are watching.
    const far = open.filter(w => Math.hypot(w.inside.x - px, w.inside.z - pz) > 9)
    const pool = far.length > 0 ? far : open
    const window = pool[Math.floor(randomFloat() * pool.length)]!

    const def = CALL_OF_XENO_ENEMIES[pickEnemyType()]
    const model = buildEnemy(def)

    // Start well back from the window and walk in, spread sideways so a pack
    // arrives as a crowd rather than a single file.
    const spread = (randomFloat() - 0.5) * 5
    const back = 4 + randomFloat() * 7
    const along = window.axis === 'x'
    const x = window.outside.x + (along ? spread : window.outward * back)
    const z = window.outside.z + (along ? window.outward * back : spread)

    model.group.position.set(x, 0, z)
    model.group.scale.setScalar(def.scale)
    scene.add(model.group)

    const health = Math.round(zombieHealth(currentRound) * def.healthMultiplier * runDifficulty.healthMult)
    const frenzy = modifier === 'frenzy' ? CALL_OF_XENO_FRENZY_SPEED : 1

    enemies.push({
        def,
        model,
        stage: 'outside',
        window,
        seq: enemySeq++,
        slot: 0,
        posted: false,
        tearTimer: CALL_OF_XENO_TEAR_TIME,
        climb: 0,
        x,
        y: 0,
        z,
        vy: 0,
        yaw: 0,
        health,
        maxHealth: health,
        speed: zombieSpeed(currentRound) * def.speedMultiplier * frenzy * runDifficulty.speedMult * (0.88 + randomFloat() * 0.24),
        attackCooldown: 0,
        fireCooldown: 1 + randomFloat() * 2,
        flash: 0,
        phase: randomFloat() * Math.PI * 2,
        groanIn: 1 + randomFloat() * 6,
        stagger: 0,
        stuck: 0,
        stuckSide: randomFloat() < 0.5 ? 1 : -1,
        path: [],
        repathIn: 0
    })
    return true
}

/** Redraws a window's boards to match how many are left on it. */
function syncWindow(state: WindowState) {
    const model = level.windows.get(state.def.id)
    if (!model) return
    model.boards.forEach((board, i) => { board.visible = i < state.boards })
}

/**
 * Runs an enemy that is still outside: walk up to the window, prise the boards
 * off one at a time, then climb through. Returns true once it is inside and the
 * normal ground behaviour should take over.
 */
function updateBreaching(enemy: Enemy, dt: number): boolean {
    const window = enemy.window!
    const state = windowStates.get(window.id)!

    if (enemy.stage === 'breaching') {
        // The climb is a scripted lerp — nothing may push it off its line.
        enemy.posted = true
        enemy.climb += dt / CALL_OF_XENO_CLIMB_TIME
        const t = Math.min(1, enemy.climb)
        enemy.x = window.outside.x + (window.inside.x - window.outside.x) * t
        enemy.z = window.outside.z + (window.inside.z - window.outside.z) * t
        // Lift over the sill and back down, so it reads as a vault.
        enemy.y = Math.sin(t * Math.PI) * (CALL_OF_XENO_WINDOW_SILL * 0.8)
        enemy.yaw = window.facing + Math.PI
        if (t >= 1) {
            enemy.stage = 'inside'
            enemy.window = null
            enemy.posted = false
            enemy.y = 0
            return true
        }
        return false
    }

    // Each body walks to its own place in the window's queue rather than
    // every one of them steering at the same point. Rank 0's slot *is* the
    // old approach point, so the breach itself is unchanged.
    const target = windowApproachSlot(window, enemy.slot)
    const dx = target.x - enemy.x
    const dz = target.z - enemy.z
    const dist = Math.hypot(dx, dz)
    enemy.y = 0
    enemy.posted = dist <= CALL_OF_XENO_WINDOW_SLOT_RADIUS

    if (!enemy.posted) {
        enemy.x += (dx / dist) * enemy.speed * dt
        enemy.z += (dz / dist) * enemy.speed * dt
        enemy.yaw = Math.atan2(dx / dist, dz / dist)
        return false
    }

    enemy.yaw = window.facing + Math.PI
    // Only the front of the queue works the boards. The rest wait their turn
    // — a slot opens the instant the one ahead starts climbing through.
    if (enemy.slot > 0) return false
    if (state.boards <= 0) {
        enemy.stage = 'breaching'
        enemy.climb = 0
        audio.play('climb-in')
        return false
    }

    enemy.tearTimer -= dt
    if (enemy.tearTimer > 0) return false
    enemy.tearTimer = CALL_OF_XENO_TEAR_TIME
    state.boards--
    state.repair = 0
    syncWindow(state)
    if (Math.hypot(window.centre.x - px, window.centre.z - pz) < 34) audio.play('board-break')
    impactPoint.set(window.centre.x, CALL_OF_XENO_WINDOW_SILL + 0.6, window.centre.z)
    effects.wallImpact(impactPoint, new THREE.Vector3(
        Math.sin(window.facing),
        0,
        Math.cos(window.facing)
    ))
    return false
}

/** Nails one board back on, if the player is stood at a damaged window. */
function updateRepair(dt: number) {
    if (!focusedWindow) return
    const state = windowStates.get(focusedWindow.id)!
    if (state.boards >= CALL_OF_XENO_WINDOW_BOARDS) return
    if (!keys.has('keyf')) { state.repair = 0; return }

    state.repair += dt
    if (state.repair < CALL_OF_XENO_REPAIR_TIME) return
    state.repair = 0
    state.boards++
    statBoards++
    syncWindow(state)
    // A flat rate: repairing is a steady trickle, never worth farming.
    score += CALL_OF_XENO_REPAIR_POINTS
    grossEarned.value += CALL_OF_XENO_REPAIR_POINTS
    spawnPopup(
        focusedWindow.centre.x,
        CALL_OF_XENO_WINDOW_HEAD,
        focusedWindow.centre.z,
        `+${CALL_OF_XENO_REPAIR_POINTS}`,
        '#fcd34d',
        18
    )
    audio.play('board-repair')
}

function killEnemy(enemy: Enemy) {
    const index = enemies.indexOf(enemy)
    if (index === -1) return
    enemies.splice(index, 1)

    impactPoint.set(enemy.x, enemy.y, enemy.z)
    effects.deathBurst(impactPoint)

    flashEnemy(enemy.model, false)
    enemy.model.skin.transparent = true
    enemy.model.clothes.transparent = true
    corpses.push({ model: enemy.model, life: 2.4, fall: 0, spin: (randomFloat() - 0.5) * 1.4 })
}

function fireEnemyBolt(enemy: Enemy) {
    const ranged = enemy.def.ranged!
    const originY = enemy.y + enemy.model.torsoY
    const targetY = feetY + PLAYER_EYE - 0.2
    const dx = px - enemy.x
    const dy = targetY - originY
    const dz = pz - enemy.z
    const len = Math.hypot(dx, dy, dz) || 1

    const mesh = buildProjectile(enemy.def.color)
    mesh.position.set(enemy.x, originY, enemy.z)
    scene.add(mesh)
    projectiles.push({
        mesh,
        x: enemy.x,
        y: originY,
        z: enemy.z,
        vx: (dx / len) * ranged.projectileSpeed,
        vy: (dy / len) * ranged.projectileSpeed,
        vz: (dz / len) * ranged.projectileSpeed,
        damage: ranged.damage,
        life: 4
    })
    audio.play('zombie-attack')
}

function updateProjectiles(dt: number) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const bolt = projectiles[i]!
        bolt.life -= dt

        const step = Math.hypot(bolt.vx, bolt.vy, bolt.vz) * dt
        const block = rayBlockDistance(bolt.x, bolt.y, bolt.z, bolt.vx / (step / dt), bolt.vy / (step / dt), bolt.vz / (step / dt), solids, step)

        bolt.x += bolt.vx * dt
        bolt.y += bolt.vy * dt
        bolt.z += bolt.vz * dt
        bolt.mesh.position.set(bolt.x, bolt.y, bolt.z)

        const hitPlayer = Math.hypot(bolt.x - px, bolt.z - pz) < 0.7
            && bolt.y > feetY && bolt.y < feetY + PLAYER_HEIGHT

        if (hitPlayer) {
            takeDamage(bolt.damage, bolt.x - bolt.vx * 0.06, bolt.z - bolt.vz * 0.06)
            impactPoint.set(bolt.x, bolt.y, bolt.z)
            effects.energyBurst(impactPoint, 0x66ddff)
        }

        if (hitPlayer || block.distance < step || bolt.life <= 0) {
            if (!hitPlayer && block.distance < step) {
                impactPoint.set(bolt.x, bolt.y, bolt.z)
                effects.energyBurst(impactPoint, 0x66ddff)
            }
            scene.remove(bolt.mesh)
            disposeObject(bolt.mesh)
            projectiles.splice(i, 1)
        }
    }
}

function takeDamage(amount: number, sourceX?: number, sourceZ?: number) {
    // Feedback still fires in god mode — only the lethal part is held off.
    hp = DEBUG_GOD_MODE ? Math.max(1, hp - amount) : hp - amount
    sinceDamage = 0
    shake = Math.min(0.24, shake + 0.14)
    damageFlash.value = 1
    recoilPitch += 0.02 + Math.random() * 0.02
    if (sourceX !== undefined && sourceZ !== undefined) {
        hurtSources.push({ id: hurtMarkId++, dx: sourceX - px, dz: sourceZ - pz, life: 1.6 })
    }
    audio.play('hurt')
}

/** Limb swing, hover bob and the model transform. Shared by every stage. */
function animateEnemy(enemy: Enemy, dt: number, moved = 0) {
    const def = enemy.def
    enemy.phase += dt * (2.2 + moved * 0.8)

    if (enemy.model.rotor) {
        enemy.model.rotor.rotation.y += dt * 14
        enemy.model.group.rotation.z = Math.sin(enemy.phase * 0.7) * 0.12
    } else {
        // Tearing at a barricade drives the arms instead of the legs.
        const clawing = enemy.stage === 'outside' && moved === 0
        const swing = clawing ? 0 : Math.sin(enemy.phase) * 0.55
        enemy.model.legL!.rotation.x = swing
        enemy.model.legR!.rotation.x = -swing
        const reach = clawing ? -1.5 + Math.sin(enemy.phase * 2.4) * 0.45 : -0.55
        enemy.model.armL!.rotation.x = reach + Math.sin(enemy.phase + 1.6) * 0.16
        enemy.model.armR!.rotation.x = reach - Math.sin(enemy.phase + 1.6) * 0.16
        enemy.model.head!.rotation.z = Math.sin(enemy.phase * 0.5) * 0.12
        enemy.model.group.rotation.z = Math.sin(enemy.phase) * 0.05
    }

    enemy.model.group.position.set(
        enemy.x,
        enemy.y + (def.flies ? Math.sin(enemy.phase * 1.4) * 0.08 : Math.abs(Math.sin(enemy.phase)) * 0.045),
        enemy.z
    )
    enemy.model.group.rotation.y = enemy.yaw
}

function updateEnemies(dt: number) {
    const contact = zombieDamage(currentRound)
    assignWindowQueues()

    for (const enemy of enemies) {
        const def = enemy.def
        const toPlayerX = px - enemy.x
        const toPlayerZ = pz - enemy.z
        const toPlayer = Math.hypot(toPlayerX, toPlayerZ)

        // Outside the shell there is no navigation and no collision: the only
        // way in is the window it picked, and the climb is scripted.
        if (enemy.stage !== 'inside') {
            // Posted bodies stand still and work; the rest are still walking.
            animateEnemy(enemy, dt, enemy.posted ? 0 : enemy.speed)
            if (!updateBreaching(enemy, dt)) continue
        }

        const radius = 0.45 * def.scale

        // Drones size up their firing line before deciding how to move, so
        // the standoff dance and the trigger share one answer.
        let clearShot = true
        if (def.ranged) {
            const eyeY = enemy.y + enemy.model.torsoY
            const dy = feetY + PLAYER_EYE - 0.2 - eyeY
            const len = Math.hypot(toPlayerX, dy, toPlayerZ) || 1
            clearShot = rayBlockDistance(
                enemy.x, eyeY, enemy.z,
                toPlayerX / len, dy / len, toPlayerZ / len,
                solids, len
            ).distance >= len - 0.2
        }

        // Routes are replanned on a stagger, so a horde does not all think at
        // once, and redone the moment a body stops making progress.
        enemy.repathIn -= dt
        if (enemy.repathIn <= 0) {
            enemy.repathIn = 0.35 + randomFloat() * 0.35
            enemy.path = findNavPath(navGrid, enemy.x, enemy.z, enemy.y, px, pz, feetY, radius) ?? []
        }
        // Waypoints are retired at arm's length, which on a flight of stairs
        // is half a metre short of standing on it — see waypointFootingOk.
        while (enemy.path.length > 0
            && Math.hypot(enemy.path[0]!.x - enemy.x, enemy.path[0]!.z - enemy.z) < 0.5
            && waypointFootingOk(enemy.x, enemy.z, enemy.y, enemy.path[0]!.x, enemy.path[0]!.z)) {
            enemy.path.shift()
        }

        let dx: number
        let dz: number
        if (def.ranged && toPlayer < def.ranged.standoff + 5 && clearShot) {
            // A good shot line within the standoff band: hold the range
            // instead of closing to contact.
            const want = def.ranged.standoff
            const sign = toPlayer > want ? 1 : toPlayer < want * 0.72 ? -1 : 0
            dx = (toPlayerX / (toPlayer || 1)) * sign
            dz = (toPlayerZ / (toPlayer || 1)) * sign
        } else if (toPlayer < 6
            && navLevelOf(enemy.y) === navLevelOf(feetY)
            && navLineClear(navGrid, navLevelOf(feetY), enemy.x, enemy.z, px, pz, radius)) {
            // Same room, clear run: finish the hunt in a straight line.
            dx = toPlayerX
            dz = toPlayerZ
        } else if (enemy.path.length > 0) {
            dx = enemy.path[0]!.x - enemy.x
            dz = enemy.path[0]!.z - enemy.z
        } else {
            // No route the grid can see — sealed wing or a goal no body fits.
            // Press straight at the player and let the slide handle geometry.
            dx = toPlayerX
            dz = toPlayerZ
        }

        const dist = Math.hypot(dx, dz)
        let moved = 0
        const stopAt = def.ranged ? 0 : 1.05 * def.scale
        // Pulling up at contact range only makes sense against a player the
        // body can actually reach. The distance is flat, so a player on the
        // deck overhead used to stop the pack underneath it dead: close in
        // plan, four metres up, too far to swing at and too settled to walk
        // to the stairs. Out of reach vertically, keep walking.
        const withinReach = Math.abs(enemy.y - feetY) < 1.6
        const wantsMove = dist > 0.05
            && (def.ranged || !withinReach || toPlayer > stopAt)
            && enemy.stagger <= 0

        const beforeX = enemy.x
        const beforeZ = enemy.z

        if (wantsMove) {
            let mx = dx / dist
            let mz = dz / dist
            // Pinned against geometry: trade forward for sideways for a beat
            // so a pack slides along walls instead of grinding into them.
            if (enemy.stuck > 0.25) {
                const sx = mz * enemy.stuckSide
                const sz = -mx * enemy.stuckSide
                mx = sx
                mz = sz
            }
            enemy.x += mx * enemy.speed * dt
            enemy.z += mz * enemy.speed * dt
            enemy.yaw = Math.atan2(mx, mz)
            moved = enemy.speed
        } else {
            enemy.stuck = 0
        }

        if (enemy.stagger > 0) enemy.stagger -= dt

        const boxes = solidsInBand(solids, enemy.y, 1.8 * def.scale)
        const solved = resolveCircle(enemy.x, enemy.z, 0.45 * def.scale, boxes)
        enemy.x = solved.x
        enemy.z = solved.z

        // Progress is what survived the collision resolve, not what the body
        // asked for. Measured before it, this compared the step against
        // itself and always matched, so the counter never rose and the
        // wall-slide above never once engaged — a body pinned on geometry had
        // no way out of it at all.
        if (wantsMove) {
            const actual = Math.hypot(enemy.x - beforeX, enemy.z - beforeZ)
            if (actual < enemy.speed * dt * 0.3) {
                enemy.stuck += dt
                if (enemy.stuck > 0.7) {
                    enemy.stuckSide *= -1
                    enemy.stuck = 0.3
                }
                // The route is stale or too tight for this body — rethink now.
                enemy.repathIn = 0
            } else {
                enemy.stuck = 0
            }
        }

        // Vertical: walkers fall and step, drones hover above whatever is below.
        const ground = groundHeight(enemy.x, enemy.z, enemy.y)
        if (def.flies) {
            const want = ground + 1.1
            enemy.y += (want - enemy.y) * Math.min(1, dt * 3)
        } else if (enemy.vy <= 0 && enemy.y - ground < CALL_OF_XENO_STEP_UP) {
            enemy.y = ground
            enemy.vy = 0
        } else {
            enemy.vy -= GRAVITY * dt
            enemy.y += enemy.vy * dt
            if (enemy.vy <= 0 && enemy.y <= ground) {
                enemy.y = ground
                enemy.vy = 0
            }
        }

        enemy.attackCooldown -= dt
        enemy.fireCooldown -= dt

        if (def.ranged) {
            if (enemy.fireCooldown <= 0 && toPlayer < def.ranged.range && clearShot) {
                enemy.fireCooldown = def.ranged.cooldown * (0.85 + randomFloat() * 0.3)
                fireEnemyBolt(enemy)
            }
        } else if (toPlayer < 1.5 * def.scale && Math.abs(enemy.y - feetY) < 1.6 && enemy.attackCooldown <= 0 && reviveGrace <= 0) {
            enemy.attackCooldown = 1
            takeDamage(Math.round(contact * def.damageMultiplier * runDifficulty.damageMult), enemy.x, enemy.z)
            audio.play('zombie-attack')
        }

        enemy.groanIn -= dt
        if (enemy.groanIn <= 0) {
            enemy.groanIn = 4 + randomFloat() * 8
            if (toPlayer < 22) audio.play('zombie-groan')
        }

        if (enemy.flash > 0) {
            enemy.flash -= dt
            flashEnemy(enemy.model, enemy.flash > 0)
        }

        animateEnemy(enemy, dt, moved)
    }

    // Soft separation so a pack does not fuse into one body.
    for (let i = 0; i < enemies.length; i++) {
        for (let j = i + 1; j < enemies.length; j++) {
            const a = enemies[i]!
            const b = enemies[j]!
            if (Math.abs(a.y - b.y) > 1.5) continue
            const dx = b.x - a.x
            const dz = b.z - a.z
            const d = Math.hypot(dx, dz)
            const want = 0.9 * Math.max(a.def.scale, b.def.scale)
            if (d > want || d < 1e-4) continue
            // A body posted at its window slot (or mid-climb) is anchored:
            // it still shoves others aside, but nothing may shove it back.
            // Displacing it is what used to break a barricade open — pushed
            // off the slot, it stopped tearing and walked in again, forever.
            const push = (want - d) / 2
            const aAnchored = a.stage !== 'inside' && a.posted
            const bAnchored = b.stage !== 'inside' && b.posted
            if (aAnchored && bAnchored) continue
            if (!aAnchored) {
                a.x -= (dx / d) * (bAnchored ? push * 2 : push)
                a.z -= (dz / d) * (bAnchored ? push * 2 : push)
            }
            if (!bAnchored) {
                b.x += (dx / d) * (aAnchored ? push * 2 : push)
                b.z += (dz / d) * (aAnchored ? push * 2 : push)
            }
        }
    }

    // The flights have no side walls, so a climber caught in the middle of a
    // pack gets shoved clean off the steps, drops to the floor and has to
    // walk all the way back round — which reads as a zombie circling the foot
    // of the stairs, never managing to go up. Put it back on the flight it is
    // climbing. Only sideways: the ends stay open so bodies still step on at
    // the bottom and off onto the deck at the top.
    for (const enemy of enemies) {
        if (enemy.stage !== 'inside' || enemy.y <= CALL_OF_XENO_STEP_UP) continue
        const ramp = rampUnderBody(enemy.x, enemy.z, enemy.y)
        if (!ramp) continue
        const radius = 0.45 * enemy.def.scale
        if (ramp.axis === 'z') {
            enemy.x = Math.min(Math.max(enemy.x, ramp.box.minX + radius), ramp.box.maxX - radius)
        } else {
            enemy.z = Math.min(Math.max(enemy.z, ramp.box.minZ + radius), ramp.box.maxZ - radius)
        }
    }

    for (let i = corpses.length - 1; i >= 0; i--) {
        const corpse = corpses[i]!
        corpse.life -= dt
        corpse.fall = Math.min(1, corpse.fall + dt * 3.4)
        const eased = corpse.fall * corpse.fall * (3 - 2 * corpse.fall)
        corpse.model.group.rotation.x = eased * Math.PI * 0.5
        corpse.model.group.rotation.z += corpse.spin * dt * (1 - eased)
        const fade = Math.min(1, corpse.life / 0.9)
        corpse.model.skin.opacity = fade
        corpse.model.clothes.opacity = fade
        if (corpse.life <= 0) {
            scene.remove(corpse.model.group)
            disposeObject(corpse.model.group)
            corpses.splice(i, 1)
        }
    }
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

function applyModifier() {
    modifier = roundModifier(currentRound)
    modifierName.value = CALL_OF_XENO_MODIFIERS[modifier].name
    specialRound.value = isSpecialRound(currentRound)

    fog.near = modifier === 'fog' ? 3 : 12
    fog.far = modifier === 'fog' ? 16 : 46
    refreshLights()
}

/**
 * Blackout kills the lights for the round even when the power is on. Before
 * the power is thrown the building runs on whatever is still lit near the
 * spawn, so everything past the Barracks is a torch-less crawl.
 */
const LIT_WITHOUT_POWER = new Set([0, 1])

function refreshLights() {
    const dark = modifier === 'blackout'
    for (const entry of level.lights) {
        const emergency = !powered && !LIT_WITHOUT_POWER.has(entry.region)
        const base = emergency ? entry.lit * 0.22 : entry.lit
        entry.light.intensity = dark ? 1.5 : base
        ;(entry.tube.material as THREE.MeshBasicMaterial).opacity = dark ? 0.08 : emergency ? 0.3 : 1
    }
    for (const item of CALL_OF_XENO_INTERACTABLES) {
        const prop = level.props.get(item.id)
        if (!prop) continue
        const live = powered && !dark
        if (item.kind === 'perk' && item.perk) {
            for (const material of prop.glow) {
                material.color.setHex(CALL_OF_XENO_PERKS[item.perk].color)
                if (!live) material.color.multiplyScalar(0.14)
            }
            if (prop.light) prop.light.intensity = live ? 3 : 0
        } else if (item.kind === 'papunch') {
            for (const material of prop.glow) material.color.setHex(live ? 0xa855f7 : 0x2a0f3a)
            if (prop.light) prop.light.intensity = live ? 6 : 0
        } else if (item.kind === 'power') {
            for (const material of prop.glow) material.color.setHex(powered ? 0x33ff66 : 0x441111)
        }
    }
}

function startRound(next: number) {
    currentRound = next
    spawnQueue = Math.ceil(zombieCount(currentRound) * runDifficulty.countMult)
    spawnTimer = 0.4
    applyModifier()

    bannerTimer = 2.4
    bannerColor.value = specialRound.value ? '#e879f9' : '#dc2626'
    banner.value = specialRound.value
        ? `${CALL_OF_XENO_ENEMIES[specialRoundEnemy(currentRound)].name} Round`
        : `Round ${currentRound}`
    subBanner.value = modifier !== 'none'
        ? CALL_OF_XENO_MODIFIERS[modifier].description
        : `${spawnQueue} contacts`
    audio.play('round-start')
}

function updateRound(dt: number) {
    if (inBreak) {
        breakTimer -= dt
        if (breakTimer <= 0) {
            inBreak = false
            startRound(currentRound + 1)
        }
        return
    }

    if (spawnQueue > 0) {
        spawnTimer -= dt
        if (spawnTimer <= 0 && enemies.length < Math.round(maxAlive(currentRound) * runDifficulty.countMult)) {
            // Only bank the spawn if one actually went out — otherwise a round
            // with nowhere to spawn would drain its queue and end on the spot.
            if (spawnEnemy()) spawnQueue--
            spawnTimer = zombieSpawnInterval(currentRound)
        }
    } else if (enemies.length === 0) {
        inBreak = true
        breakTimer = CALL_OF_XENO_ROUND_BREAK
        // Round boundary — the one moment worth checkpointing.
        saveRun()
    }
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

function updatePrompt() {
    focused = null
    focusedWindow = null
    let text = ''
    let affordable = true
    let best = INTERACT_RANGE

    for (const state of windowStates.values()) {
        if (state.boards >= CALL_OF_XENO_WINDOW_BOARDS) continue
        if (Math.abs(feetY) > 2.5) continue
        const d = Math.hypot(state.def.centre.x - px, state.def.centre.z - pz)
        if (d > best) continue
        best = d
        focusedWindow = state.def
        text = `[F] Hold to Board Up — ${state.boards}/${CALL_OF_XENO_WINDOW_BOARDS}`
        affordable = true
    }

    for (const door of CALL_OF_XENO_DOORS) {
        if (openDoors.has(door.id)) continue
        const d = Math.hypot(door.prompt.x - px, door.prompt.z - pz)
        if (d > best) continue
        best = d
        focusedWindow = null
        focused = { kind: 'door', id: door.id }
        text = `[F] Open Door — ${price(door.cost)}`
        affordable = score >= price(door.cost)
    }

    for (const item of CALL_OF_XENO_INTERACTABLES) {
        const d = Math.hypot(item.x - px, item.z - pz)
        if (d > best || Math.abs(item.y - feetY) > 2.5) continue
        focusedWindow = null

        if (item.kind === 'power') {
            if (powered) continue
            best = d
            focused = { kind: 'interactable', id: item.id }
            text = '[F] Throw Power Switch'
            affordable = true
            continue
        }

        if (item.needsPower && !powered) {
            best = d
            focused = null
            text = 'Needs power'
            affordable = false
            continue
        }

        if (item.kind === 'workbench') {
            best = d
            focused = { kind: 'interactable', id: item.id }
            text = '[F] Workbench — Equipment'
            affordable = true
            continue
        }

        if (item.kind === 'mysterybox') {
            best = d
            focused = { kind: 'interactable', id: item.id }
            if (boxState === 'ready') {
                text = `[F] Take ${CALL_OF_XENO_WEAPONS[boxPrize!].name}`
                affordable = true
            } else if (boxState === 'spinning') {
                focused = null
                text = 'Spinning…'
                affordable = true
            } else {
                text = `[F] Mystery Box — ${price(CALL_OF_XENO_BOX_COST)}`
                affordable = score >= price(CALL_OF_XENO_BOX_COST)
            }
        } else if (item.kind === 'wallbuy') {
            const weapon = CALL_OF_XENO_WEAPONS[item.weapon!]
            const owned = slots.find(s => s.base === weapon.id)
            const cost = price(owned ? ammoCost(weapon) : weapon.cost)
            best = d
            if (owned && owned.reserve >= owned.def.reserveAmmo) {
                focused = null
                text = `${weapon.name} — ammo full`
                affordable = true
                continue
            }
            focused = { kind: 'interactable', id: item.id }
            text = owned ? `[F] ${weapon.name} Ammo — ${cost}` : `[F] Buy ${weapon.name} — ${cost}`
            affordable = score >= cost
        } else if (item.kind === 'perk') {
            const perk = CALL_OF_XENO_PERKS[item.perk!]
            best = d
            if (perks.has(perk.id)) {
                focused = null
                text = `${perk.name} — active`
                affordable = true
                continue
            }
            const soldOut = perk.id === 'quickrevive' && quickReviveBuys >= CALL_OF_XENO_QUICK_REVIVE_MAX_BUYS
            if (soldOut) {
                focused = null
                text = 'Quick Revive — sold out'
                affordable = false
                continue
            }
            focused = { kind: 'interactable', id: item.id }
            text = `[F] ${perk.name} — ${price(perkPrice(perk.id, perks.size, quickReviveBuys))}`
            affordable = score >= price(perkPrice(perk.id, perks.size, quickReviveBuys))
        } else if (item.kind === 'papunch') {
            best = d
            const raw = packAPunchCost(active().tier)
            const cost = raw === null ? null : price(raw)
            if (cost === null) {
                focused = null
                text = `${active().def.name} is fully upgraded`
                affordable = true
                continue
            }
            focused = { kind: 'interactable', id: item.id }
            text = `[F] Pack-a-Punch ${active().tier + 1}/3 — ${cost.toLocaleString()}`
            affordable = score >= cost
        }
    }

    prompt.value = text
    promptAffordable.value = affordable
}

function spend(cost: number) {
    if (score < cost) {
        audio.play('deny')
        return false
    }
    score -= cost
    spawnPopup(px, feetY + PLAYER_EYE + 0.4, pz, `-${cost}`, '#fca5a5', 18)
    return true
}

function interact() {
    // No focus means the nearest prompt is informational (ammo full, needs
    // power) — nothing to buy, so nothing to deny.
    if (!focused) return

    if (focused.kind === 'door') {
        const door = CALL_OF_XENO_DOORS.find(d => d.id === focused!.id)!
        if (!spend(price(door.cost))) return
        openDoors.add(door.id)
        statDoors++
        const group = level.doors.get(door.id)
        if (group) {
            scene.remove(group)
            disposeObject(group)
            level.doors.delete(door.id)
        }
        rebuildCollision()
        audio.play('door')
        return
    }

    const item = CALL_OF_XENO_INTERACTABLES.find(i => i.id === focused!.id)!
    if (item.needsPower && !powered) return

    if (item.kind === 'workbench') {
        openWorkbench()
        return
    }

    if (item.kind === 'power') {
        powered = true
        powerOn.value = true
        refreshLights()
        level.powerLever.handle.rotation.x = -0.9
        bannerTimer = 2.5
        bannerColor.value = '#facc15'
        banner.value = 'Power On'
        subBanner.value = 'Perks and Pack-a-Punch online'
        audio.play('power')
        return
    }

    if (item.kind === 'mysterybox') {
        if (boxState === 'ready') { takeBoxPrize(); return }
        if (boxState !== 'idle') return
        if (!spend(price(CALL_OF_XENO_BOX_COST))) return
        spinBox()
        return
    }

    if (item.kind === 'wallbuy') {
        const weapon = CALL_OF_XENO_WEAPONS[item.weapon!]
        const owned = slots.find(s => s.base === weapon.id)
        if (owned) {
            if (owned.reserve >= owned.def.reserveAmmo) return
            if (!spend(price(ammoCost(weapon)))) return
            owned.reserve = owned.def.reserveAmmo
            audio.play('buy')
            return
        }
        if (!spend(price(weapon.cost))) return
        giveWeapon(makeSlot(weapon.id))
        audio.play('buy')
        return
    }

    if (item.kind === 'perk') {
        const perk = CALL_OF_XENO_PERKS[item.perk!]
        if (perks.has(perk.id)) return
        if (perk.id === 'quickrevive' && quickReviveBuys >= CALL_OF_XENO_QUICK_REVIVE_MAX_BUYS) return
        if (!spend(price(perkPrice(perk.id, perks.size, quickReviveBuys)))) return
        perks.add(perk.id)
        if (perk.id === 'quickrevive') quickReviveBuys++
        if (perk.id === 'juggernog') {
            // Juggernog replaces the pool; Body Armor levels stack on top.
            hpMax = CALL_OF_XENO_JUGGERNOG_HEALTH + runEffects.maxHealth - CALL_OF_XENO_BASE_HEALTH
            hp = hpMax
        }
        ownedPerks.value = [...perks].map(id => CALL_OF_XENO_PERKS[id])
        bannerTimer = 1.8
        bannerColor.value = perkCss(perk.color)
        banner.value = perk.name
        subBanner.value = perk.description
        audio.play('perk')
        return
    }

    if (item.kind === 'papunch') {
        const slot = active()
        const raw = packAPunchCost(slot.tier)
        if (raw === null || !spend(price(raw))) return
        slots[activeSlot] = makeSlot(slot.base, slot.tier + 1)
        equipModel()
        bannerTimer = 2
        bannerColor.value = '#e879f9'
        banner.value = slots[activeSlot]!.def.name
        subBanner.value = `Tier ${slots[activeSlot]!.tier} of 3`
        audio.play('papunch')
    }
}

function swapWeapon() {
    if (slots.length < 2 || swapTimer > 0) return
    activeSlot = activeSlot === 0 ? 1 : 0
    reloadTimer = 0
    reloadTotal = 0
    equipModel()
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

const projected = new THREE.Vector3()

function updatePopups(dt: number) {
    if (worldPopups.length === 0) {
        if (popups.value.length > 0) popups.value = []
        return
    }
    const width = renderer!.domElement.clientWidth
    const height = renderer!.domElement.clientHeight
    const next: ScreenPopup[] = []

    for (let i = worldPopups.length - 1; i >= 0; i--) {
        const popup = worldPopups[i]!
        popup.life -= dt
        if (popup.life <= 0) {
            worldPopups.splice(i, 1)
            continue
        }
        popup.y += popup.vy * dt
        popup.vy -= dt * 0.9

        projected.set(popup.x, popup.y, popup.z).project(camera)
        if (projected.z > 1) continue
        const t = popup.life / popup.maxLife
        next.push({
            id: popup.id,
            left: (projected.x * 0.5 + 0.5) * width,
            top: (-projected.y * 0.5 + 0.5) * height,
            opacity: Math.min(1, t * 1.8),
            color: popup.color,
            size: popup.size * (0.75 + t * 0.25),
            text: popup.text
        })
    }
    popups.value = next
}

function syncHud(dt = 0.016) {
    const slot = active()
    health.value = Math.max(0, hp)
    maxHealth.value = hpMax
    points.value = score
    round.value = currentRound
    enemiesLeft.value = enemies.length + spawnQueue
    weaponName.value = slot.def.name
    papTier.value = slot.tier
    magAmmo.value = slot.mag
    reserveAmmo.value = slot.reserve
    magFraction.value = (slot.mag / slot.def.magSize) * 100
    reloading.value = reloadTimer > 0
    reloadFraction.value = reloadTotal > 0 ? (1 - reloadTimer / reloadTotal) * 100 : 0
    stowedName.value = slots.length > 1 ? slots[activeSlot === 0 ? 1 : 0]!.def.name : ''
    hitMarker.value = markerTimer
    hurtOpacity.value = Math.max(0, 1 - hp / (hpMax * 0.62))
    hurtVeil.value = Math.min(1, hurtOpacity.value + damageFlash.value * 0.85)
    // The crosshair shows the true cone: spread in radians projected to
    // screen pixels at the current FOV, plus a small fixed stem.
    if (slots.length > 0) {
        const spreadRad = spreadOf(active())
        const halfH = (renderer?.domElement.clientHeight ?? window.innerHeight) / 2
        const px = Math.tan(spreadRad) * halfH / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
        const target = 3 + Math.min(46, px)
        crossGap.value += (target - crossGap.value) * Math.min(1, dt * 14)
    }
    hurtMarks.value = hurtSources.map(source => ({
        id: source.id,
        angle: -((Math.atan2(source.dx, source.dz) - Math.PI - yaw) * 180) / Math.PI,
        life: source.life
    }))

    const live: { id: string, name: string, color: string, remaining: number }[] = []
    for (const [id, remaining] of Object.entries(powerUpTimers)) {
        if (remaining <= 0) continue
        const spec = CALL_OF_XENO_POWERUPS[id as CallOfXenoPowerUpId]
        live.push({ id, name: spec.name, color: perkCss(spec.color), remaining })
    }
    activePowerUps.value = live

    const units: { key: string, label: string, color: string, icon: string, remaining: number }[] = []
    const pushUnit = (id: CallOfXenoEquipmentId, key: string, remaining: number) => {
        const spec = CALL_OF_XENO_EQUIPMENT[id]
        units.push({ key, label: spec.name, color: perkCss(spec.color), icon: equipmentIcons[id], remaining })
    }
    sentries.forEach((unit, i) => pushUnit('sentry', `sentry-${i}`, unit.life))
    escorts.forEach((unit, i) => pushUnit('drone', `drone-${i}`, unit.life))
    blackHoles.forEach((unit, i) => pushUnit('blackhole', `hole-${i}`, unit.life))
    activeEquipment.value = units
}

function update(dt: number) {
    runTime += dt
    updatePlayer(dt)
    // The bench is not a tether: step away from it and it packs itself up.
    if (workbenchOpen.value && Math.hypot(px - workbenchAnchorX, pz - workbenchAnchorZ) > 4) closeWorkbench()
    updateViewModel(dt)
    updateEnemies(dt)
    updateEquipment(dt)
    updateProjectiles(dt)
    updatePlayerRounds(dt)
    updatePowerUps(dt)
    updateGroundEquipment(dt)
    updateBox(dt)
    updateRound(dt)
    updatePrompt()
    updateRepair(dt)
    updatePopups(dt)
    effects.update(dt)

    if (reloadTimer > 0) {
        reloadTimer -= dt
        if (reloadTimer <= 0) { reloadTimer = 0; finishReload() }
    }
    swapTimer = Math.max(0, swapTimer - dt)
    meleeTimer = Math.max(0, meleeTimer - dt)
    meleeCooldown = Math.max(0, meleeCooldown - dt)
    damageFlash.value = Math.max(0, damageFlash.value - dt * 1.8)
    for (let i = hurtSources.length - 1; i >= 0; i--) {
        hurtSources[i]!.life -= dt
        if (hurtSources[i]!.life <= 0) hurtSources.splice(i, 1)
    }

    // Zoom rides the same aimBlend the spread and the view model use, so
    // the sight, the cone and the FOV all settle together — an LMG raises
    // its zoom as slowly as it raises its gun.
    const hipFov = isSprinting && isMoving ? 85 : 80
    const targetFov = hipFov + (58 - hipFov) * aimBlend
    fovCurrent += (targetFov - fovCurrent) * Math.min(1, dt * 14)
    if (Math.abs(fovCurrent - camera.fov) > 0.01) {
        camera.fov = fovCurrent
        camera.updateProjectionMatrix()
    }

    if (hp > 0 && hp / hpMax < 0.34) {
        hbTimer -= dt
        if (hbTimer <= 0) {
            hbTimer = 1.05
            audio.play('heartbeat')
        }
    } else {
        hbTimer = 0.4
    }

    fireTimer -= dt
    if (firing && fireTimer <= 0 && reloadTimer <= 0 && swapTimer <= 0) {
        shoot()
        if (!active().def.automatic) firing = false
    }

    bloom = Math.max(0, bloom - dt * 1.6)
    markerTimer = Math.max(0, markerTimer - dt)
    reviveGrace = Math.max(0, reviveGrace - dt)

    const flicker = 0.88 + Math.sin(performance.now() * 0.004) * 0.06 + Math.random() * 0.06
    if (modifier !== 'blackout') {
        for (const entry of level.lights) {
            (entry.tube.material as THREE.MeshBasicMaterial).opacity = flicker
        }
    }

    if (bannerTimer > 0) {
        bannerTimer -= dt
        if (bannerTimer <= 0 && !inBreak) { banner.value = ''; subBanner.value = '' }
    } else if (inBreak) {
        bannerColor.value = '#94a3b8'
        banner.value = `Round ${currentRound + 1}`
        subBanner.value = `Incoming in ${Math.ceil(breakTimer)}`
    }

    if (hp <= 0) die()
}

/** Settles the armed run with the server and returns the payout, if any. */
/**
 * Pause-menu exit: settles the payout at the current round and returns to
 * the menu. Guests simply walk away.
 */
async function exitRun() {
    if (exiting.value) return
    exiting.value = true
    try {
        await settleRun()
        payoutResult.value = null
        await refreshMeta()
        phase.value = 'menu'
    } finally {
        exiting.value = false
    }
}

async function settleRun() {
    if (!serverRunActive) return null
    serverRunActive = false
    // Let the last round-boundary checkpoint land before the run is cleared
    // — a straggler save racing a fresh deploy would otherwise write itself
    // into the new run's slot (revision 0 matches a fresh arm).
    if (pendingSave) await pendingSave
    const gross = Math.round(grossEarned.value)
    try {
        const res = await $fetch<{ awarded: number, counted: number, capped: boolean }>('/api/call-of-xeno/finish-run', {
            method: 'POST',
            // runTime is actual played seconds (pauses do not accumulate),
            // so the leaderboard duration matches what the player played.
            body: { round: currentRound, grossPoints: gross, playedMs: Math.round(runTime * 1000) }
        })
        payoutResult.value = { awarded: res.awarded, counted: res.counted, capped: res.capped, gross }
        await fetchSession()
        void refreshMeta()
        return res
    } catch {
        // Network dropped between death and settle: the run stays armed
        // server-side and will be reclaimed as stale long before it can lock
        // the account. The player loses the payout, not the account.
        payoutResult.value = { awarded: 0, counted: 0, capped: false, gross }
        return null
    }
}

function die() {
    // Quick Revive catches the first fall — you get up empty-handed: every
    // perk is gone, including this one.
    if (perks.has('quickrevive')) {
    perks.clear()
    quickReviveBuys = 0
        ownedPerks.value = []
        hpMax = runEffects.maxHealth
        hp = hpMax
        sinceDamage = 99
        reviveGrace = 2.5
        bannerTimer = 2.2
        bannerColor.value = '#67e8f9'
        banner.value = 'Quick Revive'
        subBanner.value = 'Back on your feet — perks lost'
        audio.play('perk')
        damageFlash.value = 0
        return
    }
    phase.value = 'over'
    firing = false
    aiming = false
    workbenchOpen.value = false
    relockPending.value = false
    keys.clear()
    hurtSources.length = 0
    hurtMarks.value = []
    audio.play('death')
    if (document.pointerLockElement) document.exitPointerLock()

    const minutes = Math.floor(runTime / 60)
    const seconds = Math.floor(runTime % 60)
    summary.value = [
        { label: 'Points earned', value: Math.round(grossEarned.value).toLocaleString() },
        { label: 'Points banked', value: score.toLocaleString() },
        { label: 'Kills', value: String(statKills) },
        { label: 'Headshots', value: statKills > 0 ? `${Math.round((statHeadshots / statKills) * 100)}%` : '0%' },
        { label: 'Doors opened', value: `${statDoors} / ${CALL_OF_XENO_DOORS.length}` },
        { label: 'Boards nailed', value: String(statBoards) },
        { label: 'Box spins', value: String(statSpins) },
        { label: 'Barrels popped', value: String(statBarrels) },
        { label: 'Perks', value: `${perks.size} / 4` },
        { label: 'Survived', value: `${minutes}m ${seconds}s` }
    ]
    bestRound.value = Math.max(bestRound.value, currentRound)
    payoutResult.value = null
    void settleRun()
    syncHud()
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function disposeObject(root: THREE.Object3D) {
    root.traverse((object) => {
        const mesh = object as THREE.Mesh
        mesh.geometry?.dispose?.()
        const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
        for (const material of materials) {
            const map = (material as THREE.MeshBasicMaterial).map
            map?.dispose()
            material.dispose()
        }
    })
}

function resetRun() {
    for (const enemy of [...enemies]) {
        scene.remove(enemy.model.group)
        disposeObject(enemy.model.group)
    }
    enemies.length = 0
    windowQueues.clear()
    enemySeq = 0
    for (const corpse of corpses) {
        scene.remove(corpse.model.group)
        disposeObject(corpse.model.group)
    }
    corpses.length = 0
    for (const bolt of projectiles) {
        scene.remove(bolt.mesh)
        disposeObject(bolt.mesh)
    }
    projectiles.length = 0
    for (const round of playerRounds) {
        scene.remove(round.mesh)
        disposeObject(round.mesh)
    }
    playerRounds.length = 0
    for (const entry of groundPowerUps) {
        scene.remove(entry.group)
        disposeObject(entry.group)
    }
    groundPowerUps.length = 0
    for (const unit of sentries) {
        scene.remove(unit.model.group)
        disposeObject(unit.model.group)
    }
    sentries.length = 0
    for (const unit of escorts) {
        scene.remove(unit.model.group)
        disposeObject(unit.model.group)
    }
    escorts.length = 0
    for (const unit of blackHoles) {
        scene.remove(unit.model.group)
        disposeObject(unit.model.group)
    }
    blackHoles.length = 0
    for (const entry of groundEquipment) {
        scene.remove(entry.group)
        disposeObject(entry.group)
    }
    groundEquipment.length = 0
    equipmentStock.value = []
    activeEquipment.value = []
    workbenchOpen.value = false
    relockPending.value = false
    worldPopups.length = 0
    popups.value = []
    effects.clear()

    for (const barrel of barrels) {
        barrel.alive = true
        barrel.group.visible = true
    }

    for (const state of windowStates.values()) {
        state.boards = CALL_OF_XENO_WINDOW_BOARDS
        state.repair = 0
        syncWindow(state)
    }

    for (const door of CALL_OF_XENO_DOORS) {
        if (!level.doors.has(door.id)) scene.add(level.makeDoor(door.id))
    }
    openDoors.clear()
    perks.clear()
    ownedPerks.value = []
    powered = false
    powerOn.value = false
    level.powerLever.handle.rotation.x = 0.9
    boxState = 'idle'
    boxPrize = null
    clearBoxPreview()

    for (const id of Object.keys(powerUpTimers) as CallOfXenoPowerUpId[]) powerUpTimers[id] = 0
    instakillOn.value = false
    activePowerUps.value = []

    px = CALL_OF_XENO_PLAYER_START.x
    pz = CALL_OF_XENO_PLAYER_START.z
    feetY = 0
    vy = 0
    yaw = 0
    pitch = 0
    bob = 0
    shake = 0
    recoilPitch = 0
    bloom = 0
    aiming = false
    aimBlend = 0
    fovCurrent = 80
    camera.fov = 80
    camera.updateProjectionMatrix()
    meleeTimer = 0
    meleeCooldown = 0
    stepTimer = 0
    landOff = 0
    landVel = 0
    hbTimer = 0
    isMoving = false
    isSprinting = false
    hurtSources.length = 0
    hurtMarks.value = []
    damageFlash.value = 0
    hurtVeil.value = 0
    hpMax = runEffects.maxHealth
    hp = hpMax
    sinceDamage = 99
    score = runEffects.startingPoints
    grossEarned.value = 0
    runStartMs = Date.now()
    runTime = 0
    statKills = 0
    statHeadshots = 0
    statSpins = 0
    statDoors = 0
    statBarrels = 0
    statBoards = 0
    inBreak = false
    breakTimer = 0
    // Always the M1911 in the pocket; a picked sidearm rides in the second
    // slot and starts in hand.
    slots = runEffects.startWeapon
        ? [makeSlot('m1911'), makeSlot(runEffects.startWeapon)]
        : [makeSlot('m1911')]
    activeSlot = runEffects.startWeapon ? 1 : 0
    reloadTimer = 0
    reloadTotal = 0
    swapTimer = 0
    fireTimer = 0
    firing = false

    // Put the camera where the player will be, so the menu behind the panel
    // looks out of the Barracks rather than out of the world origin.
    camera.position.set(px, feetY + PLAYER_EYE, pz)
    camera.rotation.set(0, yaw, 0)

    rebuildCollision()
    equipModel()
    startRound(1)
    subBanner.value = 'Barracks — board the windows'
    syncHud()
}

// ---------------------------------------------------------------------------
// Round-boundary checkpoint
// ---------------------------------------------------------------------------

function buildSave(): CallOfXenoRunSave {
    return {
        version: CALL_OF_XENO_SAVE_VERSION,
        // Called the moment a round dies out: the next one is what a resume
        // restarts into.
        round: currentRound + 1,
        score: Math.round(score),
        grossEarned: Math.round(grossEarned.value),
        hp: Math.max(1, Math.round(hp)),
        hpMax: Math.round(hpMax),
        perks: [...perks],
        quickReviveBuys,
        weapons: slots.map(slot => ({ base: slot.base, tier: slot.tier, mag: slot.mag, reserve: slot.reserve })),
        activeSlot,
        equipment: [...equipmentStock.value],
        powered,
        doors: [...openDoors],
        x: Math.round(px * 100) / 100,
        z: Math.round(pz * 100) / 100,
        y: Math.round(feetY * 100) / 100,
        yaw: Math.round(yaw * 1000) / 1000,
        runTime: Math.round(runTime),
        stats: {
            kills: statKills,
            headshots: statHeadshots,
            spins: statSpins,
            barrels: statBarrels,
            boards: statBoards
        }
    }
}

/**
 * Fire-and-forget checkpoint at every round boundary. Best effort only: a
 * save that never lands costs the round in progress on the next crash,
 * never the run itself.
 */
function saveRun() {
    if (!serverRunActive) return
    const save = buildSave()
    const request: Promise<void> = $fetch<{ revision: number }>('/api/call-of-xeno/save-run', {
        method: 'POST',
        body: { revision: saveRevision, save }
    }).then((res) => {
        saveRevision = res.revision
    }).catch(() => {
        // Network hiccup or a rejected claim — play on without a checkpoint.
    })
    pendingSave = request
    void request.then(() => {
        if (pendingSave === request) pendingSave = null
    })
}

/** Restores a round-boundary checkpoint on top of a fresh resetRun(). */
function applySave(save: CallOfXenoRunSave) {
    for (const id of save.doors) {
        openDoors.add(id)
        const group = level.doors.get(id)
        if (group) {
            scene.remove(group)
            disposeObject(group)
            level.doors.delete(id)
        }
    }
    statDoors = save.doors.length

    if (save.powered) {
        powered = true
        powerOn.value = true
        level.powerLever.handle.rotation.x = -0.9
    }

    perks.clear()
    for (const id of save.perks) perks.add(id)
    ownedPerks.value = save.perks.map(id => CALL_OF_XENO_PERKS[id])
    quickReviveBuys = save.quickReviveBuys
    hpMax = save.hpMax
    hp = save.hp
    sinceDamage = 99

    slots = save.weapons.map((saved) => {
        const slot = makeSlot(saved.base, saved.tier)
        slot.mag = saved.mag
        slot.reserve = saved.reserve
        return slot
    })
    activeSlot = Math.min(save.activeSlot, slots.length - 1)

    // Undeployed equipment rides along; units left on the field at the
    // checkpoint are gone with the rest of the round in flight. Sliced to
    // the slot count the account actually owns.
    equipmentStock.value = (save.equipment ?? []).slice(0, runEffects.equipmentSlots)

    score = save.score
    grossEarned.value = save.grossEarned

    px = save.x
    pz = save.z
    feetY = save.y
    yaw = save.yaw
    pitch = 0
    vy = 0
    grounded = true

    statKills = save.stats.kills
    statHeadshots = save.stats.headshots
    statSpins = save.stats.spins
    statBarrels = save.stats.barrels
    statBoards = save.stats.boards
    runTime = save.runTime

    camera.position.set(px, feetY + PLAYER_EYE, pz)
    camera.rotation.set(0, yaw, 0)

    rebuildCollision()
    refreshLights()
    equipModel()
    startRound(save.round)
    syncHud()
}

/** Upgrade levels as the menu currently sees them — the resume's effects. */
function metaLevels(): CallOfXenoUpgradeLevels {
    const levels = { ...CALL_OF_XENO_EMPTY_LEVELS }
    for (const row of metaUpgrades.value) levels[row.id] = row.level
    return levels
}

/**
 * Picks a crashed run back up from its last round boundary. The run is
 * still armed server-side, so no deploy happens — the server clock and
 * payout snapshot keep running exactly as they were.
 */
async function resumeRun() {
    if (deploying.value) return
    const save = resumableSave.value
    const info = resumableRun.value
    if (!save || !info || !initScene()) return
    audio.start()
    deploying.value = true
    try {
        const difficulty = callOfXenoDifficulty(info.difficulty)
        runDifficulty = difficulty
        runDifficultyName.value = difficulty.name
        // Effects are rebuilt from the account's levels; the payout
        // multiplier stays the deploy-time snapshot the settle uses.
        const effects = callOfXenoUpgradeEffects(metaLevels())
        runEffects = { ...effects, payoutMult: info.payoutMult || effects.payoutMult }
        saveRevision = info.revision
        serverRunActive = true
        resumableSave.value = null
        resumableRun.value = null
        resetRun()
        // After resetRun, which stamps a fresh clock — the preview has to
        // run off the server-stamped deploy, the same clock the settle uses.
        runStartMs = new Date(info.startedAt).getTime()
        applySave(save)
        phase.value = 'playing'
        viewport.value?.querySelector('canvas')?.requestPointerLock()
    } finally {
        deploying.value = false
    }
}

/** Arms a run: stamps the server snapshot, applies the account power. */
async function deployRun(): Promise<boolean> {
    // The starter the player picked in the menu, validated against what the
    // account has actually unlocked.
    const applyEffects = () => {
        const sidearmLevel = metaUpgrades.value.find(u => u.id === 'sidearm')?.level ?? 0
        if (!callOfXenoSidearmUnlocked(chosenSidearm.value, sidearmLevel)) chosenSidearm.value = 'm1911'
        runEffects = {
            ...runEffects,
            startWeapon: chosenSidearm.value === 'm1911' ? null : chosenSidearm.value
        }
    }

    if (guestMode.value) {
        runDifficulty = CALL_OF_XENO_DIFFICULTIES[0]!
        runDifficultyName.value = runDifficulty.name
        runEffects = callOfXenoUpgradeEffects(CALL_OF_XENO_EMPTY_LEVELS)
        applyEffects()
        serverRunActive = false
        resumableSave.value = null
        resumableRun.value = null
        resetRun()
        return true
    }

    deploying.value = true
    menuError.value = ''
    try {
        // Let any in-flight checkpoint from the previous run land before a
        // new one is armed — a straggler would otherwise write itself into
        // the fresh run's slot.
        if (pendingSave) await pendingSave
        const res = await $fetch('/api/call-of-xeno/start-run', {
            method: 'POST',
            // A confirmed second click abandons a stuck run (dead tab from a
            // lost connection) instead of refusing to deploy.
            body: { difficultyId: selectedDifficulty.value, force: staleRunConflict.value }
        })
        staleRunConflict.value = false
        runDifficulty = callOfXenoDifficulty(res.difficulty?.id ?? selectedDifficulty.value)
        runDifficultyName.value = runDifficulty.name
        runEffects = res.effects
        // Anchor the preview clock to the server-stamped start — the exact
        // timestamp the settle will measure elapsed time against.
        runStartMs = res.runStartedAt ? new Date(res.runStartedAt).getTime() : Date.now()
        applyEffects()
        serverRunActive = true
        saveRevision = 0
        resumableSave.value = null
        resumableRun.value = null
        resetRun()
        return true
    } catch (error) {
        const status = (error as { statusCode?: number })?.statusCode
        if (status === 401) {
            // Not signed in after all (session expired mid-visit): fall back
            // to a bankless run rather than locking the game behind a login.
            guestMode.value = true
            return deployRun()
        }
        menuError.value = (error as { statusMessage?: string })?.statusMessage
            ?? (error instanceof Error ? error.message : 'Could not start the run')
        if (menuError.value.includes('already active')) staleRunConflict.value = true
        void refreshMeta()
        return false
    } finally {
        deploying.value = false
    }
}

async function begin() {
    if (!initScene()) return
    audio.start()
    if (phase.value === 'menu' && !(await deployRun())) return
    phase.value = 'playing'
    viewport.value?.querySelector('canvas')?.requestPointerLock()
}

async function restart() {
    if (!initScene()) return
    audio.start()
    if (!guestMode.value) {
        // The armed run was settled on death — the cooldown is running, so
        // the next run is chosen from the menu, not from the death screen.
        payoutResult.value = null
        await refreshMeta()
        phase.value = 'menu'
        return
    }
    await deployRun()
    phase.value = 'playing'
    viewport.value?.querySelector('canvas')?.requestPointerLock()
}

function toggleMute() {
    muted.value = !muted.value
    audio.setMuted(muted.value)
}

function onKeyDown(event: KeyboardEvent) {
    const code = event.code.toLowerCase()
    keys.add(code)
    if (code === 'keym') toggleMute()
    if (workbenchOpen.value) {
        if (code === 'keyf') closeWorkbench()
        if (code === 'escape') {
            // Esc is pause, not close: drop the bench but leave the mouse
            // free so the pause overlay takes over straight away.
            workbenchOpen.value = false
            relockPending.value = false
        }
        if (code === 'digit1') buyEquipment('sentry')
        if (code === 'digit2') buyEquipment('drone')
        if (code === 'digit3') buyEquipment('blackhole')
        return
    }
    if (phase.value !== 'playing' || !locked.value) return
    if (code === 'keyr') startReload()
    if (code === 'keyf') interact()
    if (code === 'keyq') swapWeapon()
    if (code === 'keye') deployEquipment()
    if (code === 'keyv') melee()
    if (code === 'space') { event.preventDefault(); jump() }
}

function onKeyUp(event: KeyboardEvent) {
    keys.delete(event.code.toLowerCase())
}

function onMouseMove(event: MouseEvent) {
    if (!locked.value) return
    yaw -= event.movementX * 0.0022
    pitch -= event.movementY * 0.0022
    pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch))
}

function onMouseDown(event: MouseEvent) {
    if (!locked.value || phase.value !== 'playing') return
    if (event.button === 0) firing = true
    if (event.button === 2) aiming = true
}

function onMouseUp(event: MouseEvent) {
    if (event.button === 0) firing = false
    if (event.button === 2) aiming = false
}

function onContextMenu(event: MouseEvent) {
    if (locked.value) event.preventDefault()
}

function onPointerLockChange() {
    locked.value = document.pointerLockElement !== null
    if (!locked.value) {
        firing = false
        aiming = false
        keys.clear()
    }
}

function onResize() {
    if (!renderer || !viewport.value) return
    const width = viewport.value.clientWidth
    const height = viewport.value.clientHeight
    renderer.setSize(width, height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
}

/**
 * Builds the renderer and the scene. Called on mount, and again on the first
 * click if the template ref was not attached yet — mounting a client-only
 * component inside Nuxt's Suspense boundary can run the hook before the ref
 * lands, and a silent bail there used to leave the whole game uninitialised.
 */
function initScene(): boolean {
    if (ready) return true
    const host = viewport.value
    if (!host) return false

    try {
        buildScene(host)
        ready = true
        initError.value = ''
        return true
    } catch (error) {
        initError.value = error instanceof Error ? error.message : String(error)
        console.error('[call-of-xeno] failed to start', error)
        return false
    }
}

function buildScene(host: HTMLDivElement) {
    scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0b0c0d)
    fog = new THREE.Fog(0x0b0c0d, 12, 44)
    scene.fog = fog

    camera = new THREE.PerspectiveCamera(80, host.clientWidth / host.clientHeight, 0.03, 220)
    camera.rotation.order = 'YXZ'

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.setSize(host.clientWidth, host.clientHeight)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    host.appendChild(renderer.domElement)

    effects = new CallOfXenoEffects(scene)
    level = buildLevel(scene)
    initBarrels()

    weaponRoot = new THREE.Group()
    camera.add(weaponRoot)

    flashTexture = makeFlashTexture()
    muzzleFlash = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flashTexture,
        transparent: true,
        opacity: 0,
        depthTest: false,
        blending: THREE.AdditiveBlending
    }))
    muzzleFlash.position.set(0, 0.05, -0.62)
    muzzleFlash.scale.setScalar(0.32)
    muzzleFlash.visible = false
    weaponRoot.add(muzzleFlash)

    muzzleLight = new THREE.PointLight(0xffbb55, 0, 10, 2)
    muzzleLight.position.set(0, 0.05, -0.7)
    weaponRoot.add(muzzleLight)

    scene.add(camera)
    resetRun()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('resize', onResize)
    document.addEventListener('pointerlockchange', onPointerLockChange)

    let last = performance.now()
    const loop = (now: number) => {
        if (disposed) return
        frameHandle = requestAnimationFrame(loop)
        const dt = Math.min(0.05, (now - last) / 1000)
        last = now
        if (phase.value === 'playing' && (locked.value || workbenchOpen.value)) {
            update(dt)
            syncHud(dt)
        }
        renderer!.render(scene, camera)
    }
    frameHandle = requestAnimationFrame(loop)
}

let cooldownTicker = 0

onMounted(() => {
    void refreshMeta()
    cooldownTicker = window.setInterval(() => {
        if (cooldownRemainingMs.value > 0) cooldownRemainingMs.value = Math.max(0, cooldownRemainingMs.value - 1000)
    }, 1000)
    if (initScene()) return
    void nextTick(() => initScene())
})

onBeforeUnmount(() => {
    disposed = true
    cancelAnimationFrame(frameHandle)
    window.clearInterval(cooldownTicker)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mousedown', onMouseDown)
    window.removeEventListener('mouseup', onMouseUp)
    window.removeEventListener('contextmenu', onContextMenu)
    window.removeEventListener('resize', onResize)
    document.removeEventListener('pointerlockchange', onPointerLockChange)
    if (document.pointerLockElement) document.exitPointerLock()

    audio.dispose()
    effects?.dispose()
    if (scene) disposeObject(scene)
    flashTexture?.dispose()
    for (const texture of level?.textures ?? []) texture.dispose()
    renderer?.dispose()
    renderer = null

    enemies.length = 0
    corpses.length = 0
    projectiles.length = 0
    playerRounds.length = 0
    groundPowerUps.length = 0
    sentries.length = 0
    escorts.length = 0
    blackHoles.length = 0
    groundEquipment.length = 0
    worldPopups.length = 0
    weaponModel = null
    boxPreview = null
})
</script>
