import { canvas, finish } from './canvas'

/** Signage painted at load: the billboard ads, the number plate's mini ad and the gantry banners. */

/**
 * Billboards advertising the rest of Polynux. Each is a themed gradient, a
 * big emoji mark and the game's tagline.
 */
export const BILLBOARD_ADS = [
    { bg: ['#140a24', '#3a0f5a'], icon: '🎰', title: 'POLYNUX', sub: 'PLAY. WIN. REPEAT.', col: '#ff3db8' },
    { bg: ['#06061a', '#1b1050'], icon: '🚀', title: 'VOID RUNNER', sub: 'THE DEEP IS CALLING', col: '#a98bff' },
    { bg: ['#1a1000', '#4a2c00'], icon: '⚔️', title: 'HERO QUEST', sub: 'YOUR PARTY AWAITS', col: '#ffc233' },
    { bg: ['#0e1a00', '#264a00'], icon: '🐛', title: 'COLONY', sub: 'GROW THE HIVE', col: '#a6ff4d' },
    { bg: ['#001a0e', '#00402a'], icon: '🌱', title: 'XENO', sub: 'HARVEST THE UNKNOWN', col: '#3dffb0' },
    { bg: ['#001428', '#003a66'], icon: '🏴‍☠️', title: 'PIRATE RAID', sub: 'SIX MINUTES OF PLUNDER', col: '#4dc3ff' },
    { bg: ['#14140a', '#3a3a14'], icon: '🏰', title: 'PATHWARDEN', sub: 'HOLD THE ROAD', col: '#e8e070' },
    { bg: ['#1a0004', '#4a000c'], icon: '🧟', title: 'CALL OF XENO', sub: 'SURVIVE THE NIGHT', col: '#ff4d5e' },
    { bg: ['#000a00', '#002a10'], icon: '💻', title: 'HACK OPS', sub: 'ACCESS GRANTED', col: '#33ff66' },
    { bg: ['#0a1420', '#1f3a5a'], icon: '🏙️', title: 'POLYTOWN', sub: 'BUILD YOUR CITY', col: '#7fd4ff' },
    { bg: ['#2a0018', '#5a0a3a'], icon: '🍬', title: 'CANDY MADNESS', sub: 'SWEET MULTIPLIERS', col: '#ff8ad8' },
    { bg: ['#1a0a00', '#4a1a00'], icon: '💣', title: 'FIRE IN THE HOLE', sub: 'DIG DEEP. BLOW UP.', col: '#ff7a1a' },
    { bg: ['#0a0614', '#24123a'], icon: '📖', title: 'BOOK OF SHADOWS', sub: 'TURN THE PAGE', col: '#c79bff' },
    { bg: ['#1a1400', '#3a3000'], icon: '⛏️', title: 'GOLD MINER', sub: 'STRIKE IT RICH', col: '#ffd84d' },
    { bg: ['#000e1a', '#00304a'], icon: '🛡️', title: 'FIREWALL', sub: '30 WAVES. ONE CORE.', col: '#33e0ff' },
    { bg: ['#0a0020', '#24006a'], icon: '🔷', title: 'SHAPEZZ', sub: 'GEOMETRY MAYHEM', col: '#6af0ff' },
    { bg: ['#140a00', '#3a2400'], icon: '🎲', title: 'DICE', sub: 'ROLL THE ODDS', col: '#ffb84d' },
    { bg: ['#001a14', '#00402e'], icon: '🃏', title: 'LIVE BLACKJACK', sub: 'BEAT THE DEALER', col: '#4dffc8' },
    { bg: ['#1a0a14', '#3a1430'], icon: '🐴', title: 'NEIGHCASSO DERBY', sub: 'PAINT THE FINISH', col: '#ff9ad0' },
    { bg: ['#14001a', '#38004a'], icon: '💎', title: 'GEM EXCHANGE', sub: 'TRADE UP', col: '#d07bff' },
    { bg: ['#001a1a', '#003a3a'], icon: '⚡', title: 'NITRO ENERGY', sub: 'ZERO SUGAR · ALL RUSH', col: '#33f0ff' },
    { bg: ['#0e0e14', '#24243a'], icon: '🏦', title: 'POLYNUX BANK', sub: 'YOUR COINS, SAFE', col: '#c8d4ff' }
] as const

let emojiOk: boolean | null = null

/** Colour emoji render as colour; a missing emoji font falls back to a grey box or glyph. */
function colorEmojiSupported() {
    if (emojiOk !== null) return emojiOk
    const [, ctx] = canvas(32, 32)
    ctx.font = '24px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
    ctx.textBaseline = 'middle'
    ctx.fillText('🚀', 2, 16)
    const d = ctx.getImageData(0, 0, 32, 32).data
    emojiOk = false
    for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3]! > 0 && (Math.abs(d[i]! - d[i + 1]!) > 30 || Math.abs(d[i + 1]! - d[i + 2]!) > 30)) {
            emojiOk = true
            break
        }
    }
    return emojiOk
}

