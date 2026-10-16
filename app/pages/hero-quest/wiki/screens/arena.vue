<script setup lang="ts">
import {
    ARENA_CANDIDATE_COUNT,
    ARENA_FIGHT_SECONDS,
    ARENA_FREE_ATTEMPTS_PER_DAY,
    ARENA_FREE_REFRESHES_PER_DAY,
    ARENA_MATCH_BAND_RATING,
    ARENA_RATING_START,
    ARENA_SEASON_DAYS,
    ARENA_SEASON_REWARDS
} from '#shared/utils/hero-quest/constants'
import { getRaid } from '#shared/utils/hero-quest/content/raids'
import { ARENA_SHOP, eloUpdate, extraAttemptPrice, medalsFor, refreshPrice } from '#shared/utils/hero-quest/arena'

/**
 * The Arena screen, tab by tab. Every figure comes from the constants or from the functions the
 * server settles a match with (`eloUpdate`, `medalsFor`, the price ladders), so an even match is
 * shown exactly as the server would score it.
 */

const even = eloUpdate(ARENA_RATING_START, ARENA_RATING_START, true)
const evenLoss = eloUpdate(ARENA_RATING_START, ARENA_RATING_START, false)
const medalsEvenWin = medalsFor(true, even.expectedAttacker)
const medalsUpsetMax = medalsFor(true, 0)
const medalsLoss = medalsFor(false, even.expectedAttacker)
const medalsDummy = medalsFor(true, null)

const attackPrices = [0, 1, 2].map(extraAttemptPrice)
const refreshPrices = [0, 1, 2].map(n => refreshPrice(ARENA_FREE_REFRESHES_PER_DAY + n))

const seasonRows = ARENA_SEASON_REWARDS.map((band, index) => {
    const from = index === 0 ? 1 : ARENA_SEASON_REWARDS[index - 1]!.maxRank + 1
    const ranks = !Number.isFinite(band.maxRank) ? `${from} and below` : from === band.maxRank ? `${from}` : `${from}–${band.maxRank}`
    return { ranks, medals: band.medals }
})

const shopRows = ARENA_SHOP.map(item => ({
    id: item.id,
    name: item.kind === 'seals' ? hqSealName(item.system).replace(/s$/, '') : item.kind === 'keys' ? getRaid(item.raid).key.replace(/s$/, '') : 'Gem',
    price: item.price
}))

const header = [
    { term: 'Rating', text: 'Your Rating this season, in gold.', tone: 'text-warning' },
    { term: 'Season n', text: 'The current season and the time left in it.' },
    { term: 'Medal icon', text: 'Your Arena Medals.' }
]

const fight = [
    { term: 'Opponent card', text: 'Red: a player or a bot, with their Rating (gold, top left), their defence\'s Power (grey, top right) and their party in two rows, F for front and B for back.' },
    { term: 'Training Dummy', text: `A grey card marked ALWAYS A WIN: fills a place no opponent near your Rating can. Pays ${medalsDummy} Medals and leaves your Rating alone.`, tone: 'text-dimmed' },
    { term: 'NO LONGER HERE', text: 'That player removed their defence. It cannot be attacked.' },
    { term: 'Attack', text: 'Fights that opponent with your live party, played out on the battle screen, then shows the result. Uses one attack, win or lose. The list is redrawn after every attack.', tone: 'text-error' },
    { term: 'Attacks n/m', text: 'Attacks left today. Gold while you have some, red at 0.' },
    { term: '+1 Attack', text: `Buys one more attack today for Gems: ${attackPrices.join(', ')} and so on, doubling each time.`, tone: 'text-primary' },
    { term: 'Refresh', text: `Draws a new list. ${ARENA_FREE_REFRESHES_PER_DAY} free a day, then ${refreshPrices.join(', ')} Gems and so on.`, tone: 'text-info' },
    { term: 'Loadout', text: 'A saved Loadout to put on for your attacks, or none. The label turns green while it is on; your own setup comes back when you leave the Arena.', tone: 'text-info' },
    { term: 'Claim', text: 'Shown when a finished season owes you Medals: claims every season waiting.', tone: 'text-success' }
]

const results = [
    { term: 'VICTORY / DEFEAT', text: 'Who won. The panel is gold on a win and red on a loss.' },
    { term: 'Rating +n', text: 'Your new Rating and the change: green up, red down.' },
    { term: '+n Medals', text: 'What the fight paid.' }
]

const log = [
    { term: 'WON / LOST', text: 'A fight you started. Green when it went your way, red when not.' },
    { term: 'HELD / FELL', text: 'Someone attacked your defence: held means it won.' },
    { term: 'Name', text: 'Your opponent: off-white if you attacked, cyan if they did.' },
    { term: '+n / -n', text: 'Your Rating change, then any Medals, then how long ago (m, h or d).' }
]
</script>

