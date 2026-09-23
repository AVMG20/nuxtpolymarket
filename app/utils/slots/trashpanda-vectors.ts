// One vector source for crisp SVGs in the UI and synchronous Pixi textures.
// Artwork uses a fixed illustration palette, independent of the app's color mode.
import type { TphArtId } from './trashpanda-art'

const ink = '#182333'
const cream = '#fff4d7'
const gold = '#ffc857'
const mint = '#77dfbe'
const steel = '#8eafbd'

interface Shape {
    d: string
    fill: string
    stroke: string
    width: number
}

interface Label {
    text: string
    x: number
    y: number
    size: number
    fill: string
}

interface Illustration {
    shapes: Shape[]
    labels: Label[]
}

// Draw the badge lettering as paths too: no font substitution or missing ×
// glyphs when the same artwork is rendered by SVG and Canvas on different OSes.
const lettering: Record<string, string> = {
    W: 'M0 0L1 10 3.5 5 6 10 7 0',
    I: 'M1 0H6M3.5 0V10M1 10H6',
    L: 'M0 0V10H7',
    D: 'M0 0V10H3Q7 10 7 5Q7 0 3 0Z',
    H: 'M0 0V10M7 0V10M0 5H7',
    E: 'M7 0H0V10H7M0 5H5',
    S: 'M7 1Q0 -2 0 3Q0 5 3.5 5Q7 5 7 8Q7 12 0 9',
    T: 'M0 0H7M3.5 0V10',
    V: 'M0 0L3.5 10 7 0',
    '0': 'M3.5 0Q0 0 0 5Q0 10 3.5 10Q7 10 7 5Q7 0 3.5 0Z',
    '1': 'M1 2L4 0V10M1 10H7',
    '2': 'M0 2Q1 -1 4 0Q9 1 5 5L0 10H7',
    '3': 'M0 1Q7 -2 7 2Q7 5 3 5Q7 5 7 8Q7 12 0 9',
    '5': 'M7 0H0V4Q7 3 7 7Q7 12 0 9',
    '×': 'M1 2L6 8M6 2L1 8',
    '?': 'M0 2Q0 0 3.5 0Q7 0 7 3Q7 5 3.5 6V7M3.5 10h0.01',
    '$': 'M7 2Q0 -1 0 3Q0 5 3.5 5Q7 5 7 7Q7 11 0 8M3.5 -1V11'
}

