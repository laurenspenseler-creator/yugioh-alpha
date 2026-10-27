<script setup lang="ts">
// "Fotos auswerten" (ADR 0040, 0041): one or several photos of cards are read on the
// device twice at the same time: Tesseract (WebAssembly) reads the printed names, and a
// vision model recognizes the artwork of each card. The text and the card ids go to the
// server, which finds the card names in the text and puts both together, and the cards come
// out as lines ("3x Dark Magician") for the review table of whoever uses this: the quick
// capture, the deck import, the inventory's files. Nothing is saved here, and only text
// and card ids leave the device, never the photo.
import { SURE_SCORE } from '~~/shared/card-photo'
import type { PhotoCardMatch } from '~~/shared/card-photo'
import { recognizeArt } from '~/utils/art-vision'
import type { ArtProgress } from '~/utils/art-vision'
import { readPhotoLines } from '~/utils/photo-ocr'

const MAX_PHOTOS = 8
const MAX_PHOTO_MB = 25

const emit = defineEmits<{
  /** The cards of all photos as card lines, merged; `unsure` of them are doubtful. */
  lines: [result: { lines: string[], photos: number, unsure: number }]
}>()

const { t, n } = useI18n()
const apiError = useApiError()

const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const cameraInput = useTemplateRef<HTMLInputElement>('cameraInput')
const isBusy = ref(false)
const progress = ref<{ photo: number, photos: number, pass: number, passes: number } | null>(null)
const artProgress = ref<ArtProgress | null>(null)
const errorMessage = ref('')
const result = ref<{ cards: number, unsure: number } | null>(null)

// Taking a photo needs a camera; show that button on phones and tablets only.
const hasCamera = ref(false)
onMounted(() => {
  hasCamera.value = window.matchMedia('(pointer: coarse)').matches
})

const progressLabel = computed(() => progress.value
  ? t('quickEntry.photo.progress', { photo: progress.value.photo, photos: progress.value.photos, pass: progress.value.pass, passes: progress.value.passes })
  : '')
const artLabel = computed(() => {
  const current = artProgress.value
  return current ? t(`quickEntry.photo.art.${current.stage}`, { percent: n(current.percent ?? 0, 'integer') }) : ''
})

function validate(files: File[]): string {
  if (files.length > MAX_PHOTOS) {
    return t('quickEntry.photo.errors.tooMany', { max: n(MAX_PHOTOS, 'integer') })
  }
  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      return t('quickEntry.photo.errors.notImage', { name: file.name })
    }
    if (file.size > MAX_PHOTO_MB * 1024 * 1024) {
      return t('quickEntry.photo.errors.tooLarge', { name: file.name, max: n(MAX_PHOTO_MB, 'integer') })
    }
  }
  return ''
}

async function onPick(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  // So the same photo can be picked again.
  input.value = ''
  if (files.length === 0 || isBusy.value) {
    return
  }

  errorMessage.value = validate(files)
  result.value = null
  if (errorMessage.value !== '') {
    return
  }

  isBusy.value = true
  const found = new Map<number, PhotoCardMatch>()
  try {
    for (const [index, file] of files.entries()) {
      // The printed names and the artwork are looked at at the same time, each in a thread of its own;
      // one that fails (no artwork index in this build, say) leaves the other's cards. English and
      // German are read together whatever the card language is: a German name read with the English
      // model alone came out as a different card in about every third photo.
      const [text, art] = await Promise.allSettled([
        readPhotoLines(file, {
          onPass: (pass, total) => {
            progress.value = { photo: index + 1, photos: files.length, pass: pass + 1, passes: total }
          },
        }),
        recognizeArt(file, { onProgress: (current) => { artProgress.value = current } }),
      ])
      if (text.status === 'rejected' && art.status === 'rejected') {
        throw text.reason
      }
      if (art.status === 'rejected') {
        // The text reading alone still gives cards; what went wrong with the artwork is for whoever opens the console.
        console.warn('[photo] the artwork could not be recognized', art.reason)
      }
      const response = await $fetch<{ matches: PhotoCardMatch[] }>('/api/cards/match-fragments', {
        method: 'POST',
        body: { passes: text.status === 'fulfilled' ? text.value : [], art: art.status === 'fulfilled' ? art.value.cards : [] },
      })
      for (const match of response.matches) {
        const known = found.get(match.cardId)
        // The same card on two photos adds up: the review table lets the user take copies off.
        found.set(match.cardId, known ? { ...known, count: known.count + match.count, score: Math.max(known.score, match.score) } : match)
      }
    }
  }
  catch (error) {
    errorMessage.value = apiError(error, navigator.onLine ? 'quickEntry.photo.errors.failed' : 'quickEntry.photo.errors.offline')
    return
  }
  finally {
    isBusy.value = false
    progress.value = null
    artProgress.value = null
  }

  // A sure card goes in by its catalog name; a doubtful one as it was read, so the review shows it as doubtful.
  const cards = [...found.values()].sort((a, b) => b.count - a.count || b.score - a.score)
  const lines = cards.map(card => `${card.count}x ${card.score >= SURE_SCORE ? card.name : card.text}`)
  const unsure = cards.filter(card => card.score < SURE_SCORE).length
  result.value = { cards: cards.length, unsure }
  if (lines.length > 0) {
    emit('lines', { lines, photos: files.length, unsure })
  }
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex flex-wrap items-center gap-3">
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        multiple
        class="sr-only"
        tabindex="-1"
        :aria-label="t('quickEntry.photo.button')"
        @change="onPick"
      >
      <input
        v-if="hasCamera"
        ref="cameraInput"
        type="file"
        accept="image/*"
        capture="environment"
        class="sr-only"
        tabindex="-1"
        :aria-label="t('quickEntry.photo.camera')"
        @change="onPick"
      >
      <UButton
        icon="i-lucide-images"
        color="neutral"
        variant="outline"
        :label="t('quickEntry.photo.button')"
        :loading="isBusy"
        :disabled="isBusy"
        @click="() => fileInput?.click()"
      />
      <UButton
        v-if="hasCamera"
        icon="i-lucide-camera"
        color="neutral"
        variant="outline"
        :label="t('quickEntry.photo.camera')"
        :disabled="isBusy"
        @click="() => cameraInput?.click()"
      />
      <p class="min-w-0 flex-1 basis-64 text-xs text-muted">
        {{ t('quickEntry.photo.hint') }}
      </p>
    </div>

    <p
      v-if="isBusy"
      class="text-sm text-default"
      role="status"
      data-testid="photo-progress"
    >
      {{ progressLabel || t('quickEntry.photo.starting') }}
      <span
        v-if="artLabel"
        class="block text-xs text-muted"
        data-testid="photo-art-progress"
      >{{ artLabel }}</span>
    </p>
    <p
      v-else-if="result"
      class="text-sm text-default"
      role="status"
      data-testid="photo-result"
    >
      <template v-if="result.cards > 0">
        {{ t('quickEntry.photo.result', { count: n(result.cards, 'integer') }, result.cards) }}<template v-if="result.unsure > 0">
          {{ t('quickEntry.photo.unsure', { count: n(result.unsure, 'integer') }, result.unsure) }}
        </template>
      </template>
      <template v-else>
        {{ t('quickEntry.photo.none') }}
      </template>
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
