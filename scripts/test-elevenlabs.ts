const apiKey = process.env.ELEVENLABS_API_KEY
if (!apiKey) {
    console.error('No API key')
    process.exit(1)
}

const response = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=pcm_44100', {
    method: 'POST',
    headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        text: 'Laser zap one shot',
        duration_seconds: 0.5,
        prompt_influence: 0.7
    })
})

if (!response.ok) {
    console.error(await response.text())
    process.exit(1)
}

const bytes = new Uint8Array(await response.arrayBuffer())
const sampleCount = Math.floor(bytes.length / 2)
const samples = new Float32Array(sampleCount)
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
for (let i = 0; i < sampleCount; i++) {
    samples[i] = view.getInt16(i * 2, true) / 32768
}

console.log('Sample count:', sampleCount)
console.log('Duration at 44.1kHz mono:', (sampleCount / 44100).toFixed(2), 'seconds')
console.log('Min sample:', Math.min(...samples), 'Max sample:', Math.max(...samples))
