<script setup lang="ts">
import { ASCENDANT_KIT_SIZE, CONVERGENCE_COOLDOWN_FACTOR } from '#shared/utils/hero-quest/constants'
import { ASCENDANT_ID, CLASS_BY_ID, CLASS_NODES, MASTER_IDS, ROOT_CLASS_ID } from '#shared/utils/hero-quest/content/classes'

/**
 * The Classes screen: the tree, the token, and the Ascendant's kit. Tier sizes and names come from
 * the class roster, so the article follows it.
 */

const countOf = (tier: string) => CLASS_NODES.filter(node => node.tier === tier).length
const beginner = CLASS_BY_ID[ROOT_CLASS_ID].name
const ascendant = CLASS_BY_ID[ASCENDANT_ID].name
const bases = CLASS_NODES.filter(node => node.tier === 'base').map(node => node.name).join(', ')

const nodes = [
    { term: 'Gold ring', text: 'Your current class.', tone: 'text-warning' },
    { term: 'Gold name, gilt ring', text: 'A class one step deeper that your token can buy. Gold lines lead to it.', tone: 'text-warning' },
    { term: 'Light name', text: 'A class you have already reached: press it to switch back, free.' },
    { term: 'Dark, dithered', text: 'Not available yet.', tone: 'text-dimmed' },
    { term: '???', text: `The ${ascendant} while it is locked. The panel counts the masters you have prestiged as.`, tone: 'text-dimmed' }
]

const status = [
    { term: 'Current class', text: 'You are this class.' },
    { term: 'Spend token to take', text: 'Pressing it spends your class token.' },
    { term: 'Press to switch', text: 'You have been this class before; switching is free.' },
    { term: 'Not reached yet', text: 'Reach the class above it first.' }
]

const kit = [
    { term: 'Skill tile', text: 'Press to add it to the kit, press again to drop it. A picked tile has a gold rim and its pick number.' },
    { term: 'Dimmed tile', text: 'Its class has not been reached, so it cannot be picked.', tone: 'text-dimmed' },
    { term: 'n/' + ASCENDANT_KIT_SIZE + ' picked', text: 'Turns gold when the kit is full.' },
    { term: 'Done', text: 'Closes the kit. Each pick is saved as you make it, free.' }
]
</script>

<template>
  <div class="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
    <HeroQuestWikiScreenHeader id="classes" />

    <HeroQuestWikiSection
      title="The tree"
      icon="i-lucide-git-fork"
      :lead="`From the ${beginner} at the top down to the masters, one row per tier.`"
    >
      <p>
        The {{ beginner }} branches into {{ countOf('base') }} classes ({{ bases }}), each of those
        into elites ({{ countOf('elite') }} in all) and the elites into masters
        ({{ countOf('master') }}). The {{ ascendant }} sits past the masters. Each node's colour
        follows its line. Every class, its stats and its skill are on the
        <NuxtLink
          to="/hero-quest/wiki/content"
          class="text-primary hover:underline"
        >Content</NuxtLink>
        page.
      </p>
      <HeroQuestWikiKey :items="nodes" />
      <p>
        Point at a class to read its name, its skill and one of these in the top left:
      </p>
      <HeroQuestWikiKey :items="status" />
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="The class token"
      icon="i-lucide-crown"
      lead="Every prestige grants one. You can hold one at a time."
    >
      <p>
        The top right shows a crown and <em>NEW CLASS TOKEN READY</em> while you hold it, or
        <em>PRESTIGE FOR A NEW CLASS</em> when you do not. The token takes your class one step
        deeper down the tree. Switching back to any class you have already been is free, at any
        time, and never costs a level: your Hero keeps every level through every switch.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      :title="`The ${ascendant}`"
      icon="i-lucide-sparkles"
      :lead="`Prestige once as each of the ${MASTER_IDS.length} masters to unlock it, then spend a token to take it.`"
    >
      <p>
        It takes each stat from whichever master has the most of it, and has its own skill, Convergence, which fires every
        master skill at once on a cooldown {{ CONVERGENCE_COOLDOWN_FACTOR }}× a master's, and
        {{ ASCENDANT_KIT_SIZE }} more skills you pick from every class you have reached. While it is
        your class, press it to open its kit.
      </p>
      <HeroQuestWikiKey :items="kit" />
      <p>
        The picks stay through prestiges and class switches, and are saved in a Loadout.
      </p>
    </HeroQuestWikiSection>
  </div>
</template>