export function billboardTexture(i: number) {
    const [c, ctx] = canvas(512, 256)
    const ad = BILLBOARD_ADS[i % BILLBOARD_ADS.length]!
    const g = ctx.createLinearGradient(0, 0, 512, 256)
    g.addColorStop(0, ad.bg[0])
    g.addColorStop(1, ad.bg[1])
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 512, 256)
    // Soft halo behind the mark.
    const halo = ctx.createRadialGradient(100, 128, 10, 100, 128, 130)
    halo.addColorStop(0, ad.col + '66')
    halo.addColorStop(1, ad.col + '00')
    ctx.fillStyle = halo
    ctx.fillRect(0, 0, 260, 256)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const icon = colorEmojiSupported()
    if (icon) {
        ctx.font = '110px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
        ctx.fillText(ad.icon, 100, 136)
    }
    // Without an icon the text takes the whole board.
    const left = icon ? 196 : 40
    const maxW = icon ? 300 : 440
    ctx.textAlign = 'left'
    const title = ad.title
    let size = 64
    ctx.font = `900 ${size}px system-ui, sans-serif`
    while (ctx.measureText(title).width > maxW && size > 30) {
        size -= 2
        ctx.font = `900 ${size}px system-ui, sans-serif`
    }
    ctx.shadowColor = ad.col
    ctx.shadowBlur = 22
    ctx.fillStyle = ad.col
    ctx.fillText(title, left, 112)
    ctx.shadowBlur = 0
    ctx.font = '700 24px system-ui, sans-serif'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(ad.sub, left + 2, 172)
    ctx.font = '600 15px system-ui, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.fillText('NOW ON POLYNUX', left + 2, 214)
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.lineWidth = 6
    ctx.strokeRect(3, 3, 506, 250)
    return finish(c)
}

/** The rear plate: a generic panel carrying a random billboard ad instead of a registration. */
export function plateTexture() {
    const W = 520
    const H = 120
    const [c, ctx] = canvas(W, H)
    const ad = BILLBOARD_ADS[Math.floor(Math.random() * BILLBOARD_ADS.length)]!
    ctx.fillStyle = '#0b0b0e'
    ctx.fillRect(0, 0, W, H)
    const g = ctx.createLinearGradient(0, 0, W, H)
    g.addColorStop(0, ad.bg[0])
    g.addColorStop(1, ad.bg[1])
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.roundRect(8, 8, W - 16, H - 16, 12)
    ctx.fill()
    ctx.strokeStyle = ad.col + 'aa'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.textBaseline = 'middle'
    const icon = colorEmojiSupported()
    if (icon) {
        const halo = ctx.createRadialGradient(62, H / 2, 4, 62, H / 2, 60)
        halo.addColorStop(0, ad.col + '66')
        halo.addColorStop(1, ad.col + '00')
        ctx.fillStyle = halo
        ctx.fillRect(8, 8, 120, H - 16)
        ctx.textAlign = 'center'
        ctx.font = '62px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
        ctx.fillText(ad.icon, 62, H / 2 + 4)
    }
    const left = icon ? 116 : 30
    const maxW = W - left - 26
    ctx.textAlign = 'left'
    let size = 50
    ctx.font = `900 ${size}px system-ui, sans-serif`
    while (ctx.measureText(ad.title).width > maxW && size > 24) {
        size -= 2
        ctx.font = `900 ${size}px system-ui, sans-serif`
    }
    ctx.shadowColor = ad.col
    ctx.shadowBlur = 14
    ctx.fillStyle = ad.col
    ctx.fillText(ad.title, left, 50)
    ctx.shadowBlur = 0
    ctx.font = '700 19px system-ui, sans-serif'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(ad.sub, left + 2, 88)
    return finish(c)
}


/** A neon banner for the start gantry. */
export function bannerTexture(title: string, sub: string) {
    const [c, ctx] = canvas(1024, 256)
    ctx.fillStyle = '#0b0614'
    ctx.fillRect(0, 0, 1024, 256)
    ctx.strokeStyle = '#ff2bd6'
    ctx.lineWidth = 10
    ctx.strokeRect(10, 10, 1004, 236)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = '#ff2bd6'
    ctx.shadowBlur = 24
    ctx.fillStyle = '#ffffff'
    ctx.font = 'italic 900 120px system-ui, sans-serif'
    ctx.fillText(title, 512, 110)
    ctx.shadowColor = '#3df2ff'
    ctx.fillStyle = '#9ff8ff'
    ctx.font = '800 46px system-ui, sans-serif'
    ctx.fillText(sub, 512, 200)
    return finish(c)
}
