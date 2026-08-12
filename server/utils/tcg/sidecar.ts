// The one way in to the pokemonplaatjes sidecar: checklist data, pull-rate
// templates and card prices all come from it.
//
// Failure policy deliberately stays with the caller rather than living here.
// Reads degrade — an admin picker that renders with an empty list still lets
// the rest of the page work — while writes throw, because there is no set to
// create without the checklist behind it. Centralising the policy would force
// one of those two to be wrong. The timeout is a caller's choice for the same
// reason: a single price lookup should give up quickly, a paged checklist
// import legitimately runs longer.

/** What an interactive lookup waits before deciding the sidecar is gone. */
export const SIDECAR_TIMEOUT_MS = 5000

/**
 * Untyped fetch for sidecar URLs — route-type inference over the grown API
 * union hits TS2589 even for external template-literal URLs.
 */
export function sidecarFetch<T = unknown>(url: string, opts?: Record<string, unknown>): Promise<T> {
    const request = $fetch as (url: string, opts?: Record<string, unknown>) => Promise<T>
    return request(url, opts)
}

/** The message every write path uses when the sidecar cannot be reached. */
export const sidecarUnreachable = (apiBase: string) =>
    `Could not reach the pokemonplaatjes sidecar at ${apiBase} — is it running?`
