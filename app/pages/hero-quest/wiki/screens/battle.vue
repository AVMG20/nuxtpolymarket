<script setup lang="ts">
import {
    BASE_KILL_COUNT,
    BOSS_STAGE,
    BOSS_TIMER_SECONDS,
    ELITE_STAGE_MAX,
    ELITE_STAGE_MIN,
    HOLIDAY_CLAIM_WINDOW_DAYS,
    HOLIDAY_GIFTS,
    STAGES_PER_WORLD,
    SUPER_BOSS_STAGE,
    WIPE_RECOVERY_SECONDS,
    WORLD_COUNT
} from '#shared/utils/hero-quest/constants'
import { HOLIDAYS } from '#shared/utils/hero-quest/content/holidays'
import { GACHA_SYSTEMS } from '#shared/utils/hero-quest/gacha'

/**
 * The battle stage: the HUD, everything on it that can be pressed, and what the marks on the
 * fight mean. Holiday gifts are generated from `HOLIDAYS` and `HOLIDAY_GIFTS`.
 */

const holidayRows = HOLIDAYS.map((holiday) => {
    const gift = HOLIDAY_GIFTS[holiday.id]
    const seals = GACHA_SYSTEMS.filter(system => gift.seals[system])
    const allSame = seals.length === GACHA_SYSTEMS.length && seals.every(system => gift.seals[system] === gift.seals[seals[0]!])
    return {
        id: holiday.id,
        name: holiday.name,
        gold: `${gift.goldMinutes} min of Gold`,
        gems: gift.gems,
        seals: allSame
            ? `${gift.seals[seals[0]!]} of every Seal`
            : seals.map(system => `${gift.seals[system]} ${hqSealName(system)}`).join(', ') || 'None'
    }
})

const top = [
    { term: 'Portrait', text: 'Your Hero, in a gold ring. The gold pip under the face lights up when the Hero levels. Press it to open Party Stats.' },
    { term: 'Power', text: 'The lightning bolt and big gold number: your party\'s Global Power. When it changes it counts to the new value, with a green arrow for a rise or a red arrow for a drop.' },
    { term: 'P0-W3-S7', text: 'Where the run is: prestiges made, World and Stage. P0 is your first run.' },
    { term: 'Teal strip', text: 'Hero XP toward the next level. It flashes white on a level-up.' },
    { term: 'Crossed swords bar', text: `Kills on this stage, out of the ${BASE_KILL_COUNT} it takes to clear it. It turns red when the party keeps falling before the stage fills: the run is walled and needs a stronger party.` },
    { term: 'Hourglass bar', text: `The boss timer, ${BOSS_TIMER_SECONDS} seconds, draining toward a skull. It pulses red near the end and burns red when time is up.` },
    { term: '2X 12:34', text: 'A Battle Speed boost is running: its speed and the time it has left.' }
]

const field = [
    { term: 'Green, gold, red bars', text: 'Party health over each body: green above half, gold above a fifth, red below. Health just lost flashes white, then drains.' },
    { term: 'Red bars', text: 'Enemy health. A boss has a wider bar under its feet instead.' },
    { term: 'Gold halo and chevron', text: `An elite. Every enemy on stages ${ELITE_STAGE_MIN} to ${ELITE_STAGE_MAX} is one: tougher than a wave.` },
    { term: 'White and gold number', text: 'A hit.' },
    { term: 'Big red number with !', text: 'A critical hit. A Hero crit shakes the screen.', tone: 'text-error' },
    { term: 'Green +number', text: 'A heal.', tone: 'text-success' },
    { term: 'Grey MISS', text: 'An attack that was evaded and dealt nothing.', tone: 'text-dimmed' },
    { term: 'Expanding ring', text: 'A shield landing on a body.' },
    { term: 'Skill tiles', text: 'Bottom left, one per Hero skill: class skills on steel, trained Skills on purple. A dimmed tile with a gold edge sweeping round is cooling down; it flashes white as it fires. Skills fire on their own.' }
]

const presses = [
    { term: 'Gold chest', text: 'Top right. Kills drop Gold into the chest rather than straight into your balance; press it to collect everything inside. Pointing at it shows how much it holds; on a touch screen the first tap shows the amount and a second tap opens it. Hidden during boss and raid fights.' },
    { term: 'Red skull button', text: 'Shows in place of the kill bar when a boss has beaten you: the run farms the stage before it, and the boss waits here until you challenge it again.' },
    { term: 'Gift box', text: 'Under the chest, on a holiday. Press it to open that holiday\'s gift.' },
    { term: 'Portrait', text: 'Opens Party Stats: a column per fielded unit with every stat. Press a base stat to see where it comes from; Back returns, the red × or a press outside closes it.' },
    { term: 'Continue', text: 'Closes the welcome-back card or a gift.' }
]

