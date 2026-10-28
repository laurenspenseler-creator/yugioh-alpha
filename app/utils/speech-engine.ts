// Whisper in WebAssembly through transformers.js (ADR 0040). It runs in a Web Worker
// (`app/workers/speech.worker.ts`), never on the page: the accurate model keeps a CPU busy
// for over a minute, and on the page that froze every button and the scrolling.
import { AI_ASSETS, aiAssetServed } from '~/utils/ai-assets'
import { SPEECH_MODELS } from '~/utils/speech-models'
import type { SpeechLanguage, SpeechLoadProgress, SpeechQuality } from '~/utils/speech-models'

type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string } | Array<{ text: string }>>

const loading = new Map<SpeechQuality, Promise<Transcriber>>()

/** Loads Whisper of this size once (the files are fetched on first use unless the build ships them) and keeps it. */
function loadTranscriber(quality: SpeechQuality, onProgress?: (progress: SpeechLoadProgress) => void): Promise<Transcriber> {
  const known = loading.get(quality)
  if (known) {
    return known
  }
  const model = SPEECH_MODELS[quality].id
  const started = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers')
    env.backends.onnx.wasm!.wasmPaths = `${AI_ASSETS}/onnx/`
    env.localModelPath = `${AI_ASSETS}/models/`
    env.allowLocalModels = await aiAssetServed(`models/${model}/config.json`)
    env.allowRemoteModels = true

    // The model arrives as several files; report the share of what is announced so far.
    const files = new Map<string, { loaded: number, total: number }>()
    const transcriber = await pipeline('automatic-speech-recognition', model, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (event: { status: string, file?: string, loaded?: number, total?: number }) => {
        if (event.status === 'progress' && event.file && event.total) {
          files.set(event.file, { loaded: event.loaded ?? 0, total: event.total })
          const all = [...files.values()]
          const total = all.reduce((sum, file) => sum + file.total, 0)
          onProgress?.({ percent: total > 0 ? Math.round((all.reduce((sum, file) => sum + file.loaded, 0) / total) * 100) : null })
        }
      },
    })
    return transcriber as unknown as Transcriber
  })().catch((error) => {
    // A failed load (offline on first use) can be tried again.
    loading.delete(quality)
    throw error
  })
  loading.set(quality, started)
  return started
}

/** What was said in the audio (16 kHz mono), written down; `language` is the language it is spoken in. */
export async function transcribeAudio(
  audio: Float32Array,
  language: SpeechLanguage,
  quality: SpeechQuality,
  onProgress?: (progress: SpeechLoadProgress) => void,
): Promise<string> {
  const transcriber = await loadTranscriber(quality, onProgress)
  // With timestamps: without them Whisper writes down only the start of a 30 second stretch of names said one
  // after the other and drops the rest (14 of 48 cards missing from a minute and a half of a deck list).
  const result = await transcriber(audio, { language, task: 'transcribe', chunk_length_s: 30, stride_length_s: 5, return_timestamps: true })
  return (Array.isArray(result) ? result.map(part => part.text).join(' ') : result.text).trim()
}
