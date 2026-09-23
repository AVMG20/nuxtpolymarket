// Autoplay state shared by the slot games. The control bar collects the
// settings (SlotAutoSpinDialog); the game starts it, reports each finished
// round and asks whether to spin again. Returned as a reactive object, so
// `autoplay.left` and `autoplay.active` read the same in script and template.
import type { SlotAutoSettings } from '~/utils/slots/slot-controls'

export function useSlotAutoplay() {
  /** Spins left, counting the one in progress. 0 when autoplay is off. */
  const left = ref(0)
  const active = computed(() => left.value > 0)
  let rules: SlotAutoSettings = { count: 0, stopOnBonus: false, stopOnWinX: 0, stopOnLossPct: 0 }
  let startBalance = 0

  function start(settings: SlotAutoSettings, balance: number) {
    rules = { ...settings }
    startBalance = balance
    left.value = Math.max(0, Math.floor(settings.count))
  }

  function stop() {
    left.value = 0
  }

  /** A bonus just triggered: stop here when the player asked for that. */
  function bonusHit() {
    if (left.value > 0 && rules.stopOnBonus) stop()
  }

  /**
   * Count a finished round and apply the stop rules. Returns true when the
   * next autoplay spin should start.
   */
  function finish(round: { payout: number, bet: number, bonus?: boolean }, balance: number, nextCost: number): boolean {
    if (left.value <= 0) return false
    left.value--
    if (round.bonus && rules.stopOnBonus) stop()
    if (rules.stopOnWinX > 0 && round.payout >= round.bet * rules.stopOnWinX) stop()
    if (rules.stopOnLossPct > 0 && balance <= startBalance * (1 - rules.stopOnLossPct / 100)) stop()
    if (balance < nextCost) stop()
    return left.value > 0
  }

  return reactive({ left, active, start, stop, bonusHit, finish })
}
