<script setup lang="ts">
// "Aus PDF oder Text erstellen" (ADR 0037): sends a rulebook (a PDF or pasted
// text) to /api/formats/analyze and shows what came out: which sentences became
// rules, which the rule engine can't check and why, and what is only game flow.
// The rules themselves go to the editor below via `imported`; nothing is saved here.

import { banlistSourceLabel } from '~~/shared/rule-formats'
import type { BanlistSource, Rule } from '~~/shared/rule-formats'
import { RULEBOOK_MAX_CHARS, RULEBOOK_PDF_MAX_MB } from '~~/shared/format-rulebook'
import type { Finding, RulebookImport } from '~~/shared/format-rulebook'

/** The rules of one hand-trap definition, with the names of their cards (`POST /api/formats/handtraps`). */
export interface HandtrapRules {
  rules: Rule[]
  count: number
  cardNames: Record<number, string>
  cardNamesDe: Record<number, string>
}

const emit = defineEmits<{
  imported: [result: RulebookImport]
  /** The chosen hand-trap definition's rules; `null` takes them out of the editor again. */
  handtraps: [rules: HandtrapRules | null]
}>()

const { t, te, n } = useI18n()
const count = useCount()
const apiError = useApiError()

const fileInput = ref<HTMLInputElement | null>(null)
const file = ref<File | null>(null)
const text = ref('')
const isDragging = ref(false)
const isAnalyzing = ref(false)
const errorMessage = ref('')
const result = ref<RulebookImport | null>(null)

const canAnalyze = computed(() => !isAnalyzing.value && (file.value !== null || text.value.trim() !== ''))

function pick(candidate: File | undefined) {
  errorMessage.value = ''
  if (!candidate) {
    return
  }
  if (candidate.size > RULEBOOK_PDF_MAX_MB * 1024 * 1024) {
    errorMessage.value = t('formats.pdf.tooLarge', { max: n(RULEBOOK_PDF_MAX_MB, 'integer') })
    return
  }
  if (candidate.type !== 'application/pdf' && !candidate.name.toLowerCase().endsWith('.pdf')) {
    errorMessage.value = t('formats.pdf.notPdf')
    return
  }
  file.value = candidate
}

function onPick(event: Event) {
  pick((event.target as HTMLInputElement).files?.[0])
}

function onDrop(event: DragEvent) {
  isDragging.value = false
  pick(event.dataTransfer?.files?.[0])
}

function clearFile() {
  file.value = null
  if (fileInput.value) {
    fileInput.value.value = ''
  }
}

async function analyze() {
  if (!canAnalyze.value) {
    return
  }
  isAnalyzing.value = true
  errorMessage.value = ''

  try {
    // A chosen PDF wins over pasted text.
    let body: FormData | { text: string }
    if (file.value) {
      body = new FormData()
      body.append('file', file.value, file.value.name)
    }
    else {
      body = { text: text.value }
    }
    const response = await $fetch<RulebookImport>('/api/formats/analyze', { method: 'POST', body })
    result.value = response
    // The editor below starts from this result, so an earlier hand-trap choice is gone with it.
    handtrapChoice.value = null
    handtrapCount.value = null
    handtrapError.value = ''
    emit('imported', response)
  }
  catch (error) {
    errorMessage.value = apiError(error, 'formats.pdf.failed')
  }
  finally {
    isAnalyzing.value = false
  }
}

// --- Hand traps: the rulebook forbids them, the user says what that means ----

type HandtrapChoice = 'classic-plus' | 'restrictive' | 'own'
const HANDTRAP_CHOICES: readonly HandtrapChoice[] = ['classic-plus', 'restrictive', 'own']

const handtrapChoice = ref<HandtrapChoice | null>(null)
const handtrapBusy = ref(false)
const handtrapCount = ref<number | null>(null)
const handtrapError = ref('')

const handtrapItems = computed(() => HANDTRAP_CHOICES.map(value => ({
  value,
  label: t(`formats.pdf.handtrap.option.${value}.label`),
  definition: t(`formats.pdf.handtrap.option.${value}.definition`),
})))

