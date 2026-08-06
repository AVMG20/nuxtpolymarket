export const BANK_DEBT_WARNING = 'You owe the bank. Part of everything you earn is taken automatically to repay it — open the Bank to see the details.'

/**
 * Whether the bank is currently taking a cut of what the player earns — a plain
 * yes/no, deliberately without amounts, since those belong on the bank page.
 *
 * Fetched once per page load and refreshed by hand after the bank actions that
 * can change it. Nothing polls: a stale `false` costs a red tint until the next
 * navigation, which is not worth a request on a timer from every page.
 */
export function useBankStatus() {
  const inDebt = useState('bank:in-debt', () => false)

  const refresh = async () => {
    try {
      inDebt.value = (await $fetch<{ inDebt: boolean }>('/api/bank/status')).inDebt
    } catch {
      // Signed out or offline: keep the last known answer rather than nagging.
    }
  }

  return { inDebt, refresh }
}
