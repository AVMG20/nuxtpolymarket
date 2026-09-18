<template>
    <div class="vh">
        <!-- Top bar -->
        <header class="vh-top">
            <NuxtLink to="/" class="vh-leave" @click="$emit('sound', 'ui')">
                <UIcon name="i-lucide-chevron-left" class="size-4" />
                <span class="vh-leave-label">Leave</span>
            </NuxtLink>
            <div class="vh-brand">VOID<span>RUNNER</span></div>
            <nav class="vh-tabs">
                <button
                    v-for="t in tabs"
                    :key="t.id"
                    class="vh-tab"
                    :class="{ 'vh-tab-on': tab === t.id }"
                    :title="t.label"
                    @click="setTab(t.id)"
                >
                    <UIcon :name="t.icon" class="size-4" />
                    <span class="vh-tab-label">{{ t.label }}</span>
                </button>
            </nav>
            <button class="vh-mute" :title="muted ? 'Unmute' : 'Mute'" @click="$emit('toggle-mute')">
                <UIcon :name="muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'" class="size-4" />
            </button>
            <button class="vh-mute vh-fullscreen" :title="spin ? 'Stop the camera spinning' : 'Let the camera circle the ship'" @click="$emit('toggle-spin')">
                <UIcon :name="spin ? 'i-lucide-pause' : 'i-lucide-rotate-3d'" class="size-4" />
            </button>
            <button v-if="canFullscreen" class="vh-mute vh-fullscreen" :title="fullscreen ? 'Exit fullscreen (F11)' : 'Fullscreen (F11)'" @click="$emit('toggle-fullscreen')">
                <UIcon :name="fullscreen ? 'i-lucide-minimize' : 'i-lucide-maximize'" class="size-4" />
            </button>
            <div class="vh-pilot" :title="`Pilot level ${state.pilot.level}`">
                <div class="vh-pilot-badge">{{ state.pilot.level }}</div>
                <div>
                    <div class="vh-pilot-name">{{ rank.name }}</div>
                    <div class="vh-pilot-bar"><div :style="{ width: `${rank.progress * 100}%` }" /></div>
                </div>
            </div>
            <div class="vh-wallet">
                <div class="vh-coins" title="Coins">
                    <UIcon name="i-lucide-coins" class="size-4" />
                    <span>{{ formatNumber(state.balance) }}</span>
                </div>
                <div class="vh-coins vh-gems" title="Gems">
                    <UIcon name="i-lucide-gem" class="size-4" />
                    <span>{{ formatNumber(state.gems) }}</span>
                </div>
                <div class="vh-res">
                    <div v-for="r in state.resourceCatalog" :key="r.id" class="vh-res-chip" :title="`${r.name}: ${r.description}`" :class="{ 'vh-dim': !held(r.id) }">
                        <i class="vr-gem" :style="{ '--c': hex(r.color) }" />
                        <span>{{ formatNumber(held(r.id)) }}</span>
                    </div>
                </div>
            </div>
        </header>

        <!-- Ship title over the showroom -->
        <section v-if="tab === 'hangar'" class="vh-title">
            <div class="vh-title-role">{{ shown.role }} <span v-if="!shown.owned">· preview</span></div>
            <div class="vh-title-name">{{ shown.name }}</div>
            <p class="vh-title-desc">{{ shown.description }}</p>
            <div class="vh-title-stats">
                <div v-if="shown.owned"><span>Power</span><b>{{ formatNumber(shown.power, false) }}</b></div>
                <div><span>Turrets</span><b>{{ shown.turrets }}</b></div>
                <div><span>Drones</span><b>{{ shown.stats.drones }}</b></div>
                <div v-if="shown.ability" :title="abilityText(shown.ability)"><span>Ability · R</span><b>{{ abilityName(shown.ability) }}</b></div>
            </div>
            <!-- Spec sheet: bars against the best hull in the game, so it reads at a glance. -->
            <div class="vh-spec">
                <div v-for="row in shownSpec" :key="row.label" class="vh-spec-row">
                    <span>{{ row.label }}</span>
                    <div class="vh-spec-bar">
                        <div class="vh-spec-fill" :style="{ width: `${row.pct * 100}%` }" />
                        <i v-if="row.delta" class="vh-spec-mark" :style="{ left: `${row.basePct * 100}%` }" :title="`${equipped.name}: ${row.baseText}`" />
                    </div>
                    <b>{{ row.value }}</b>
                    <i v-if="row.delta > 0" class="vh-up">+{{ row.deltaText }}</i>
                    <i v-else-if="row.delta < 0" class="vh-down">−{{ row.deltaText }}</i>
                    <i v-else />
                </div>
                <p v-if="shown.id !== state.equippedShipId" class="vh-spec-note">Bare frame against the {{ equipped.name }}. Your gear moves across when you fly it.</p>
            </div>
            <div v-if="firstSteps && !previewShipId" class="vh-steps">
                <div class="vh-goal-kicker">First steps · {{ firstSteps.done }} / {{ firstSteps.steps.length }}</div>
                <button
                    v-for="step in firstSteps.visible"
                    :key="step.text"
                    class="vh-step"
                    :class="{ 'vh-step-done': step.done, 'vh-step-now': step === firstSteps.current }"
                    @click="step.tab && setTab(step.tab)"
                >
                    <i />
                    <span>
                        <b>{{ step.text }}</b>
                        <small v-if="step === firstSteps.current">{{ step.hint }}</small>
                    </span>
                </button>
            </div>
            <div v-else-if="nextGoal && !previewShipId" class="vh-goal">
                <div class="vh-goal-kicker">Next goal</div>
                <div class="vh-goal-title">{{ nextGoal.title }}</div>
                <div class="vh-goal-need">
                    <template v-if="nextGoal.missing.length">
                        <span v-for="m in nextGoal.missing" :key="m.id"><i class="vr-gem" :style="{ '--c': m.hex }" />{{ formatNumber(m.amount) }} more {{ m.name }}</span>
                    </template>
                    <span v-else class="vh-goal-ready">Ready to build</span>
                </div>
            </div>
            <div v-if="!shown.owned" class="vh-title-cta">
                <button v-if="previewShipId" class="vr-btn vr-btn-sm" @click="$emit('preview', null)">Back to your ship</button>
            </div>
        </section>

        <!-- Launch bar -->
        <section v-if="tab === 'hangar'" class="vh-launch">
            <button class="vh-arrow" :disabled="sectorIndex <= 0" @click="stepSector(-1)">
                <UIcon name="i-lucide-chevron-left" class="size-5" />
            </button>
            <div class="vh-sector" :style="{ '--s1': hex(currentSector.palette[1]), '--s2': hex(currentSector.palette[2]) }">
                <div class="vh-sector-tier">Sector {{ currentSector.tier }} <span v-if="currentSector.cleared">· cleared</span></div>
                <div class="vh-sector-name">{{ currentSector.name }}</div>
                <div class="vh-sector-ores">
                    <i v-for="(w, id) in currentSector.ores" :key="id" class="vr-gem" :style="{ '--c': resHex(String(id)) }" :title="resName(String(id))" />
                    <span v-if="gearTier < currentSector.tier - 0.5" class="vh-undergeared" :title="`Your gear averages T${gearTier.toFixed(1)}`">Needs T{{ currentSector.tier }} gear</span>
                    <span class="vh-threat" :title="`Hostiles here hit ${currentSector.threat}× as hard as sector 1`">Danger ×{{ currentSector.threat }}</span>
                </div>
            </div>
            <button class="vh-arrow" :disabled="sectorIndex >= state.sectors.length - 1 || !state.sectors[sectorIndex + 1]?.unlocked" @click="stepSector(1)">
                <UIcon name="i-lucide-chevron-right" class="size-5" />
            </button>
            <button class="vh-go" :disabled="busy || !currentSector.unlocked" @click="$emit('launch', currentSector.tier)">
                <span>Launch</span>
                <small>{{ equipped.name }}</small>
            </button>
        </section>

        <!-- Hull bay: always beside the pad, so you can swap ships at any time -->
        <section v-if="tab === 'hangar'" class="vh-yard">
            <header class="vh-yard-head">
                <div>
                    <h1>Shipyard</h1>
                    <p>{{ ownedCount }} / {{ state.ships.length }} hulls owned</p>
                </div>
            </header>
            <div class="vh-yard-list">
                <button
                    v-for="ship in state.ships"
                    :key="ship.id"
                    class="vh-yard-ship"
                    :class="{ 'vh-sel': shown.id === ship.id, 'vh-locked': !ship.unlocked && !ship.owned }"
                    @click="viewShip(ship.id)"
                >
                    <div class="vh-yard-ship-head">
                        <b>{{ ship.name }}</b>
                        <span v-if="ship.equipped" class="vh-tag vh-tag-good">Flying</span>
                        <span v-else-if="ship.owned" class="vh-tag">Owned</span>
                        <span v-else-if="!ship.unlocked" class="vh-tag vh-tag-bad">Sector {{ ship.requiresSector }}</span>
                        <span v-else-if="ship.affordable" class="vh-tag vh-tag-good">Can build</span>
                    </div>
                    <div class="vh-yard-ship-sub">
                        <span>{{ ship.role }}</span>
                        <span>{{ ship.turrets }}T · {{ ship.armor }}A · {{ ship.shields }}S</span>
                    </div>
                </button>
            </div>
            <footer class="vh-yard-foot">
                <template v-if="shown.equipped">
                    <div class="vh-yard-state">You are flying this hull. Launch below when you are ready.</div>
                </template>
                <template v-else-if="shown.owned">
                    <div class="vh-yard-state">Built and docked. Its gear stays fitted.</div>
                    <button class="vr-btn vr-btn-primary" :disabled="busy" @click="$emit('equip', shown.id)">Fly the {{ shown.name }}</button>
                </template>
                <template v-else-if="!shown.unlocked">
                    <div class="vh-yard-state vh-yard-locked">Clear sector {{ shown.requiresSector }} to unlock this hull.</div>
                </template>
                <template v-else>
                    <VoidCost :cost="shown.cost" :held="state.resources" :coins="shown.coins" :gems="shown.gems" :balance="state.balance" :gems-held="state.gems" />
                    <button class="vr-btn vr-btn-primary" :disabled="busy || !shown.affordable" @click="$emit('buy-ship', shown.id)">Build the {{ shown.name }}</button>
                </template>
            </footer>
        </section>

        <!-- Full-screen page for everything you manage between runs -->
        <section v-if="tab !== 'hangar'" class="vh-page">
            <div class="vh-page-inner">
                <header class="vh-page-head">
                    <button class="vh-back" title="Back to the hangar (Esc)" @click="setTab('hangar')">
                        <UIcon name="i-lucide-arrow-left" class="size-4" />
                        <span>Hangar</span>
                    </button>
                    <div class="vh-page-title">
                        <h1>{{ page.title }}</h1>
                        <p>{{ page.blurb }}</p>
                    </div>
                    <button class="vr-btn vr-btn-primary vh-page-launch" :disabled="busy || !currentSector.unlocked" :title="`Launch into ${currentSector.name}`" @click="$emit('launch', currentSector.tier)">
                        <UIcon name="i-lucide-rocket" class="size-4" /> Launch · {{ currentSector.name }}
                    </button>
                </header>

            <!-- Loadout -->
            <template v-if="tab === 'fitting'">
                <VoidLoadout :state="state" :busy="busy" @set-fit="(shipId: string, fit: unknown) => $emit('set-fit', shipId, fit)" @craft="setTab('workshop:craft')" />
                <h2 class="vh-h">Supplies <small>Keys 1-3 · every launch takes up to {{ state.supplyCarry }} of each from your store, whether you use them or not</small></h2>
                <div class="vh-list">
                    <div v-for="s in state.supplies" :key="s.id" class="vh-card" :style="{ '--c': hex(s.color) }">
                        <div class="vh-card-head">
                            <kbd>{{ s.key }}</kbd>
                            <UIcon :name="s.icon" class="size-4 vh-supply-icon" />
                            <b>{{ s.name }}</b>
                            <span class="vh-lvl">{{ s.stock }} / {{ state.supplyStockMax }}</span>
                        </div>
                        <p>{{ s.description }}</p>
                        <div class="vh-card-foot">
                            <VoidCost :cost="s.cost.resources" :held="state.resources" :coins="s.cost.coins" :balance="state.balance" />
                            <button class="vr-btn vr-btn-sm" :disabled="busy || !s.affordable || s.stock >= state.supplyStockMax" @click="$emit('buy-supply', s.id, 1)">Buy</button>
                        </div>
                    </div>
                </div>
            </template>

            <!-- Workshop -->
            <template v-else-if="tab === 'workshop'">
                <VoidWorkshop
                    :state="state"
                    v-model:view="workshopView"
                    :busy="busy"
                    :highlight-id="highlightItemId"
                    @craft="(k: string, t: string, tier: number) => $emit('craft', k, t, tier)"
                    @upgrade="(id: string) => $emit('upgrade-item', id)"
                    @salvage="(id: string) => $emit('salvage', id)"
                    @socket="(id: string, mod: string) => $emit('socket', id, mod)"
                />
            </template>

            <!-- Station -->
            <template v-else-if="tab === 'station'">
                <h2 class="vh-h">Command perks <small>{{ state.marks }} Command Marks · from wardens, carriers and deep jumps</small></h2>
                <div class="vh-list">
                    <div v-for="perk in state.perks" :key="perk.id" class="vh-card">
                        <div class="vh-card-head">
                            <UIcon :name="perk.icon" class="size-4" />
                            <b>{{ perk.name }}</b>
                            <span class="vh-lvl">{{ perk.rank }} / {{ perk.maxRank }}</span>
                        </div>
                        <p>{{ perk.description }}</p>
                        <div class="vh-upg-effect">
                            <span>{{ perk.current }}</span>
                            <template v-if="perk.next">
                                <UIcon name="i-lucide-arrow-right" class="size-3" />
                                <b>{{ perk.next }}</b>
                            </template>
                        </div>
                        <div v-if="perk.cost !== null" class="vh-card-foot">
                            <span class="vh-kv"><span>Cost <b>{{ perk.cost }} marks</b></span></span>
                            <button class="vr-btn vr-btn-sm" :disabled="busy || !perk.affordable" @click="$emit('buy-perk', perk.id)">Buy</button>
                        </div>
                        <div v-else class="vh-maxed">Maxed</div>
                    </div>
                </div>
                <h2 class="vh-h">Station contracts <small>Resets in {{ resetIn }}</small></h2>
                <div class="vh-list">
                    <div v-for="c in state.contracts" :key="c.index" class="vh-card vh-contract" :class="{ 'vh-dim': c.done }">
                        <div class="vh-card-head">
                            <i class="vr-gem" :style="{ '--c': resHex(c.resource) }" />
                            <b>Deliver {{ formatNumber(c.amount, false) }} {{ resName(c.resource) }}</b>
                            <span v-if="c.done" class="vh-tag vh-tag-good">Delivered</span>
                        </div>
                        <div class="vh-card-foot">
                            <span class="vh-kv"><span>Pays <b>{{ formatNumber(c.coins) }}</b></span><span>XP <b>+{{ c.xp }}</b></span><span>Held <b>{{ formatNumber(held(c.resource)) }}</b></span></span>
                            <button v-if="!c.done" class="vr-btn vr-btn-sm" :disabled="busy || !c.affordable" @click="$emit('claim-contract', c.index)">Deliver</button>
                        </div>
                    </div>
                </div>
                <h2 class="vh-h">Ship systems <small>Fitted to every hull you own</small></h2>
                <div class="vh-list">
                    <div v-for="u in state.upgrades" :key="u.id" class="vh-card">
                        <div class="vh-card-head">
                            <b>{{ u.name }}</b>
                            <span class="vh-lvl">{{ voidMark(u.level) }}<template v-if="u.level < u.maxLevel"> → {{ voidMark(u.level + 1) }}</template></span>
                        </div>
                        <p>{{ u.description }}</p>
                        <div class="vh-pips">
                            <i v-for="n in u.maxLevel" :key="n" :class="{ 'vh-pip-on': n <= u.level }" />
                        </div>
                        <div class="vh-upg-effect">
                            <span>{{ u.current }}</span>
                            <template v-if="u.next">
                                <UIcon name="i-lucide-arrow-right" class="size-3" />
                                <b>{{ u.next }}</b>
                            </template>
                        </div>
                        <div v-if="u.cost" class="vh-card-foot">
                            <VoidCost :cost="u.cost.resources" :held="state.resources" :coins="u.cost.coins" :gems="u.cost.gems" :balance="state.balance" :gems-held="state.gems" />
                            <button class="vr-btn vr-btn-sm" :disabled="busy || !u.affordable" @click="$emit('upgrade', u.id)">Install</button>
                        </div>
                        <div v-else class="vh-maxed">Maxed</div>
                    </div>
                </div>
            </template>

            <!-- Skills -->
            <template v-else-if="tab === 'skills'">
                <VoidSkills
                    :skills="state.skills"
                    :equipped="state.equippedSkill"
                    :pilot="state.pilot"
                    :resources="state.resources"
                    :balance="state.balance"
                    :gems="state.gems"
                    :busy="busy"
                    @unlock="(id: string) => $emit('unlock-skill', id)"
                    @equip="(id: string) => $emit('equip-skill', id)"
                    @nodes="(id: string, nodes: string[]) => $emit('skill-nodes', id, nodes)"
                />
            </template>

            <!-- Market -->
            <template v-else-if="tab === 'market'">
                <div class="vh-card vh-trade">
                    <div class="vh-card-head">
                        <UIcon name="i-lucide-handshake" class="size-4" />
                        <b>Trade Contracts</b>
                        <span class="vh-lvl">{{ state.trade.level }} / {{ state.trade.maxLevel }}</span>
                    </div>
                    <div class="vh-pips">
                        <i v-for="n in state.trade.maxLevel" :key="n" :class="{ 'vh-pip-on': n <= state.trade.level }" />
                    </div>
                    <div class="vh-upg-effect">
                        <span>×{{ state.trade.mult.toFixed(1) }} sell price</span>
                        <template v-if="state.trade.nextMult">
                            <UIcon name="i-lucide-arrow-right" class="size-3" />
                            <b>×{{ state.trade.nextMult.toFixed(1) }}</b>
                        </template>
                    </div>
                    <div v-if="state.trade.cost" class="vh-card-foot">
                        <VoidCost :cost="{}" :held="state.resources" :coins="state.trade.cost" :balance="state.balance" />
                        <button class="vr-btn vr-btn-sm" :disabled="busy || !state.trade.affordable" @click="$emit('buy-trade')">Sign</button>
                    </div>
                    <div v-else class="vh-maxed">Maxed</div>
                </div>
                <div class="vh-list">
                    <div v-for="r in state.resourceCatalog" :key="r.id" class="vh-card vh-market" :class="{ 'vh-dim': !held(r.id) }">
                        <div class="vh-card-head">
                            <i class="vr-gem" :style="{ '--c': hex(r.color) }" />
                            <b>{{ r.name }}</b>
                            <span class="vh-price">{{ formatNumber(state.prices[r.id]) }} / unit</span>
                        </div>
                        <div class="vh-card-foot">
                            <span class="vh-held">{{ formatNumber(held(r.id), false) }} held · {{ formatNumber(held(r.id) * state.prices[r.id]) }}</span>
                            <div class="vh-sell">
                                <button class="vr-btn vr-btn-sm" :disabled="busy || held(r.id) < 1" @click="$emit('sell', r.id, Math.min(500, held(r.id)))">Sell 500</button>
                                <button class="vr-btn vr-btn-sm" :disabled="busy || held(r.id) < 1" @click="$emit('sell', r.id, 'all')">All</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="vh-total">Stores worth <b>{{ formatNumber(storesValue) }}</b> coins</div>
            </template>

            <!-- Codex -->
            <template v-else-if="tab === 'codex'">
                <h2 class="vh-h">Flight manual</h2>
                <div class="vh-manual">
                    <p><b>The loop.</b> Launch into a sector, crack glowing asteroids for ore, loot wrecks and kills, then dock at the station or a beacon to bank the hold. Die and the hold is gone.</p>
                    <p><b>Gear.</b> Guns, turrets, armour and shields are crafted in the Workshop from the materials of their tier. Every craft rolls a rarity with bonus stats, and every item levels to +10. Each sector you clear opens the next gear tier, and deeper sectors need it.</p>
                    <p><b>Damage types.</b> Energy weapons strip shields and glance off hull plate; kinetic rounds bounce off shields and tear hulls; explosives are even-handed. Shots to an enemy's engines do extra damage and slow it.</p>
                    <p><b>Systems.</b> E fires your secondary (hold to lock on), G triggers your device, T pulses the scanner to mark data logs and hidden caches. Heavy hull hits can knock out engines, weapons or shields for a few seconds; repair nanites fix them.</p>
                    <p><b>Jumps.</b> Every zone has a jump gate. With a fuel cell you pick the next zone from three, each tougher and richer with its own twist. Extract at any beacon to bank the hold.</p>
                    <p><b>Relics.</b> Elites, wardens and vaults sometimes drop a golden relic cache. Bank it at a dock to reveal a mod, then socket it into gear for a unique effect.</p>
                    <p><b>Progress.</b> Hulls add slots, skills add a second weapon, station systems improve hauling, and contracts pay a premium for deliveries every day.</p>
                    <p><b>Combat.</b> Turrets pick targets on their own; your crosshair tells them what matters most. Elites carry a gold halo and drop far more loot.</p>
                </div>
                <h2 class="vh-h">Data logs <small>{{ state.lore.filter(l => l.found).length }} / {{ state.lore.length }} · scan (T) to find them</small></h2>
                <div class="vh-list">
                    <div v-for="entry in state.lore" :key="entry.id" class="vh-card" :class="{ 'vh-locked': !entry.found }">
                        <div class="vh-card-head"><b>{{ entry.found ? entry.title : 'Undiscovered log' }}</b></div>
                        <p v-if="entry.found">{{ entry.text }}</p>
                    </div>
                </div>
                <h2 class="vh-h">Hostiles</h2>
                <div class="vh-list">
                    <div v-for="enemy in codex" :key="enemy.kind" class="vh-card" :style="{ '--c': hex(enemy.glow) }">
                        <div class="vh-card-head">
                            <i class="vh-dotc" />
                            <b>{{ enemy.name }}</b>
                            <span v-if="enemy.elite" class="vh-tag">Elite</span>
                        </div>
                        <p>{{ enemy.tell }}</p>
                        <div class="vh-kv">
                            <span>Hull <b>{{ enemy.hp }}</b></span>
                            <span>First seen <b>Sector {{ enemy.firstSector }}</b></span>
                        </div>
                    </div>
                </div>
                <h2 class="vh-h">Wardens</h2>
                <div class="vh-list">
                    <div v-for="s in state.sectors" :key="s.tier" class="vh-card" :class="{ 'vh-locked': !s.unlocked }">
                        <div class="vh-card-head">
                            <span class="vh-tier">{{ s.tier }}</span>
                            <b>{{ s.warden }}</b>
                            <span v-if="s.cleared" class="vh-tag vh-tag-good">Destroyed</span>
                        </div>
                        <p>Guards {{ s.name }}. Radial barrages, homing missiles, sweeping beams below two thirds hull, and swarms of Mites when cornered.</p>
                    </div>
                </div>
            </template>

            <!-- Records -->
            <template v-else-if="tab === 'records'">
                <h2 class="vh-h">Service record</h2>
                <div class="vh-record">
                    <div><span>Runs</span><b>{{ state.runsPlayed }}</b></div>
                    <div><span>Extractions</span><b>{{ state.extractions }}</b></div>
                    <div><span>Kills</span><b>{{ formatNumber(state.kills) }}</b></div>
                    <div><span>Wardens</span><b>{{ state.wardensKilled }}</b></div>
                    <div><span>Best haul</span><b>{{ formatNumber(state.bestHaulValue) }}</b></div>
                    <div><span>Sold</span><b>{{ formatNumber(state.totalSold) }}</b></div>
                </div>
                <h2 class="vh-h">Leaderboard</h2>
                <div class="vh-table">
                    <div v-for="row in leaderboard" :key="row.rank" class="vh-row" :class="{ 'vh-me': row.isCurrentUser }">
                        <span class="vh-rank">{{ row.rank }}</span>
                        <span class="vh-who">{{ row.name }}<small>{{ row.shipName }}</small></span>
                        <span>S{{ row.cleared }}</span>
                        <b>{{ formatNumber(row.bestHaulValue) }}</b>
                    </div>
                    <div v-if="!leaderboard.length" class="vh-hint">No runners yet.</div>
                </div>
                <h2 class="vh-h">Recent runs</h2>
                <div class="vh-table">
                    <div v-for="r in history" :key="r.id" class="vh-row">
                        <span class="vh-rank" :class="r.extracted ? 'vh-ok' : 'vh-ko'">{{ r.extracted ? '✓' : '✕' }}</span>
                        <span class="vh-who">S{{ r.sector }} · {{ shipName(r.shipId) }}<small>{{ clock(r.durationMs) }} · {{ r.kills }} kills<template v-if="r.wardenKilled"> · warden</template></small></span>
                        <span />
                        <b>{{ formatNumber(r.haulValue) }}</b>
                    </div>
                    <div v-if="!history.length" class="vh-hint">No runs logged.</div>
                </div>
            </template>
            </div>
        </section>
    </div>
