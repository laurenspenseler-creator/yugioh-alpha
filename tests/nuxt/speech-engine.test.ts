// @vitest-environment node
// What the speech worker runs (ADR 0040): "accurate" is the small Whisper and the default, "fast"
// the base one; each is loaded once and kept.
import { afterEach, describe, expect, it, vi } from 'vitest'

function stubTransformers() {
  const transcriber = vi.fn(() => Promise.resolve({ text: ' Kuriboh ' }))
  const pipeline = vi.fn(() => Promise.resolve(transcriber))
  const env = { backends: { onnx: { wasm: {} as Record<string, unknown> } } } as Record<string, unknown>
  vi.doMock('@huggingface/transformers', () => ({ pipeline, env }))
  vi.stubGlobal('fetch', () => Promise.resolve({ ok: false }))
  return { pipeline, transcriber }
}

describe('transcribeAudio', () => {
  afterEach(() => {
    vi.doUnmock('@huggingface/transformers')
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('lists the small model as the accurate one and the default, the base model as the fast one', async () => {
    const { DEFAULT_SPEECH_QUALITY, SPEECH_MODELS } = await import('../../app/utils/speech-models')

    expect(DEFAULT_SPEECH_QUALITY).toBe('accurate')
    expect(SPEECH_MODELS.accurate.id).toBe('Xenova/whisper-small')
    expect(SPEECH_MODELS.fast.id).toBe('Xenova/whisper-base')
  })

  it('loads the model of the size asked for', async () => {
    const { pipeline } = stubTransformers()
    const { transcribeAudio } = await import('../../app/utils/speech-engine')

    await transcribeAudio(new Float32Array(16_000), 'german', 'accurate')
    await transcribeAudio(new Float32Array(16_000), 'german', 'fast')

    expect(pipeline.mock.calls.map(call => (call as unknown[])[1])).toEqual(['Xenova/whisper-small', 'Xenova/whisper-base'])
  })

  it('loads each size once, hands the language over, and trims the text', async () => {
    const { pipeline, transcriber } = stubTransformers()
    const { transcribeAudio } = await import('../../app/utils/speech-engine')

    const first = await transcribeAudio(new Float32Array(16_000), 'german', 'fast')
    await transcribeAudio(new Float32Array(16_000), 'english', 'fast')

    expect(first).toBe('Kuriboh')
    expect(pipeline).toHaveBeenCalledTimes(1)
    expect(transcriber).toHaveBeenCalledTimes(2)
    expect(transcriber.mock.calls[1]).toEqual([expect.any(Float32Array), expect.objectContaining({ language: 'english', task: 'transcribe' })])
  })

  it('reports how far the download of the model is, over all its files', async () => {
    const transcriber = vi.fn(() => Promise.resolve({ text: 'Kuriboh' }))
    const pipeline = vi.fn((_task: string, _model: string, options: { progress_callback: (event: unknown) => void }) => {
      options.progress_callback({ status: 'progress', file: 'a.onnx', loaded: 50, total: 100 })
      options.progress_callback({ status: 'progress', file: 'b.onnx', loaded: 0, total: 100 })
      options.progress_callback({ status: 'progress', file: 'a.onnx', loaded: 100, total: 100 })
      return Promise.resolve(transcriber)
    })
    vi.doMock('@huggingface/transformers', () => ({ pipeline, env: { backends: { onnx: { wasm: {} } } } }))
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false }))
    const { transcribeAudio } = await import('../../app/utils/speech-engine')
    const seen: Array<number | null> = []

    await transcribeAudio(new Float32Array(16_000), 'german', 'fast', progress => seen.push(progress.percent))

    expect(seen).toEqual([50, 25, 50])
  })

  it('tries a size again after a failed load (offline on first use)', async () => {
    const transcriber = vi.fn(() => Promise.resolve({ text: 'Kuriboh' }))
    const pipeline = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(transcriber)
    vi.doMock('@huggingface/transformers', () => ({ pipeline, env: { backends: { onnx: { wasm: {} } } } }))
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false }))
    const { transcribeAudio } = await import('../../app/utils/speech-engine')

    await expect(transcribeAudio(new Float32Array(16_000), 'german', 'accurate')).rejects.toThrow('offline')
    await expect(transcribeAudio(new Float32Array(16_000), 'german', 'accurate')).resolves.toBe('Kuriboh')
    expect(pipeline).toHaveBeenCalledTimes(2)
  })
})
