<script setup lang="ts">
// "Diktieren" (ADR 0040): the user speaks a card list ("drei Blauäugiger weißer
// Drache, zwei Kuriboh"), Whisper writes it down on the device, and the card lines
// go to whoever uses this: the quick capture's list, the deck import's text. Where
// the microphone is not available (a phone on plain http://192.168…) the user picks
// a recording instead; the phone opens its voice recorder for that.
import { DEFAULT_SPEECH_QUALITY, SPEECH_MODELS } from '~/utils/speech-models'
import type { SpeechLanguage, SpeechQuality } from '~/utils/speech-models'
import { canRecordMicrophone, decodeAudio, startRecording, transcribe } from '~/utils/speech-transcribe'
import type { Recording } from '~/utils/speech-transcribe'
import { spokenCardLines } from '~/utils/spoken-card-lines'

const emit = defineEmits<{
  /** The cards that were said, as card lines (`3x Name`). */
  lines: [lines: string[]]
}>()

const { t, n, locale } = useI18n()

type Phase = 'idle' | 'recording' | 'working'
const phase = ref<Phase>('idle')
const seconds = ref(0)
const loadPercent = ref<number | null>(null)
const heard = ref('')
const errorMessage = ref('')
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')

// How exactly the recording is written down: the larger speech model is the default, the
// smaller one is faster. The choice is a per-person convenience, kept in the browser.
const QUALITY_KEY = 'ygo-speech-quality'
const quality = ref<SpeechQuality>(DEFAULT_SPEECH_QUALITY)
const qualityItems = computed(() => (['accurate', 'fast'] as const).map(value => ({ value, label: t(`quickEntry.speech.quality.${value}`) })))

// Known on the client only; the server cannot tell what the browser has.
const microphone = ref(false)
onMounted(() => {
  microphone.value = canRecordMicrophone()
  try {
    const saved = localStorage.getItem(QUALITY_KEY)
    if (saved === 'fast' || saved === 'accurate') {
      quality.value = saved
    }
  }
  catch {
    // No storage (a private window): the default stays.
  }
})

watch(quality, (value) => {
  try {
    localStorage.setItem(QUALITY_KEY, value)
  }
  catch {
    // Not kept; the choice still holds for this page.
  }
})

/** The language the cards are said in: the card language (German cards are said in German). */
const { cardLocale } = useCardText()
const language = computed<SpeechLanguage>(() => (cardLocale.value === 'de' || locale.value === 'de' ? 'german' : 'english'))

let recording: Recording | null = null
let ticker: ReturnType<typeof setInterval> | undefined

function stopTicker() {
  clearInterval(ticker)
  ticker = undefined
}

async function finish(audio: Blob) {
  phase.value = 'working'
  loadPercent.value = null
  try {
    const samples = await decodeAudio(audio)
    heard.value = await transcribe(samples, language.value, quality.value, (progress) => {
      loadPercent.value = progress.percent
    })
    const lines = spokenCardLines(heard.value)
    if (lines.length === 0) {
      errorMessage.value = t('quickEntry.speech.nothing')
    }
    else {
      emit('lines', lines)
    }
  }
  catch {
    errorMessage.value = t('quickEntry.speech.errors.failed')
  }
  finally {
    phase.value = 'idle'
    loadPercent.value = null
  }
}

async function start() {
  errorMessage.value = ''
  heard.value = ''
  try {
    recording = await startRecording(() => {
      stopTicker()
      stop()
    })
  }
  catch {
    errorMessage.value = t('quickEntry.speech.errors.denied')
    return
  }
  seconds.value = 0
  phase.value = 'recording'
  ticker = setInterval(() => {
    seconds.value += 1
  }, 1000)
}

async function stop() {
  stopTicker()
  const active = recording
  recording = null
  if (!active) {
    return
  }
  await finish(await active.stop())
}

async function onPickFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) {
    return
  }
  errorMessage.value = ''
  heard.value = ''
  await finish(file)
}

onBeforeUnmount(() => {
  stopTicker()
  recording?.stop().catch(() => undefined)
})
</script>

<template>
  <div class="space-y-2">
    <div class="flex flex-wrap items-center gap-3">
      <input
        ref="fileInput"
        type="file"
        accept="audio/*"
        capture
        class="sr-only"
        tabindex="-1"
        :aria-label="t('quickEntry.speech.pickFile')"
        @change="onPickFile"
      >
      <UButton
        v-if="microphone && phase !== 'recording'"
        icon="i-lucide-mic"
        color="neutral"
        variant="outline"
        :label="t('quickEntry.speech.start')"
        :disabled="phase === 'working'"
        :loading="phase === 'working'"
        @click="start"
      />
      <UButton
        v-else-if="phase === 'recording'"
        icon="i-lucide-square"
        color="error"
        :label="t('quickEntry.speech.stop')"
        @click="stop"
      />
      <UButton
        icon="i-lucide-file-audio"
        color="neutral"
        variant="ghost"
        :label="t('quickEntry.speech.pickFile')"
        :disabled="phase !== 'idle'"
        @click="() => fileInput?.click()"
      />
      <USelect
        v-model="quality"
        :items="qualityItems"
        :disabled="phase !== 'idle'"
        size="sm"
        class="w-44"
        :aria-label="t('quickEntry.speech.quality.label')"
        data-testid="speech-quality"
      />
      <p class="min-w-0 flex-1 basis-64 text-xs text-muted">
        {{ microphone ? t('quickEntry.speech.hint') : t('quickEntry.speech.noMicrophone') }}
        {{ t('quickEntry.speech.quality.download', { size: n(SPEECH_MODELS[quality].megabytes, 'integer') }) }}
      </p>
    </div>

    <p
      v-if="phase === 'recording'"
      class="text-sm text-default"
      role="status"
      data-testid="speech-status"
    >
      {{ t('quickEntry.speech.recording', { seconds: n(seconds, 'integer') }) }}
    </p>
    <p
      v-else-if="phase === 'working'"
      class="text-sm text-default"
      role="status"
      data-testid="speech-status"
    >
      {{ loadPercent !== null && loadPercent < 100 ? t('quickEntry.speech.loading', { percent: n(loadPercent, 'integer') }) : t('quickEntry.speech.transcribing') }}
      <span
        v-if="quality === 'accurate' && (loadPercent === null || loadPercent >= 100)"
        class="block text-xs text-muted"
      >{{ t('quickEntry.speech.quality.slow') }}</span>
    </p>
    <p
      v-else-if="heard"
      class="text-sm text-default"
      data-testid="speech-heard"
    >
      {{ t('quickEntry.speech.heard', { text: heard }) }}
    </p>
    <p
      v-if="errorMessage"
      role="alert"
      class="text-sm text-error"
    >
      {{ errorMessage }}
    </p>
  </div>
</template>
