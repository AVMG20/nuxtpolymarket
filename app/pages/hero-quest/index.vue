<script setup lang="ts">
import { formatHq, formatSeconds } from '#shared/utils/hero-quest/numbers'

const {
    initialized, run, hero, settled, pending, guild,
    engageBoss
} = useHeroQuest()

/**
 * The battle screen draws the *projected* run, not the payload.
 *
 * The server settles lazily and this page polls it once a minute, so `run` and `hero` are a
 * minute-old photograph. `useHqLiveRun` walks both forward at the server's own rate — position,
 * kills, level and XP — so the stage counter rolls over into the next stage, the world changes,
 * and the XP bar fills continuously instead of jumping once a minute. Server truth still lands
 * every poll and overwrites all of it; nothing projected is ever sent back.
 *
 * `run`/`hero` stay in scope deliberately: `liveHero` is the right thing to *show* and the wrong
 * thing to compare a payload against, so anything that needs the anchor still has it.
 */
const { liveRun, liveHero } = useHqLiveRun(run, hero)

/**
 * Who stands on the stage: the Hero and the Champions fielded, in party order, each on its row.
 * Off the guild payload, so it changes with the next payload after an equip.
 */
const party = computed(() => {
    const g = guild.value
    // each unit's kit on its live cooldowns, so skills cast when the fight would cast them
    const kits = hero.value?.kits
    if (!g) return { heroRow: 'front' as const, champions: [], kits }
    const byId = new Map(g.roster.map(c => [c.id, c]))
    return {
        heroRow: g.heroRow,
        kits,
        champions: g.partyChampionIds.flatMap((id) => {
            const c = byId.get(id)
            return c ? [{ id, row: c.row, level: c.level }] : []
        })
    }
})

/** The stat-attribution slideover. Fetched on open, never with the state payload. */
const breakdownOpen = ref(false)

const fight = ref<Awaited<ReturnType<typeof engageBoss>>>(null)
const engaging = ref(false)
/** Which of the two paths opened the replay — only an automatic one dismisses itself. */
const fightWasAutomatic = ref(false)

/**
 * The boss's name and timer, taken as the fight is engaged: the payload that lands with the
 * result has already moved the run past the gate, so `liveRun` names the next stage's foes.
 */
const fightBoss = ref({ name: 'Boss', timer: 30 })
/** How far the stage has played the fight, and whether its result is up. */
const fightProgress = ref({ time: 0, done: false })
const battleCanvas = ref<{ skipFight: () => void } | null>(null)

async function runFightAt(automatic: boolean) {
    engaging.value = true
    try {
        const boss = { name: liveRun.value?.enemyName ?? 'Boss', timer: liveRun.value?.bossTimerSeconds ?? 30 }
        const result = await engageBoss({ silentErrors: automatic })
        fightWasAutomatic.value = automatic
        fightBoss.value = boss
        fightProgress.value = { time: 0, done: false }
        fight.value = result
    } finally {
        engaging.value = false
    }
}

const onEngage = () => runFightAt(false)

/**
 * Bosses fire on their own while the tab is visible.
 *
 * Visibility is the presence check, and it is the same presence the refresh interval already
 * demonstrates — a backgrounded or closed tab still never engages one, so "a boss requires the
 * player to be present" is unchanged. `shouldAutoEngage` holds the rest of the rules, including
 * the one that stops a cleared run re-fighting the World 10 super boss forever.
 *
 * Driven off `liveRun`, not `run`, so it fires when the *screen* reaches the gate rather than up
 * to a minute later when the next poll lands. That is also why an engage can arrive before the
 * server has settled that far, which `useHqAutoBoss` retries rather than surfaces.
 */
useHqAutoBoss({
    atBossGate: () => liveRun.value?.atBossGate ?? false,
    runCleared: () => liveRun.value?.runCleared ?? false,
    secondsPerKill: () => liveRun.value?.secondsPerKill ?? null,
    engaging: () => engaging.value,
    replayOpen: () => fight.value !== null,
    engage: () => runFightAt(true)
})

/**
 * The four headline stats, paired with the glossary entry that explains each.
 *
 * The screen shows *derived* values — Health rather than Vitality, Crit rather than Luck — so the
 * pairing is explicit rather than a key lookup: a player reading "Health" wants to be told about
 * the stat that produces it.
 */
const statTiles = computed(() => {
    const stats = liveHero.value?.stats
    if (!stats) return []
    return [
        { label: 'Power', value: formatHq(stats.pwr), doc: HQ_STAT_DOC_BY_KEY.pwr! },
        { label: 'Defence', value: formatHq(stats.def), doc: HQ_STAT_DOC_BY_KEY.def! },
        { label: 'Health', value: formatHq(stats.maxHp), doc: HQ_STAT_DOC_BY_KEY.vit! },
        { label: 'Crit', value: `${Math.round(stats.critChance * 100)}%`, doc: HQ_STAT_DOC_BY_KEY.lck! }
    ]
})

/**
 * Only worth showing when the player was actually away — an online settle covers ~60s and
 * banking three kills is not news.
 */