async function chooseHandtrap(choice: HandtrapChoice) {
  handtrapChoice.value = choice
  handtrapCount.value = null
  handtrapError.value = ''
  if (choice === 'own') {
    emit('handtraps', null)
    return
  }

  handtrapBusy.value = true
  try {
    const except = result.value?.findings.find(finding => finding.code === 'handtrap')?.params?.except
    const response = await $fetch<HandtrapRules>('/api/formats/handtraps', { method: 'POST', body: { definition: choice, except } })
    handtrapCount.value = response.count
    emit('handtraps', response)
  }
  catch (error) {
    handtrapError.value = apiError(error, 'formats.pdf.handtrap.failed')
  }
  finally {
    handtrapBusy.value = false
  }
}

// --- Findings --------------------------------------------------------------

const SECTION_CODE = /^(main|extra|side)_(size|limit)$/

/** The message key under `formats.pdf.finding` and the parameters it needs. */
function messageFor(finding: Finding): { code: string, params: Record<string, string | number> } {
  const params: Record<string, string | number> = { ...finding.params }
  let code = finding.code

  const section = SECTION_CODE.exec(code)
  if (section) {
    params.section = t(`decks.section.${section[1]}`)
    if (section[2] === 'size') {
      code = 'size'
    }
    else {
      code = params.min !== undefined && params.max !== undefined ? 'limitBoth' : params.min !== undefined ? 'limitMin' : 'limitMax'
    }
  }
  if (code === 'banlist') {
    params.source = banlistSourceLabel(String(params.source) as BanlistSource)
  }
  if (code === 'rule_invalid') {
    params.kind = t(`formats.ruleKind.${params.kind}`)
  }
  if (code === 'card_list') {
    params.status = t(`formats.cardStatus.${params.status}`)
  }
  return { code, params }
}

function findingText(finding: Finding): string {
  if (finding.status === 'description') {
    return finding.source
  }
  const { code, params } = messageFor(finding)
  const key = `formats.pdf.finding.${code}.text`
  // A message that counts (“1 card | 3 cards”) picks its form from `count`.
  const message = !te(key) ? finding.source : typeof params.count === 'number' ? t(key, params, params.count) : t(key, params)
  return typeof finding.params?.except === 'string' ? `${message} (${t('formats.pdf.except', { except: finding.params.except })})` : message
}

function findingWhy(finding: Finding): string | null {
  const { code, params } = messageFor(finding)
  const key = `formats.pdf.finding.${code}.why`
  return te(key) ? t(key, params) : null
}

/** The quoted sentence is only worth showing when the message doesn't already say it. */
function showsSource(finding: Finding): boolean {
  return finding.status !== 'description' && finding.source !== '' && finding.code !== 'builtin_exists'
}

const groups = computed(() => {
  const findings = result.value?.findings ?? []
  return [
    { id: 'applied', icon: 'i-lucide-check-circle-2', color: 'text-success', items: findings.filter(finding => finding.status === 'applied') },
    { id: 'decision', icon: 'i-lucide-list-checks', color: 'text-primary', items: findings.filter(finding => finding.status === 'decision') },
    { id: 'unsupported', icon: 'i-lucide-triangle-alert', color: 'text-warning', items: findings.filter(finding => finding.status === 'unsupported' && finding.code !== 'not_understood') },
    { id: 'unclear', icon: 'i-lucide-circle-help', color: 'text-muted', items: findings.filter(finding => finding.code === 'not_understood') },
    { id: 'description', icon: 'i-lucide-scroll-text', color: 'text-muted', items: findings.filter(finding => finding.status === 'description') },
    { id: 'info', icon: 'i-lucide-info', color: 'text-info', items: findings.filter(finding => finding.status === 'info') },
  ].filter(group => group.items.length > 0)
})

