<template>
    <div class="w-full h-screen flex flex-col bg-gray-900">
        <div class="flex-1 relative">
            <div ref="gameContainer" class="w-full h-full" />
        </div>
        <div v-if="isPaused" class="absolute inset-0 bg-black bg-opacity-60 flex flex-col items-center justify-center z-50">
            <div class="bg-gray-800 border-2 border-amber-500 p-8 rounded-lg max-w-2xl w-full mx-4">
                <h2 class="text-3xl font-bold text-amber-400 mb-6 text-center">UPGRADE PHASE</h2>
                <p class="text-gray-300 text-center mb-8">{{ Math.ceil(pauseCountdown) }}s until next wave</p>

                <div class="grid grid-cols-2 gap-4 mb-6">
                    <button
                        v-for="upgrade in upgrades"
                        :key="upgrade.id"
                        :disabled="gameState.gold < upgrade.cost"
                        @click="buyUpgrade(upgrade.id)"
                        class="p-4 rounded border-2 border-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
                        :class="gameState.gold >= upgrade.cost ? 'bg-amber-900 hover:bg-amber-800' : 'bg-gray-700'"
                    >
                        <div class="font-bold text-amber-300">{{ upgrade.name }}</div>
                        <div class="text-sm text-gray-300 mb-2">{{ upgrade.description }}</div>
                        <div class="text-lg font-bold" :class="gameState.gold >= upgrade.cost ? 'text-amber-200' : 'text-gray-400'">
                            {{ upgrade.cost }} gold
                        </div>
                        <div class="text-xs text-gray-400 mt-1">Owned: {{ upgrade.count }}</div>
                    </button>
                </div>

                <div class="bg-gray-900 p-4 rounded border border-gray-700 text-center">
                    <div class="text-yellow-400 text-xl font-bold">Gold: {{ gameState.gold }}</div>
                    <div class="text-gray-400 text-sm mt-1">Wave {{ gameState.wave }}</div>
                </div>
            </div>
        </div>

        <div class="absolute top-4 left-4 bg-gray-800 bg-opacity-80 p-4 rounded border border-gray-700 z-40">
            <div class="text-amber-400 font-bold">Gold: {{ gameState.gold }}</div>
            <div class="text-gray-300 text-sm">Wave: {{ gameState.wave }}</div>
            <div class="text-gray-400 text-xs mt-2">Wave starts in: {{ Math.ceil(waveCountdown) }}s</div>
        </div>

        <div class="absolute top-4 right-4 bg-gray-800 bg-opacity-80 p-4 rounded border border-gray-700 z-40">
            <div class="text-red-400 font-bold">Enemies: {{ gameState.enemies.length }}</div>
            <div class="text-blue-400 font-bold">Towers: {{ gameState.towers.length }}</div>
            <div class="text-purple-400 font-bold">Health: {{ gameState.health }}/100</div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, computed } from 'vue'
import * as PIXI from 'pixi.js'

interface Tower {
    x: number
    y: number
    radius: number
    fireRate: number
    lastShot: number
    damage: number
    level: number
    graphics: PIXI.Graphics
}

interface Enemy {
    x: number
    y: number
    vx: number
    vy: number
    health: number
    maxHealth: number
    speed: number
    radius: number
    graphics: PIXI.Graphics
}

interface Projectile {
    x: number
    y: number
    vx: number
    vy: number
    radius: number
    damage: number
    targetId: number
    graphics: PIXI.Graphics
}

const gameContainer = ref<HTMLElement | null>(null)
const app = ref<PIXI.Application | null>(null)
let gameRunning = true
let lastEnemySpawn = 0
let tower1Count = 0
let tower2Count = 0

const gameState = reactive({
    gold: 200,
    health: 100,
    wave: 1,
    towers: [] as Tower[],
    enemies: [] as Enemy[],
    projectiles: [] as Projectile[]
})

const isPaused = ref(false)
const pauseCountdown = ref(0)
let waveTimer = 0
let pauseTimer = 0

const waveCountdown = computed(() => Math.max(0, 25 - (waveTimer % 25)))

