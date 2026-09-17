<script setup lang="ts">
/**
 * A paytable as a real casino prints one: the hand's name, a worked example of
 * it, and the odds. The example is what makes a paytable readable to someone
 * who does not already know poker hand names, which is most of the table.
 *
 * Examples are written compactly as `rank + suit letter`, space separated —
 * `'As Ac'`, `'10h Jh Qh'`. Purely presentational, so games keep their rules
 * modules free of display data.
 */
const SUIT_GLYPH: Record<string, { pip: string, red: boolean }> = {
    s: { pip: '♠', red: false },
    c: { pip: '♣', red: false },
    h: { pip: '♥', red: true },
    d: { pip: '♦', red: true }
}

defineProps<{
    rows: { label: string, example?: string, pays: string }[]
    head?: [string, string]
}>()

function cards(example: string) {
    return example.split(' ').filter(Boolean).map((token, i) => {
        const suit = SUIT_GLYPH[token.slice(-1)] ?? SUIT_GLYPH.s!
        return { key: `${token}-${i}`, rank: token.slice(0, -1), pip: suit.pip, red: suit.red }
    })
}
</script>

<template>
    <div class="lt-paytable">
        <template v-if="head">
            <span class="pt-head">{{ head[0] }}</span>
            <span />
            <span class="pt-head text-right">{{ head[1] }}</span>
        </template>
        <template v-for="row in rows" :key="row.label">
            <span class="pt-label">{{ row.label }}</span>
            <span class="pt-eg">
                <span
                    v-for="card in cards(row.example ?? '')"
                    :key="card.key"
                    class="lt-eg-card"
                    :class="{ red: card.red }"
                >{{ card.rank }}{{ card.pip }}</span>
            </span>
            <span class="pt-odds">{{ row.pays }}</span>
        </template>
    </div>
</template>