const welcome = [
    { term: 'Red note', text: 'Something was lost: time past your offline cap did not count, or the party kept falling on a wave.', tone: 'text-error' },
    { term: 'Gold note', text: 'Your offline efficiency took a share of the time away, or the run is parked at a boss, ready to fight.', tone: 'text-warning' },
    { term: 'Blue note', text: 'A Battle Speed boost ran while you were away.', tone: 'text-info' },
    { term: 'Green note', text: 'Something you can do about it: raise the offline cap or efficiency in the Shop.', tone: 'text-success' }
]
</script>

<template>
  <div class="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
    <HeroQuestWikiScreenHeader id="battle" />

    <HeroQuestWikiSection
      title="The run"
      icon="i-lucide-map"
      :lead="`${WORLD_COUNT} Worlds of ${STAGES_PER_WORLD} stages. Your party walks and fights on its own.`"
    >
      <p>
        Stage {{ BOSS_STAGE }} of every World is a boss and stage {{ SUPER_BOSS_STAGE }} a super
        boss. A boss engages by itself a moment after the party reaches it, but only while the game
        is open in front of you; everything else carries on while you are away. The
        <NuxtLink
          to="/hero-quest/wiki"
          class="text-primary hover:underline"
        >Basics</NuxtLink>
        page explains the loop; this one explains the screen.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Along the top"
      icon="i-lucide-panel-top"
    >
      <HeroQuestWikiKey :items="top" />
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="On the field"
      icon="i-lucide-swords"
    >
      <HeroQuestWikiKey :items="field" />
      <p>
        When the party falls on a wave, the screen tints red, <em>DEFEATED</em> shows and
        <em>RECOVERING</em> counts down {{ WIPE_RECOVERY_SECONDS }} seconds before it fights on. A
        boss fight ends on <em>VICTORY</em>, <em>DEFEAT</em> (the party fell) or <em>TIME UP</em>
        (the timer ran out). Combat numbers can be turned off in Settings.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="What you can press"
      icon="i-lucide-mouse-pointer-click"
    >
      <HeroQuestWikiKey :items="presses" />
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Welcome back"
      icon="i-lucide-door-open"
      lead="After time away, a card sums up what the party did."
    >
      <p>
        It shows how long you were away and how much of it counted, the Gold, XP and kills earned,
        and any level or stage gained. Coloured notes below explain the rest:
      </p>
      <HeroQuestWikiKey :items="welcome" />
      <p>
        No boss engages while the card is up. Press <strong class="text-default">Continue</strong>
        to carry on.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Holiday gifts"
      icon="i-lucide-gift"
      :lead="`Each gift can be opened for ${HOLIDAY_CLAIM_WINDOW_DAYS} days from the holiday, counting the day itself (UTC).`"
    >
      <div class="overflow-x-auto">
        <table class="w-full text-xs border-collapse">
          <thead>
            <tr class="text-muted">
              <th class="text-left font-medium py-1.5 pr-3">
                Holiday
              </th>
              <th class="text-left font-medium py-1.5 px-3">
                Gold
              </th>
              <th class="text-right font-medium py-1.5 px-3">
                Gems
              </th>
              <th class="text-left font-medium py-1.5 pl-3">
                Seals
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in holidayRows"
              :key="row.id"
              class="border-t border-default"
            >
              <td class="py-1.5 pr-3 text-default font-medium whitespace-nowrap">
                {{ row.name }}
              </td>
              <td class="py-1.5 px-3 whitespace-nowrap">
                {{ row.gold }}
              </td>
              <td class="py-1.5 px-3 text-right tabular-nums">
                {{ row.gems }}
              </td>
              <td class="py-1.5 pl-3">
                {{ row.seals }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Gold is paid as minutes of your current income. A window you miss is not made up later.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Mossimer, the guide"
      icon="i-lucide-message-circle"
    >
      <p>
        A snail who explains each part of the game as it opens. While he talks the rest of the
        screen dims: press his bar to read on. When he introduces a new screen, only that screen's
        button works, ringed in gold, until you press it. Settings can turn him off or show every
        tutorial again.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="The bridge"
      icon="i-lucide-sparkles"
      :lead="`Beat World ${WORLD_COUNT}'s super boss and the battle gives way to a bridge of light.`"
    >
      <p>
        It shows the Void Shards a prestige pays, and that your level stays.
        <strong class="text-default">Begin again</strong> prestiges: the party walks through a
        portal and the next run starts at World 1. The menu stays usable on the bridge, so spend
        what you have first if you like.
      </p>
    </HeroQuestWikiSection>
  </div>
</template>
