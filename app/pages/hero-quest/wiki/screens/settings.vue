<script setup lang="ts">
import { HQ_SETTING_DEFAULTS, type HqSettingKey } from '#shared/utils/hero-quest/settings'
import { HQ_STAGE_SIZE_DEFAULT } from '~/utils/hero-quest-art/stage-size'

/**
 * The Settings screen, row by row. Keyed by setting, so a setting added without a line here fails
 * the typecheck, and every default is read from `HQ_SETTING_DEFAULTS`.
 */

const ROWS: Readonly<Record<HqSettingKey, { name: string, text: string }>> = {
    tutorials: { name: 'Show tutorials', text: 'Mossimer explains each part of the game as it opens. Off, every open screen shows in the menu at once and he stays quiet.' },
    confirmGoldSeals: { name: 'Gold pulls', text: 'A Gacha pull that buys Seals with Gold.' },
    confirmVoidShards: { name: 'Void Shard spending', text: 'A Shop upgrade paid in Void Shards.' },
    confirmGemSpends: { name: 'Gem spending', text: 'Battle Speed, a Shop upgrade paid in Gems, and a paid Arena attack or refresh.' },
    confirmTreeRespec: { name: 'Tree respec', text: 'A Passive Tree respec, free or paid.' },
    confirmTraitSpends: { name: 'Trait spending', text: 'An Auto Roll, a board loaded or bought, or a stored board saved over.' },
    reduceMotion: { name: 'Reduce motion', text: 'No screen shake and fewer flashes. Your device\'s own reduced-motion setting turns this on too.' },
    fastReveals: { name: 'Fast pull reveals', text: 'A pull shows all its cards at once, without the deal.' },
    skillCinematics: { name: 'Skill cinematics', text: 'Your Hero\'s signature skill plays its cinematic. Off, it lands like any other skill.' },
    combatNumbers: { name: 'Combat numbers', text: 'Damage, heal and miss numbers over the fight.' },
    dotFreePulls: { name: 'Free pulls', text: 'On the Gacha, when a free pull is ready.' },
    dotUpgrades: { name: 'Upgrades', text: 'On Collections, when something can be levelled or a piece of Gear beats yours.' },
    dotTreeNodes: { name: 'Tree nodes', text: 'On the Passive Tree, when a node can be bought.' },
    dotRewards: { name: 'Rewards', text: 'On the Calendar and the Arena, when a reward is waiting.' }
}

const row = (key: HqSettingKey) => ({
    term: ROWS[key].name,
    text: `${ROWS[key].text} ${HQ_SETTING_DEFAULTS[key] ? 'On' : 'Off'} by default.`
})

const SECTIONS: readonly { title: string, icon: string, lead: string, keys: readonly HqSettingKey[] }[] = [
    {
        title: 'Confirmations',
        icon: 'i-lucide-shield-check',
        lead: 'While one is on, that kind of spend needs a second press: the button turns gold and asks you to confirm.',
        keys: ['confirmGoldSeals', 'confirmVoidShards', 'confirmGemSpends', 'confirmTreeRespec', 'confirmTraitSpends']
    },
    {
        title: 'Display',
        icon: 'i-lucide-monitor',
        lead: 'How the game looks and moves.',
        keys: ['reduceMotion', 'fastReveals', 'skillCinematics', 'combatNumbers']
    },
    {
        title: 'Menu dots',
        icon: 'i-lucide-circle-dot',
        lead: 'Which red dots the menu buttons show. A screen you have not visited yet always gets one.',
        keys: ['dotFreePulls', 'dotUpgrades', 'dotTreeNodes', 'dotRewards']
    }
]

const stageDefault = HQ_STAGE_SIZE_DEFAULT.charAt(0).toUpperCase() + HQ_STAGE_SIZE_DEFAULT.slice(1)
const stageSize = { term: 'Screen size', text: `Large, Mid or Small: how much of the window the game fills. Small is the original size. ${stageDefault} by default.` }

const sections = SECTIONS.map(section => ({ ...section, items: section.keys.map(row) }))
const tutorials = [
    row('tutorials'),
    { term: 'Reset tutorials', text: 'Shows every tutorial again from the start. It locks nothing: every screen you have opened stays open.' }
]
</script>

<template>
  <div class="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
    <HeroQuestWikiScreenHeader id="settings" />

    <HeroQuestWikiSection
      title="The list"
      icon="i-lucide-list"
      lead="A row per setting, with its switch on the right: green ON, dark OFF. Scroll if it does not fit."
    >
      <p>
        Changes save to your account as you make them, except the screen size, which this browser
        keeps.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Tutorials"
      icon="i-lucide-message-circle"
    >
      <HeroQuestWikiKey :items="tutorials" />
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      v-for="section in sections"
      :key="section.title"
      :title="section.title"
      :icon="section.icon"
      :lead="section.lead"
    >
      <HeroQuestWikiKey :items="section.items" />
      <HeroQuestWikiKey
        v-if="section.title === 'Display'"
        :items="[stageSize]"
      />
    </HeroQuestWikiSection>
  </div>
</template>
