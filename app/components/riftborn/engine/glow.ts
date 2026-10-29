/*
 * Bloom for the additive FX layer: blur a copy with Pixi's BlurFilter and
 * add it back on top of the sharp original. Applied to one container (the
 * glowing effects), never to individual sprites. Rendered at the target's
 * own resolution, so nothing drops below native pixels. GLSL only.
 */
import { BlurFilter, defaultFilterVert, Filter, GlProgram, Texture, TexturePool, UniformGroup } from 'pixi.js'
import type { FilterSystem, RenderSurface } from 'pixi.js'

const FRAG = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uBloom;
uniform float uStrength;
void main(void) {
    vec4 c = texture(uTexture, vTextureCoord);
    vec4 b = texture(uBloom, vTextureCoord);
    // Both are premultiplied and >= 0; no pow/log/sqrt involved
    finalColor = c + b * max(uStrength, 0.0);
}`

export class GlowFilter extends Filter {
    private readonly blur: BlurFilter
    private readonly u: { uStrength: number }

    constructor(strength = 1.1, blur = 10) {
        const glProgram = GlProgram.from({ vertex: defaultFilterVert, fragment: FRAG, name: 'riftborn-glow' })
        const group = new UniformGroup({ uStrength: { value: strength, type: 'f32' } })
        super({ glProgram, resources: { glowUniforms: group, uBloom: Texture.WHITE.source }, resolution: 'inherit', blendMode: 'add', padding: 0 })
        this.u = group.uniforms as { uStrength: number }
        this.blur = new BlurFilter({ strength: blur, quality: 3, resolution: 'inherit' })
    }

    set strength(v: number) {
        this.u.uStrength = v
    }

    get strength(): number {
        return this.u.uStrength
    }

    override apply(filterManager: FilterSystem, input: Texture, output: RenderSurface, clearMode: boolean): void {
        const tmp = TexturePool.getSameSizeTexture(input)
        this.blur.apply(filterManager, input, tmp, true)
        this.resources.uBloom = tmp.source
        filterManager.applyFilter(this, input, output, clearMode)
        TexturePool.returnTexture(tmp)
    }

    override destroy(): void {
        this.blur.destroy()
        super.destroy()
    }
}
