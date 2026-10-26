// Speech to text on the device (ADR 0040): the microphone (or a recording the
// user picks) is decoded to 16 kHz mono here, and written down by Whisper (multilingual,
// 8-bit quantized) in a Web Worker (`app/workers/speech.worker.ts`, the engine is
// `speech-engine.ts`), so the page stays usable while it works. No account, no key, no
// server: the audio never leaves the device.
import { DEFAULT_SPEECH_QUALITY } from '~/utils/speech-models'
import type { SpeechLanguage, SpeechLoadProgress, SpeechQuality } from '~/utils/speech-models'
import type { SpeechReply, SpeechRequest } from '~/workers/speech.worker'

const SAMPLE_RATE = 16_000
/** A recording stops by itself after this long: a card list is read out in well under a minute. */
export const MAX_RECORDING_SECONDS = 90

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

let worker: Worker | null = null
let lastRequest = 0

/** The background thread, started on first use and kept (it holds the loaded model). */
function speechWorker(): Worker {
  worker ??= new Worker(new URL('../workers/speech.worker.ts', import.meta.url), { type: 'module' })
  return worker
}

/** What was said in the audio, written down; `language` is the language it is spoken in. */
export function transcribe(
  audio: Float32Array,
  language: SpeechLanguage,
  quality: SpeechQuality = DEFAULT_SPEECH_QUALITY,
  onProgress?: (progress: SpeechLoadProgress) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const thread = speechWorker()
    lastRequest += 1
    const id = lastRequest

    const done = () => {
      thread.removeEventListener('message', onMessage)
      thread.removeEventListener('error', onFailure)
    }
    const onMessage = (event: MessageEvent<SpeechReply>) => {
      const reply = event.data
      if (reply.id !== id) {
        return
      }
      if (reply.type === 'progress') {
        onProgress?.({ percent: reply.percent })
        return
      }
      done()
      if (reply.type === 'result') {
        resolve(reply.text)
      }
      else {
        reject(new Error(reply.message))
      }
    }
    // The thread itself could not start (a blocked or missing script): start a new one next time.
    const onFailure = (event: ErrorEvent) => {
      done()
      thread.terminate()
      worker = null
      reject(new Error(event.message || 'The speech worker failed'))
    }
    thread.addEventListener('message', onMessage)
    thread.addEventListener('error', onFailure)

    const request: SpeechRequest = { id, audio, language, quality }
    thread.postMessage(request, [audio.buffer])
  })
}
