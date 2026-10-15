<script setup lang="ts">
import { CALENDAR_DAYS, CALENDAR_MAKEUPS_PER_CYCLE, type CalendarReward } from '#shared/utils/hero-quest/constants'
import { CALENDAR_REWARDS } from '#shared/utils/hero-quest/calendar'
import { getRaid } from '#shared/utils/hero-quest/content/raids'
import { MILESTONE_TRACKS, milestoneSteps, milestoneTarget, type MilestoneReward, type MilestoneTrack } from '#shared/utils/hero-quest/milestones'

/**
 * The Calendar screen's two tabs. The 30 days are `CALENDAR_REWARDS` and the Milestone tracks are
 * `MILESTONE_TRACKS`, each step's target and reward read from the track itself, so both tables are
 * the ones a claim pays from.
 */

/** "1 Guild Key", "3 Guild Keys". */
const count = (amount: number, plural: string) => `${amount} ${amount === 1 ? plural.replace(/s$/, '') : plural}`

function calendarText(reward: CalendarReward): string {
    switch (reward.kind) {
        case 'gold': return `${reward.amount} min of Gold`
        case 'gems': return count(reward.amount, 'Gems')
        case 'trait_gems': return count(reward.amount, 'Trait Gems')
        case 'void_shards': return count(reward.amount, 'Void Shards')
        case 'seals': return count(reward.amount, hqSealName(reward.system))
        case 'keys': return count(reward.amount, getRaid(reward.raid).key)
    }
}

const days = CALENDAR_REWARDS.map((reward, index) => ({ day: index + 1, text: calendarText(reward) }))

function milestoneText(reward: MilestoneReward): string {
    switch (reward.kind) {
        case 'all_seals': return `${reward.amount} of every Seal`
        case 'seals': return count(reward.amount, hqSealName(reward.system))
        case 'gems': return count(reward.amount, 'Gems')
        case 'keys': return count(reward.amount, getRaid(reward.raid).key)
        case 'medals': return count(reward.amount, 'Arena Medals')
    }
}

const COLLECTION_LABEL = { gear: 'Gear', champion: 'Champions', skill: 'Skills', artifact: 'Artifacts' } as const

function trackName(track: MilestoneTrack): string {
    switch (track.kind) {
        case 'worlds': return 'Worlds cleared'
        case 'prestige': return 'Prestiges'
        case 'raid': return `${getRaid(track.raid!).name} level`
        case 'collection': return `${COLLECTION_LABEL[track.system!]} owned`
        case 'arena': return 'Arena wins'
    }
}

const tracks = MILESTONE_TRACKS.map((track) => {
    const steps = milestoneSteps(track)
    return {
        id: track.id,
        name: trackName(track),
        every: track.every,
        steps: steps === null ? 'Endless' : String(steps),
        first: `At ${milestoneTarget(track, 1)}: ${track.reward(1).map(milestoneText).join(' + ')}`,
        second: steps === 1 ? '–' : `At ${milestoneTarget(track, 2)}: ${track.reward(2).map(milestoneText).join(' + ')}`
    }
})

const marks = [
    { term: 'Pulsing gold outline', text: 'Today. Press it to claim.', tone: 'text-warning' },
    { term: 'Green tick', text: 'Claimed.', tone: 'text-success' },
    { term: 'Red corner', text: 'Missed: a day before today that was not claimed.', tone: 'text-error' },
    { term: 'Plain', text: 'Still to come. Point at it to see what it pays.' },
    { term: 'Blue outline', text: 'The day the Make-up button would claim.', tone: 'text-info' }
]

const cards = [
    { term: 'Gold outline', text: 'Steps are waiting. Press the card to claim them all.', tone: 'text-warning' },
    { term: 'Gold bar', text: 'Progress toward the next step.' },
    { term: 'DONE', text: 'A collection track with every entry owned.', tone: 'text-success' },
    { term: 'n READY', text: 'Top right: how many cards have steps waiting.' }
]
</script>

<template>
  <div class="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
    <HeroQuestWikiScreenHeader id="calendar" />

    <HeroQuestWikiSection
      title="Calendar"
      icon="i-lucide-calendar-days"
      :lead="`${CALENDAR_DAYS} days, one reward a day. Days turn over at midnight UTC.`"
    >
      <p>
        The cycle starts on the day of your first claim and starts over after {{ CALENDAR_DAYS }}
        days, claimed or not. The top right shows which day you are on; under the grid, the
        selected day's reward and state, the Make-up button, and how long until the next day.
      </p>
      <HeroQuestWikiKey :items="marks" />
      <p>
        <strong class="text-default">Make up day n</strong> claims the oldest day you missed.
        {{ CALENDAR_MAKEUPS_PER_CYCLE }} per cycle; they reset with it. It reads
        <em>NO MISSED DAYS</em> when there is nothing to make up.
      </p>
      <div class="grid gap-x-4 gap-y-1 sm:grid-cols-2 text-xs">
        <div
          v-for="row in days"
          :key="row.day"
          class="flex gap-2 border-t border-default py-1"
        >
          <span class="w-12 shrink-0 text-dimmed tabular-nums">Day {{ row.day }}</span>
          <span class="text-default">{{ row.text }}</span>
        </div>
      </div>
      <p>
        Gold days pay minutes of your current Gold income, so they grow with you.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Milestones"
      icon="i-lucide-trophy"
      :lead="hqFeatureUnlockText('milestones') + ' Lifetime feats, each a track of steps. Nothing expires.'"
    >
      <HeroQuestWikiKey :items="cards" />
      <p>
        Point at a card to see what claiming pays. A track's steps pay more the further it goes.
      </p>
      <div class="overflow-x-auto">
        <table class="w-full text-xs border-collapse">
          <thead>
            <tr class="text-muted">
              <th class="text-left font-medium py-1.5 pr-3">
                Track
              </th>
              <th class="text-right font-medium py-1.5 px-3">
                Steps
              </th>
              <th class="text-left font-medium py-1.5 px-3">
                First step
              </th>
              <th class="text-left font-medium py-1.5 pl-3">
                Second step
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="track in tracks"
              :key="track.id"
              class="border-t border-default"
            >
              <td class="py-1.5 pr-3 text-default font-medium whitespace-nowrap">
                {{ track.name }}
              </td>
              <td class="py-1.5 px-3 text-right tabular-nums">
                {{ track.steps }}
              </td>
              <td class="py-1.5 px-3">
                {{ track.first }}
              </td>
              <td class="py-1.5 pl-3">
                {{ track.second }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Worlds count across every run. A World's reward rises once per full run behind it, so every
        World of a run pays alike.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Red dots"
      icon="i-lucide-circle-dot"
    >
      <p>
        The Calendar's menu button gets a red dot when today is unclaimed or a Milestone step is
        waiting, and each tab gets its own. Settings, Menu dots, Rewards turns them off.
      </p>
    </HeroQuestWikiSection>
  </div>
</template>
