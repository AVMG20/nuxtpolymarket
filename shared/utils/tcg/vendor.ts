/**
 * The vendor buyback (§7.4): the one Coin faucet in the module.
 *
 * The vendor pays what the card is worth in the real world — the dollar
 * price, read as Coins. With balances in the hundreds of thousands, that is
 * pennies, which is the point: a floor for genuinely worthless bulk, priced
 * per card so no short-printed chase is ever worth destroying, and an
 * emission so small the faucet cannot matter. Whole coins only; the floor
 * of floors is 1.
 */
export const TCG_VENDOR = {
    fallbackPrice: 1
}

export function vendorPrice(usd: number | null | undefined, eur: number | null | undefined): number {
    const real = usd ?? eur ?? TCG_VENDOR.fallbackPrice
    return Math.max(1, Math.round(real))
}
