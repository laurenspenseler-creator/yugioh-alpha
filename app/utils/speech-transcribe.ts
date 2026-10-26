// Speech to text on the device (ADR 0040): the microphone (or a recording the
// user picks) is decoded to 16 kHz mono and written down by Whisper (base,
// multilingual, 8-bit quantized) running in WebAssembly through transformers.js.
// No account, no key, no server: the audio never leaves the device.
import { AI_ASSETS, aiAssetServed } from '~/utils/ai-assets'

export const SPEECH_MODEL = 'Xenova/whisper-base'
const SAMPLE_RATE = 16_000
/** A recording stops by itself after this long: a card list is read out in well under a minute. */
export const MAX_RECORDING_SECONDS = 90

export type SpeechLanguage = 'german' | 'english'

export interface SpeechLoadProgress {
  /** 0–100 over the whole download, or null while it is not known. */
  percent: number | null
}

/** The microphone needs a secure page (HTTPS, localhost or the desktop app); a phone on plain http://192.168… has none. */
export function canRecordMicrophone(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined'
}

export interface Recording {
  /** Ends the recording and returns what was said as one audio blob. */
  stop: () => Promise<Blob>
}

/** Starts recording the microphone; call `stop()` on the result (or it stops itself after `MAX_RECORDING_SECONDS`). */
export async function startRecording(onAutoStop?: () => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data)
    }
  })

  const finished = new Promise<Blob>((resolve) => {
    recorder.addEventListener('stop', () => {
      for (const track of stream.getTracks()) {
        track.stop()
      }
      resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
    })
  })
  recorder.start()

  const timer = setTimeout(() => {
    if (recorder.state === 'recording') {
      recorder.stop()
      onAutoStop?.()
    }
  }, MAX_RECORDING_SECONDS * 1000)

  return {
    stop: () => {
      clearTimeout(timer)
      if (recorder.state === 'recording') {
        recorder.stop()
      }
      return finished
    },
  }
}

/** The samples of an audio file (any format the browser plays), as 16 kHz mono floats. */
export async function decodeAudio(blob: Blob): Promise<Float32Array> {
  const context = new AudioContext()
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    const length = Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE))
    const offline = new OfflineAudioContext(1, length, SAMPLE_RATE)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    return (await offline.startRendering()).getChannelData(0)
  }
  finally {
    await context.close()
  }
}

type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string } | Array<{ text: string }>>

let loading: Promise<Transcriber> | null = null

/** Loads Whisper once (the files are fetched on first use unless the build ships them) and keeps it. */
function loadTranscriber(onProgress?: (progress: SpeechLoadProgress) => void): Promise<Transcriber> {
  loading ??= (async () => {
    const { pipeline, env } = await import('@huggingface/transformers')
    env.backends.onnx.wasm!.wasmPaths = `${AI_ASSETS}/onnx/`
    env.localModelPath = `${AI_ASSETS}/models/`
    env.allowLocalModels = await aiAssetServed(`models/${SPEECH_MODEL}/config.json`)
    env.allowRemoteModels = true

    // The model arrives as several files; report the share of what is announced so far.
    const files = new Map<string, { loaded: number, total: number }>()
    const transcriber = await pipeline('automatic-speech-recognition', SPEECH_MODEL, {
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
    loading = null
    throw error
  })
  return loading
}

/** What was said in the audio, written down; `language` is the language it is spoken in. */
export async function transcribe(
  audio: Float32Array,
  language: SpeechLanguage,
  onProgress?: (progress: SpeechLoadProgress) => void,
): Promise<string> {
  const transcriber = await loadTranscriber(onProgress)
  const result = await transcriber(audio, { language, task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 })
  return (Array.isArray(result) ? result.map(part => part.text).join(' ') : result.text).trim()
}
