<script setup lang="ts">
// Rail Tycoon — the bottom status bar: the game date, the player's company with its colour,
// cash in the game's own pounds (red below zero) and the connection state.
import { rtCompanyCss, rtFormatDate, rtFormatMoney, useRtGame, type RtConnectionStatus } from '~/utils/rail-tycoon/windows'

const game = useRtGame()

const view = computed(() => {
  void game.tick.value
  const ls = game.lockstep.value
  if (!ls) return null
  const company = game.company()
  return {
    date: rtFormatDate(ls.world.date),
    company: company
      ? { name: company.name, colour: rtCompanyCss(company.colour), money: company.money }
      : null
  }
})

const STATUS: Record<RtConnectionStatus, { label: string, tone: 'ok' | 'warn' | 'bad' | 'muted' }> = {
  connecting: { label: 'Connecting', tone: 'warn' },
  connected: { label: 'Connected', tone: 'ok' },
  reconnecting: { label: 'Reconnecting', tone: 'warn' },
  resyncing: { label: 'Resyncing', tone: 'warn' },
  spectating: { label: 'Spectating', tone: 'muted' },
  closed: { label: 'World closed', tone: 'muted' },
  stopped: { label: 'Disconnected', tone: 'bad' }
}

const connection = computed(() => STATUS[game.status.value])
</script>

<template>
  <div class="rt-status" role="status">
    <span class="rt-status-cell rt-status-date">{{ view?.date ?? '…' }}</span>
    <span v-if="view?.company" class="rt-status-cell rt-status-company">
      <span class="rt-status-swatch" :style="{ background: view.company.colour }" />
      <span class="rt-status-name">{{ view.company.name }}</span>
      <span class="rt-status-money" :class="{ 'rt-status-negative': view.company.money < 0 }">
        {{ rtFormatMoney(view.company.money) }}
      </span>
    </span>
    <span v-else class="rt-status-cell rt-status-company rt-status-muted">{{ game.role.value === 'spectator' ? 'Spectator' : 'No company' }}</span>
    <span class="rt-status-cell rt-status-conn" :class="`rt-tone-${connection.tone}`">
      <span class="rt-status-dot" />
      {{ connection.label }}
    </span>
  </div>
</template>

<style scoped>
.rt-status {
  display: flex;
  align-items: stretch;
  gap: 2px;
  height: var(--rt-status-h, 26px);
  padding: 2px;
  background: #3a352c;
  border-top: 1px solid #14120e;
  box-shadow: inset 0 1px 0 #6b6455;
  color: #ece6d6;
  font-size: 12px;
  line-height: 1;
}
.rt-status-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 0 10px;
  border: 1px solid #201d17;
  background: #2b2720;
  white-space: nowrap;
}
.rt-status-date {
  flex-shrink: 0;
  font-weight: 700;
}
.rt-status-company {
  flex: 1;
  justify-content: center;
  overflow: hidden;
}
.rt-status-name {
  overflow: hidden;
  text-overflow: ellipsis;
}
.rt-status-swatch {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border: 1px solid rgba(0, 0, 0, 0.6);
}
.rt-status-money {
  flex-shrink: 0;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.rt-status-negative {
  color: #ff6b5a;
}
.rt-status-muted {
  color: #a8a08c;
}
.rt-status-conn {
  flex-shrink: 0;
}
.rt-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}
.rt-tone-ok {
  color: #8fd46a;
}
.rt-tone-warn {
  color: #f0c050;
}
.rt-tone-bad {
  color: #ff6b5a;
}
.rt-tone-muted {
  color: #a8a08c;
}
@media (max-width: 480px) {
  .rt-status-cell {
    padding: 0 6px;
  }
  .rt-status-name {
    display: none;
  }
}
</style>