const awayReport = computed(() => {
    const report = settled.value
    if (!report || report.online || report.kills <= 0) return null
    return report
})
</script>

<template>
  <div class="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
    <div
      v-if="pending && !run"
      class="text-center py-16 text-muted"
    >
      Loading…
    </div>

    <!-- Founding is explicit, on the splash (`HeroQuestSplash`), so a run never starts behind the player's back. -->
    <template v-else-if="initialized && liveRun && liveHero">
      <UAlert
        v-if="awayReport"
        color="primary"
        variant="subtle"
        icon="i-lucide-moon"
        title="While you were away"
        :description="`${formatNumber(awayReport.kills)} kills over ${formatSeconds(awayReport.effectiveSeconds)} of counted time — ${formatNumber(awayReport.goldEarned)} gold`
          + (awayReport.levelsGained > 0 ? `, ${awayReport.levelsGained} level${awayReport.levelsGained === 1 ? '' : 's'}` : '')
          + (awayReport.blockedAtBoss ? '. Your run is parked at a boss.' : '.')"
      />

      <HeroQuestRunPosition :run="liveRun" />

      <HeroQuestBattleCanvas
        ref="battleCanvas"
        :run="liveRun"
        :hero="liveHero"
        :party="party"
        :fight="fight"
        @fight-progress="fightProgress = $event"
      />

      <!-- A boss fight takes the readout's place while the stage plays it. -->
      <HeroQuestBossFightPanel
        v-if="fight"
        :fight="fight"
        :enemy-name="fightBoss.name"
        :boss-timer-seconds="fightBoss.timer"
        :time="fightProgress.time"
        :done="fightProgress.done"
        :auto-close="fightWasAutomatic"
        @skip="battleCanvas?.skipFight()"
        @close="fight = null"
      />

      <HeroQuestBattleView
        v-else
        :run="liveRun"
        :hero="liveHero"
      />

      <!--
        Not on a cleared run: the World 10 super boss stays parked on its gate after it falls, and
        the server rejects a re-fight there. The battle view already points the player at prestige.
      -->
      <div
        v-if="liveRun.atBossGate && !liveRun.runCleared && !fight"
        class="flex justify-center"
      >
        <UButton
          size="lg"
          color="error"
          icon="i-lucide-swords"
          :loading="engaging"
          @click="onEngage"
        >
          Fight {{ liveRun.enemyName }}
        </UButton>
      </div>

      <div class="rounded-lg border border-default bg-elevated/40 p-4">
        <div class="flex items-center justify-between mb-3">
          <span class="font-medium text-highlighted">{{ liveHero.className }}</span>
          <span class="text-sm text-muted">Level {{ liveHero.level }}</span>
        </div>

        <!--
          The payload's power, not a projection: it needs the full snapshot, which only the
          server has. It moves when the next payload lands — every poll, pull, equip and level
          the server has settled.
        -->
        <HeroQuestGlobalPower
          v-if="hero?.power"
          class="mb-4"
          :gpn="hero.power.gpn"
          :dps="hero.power.dps"
          :ehp="hero.power.ehp"
        />

        <div class="mb-4">
          <div class="flex items-center justify-between text-xs text-muted mb-1">
            <span>Experience</span>
            <span>{{ formatHq(liveHero.xp) }} / {{ formatHq(liveHero.xpToNextLevel) }}</span>
          </div>
          <UProgress
            :model-value="liveHero.xpProgress * 100"
            size="sm"
          />
        </div>

        <!--
          Each tile carries its own explanation (session-1 playtest, finding 6). The text comes
          from `HQ_STAT_DOCS`, the same table the wiki renders, so the tooltip and the wiki page
          can never describe a stat differently.
        -->
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs text-muted">Stats</span>
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-lucide-list-tree"
            @click="breakdownOpen = true"
          >
            Breakdown
          </UButton>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div
            v-for="tile in statTiles"
            :key="tile.label"
          >
            <div class="text-xs text-muted flex items-center gap-0.5">
              {{ tile.label }}
              <HeroQuestInfoTip
                :title="tile.doc.name"
                :body="tile.doc.short"
                :formula="tile.doc.formula"
                to="/hero-quest/wiki/combat"
              />
            </div>
            <div class="font-medium text-highlighted">
              {{ tile.value }}
            </div>
          </div>
        </div>

        <div class="mt-4 pt-3 border-t border-default">
          <p class="text-xs text-muted mb-1.5 flex items-center gap-0.5">
            Skills — every one fires the moment its cooldown ends
            <HeroQuestInfoTip
              title="Auto-cast"
              body="There is no cast button anywhere in the game. Every skill on every unit fires
                the instant its cooldown ends, so equipping one is a build decision rather than an
                input you have to keep making."
              to="/hero-quest/wiki"
            />
          </p>
          <div class="flex flex-wrap gap-1.5">
            <UBadge
              v-for="skill in liveHero.skills"
              :key="skill.id"
              color="neutral"
              variant="subtle"
            >
              {{ skill.name }}
            </UBadge>
          </div>
        </div>
      </div>
    </template>

    <HeroQuestStatBreakdown v-model:open="breakdownOpen" />

  </div>
</template>
