/**
 * The words printed next to the grade number on a slab label. BRK calls a 10
 * Pristine (its designation ladder tops out at Black Label); everyone else
 * calls it Gem Mint. Half grades take the label of the band they sit in.
 */
const SCALE: Array<[number, string]> = [
    [10, 'GEM MINT'],
    [9.5, 'GEM MINT'],
    [9, 'MINT'],
    [8.5, 'NM-MT+'],
    [8, 'NM-MT'],
    [7, 'NEAR MINT'],
    [6, 'EX-MT'],
    [5, 'EXCELLENT'],
    [4, 'VG-EX'],
    [3, 'VG'],
    [2, 'GOOD'],
    [1, 'POOR']
]

export function gradeTextFor(service: string, grade: string | number): string {
    const g = typeof grade === 'number' ? grade : parseFloat(grade)
    if (service === 'BRK' && g >= 10) return 'PRISTINE'
    for (const [bar, label] of SCALE) {
        if (g >= bar) return label
    }
    return 'POOR'
}

/** Sub-grade number the way labels print it: '10', '9.5'. */
export function formatGrade(value: number | string): string {
    const v = typeof value === 'string' ? parseFloat(value) : value
    return v % 1 === 0 ? String(v) : v.toFixed(1)
}
