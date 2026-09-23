<script setup lang="ts">
import { AG_ORB_TIERS, agOrbTier } from '~/utils/slots/aethergates-art'

// The multiplier meter: a gilded medallion whose glass orb takes the colour
// of the orb tier its total has reached. `hit` bumps it when an orb lands.

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
  --tier: #60a5fa;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.ag-meter-label {
  font-family: 'Cinzel', Georgia, serif;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #fde68a;
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.6);
}

.ag-meter-medallion {
  position: relative;
  width: 150px;
  height: 150px;
}

.ag-meter-ring {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background:
    conic-gradient(from 200deg, #fff6c9, #d99a26, #7a4a0c, #f7cf62, #fffbe6, #b7791f, #fff6c9);
  box-shadow:
    0 10px 24px rgba(0, 0, 0, 0.6),
    0 0 0 2px #3b1d00,
    inset 0 0 0 2px rgba(255, 255, 255, 0.35);
}

.ag-meter-ring::after {
  content: '';
  position: absolute;
  inset: 5px;
  border-radius: 999px;
  border: 2px dotted rgba(59, 29, 0, 0.55);
}

.ag-meter-orb {
  position: absolute;
  inset: 14px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background:
    radial-gradient(circle at 34% 28%, rgba(255, 255, 255, 0.9), transparent 22%),
    radial-gradient(circle at 50% 55%, color-mix(in srgb, var(--tier) 70%, white 10%), color-mix(in srgb, var(--tier) 45%, #0b0a2a) 62%, #070618 100%);
  box-shadow: inset 0 -10px 22px rgba(0, 0, 0, 0.55), inset 0 0 0 2px #3b1d00;
  filter: saturate(0.6) brightness(0.85);
  transition: filter 300ms ease;
}

.is-live .ag-meter-orb {
  filter: none;
  box-shadow: inset 0 -10px 22px rgba(0, 0, 0, 0.55), inset 0 0 0 2px #3b1d00, 0 0 36px color-mix(in srgb, var(--tier) 80%, transparent);
}

.ag-meter-value {
  font-family: 'Cinzel', Georgia, serif;
  font-size: 38px;
  font-weight: 900;
  line-height: 1;
  color: #fffbeb;
  -webkit-text-stroke: 1.5px #1a0f02;
  paint-order: stroke fill;
  text-shadow: 0 3px 0 rgba(0, 0, 0, 0.55), 0 0 18px var(--tier);
}

.ag-meter-hint {
  font-size: 11px;
  font-weight: 700;
  color: rgba(224, 231, 255, 0.6);
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
    width: 84px;
    height: 84px;
  }

  .ag-meter-orb {
    inset: 9px;
  }

  .ag-meter-value {
    font-size: 22px;
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
</style>
