import type { Application, Container } from 'pixi.js'

export interface GameDevAction {
  description?: string
  run: (input?: unknown) => unknown | Promise<unknown>
}

export interface GameDevRegistration {
  id: string
  kind: string
  canvas: () => HTMLCanvasElement | null
  state?: () => unknown
  scene?: () => unknown
  actions?: Record<string, GameDevAction>
}

export interface GameDevDescriptor {
  id: string
  kind: string
  actions: Record<string, string | undefined>
}

export interface GameDevInspection extends GameDevDescriptor {
  canvas: {
    width: number
    height: number
    clientWidth: number
    clientHeight: number
    connected: boolean
  } | null
  state?: unknown
  scene?: unknown
}

export interface GameDevBridge {
  readonly version: 1
  list: () => GameDevDescriptor[]
  inspect: (id: string) => GameDevInspection
  run: (id: string, action: string, input?: unknown) => Promise<unknown>
  waitFor: (id: string, timeoutMs?: number) => Promise<GameDevDescriptor>
}

declare global {
  interface Window {
    __POLYNUX_DEV_BRIDGE__?: GameDevBridge
  }
}

const registrations = new Map<string, GameDevRegistration>()

function descriptor(registration: GameDevRegistration): GameDevDescriptor {
  return {
    id: registration.id,
    kind: registration.kind,
    actions: Object.fromEntries(
      Object.entries(registration.actions ?? {}).map(([name, action]) => [name, action.description])
    )
  }
}

function findRegistration(id: string) {
  const registration = registrations.get(id)
  if (!registration) {
    throw new Error(`Unknown game dev bridge id "${id}". Available: ${[...registrations.keys()].join(', ') || 'none'}`)
  }
  return registration
}

function createBridge(): GameDevBridge {
  return {
    version: 1,
    list: () => [...registrations.values()].map(descriptor),
    inspect: (id) => {
      const registration = findRegistration(id)
      const canvas = registration.canvas()
      return {
        ...descriptor(registration),
        canvas: canvas
          ? {
              width: canvas.width,
              height: canvas.height,
              clientWidth: canvas.clientWidth,
              clientHeight: canvas.clientHeight,
              connected: canvas.isConnected
            }
          : null,
        state: registration.state?.(),
        scene: registration.scene?.()
      }
    },
    run: async (id, actionName, input) => {
      const registration = findRegistration(id)
      const action = registration.actions?.[actionName]
      if (!action) {
        throw new Error(`Unknown action "${actionName}" for "${id}". Available: ${Object.keys(registration.actions ?? {}).join(', ') || 'none'}`)
      }
      return await action.run(input)
    },
    waitFor: async (id, timeoutMs = 5000) => {
      const startedAt = Date.now()
      while (Date.now() - startedAt < timeoutMs) {
        const registration = registrations.get(id)
        if (registration) return descriptor(registration)
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      throw new Error(`Timed out waiting for game dev bridge "${id}" after ${timeoutMs}ms`)
    }
  }
}

function ensureBridge() {
  if (!import.meta.client || !import.meta.dev) return
  window.__POLYNUX_DEV_BRIDGE__ ??= createBridge()
}

export function registerGameDevBridge(registration: GameDevRegistration): () => void {
  if (!import.meta.client || !import.meta.dev) return () => {}
  ensureBridge()
  registrations.set(registration.id, registration)
  return () => {
    if (registrations.get(registration.id) === registration) registrations.delete(registration.id)
  }
}

interface PixiSceneNode {
  type: string
  label?: string
  visible: boolean
  renderable: boolean
  alpha: number
  position: { x: number, y: number }
  size: { width: number, height: number }
  children?: PixiSceneNode[]
  truncatedChildren?: number
}

function pixiSceneNode(container: Container, depth: number, maxDepth: number, maxChildren: number): PixiSceneNode {
  const children = depth < maxDepth ? container.children.slice(0, maxChildren) : []
  const label = container.label || container.name || undefined
  const node: PixiSceneNode = {
    type: container.constructor.name,
    label,
    visible: container.visible,
    renderable: container.renderable,
    alpha: container.alpha,
    position: { x: container.x, y: container.y },
    size: { width: container.width, height: container.height }
  }
  if (children.length > 0) node.children = children.map(child => pixiSceneNode(child, depth + 1, maxDepth, maxChildren))
  if (container.children.length > children.length) node.truncatedChildren = container.children.length - children.length
  return node
}

export interface PixiDevBridgeOptions {
  id: string
  state?: () => unknown
  actions?: Record<string, GameDevAction>
  maxSceneDepth?: number
  maxChildren?: number
}

export function registerPixiDevBridge(app: Application, options: PixiDevBridgeOptions): () => void {
  return registerGameDevBridge({
    id: options.id,
    kind: 'pixi',
    canvas: () => app.canvas,
    state: options.state,
    actions: options.actions,
    scene: () => pixiSceneNode(app.stage, 0, options.maxSceneDepth ?? 5, options.maxChildren ?? 100)
  })
}