</template>

<script setup lang="ts">
import type { InternalApi } from 'nitropack/types'
import {
    VOID_ABILITIES, VOID_SHIPS, voidHex, voidMark, voidResource, voidShip,
    type VoidAbilityId, type VoidResourceId, type VoidUpgradeId
} from '#shared/utils/gamelogic/void'
import type { VoidSfx } from '~/utils/void/audio'
import { ENEMIES } from '~/utils/void/data'
import VoidCost from './VoidCost.vue'
import VoidSkills from './VoidSkills.vue'
import VoidLoadout from './VoidLoadout.vue'
import VoidWorkshop, { type WorkshopView } from './VoidWorkshop.vue'

type State = InternalApi['/api/void/state']['get']

const props = defineProps<{
    state: State
    busy: boolean
    previewShipId: string | null
    history: InternalApi['/api/void/history']['get']
    leaderboard: InternalApi['/api/void/leaderboard']['get']
    muted?: boolean
    fullscreen?: boolean
    spin?: boolean
    canFullscreen?: boolean
    /** The item to flash in the workshop, such as a fresh craft. */
    highlightItemId?: string | null
}>()

const emit = defineEmits<{
    'preview': [shipId: string | null]
    'launch': [tier: number]
    'equip': [shipId: string]
    'buy-ship': [shipId: string]
    'set-fit': [shipId: string, fit: unknown]
    'craft': [kind: string, type: string, tier: number]
    'upgrade-item': [itemId: string]
    'salvage': [itemId: string]
    'socket': [itemId: string, modId: string]
    'buy-supply': [supplyId: string, count: number]
    'claim-contract': [index: number]
    'buy-perk': [perkId: string]
    'upgrade': [id: VoidUpgradeId]
    'sell': [resource: string, amount: number | 'all']
    'tab': [tab: string]
    'sound': [sfx: VoidSfx]
    'toggle-mute': []
    'toggle-fullscreen': []
    'toggle-spin': []
    'unlock-skill': [skillId: string]
    'equip-skill': [skillId: string]
    'skill-nodes': [skillId: string, nodes: string[]]
    'buy-trade': []
}>()

