<script setup lang="ts">
import type { Card } from '#shared/utils/gamelogic/blackjack'

defineProps<{ card: Card }>()

function suitSymbol(suit: string): string {
  switch (suit) {
    case 'hearts': return '♥'
    case 'diamonds': return '♦'
    case 'clubs': return '♣'
    case 'spades': return '♠'
    default: return ''
  }
}

function isRed(suit: string): boolean {
  return suit === 'hearts' || suit === 'diamonds'
}
</script>

<template>
  <div class="bj-card-inner" :class="{ 'bj-card-flipped': card.isHidden }">
    <!-- Front -->
    <div class="bj-card-face bj-card-front" :style="{ color: isRed(card.suit) ? '#dc2626' : '#111827' }">
      <!-- Top-left pip -->
      <div class="flex flex-col items-center leading-none self-start">
        <span class="text-lg sm:text-xl font-bold">{{ card.rank }}</span>
        <span class="text-sm sm:text-base">{{ suitSymbol(card.suit) }}</span>
      </div>
      <!-- Center suit watermark -->
      <div class="absolute inset-0 flex items-center justify-center pointer-events-none select-none"
           :style="{ color: isRed(card.suit) ? '#dc2626' : '#111827', opacity: 0.12 }">
        <span class="text-7xl sm:text-8xl">{{ suitSymbol(card.suit) }}</span>
      </div>
      <!-- Bottom-right pip (rotated) -->
      <div class="flex flex-col items-center leading-none self-end rotate-180">
        <span class="text-lg sm:text-xl font-bold">{{ card.rank }}</span>
        <span class="text-sm sm:text-base">{{ suitSymbol(card.suit) }}</span>
      </div>
    </div>

    <!-- Back -->
    <div class="bj-card-face bj-card-back">
      <div class="w-full h-full flex items-center justify-center relative" style="background: #1e40af;">
        <div class="absolute inset-0 opacity-25"
             style="background-image: radial-gradient(#ffffff 1.5px, transparent 1.5px); background-size: 10px 10px;" />
        <div class="w-10 h-10 sm:w-12 sm:h-12 rounded-full border-4 flex items-center justify-center z-10 shadow-lg"
             style="border-color: rgba(255,255,255,0.5);">
          <div class="w-4 h-4 sm:w-5 sm:h-5 rotate-45" style="background: rgba(255,255,255,0.5);" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bj-card-inner {
  width: 100%;
  height: 100%;
  transition: transform 0.5s ease;
  transform-style: preserve-3d;
  border-radius: 0.75rem;
  box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.15), 0 4px 6px -4px rgb(0 0 0 / 0.1);
}
.bj-card-flipped {
  transform: rotateY(180deg);
}
.bj-card-face {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  border-radius: 0.75rem;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
}
.bj-card-front {
  background: #ffffff;
  border: 1px solid #d1d5db;
  padding: 0.5rem;
}
.bj-card-back {
  transform: rotateY(180deg);
  border: 2px solid rgba(255, 255, 255, 0.25);
}
</style>
