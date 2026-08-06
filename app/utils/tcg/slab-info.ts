import type { SlabInfo } from '~/utils/tcg/slab'
import type { TcgGradePayload } from '#shared/types/tcg'
import { gradeTextFor, formatGrade } from '#shared/utils/tcg/grade-text'

export interface SlabCardMeta {
    name: string
    rarity?: string | null
    number?: string | null
    setTotal?: number | null
    setName?: string | null
    setCode?: string | null
    releaseDate?: string | null
}

/** Assemble the label data for a graded copy's slab from card + grade. */
export function buildSlabInfo(card: SlabCardMeta, grade: TcgGradePayload): SlabInfo {
    const year = (card.releaseDate ?? '').slice(0, 4)
    const lines = [
        card.name,
        [year, 'Pokémon', card.setName ?? ''].filter(Boolean).join(' '),
        [
            card.setCode && card.number
                ? `${card.setCode} #${card.number}${card.setTotal ? `/${card.setTotal}` : ''}`
                : null,
            card.rarity
        ].filter(Boolean).join(' · ')
    ].filter(line => line !== '')

    const subs = grade.subGrades
    const subgrades = subs && grade.service !== 'GAG'
        ? {
                centering: formatGrade(subs.centering ?? 10),
                corners: formatGrade(subs.corners ?? 10),
                edges: formatGrade(subs.edges ?? 10),
                surface: formatGrade(subs.surface ?? 10)
            }
        : subs
            ? {
                    // GAG reports per-face eights; the slab's subgrade row shows
                    // the worst of each pair, which is what the grade used.
                    centering: formatGrade(Math.min(subs.centering_f ?? 10, subs.centering_b ?? 10)),
                    corners: formatGrade(Math.min(subs.corners_f ?? 10, subs.corners_b ?? 10)),
                    edges: formatGrade(Math.min(subs.edges_f ?? 10, subs.edges_b ?? 10)),
                    surface: formatGrade(Math.min(subs.surface_f ?? 10, subs.surface_b ?? 10))
                }
            : undefined

    return {
        lines,
        cardNumber: card.number ?? undefined,
        grade: formatGrade(grade.grade),
        gradeText: gradeTextFor(grade.service, grade.grade),
        subgrades,
        score: grade.score !== null && grade.score !== undefined ? String(grade.score) : undefined,
        designation: grade.designation,
        serial: grade.certNumber,
        seed: grade.certNumber
    }
}
