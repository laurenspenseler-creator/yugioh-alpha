<script setup lang="ts">
import type { QueueDuelDto, TournamentDetail } from '~~/shared/tournaments'

// The page of a started duel-queue tournament (ADR 0042): the standings stay fixed at the top, below them the tables
// with what is being played and who is next, and the whole schedule by round. The organizer only ever enters
// winners; the app pairs, starts and re-plans everything else.

const props = defineProps<{
  tournament: TournamentDetail
}>()

const emit = defineEmits<{
  updated: [detail: TournamentDetail]
  decide: [participantId: string]
}>()

const { t } = useI18n()
const apiError = useApiError()

const queue = computed(() => props.tournament.queue!)
const organizer = computed(() => props.tournament.role === 'organizer')
const running = computed(() => props.tournament.status === 'running')
const canEdit = computed(() => organizer.value && running.value)

const nameOf = computed(() => new Map(props.tournament.participants.map(participant => [participant.id, participant.name])))
const namesOf = (ids: string[]) => ids.map(id => nameOf.value.get(id) ?? '').join(', ')

const busy = ref(false)
const errorMessage = ref('')

async function call(action: () => Promise<TournamentDetail>, fallbackKey: string) {
  busy.value = true
  errorMessage.value = ''
  try {
    emit('updated', await action())
  }
  catch (error) {
    errorMessage.value = apiError(error, fallbackKey)
  }
  finally {
    busy.value = false
  }
}

function report(duel: QueueDuelDto, result: { winnerId: string, gamesA?: number, gamesB?: number }) {
  return call(
    () => $fetch<TournamentDetail>(`/api/tournaments/${props.tournament.id}/duels/${duel.id}/result`, {
      method: 'POST',
      body: { winnerParticipantId: result.winnerId, gamesA: result.gamesA, gamesB: result.gamesB },
    }),
    'tournaments.queue.board.resultFailed',
  )
}

// Spieltage (ADR 0043): no tables and no queue, the days are the plan.
const byRound = computed(() => queue.value.flow === 'rounds')
const bestOf = computed(() => queue.value.bestOf)

// --- Tables and queue --------------------------------------------------------------

const MAX_TABLES_SHOWN = 24

const runningDuels = computed(() => queue.value.duels.filter(duel => duel.status === 'running'))
const tableSlots = computed(() => Array.from({ length: Math.min(queue.value.tables, MAX_TABLES_SHOWN) }, (_, index) => ({
  number: index + 1,
  duel: runningDuels.value.find(duel => duel.tableNumber === index + 1) ?? null,
})))

const NEXT_SHOWN = 8
const nextDuels = computed(() => queue.value.duels
  .filter(duel => duel.status === 'planned' && duel.queuePosition !== null)
  .sort((x, y) => x.queuePosition! - y.queuePosition!)
  .slice(0, NEXT_SHOWN))

// --- Rematches, decider ------------------------------------------------------------

function confirmRematch(aId: string, bId: string) {
  return call(
    () => $fetch<TournamentDetail>(`/api/tournaments/${props.tournament.id}/rematch`, {
      method: 'POST',
      body: { participantAId: aId, participantBId: bId },
    }),
    'tournaments.queue.rematch.failed',
  )
}

function scheduleDecider() {
  return call(
    () => $fetch<TournamentDetail>(`/api/tournaments/${props.tournament.id}/decider`, { method: 'POST' }),
    'tournaments.queue.decider.failed',
  )
}

// --- Swiss: draw the open pairings again --------------------------------------------

interface RecomputePreview {
  round: number
  removed: Array<{ participantAId: string, participantBId: string }>
  added: Array<{ participantAId: string, participantBId: string }>
}

const preview = ref<RecomputePreview[] | null>(null)

async function showRecompute() {
  busy.value = true
  errorMessage.value = ''
  try {
    const result = await $fetch<{ changes: RecomputePreview[] }>(`/api/tournaments/${props.tournament.id}/recompute`, {
      method: 'POST',
      body: { apply: false },
    })
    preview.value = result.changes
  }
  catch (error) {
    errorMessage.value = apiError(error, 'tournaments.queue.recompute.failed')
  }
  finally {
    busy.value = false
  }
}

async function applyRecompute() {
  await call(
    async () => {
      const result = await $fetch<{ detail: TournamentDetail }>(`/api/tournaments/${props.tournament.id}/recompute`, {
        method: 'POST',
        body: { apply: true },
      })
      preview.value = null
      return result.detail
    },
    'tournaments.queue.recompute.failed',
  )
}

const pairText = (pair: { participantAId: string, participantBId: string }) =>
  `${nameOf.value.get(pair.participantAId) ?? ''} ${t('tournaments.queue.board.vs')} ${nameOf.value.get(pair.participantBId) ?? ''}`

