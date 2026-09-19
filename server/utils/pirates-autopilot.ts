// Pirate Raid auto-play is limited to these accounts while it is being tried out.
const PIRATE_AUTOPILOT_EMAILS = new Set(['rijstenpap1234@hotmail.com'])

export function canUsePirateAutopilot(email: string | null | undefined) {
    return !!email && PIRATE_AUTOPILOT_EMAILS.has(email.trim().toLowerCase())
}
