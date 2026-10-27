// @vitest-environment node
// The page's side of recognizing cards by their artwork (ADR 0041): the photo goes to the worker as a
// bitmap, and what comes back is the cards, the progress, or an error. The worker keeps the page free.
import { afterEach, describe, expect, it, vi } from 'vitest'

type Listener = (event: unknown) => void

class FakeWorker {
  static instances: FakeWorker[] = []
  listeners = new Map<string, Set<Listener>>()
  posted: Array<{ message: Record<string, unknown>, transfer: unknown }> = []
  terminated = false

  constructor(public url: URL, public options?: unknown) {
    FakeWorker.instances.push(this)
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(listener))
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener)
  }

  postMessage(message: Record<string, unknown>, transfer?: unknown) {
    this.posted.push({ message, transfer })
  }

  terminate() {
    this.terminated = true
  }

  reply(data: Record<string, unknown>) {
    for (const listener of [...(this.listeners.get('message') ?? [])]) {
      listener({ data })
    }
  }

  fail(message: string) {
    for (const listener of [...(this.listeners.get('error') ?? [])]) {
      listener({ message })
    }
  }
}

const RESULT = { cards: [{ cardId: 46986414, similarity: 0.8, margin: 0.2, copies: 1, support: 6, sure: true }], rotation: 0, rotationScores: [0.4, 0.02, 0.03], windows: 120, device: 'webgpu', seconds: 12.5 }

describe('recognizeArt', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    FakeWorker.instances = []
  })

  async function setup() {
    const bitmap = { width: 10, height: 10, close: vi.fn() }
    vi.stubGlobal('Worker', FakeWorker)
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve(bitmap)))
    const { recognizeArt } = await import('../../app/utils/art-vision')
    return { recognizeArt, bitmap }
  }

  /** Waits until the request has reached the worker (the photo is turned into a bitmap first). */
  async function posted(index = 0) {
    await vi.waitFor(() => expect(FakeWorker.instances[0]?.posted[index]).toBeDefined())
    return { worker: FakeWorker.instances[0]!, ...FakeWorker.instances[0]!.posted[index]! }
  }

  it('hands the photo over as a bitmap, finding out how it lies unless told, and returns the cards', async () => {
    const { recognizeArt, bitmap } = await setup()

    const cards = recognizeArt(new Blob(['x']))
    const { worker, message, transfer } = await posted()

    expect(message).toMatchObject({ bitmap, rotation: 'auto' })
    expect(transfer).toEqual([bitmap])
    expect(worker.options).toEqual({ type: 'module', name: 'art' })

    worker.reply({ id: message.id, type: 'result', result: RESULT })
    await expect(cards).resolves.toEqual(RESULT)
  })

  it('starts a worker that stays on the processor when the browser was told so (for testing that way)', async () => {
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'ygo-art-device' ? 'processor' : null })
    const { recognizeArt } = await setup()

    void recognizeArt(new Blob(['x']))
    const { worker } = await posted()

    expect(worker.options).toEqual({ type: 'module', name: 'art-processor' })
  })

  it('starts a worker that runs the graphics card in full precision when the browser was told so', async () => {
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'ygo-art-device' ? 'full' : null })
    const { recognizeArt } = await setup()

    void recognizeArt(new Blob(['x']))
    const { worker } = await posted()

    expect(worker.options).toEqual({ type: 'module', name: 'art-full-precision' })
  })

  it('does not mind a browser without storage', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') } })
    const { recognizeArt } = await setup()

    void recognizeArt(new Blob(['x']))
    const { worker } = await posted()

    expect(worker.options).toEqual({ type: 'module', name: 'art' })
  })

  it('passes a known rotation on, forwards the progress, and ignores replies to other requests', async () => {
    const { recognizeArt } = await setup()
    const seen: Array<[string, number | null, string | undefined]> = []

    const cards = recognizeArt(new Blob(['x']), { rotation: 270, onProgress: progress => seen.push([progress.stage, progress.percent, progress.device]) })
    const { worker, message } = await posted()
    expect(message.rotation).toBe(270)

    worker.reply({ id: 999, type: 'progress', stage: 'scanning', percent: 99 })
    worker.reply({ id: message.id, type: 'progress', stage: 'model', percent: 40 })
    worker.reply({ id: message.id, type: 'progress', stage: 'scanning', percent: null, device: 'wasm' })
    worker.reply({ id: message.id, type: 'result', result: RESULT })

    await cards
    expect(seen).toEqual([['model', 40, undefined], ['scanning', null, 'wasm']])
  })

  it('starts the worker once and reuses it, because it holds the model and the index', async () => {
    const { recognizeArt } = await setup()

    const first = recognizeArt(new Blob(['x']))
    const one = await posted(0)
    one.worker.reply({ id: one.message.id, type: 'result', result: RESULT })
    await first
    const second = recognizeArt(new Blob(['y']))
    const two = await posted(1)
    two.worker.reply({ id: two.message.id, type: 'result', result: RESULT })

    await expect(second).resolves.toEqual(RESULT)
    expect(FakeWorker.instances).toHaveLength(1)
  })

  it('rejects with the worker\'s error message', async () => {
    const { recognizeArt } = await setup()

    const cards = recognizeArt(new Blob(['x']))
    const { worker, message } = await posted()
    worker.reply({ id: message.id, type: 'error', message: 'The artwork index answered 404' })

    await expect(cards).rejects.toThrow('answered 404')
  })

  it('throws a worker that could not start away and starts a new one next time', async () => {
    const { recognizeArt } = await setup()

    const failing = recognizeArt(new Blob(['x']))
    const { worker: broken } = await posted()
    broken.fail('Refused to create a worker')
    await expect(failing).rejects.toThrow('Refused')
    expect(broken.terminated).toBe(true)

    const retry = recognizeArt(new Blob(['y']))
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2))
    const fresh = FakeWorker.instances[1]!
    await vi.waitFor(() => expect(fresh.posted).toHaveLength(1))
    fresh.reply({ id: fresh.posted[0]!.message.id, type: 'result', result: RESULT })
    await expect(retry).resolves.toEqual(RESULT)
  })
})