const tabs = [
    { id: 'hangar', label: 'Hangar', icon: 'i-lucide-warehouse', blurb: '' },
    { id: 'fitting', label: 'Loadout', icon: 'i-lucide-crosshair', blurb: 'Choose the gear your ship flies with. Pick a slot, then the item to put in it.' },
    { id: 'workshop', label: 'Workshop', icon: 'i-lucide-hammer', blurb: 'Craft new gear, level up what you own and socket relic mods.' },
    { id: 'skills', label: 'Skills', icon: 'i-lucide-sparkles', blurb: 'Your pilot skill on Q. Unlock new skills and spend points as you level up.' },
    { id: 'station', label: 'Station', icon: 'i-lucide-satellite', blurb: 'Permanent perks, daily delivery contracts and systems for every hull.' },
    { id: 'market', label: 'Market', icon: 'i-lucide-coins', blurb: 'Sell the materials you bring home for coins. Trade Contracts raise every price.' },
    { id: 'codex', label: 'Codex', icon: 'i-lucide-book-open', blurb: 'How the game works, the data logs you found and what hunts you out there.' },
    { id: 'records', label: 'Records', icon: 'i-lucide-trophy', blurb: 'Your service record, the leaderboard and your recent runs.' }
]
const tab = ref('hangar')
const page = computed(() => {
    const t = tabs.find(x => x.id === tab.value) ?? tabs[0]!
    return { title: t.label, blurb: t.blurb }
})
const codex = Object.values(ENEMIES).map(e => ({
    ...e,
    firstSector: e.kind === 'sentinel' ? 2 : e.weights.findIndex(w => w > 0) + 1
}))
const sectorIndex = ref(0)

