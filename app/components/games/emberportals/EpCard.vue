<script setup lang="ts">
// Free-spins intro, retrigger and outro card. It slams in on a bed of CSS
// flames; the outro counts the feature total up over `countMs`.
const props = defineProps<{
  kind: 'fs' | 'fs-end' | 'retrigger'
  title: string
  sub: string
  amount: number
  art?: string
  countMs?: number
}>()

defineEmits<{ skip: [] }>()

const shown = ref(props.kind === 'fs-end' ? 0 : props.amount)
let raf = 0

onMounted(() => {
  if (props.kind !== 'fs-end' || props.amount <= 0) {
    shown.value = props.amount
    return
  }
  const ms = props.countMs ?? 1600
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms)
    shown.value = props.amount * (1 - (1 - t) ** 3)
    if (t < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
})

onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <div class="ep-card-wrap" @click="$emit('skip')">
    <div class="ep-card" :class="`is-${kind}`">
      <div class="ep-card__flames" aria-hidden="true">
        <span v-for="i in 9" :key="i" :style="{ '--i': i }" />
      </div>
      <img v-if="art" :src="art" alt="" class="ep-card__art">
      <p class="ep-card__title">
        {{ title }}
      </p>
      <p v-if="kind === 'fs-end'" class="ep-card__amount" :class="{ 'is-zero': amount <= 0 }">
        {{ formatNumber(shown) }}
      </p>
      <p class="ep-card__sub">
        {{ sub }}
      </p>
      <p class="ep-card__hint">
        Tap to continue
      </p>
    </div>
  </div>
</template>

<style scoped>
.ep-card-wrap {
  position: absolute;
  inset: 0;
  z-index: 35;
  display: grid;
  place-items: center;
  padding: 16px;
  cursor: pointer;
  container-type: inline-size;
}

.ep-card {
  --c1: #ffc247;
  --c2: #ff5a1a;
  position: relative;
  width: min(460px, 92%);
  padding: 22px 24px 18px;
  border-radius: 22px;
  text-align: center;
  color: #e6ecff;
  background:
    radial-gradient(ellipse 90% 60% at 50% 0%, rgba(255, 138, 31, 0.4), transparent 70%),
    linear-gradient(180deg, #2a1a3a, #0b0f22 70%);
  border: 2px solid rgba(255, 194, 71, 0.7);
  box-shadow: 0 0 0 4px rgba(8, 10, 24, 0.9), 0 0 50px rgba(255, 138, 31, 0.6), 0 0 120px rgba(255, 90, 26, 0.35), 0 24px 60px rgba(0, 0, 0, 0.7);
  animation: ep-card-slam 0.55s cubic-bezier(0.2, 1.6, 0.35, 1) both;
}

.ep-card.is-retrigger {
  --c1: #9fe8ff;
  --c2: #1a8fd6;
  border-color: rgba(127, 220, 255, 0.8);
  background:
    radial-gradient(ellipse 90% 60% at 50% 0%, rgba(53, 198, 255, 0.4), transparent 70%),
    linear-gradient(180deg, #1b2447, #0b0f22 70%);
  box-shadow: 0 0 0 4px rgba(8, 10, 24, 0.9), 0 0 50px rgba(53, 198, 255, 0.6), 0 24px 60px rgba(0, 0, 0, 0.7);
}

.ep-card__flames {
  position: absolute;
  left: 4%;
  right: 4%;
  top: -34px;
  height: 60px;
  display: flex;
  justify-content: space-around;
  align-items: flex-end;
  pointer-events: none;
  filter: blur(1px);
}

.ep-card__flames span {
  width: 11%;
  height: 100%;
  border-radius: 50% 50% 35% 35% / 70% 70% 30% 30%;
  background: radial-gradient(ellipse at 50% 85%, #fff8d8 0%, var(--c1) 30%, var(--c2) 65%, transparent 75%);
  mix-blend-mode: screen;
  transform-origin: 50% 100%;
  animation: ep-card-flame calc(0.5s + var(--i) * 0.07s) ease-in-out infinite alternate;
  animation-delay: calc(var(--i) * -0.13s);
}

.ep-card__art {
  display: block;
  width: clamp(72px, 22cqw, 120px);
  margin: -64px auto 6px;
  filter: drop-shadow(0 0 22px rgba(255, 138, 31, 0.9));
  animation: ep-card-spin 6s linear infinite;
}

.ep-card__title {
  font-family: var(--ep-display, Georgia, serif);
  font-size: clamp(30px, 9cqw, 58px);
  font-weight: 900;
  line-height: 1.05;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: linear-gradient(180deg, #ffffff 5%, var(--c1) 50%, var(--c2) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 3px 0 #140a06) drop-shadow(0 0 18px var(--c2));
  animation: ep-card-title 0.7s cubic-bezier(0.2, 1.8, 0.4, 1) 0.1s both;
}

.ep-card__amount {
  margin-top: 6px;
  font-family: var(--ep-number, Georgia, serif);
  font-size: clamp(32px, 9cqw, 58px);
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  color: #fff4dc;
  -webkit-text-stroke: 2px #140a06;
  paint-order: stroke fill;
  text-shadow: 0 3px 0 #140a06, 0 0 22px rgba(255, 170, 60, 0.9), 0 0 50px rgba(255, 110, 30, 0.6);
}

.ep-card__amount.is-zero { color: #9fb2d9; text-shadow: 0 3px 0 #140a06; }

.ep-card__sub {
  margin-top: 8px;
  font-family: var(--ep-ui, system-ui, sans-serif);
  font-size: clamp(13px, 2.8cqw, 15px);
  line-height: 1.5;
  color: #d9e2ff;
}

.ep-card__hint {
  margin-top: 10px;
  font-family: var(--ep-ui, system-ui, sans-serif);
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(159, 178, 217, 0.7);
}

@keyframes ep-card-slam {
  0% { transform: scale(2.4) rotate(-4deg); opacity: 0; filter: brightness(3); }
  60% { transform: scale(0.94) rotate(1deg); opacity: 1; filter: brightness(1.4); }
  100% { transform: scale(1) rotate(0); filter: brightness(1); }
}

@keyframes ep-card-title {
  0% { transform: scale(0.2); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

@keyframes ep-card-flame {
  0% { transform: scaleY(0.7) scaleX(1.1) skewX(-4deg); opacity: 0.75; }
  100% { transform: scaleY(1.25) scaleX(0.85) skewX(5deg); opacity: 1; }
}

@keyframes ep-card-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .ep-card, .ep-card__title { animation-duration: 0.01s; }
  .ep-card__art, .ep-card__flames span { animation: none; }
}
</style>
