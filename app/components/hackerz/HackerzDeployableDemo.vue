<script setup lang="ts">
import {
  hackerzEmptyArmoury, hackerzEmptyMainframe, hackerzLoadout, hackerzSlots
} from '#shared/utils/gamelogic/hackerz'
import { HackerzGame } from '~/utils/hackerz-engine/hackerz-game'
import { HACKERZ_DEMO_SCRIPTS, type DemoScript } from '~/utils/hackerz-demo-scripts'

/**
 * A Database entry at work: a real game board, quiet and unclickable,
 * fitted with the scene's gear and playing out its fixed script on a loop —
 * the same every time.
 */

const props = defineProps<{ id: string }>()

const host = ref<HTMLDivElement | null>(null)
const line = ref('')
const ready = ref(false)

let game: HackerzGame | null = null

const noop = () => {}

/** The loadout a scene runs with: a fresh run's, fitted with the scene's gun, turrets and upgrades. */
function loadoutFor(script: DemoScript) {
  const armoury = hackerzEmptyArmoury()
  const gear = script.gear ?? {}
  armoury.levels = { ...armoury.levels, ...gear.levels }
  if (gear.weapon) {
    armoury.owned = [...new Set([...armoury.owned, gear.weapon])]
    armoury.active = gear.weapon
  }
  const turrets = gear.turrets ?? []
  // Enough mounts for every turret the scene puts up.
  while (hackerzSlots(armoury.levels.spire) < turrets.length) armoury.levels.spire++
  armoury.turrets = Array.from({ length: hackerzSlots(armoury.levels.spire) }, (_, slot) => turrets[slot] ?? null)
  return hackerzLoadout(armoury, hackerzEmptyMainframe(), 'breach')
}

function play() {
  const script = HACKERZ_DEMO_SCRIPTS[props.id]
  if (!script) return
  game?.demoPlay(script, loadoutFor(script), said => (line.value = said))
}

onMounted(async () => {
  if (!host.value) return
  game = new HackerzGame({
    onWall: noop,
    onAmmo: noop,
    onWaveTime: noop,
    onCredits: noop,
    onCoins: noop,
    onPulse: noop,
    onOverclock: noop,
    onWeapon: noop,
    onWaveEnd: noop,
    onGameOver: noop,
    onBoss: noop,
    onNotice: noop
  })
  const loadout = hackerzLoadout(hackerzEmptyArmoury(), hackerzEmptyMainframe(), 'breach')
  if (!await game.mountDemo(host.value, loadout)) return
  if (import.meta.dev) (window as unknown as { __hackerzDemo: HackerzGame }).__hackerzDemo = game
  ready.value = true
  play()
})

watch(() => props.id, play)

onBeforeUnmount(() => {
  game?.destroy()
  game = null
})
</script>

<template>
  <div class="hz-viewer overflow-hidden">
    <div ref="host" class="relative aspect-video w-full">
      <div v-if="!ready" class="absolute inset-0 grid place-items-center font-mono text-[11px] text-cyan-300/50">
        booting sandbox…
      </div>
    </div>
    <div class="flex items-center gap-2 border-t border-cyan-400/15 px-3 py-1.5 font-mono text-[11px] text-lime-300/80">
      <span class="text-cyan-300/50">sandbox$</span>
      <span class="truncate">{{ line || '…' }}</span>
    </div>
  </div>
</template>
