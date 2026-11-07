<script setup lang="ts">
import {
  MAX_PARTICIPANTS,
  PARTICIPANT_NAME_MAX_LENGTH,
  SCORING_SYSTEMS,
  TOURNAMENT_DESCRIPTION_MAX_LENGTH,
  TOURNAMENT_NAME_MAX_LENGTH,
} from '~~/shared/tournaments'
import type { ScoringSystem, TournamentDetail } from '~~/shared/tournaments'
import {
  BEST_OF_CHOICES,
  DEFAULT_BEST_OF,
  QUEUE_MODES,
} from '~~/shared/tournament-modes'
import type { BestOf, QueueMode } from '~~/shared/tournament-modes'

usePageTitle('tournaments.new.title')

const { t } = useI18n()
const apiError = useApiError()
const { formatName, sortFormats } = useFormatLabel()

// reka-ui reserves the empty string for "clear selection", so "no format"
// uses a sentinel that maps back to `null` on the wire (same convention as
// the deck editor's format select).
const NO_FORMAT = 'none'

interface RuleFormatListItem {
  id: string
  name: string
  isBuiltin: boolean
}

const { data: formatsData } = await useFetch<{ items: RuleFormatListItem[] }>('/api/formats', {
  headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
  default: () => ({ items: [] }),
})

// Built-in formats first, sorted by their name in the interface language.
const formatItems = computed(() => [
  { label: t('tournaments.noFormat'), value: NO_FORMAT },
  ...sortFormats(formatsData.value?.items ?? []).map(format => ({ label: formatName(format), value: format.id })),
])

const modeItems = computed(() => QUEUE_MODES.map(mode => ({ label: t(`tournaments.queue.mode.${mode}.label`), value: mode })))
const bestOfItems = computed(() => BEST_OF_CHOICES.map(choice => ({ label: t(`tournaments.queue.bestOf.${choice}.label`), value: choice })))
const scoringItems = computed(() => SCORING_SYSTEMS.map(scoring => ({ label: t(`tournaments.scoring.${scoring}.label`), value: scoring })))

// Every new tournament is played in Spieltage (ADR 0043): a plan by days, no tables, no queue. Everybody gets the
// same choices: the mode (round robin, Champions League, Swiss), a head start for the Swiss system, best of 1 or 3
// and how a duel is worth points. Duels per player and minutes are set on the tournament page, where the
// registered players are known.
const form = reactive({
  name: '',
  description: '',
  formatId: NO_FORMAT,
  mode: 'round_robin' as QueueMode,
  prelaunch: false,
  bestOf: DEFAULT_BEST_OF as BestOf,
  scoring: 'games' as ScoringSystem,
  includeSelf: true,
  participantsText: '',
})

// One player per line: a name, or the e-mail address of an account.
const participantLines = computed(() => form.participantsText.split('\n').map(line => line.trim()).filter(line => line.length > 0))
const participantCount = computed(() => participantLines.value.length + (form.includeSelf ? 1 : 0))

const isSubmitting = ref(false)
// The name check belongs to its UFormField (aria-describedby/aria-invalid);
// errorMessage is for the server's answer.
// Bound as `|| undefined`: UFormField's `error` is Boolean|String, so '' would count as true.
const nameError = ref('')
const errorMessage = ref('')

watch(() => form.name, (name) => {
  if (name.trim()) {
    nameError.value = ''
  }
})

