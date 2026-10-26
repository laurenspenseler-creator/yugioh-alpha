// @vitest-environment node
// The page's side of the dictation (ADR 0040): the recording goes to the speech worker, and what
// comes back is the text, the progress of the model's download, or an error. The worker keeps the
// page free while Whisper works.
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

  /** What the worker sends back. */
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

describe('transcribe', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    FakeWorker.instances = []
  })

  async function setup() {
    vi.stubGlobal('Worker', FakeWorker)
    return await import('../../app/utils/speech-transcribe')
  }

  it('sends the recording to the worker, the accurate size unless told otherwise, and returns its text', async () => {
    const { transcribe } = await setup()
    const audio = new Float32Array(16_000)

    const text = transcribe(audio, 'german')
    const worker = FakeWorker.instances[0]!
    const { message, transfer } = worker.posted[0]!
    expect(message).toMatchObject({ language: 'german', quality: 'accurate', audio })
    expect(transfer).toEqual([audio.buffer])
    expect(worker.options).toEqual({ type: 'module' })

    worker.reply({ id: message.id, type: 'result', text: 'Kuriboh' })
    await expect(text).resolves.toBe('Kuriboh')
  })

  it('passes the size on, forwards the progress of the download, and ignores replies to other requests', async () => {
    const { transcribe } = await setup()
    const seen: Array<number | null> = []

    const text = transcribe(new Float32Array(100), 'english', 'fast', progress => seen.push(progress.percent))
    const worker = FakeWorker.instances[0]!
    const { id, quality } = worker.posted[0]!.message
    expect(quality).toBe('fast')

    worker.reply({ id: 999, type: 'progress', percent: 77 })
    worker.reply({ id, type: 'progress', percent: 30 })
    worker.reply({ id, type: 'progress', percent: null })
    worker.reply({ id, type: 'result', text: 'two Kuriboh' })

    await expect(text).resolves.toBe('two Kuriboh')
    expect(seen).toEqual([30, null])
  })

  it('starts the worker once and reuses it, because it holds the loaded model', async () => {
    const { transcribe } = await setup()

    const first = transcribe(new Float32Array(100), 'german')
    const worker = FakeWorker.instances[0]!
    worker.reply({ id: worker.posted[0]!.message.id, type: 'result', text: 'a' })
    await first
    const second = transcribe(new Float32Array(100), 'german')
    worker.reply({ id: worker.posted[1]!.message.id, type: 'result', text: 'b' })

    await expect(second).resolves.toBe('b')
    expect(FakeWorker.instances).toHaveLength(1)
  })

  it('rejects with the worker\'s error message', async () => {
    const { transcribe } = await setup()

    const text = transcribe(new Float32Array(100), 'german')
    const worker = FakeWorker.instances[0]!
    worker.reply({ id: worker.posted[0]!.message.id, type: 'error', message: 'offline' })

    await expect(text).rejects.toThrow('offline')
  })

  it('throws a worker that could not start away and starts a new one next time', async () => {
    const { transcribe } = await setup()

    const failing = transcribe(new Float32Array(100), 'german')
    const broken = FakeWorker.instances[0]!
    broken.fail('Refused to create a worker')
    await expect(failing).rejects.toThrow('Refused to create a worker')
    expect(broken.terminated).toBe(true)

    const retry = transcribe(new Float32Array(100), 'german')
    expect(FakeWorker.instances).toHaveLength(2)
    const fresh = FakeWorker.instances[1]!
    fresh.reply({ id: fresh.posted[0]!.message.id, type: 'result', text: 'ok' })
    await expect(retry).resolves.toBe('ok')
  })
})