// --- Schedule ------------------------------------------------------------------------

const isSwiss = computed(() => queue.value.mode === 'swiss')

const rounds = computed(() => {
  const byRound = new Map<number, QueueDuelDto[]>()
  for (const duel of queue.value.duels) {
    const list = byRound.get(duel.round) ?? []
    list.push(duel)
    byRound.set(duel.round, list)
  }
  return [...byRound.entries()]
    .sort(([x], [y]) => x - y)
    .map(([number, duels]) => ({
      number,
      duels,
      done: duels.every(duel => duel.status === 'done' || duel.status === 'void'),
    }))
})

function roundLabel(number: number): string {
  return t(isSwiss.value ? 'tournaments.queue.board.round' : 'tournaments.queue.board.matchday', { number })
}

/** The day being played: with Spieltage only this one is open, the later ones wait behind it. */
const currentRoundNumber = computed(() => rounds.value.find(round => !round.done)?.number ?? null)
const scheduleHelp = computed(() => {
  if (byRound.value) {
    return t('tournaments.queue.board.scheduleHelpRounds')
  }
  return isSwiss.value ? t('tournaments.queue.board.scheduleHelpSwiss') : t('tournaments.queue.board.scheduleHelp')
})

const showDecider = computed(() => canEdit.value && queue.value.firstPlaceTie.length >= 2)
</script>

