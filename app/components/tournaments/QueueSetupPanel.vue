<script setup lang="ts">
import {
  BEST_OF_CHOICES,
  MAX_DUEL_MINUTES,
  MAX_TABLES,
  MIN_DUEL_MINUTES,
  QUEUE_FLOWS,
  QUEUE_MODES,
  defaultRounds,
  duelsPerPlayer,
  estimateMinutes,
  maxEvenRounds,
  recommendedMode,
  roundsForDuration,
  splitMinutes,
  totalDuels,
  validateSetup,
} from '~~/shared/tournament-modes'
import type { BestOf, QueueFlow, QueueMode, SetupInput } from '~~/shared/tournament-modes'
import { SCORING_SYSTEMS } from '~~/shared/tournaments'
import type { ScoringSystem, TournamentDetail } from '~~/shared/tournaments'

// The settings of a duel tournament (ADR 0042, 0043): mode, duels per player, best of 1 or 3, how a duel is worth points,
// minutes per duel; a tournament made before Spieltage also has its way of playing (tables and queue) and its tables. The organizer sees what they cost in time for the players
// registered so far, and what is wrong with them.

const props = defineProps<{
  tournament: TournamentDetail
}>()

const emit = defineEmits<{
  updated: [detail: TournamentDetail]
}>()

const { t } = useI18n()
const apiError = useApiError()

const setup = computed(() => props.tournament.queueSetup!)
const editable = computed(() => props.tournament.role === 'organizer' && props.tournament.status === 'registration')
const players = computed(() => props.tournament.participants.length)

/**
 * The number fields are typed as text, but UInput type="number" hands over a number once something is typed (and ''
 * while it is empty), so everything that reads them goes through `String(...)` first.
 */
type FieldValue = string | number

const form = reactive({
  mode: setup.value.mode as QueueMode,
  flow: setup.value.flow as QueueFlow,
  bestOf: setup.value.bestOf as BestOf,
  scoring: setup.value.scoring as ScoringSystem,
  rounds: setup.value.rounds === null ? '' : String(setup.value.rounds),
  prelaunch: setup.value.prelaunch,
  tables: String(setup.value.tables),
  duelMinutes: String(setup.value.duelMinutes),
  wishedHours: '',
})

// A saved change (or a reload) from outside takes over the form.
watch(setup, (next) => {
  form.mode = next.mode
  form.flow = next.flow
  form.bestOf = next.bestOf
  form.scoring = next.scoring
  form.rounds = next.rounds === null ? '' : String(next.rounds)
  form.prelaunch = next.prelaunch
  form.tables = String(next.tables)
  form.duelMinutes = String(next.duelMinutes)
})

const modeItems = computed(() => QUEUE_MODES.map(mode => ({ label: t(`tournaments.queue.mode.${mode}.label`), value: mode })))
const flowItems = computed(() => QUEUE_FLOWS.map(flow => ({ label: t(`tournaments.queue.flow.${flow}.label`), value: flow })))
const bestOfItems = computed(() => BEST_OF_CHOICES.map(choice => ({ label: t(`tournaments.queue.bestOf.${choice}.label`), value: choice })))
const scoringItems = computed(() => SCORING_SYSTEMS.map(scoring => ({ label: t(`tournaments.scoring.${scoring}.label`), value: scoring })))
// A single game has no score, so the scoring by games cannot tell anything apart: it is shown as the classic 3 and 0 and
// cannot be changed while a duel is one game (it comes back as chosen when the duel is best of 3 again).
const singleGame = computed(() => form.bestOf === 1)
const effectiveScoring = computed<ScoringSystem>(() => singleGame.value ? 'match' : form.scoring)
// New tournaments are only played in Spieltage; the choice is left to the ones that still have tables and a queue.
const showFlow = computed(() => setup.value.flow === 'queue')
const recommended = computed(() => players.value >= 2 ? recommendedMode(players.value) : null)
const byRound = computed(() => form.flow === 'rounds')

function parsedInteger(raw: FieldValue): number | null {
  const trimmed = String(raw).trim()
  return trimmed === '' || !Number.isInteger(Number(trimmed)) ? null : Number(trimmed)
}

/** R as it will be used: what was typed, else the app's own pick for this many players. */
const effectiveRounds = computed<number | null>(() => {
  if (form.mode === 'round_robin') {
    return null
  }
  return parsedInteger(form.rounds) ?? defaultRounds(form.mode, Math.max(2, players.value), form.prelaunch)
})

