/**
 * Chip denominations. Players at this table hold anywhere from a few thousand
 * to a few billion, so the ladder runs 1 → 100B on a 1/5/25 repeating step and
 * the UI only ever shows the window that matches the player's bankroll.
 *
 * `tier` drives how ornate the chip art gets: 0 is a plain clay chip, 4 is the
 * prismatic 100B plaque.
 */
export interface LbChip {
    value: number
    label: string
    /** Face colour. */
    base: number
    /** Colour of the rim spots. */
    edge: number
    /** Inner ring / detail colour. */
    accent: number
    text: number
    tier: 0 | 1 | 2 | 3 | 4
}

export const LB_CHIPS: readonly LbChip[] = [
    { value: 1, label: '1', base: 0xf1f5f9, edge: 0x94a3b8, accent: 0xcbd5e1, text: 0x0f172a, tier: 0 },
    { value: 5, label: '5', base: 0xdc2626, edge: 0xfee2e2, accent: 0x991b1b, text: 0xffffff, tier: 0 },
    { value: 25, label: '25', base: 0x15803d, edge: 0xdcfce7, accent: 0x14532d, text: 0xffffff, tier: 0 },
    { value: 100, label: '100', base: 0x1e293b, edge: 0xe2e8f0, accent: 0x0f172a, text: 0xffffff, tier: 0 },
    { value: 500, label: '500', base: 0x7c3aed, edge: 0xede9fe, accent: 0x4c1d95, text: 0xffffff, tier: 1 },
    { value: 1_000, label: '1K', base: 0xca8a04, edge: 0xfef9c3, accent: 0x713f12, text: 0x1c1917, tier: 1 },
    { value: 5_000, label: '5K', base: 0xea580c, edge: 0xffedd5, accent: 0x7c2d12, text: 0xffffff, tier: 1 },
    { value: 25_000, label: '25K', base: 0xdb2777, edge: 0xfce7f3, accent: 0x831843, text: 0xffffff, tier: 1 },
    { value: 100_000, label: '100K', base: 0x0284c7, edge: 0xe0f2fe, accent: 0x0c4a6e, text: 0xffffff, tier: 2 },
    { value: 500_000, label: '500K', base: 0x0d9488, edge: 0xccfbf1, accent: 0x134e4a, text: 0xffffff, tier: 2 },
    { value: 1_000_000, label: '1M', base: 0xf59e0b, edge: 0xfffbeb, accent: 0x78350f, text: 0x1c1917, tier: 2 },
    { value: 5_000_000, label: '5M', base: 0x9f1239, edge: 0xffe4e6, accent: 0x4c0519, text: 0xffffff, tier: 2 },
    { value: 25_000_000, label: '25M', base: 0x6d28d9, edge: 0xf5f3ff, accent: 0x2e1065, text: 0xffffff, tier: 2 },
    { value: 100_000_000, label: '100M', base: 0x047857, edge: 0xd1fae5, accent: 0x022c22, text: 0xffffff, tier: 3 },
    { value: 500_000_000, label: '500M', base: 0x1d4ed8, edge: 0xdbeafe, accent: 0x172554, text: 0xffffff, tier: 3 },
    { value: 1_000_000_000, label: '1B', base: 0xcbd5e1, edge: 0xf8fafc, accent: 0x475569, text: 0x0f172a, tier: 3 },
    { value: 5_000_000_000, label: '5B', base: 0xfb7185, edge: 0xfff1f2, accent: 0x881337, text: 0x1c1917, tier: 3 },
    { value: 25_000_000_000, label: '25B', base: 0x0b1120, edge: 0xfbbf24, accent: 0x78350f, text: 0xfbbf24, tier: 4 },
    { value: 100_000_000_000, label: '100B', base: 0x2dd4bf, edge: 0xfdf4ff, accent: 0x7e22ce, text: 0x0f172a, tier: 4 }
]

export const LB_MIN_BET = LB_CHIPS[0]!.value
export const LB_MAX_BET = LB_CHIPS[LB_CHIPS.length - 1]!.value

/** Number of chips shown in the rack at once. */
export const LB_RACK_SIZE = 7

/**
 * Pick the rack window for a bankroll: the largest chip the player can afford
 * anchors the right-hand end, so a billionaire never has to click 1s and a
 * player with 3,000 still sees chips they can actually place.
 */
export function chipRackFor(balance: number): LbChip[] {
    let top = 0
    for (let i = 0; i < LB_CHIPS.length; i++) {
        if (LB_CHIPS[i]!.value <= balance) top = i
    }
    const end = Math.min(LB_CHIPS.length, Math.max(LB_RACK_SIZE, top + 2))
    return LB_CHIPS.slice(Math.max(0, end - LB_RACK_SIZE), end)
}

/** Break an amount into a stack of chips, largest first, for rendering a bet spot. */
export function chipStack(amount: number, maxChips = 14): LbChip[] {
    const stack: LbChip[] = []
    let left = amount
    for (let i = LB_CHIPS.length - 1; i >= 0 && stack.length < maxChips; i--) {
        const chip = LB_CHIPS[i]!
        while (left >= chip.value && stack.length < maxChips) {
            stack.push(chip)
            left -= chip.value
        }
    }
    return stack
}
