/** The render's pixel ratio: backed off when frames run long, crept back up with headroom, never below native. */
export class AdaptiveResolution {
    ratio: number
    private max: number
    private frameAvg = 1 / 60
    private changedAt = 0

    constructor(devicePixelRatio: number) {
        // Retina already supersamples; standard screens get 1.5x for the thin neon.
        this.max = devicePixelRatio >= 1.5 ? Math.min(devicePixelRatio, 2) : 1.5
        this.ratio = this.max
    }

    /** Feeds one frame's time; true when the ratio changed and the canvas needs resizing. */
    sample(dt: number, time: number) {
        this.frameAvg += (dt - this.frameAvg) * 0.05
        // Settle between changes: a resize mid-race is a visible hitch, so it must never flap.
        if (time - this.changedAt < 3) return false
        let next = this.ratio
        if (this.frameAvg > 1 / 45 && this.ratio > 1) {
            next = Math.max(1, this.ratio - 0.25)
            // A ratio that ran slow is never tried again this session.
            this.max = next
        } else if (this.frameAvg < 1 / 58 && this.ratio < this.max && time - this.changedAt > 8) {
            next = Math.min(this.max, this.ratio + 0.1)
        }
        if (Math.abs(next - this.ratio) <= 0.001) return false
        this.ratio = next
        this.changedAt = time
        return true
    }
}