const input = computed<SetupInput>(() => ({
  mode: form.mode,
  players: players.value,
  rounds: effectiveRounds.value,
  tables: parsedInteger(form.tables) ?? 0,
  duelMinutes: parsedInteger(form.duelMinutes) ?? 0,
  prelaunch: form.mode === 'swiss' && form.prelaunch,
  flow: form.flow,
}))

const issues = computed(() => validateSetup(input.value))
const issueMessages = computed(() => issues.value
  // Fewer than two players is said by the participants panel; here it would only repeat itself during the sign-up.
  .filter(issue => issue.code !== 'too_few_players')
  .map(issue => t(`errors.api.${issue.code}`, issue.params ?? {})))

const estimate = computed(() => players.value >= 2 && issues.value.length === 0 ? estimateMinutes(input.value) : null)

function formatDuration(minutes: number): string {
  const { hours, minutes: rest } = splitMinutes(minutes)
  return t('tournaments.queue.setup.estimateValue', { hours, minutes: rest })
}

/** What each mode would take with the same tables and duel length, as a help for the choice. */
const comparison = computed(() => {
  if (players.value < 2) {
    return []
  }
  return QUEUE_MODES.map((mode) => {
    const prelaunch = mode === 'swiss' && form.prelaunch
    const rounds = defaultRounds(mode, players.value, prelaunch)
    const candidate: SetupInput = { ...input.value, mode, rounds, prelaunch }
    const valid = validateSetup(candidate).length === 0
    return {
      mode,
      label: t(`tournaments.queue.mode.${mode}.label`),
      text: valid ? formatDuration(estimateMinutes(candidate)) : '–',
      perPlayer: duelsPerPlayer(candidate),
    }
  })
})

const perPlayerText = computed(() => {
  if (players.value < 2 || issues.value.length > 0) {
    return ''
  }
  return t('tournaments.queue.setup.perPlayer', { count: duelsPerPlayer(input.value), total: totalDuels(input.value) })
})

const suggestion = ref<number | null>(null)

function suggestRounds() {
  const hours = Number(String(form.wishedHours).replace(',', '.'))
  if (!Number.isFinite(hours) || hours <= 0 || players.value < 2 || form.mode === 'round_robin') {
    return
  }
  const rounds = roundsForDuration({ ...input.value }, hours * 60)
  suggestion.value = rounds
  form.rounds = String(rounds)
}

const roundsMax = computed(() => Math.max(2, maxEvenRounds(Math.max(3, players.value))))

const saving = ref(false)
const errorMessage = ref('')