watch(() => props.state.sectors, (sectors) => {
    // Default to the deepest open sector the first time we see the map.
    if (sectorIndex.value === 0) {
        const deepest = sectors.filter(s => s.unlocked).length - 1
        sectorIndex.value = Math.max(0, deepest)
    }
}, { immediate: true })

const RANKS = [
    ['Cadet', 1], ['Ensign', 3], ['Lieutenant', 6], ['Commander', 9], ['Captain', 13], ['Commodore', 17], ['Vice Admiral', 21], ['Admiral', 25]
] as const

/** Service rank follows the pilot level. */
const rank = computed(() => {
    const level = props.state.pilot.level
    let index = 0
    for (let i = 0; i < RANKS.length; i++) if (level >= RANKS[i]![1]) index = i
    return { name: RANKS[index]![0], progress: props.state.pilot.progress }
})

/** The cheapest next hull the pilot can work toward, and what they are short of. */
/**
 * A short, guided path through tier 1 for new pilots. Each step is read off
 * the saved state, so it ticks itself off whatever order it happens in.
 */
const firstSteps = computed(() => {
    const s = props.state
    const steps = [
        { text: 'Fly your first run and dock', hint: 'Press Launch. The flight guide walks you through the controls one step at a time.', done: s.extractions >= 1, tab: null },
        { text: 'Spend a skill point', hint: 'Skills: pick a node in your pilot skill tree. Every few pilot levels adds a point.', done: s.pilot.points < 1 || s.skills.some(k => k.nodesAllocated.length > 0), tab: 'skills' },
        { text: 'Craft a new item', hint: 'Workshop, Craft: pick what to build, a model and T1, then Craft. Rarity is random.', done: s.items.length > 6 || s.items.some(i => i.rarity > 0), tab: 'workshop:craft' },
        { text: 'Fit your best gear', hint: 'Loadout: click a hardpoint, then the item with the green score.', done: s.items.some(i => i.level >= 1 || i.rarity > 0) && s.ships.some(sh => sh.owned && [sh.fit.gun, ...sh.fit.turrets].some(id => s.items.find(i => i.id === id && (i.level >= 1 || i.rarity > 0)))), tab: 'fitting' },
        { text: 'Install a ship system', hint: 'Station: Cargo Systems Mk I fits more loot in every run.', done: s.upgrades.some(u => u.level >= 1), tab: 'station' },
        { text: 'Build your second hull', hint: 'Pick the Wasp or the Mule in the hangar bay on the right, then Build. Both only need sector 1 materials.', done: s.ships.filter(sh => sh.owned).length >= 2, tab: null },
        { text: 'Destroy the Halcyon Warden and dock', hint: 'Follow the red skull marker. Bring your best fit and some Repair Nanites.', done: s.highestSectorCleared >= 1, tab: 'fitting' },
        { text: 'Craft your first T2 gear', hint: 'Clearing a sector unlocks the next gear tier in Workshop, Craft.', done: s.items.some(i => i.tier >= 2), tab: 'workshop:craft' }
    ]
    const done = steps.filter(x => x.done).length
    if (done === steps.length) return null
    const current = steps.find(x => !x.done)!
    const index = steps.indexOf(current)
    // Gentle: the step just done, the one to do now and a peek at the next.
    return { steps, done, current, visible: steps.slice(Math.max(0, index - 1), index + 2) }
})

