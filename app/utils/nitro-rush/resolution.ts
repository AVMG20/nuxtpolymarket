/** Standard screens get this much for the thin neon; Retina already supersamples. */
const SUPERSAMPLE = 1.5
/** Supersampling's own pixel budget, so a 4K monitor at 100% scaling never asks for a 19-megapixel HDR target. */
const SUPERSAMPLE_BUDGET = 9e6
/** So little supersampling only softens the browser's downscale, so it renders native instead. */
const MIN_SUPERSAMPLE = 0.2

/** The render's pixel ratio: backed off when frames run long, crept back up with headroom, never below native. */
export class AdaptiveResolution {
    ratio: number
    /** Frames aren't the race's own for now (a menu drawing 3D of its own), so they say nothing about the machine. */
    held = false
    private readonly standardScreen: boolean
    /** Never below the screen's own pixels on a standard screen; Retina may drop to 1 when slow. */
    private readonly floor: number
    /** The most the view's size allows. */
    private fitted: number
    /** The ratio that last ran slow is never tried again this session. */
    private slowCap = Infinity
    private frameAvg = 1 / 60
    private changedAt = 0

    constructor(devicePixelRatio: number) {
        this.standardScreen = devicePixelRatio < SUPERSAMPLE
        this.floor = this.standardScreen ? Math.max(1, devicePixelRatio) : 1
        this.fitted = this.standardScreen ? SUPERSAMPLE : Math.min(devicePixelRatio, 2)
        this.ratio = this.fitted
    }

    private get max() {
        return Math.min(this.fitted, this.slowCap)
    }

    /** Holds a standard screen's supersampling to the budget at this view size. */
    fit(width: number, height: number) {
        if (!this.standardScreen) return
        const fitted = Math.min(SUPERSAMPLE, Math.sqrt(SUPERSAMPLE_BUDGET / Math.max(1, width * height)))
        this.fitted = fitted < this.floor + MIN_SUPERSAMPLE ? this.floor : fitted
        this.ratio = Math.min(this.ratio, this.max)
    }

    /** Feeds one frame's time; true when the ratio changed and the canvas needs resizing. */
    sample(dt: number, time: number) {
        if (this.held) return false
        this.frameAvg += (dt - this.frameAvg) * 0.05
        // Settle between changes: a resize mid-race is a visible hitch, so it must never flap.
        if (time - this.changedAt < 3) return false
        let next = this.ratio
        if (this.frameAvg > 1 / 45 && this.ratio > this.floor) {
            next = Math.max(this.floor, this.ratio - 0.25)
            this.slowCap = next
        } else if (this.frameAvg < 1 / 58 && this.ratio < this.max && time - this.changedAt > 8) {
            next = Math.min(this.max, this.ratio + 0.1)
        }
        if (Math.abs(next - this.ratio) <= 0.001) return false
        this.ratio = next
        this.changedAt = time
        return true
    }
}