const upgrades = ref([
    {
        id: 'tower1',
        name: 'Stone Tower',
        description: 'Basic defensive tower',
        cost: 50,
        count: computed(() => tower1Count),
        damage: 10,
        fireRate: 0.5,
        radius: 150
    },
    {
        id: 'tower2',
        name: 'Cannon',
        description: 'Slower, stronger shots',
        cost: 100,
        count: computed(() => tower2Count),
        damage: 25,
        fireRate: 0.3,
        radius: 200
    },
    {
        id: 'health',
        name: 'Reinforce',
        description: '+20 max health',
        cost: 75,
        count: 0,
        health: 20
    },
    {
        id: 'upgrade-towers',
        name: 'Smithy',
        description: '+5 damage to all',
        cost: 120,
        count: 0,
        damage: 5
    }
])

function buyUpgrade(id: string) {
    const upgrade = upgrades.value.find(u => u.id === id)
    if (!upgrade || gameState.gold < upgrade.cost) return

    gameState.gold -= upgrade.cost

    if (id === 'tower1') {
        tower1Count++
        placeRandomTower(upgrade.damage, upgrade.fireRate, upgrade.radius)
    } else if (id === 'tower2') {
        tower2Count++
        placeRandomTower(upgrade.damage, upgrade.fireRate, upgrade.radius)
    } else if (id === 'health') {
        gameState.health = Math.min(100, gameState.health + (upgrade.health || 0))
    } else if (id === 'upgrade-towers') {
        gameState.towers.forEach(tower => {
            tower.damage += upgrade.damage || 0
        })
    }
}

function placeRandomTower(damage: number, fireRate: number, radius: number) {
    if (!app.value) return

    const x = Math.random() * 800 + 100
    const y = Math.random() * 400 + 100

    const tower: Tower = {
        x,
        y,
        radius,
        fireRate,
        lastShot: Date.now(),
        damage,
        level: 1,
        graphics: new PIXI.Graphics()
    }

    drawTower(tower)
    app.value.stage.addChild(tower.graphics)
    gameState.towers.push(tower)
}

function drawTower(tower: Tower) {
    tower.graphics.clear()
    tower.graphics.lineStyle(2, 0xffd700)
    tower.graphics.beginFill(0xaa8844)
    tower.graphics.drawRect(tower.x - 15, tower.y - 15, 30, 30)
    tower.graphics.endFill()
    tower.graphics.lineStyle(1, 0xffff00)
    tower.graphics.drawCircle(tower.x, tower.y, tower.radius)
}

function spawnEnemy() {
    if (!app.value || !gameRunning) return

    const path = [
        { x: -20, y: 100 },
        { x: 200, y: 50 },
        { x: 600, y: 80 },
        { x: 850, y: 200 }
    ]

    const speed = 1 + (gameState.wave * 0.1)
    const enemy: Enemy = {
        x: -20,
        y: 100,
        vx: 1.5 * speed,
        vy: 0,
        health: 20 + gameState.wave * 5,
        maxHealth: 20 + gameState.wave * 5,
        speed,
        radius: 8,
        graphics: new PIXI.Graphics()
    }

    drawEnemy(enemy)
    app.value.stage.addChild(enemy.graphics)
    gameState.enemies.push(enemy)
}

function drawEnemy(enemy: Enemy) {
    enemy.graphics.clear()
    enemy.graphics.beginFill(0xff3333)
    enemy.graphics.drawCircle(enemy.x, enemy.y, enemy.radius)
    enemy.graphics.endFill()

    const hpPercent = enemy.health / enemy.maxHealth
    enemy.graphics.lineStyle(2, hpPercent > 0.5 ? 0x00ff00 : 0xff6600)
    enemy.graphics.drawCircle(enemy.x, enemy.y, enemy.radius + 3)
}

function createProjectile(fromTower: Tower, toEnemy: Enemy) {
    if (!app.value) return

    const dx = toEnemy.x - fromTower.x
    const dy = toEnemy.y - fromTower.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    const speed = 4

    const projectile: Projectile = {
        x: fromTower.x,
        y: fromTower.y,
        vx: (dx / dist) * speed,
        vy: (dy / dist) * speed,
        radius: 4,
        damage: fromTower.damage,
        targetId: -1,
        graphics: new PIXI.Graphics()
    }

    projectile.graphics.beginFill(0xffff00)
    projectile.graphics.drawCircle(projectile.x, projectile.y, projectile.radius)
    projectile.graphics.endFill()

    app.value.stage.addChild(projectile.graphics)
    gameState.projectiles.push(projectile)
}

