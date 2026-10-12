<script setup lang="ts">
import {
    BASE_KILL_COUNT,
    BOSS_TIMER_SECONDS,
    BOSS_STAGE,
    ELITE_STAGE_MAX,
    ELITE_STAGE_MIN,
    OFFLINE_CAP_BASE_HOURS,
    OFFLINE_CAP_MAX_HOURS,
    BASE_OFFLINE_EFFICIENCY,
    MAX_OFFLINE_EFFICIENCY,
    ONLINE_THRESHOLD_MS,
    STAGES_PER_WORLD,
    SUPER_BOSS_STAGE,
    VOID_SHARD_BASE,
    VOID_SHARD_GROWTH,
    WORLD_COUNT
} from '#shared/utils/hero-quest/constants'

/**
 * Basics — the loop, in the order a new player meets it.
 *
 * Deliberately the landing page rather than a table of contents: someone who opens the wiki for
 * the first time has a specific confusion, and "what is actually happening while I watch this"
 * is the most common one.
 */
const minutesOnline = Math.round(ONLINE_THRESHOLD_MS / 60_000)
</script>

<template>
  <div class="p-4 sm:p-6 max-w-3xl mx-auto space-y-8">
    <div class="space-y-2">
      <h1 class="text-xl font-semibold text-highlighted">
        How Hero Quest works
      </h1>
      <p class="text-sm text-muted">
        An idle auto-battler. Your hero fights on its own, keeps fighting while you are away, and
        stops only at a boss.
      </p>
    </div>

    <!--
      The honesty banner. Dozens of constants carry an `// UNTUNED` marker in source, and
      that marker lives in a comment rather than in a value, so no page can render the list.
      Saying so once, at the top, is the accurate thing to do.
    -->
    <UAlert
      color="warning"
      variant="subtle"
      icon="i-lucide-flask-conical"
      title="Numbers here are provisional"
      description="Every figure on these pages is read live from the game's constants, so it is
        never out of date with the build you are playing. But most of those constants are still
        being tuned — expect them to move."
    />

    <HeroQuestWikiSection
      title="The run"
      icon="i-lucide-map"
      :lead="`${WORLD_COUNT} worlds, ${STAGES_PER_WORLD} stages each.`"
    >
      <p>
        You advance one stage at a time by killing enough of whatever is in front of you. Clear
        the last stage of the last world and you can <strong class="text-default">prestige</strong>,
        which sends you back to the start — harder, and with permanent currency to show for it.
      </p>
      <p>
        Not every stage is the same. Most are ordinary waves. Stage
        {{ BOSS_STAGE }} is a boss, stages {{ ELITE_STAGE_MIN }}–{{ ELITE_STAGE_MAX }} are elites
        with tougher stats, and stage {{ SUPER_BOSS_STAGE }} is a super boss guarding the way into
        the next world.
      </p>
      <HeroQuestWikiFormula
        label="Stage clear"
        :formula="`${BASE_KILL_COUNT} kills per stage`"
        note="Raisable in the prestige shop."
      />
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Bosses are the one thing that needs you watching"
      icon="i-lucide-shield-alert"
    >
      <p>
        Waves clear themselves wherever you are. A boss only fights while this page is actually
        open in front of you — it engages on its own a moment after your hero reaches the gate,
        and it stops the instant you switch tabs or close the app. That is deliberate: it is the
        one gate that <em>cannot</em> be passed while you are away. You can always engage it
        yourself rather than waiting.
      </p>
      <p>
        A boss fight is resolved in full the moment you engage, on the server, from the stats you
        have right then. What you watch afterwards is a replay of a fight that already happened —
        nothing you do during it changes the outcome. If the timer runs out with the boss alive,
        you lose nothing but the attempt; go get stronger and come back.
      </p>
      <HeroQuestWikiFormula
        label="Boss timer"
        :formula="`${BOSS_TIMER_SECONDS} seconds to kill it`"
      />
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Away time"
      icon="i-lucide-moon"
      lead="Progress accrues whether the tab is open or not — but not at the same rate."
    >
      <p>
        The game does not run a clock for you in the background. It works out what happened the
        next time you look, from how long you were gone. If the gap since your last check-in is
        under {{ minutesOnline }} minutes you count as <strong class="text-default">present</strong>
        and earn the full rate. A longer gap is treated as offline time, which is both capped and
        taxed.
      </p>
      <p>
        Both limits are prestige-shop tracks, and they are the reason to spend early Void Shards
        there rather than on party slots.
      </p>
      <div class="grid gap-2 sm:grid-cols-2">
        <HeroQuestWikiFormula
          label="Offline cap"
          :formula="`${OFFLINE_CAP_BASE_HOURS}h → ${OFFLINE_CAP_MAX_HOURS}h`"
          note="How long unattended time keeps counting at all."
        />
        <HeroQuestWikiFormula
          label="Offline efficiency"
          :formula="`${BASE_OFFLINE_EFFICIENCY * 100}% → ${MAX_OFFLINE_EFFICIENCY * 100}%`"
          note="What fraction of the live rate that counted time earns."
        />
      </div>
      <p>
        One thing offline time never does is fight a boss. Come back to a parked run and the boss
        is still waiting.
      </p>
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Prestige"
      icon="i-lucide-sparkles"
      lead="The reset that is not really a reset."
    >
      <p>
        Clearing World {{ WORLD_COUNT }}, Stage {{ SUPER_BOSS_STAGE }} unlocks prestige. It returns
        you to World 1 Stage 1 against a harder curve, and pays
        <strong class="text-default">Void Shards</strong> — the only currency in the game with a
        single source.
      </p>
      <p>
        <strong class="text-default">Your hero level survives it.</strong> So does everything you
        own: every Champion, Skill, Artifact and piece of Gear, at the star and level you got them
        to. What resets is your position in the run, and nothing else. You may also switch class
        at prestige without losing a level.
      </p>
      <HeroQuestWikiFormula
        label="Void Shards earned"
        :formula="`${VOID_SHARD_BASE} × ${VOID_SHARD_GROWTH}^(prestiges completed)`"
        note="Each prestige is worth more than the last, so the second is never a downgrade on the first."
      />
    </HeroQuestWikiSection>

    <HeroQuestWikiSection
      title="Nothing needs pressing"
      icon="i-lucide-zap"
    >
      <p>
        Every skill on every unit fires the instant its cooldown ends — yours, your Champions',
        the enemy's. There is no cast button, no queue and no ready-and-waiting state anywhere in
        the game. Equipping a skill is a build decision, not an input you have to keep making.
      </p>
      <p>
        The two things that <em>do</em> want you present are engaging bosses and spending what you
        have earned.
      </p>
    </HeroQuestWikiSection>
  </div>
</template>