async function submit() {
  if (isSubmitting.value) {
    return
  }
  if (!form.name.trim()) {
    nameError.value = t('tournaments.new.nameRequired')
    return
  }

  isSubmitting.value = true
  errorMessage.value = ''

  try {
    const created = await $fetch<TournamentDetail>('/api/tournaments', {
      method: 'POST',
      body: {
        name: form.name,
        description: form.description || null,
        formatId: form.formatId === NO_FORMAT ? null : form.formatId,
        engine: 'queue',
        mode: form.mode,
        flow: 'rounds',
        prelaunch: form.mode === 'swiss' && form.prelaunch,
        bestOf: form.bestOf,
        scoring: form.scoring,
        includeSelf: form.includeSelf,
        participants: participantLines.value,
      },
    })
    await navigateTo(`/tournaments/${created.id}`)
  }
  catch (error) {
    errorMessage.value = apiError(error, 'tournaments.new.createFailed')
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="max-w-5xl space-y-6">
    <div class="space-y-2">
      <LayoutBackLink
        to="/tournaments"
        :label="t('tournaments.backToList')"
      />
      <LayoutPageHeader
        :title="t('tournaments.new.title')"
        :description="t('tournaments.new.description')"
      />
    </div>

    <form
      class="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
      @submit.prevent="submit"
    >
      <div class="space-y-4 panel p-4">
        <UFormField
          :label="t('tournaments.new.name')"
          :error="nameError || undefined"
        >
          <UInput
            v-model="form.name"
            class="w-full"
            :placeholder="t('tournaments.new.namePlaceholder')"
            :maxlength="TOURNAMENT_NAME_MAX_LENGTH"
            :aria-label="t('tournaments.new.name')"
          />
        </UFormField>

        <UFormField :label="t('tournaments.new.descriptionLabel')">
          <UTextarea
            v-model="form.description"
            :rows="3"
            :maxlength="TOURNAMENT_DESCRIPTION_MAX_LENGTH"
            :aria-label="t('tournaments.new.descriptionAriaLabel')"
            class="w-full"
          />
        </UFormField>

        <UFormField :label="t('tournaments.new.format')">
          <USelect
            v-model="form.formatId"
            :items="formatItems"
            :aria-label="t('tournaments.new.format')"
            class="w-full"
          />
        </UFormField>

        <UFormField :label="t('tournaments.queue.mode.label')">
          <USelect
            v-model="form.mode"
            :items="modeItems"
            :aria-label="t('tournaments.queue.mode.label')"
            class="w-full"
          />
          <p class="mt-1 text-xs text-muted">
            {{ t(`tournaments.queue.mode.${form.mode}.description`) }}
          </p>
        </UFormField>

        <UCheckbox
          v-if="form.mode === 'swiss'"
          v-model="form.prelaunch"
          :label="t('tournaments.queue.setup.prelaunch')"
          :description="t('tournaments.queue.setup.prelaunchHint')"
        />

        <UFormField :label="t('tournaments.queue.bestOf.label')">
          <USelect
            v-model="form.bestOf"
            :items="bestOfItems"
            :aria-label="t('tournaments.queue.bestOf.label')"
            class="w-full"
          />
          <p class="mt-1 text-xs text-muted">
            {{ t(`tournaments.queue.bestOf.${form.bestOf}.description`) }}
          </p>
        </UFormField>

        <UFormField :label="t('tournaments.new.scoring')">
          <USelect
            v-model="form.scoring"
            :items="scoringItems"
            :aria-label="t('tournaments.new.scoring')"
            class="w-full"
          />
          <p class="mt-1 text-xs text-muted">
            {{ t(`tournaments.scoring.${form.scoring}.description`) }}
            {{ form.bestOf === 1 ? t('tournaments.queue.scoringSingleHint') : '' }}
          </p>
        </UFormField>

        <UCheckbox
          v-model="form.includeSelf"
          :label="t('tournaments.new.includeSelf')"
        />

        <p
          v-if="errorMessage"
          role="alert"
          class="text-sm text-error"
        >
          {{ errorMessage }}
        </p>

        <div class="flex justify-end gap-2">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            :label="t('common.cancel')"
            to="/tournaments"
          />
          <UButton
            type="submit"
            icon="i-lucide-plus"
            :label="t('tournaments.new.submit')"
            :loading="isSubmitting"
          />
        </div>
      </div>

      <div class="space-y-3 panel p-4">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2 class="text-base font-semibold text-highlighted">
            {{ t('tournaments.new.participants.title') }}
          </h2>
          <span
            class="font-numeric text-xs text-muted"
            data-testid="new-participant-count"
          >{{ t('tournaments.new.participants.count', { count: participantCount }) }}</span>
        </div>
        <UFormField :description="t('tournaments.new.participants.hint', { max: MAX_PARTICIPANTS })">
          <UTextarea
            v-model="form.participantsText"
            :rows="10"
            :placeholder="t('tournaments.new.participants.placeholder')"
            :aria-label="t('tournaments.new.participants.title')"
            :maxlength="MAX_PARTICIPANTS * (PARTICIPANT_NAME_MAX_LENGTH + 1)"
            class="w-full"
          />
        </UFormField>
        <p class="text-xs text-muted">
          {{ form.includeSelf ? t('tournaments.new.participants.selfIn') : t('tournaments.new.participants.selfOut') }}
        </p>
      </div>
    </form>
  </div>
</template>