/** Average tier of the gear fitted to the equipped hull (0 with nothing fitted). */
const gearTier = computed(() => {
    const f = equipped.value.fit
    const ids = [f.gun, ...f.turrets, ...f.armor, ...f.shields].filter((id): id is string => !!id)
    const tiers = ids.map(id => props.state.items.find(i => i.id === id)?.tier ?? 0)
    return tiers.length ? tiers.reduce((a, b) => a + b, 0) / tiers.length : 0
})

const nextGoal = computed(() => {
    const s = props.state
    // New tier open and the ship still flies older gear: that is the next step.
    if (gearTier.value > 0 && gearTier.value < s.crafting.maxTier - 0.5) {
        return { title: `Craft T${s.crafting.maxTier} gear in the Workshop`, missing: [] as { id: string, name: string, hex: string, amount: number }[] }
    }
    const target = s.ships.find(ship => !ship.owned && ship.unlocked)
    if (!target) {
        const locked = s.ships.find(ship => !ship.owned)
        if (!locked) return null
        return { title: `Clear sector ${locked.requiresSector} to unlock the ${locked.name}`, missing: [] as { id: string, name: string, hex: string, amount: number }[] }
    }
    const held = s.resources as Record<string, number>
    const missing = Object.entries(target.cost as Record<string, number>)
        .map(([id, amount]) => ({ id, name: resName(id), hex: resHex(id), amount: amount - (held[id] ?? 0) }))
        .filter(m => m.amount > 0)
    return { title: `Build the ${target.name}`, missing }
})

const currentSector = computed(() => props.state.sectors[sectorIndex.value] ?? props.state.sectors[0]!)
const equipped = computed(() => props.state.ships.find(s => s.equipped) ?? props.state.ships[0]!)
const shown = computed(() => props.state.ships.find(s => s.id === (props.previewShipId ?? props.state.equippedShipId)) ?? equipped.value)
const ownedCount = computed(() => props.state.ships.filter(s => s.owned).length)

/**
 * The shipyard spec sheet: bare frame against bare frame. Gear is deliberately
 * left out, or an empty new hull would look weaker than the fitted one you fly
 * and nobody would ever buy it.
 */
const shownSpec = computed(() => {
    const a = voidShip(shown.value.id)
    const b = voidShip(props.state.equippedShipId)
    const rows = [
        { label: 'Hull', key: 'hull', value: a.hull, base: b.hull, round: 0 },
        { label: 'Shield', key: 'shield', value: a.shield, base: b.shield, round: 0 },
        { label: 'Speed', key: 'speed', value: a.speed, base: b.speed, round: 0 },
        { label: 'Agility', key: 'agility', value: a.agility, base: b.agility, round: 1 },
        { label: 'Cargo', key: 'cargo', value: a.cargo, base: b.cargo, round: 0 },
        { label: 'Turrets', key: 'turrets', value: a.turrets, base: b.turrets, round: 0 },
        { label: 'Armour', key: 'armor', value: a.armor, base: b.armor, round: 0 },
        { label: 'Shields', key: 'shields', value: a.shields, base: b.shields, round: 0 }
    ]
    const text = (v: number, round: number) => (round ? v.toFixed(round) : formatNumber(Math.round(v), v >= 10_000))
    return rows.map((r) => {
        const delta = r.value - r.base
        // Bars run against the best hull in the game, so every ship reads on one scale.
        const best = Math.max(...VOID_SHIPS.map(sh => Number(sh[r.key as keyof typeof sh]) || 0))
        return {
            label: r.label,
            value: text(r.value, r.round),
            baseText: text(r.base, r.round),
            pct: best > 0 ? r.value / best : 0,
            basePct: best > 0 ? r.base / best : 0,
            delta: shown.value.id === props.state.equippedShipId ? 0 : delta,
            deltaText: text(Math.abs(delta), r.round)
        }
    })
})
const storesValue = computed(() => props.state.resourceCatalog.reduce((sum, r) => sum + held(r.id) * props.state.prices[r.id], 0))

const workshopView = ref<WorkshopView>('gear')

/** `workshop:craft` opens a tab at a specific view. */
function setTab(id: string) {
    const [main, sub] = id.split(':') as [string, string | undefined]
    tab.value = main
    if (main === 'workshop' && sub) workshopView.value = sub as WorkshopView
    emit('tab', main)
    emit('sound', 'ui')
}

// A fresh craft is highlighted in My gear, but the Craft view stays open so
// a pilot building several items in a row is not thrown out of the form.

const now = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
    clockTimer = setInterval(() => {
        now.value = Date.now()
    }, 30_000)
})
onBeforeUnmount(() => clearInterval(clockTimer))

const resetIn = computed(() => {
    const ms = Math.max(0, new Date(props.state.contractsReset).getTime() - now.value)
    const h = Math.floor(ms / 3_600_000)
    const m = Math.floor(ms / 60_000) % 60
    return h > 0 ? `${h}h ${m}m` : `${m}m`
})

function held(id: string) {
    return (props.state.resources as Record<string, number>)[id] ?? 0
}

function hex(color: number | undefined) {
    return voidHex(color ?? 0)
}

function resHex(id: string) {
    return voidHex(voidResource(id).color)
}

function resName(id: string) {
    return voidResource(id as VoidResourceId).name
}

function abilityName(id: string | null) {
    if (!id) return ''
    return VOID_ABILITIES[id as VoidAbilityId]?.name ?? id
}

function abilityText(id: string | null) {
    if (!id) return ''
    return VOID_ABILITIES[id as VoidAbilityId]?.description ?? ''
}

function shipName(id: string) {
    return voidShip(id).name
}

