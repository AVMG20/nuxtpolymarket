// Shared types for the slot control bar (app/components/slots). Every slot
// passes the same props; only the colour set differs per game.
import formatNumber from '~/utils/format-number'

/** Colours and fonts the control bar, its dialogs and its popover use. */
export interface SlotTheme {
    /** Spin button, active toggles and primary dialog buttons. */
    accent: string
    /** Darker end of the spin button gradient. */
    accentDeep: string
    /** Icons and text drawn on the accent colour. */
    onAccent: string
    /** Bar background. */
    surface: string
    /** Background of the round and tile buttons. */
    control: string
    /** Hairlines and dividers. */
    line: string
    text: string
    muted: string
    /** Colour of a non-zero win. */
    win: string
    /** Buy bonus button: its own colour so it stands apart from spin. */
    buy: string
    /** Text on the buy bonus button. */
    onBuy: string
    /** Dialog panel background. */
    panel: string
    /** Font for labels; numbers always use tabular figures. */
    font?: string
    /** Font for the big numbers (balance, bet, win). */
    numberFont?: string
}

export interface SlotBuyOption {
    id: string
    title: string
    /** One short line: what the player gets. */
    description: string
    cost: number
    /** Image URL shown in the buy dialog. */
    image?: string
}

export interface SlotAutoSettings {
    count: number
    /** Stop when a bonus or free spins round triggers. */
    stopOnBonus: boolean
    /** Stop after a single round wins at least this many × bet; 0 = never. */
    stopOnWinX: number
    /** Stop once the balance has dropped this many percent since autoplay started; 0 = never. */
    stopOnLossPct: number
}

/**
 * What the spin button does right now: start a spin, stop spinning reels,
 * skip the win presentation, or wait (disabled, shows a spinner).
 */
export type SlotSpinMode = 'spin' | 'stop' | 'skip' | 'wait'

export const SLOT_AUTO_COUNTS = [10, 25, 50, 100, 250, 500] as const
export const SLOT_AUTO_WIN_STOPS = [0, 10, 50, 100, 500] as const
export const SLOT_AUTO_LOSS_STOPS = [0, 10, 25, 50, 75] as const

/** CSS custom properties for a theme, bound on the bar and on each dialog. */
export function slotThemeVars(theme: SlotTheme): Record<string, string> {
    return {
        '--sc-accent': theme.accent,
        '--sc-accent-deep': theme.accentDeep,
        '--sc-on-accent': theme.onAccent,
        '--sc-surface': theme.surface,
        '--sc-control': theme.control,
        '--sc-line': theme.line,
        '--sc-text': theme.text,
        '--sc-muted': theme.muted,
        '--sc-win': theme.win,
        '--sc-buy': theme.buy,
        '--sc-on-buy': theme.onBuy,
        '--sc-panel': theme.panel,
        '--sc-font': theme.font ?? 'inherit',
        '--sc-number-font': theme.numberFont ?? theme.font ?? 'inherit'
    }
}

/** Win and balance figures: whole numbers without decimals, anything else with two. */
export function slotAmount(value: number, compact = false): string {
    const rounded = Math.round(value * 100) / 100
    if (compact) return formatNumber(rounded)
    return formatNumber(rounded, false, Number.isInteger(rounded) ? 0 : 2)
}
