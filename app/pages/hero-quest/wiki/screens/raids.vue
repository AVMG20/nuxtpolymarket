<script setup lang="ts">
import { RAID_DUMMY_SECONDS, RAID_ENRAGE_SECONDS, RAID_FORGE_KILL_SECONDS, RAID_KEYS_PER_DAY } from '#shared/utils/hero-quest/constants'
import { RAIDS, paysEveryRun, type RaidFightType } from '#shared/utils/hero-quest/content/raids'
import { RAID_KEY_CAP, raidReward } from '#shared/utils/hero-quest/raids'

/**
 * The Raids screen: the five raids, Keys, levels, and the buttons. Rewards are read from
 * `raidReward`, the function that pays them, so a retuned ladder shows up here unedited.
 */

const FIGHT: Readonly<Record<RaidFightType, string>> = {
    solo_boss: `One boss, alone. Bring it down within ${RAID_ENRAGE_SECONDS} seconds.`,
    training_dummy: `A dummy that never falls and never hits back. Deal as much damage as you can in ${RAID_DUMMY_SECONDS} seconds: the damage decides the level reached.`,
    reinforced_boss: `A boss with waves of adds crawling out of burrows. Only the boss has to fall, within ${RAID_ENRAGE_SECONDS} seconds.`,
    boss_gauntlet: `Three bosses one after another on one ${RAID_ENRAGE_SECONDS}-second clock. Each kill adds ${RAID_FORGE_KILL_SECONDS} seconds.`,
    rampaging_boss: 'It cannot die. Emptying its health bar levels it up and refills it, and it hits harder the longer the fight runs. Hold out as long as you can.'
}

/** Sample levels for the reward column: enough to show the climb without a long table. */
const SAMPLE_LEVELS = [1, 10, 25, 50] as const

const raids = RAIDS.map(raid => ({
    id: raid.id,
    name: raid.name,
    fight: FIGHT[raid.fightType],
    pays: raid.reward,
    key: raid.key,
    everyRun: paysEveryRun(raid.fightType),
    rewards: SAMPLE_LEVELS.map(level => ({ level, amount: raidReward(raid.id, level) }))
}))

const list = [
    { term: 'Key icon', text: 'Each raid has its own Keys, in its own colour.' },
    { term: 'N KEYS', text: 'How many of that raid\'s Keys you hold. Red at 0.' },
    { term: 'LV n', text: 'Your best level in that raid. Gold once you have one, grey before.' },
    { term: 'Gold rim', text: 'The raid shown on the right. Press another row to switch.', tone: 'text-warning' }
]

const showcase = [
    { term: 'LV n (top right)', text: 'Boss raids only: the level the next Enter fights, one past your best.' },
    { term: 'Pays', text: 'The currency this raid pays, with its icon.' },
    { term: 'Keys / cap', text: 'Keys held, and how many the daily grant fills up to.' },
    { term: `+${RAID_KEYS_PER_DAY} every day`, text: 'The daily grant of that raid\'s Keys.' }
]

const buttons = [
    { term: 'Enter', text: 'Fights the raid, played out on the battle screen, then shows the result. Needs at least one Key.', tone: 'text-error' },
    { term: 'Quick', text: 'Spends one Key and pays your best level at once, without a fight. Needs a best level, so play a round first. It never raises your best.', tone: 'text-success' },
    { term: 'Loadout', text: 'Picks a saved Loadout to put on whenever you enter this raid, or none. Free. The label turns green while that Loadout is on, and your own setup comes back when you leave the Raids screen.', tone: 'text-info' }
]

const result = [
    { term: 'NEW BEST', text: 'This run beat your best level.', tone: 'text-success' },
    { term: '+n', text: 'What the run paid.' },
    { term: 'DEFEATED', text: 'A boss raid lost: no Key spent, nothing paid.', tone: 'text-error' },
    { term: 'Continue / OK', text: 'Back to the Raids screen.' }
]
</script>

<template>
  <div class="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
    <HeroQuestWikiScreenHeader id="raids" />

    <HeroQuestWikiSection
      title="The five raids"
      icon="i-lucide-flag"
      lead="Each pays one currency, takes its own Keys and keeps its own best level."
    >
      <div class="space-y-2">
        <div
          v-for="raid in raids"
          :key="raid.id"
          class="rounded-lg border border-default bg-elevated/40 p-3 space-y-1.5"
        >
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-medium text-highlighted">{{ raid.name }}</span>
            <UBadge
              color="neutral"
              variant="subtle"
              size="sm"
            >
              Pays {{ raid.pays }}
            </UBadge>
          </div>
          <p class="text-xs">
            {{ raid.fight }}
          </p>
          <p class="text-xs">
            <span class="text-muted/70">Key</span>
            {{ raid.everyRun ? `one ${raid.key.replace(/s$/, '')} a run, and every run pays.` : `one ${raid.key.replace(/s$/, '')}, spent only on a win.` }}
          </p>
          <p class="text-xs tabular-nums">
            <span class="text-muted/70">Pays at level</span>
            <span
              v-for="reward in raid.rewards"
              :key="reward.level"
              class="ml-2"
            >{{ reward.level }}: {{ reward.amount.toLocaleString('en-US') }}</span>
          </p>
        </div>
      </div>
      <p>
        A raid level stands for a World's depth: level 10 is as deep as World 10, and the levels go
        on past it.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Levels"
      icon="i-lucide-trending-up"
    >
      <p>
        <strong class="text-default">Boss raids</strong> (the ones that spend a Key only on a win)
        always fight one level past your best, and a win raises your best by one.
        <strong class="text-default">The other two</strong> start every run at level 1 and climb
        as far as the party gets; your best is the highest level reached. Either way, a reward is
        worth more at a higher level.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Keys"
      icon="i-lucide-key-round"
      :lead="`${RAID_KEYS_PER_DAY} of each raid's Keys arrive every day, up to ${RAID_KEY_CAP} held.`"
    >
      <p>
        Unused Keys keep, so a few days away is not wasted; past the cap the daily grant stops
        until you spend some. Keys from Milestones, the login calendar and the Arena shop can take
        you over the cap.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="The list"
      icon="i-lucide-list"
      lead="On the left, one row per raid."
    >
      <HeroQuestWikiKey :items="list" />
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="The selected raid"
      icon="i-lucide-swords"
      lead="On the right: its boss, a line on how the fight works, and its buttons."
    >
      <HeroQuestWikiKey :items="showcase" />
      <HeroQuestWikiKey :items="buttons" />
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="After a run"
      icon="i-lucide-trophy"
    >
      <HeroQuestWikiKey :items="result" />
      <p>
        Raids are fought only while you are watching; they never run while you are away. Seals go
        to the
        <NuxtLink
          :to="hqScreenWikiPath('gacha')"
          class="text-primary hover:underline"
        >Gacha</NuxtLink>, Trait Gems to
        <NuxtLink
          :to="hqScreenWikiPath('traits')"
          class="text-primary hover:underline"
        >Traits</NuxtLink>.
      </p>
    </HeroQuestWikiSection>
  </div>
</template>
