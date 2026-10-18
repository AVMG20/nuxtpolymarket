<template>
    <svg class="df-lockup" viewBox="0 0 800 250" role="img" aria-label="Dead Front">
        <defs>
            <filter :id="`${uid}-worn`" x="-5%" y="-10%" width="110%" height="120%">
                <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="2" seed="11" result="n" />
                <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -3.2 0 0 0 2.25" result="mask" />
                <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="3" result="w" />
                <feDisplacementMap in="SourceGraphic" in2="w" scale="5" xChannelSelector="R" yChannelSelector="G" result="d" />
                <feComposite in="d" in2="mask" operator="in" />
            </filter>
            <radialGradient :id="`${uid}-flare`" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0" stop-color="#ffb24e" stop-opacity="0.38" />
                <stop offset="0.5" stop-color="#ff7a2e" stop-opacity="0.1" />
                <stop offset="1" stop-color="#ff7a2e" stop-opacity="0" />
            </radialGradient>
            <linearGradient :id="`${uid}-ink`" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stop-color="#d4392a" />
                <stop offset="0.6" stop-color="#a51e13" />
                <stop offset="1" stop-color="#6d0f08" />
            </linearGradient>
            <linearGradient :id="`${uid}-brass`" x1="0" x2="1">
                <stop offset="0" stop-color="#7d5e22" />
                <stop offset="0.3" stop-color="#e5c574" />
                <stop offset="0.55" stop-color="#b08838" />
                <stop offset="0.8" stop-color="#f1d88e" />
                <stop offset="1" stop-color="#7d5e22" />
            </linearGradient>
        </defs>

        <!-- star-shell glow behind the lettering -->
        <ellipse class="flare" cx="400" cy="118" rx="360" ry="110" :fill="`url(#${uid}-flare)`" />

        <!-- dispatch header -->
        <g class="head">
            <path d="M150 34h150M500 34h150" />
            <text x="400" y="39" text-anchor="middle">FIELD DISPATCH · No. 17 · MOST SECRET</text>
        </g>

        <!-- the name -->
        <g :filter="`url(#${uid}-worn)`">
            <text class="name shadow" x="402" y="160" text-anchor="middle" textLength="720" lengthAdjust="spacingAndGlyphs">DEAD FRONT</text>
            <text class="name" x="400" y="156" text-anchor="middle" textLength="720" lengthAdjust="spacingAndGlyphs" :fill="`url(#${uid}-ink)`">DEAD FRONT</text>
        </g>

        <!-- barbed wire with pickets -->
        <g class="wire">
            <path class="strand" d="M30 192 C 120 184, 200 200, 290 191 S 470 184, 560 193 S 700 186, 770 192" />
            <path class="strand b" d="M30 196 C 140 204, 230 188, 330 197 S 520 204, 610 195 S 720 200, 770 196" />
            <g class="barbs">
                <path v-for="x in barbs" :key="x" :d="`M${x - 4} ${190} l8 6 M${x + 4} ${190} l-8 6`" />
            </g>
            <g class="pickets">
                <path d="M60 176 l-6 32 M60 176 l7 32" />
                <path d="M740 176 l-6 32 M740 176 l7 32" />
            </g>
        </g>

        <!-- brass ribbon -->
        <g class="ribbon">
            <path d="M232 214 h336 l-12 13 l12 13 h-336 l12 -13 z" :fill="`url(#${uid}-brass)`" />
            <path d="M244 218 h312 M244 236 h312" class="ribbon-line" />
            <text x="400" y="232" text-anchor="middle" textLength="290" lengthAdjust="spacingAndGlyphs">SAINTE-CROIX · PICARDIE · 1917</text>
        </g>

        <!-- a poppy pinned to the dispatch -->
        <g transform="translate(772 46) scale(0.78)">
        <g class="poppy">
            <path d="M0 0 C -14 -16, -30 -2, -18 10 C -26 22, -6 30, 0 18 C 6 30, 26 22, 18 10 C 30 -2, 14 -16, 0 0 Z" fill="#b3241a" />
            <path d="M0 4 C -6 -6, -18 2, -10 8 M0 4 C 6 -6, 18 2, 10 8" stroke="#6e0c06" stroke-width="1.2" fill="none" />
            <circle cx="0" cy="8" r="5" fill="#1c1410" />
            <path d="M0 18 C 2 30, -4 40, 2 52" stroke="#3f5a2c" stroke-width="2.4" fill="none" />
        </g>
        </g>
    </svg>
</template>

<script setup lang="ts">
// The Dead Front title lockup: worn blood-red stencil on a star-shell glow,
// a barbed-wire rule that draws itself in and a brass place ribbon.
const uid = `dft-${useId()}`
const barbs = [96, 150, 214, 276, 342, 404, 470, 532, 598, 664]
</script>

<style scoped>
.df-lockup {
    display: block;
    width: 100%;
    max-width: 46rem;
    height: auto;
    margin: 0 auto;
    overflow: visible;
}

.flare {
    animation: df-flare 6s ease-in-out infinite;
    transform-origin: 400px 118px;
}

.head path {
    stroke: rgba(236, 226, 198, 0.35);
    stroke-width: 1;
    stroke-dasharray: 4 5;
}

.head text {
    font-family: var(--df-font-type);
    font-size: 15px;
    letter-spacing: 4px;
    fill: rgba(236, 226, 198, 0.62);
}

.name {
    font-family: var(--df-font-stencil);
    font-weight: 700;
    font-size: 132px;
    letter-spacing: 10px;
}

.name.shadow {
    fill: #1a0504;
    opacity: 0.9;
}

.wire .strand {
    fill: none;
    stroke: #8d8a7f;
    stroke-width: 1.6;
    stroke-dasharray: 900;
    stroke-dashoffset: 900;
    animation: df-wire 1.6s 0.25s cubic-bezier(0.6, 0, 0.2, 1) forwards;
}

.wire .strand.b {
    stroke: #6c6a61;
    animation-delay: 0.45s;
}

.wire .barbs path {
    stroke: #a9a597;
    stroke-width: 1.4;
    stroke-linecap: round;
    opacity: 0;
    animation: df-fade-in 0.4s 1.4s forwards;
}

.wire .pickets path {
    stroke: #4a3a28;
    stroke-width: 4;
    stroke-linecap: round;
}

.ribbon text {
    font-family: var(--df-font-stencil);
    font-size: 15px;
    letter-spacing: 5px;
    fill: #2a1d07;
}

.ribbon-line {
    stroke: rgba(60, 40, 5, 0.45);
    stroke-width: 0.8;
    stroke-dasharray: 2 3;
}

.poppy {
    animation: df-poppy 7s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: 50% 90%;
    filter: drop-shadow(0 3px 3px rgba(0, 0, 0, 0.6));
}

@keyframes df-flare {
    0%, 100% { opacity: 0.85; transform: scale(1); }
    35% { opacity: 1; transform: scale(1.03); }
    55% { opacity: 0.7; }
    60% { opacity: 0.95; }
}

@keyframes df-wire {
    to { stroke-dashoffset: 0; }
}

@keyframes df-fade-in {
    to { opacity: 1; }
}

@keyframes df-poppy {
    0%, 100% { transform: rotate(-4deg); }
    50% { transform: rotate(3deg); }
}
</style>