const summary = computed(() => {
  const notCheckable = groups.value.find(group => group.id === 'unsupported')?.items.length ?? 0
  const openDecisions = handtrapChoice.value === null ? (groups.value.find(group => group.id === 'decision')?.items.length ?? 0) : 0
  return [
    count('formats.pdf.result.rules', result.value?.rules.rules.length ?? 0),
    ...(openDecisions > 0 ? [count('formats.pdf.result.decisions', openDecisions)] : []),
    ...(notCheckable > 0 ? [count('formats.pdf.result.notCheckable', notCheckable)] : []),
  ].join(' · ')
})
</script>

<template>
  <section
    class="space-y-4 panel p-4"
    aria-labelledby="rulebook-import-title"
  >
    <div class="space-y-1">
      <h2
        id="rulebook-import-title"
        class="text-base font-semibold text-highlighted"
      >
        {{ t('formats.pdf.title') }}
      </h2>
      <p class="text-sm text-muted">
        {{ t('formats.pdf.description') }}
      </p>
    </div>

    <div
      :class="['flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-4 text-center transition-colors', isDragging ? 'border-primary bg-primary/5' : 'border-default']"
      @dragover.prevent="isDragging = true"
      @dragleave.prevent="isDragging = false"
      @drop.prevent="onDrop"
    >
      <input
        ref="fileInput"
        type="file"
        accept="application/pdf,.pdf"
        class="sr-only"
        tabindex="-1"
        :aria-label="t('formats.pdf.pick')"
        @change="onPick"
      >
      <template v-if="file">
        <p
          class="flex items-center gap-2 text-sm font-medium text-highlighted"
          data-testid="rulebook-file"
        >
          <UIcon
            name="i-lucide-file-text"
            class="size-4"
          />
          {{ file.name }}
        </p>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          :label="t('formats.pdf.removeFile')"
          class="tap-target"
          @click="clearFile"
        />
      </template>
      <template v-else>
        <UButton
          icon="i-lucide-file-up"
          color="neutral"
          variant="outline"
          :label="t('formats.pdf.pick')"
          class="tap-target"
          @click="() => fileInput?.click()"
        />
        <p class="text-xs text-muted">
          {{ t('formats.pdf.dropHint', { max: n(RULEBOOK_PDF_MAX_MB, 'integer') }) }}
        </p>
      </template>
    </div>

    <UFormField
      :label="t('formats.pdf.textLabel')"
      :hint="t('formats.pdf.textHint')"
    >
      <UTextarea
        v-model="text"
        :rows="4"
        :maxlength="RULEBOOK_MAX_CHARS"
        :disabled="file !== null"
        :placeholder="t('formats.pdf.textPlaceholder')"
        class="w-full"
        :aria-label="t('formats.pdf.textLabel')"
      />
    </UFormField>

    <p
      v-if="errorMessage"
      role="alert"
      class="text-sm text-error"
    >
      {{ errorMessage }}
    </p>

    <div class="flex justify-end">
      <UButton
        icon="i-lucide-wand-sparkles"
        :label="isAnalyzing ? t('formats.pdf.analyzing') : t('formats.pdf.analyze')"
        :loading="isAnalyzing"
        :disabled="!canAnalyze"
        @click="analyze"
      />
    </div>

    <div
      v-if="result"
      class="space-y-4 border-t border-default pt-4"
      data-testid="rulebook-result"
    >
      <div class="space-y-1">
        <h3 class="text-base font-semibold text-highlighted">
          {{ t('formats.pdf.result.title') }}
        </h3>
        <p class="text-sm text-default">
          {{ summary }}
        </p>
        <p class="text-sm text-muted">
          {{ t('formats.pdf.result.next') }}
        </p>
      </div>

      <!-- Every group can be folded; the long list of sentences nobody needs is closed at first. -->
      <details
        v-for="group in groups"
        :key="group.id"
        :open="group.id !== 'unclear'"
        :data-testid="`rulebook-group-${group.id}`"
        class="space-y-2"
      >
        <summary class="flex cursor-pointer items-center gap-2 text-sm font-semibold text-highlighted">
          <UIcon
            :name="group.icon"
            :class="['size-4 shrink-0', group.color]"
          />
          {{ t(`formats.pdf.group.${group.id}`) }}
          <UBadge
            color="neutral"
            variant="subtle"
            size="sm"
            :label="n(group.items.length, 'integer')"
          />
        </summary>
        <p
          v-if="group.id !== 'applied' && te(`formats.pdf.group.${group.id}Hint`)"
          class="text-xs text-muted"
        >
          {{ t(`formats.pdf.group.${group.id}Hint`) }}
        </p>

        <!-- Game flow is many short lines; a plain list, no box per line. -->
        <ul
          v-if="group.id === 'description'"
          class="list-inside list-disc space-y-0.5 text-sm text-default"
        >
          <li
            v-for="(finding, index) in group.items"
            :key="`${finding.code}-${index}`"
          >
            {{ finding.source }}
          </li>
        </ul>
        <ul
          v-else
          class="space-y-2"
        >
          <li
            v-for="(finding, index) in group.items"
            :key="`${finding.code}-${index}`"
            class="rounded-lg border border-default p-3 text-sm"
          >
            <p class="text-highlighted">
              {{ findingText(finding) }}
            </p>
            <p
              v-if="finding.status === 'unsupported' && findingWhy(finding)"
              class="mt-1 text-default"
            >
              <span class="font-medium">{{ t('formats.pdf.why') }}</span>
              {{ findingWhy(finding) }}
            </p>
            <p
              v-if="showsSource(finding)"
              class="mt-1 text-xs text-muted italic"
            >
              {{ t('formats.pdf.source', { text: finding.source }) }}
            </p>

            <!-- The user says what "hand traps" means; the help circle shows the definition. -->
            <div
              v-if="finding.code === 'handtrap'"
              class="mt-3 space-y-2"
              data-testid="handtrap-choice"
            >
              <p class="font-medium text-highlighted">
                {{ t('formats.pdf.handtrap.question') }}
              </p>
              <URadioGroup
                :model-value="handtrapChoice ?? undefined"
                :items="handtrapItems"
                :disabled="handtrapBusy"
                :aria-label="t('formats.pdf.handtrap.question')"
                @update:model-value="(value: string) => chooseHandtrap(value as HandtrapChoice)"
              >
                <template #label="{ item }">
                  <span class="inline-flex items-center gap-2">
                    {{ item.label }}
                    <UPopover
                      mode="hover"
                      :content="{ side: 'top', align: 'start' }"
                    >
                      <button
                        type="button"
                        class="inline-flex size-4 shrink-0 cursor-help items-center justify-center rounded-full bg-accented text-[11px] leading-none font-bold text-highlighted"
                        :aria-label="t('formats.pdf.handtrap.showDefinition', { name: item.label })"
                        @click.stop.prevent
                      >
                        {{ t('formats.pdf.handtrap.helpMark') }}
                      </button>
                      <template #content>
                        <p class="max-w-xs p-3 text-sm text-default">
                          {{ (item as { definition: string }).definition }}
                        </p>
                      </template>
                    </UPopover>
                  </span>
                </template>
              </URadioGroup>

              <p
                v-if="handtrapChoice === 'own'"
                class="rounded-lg bg-elevated p-3 text-default"
                data-testid="handtrap-own"
              >
                {{ t('formats.pdf.handtrap.ownHint') }}
              </p>
              <p
                v-else-if="handtrapChoice !== null && handtrapCount !== null"
                class="text-success"
              >
                {{ count('formats.pdf.handtrap.added', handtrapCount) }}
              </p>
              <p
                v-else-if="handtrapChoice === null"
                class="text-muted"
              >
                {{ t('formats.pdf.handtrap.open') }}
              </p>
              <p
                v-if="handtrapError"
                role="alert"
                class="text-error"
              >
                {{ handtrapError }}
              </p>
            </div>
          </li>
        </ul>
      </details>
    </div>
  </section>
</template>
