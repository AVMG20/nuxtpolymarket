import type { TcgSetStatus } from '#shared/types/tcg'

/** Badge color type accepted by UBadge/UButton color props. */
type UiColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

/**
 * Map a checklist rarity string to a Nuxt UI badge color. Keyword-based so it
 * survives the long tail of TCG rarity names ('Special Art Rare', 'Crown Rare'…).
 */
export function rarityColor(rarity: string | null | undefined): UiColor {
  const r = (rarity ?? '').toLowerCase()
  if (!r || r === 'common') return 'neutral'
  if (r === 'uncommon') return 'success'
  if (r.includes('crown') || r.includes('immersive') || r.includes('hyper')) return 'warning'
  if (r.includes('special') || r.includes('ultra') || r.includes('super')) return 'secondary'
  if (r.includes('art') || r.includes('illustration')) return 'info'
  if (r.includes('double')) return 'primary'
  if (r.includes('rare')) return 'info'
  return 'neutral'
}

/** draft = warning tone, committed = success tone. */
export function setStatusColor(status: TcgSetStatus | string): UiColor {
  return status === 'committed' ? 'success' : 'warning'
}

/** Label for a printing finish/pattern combo, e.g. 'Reverse (pokeball)'. */
export function finishLabel(finish: string, pattern?: string | null): string {
  const base = finish === 'nonholo' ? 'Non-holo' : finish.charAt(0).toUpperCase() + finish.slice(1)
  return pattern ? `${base} (${pattern})` : base
}

export const useTcgAdmin = () => {
  const toast = useToast()

  /**
   * POST an admin endpoint. Toasts a success message when given one, toasts
   * the API error (statusMessage) on failure and rethrows so callers can bail.
   */
  async function call<T = unknown>(url: string, body?: Record<string, unknown>, successMsg?: string): Promise<T> {
    try {
      const res = await $fetch(url, { method: 'POST', body })
      if (successMsg) toast.add({ title: successMsg, color: 'success' })
      return res as T
    } catch (e) {
      toast.add({ title: apiErrorMessage(e, 'Something went wrong'), color: 'error' })
      throw e
    }
  }

  return { call }
}
