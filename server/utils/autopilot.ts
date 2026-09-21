// Auto-play (Pirate Raid, SHAPEZZ) is limited to these accounts while it is being tried out.
const AUTOPILOT_EMAILS = new Set(['rijstenpap1234@hotmail.com'])

export function canUseAutopilot(email: string | null | undefined) {
    return !!email && AUTOPILOT_EMAILS.has(email.trim().toLowerCase())
}
