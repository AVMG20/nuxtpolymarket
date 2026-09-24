<script setup lang="ts">
import type { AviaBooster } from '#shared/utils/gamelogic/aviamasters'

const { state } = useAviamastersGame()

defineProps<{ icons: Record<string, string> }>()

const names: Record<AviaBooster, [string, string]> = {
  nitro: ['Nitro', 'Rockets bounce off'],
  laser: ['Laser Gun', 'Shoots rockets down'],
  magnet: ['Magnet', 'Pulls in multipliers'],
  buoy: ['Life Buoy', 'Saves one splash']
}
</script>

<template>
  <div class="boosters">
    <TransitionGroup name="badge">
      <div v-for="b in state.boosters" :key="b" class="badge panel" :class="b">
        <img :src="icons[b]" alt="">
        <div>
          <div class="name display">{{ names[b][0] }}</div>
          <div class="desc">{{ names[b][1] }}</div>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.boosters {
  position: absolute;
  left: 16px;
  top: 96px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none !important;
}
.badge {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px 6px 6px;
  border-radius: 14px;
  animation: glow 1.2s ease-in-out infinite alternate;
}
.badge img {
  width: 44px;
  height: 44px;
}
.name {
  font-size: 18px;
}
.desc {
  font-size: 12px;
  font-weight: 800;
  opacity: 0.75;
}
.nitro {
  --c: 90, 200, 255;
}
.laser {
  --c: 41, 255, 176;
}
.magnet {
  --c: 255, 90, 106;
}
.buoy {
  --c: 255, 190, 60;
}
@keyframes glow {
  from {
    box-shadow: 0 0 0 1px rgba(var(--c), 0.4), 0 0 12px rgba(var(--c), 0.25);
  }
  to {
    box-shadow: 0 0 0 1px rgba(var(--c), 0.9), 0 0 26px rgba(var(--c), 0.55);
  }
}
.badge-enter-active {
  transition: all 0.4s cubic-bezier(0.2, 1.6, 0.4, 1);
}
.badge-leave-active {
  transition: all 0.3s;
}
.badge-enter-from {
  opacity: 0;
  transform: translateX(-60px) scale(0.6);
}
.badge-leave-to {
  opacity: 0;
  transform: translateX(-40px);
}
@container avia (max-width: 720px) {
  .boosters {
    top: 92px;
    left: 8px;
    gap: 4px;
  }
  .badge {
    padding: 3px 10px 3px 3px;
    border-radius: 10px;
  }
  .badge img {
    width: 30px;
    height: 30px;
  }
  .name {
    font-size: 13px;
  }
  .desc {
    display: none;
  }
}
</style>