function illustration(id: TphArtId): Illustration {
    const shapes: Shape[] = []
    const labels: Label[] = []
    const p = (d: string, fill = 'none', stroke = ink, width = 5) => shapes.push({ d, fill, stroke, width })
    const e = (x: number, y: number, rx: number, ry: number, fill: string, stroke = ink, width = 5) =>
        p(`M${x - rx} ${y}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0`, fill, stroke, width)
    const line = (d: string, color = ink, width = 4) => p(d, 'none', color, width)
    const label = (text: string, x: number, y: number, size: number, fill = cream) => labels.push({ text, x, y, size, fill })
    const star = (x: number, y: number, r = 12) => p(`M${x} ${y - r}Q${x + 2} ${y - 2} ${x + r} ${y}Q${x + 2} ${y + 2} ${x} ${y + r}Q${x - 2} ${y + 2} ${x - r} ${y}Q${x - 2} ${y - 2} ${x} ${y - r}`, cream, 'none', 0)
    const coin = (x: number, y: number, r: number) => {
        e(x + 3, y + 5, r, r, '#bd7336')
        e(x, y, r, r, gold)
        e(x, y, r - 7, r - 7, 'none', '#d39242', 2)
        p(`M${x} ${y - 12}l8 12-8 12-8-12Z`, cream, 'none', 0)
        line(`M${x - r + 8} ${y - 6}q3 -10 13 -13`, cream, 3)
    }
    const mask = (y: number) => {
        p(`M42 ${y - 4}Q70 ${y - 38} 112 ${y - 14}L128 ${y - 5} 144 ${y - 14}Q186 ${y - 38} 214 ${y - 4}L204 ${y + 20}Q177 ${y + 38} 143 ${y + 12}Q128 ${y + 5} 113 ${y + 12}Q79 ${y + 38} 52 ${y + 20}Z`, ink, '#587780', 3)
        p(`M64 ${y - 1}q22 -10 43 5-22 19-43-5M149 ${y + 4}q21 -15 43 -5-21 24-43 5`, cream, 'none', 0)
        e(93, y + 4, 5, 8, '#228c83', 'none', 0)
        e(165, y + 4, 5, 8, '#228c83', 'none', 0)
        line(`M62 ${y - 12}q20 -12 43 0M151 ${y - 12}q20 -12 43 0`, '#587780', 3)
    }

    // A restrained contact shadow lets each silhouette read against the reels.
    e(128, 226, 76, 10, '#10182740', 'none', 0)

    // Only feature symbols get a full-size framed plaque. The silhouette and
    // oversized name distinguish them even without relying on accent color.
    if (id === 'safe' || id === 'bin') {
        const accent = id === 'safe' ? '#d8b4ff' : '#9bffd1'
        p('M48 15H208L237 44V207L208 239H48L19 207V44Z', id === 'safe' ? '#392454' : '#173f38', ink, 8)
        p('M48 15H208L237 44V207L208 239H48L19 207V44Z', 'none', accent, 4)
        line('M33 73V48L53 28H93M163 226H202L224 202V173', accent, 4)
    }

    switch (id) {
        case 'boss':
        case 'raccoon': {
            // Shoulders, bandana and a silver, angular face with asymmetrical eyes.
            p('M53 227Q56 192 94 181L161 181Q200 193 206 227Z', '#344f60')
            p('M91 182L127 200 165 182 150 226 121 216 104 230Z', '#e87765')
            line('M127 201l23 25M102 196l18 17', '#a54145', 3)
            p('M49 109Q20 76 32 40Q62 36 86 76M170 76Q194 38 223 41Q232 76 207 111', steel)
            p('M46 78L44 56Q65 58 72 80M184 80Q199 58 211 57L208 84', '#eab2a1', 'none', 0)
            p('M128 63Q180 63 202 111L218 126 209 135 229 147 212 156 219 169Q181 205 129 212Q78 206 37 174L46 158 27 147 46 133 38 124 54 111Q76 63 128 63Z', '#b9ced0')
            p('M130 67Q183 72 199 114L213 127 201 136 218 148 201 157 208 168Q177 194 129 205L137 179 154 139Z', '#7e9eaa', 'none', 0)
            p('M53 153Q77 154 105 169L128 154 151 168Q181 153 204 155Q191 186 130 203Q78 190 53 153Z', cream, 'none', 0)
            p('M87 96L114 86 107 105 70 107', cream, 'none', 0)
            p('M146 88L174 96 189 107 150 105Z', cream, 'none', 0)
            mask(130)
            p('M111 166Q128 158 145 166L132 180Q127 184 122 178Z', ink)
            line('M131 181q13 12 31 -1M92 178l-20 -5M91 186l-18 1', ink, 3)
            p('M151 186l8 -5-2 11-7 1Z', gold, ink, 2)
            line('M109 73l-9 7M125 69l-8 10', cream, 3)
            if (id === 'boss') {
                p('M52 86L72 76 83 27Q96 20 121 30L153 23Q165 21 173 34L187 76 208 86Q132 111 52 86Z', '#263e4e')
                p('M87 30L81 71 107 68 115 35Z', '#466577', 'none', 0)
                p('M77 65Q128 79 180 65L185 80Q129 96 73 80Z', '#e87765', ink, 3)
                line('M62 86q69 18 136 0', '#6f9099', 3)
                p('M162 61l9 -19 5 23Z', gold, ink, 2)
            }
            break
        }
        case 'wild':
        case 'wild2':
        case 'wild3':
        case 'wild5':
        case 'wild10': {
            p('M128 20L159 32 191 28 201 57 224 80 213 110 224 140 204 165 191 202 160 205 128 226 96 205 64 202 53 171 31 146 41 114 31 82 54 58 65 28 96 32Z', '#b2793c', '#fff0ac', 7)
            p('M128 27L156 40 187 37 194 65 214 84 204 111 214 139 195 160 184 192 157 196 128 215 99 196 72 192 61 165 41 143 51 114 41 84 62 65 73 37 99 40Z', gold, ink, 3)
            e(128, 118, 76, 76, '#ffe6a0', '#d49a49', 3)
            line('M75 70q25 -28 64 -22', cream, 4)
            mask(109)
            p('M25 155L231 155 222 213 34 213Z', '#244b50', gold, 5)
            label('WILD', 128, 184, 43)
            if (id !== 'wild') {
                const mult = id.slice(4)
                const accent = { '2': mint, '3': '#85cfef', '5': '#c6a3e8', '10': '#ff958c' }[mult]!
                e(190, 50, 35, 30, accent)
                label(`×${mult}`, 190, 51, mult === '10' ? 22 : 30, ink)
            } else {
                star(204, 42, 15)
            }
            break
        }
        case 'gem':
            p('M39 91L77 45 181 45 218 91 130 211Z', '#73dbdc')
            p('M39 91L218 91 130 211Z', '#2289a5', 'none', 0)
            p('M81 92L130 211 174 92Z', '#a4f5e5', 'none', 0)
            p('M77 45L81 92 126 45 174 92 181 45Z', '#e0fff0', 'none', 0)
            p('M39 91L81 92 77 45M126 45L81 92 130 211 174 92 126 45M174 92L218 91 181 45', 'none', '#205e77', 3)
            line('M50 88l31 -33h32', cream, 4)
            star(210, 47, 18)
            star(45, 166, 10)
            break
        case 'cash':
            p('M31 102L160 58 224 104 96 156Z', '#285e52')
            p('M31 103L96 143 224 103 221 145 95 194 31 150Z', '#f0e6bc')
            line('M35 119L96 158 220 118M34 132L95 174 220 132', '#99ab8c', 3)
            p('M31 98L160 54 224 98 95 145Z', mint)
            p('M48 98L157 64 205 96 98 132Z', 'none', '#358c73', 3)
            e(127, 99, 27, 13, '#3d9677', 'none', 0)
            line('M123 87l7 22M116 96q19 -14 18 -3t-18 10', '#d5f4c8', 3)
            p('M98 75L125 65 174 116 172 165 145 176 146 126Z', '#eec580', ink, 3)
            p('M150 130L170 122 169 157 149 166Z', '#ce9b58', 'none', 0)
            coin(56, 192, 23)
            star(202, 54, 11)
            break
        case 'bag':
            p('M94 83L79 37 108 45 128 31 145 46 176 37 161 85Z', '#efca89')
            p('M109 47L119 83 139 83 147 49', '#c38c4f', 'none', 0)
            p('M95 87Q54 117 42 174Q29 224 125 228Q220 228 214 183Q208 126 161 87Z', '#eac084')
            p('M153 94Q185 152 184 185Q181 213 87 217Q140 237 192 219Q226 203 206 162Q192 118 153 94Z', '#ba814b', 'none', 0)
            line('M84 111Q62 139 59 165', cream, 6)
            p('M87 81Q123 73 165 80L165 96Q124 90 88 99Z', '#4f8276', ink, 4)
            line('M158 88q32 1 25 27M160 88q-1 21 12 31', '#4f8276', 7)
            e(127, 159, 33, 35, '#f6d798', '#bc884b', 2)
            label('$', 128, 160, 44, '#7b562f')
            coin(194, 214, 21)
            break
        case 'safe':
            p('M49 52L176 35 217 66 216 209 78 228 42 197Z', '#456172')
            p('M176 35L217 66 216 209 177 185Z', '#263e4e')
            p('M48 54L178 38 178 190 44 207Z', '#bd98dd', '#f0daff', 4)
            p('M63 70L161 58 161 178 61 189Z', '#503570')
            line('M72 80L149 70', '#d8b4ff', 3)
            p('M48 83l17 -2v25l-17 2ZM47 155l17 -2v25l-17 2Z', '#c2d5cf', ink, 3)
            e(117, 126, 31, 32, '#1d303f', '#92afb5', 4)
            e(117, 126, 22, 23, '#e9bc70', ink, 3)
            for (let i = 0; i < 8; i++) {
                const a = i * Math.PI / 4
                line(`M${117 + Math.cos(a) * 16} ${126 + Math.sin(a) * 16}L${117 + Math.cos(a) * 20} ${126 + Math.sin(a) * 20}`, ink, 2)
            }
            line('M117 126l8 -11', ink, 4)
            p('M24 187H232L222 235H34Z', '#e1baff', ink, 5)
            label('HEIST', 128, 212, 35, '#30203f')
            star(202, 40, 15)
            break
        case 'bin':
            // The dark opening separates the raised lid from the body. Ears,
            // mask and paws make the peeking character readable at reel size.
            p('M39 66L210 51 210 135 40 141Z', '#101e28')
            p('M64 94L59 61Q80  50 97 79M159 76Q179  50 198 58L190 99', '#a7c5ca')
            p('M72 79L69 65 87 77M171 76L188  60 186 82', '#ecc5b4', 'none', 0)
            p('M61 118Q61 76 126 70Q192 71 197 116L182 138 80 139Z', '#b9ced0')
            mask(101)
            p('M118 128L138 128 129 137Z', ink)
            p('M40 125L211 121 195 205 54 210Z', '#4cba91', '#a0f3c2', 4)
            p('M170 126L207 124 194 204 165 207Z', '#247760', 'none', 0)
            line('M71 149l4  30 M177 145l-4 35', '#276f5c', 5)
            p('M34 119L215 115 216 133 36 139Z', '#85e0b4', ink, 4)
            // Two tiny paws hooked over the rim.
            e(80, 133, 16, 11, '#c9ded9', ink, 3)
            e(174, 129, 16, 11, '#c9ded9', ink, 3)
            line('M75 130v8M83 129v9M170 126v8M178 125v9', '#527785', 2)
            // Lid tipped upward, with a bright rim and visible handle.
            p('M31  60 L202 29 222 51  40 85Z', '#60bf98', ink, 5)
            p('M31 60L202 29 210 39 38 72Z', '#c1ffda', 'none', 0)
            line('M 60  60 L185 38', '#2c7e65', 4)
            p('M105 46L103 33 139 26 143 39', 'none', ink, 8)
            p('M105 46L103 33 139 26 143 39', 'none', '#aeedc5', 4)
            p('M112 151L139 147 147 176 118 180Z', '#d5edbe', ink, 2)
            line('M123 161l8 -7 7 6M135 164l-3 9-9 -2', '#34775b', 3)
            p('M24 187H232L222 235H34Z', '#9bffd1', ink, 5)
            label('DIVE', 128, 212, 39, '#183c32')
            break
        case 'can-closed':
            p('M61 85L72 218Q128 237 183 218L194 85Z', '#7899a6')
            p('M150 97L148 225 183 218 193 93Z', '#476978', 'none', 0)
            line('M83 111l7 93M108 116l3 91M146 115l-2 91M172 110l-7 92', '#c1d3d0', 5)
            p('M52 91Q48 69 78 60Q128 45 179 61Q206 72 203 91Q127 117 52 91Z', '#bed1ce')
            p('M56 84Q126 107 200 83L202 96Q128 121 53 97Z', '#628591', ink, 4)
            p('M106 60V44Q126 32 148 44V60L137 62V50H117V62Z', '#89a9b1', ink, 4)
            e(126, 161, 30, 31, '#315360', '#b0cecb', 3)
            label('?', 126, 162, 44)
            break
        case 'dog':
            p('M59 90L35 62Q21 93 41 133L65 122M180 89L211 59Q238 92 218 132L190 123', '#845b49')
            p('M61 81Q82 48 125 50Q178 44 198 83L208 144Q210 191 175 211L77 210Q41 189 47 144Z', '#bc9472')
            p('M143 53Q186 59 196 88L202 144 184 173 159 126Z', '#977051', 'none', 0)
            p('M109 55L100 113 127 132 149 111 138 53Z', '#ecd8b4', 'none', 0)
            p('M64 111L107 121Q91 143 72 132ZM151 120L191 107 185 130Q165 142 151 120Z', cream, ink, 3)
            e(93, 126, 5, 7, ink, 'none', 0)
            e(168, 125, 5, 7, ink, 'none', 0)
            line('M60 102L108 115M150 113L193 99', ink, 7)
            p('M126 144Q100 124 78 146Q53 173 77 193L101 194Q126 218 152 194L177 193Q201 166 177 144Q153 126 126 144Z', '#f1d8b1')
            p('M111 144Q127 135 144 144L136 159 121 160Z', ink)
            line('M128 160v13M96 184q30 -16 61 0', ink, 4)
            p('M87 180l11 -4-3 19ZM159 176l11 5-9 13Z', cream, ink, 2)
            p('M65 202Q127 221 190 199L189 220Q128 241 66 224Z', '#db7863')
            for (const x of [85, 128, 171]) p(`M${x - 6} 219l6 -14 7 15Z`, '#d4e5de', ink, 2)
            break
        case 'fish':
            p('M185 124L221 89 216 122 230 155 190 142Z', '#abd3d5')
            line('M83 135L195 128', ink, 15)
            line('M83 132L195 125', '#d9ece1', 8)
            for (const [x, h] of [[109, 32], [136, 28], [163, 22]] as const) {
                line(`M${x + 6} ${128 - h}Q${x - 14} 130 ${x + 8} ${131 + h}`, ink, 11)
                line(`M${x + 6} ${128 - h}Q${x - 14} 130 ${x + 8} ${131 + h}`, '#d9ece1', 6)
            }
            p('M91 84Q41 77 27 118L41 128 27 142Q49 177 91 169Q107 130 91 84Z', '#c8e3dd')
            p('M32 142Q60 162 94 148L91 169Q52 177 32 142Z', '#89b6bd', 'none', 0)
            line('M60 109l17 17M77 109l-17 17', ink, 5)
            line('M121 73q-10 -12 1 -22M151 65q-10 -12 1 -22', '#8bbe97', 4)
            break
        case 'banana':
            p('M111 126Q115 83 143 43Q154 29 166 40Q177 49 165 66Q144 90 147 125Z', '#fff0bd')
            p('M132 122Q151 109 165 79Q187 154 217 173Q184 199 148 156L133 140Z', '#eeb84c')
            p('M124 122Q108 173 52 191Q22 197 30 179Q79 154 103 111Z', '#ffd46a')
            p('M127 120Q158 169 143 216Q136 234 125 217Q133 181 107 146L105 122Z', '#ffdc7e')
            p('M112 123Q109 148 78 168Q110 155 125 135L137 151 139 181Q149 152 132 124Z', '#fff2bc', 'none', 0)
            line('M43 181q43 -11 60 -40', '#bd8739', 3)
            line('M157 141q23 35 47 35M134 200l-1 10', '#bd8739', 3)
            p('M145 41l7 -14 15 5-3 14Z', '#846740', ink, 3)
            break
        case 'can':
            p('M84 47L174 60L165 116 179 141 160 202 72 190 80 143 60 119Z', '#ea816d')
            p('M153 64L173 60L165 116 179 141 160 202 134 198 150 145 139 121Z', '#b84f4b', 'none', 0)
            p('M77 110Q112 94 169 130L170 150Q119 115 77 133Z', '#fff0ce', 'none', 0)
            line('M81 144l23 -9M161 119l-22 8', '#a44845', 3)
            p('M72 183L161 195 158 211 70 198Z', '#c5d8d2', ink, 4)
            e(129, 55, 46, 14, '#c5d8d2')
            e(138, 54, 14, 5, ink, 'none', 0)
            e(119, 52, 12, 5, 'none', '#607d89', 3)
            line('M94 78l-4 22', '#ffd2ab', 5)
            break
        case 'apple':
            p('M82 70Q57 40 93 40L126 47Q163 31 181 52Q190 69 170 80Q136 99 157 119Q137 139 164 159Q147 176 177 189Q195 218 158 221L130 215Q89 230 76 208Q67 194 90 180Q111 164 93 147Q113 128 95 110Q112 91 82 70Z', '#f6e7bd')
            p('M82 70Q57 40 93 40L126 47Q163 31 181 52Q190 69 170 80L153 72 137 81 119 72 101 79Z', '#d97262', ink, 3)
            p('M90 180L111 187 129 181 145 188 163 182 177 189Q195 218 158 221L130 215Q89 230 76 208Q67 194 90 180Z', '#d97262', ink, 3)
            line('M127 48q-4 -21 12 -29', '#765e43', 7)
            p('M136 30Q166 11 181 31Q157 48 136 30Z', '#7eb48b', ink, 3)
            p('M123 113q-18 21 -4 24 10 -1 4 -24M135 143q-5 25 8 21 10 -7 -8 -21', '#7f674b', 'none', 0)
            break
        case 'pizza':
            p('M48 75L207 95 108 222Z', '#ecaa4e')
            p('M56 84L193 101 110 210Z', '#ffe092', ink, 3)
            p('M60 94L82 153Q95 137 100 170L112 201 185 106Z', '#ffd365', 'none', 0)
            p('M46 70Q125 50 207 80Q224 90 209 107Q125 80 50 96Q30 89 46 70Z', '#d49250')
            line('M55 76Q125 61 201 87', '#ffe0a1', 6)
            for (const [x, y, r] of [[99, 113, 14], [155, 117, 14], [121, 159, 12]] as const) {
                e(x, y, r, r, '#cb6554', '#944d42', 2)
                e(x - 3, y - 4, 3, 2, '#eea078', 'none', 0)
            }
            line('M81 114l5 6M143 143l8 -3M107 182l2 6', '#6c9270', 4)
            break
        case 'donut':
            p('M215 118Q217 178 179 202Q119 240 60 195Q29 167 44 115Q61 60 129 60Q173 58 184 83Q164 98 186 110Q198 96 215 118Z', '#d59b5f')
            p('M211 113Q218 159 174 187Q121 220 65 183Q33 159 48 114Q66 65 129 66Q163 65 179 82Q163 102 183 114Q196 106 211 113Z', '#ed9da9', ink, 4)
            p('M48 143Q55 175 88 184Q139 211 186 166Q166 203 121 204Q60 204 48 143Z', '#d27891', 'none', 0)
            e(130, 135, 31, 26, '#d59b5f', ink, 4)
            e(132, 141, 24, 18, '#182333', 'none', 0)
            line('M67 111l8 -8M100 85l10 2M164 92l6 8M187 138l-5 10M156 179l9 -5M86 166l9 5', cream, 5)
            line('M83 131l-2 8M140 88l8 2M164 155l6 -7M117 183l9 1', '#65a9b1', 4)
            break
        case 'key':
            p('M94 101L186 184 178 195 160 179 149 192 134 178 145 164 80 111Z', gold)
            e(83, 83, 43, 43, gold)
            e(83, 83, 20, 20, ink, '#bd8037', 4)
            line('M50 70q10 -24 32 -22M107 112l 60 50', '#fff0b5', 4)
            star(185, 74, 18)
            star(58, 172, 11)
            break
        case 'double':
            p('M128 28L149 50L184 43 189 77 219 94 201 124 212 158 179 170 167 206 132 196 102 220 82 188 46 184 51 149 26 126 50 101L44 67 80 64 99 34Z', '#81c9bb')
            e(124, 124, 70, 70, '#2c6667', ink, 4)
            label('×2', 125, 127, 70, cream)
            star(188, 60, 13)
            break
        case 'coins':
            coin(76, 178, 35)
            coin(167, 174, 42)
            coin(117, 118, 47)
            star(184, 80, 15)
            star(60, 80, 9)
            break
    }
    return { shapes, labels }
}

