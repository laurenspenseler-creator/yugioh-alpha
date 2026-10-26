// The background thread of the dictation (ADR 0040): it gets a recording and the size of the
// model, writes it down, and reports how far the model's download is. The page talks to it
// through `transcribe()` in `app/utils/speech-transcribe.ts`.
import { transcribeAudio } from '~/utils/speech-engine'
import type { SpeechLanguage, SpeechQuality } from '~/utils/speech-models'

export interface SpeechRequest {
  id: number
  audio: Float32Array
  language: SpeechLanguage
  quality: SpeechQuality
}

export type SpeechReply
  = | { id: number, type: 'progress', percent: number | null }
    | { id: number, type: 'result', text: string }
    | { id: number, type: 'error', message: string }

const scope = self as unknown as { onmessage: ((event: MessageEvent<SpeechRequest>) => void) | null, postMessage: (reply: SpeechReply) => void }

scope.onmessage = async ({ data }) => {
  try {
    const text = await transcribeAudio(data.audio, data.language, data.quality, progress => scope.postMessage({ id: data.id, type: 'progress', percent: progress.percent }))
    scope.postMessage({ id: data.id, type: 'result', text })
  }
  catch (error) {
    scope.postMessage({ id: data.id, type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
