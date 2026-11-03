// Rail Tycoon — texts the world chooser's lists share.

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** When a world was last played, relative to `now`: "just now", "5 minutes ago", or a date past a month. */
export function rtLastActiveText(at: number, now: number): string {
    const seconds = Math.round((at - now) / 1000)
    const abs = Math.abs(seconds)
    if (abs < 60) return 'just now'
    if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute')
    if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour')
    if (abs < 86400 * 30) return relative.format(Math.round(seconds / 86400), 'day')
    return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "3 members", or "3 of 8 members" for a world with a company cap. */
export function rtMembersText(memberCount: number, maxCompanies: number | null): string {
    return maxCompanies === null ? `${memberCount} members` : `${memberCount} of ${maxCompanies} members`
}
