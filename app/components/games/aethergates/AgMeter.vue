<script setup lang="ts">
import { AG_ORB_TIERS, agOrbTier } from '~/utils/slots/aethergates-art'

// An orbital meter that takes the colour of the collected multiplier tier.
// Keep the target ref stable: particles fly to this element when an orb lands.

const props = defineProps<{
  value: number
  hit: number
  bonus?: boolean
  applying?: boolean
}>()

const target = ref<HTMLDivElement>()
defineExpose({ target })

const shown = computed(() => Math.max(1, props.value))
const tier = computed(() => AG_ORB_TIERS[agOrbTier(props.value)]!)
const live = computed(() => props.value > 1)

const bump = ref(false)
watch(() => props.hit, () => {
  bump.value = false
  requestAnimationFrame(() => {
    bump.value = true
  })
})
</script>

<template>
  <div
    class="ag-meter"
    :class="{ 'is-live': live, 'is-bonus': bonus, 'is-applying': applying }"
    :style="{ '--tier': tier.css }"
  >
    <div class="ag-meter-label">
      {{ bonus ? 'Bonus multiplier' : 'Multiplier' }}
    </div>
    <div
      ref="target"
      class="ag-meter-medallion"
      :class="{ 'is-bump': bump }"
      @animationend="bump = false"
    >
      <div class="ag-meter-ring" />
      <div class="ag-meter-orb">
        <span class="ag-meter-value">×{{ formatNumber(shown, shown >= 10000, 0) }}</span>
      </div>
    </div>
    <p class="ag-meter-hint">
      {{ bonus ? 'Keeps growing all feature' : 'Resets every paid spin' }}
    </p>
  </div>
</template>

<style scoped>
.ag-meter {
display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.ag-meter-label {
font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ag-muted);
}

.ag-meter-medallion {
position: relative;
  width: 138px;
  height: 138px;
}

.ag-meter-ring {
position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--ag-gold) 45%, transparent);
  background: conic-gradient(from 210deg, transparent, color-mix(in srgb, var(--ag-gold) 10%, transparent), transparent);
}

.ag-meter-ring::after {
content: '';
  position: absolute;
  inset: 7px;
  border-radius: 50%;
  border: 1px dashed color-mix(in srgb, var(--ag-gold) 25%, transparent);
}

.ag-meter-orb {
position: absolute;
  inset: 16px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1px solid var(--ag-line);
  background: radial-gradient(circle at 50% 70%, color-mix(in srgb, var(--ag-accent) 12%, var(--ag-night)), var(--ag-night));
  transition: box-shadow 300ms ease, background 300ms ease;
}

.is-live .ag-meter-orb {
background: radial-gradient(circle at 50% 70%, color-mix(in srgb, var(--tier) 28%, var(--ag-night)), var(--ag-night));
  box-shadow: 0 0 28px color-mix(in srgb, var(--tier) 25%, transparent);
}

.ag-meter-value {
font-family: 'Cinzel', Georgia, serif;
  font-size: 34px;
  font-weight: 700;
  line-height: 1;
  color: var(--ag-gold);
}

.ag-meter-hint {
font-size: 10px;
  line-height: 1.6;
  color: var(--ag-muted);
  text-align: center;
}

.is-bump {
  animation: ag-meter-bump 420ms cubic-bezier(0.2, 1.6, 0.4, 1);
}

.is-applying .ag-meter-medallion {
  animation: ag-meter-charge 700ms ease-in-out infinite alternate;
}

@keyframes ag-meter-bump {
  0% {
    transform: scale(1);
  }
  35% {
    transform: scale(1.18);
    filter: brightness(1.6);
  }
  100% {
    transform: scale(1);
  }
}

@keyframes ag-meter-charge {
  to {
    transform: scale(1.08);
    filter: brightness(1.35) drop-shadow(0 0 22px var(--tier));
  }
}

@media (max-width: 1023px) {
  .ag-meter {
    flex-direction: row;
    gap: 12px;
  }

  .ag-meter-medallion {
    width: 56px;
    height: 56px;
  }

  .ag-meter-orb {
    inset: 6px;
  }

  .ag-meter-value {
    font-size: 19px;
  }

  .ag-meter-label {
    font-size: 11px;
    max-width: 90px;
    text-align: right;
  }

  .ag-meter-hint {
    max-width: 110px;
    text-align: left;
  }
}
@media (prefers-reduced-motion: reduce) {
  .is-bump,
  .is-applying .ag-meter-medallion { animation: none; }
}
</style>