async function save() {
  saving.value = true
  errorMessage.value = ''
  try {
    const detail = await $fetch<TournamentDetail>(`/api/tournaments/${props.tournament.id}`, {
      method: 'PATCH',
      body: {
        queueMode: form.mode,
        flow: form.flow,
        bestOf: form.bestOf,
        scoring: effectiveScoring.value,
        plannedRounds: form.mode === 'round_robin' ? null : parsedInteger(form.rounds),
        prelaunch: form.mode === 'swiss' && form.prelaunch,
        // What is not a whole number goes to the server as typed, which answers with the matching message.
        tables: parsedInteger(form.tables) ?? form.tables,
        duelMinutes: parsedInteger(form.duelMinutes) ?? form.duelMinutes,
      },
    })
    emit('updated', detail)
  }
  catch (error) {
    errorMessage.value = apiError(error, 'tournaments.queue.setup.saveFailed')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="panel space-y-4 p-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-base font-semibold text-highlighted">
        {{ t('tournaments.queue.setup.title') }}
      </h2>
      <UBadge
        v-if="recommended && editable && form.mode !== recommended"
        color="info"
        variant="subtle"
        :label="t('tournaments.queue.mode.recommended', { count: players }) + ': ' + t(`tournaments.queue.mode.${recommended}.label`)"
      />
    </div>

    <p
      v-if="!editable"
      class="text-sm text-toned"
    >
      {{ queueSummary(t, setup) }}
    </p>

    <div
      v-else
      class="space-y-4"
    >
      <p class="text-xs text-muted">
        {{ t('tournaments.queue.setup.editHint') }}
      </p>

      <UFormField
        v-if="showFlow"
        :label="t('tournaments.queue.flow.label')"
      >
        <USelect
          v-model="form.flow"
          :items="flowItems"
          :aria-label="t('tournaments.queue.flow.label')"
          class="w-full"
        />
        <p class="mt-1 text-xs text-muted">
          {{ t(`tournaments.queue.flow.${form.flow}.description`) }}
        </p>
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
          :model-value="effectiveScoring"
          :items="scoringItems"
          :disabled="singleGame"
          :aria-label="t('tournaments.new.scoring')"
          class="w-full"
          @update:model-value="form.scoring = $event"
        />
        <p class="mt-1 text-xs text-muted">
          {{ singleGame ? t('tournaments.queue.scoringSingleHint') : t(`tournaments.scoring.${form.scoring}.description`) }}
        </p>
      </UFormField>

      <div
        class="grid gap-4"
        :class="byRound ? 'sm:grid-cols-2' : 'sm:grid-cols-3'"
      >
        <UFormField :label="t('tournaments.queue.setup.rounds')">
          <UInput
            v-model="form.rounds"
            type="number"
            min="2"
            :max="roundsMax"
            step="2"
            :placeholder="t('tournaments.queue.setup.roundsAuto')"
            :aria-label="t('tournaments.queue.setup.rounds')"
            :disabled="form.mode === 'round_robin'"
            class="w-full"
          />
        </UFormField>
        <UFormField
          v-if="!byRound"
          :label="t('tournaments.queue.setup.tables')"
        >
          <UInput
            v-model="form.tables"
            type="number"
            min="1"
            :max="MAX_TABLES"
            :aria-label="t('tournaments.queue.setup.tables')"
            class="w-full"
          />
        </UFormField>
        <UFormField :label="t('tournaments.queue.setup.duelMinutes')">
          <UInput
            v-model="form.duelMinutes"
            type="number"
            :min="MIN_DUEL_MINUTES"
            :max="MAX_DUEL_MINUTES"
            :aria-label="t('tournaments.queue.setup.duelMinutes')"
            class="w-full"
          />
        </UFormField>
      </div>
      <p class="-mt-2 text-xs text-muted">
        {{ form.mode === 'round_robin' ? t('tournaments.queue.setup.roundsRoundRobin') : t('tournaments.queue.setup.roundsHint') }}
      </p>

      <div
        v-if="form.mode !== 'round_robin'"
        class="flex flex-wrap items-end gap-2"
      >
        <UFormField :label="t('tournaments.queue.setup.wishedHours')">
          <UInput
            v-model="form.wishedHours"
            type="number"
            min="0.5"
            step="0.5"
            :aria-label="t('tournaments.queue.setup.wishedHours')"
            class="w-40"
          />
        </UFormField>
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          :label="t('tournaments.queue.setup.suggest')"
          :disabled="players < 2 || !form.wishedHours"
          @click="suggestRounds"
        />
        <span
          v-if="suggestion !== null"
          class="pb-2 text-sm text-toned"
        >{{ t('tournaments.queue.setup.suggested', { rounds: suggestion }) }}</span>
      </div>

      <ul
        v-if="issueMessages.length > 0"
        class="space-y-1 text-sm text-error"
        role="alert"
      >
        <li
          v-for="message in issueMessages"
          :key="message"
        >
          {{ message }}
        </li>
      </ul>

      <div class="rounded-lg border border-default p-3">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <span class="text-sm font-medium text-highlighted">{{ t('tournaments.queue.setup.estimate') }}</span>
          <span
            v-if="estimate !== null"
            class="font-numeric text-sm text-highlighted"
            data-testid="queue-estimate"
          >{{ formatDuration(estimate) }}</span>
        </div>
        <p
          v-if="estimate === null && players < 2"
          class="mt-1 text-xs text-muted"
        >
          {{ t('tournaments.queue.setup.estimateNeedsPlayers') }}
        </p>
        <p
          v-else-if="perPlayerText"
          class="mt-1 text-xs text-muted"
        >
          {{ perPlayerText }}
        </p>

        <div
          v-if="comparison.length > 0"
          class="mt-3 space-y-1"
        >
          <p class="text-xs font-medium text-muted">
            {{ t('tournaments.queue.setup.compare', { count: players }) }}
          </p>
          <ul class="space-y-0.5 text-xs text-toned">
            <li
              v-for="row in comparison"
              :key="row.mode"
              class="flex justify-between gap-2"
            >
              <span>{{ row.label }}</span>
              <span class="font-numeric">{{ row.text }}</span>
            </li>
          </ul>
        </div>
      </div>

      <p
        v-if="errorMessage"
        role="alert"
        class="text-sm text-error"
      >
        {{ errorMessage }}
      </p>

      <div class="flex justify-end">
        <UButton
          :label="t('tournaments.queue.setup.save')"
          :loading="saving"
          @click="save"
        />
      </div>
    </div>
  </section>
</template>