// Render the same paths directly; no asynchronous image decode during reel setup.
export function paintTphVector(ctx: CanvasRenderingContext2D, id: TphArtId) {
    const art = illustration(id)
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    for (const shape of art.shapes) {
        const path = new Path2D(shape.d)
        if (shape.fill !== 'none') {
            ctx.fillStyle = shape.fill
            ctx.fill(path)
        }
        if (shape.stroke !== 'none' && shape.width) {
            ctx.strokeStyle = shape.stroke
            ctx.lineWidth = shape.width
            ctx.stroke(path)
        }
    }
    for (const label of art.labels) {
        ctx.save()
        const scale = label.size / 10
        ctx.translate(label.x - (label.text.length * 10 - 3) * scale / 2, label.y - label.size / 2)
        ctx.scale(scale, scale)
        ctx.strokeStyle = label.fill
        ctx.lineWidth = 1.8
        for (const letter of label.text) {
            ctx.stroke(new Path2D(lettering[letter]!))
            ctx.translate(10, 0)
        }
        ctx.restore()
    }
    ctx.restore()
}

export function tphVectorSvg(id: TphArtId, px: number): string {
    const art = illustration(id)
    const paths = art.shapes.map(s => `<path d="${s.d}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="${s.width}"/>`).join('')
    const text = art.labels.map((l) => {
        const scale = l.size / 10
        const left = l.x - (l.text.length * 10 - 3) * scale / 2
        return `<g transform="translate(${left} ${l.y - l.size / 2}) scale(${scale})" fill="none" stroke="${l.fill}" stroke-width="1.8">${[...l.text].map((letter, i) => `<path transform="translate(${i * 10} 0)" d="${lettering[letter]}"/>`).join('')}</g>`
    }).join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 256 256"><g stroke-linejoin="round" stroke-linecap="round">${paths}${text}</g></svg>`
}
