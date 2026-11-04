import * as THREE from 'three'
import type { RushPost } from './post'

/** The race's screen grade: nitro's cool shift, plus the flashes and aberration events kick off. */
export class RaceGrade {
    /** How far nitro has eased in, 0 to 1. */
    nitroK = 0
    private aberration = 0
    private readonly flashColor = new THREE.Color(0, 0, 0)
    private readonly tint = new THREE.Color(0.75, 0.9, 1.25)

    pulse(amount: number) {
        this.aberration = Math.max(this.aberration, amount)
    }

    flash(r: number, g: number, b: number) {
        this.flashColor.setRGB(r, g, b)
    }

    easeNitro(dt: number, nitro: boolean) {
        this.nitroK += ((nitro ? 1 : 0) - this.nitroK) * Math.min(1, dt * (nitro ? 6 : 2.5))
    }

    /** Decays the events and hands the frame's grade to the post chain. */
    apply(post: RushPost, dt: number, speedK: number, blend: number) {
        this.aberration = Math.max(0, this.aberration - dt * 2.6)
        this.flashColor.multiplyScalar(Math.exp(-dt * 7))
        post.set({
            radial: (this.nitroK * 0.16 + Math.max(0, speedK - 0.4) * 0.25) * blend,
            aberration: this.aberration + 0.08 * blend + this.nitroK * 0.25,
            flash: this.flashColor,
            tint: this.tint,
            tintAmount: this.nitroK * 0.35,
            saturation: 1,
            vignette: 0.25 + this.nitroK * 0.4,
            bloom: 0.55 + this.nitroK * 0.2
        })
    }
}
