import { formatHq, formatHqShort, type DecimalSource, type HqNotation } from '#shared/utils/hero-quest/numbers'
import { HQ_SETTING_DEFAULTS } from '#shared/utils/hero-quest/settings'
import type { HqStateResponse } from '#server/utils/hero-quest-api'

/**
 * The player's big-number notation, and formatters bound to it, for any Hero Quest view. Reads the
 * state `useHeroQuest` already holds rather than fetching it, so a wiki page costs no settle; before
 * that read lands it is the default.
 */
export function useHqNotation() {
    const { data } = useNuxtData<HqStateResponse>('hero-quest-state')
    const notation = computed<HqNotation>(() => data.value?.settings?.numberNotation ?? HQ_SETTING_DEFAULTS.numberNotation)
    return {
        notation,
        /** `formatHq` in the player's notation; reading it inside a computed or a template re-renders on a change. */
        fmt: (value: DecimalSource, precision?: number) => formatHq(value, notation.value, precision),
        /** `formatHqShort` in the player's notation. */
        fmtShort: (value: DecimalSource) => formatHqShort(value, notation.value)
    }
}
