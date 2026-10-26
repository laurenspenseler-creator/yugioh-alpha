// The speech models the on-device dictation can use (ADR 0040), kept apart from the code that
// runs them so the page and the worker that runs them in the background share one list.

/**
 * Two sizes of the same model: "base" is fast and misses names it does not know, "small"
 * is three to four times slower (33 s for 9 s of speech on a laptop) and writes far more of
 * them down right (14 of 21 cards on a test dictation against 8, before the lookup's help).
 */
export type SpeechQuality = 'fast' | 'accurate'

export const SPEECH_MODELS: Record<SpeechQuality, { id: string, megabytes: number }> = {
  fast: { id: 'Xenova/whisper-base', megabytes: 75 },
  accurate: { id: 'Xenova/whisper-small', megabytes: 240 },
}

export const DEFAULT_SPEECH_QUALITY: SpeechQuality = 'accurate'

export type SpeechLanguage = 'german' | 'english'

export interface SpeechLoadProgress {
  /** 0–100 over the whole download, or null while it is not known. */
  percent: number | null
}