<template>
  <div class="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
    <HeroQuestWikiScreenHeader id="arena" />

    <HeroQuestWikiSection
      title="How it works"
      icon="i-lucide-swords"
      lead="You attack other players' defences; they attack yours. The game's AI plays the defending side."
    >
      <p>
        You get {{ ARENA_CANDIDATE_COUNT }} opponents, drawn from players within
        {{ ARENA_MATCH_BAND_RATING }} Rating of you; bots, then a Training Dummy, fill any place left.
        You have {{ ARENA_FIGHT_SECONDS }} seconds to beat the whole defending party. If time runs
        out, the side with the bigger share of its health left wins, and a tie goes to the defender.
        Battle Speed never applies here.
      </p>
      <p>
        {{ ARENA_FREE_ATTEMPTS_PER_DAY }} free attacks a day; they do not carry over. Free attacks,
        free refreshes and both Gem prices reset at midnight UTC.
      </p>
      <div class="grid gap-2 sm:grid-cols-2">
        <HeroQuestWikiFormula
          label="Rating, against an equal opponent"
          :formula="`win ${even.attacker.change >= 0 ? '+' : ''}${even.attacker.change} · loss ${evenLoss.attacker.change}`"
          :note="`Beating a higher Rating gains more, losing to a lower one costs more. A defence that falls to an equal attacker loses ${Math.abs(even.defender.change)}.`"
        />
        <HeroQuestWikiFormula
          label="Medals per attack"
          :formula="`win ${medalsEvenWin} (up to ${medalsUpsetMax}) · loss ${medalsLoss}`"
          note="The less likely the win, the more it pays. Defending pays nothing."
        />
      </div>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="On every tab"
      icon="i-lucide-panel-top"
      lead="Fight, Defence, Shop, Log and Ranking, with this header over them."
    >
      <HeroQuestWikiKey :items="header" />
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Fight"
      icon="i-lucide-crosshair"
    >
      <HeroQuestWikiKey :items="fight" />
      <p>After a fight a result panel shows; Continue goes back to the Arena.</p>
      <HeroQuestWikiKey :items="results" />
      <p>
        Gem buttons ask for a second press (Settings, Gem spending).
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Defence"
      icon="i-lucide-shield"
      lead="What other players fight when they attack you."
    >
      <p>
        <strong class="text-default">Set current loadout as defence</strong> copies the Champions,
        rows, Skills, Artifacts and Gear you have on into your defence. It is free, and you can do it
        as often as you like; your defence keeps that selection until you set it again, and setting
        it never changes your live party. Until you set one, other players cannot draw you.
      </p>
      <p>
        The tab shows your defence's Power, its party in F and B rows, and its Skills, Artifacts and
        Gear as tiles in their rarity colours.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Shop"
      icon="i-lucide-store"
      lead="Medals buy Seals, raid Keys and Gems. x1 or x10 at a time."
    >
      <div class="overflow-x-auto">
        <table class="w-full text-xs border-collapse">
          <thead>
            <tr class="text-muted">
              <th class="text-left font-medium py-1.5 pr-3">
                Item
              </th>
              <th class="text-right font-medium py-1.5 pl-3">
                Medals
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in shopRows"
              :key="row.id"
              class="border-t border-default"
            >
              <td class="py-1.5 pr-3 text-default">
                {{ row.name }}
              </td>
              <td class="py-1.5 pl-3 text-right tabular-nums">
                {{ row.price.toLocaleString('en-US') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        A button is greyed out when you cannot afford it. Keys bought here can take you past a
        raid's Key cap. Medals carry over from season to season.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Log"
      icon="i-lucide-scroll-text"
      lead="Your recent matches, attacks and defences, newest first."
    >
      <HeroQuestWikiKey :items="log" />
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Ranking"
      icon="i-lucide-trophy"
      :lead="`Seasons last ${ARENA_SEASON_DAYS} days. Everyone starts each one at ${ARENA_RATING_START}.`"
    >
      <p>
        The top of the season's ladder, then you and your neighbours if you are further down; your
        row is highlighted. You are ranked once you have fought, or been fought, that season.
        <strong class="text-default">Rewards</strong> shows what each rank pays when the season
        ends, your band highlighted; claim it on the Fight tab.
      </p>
      <div class="overflow-x-auto">
        <table class="w-full text-xs border-collapse">
          <thead>
            <tr class="text-muted">
              <th class="text-left font-medium py-1.5 pr-3">
                Rank
              </th>
              <th class="text-right font-medium py-1.5 pl-3">
                Medals
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in seasonRows"
              :key="row.ranks"
              class="border-t border-default"
            >
              <td class="py-1.5 pr-3 text-default">
                {{ row.ranks }}
              </td>
              <td class="py-1.5 pl-3 text-right tabular-nums">
                {{ row.medals.toLocaleString('en-US') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </HeroQuestWikiSection>
  </div>
</template>