<template>
  <div class="space-y-4">
    <TournamentsQueueTable :tournament="tournament" />

    <p
      v-if="errorMessage"
      role="alert"
      class="text-sm text-error"
    >
      {{ errorMessage }}
    </p>

    <UAlert
      v-if="canEdit && queue.undecided.length > 0"
      color="warning"
      variant="subtle"
      :title="t('tournaments.queue.undecided.title')"
      :description="t('tournaments.queue.undecided.text', { names: namesOf(queue.undecided) })"
    >
      <template #actions>
        <UButton
          v-for="id in queue.undecided"
          :key="id"
          size="xs"
          color="warning"
          variant="outline"
          :label="`${nameOf.get(id) ?? ''}: ${t('tournaments.queue.undecided.decide')}`"
          @click="emit('decide', id)"
        />
      </template>
    </UAlert>

    <UAlert
      v-for="pair in canEdit ? queue.pendingRematches : []"
      :key="`${pair.participantAId}-${pair.participantBId}`"
      color="info"
      variant="subtle"
      :title="t('tournaments.queue.rematch.title')"
      :description="t('tournaments.queue.rematch.text', { a: pair.participantAName, b: pair.participantBName })"
    >
      <template #actions>
        <UButton
          size="xs"
          color="info"
          variant="outline"
          :loading="busy"
          :label="t('tournaments.queue.rematch.confirm')"
          @click="confirmRematch(pair.participantAId, pair.participantBId)"
        />
      </template>
    </UAlert>

    <UAlert
      v-if="showDecider"
      color="info"
      variant="subtle"
      :title="t('tournaments.queue.decider.title')"
      :description="t('tournaments.queue.decider.text', { names: namesOf(queue.firstPlaceTie) })"
    >
      <template #actions>
        <UButton
          size="xs"
          color="info"
          variant="outline"
          :loading="busy"
          :label="t('tournaments.queue.decider.schedule')"
          @click="scheduleDecider"
        />
      </template>
    </UAlert>

    <section
      v-if="running && !byRound"
      class="panel space-y-3 p-4"
    >
      <h2 class="text-base font-semibold text-highlighted">
        {{ t('tournaments.queue.board.tablesTitle') }}
      </h2>
      <p class="text-xs text-muted">
        {{ t('tournaments.queue.board.tablesHelp') }}
      </p>
      <div class="grid gap-2 lg:grid-cols-2">
        <template
          v-for="slot in tableSlots"
          :key="slot.number"
        >
          <TournamentsQueueDuelRow
            v-if="slot.duel"
            :duel="slot.duel"
            :can-edit="canEdit"
            :busy="busy"
            :best-of="bestOf"
            compact
            @result="result => report(slot.duel!, result)"
          />
          <div
            v-else
            class="rounded-lg border border-dashed border-default px-3 py-2 text-sm text-muted"
          >
            {{ t('tournaments.queue.board.tableFree', { number: slot.number }) }}
          </div>
        </template>
      </div>

      <div class="pt-1">
        <h3 class="text-sm font-semibold text-highlighted">
          {{ t('tournaments.queue.board.nextTitle') }}
        </h3>
        <p
          v-if="nextDuels.length === 0"
          class="mt-1 text-sm text-muted"
        >
          {{ t('tournaments.queue.board.nextEmpty') }}
        </p>
        <div
          v-else
          class="mt-2 grid gap-2 lg:grid-cols-2"
        >
          <TournamentsQueueDuelRow
            v-for="duel in nextDuels"
            :key="duel.id"
            :duel="duel"
            :can-edit="false"
            compact
          />
        </div>
      </div>
    </section>

    <section class="panel space-y-3 p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-base font-semibold text-highlighted">
          {{ t(byRound ? 'tournaments.queue.board.matchdaysTitle' : 'tournaments.queue.board.scheduleTitle') }}
        </h2>
        <UButton
          v-if="queue.canRecompute"
          size="xs"
          color="neutral"
          variant="outline"
          icon="i-lucide-refresh-cw"
          :loading="busy"
          :label="t('tournaments.queue.recompute.button')"
          @click="showRecompute"
        />
      </div>
      <p class="text-xs text-muted">
        {{ scheduleHelp }}
      </p>

      <div
        v-if="preview !== null"
        class="space-y-2 rounded-lg border border-default p-3"
      >
        <p class="text-sm font-medium text-highlighted">
          {{ t('tournaments.queue.recompute.previewTitle') }}
        </p>
        <p class="text-xs text-muted">
          {{ t('tournaments.queue.recompute.hint') }}
        </p>
        <p
          v-if="preview.length === 0"
          class="text-sm text-toned"
        >
          {{ t('tournaments.queue.recompute.noChange') }}
        </p>
        <div
          v-for="change in preview"
          :key="change.round"
          class="text-sm"
        >
          <p class="font-medium text-highlighted">
            {{ t('tournaments.queue.recompute.round', { number: change.round }) }}
          </p>
          <ul class="ml-4 list-disc text-toned">
            <li
              v-for="pair in change.added"
              :key="`${pair.participantAId}-${pair.participantBId}`"
            >
              {{ pairText(pair) }}
            </li>
          </ul>
        </div>
        <div class="flex justify-end gap-2">
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            :label="t('tournaments.queue.recompute.cancel')"
            @click="preview = null"
          />
          <UButton
            size="xs"
            :disabled="preview.length === 0"
            :loading="busy"
            :label="t('tournaments.queue.recompute.apply')"
            @click="applyRecompute"
          />
        </div>
      </div>

      <div class="space-y-2">
        <!-- With Spieltage the key changes when a day becomes the current one, so it opens by itself. -->
        <template
          v-for="round in rounds"
          :key="byRound ? `${round.number}-${round.number === currentRoundNumber}` : round.number"
        >
          <UCollapsible :default-open="byRound ? round.number === currentRoundNumber : !round.done">
            <UButton
              color="neutral"
              variant="ghost"
              block
              class="justify-start max-lg:min-h-11"
              trailing-icon="i-lucide-chevron-down"
            >
              <span class="flex items-center gap-2">
                <span class="text-sm font-semibold text-highlighted">{{ roundLabel(round.number) }}</span>
                <UBadge
                  v-if="round.done"
                  size="sm"
                  color="success"
                  variant="subtle"
                  :label="t('tournaments.queue.board.roundDone')"
                />
              </span>
            </UButton>
            <template #content>
              <div class="mt-2 grid gap-2 lg:grid-cols-2">
                <TournamentsQueueDuelRow
                  v-for="duel in round.duels"
                  :key="duel.id"
                  :duel="duel"
                  :can-edit="canEdit"
                  :busy="busy"
                  :best-of="bestOf"
                  :by-round="byRound"
                  @result="result => report(duel, result)"
                />
              </div>
            </template>
          </UCollapsible>
        </template>
      </div>
    </section>

    <UCollapsible :default-open="false">
      <UButton
        color="neutral"
        variant="ghost"
        class="max-lg:min-h-11"
        icon="i-lucide-circle-help"
        trailing-icon="i-lucide-chevron-down"
        :label="t('tournaments.queue.help.title')"
      />
      <template #content>
        <ul class="mt-2 list-disc space-y-1 pl-6 text-sm text-toned">
          <template v-if="byRound">
            <li>{{ t('tournaments.queue.help.rounds1') }}</li>
            <li>{{ t('tournaments.queue.help.point2') }}</li>
            <li>{{ t('tournaments.queue.help.point3') }}</li>
            <li>{{ t('tournaments.queue.help.point4') }}</li>
          </template>
          <template v-else>
            <li>{{ t('tournaments.queue.help.point1') }}</li>
            <li>{{ t('tournaments.queue.help.point2') }}</li>
            <li>{{ t('tournaments.queue.help.point3') }}</li>
            <li>{{ t('tournaments.queue.help.point4') }}</li>
          </template>
          <li>{{ t('tournaments.queue.board.tableHelp') }}</li>
        </ul>
      </template>
    </UCollapsible>
  </div>
</template>