function clock(ms: number) {
    const s = Math.floor(ms / 1000)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Put a hull on the showroom pad, beside the bay list it was picked from. */
function viewShip(id: string) {
    emit('preview', id === props.state.equippedShipId ? null : id)
    emit('sound', 'ui')
}

/** Esc closes a page and returns to the hangar, unless the browser is using it. */
function onKey(e: KeyboardEvent) {
    if (e.code !== 'Escape' || tab.value === 'hangar' || e.defaultPrevented) return
    // Esc belongs to the field, the overlay or fullscreen first.
    const target = e.target as HTMLElement | null
    if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return
    if (document.fullscreenElement) return
    setTab('hangar')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function stepSector(delta: number) {
    const next = sectorIndex.value + delta
    if (next < 0 || next >= props.state.sectors.length || !props.state.sectors[next]!.unlocked) return
    sectorIndex.value = next
    emit('sound', 'ui')
}
</script>

<style>
.vh { position: absolute; inset: 0; pointer-events: none; }
.vh > * { pointer-events: auto; }

.vh-top { position: absolute; left: 0; right: 0; top: 0; display: flex; align-items: center; gap: 22px; padding: 14px 22px; background: linear-gradient(180deg, rgba(2, 5, 12, 0.85), rgba(2, 5, 12, 0)); }
.vh-leave { display: flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 600; letter-spacing: 0.15em; text-transform: uppercase; color: var(--vr-muted); transition: color 0.15s; }
.vh-leave:hover { color: var(--vr-text); }
.vh-brand { font-size: 20px; font-weight: 700; letter-spacing: 0.4em; white-space: nowrap; }
.vh-brand span { color: var(--vr-accent); margin-left: 0.25em; }
.vh-tabs { display: flex; gap: 2px; }
.vh-tab { display: flex; align-items: center; gap: 7px; padding: 8px 10px; white-space: nowrap; font-size: 13px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--vr-muted); border-bottom: 2px solid transparent; transition: all 0.15s; cursor: pointer; }
.vh-tab:hover { color: var(--vr-text); }
.vh-tab-on { color: #fff; border-color: var(--vr-accent); text-shadow: 0 0 12px rgba(94, 200, 255, 0.6); }
.vh-mute { margin-left: auto; display: grid; place-items: center; width: 30px; height: 30px; color: var(--vr-muted); border: 1px solid var(--vr-line); cursor: pointer; }
.vh-mute:hover { color: var(--vr-text); border-color: var(--vr-line-strong); }
.vh-fullscreen { margin-left: -14px; }
.vh-pilot { margin-left: 12px; display: flex; align-items: center; gap: 9px; }
.vh-pilot-badge { display: grid; place-items: center; width: 30px; height: 30px; font: 700 14px 'Rajdhani', sans-serif; color: var(--vr-gold); border: 1px solid rgba(255, 210, 122, 0.5); clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%); background: rgba(255, 210, 122, 0.1); }
.vh-pilot-name { font-size: 12px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; white-space: nowrap; }
.vh-pilot-bar { width: 90px; height: 2px; margin-top: 3px; background: rgba(255, 255, 255, 0.1); }
.vh-pilot-bar div { height: 100%; background: var(--vr-gold); }
.vh-wallet { margin-left: 14px; display: flex; align-items: center; gap: 14px; }
.vh-coins { display: flex; align-items: center; gap: 6px; padding: 5px 12px; border: 1px solid rgba(255, 210, 122, 0.35); color: var(--vr-gold); font: 600 14px 'JetBrains Mono', monospace; }
.vh-gems { border-color: rgba(196, 155, 255, 0.4); color: #d7b8ff; }
.vh-res { display: flex; gap: 10px; }
.vh-res-chip { display: flex; align-items: center; gap: 6px; font: 600 13px 'JetBrains Mono', monospace; }
.vh-dim { opacity: 0.4; }

.vh-title { position: absolute; left: 30px; top: 92px; bottom: 132px; width: min(420px, 34vw); display: flex; flex-direction: column; align-items: flex-start; overflow: hidden; pointer-events: none; }
.vh-title-role { font-size: 13px; font-weight: 700; letter-spacing: 0.4em; text-transform: uppercase; color: var(--vr-accent); }
.vh-title-name { font-size: clamp(44px, 6vw, 76px); line-height: 0.95; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; text-shadow: 0 0 40px rgba(94, 200, 255, 0.25); }
.vh-title-desc { margin-top: 10px; font-size: 16px; line-height: 1.35; color: rgba(230, 241, 255, 0.75); }
.vh-title-stats { display: flex; gap: 22px; margin-top: 16px; }
.vh-title-stats span { display: block; font-size: 10px; letter-spacing: 0.3em; text-transform: uppercase; color: var(--vr-muted); }
.vh-title-stats b { font-size: 20px; font-weight: 700; }
.vh-title-cta { margin-top: 16px; pointer-events: auto; }
.vh-steps { margin-top: auto; padding: 10px 12px; max-width: 380px; display: grid; gap: 4px; background: linear-gradient(90deg, rgba(255, 210, 122, 0.1), transparent); border-left: 2px solid var(--vr-gold); pointer-events: auto; }
.vh-step { display: flex; align-items: flex-start; gap: 9px; padding: 3px 0; text-align: left; color: rgba(230, 241, 255, 0.55); cursor: pointer; }
.vh-step i { width: 9px; height: 9px; margin-top: 5px; border: 1.5px solid currentColor; transform: rotate(45deg); flex-shrink: 0; }
.vh-step b { display: block; font-size: 14px; font-weight: 700; letter-spacing: 0.04em; }
.vh-step small { display: block; margin-top: 1px; font-size: 12px; line-height: 1.3; color: rgba(230, 241, 255, 0.72); }
.vh-step-now { color: #fff; }
.vh-step-now i { border-color: var(--vr-gold); box-shadow: 0 0 8px rgba(255, 210, 122, 0.7); animation: vr-pulse 1.2s infinite; }
.vh-step-done { color: var(--vr-good); }
.vh-step-done b { text-decoration: line-through; text-decoration-color: rgba(61, 255, 176, 0.5); }
.vh-step-done i { background: var(--vr-good); }
.vh-goal { margin-top: auto; padding: 10px 14px; max-width: 360px; background: linear-gradient(90deg, rgba(255, 210, 122, 0.1), transparent); border-left: 2px solid var(--vr-gold); }
.vh-goal-kicker { font-size: 10px; font-weight: 700; letter-spacing: 0.35em; text-transform: uppercase; color: var(--vr-gold); }
.vh-goal-title { font-size: 17px; font-weight: 700; letter-spacing: 0.06em; }
.vh-goal-need { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 4px; font-size: 13px; color: rgba(230, 241, 255, 0.75); }
.vh-goal-need span { display: inline-flex; align-items: center; gap: 6px; }
.vh-goal-ready { color: var(--vr-good); font-weight: 700; }

.vh-launch { position: absolute; left: 30px; bottom: 30px; display: flex; align-items: stretch; gap: 8px; }
.vh-arrow { display: grid; place-items: center; width: 34px; border: 1px solid var(--vr-line); background: var(--vr-bg); color: var(--vr-text); cursor: pointer; }
.vh-arrow:disabled { opacity: 0.25; cursor: default; }
.vh-sector { position: relative; width: 300px; padding: 10px 16px; overflow: hidden; background: linear-gradient(120deg, color-mix(in srgb, var(--s1) 40%, transparent), rgba(6, 12, 24, 0.85) 70%); border: 1px solid color-mix(in srgb, var(--s2) 45%, transparent); }
.vh-sector-tier { font-size: 11px; font-weight: 700; letter-spacing: 0.35em; text-transform: uppercase; color: var(--s2); }
.vh-sector-name { font-size: 24px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
.vh-sector-ores { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
.vh-undergeared { margin-left: auto; font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--vr-warn); animation: vr-pulse 1.4s infinite; }
.vh-undergeared + .vh-threat { margin-left: 8px; }
.vh-threat { margin-left: auto; font: 600 11px 'JetBrains Mono', monospace; color: var(--vr-muted); }
.vh-go { display: flex; flex-direction: column; justify-content: center; padding: 0 34px; background: linear-gradient(100deg, #1b8fd6, #19c98c); color: #fff; clip-path: polygon(14px 0, 100% 0, calc(100% - 14px) 100%, 0 100%); cursor: pointer; transition: filter 0.15s, transform 0.1s; box-shadow: 0 0 30px rgba(61, 200, 255, 0.35); }
.vh-go span { font-size: 26px; font-weight: 700; letter-spacing: 0.3em; text-transform: uppercase; }
.vh-go small { font-size: 11px; letter-spacing: 0.25em; text-transform: uppercase; opacity: 0.8; }
.vh-go:hover:not(:disabled) { filter: brightness(1.15); }
.vh-go:active:not(:disabled) { transform: translateY(1px); }
.vh-go:disabled { filter: grayscale(0.8) brightness(0.6); cursor: not-allowed; }

.vh-spec { margin-top: 16px; max-width: 360px; padding: 10px 14px; background: linear-gradient(90deg, rgba(94, 200, 255, 0.08), transparent); border-left: 2px solid var(--vr-accent); pointer-events: auto; }
.vh-spec-row { display: grid; grid-template-columns: 74px minmax(60px, 1fr) 54px 46px; align-items: center; gap: 10px; padding: 3px 0; }
.vh-spec-bar { position: relative; height: 5px; background: rgba(255, 255, 255, 0.08); }
.vh-spec-fill { height: 100%; background: linear-gradient(90deg, rgba(94, 200, 255, 0.55), var(--vr-accent)); box-shadow: 0 0 10px rgba(94, 200, 255, 0.35); transition: width 0.25s ease-out; }
.vh-spec-mark { position: absolute; top: -3px; width: 2px; height: 11px; background: var(--vr-gold); transform: translateX(-1px); }
.vh-spec-row span { font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: var(--vr-muted); }
.vh-spec-row b { font: 600 14px 'JetBrains Mono', monospace; text-align: right; }
.vh-spec-row i { font: 600 12px 'JetBrains Mono', monospace; font-style: normal; text-align: right; }
.vh-up { color: var(--vr-good); }
.vh-down { color: var(--vr-bad); }
.vh-spec-note { margin-top: 6px; font-size: 11px; line-height: 1.3; color: var(--vr-muted); }

.vh-yard { position: absolute; right: 0; top: 60px; bottom: 0; width: min(380px, 32vw); display: flex; flex-direction: column; background: linear-gradient(270deg, rgba(4, 9, 18, 0.96), rgba(4, 9, 18, 0.82)); border-left: 1px solid var(--vr-line); animation: vh-yard-in 0.2s ease-out; }
@keyframes vh-yard-in { from { opacity: 0; transform: translateX(14px); } }
.vh-yard-head { display: flex; align-items: center; gap: 12px; padding: 16px 18px 12px; border-bottom: 1px solid var(--vr-line); }
.vh-yard-head h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; line-height: 1.1; }
.vh-yard-head p { margin: 1px 0 0; font-size: 12px; color: var(--vr-muted); }
.vh-yard-list { flex: 1; min-height: 0; overflow-y: auto; padding: 10px; display: grid; gap: 6px; align-content: start; scrollbar-width: thin; scrollbar-color: rgba(120, 190, 255, 0.25) transparent; }
.vh-yard-ship { display: block; width: 100%; text-align: left; padding: 9px 12px; background: rgba(255, 255, 255, 0.025); border: 1px solid var(--vr-line); border-left: 2px solid transparent; cursor: pointer; transition: all 0.15s; }
.vh-yard-ship:hover { background: rgba(255, 255, 255, 0.05); border-color: var(--vr-line-strong); }
.vh-yard-ship.vh-sel { background: rgba(94, 200, 255, 0.1); border-color: rgba(94, 200, 255, 0.4); border-left-color: var(--vr-accent); }
.vh-yard-ship.vh-locked { opacity: 0.55; }
.vh-yard-ship-head { display: flex; align-items: center; gap: 8px; }
.vh-yard-ship-head b { font-size: 16px; font-weight: 700; letter-spacing: 0.06em; }
.vh-yard-ship-head .vh-tag { margin-left: auto; }
.vh-yard-ship-sub { display: flex; justify-content: space-between; gap: 10px; margin-top: 2px; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--vr-muted); }
.vh-yard-ship-sub span:last-child { font-family: 'JetBrains Mono', monospace; letter-spacing: 0; }
.vh-yard-foot { display: grid; gap: 10px; padding: 14px 16px 18px; border-top: 1px solid var(--vr-line); background: rgba(2, 6, 14, 0.6); }
.vh-yard-foot .vr-btn { justify-content: center; }
.vh-yard-state { font-size: 12px; color: var(--vr-muted); }
.vh-yard-locked { color: var(--vr-warn); }

.vh-page { position: absolute; left: 0; right: 0; top: 60px; bottom: 0; overflow-x: hidden; overflow-y: auto; background: linear-gradient(180deg, #050a14, #03070f); border-top: 1px solid var(--vr-line); scrollbar-width: thin; scrollbar-color: rgba(120, 190, 255, 0.25) transparent; animation: vh-page-in 0.2s ease-out; }
@keyframes vh-page-in { from { opacity: 0; transform: translateY(8px); } }
.vh-page-inner { max-width: 1480px; margin: 0 auto; padding: 20px 32px 60px; }
.vh-page-head { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; margin-bottom: 16px; padding-bottom: 14px; border-bottom: 1px solid var(--vr-line); }
.vh-back { display: flex; align-items: center; gap: 6px; padding: 8px 12px; font-size: 12px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: var(--vr-muted); border: 1px solid var(--vr-line); cursor: pointer; transition: all 0.15s; }
.vh-back:hover { color: var(--vr-text); border-color: var(--vr-line-strong); }
.vh-page-title { flex: 1; min-width: 240px; }
.vh-page-title h1 { margin: 0; font-size: 30px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; line-height: 1.1; }
.vh-page-title p { margin: 2px 0 0; font-size: 14px; color: rgba(230, 241, 255, 0.7); }
.vh-page-launch { padding: 10px 18px; }
.vh-page .vh-list { grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); }
.vh-page .vw-views { top: -20px; margin: -20px 0 12px; padding: 20px 0 10px; }
.vh-page .vw-craft { max-width: 760px; }
.vh-page .vw-mods { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.vh-page .vh-manual { max-width: 900px; }
.vh-page .vh-table { max-width: 900px; }
.vh-page .vh-record { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); max-width: 900px; }
.vh-supply-icon { color: var(--c); }
.vh-h { display: flex; align-items: baseline; gap: 10px; margin: 16px 0 10px; font-size: 14px; font-weight: 700; letter-spacing: 0.3em; text-transform: uppercase; }
.vh-h small { font-size: 11px; letter-spacing: 0.12em; color: var(--vr-muted); text-transform: none; }
.vh-list { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; align-items: start; }
.vh-card { position: relative; display: block; width: 100%; text-align: left; padding: 10px 12px; background: rgba(255, 255, 255, 0.025); border: 1px solid var(--vr-line); transition: border-color 0.15s, background 0.15s; }
.vh-card:hover { border-color: var(--vr-line-strong); background: rgba(255, 255, 255, 0.045); }
.vh-card p { margin: 4px 0 6px; font-size: 13px; line-height: 1.3; color: rgba(230, 241, 255, 0.65); }
.vh-card-head { display: flex; align-items: center; gap: 8px; font-size: 16px; }
.vh-card-head b { font-weight: 700; letter-spacing: 0.06em; }
.vh-card-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 10px; margin-top: 8px; }
.vh-kv { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: var(--vr-muted); }
.vh-kv b { color: var(--vr-text); font-family: 'JetBrains Mono', monospace; font-weight: 600; }
.vh-tag { margin-left: auto; padding: 1px 8px; font-size: 10px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; border: 1px solid var(--vr-line-strong); color: var(--vr-muted); white-space: nowrap; }
.vh-tag-good { border-color: rgba(61, 255, 176, 0.5); color: var(--vr-good); }
.vh-tag-bad { border-color: rgba(255, 79, 109, 0.4); color: #ff9aac; }
.vh-sel { border-color: var(--vr-accent) !important; box-shadow: inset 2px 0 0 var(--vr-accent); }
.vh-locked { opacity: 0.55; }
.vh-dotc { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--c); box-shadow: 0 0 8px var(--c); }

.vh-slots { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.vh-slot { position: relative; }
.vh-slot-btn { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--vr-line); border-left: 3px solid var(--c); cursor: pointer; transition: background 0.15s; }
.vh-slot-btn:hover, .vh-slot-open .vh-slot-btn { background: rgba(255, 255, 255, 0.07); }
.vh-slot-n { font: 600 11px 'JetBrains Mono', monospace; color: var(--vr-muted); }
.vh-slot-name { font-size: 14px; font-weight: 600; }
.vh-slot-menu { position: absolute; z-index: 5; left: 0; right: 0; top: calc(100% + 2px); display: grid; background: #081120; border: 1px solid var(--vr-line-strong); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); }
.vh-slot-menu button { display: flex; align-items: center; gap: 8px; padding: 7px 10px; text-align: left; font-size: 13px; font-weight: 600; cursor: pointer; }
.vh-slot-menu button:hover { background: rgba(255, 255, 255, 0.06); }
.vh-slot-menu .vh-on { color: var(--c); }
.vh-slot-menu .vh-dotc { width: 6px; height: 6px; }
.vh-fill { margin-top: 8px; }

.vh-stats { display: grid; gap: 6px; }
.vh-stat { display: grid; grid-template-columns: 76px 1fr 64px; align-items: center; gap: 10px; font-size: 13px; }
.vh-stat span { color: var(--vr-muted); }
.vh-stat b { text-align: right; font: 600 12px 'JetBrains Mono', monospace; }
.vh-stat-bar { height: 4px; background: rgba(255, 255, 255, 0.06); }
.vh-stat-bar div { height: 100%; background: linear-gradient(90deg, var(--vr-accent), var(--vr-good)); }

.vh-lvl { margin-left: auto; font: 600 12px 'JetBrains Mono', monospace; color: var(--vr-muted); }
.vh-pips { display: flex; gap: 3px; margin: 6px 0; }
.vh-pips i { flex: 1; height: 4px; background: rgba(255, 255, 255, 0.08); }
.vh-pips .vh-pip-on { background: var(--vr-accent); box-shadow: 0 0 6px rgba(94, 200, 255, 0.6); }
.vh-upg-effect { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--vr-muted); }
.vh-upg-effect b { color: var(--vr-good); font-weight: 600; }
.vh-maxed { margin-top: 6px; font-size: 11px; letter-spacing: 0.25em; text-transform: uppercase; color: var(--vr-gold); }

.vh-price { margin-left: auto; font: 600 12px 'JetBrains Mono', monospace; color: var(--vr-gold); }
.vh-held { font-size: 12px; color: var(--vr-muted); font-family: 'JetBrains Mono', monospace; }
.vh-sell { display: flex; gap: 6px; }
.vh-total { margin-top: 14px; text-align: right; font-size: 14px; color: var(--vr-muted); }
.vh-total b { color: var(--vr-gold); font-family: 'JetBrains Mono', monospace; }

.vh-sector-card { cursor: pointer; background: linear-gradient(110deg, color-mix(in srgb, var(--s1) 35%, transparent), rgba(255, 255, 255, 0.02) 65%); }
.vh-sector-card:disabled { cursor: not-allowed; }
.vh-tier { display: grid; place-items: center; width: 22px; height: 22px; font: 700 12px 'JetBrains Mono', monospace; color: var(--s2); border: 1px solid var(--s2); }
.vh-ores { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 6px; font-size: 12px; }
.vh-ores span { display: flex; align-items: center; gap: 6px; }
.vh-hint { margin-top: 10px; font-size: 13px; color: var(--vr-muted); }
.vh-manual { display: grid; gap: 8px; font-size: 14px; line-height: 1.4; color: rgba(230, 241, 255, 0.78); }
.vh-manual b { color: #fff; }

.vh-record { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.vh-record div { padding: 8px 10px; border: 1px solid var(--vr-line); background: rgba(255, 255, 255, 0.02); }
.vh-record span { display: block; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--vr-muted); }
.vh-record b { font: 600 16px 'JetBrains Mono', monospace; }
.vh-table { display: grid; gap: 2px; }
.vh-row { display: grid; grid-template-columns: 26px 1fr 34px 70px; align-items: center; gap: 8px; padding: 6px 8px; font-size: 13px; background: rgba(255, 255, 255, 0.02); }
.vh-row b { text-align: right; font: 600 12px 'JetBrains Mono', monospace; color: var(--vr-gold); }
.vh-me { box-shadow: inset 2px 0 0 var(--vr-accent); background: rgba(94, 200, 255, 0.08); }
.vh-rank { font: 600 12px 'JetBrains Mono', monospace; color: var(--vr-muted); }
.vh-who small { display: block; font-size: 11px; color: var(--vr-muted); }
.vh-ok { color: var(--vr-good); }
.vh-ko { color: var(--vr-bad); }

.vh-guns { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px; }
.vh-gun { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 7px 9px; text-align: left; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--vr-line); border-top: 2px solid var(--c); cursor: pointer; transition: background 0.15s; }
.vh-gun:hover { background: rgba(255, 255, 255, 0.07); }
.vh-gun span { font-size: 13px; font-weight: 700; line-height: 1.1; }
.vh-gun small { font: 600 10px 'JetBrains Mono', monospace; color: var(--vr-muted); }
.vh-gun .vh-dotc { width: 6px; height: 6px; }
.vh-gun-on { background: color-mix(in srgb, var(--c) 14%, transparent); box-shadow: inset 0 0 0 1px var(--c); }
.vh-gun-card { margin-top: 8px; }

/* Laptop widths: the top bar compacts in steps so nothing runs off screen. */
@media (max-width: 1850px) {
    .vh-res { display: none; }
    .vh-top { gap: 14px; }
}
@media (max-width: 1650px) {
    .vh-pilot-name, .vh-pilot-bar { display: none; }
    .vh-pilot { margin-left: 4px; }
    .vh-brand { font-size: 17px; letter-spacing: 0.28em; }
    .vh-tab { padding: 8px 7px; gap: 5px; font-size: 12px; letter-spacing: 0.08em; }
    .vh-wallet { margin-left: 4px; gap: 8px; }
    .vh-coins { padding: 4px 9px; font-size: 13px; }
}
@media (max-width: 1480px) {
    .vh-leave-label { display: none; }
    .vh-tab { padding: 8px 6px; gap: 4px; font-size: 11px; letter-spacing: 0.06em; }
    .vh-gems { display: none; }
}
@media (max-width: 1240px) {
    .vh-tab-label { display: none; }
    .vh-tab { padding: 8px 9px; }
}
@media (max-width: 1100px) {
    .vh-res { display: none; }
    .vh-tab-label { display: none; }
    .vh-title { display: none; }
}
</style>
