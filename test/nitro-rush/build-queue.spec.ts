import { describe, expect, it, vi } from 'vitest'
import { BuildQueue, type Defer } from '../../app/utils/nitro-rush/build-queue'

/** A deferral that only fires when the test says so. */
function manual() {
    let waiting: (() => void)[] = []
    const defer: Defer = (cb) => {
        waiting.push(cb)
        return () => { waiting = waiting.filter(w => w !== cb) }
    }
    const tick = async () => {
        const now = waiting
        waiting = []
        for (const cb of now) cb()
        // Let the job's await and the queue's follow-up settle.
        for (let i = 0; i < 5; i++) await Promise.resolve()
    }
    return { defer, tick, waiting: () => waiting.length }
}

function setup(paused = () => false) {
    const clock = manual()
    const queue = new BuildQueue(paused, clock.defer)
    const ran: string[] = []
    const onScreen = new Set<string>()
    const job = (name: string, run: () => unknown = () => {}) => queue.add({
        urgent: () => onScreen.has(name),
        run: () => {
            ran.push(name)
            return run()
        }
    })
    return { ...clock, queue, ran, onScreen, job }
}

describe('build queue', () => {
    it('runs one job per idle moment, in the order added', async () => {
        const { job, tick, ran } = setup()
        job('a')
        job('b')
        job('c')
        expect(ran).toEqual([])
        await tick()
        expect(ran).toEqual(['a'])
        await tick()
        await tick()
        expect(ran).toEqual(['a', 'b', 'c'])
    })

    it('builds cards on screen before the ones scrolled away, even once queued', async () => {
        const { job, tick, ran, onScreen } = setup()
        job('a')
        job('b')
        job('c')
        onScreen.add('c')
        await tick()
        expect(ran).toEqual(['c'])
        onScreen.add('b')
        await tick()
        await tick()
        expect(ran).toEqual(['c', 'b', 'a'])
    })

    it('waits for a job to settle before starting the next', async () => {
        const { job, tick, ran, waiting } = setup()
        let finish = () => {}
        job('slow', () => new Promise<void>((resolve) => { finish = resolve }))
        job('next')
        await tick()
        expect(ran).toEqual(['slow'])
        expect(waiting()).toBe(0)
        finish()
        await tick()
        await tick()
        expect(ran).toEqual(['slow', 'next'])
    })

    it('keeps going after a job throws', async () => {
        const { job, tick, ran } = setup()
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        job('bad', () => { throw new Error('boom') })
        job('good')
        await tick()
        await tick()
        expect(error).toHaveBeenCalledOnce()
        error.mockRestore()
        expect(ran).toEqual(['bad', 'good'])
    })

    it('holds jobs while paused', async () => {
        let paused = true
        const { job, tick, ran } = setup(() => paused)
        job('a')
        await tick()
        await tick()
        expect(ran).toEqual([])
        paused = false
        await tick()
        expect(ran).toEqual(['a'])
    })

    it('drops everything still waiting on stop, and takes nothing after', async () => {
        const { job, tick, ran, queue, waiting } = setup()
        let finish = () => {}
        job('running', () => new Promise<void>((resolve) => { finish = resolve }))
        job('waiting')
        await tick()
        queue.stop()
        job('late')
        expect(queue.size).toBe(0)
        finish()
        await tick()
        await tick()
        expect(ran).toEqual(['running'])
        expect(waiting()).toBe(0)
    })

    it('cancels its pending idle callback on stop', () => {
        const { job, queue, waiting } = setup()
        job('a')
        expect(waiting()).toBe(1)
        queue.stop()
        expect(waiting()).toBe(0)
    })
})