function update() {
    if (isPaused.value) {
        pauseCountdown.value = Math.max(0, 25 - (pauseTimer % 25))
        pauseTimer += 1 / 60

        if (pauseTimer >= 25) {
            isPaused.value = false
            pauseTimer = 0
            waveTimer = 0
            gameState.wave++
        }
        return
    }

    waveTimer += 1 / 60

    // Spawn enemies every 1s
    lastEnemySpawn += 1 / 60
    if (lastEnemySpawn >= 1 && gameState.enemies.length < 5 + gameState.wave) {
        spawnEnemy()
        lastEnemySpawn = 0
    }

    // Pause every 25 seconds
    if (waveTimer >= 25) {
        isPaused.value = true
        pauseTimer = 0
    }

    // Update towers
    for (const tower of gameState.towers) {
        const now = Date.now()
        if (now - tower.lastShot > 1000 / tower.fireRate) {
            const target = gameState.enemies.find(e => {
                const dx = e.x - tower.x
                const dy = e.y - tower.y
                return Math.sqrt(dx * dx + dy * dy) < tower.radius
            })

            if (target) {
                createProjectile(tower, target)
                tower.lastShot = now
            }
        }
    }

    // Update projectiles
    for (let i = gameState.projectiles.length - 1; i >= 0; i--) {
        const proj = gameState.projectiles[i]
        proj.x += proj.vx
        proj.y += proj.vy
        proj.graphics.x = proj.x
        proj.graphics.y = proj.y

        // Check collisions
        let hit = false
        for (let j = gameState.enemies.length - 1; j >= 0; j--) {
            const enemy = gameState.enemies[j]
            const dx = enemy.x - proj.x
            const dy = enemy.y - proj.y
            if (Math.sqrt(dx * dx + dy * dy) < proj.radius + enemy.radius) {
                enemy.health -= proj.damage
                hit = true

                if (enemy.health <= 0) {
                    app.value?.stage.removeChild(enemy.graphics)
                    gameState.enemies.splice(j, 1)
                    gameState.gold += 10
                }
                break
            }
        }

        // Remove if off screen or hit
        if (hit || proj.x < -20 || proj.x > 900 || proj.y < -20 || proj.y > 620) {
            app.value?.stage.removeChild(proj.graphics)
            gameState.projectiles.splice(i, 1)
        }
    }

    // Update enemies
    for (let i = gameState.enemies.length - 1; i >= 0; i--) {
        const enemy = gameState.enemies[i]
        enemy.x += enemy.vx
        enemy.y += enemy.vy

        // Wobble movement
        enemy.y += Math.sin(waveTimer * 2 + i) * 0.3

        drawEnemy(enemy)
        enemy.graphics.x = enemy.x
        enemy.graphics.y = enemy.y

        if (enemy.x > 850) {
            gameState.health -= 10
            app.value?.stage.removeChild(enemy.graphics)
            gameState.enemies.splice(i, 1)

            if (gameState.health <= 0) {
                gameRunning = false
            }
        }
    }

    // Redraw towers
    for (const tower of gameState.towers) {
        tower.graphics.x = tower.x
        tower.graphics.y = tower.y
    }
}

onMounted(async () => {
    if (!gameContainer.value) return

    app.value = new PIXI.Application({
        width: gameContainer.value.clientWidth,
        height: gameContainer.value.clientHeight,
        backgroundColor: 0x1a1a2e,
        antialias: true
    })

    gameContainer.value.appendChild(app.value.canvas)

    // Draw background
    const background = new PIXI.Graphics()
    background.beginFill(0x0f3460)
    background.drawRect(0, 0, app.value.width, app.value.height)
    background.endFill()
    app.value.stage.addChild(background)

    // Draw path
    const path = new PIXI.Graphics()
    path.lineStyle(40, 0x4a4e69, 0.3)
    path.moveTo(-20, 100)
    path.lineTo(200, 50)
    path.lineTo(600, 80)
    path.lineTo(850, 200)
    app.value.stage.addChild(path)

    // Game loop
    const ticker = app.value.ticker
    ticker.add(() => {
        update()
    })

    // Click to place towers (debug)
    gameContainer.value.addEventListener('click', (e) => {
        if (isPaused.value) return
        // Commented out for now - upgrades only via UI
    })
})

onUnmounted(() => {
    if (app.value) {
        app.value.destroy(true)
    }
})
</script>
