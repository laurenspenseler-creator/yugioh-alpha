<script setup lang="ts">
import { BEST_OF_CHOICES } from '~~/shared/tournament-modes'
import type { BestOf } from '~~/shared/tournament-modes'
import type { QueueDuelDto, TournamentDetail } from '~~/shared/tournaments'

// The page of a started Spielabend (tester feedback, round 15): no plan and no queue. The standings stay fixed at the
// top; below them the organizer pairs two of the registered players from the drop-downs and chooses for this one duel
// whether it is a single game or best of 3, then enters the result when it is played.

const props = defineProps<{
  tournament: TournamentDetail
}>()

const emit = defineEmits<{
  updated: [detail: TournamentDetail]
}>()

const { t } = useI18n()
const apiError = useApiError()

const queue = computed(() => props.tournament.queue!)
const organizer = computed(() => props.tournament.role === 'organizer')
const running = computed(() => props.tournament.status === 'running')
const canEdit = computed(() => organizer.value && running.value)

const busy = ref(false)
const errorMessage = ref('')

async function call(action: () => Promise<TournamentDetail>, fallbackKey: string): Promise<boolean> {
  busy.value = true
  errorMessage.value = ''
  try {
    emit('updated', await action())
    return true
  }
  catch (error) {
    errorMessage.value = apiError(error, fallbackKey)
    return false
  }
  finally {
    busy.value = false
  }
}

// --- Pairing a new duel ------------------------------------------------------------------

const playerA = ref<string | undefined>(undefined)
const playerB = ref<string | undefined>(undefined)
// The choice stays after a duel was started: an evening is mostly one kind of duel.
const bestOf = ref<BestOf>(1)

const runningDuels = computed(() => queue.value.duels.filter(duel => duel.status === 'running'))
const finishedDuels = computed(() => queue.value.duels.filter(duel => duel.status === 'done').reverse())

const busyIds = computed(() => new Set(runningDuels.value.flatMap(duel => [duel.participantAId, duel.participantBId])))
const activePlayers = computed(() => queue.value.table.filter(row => !row.left))
const freePlayers = computed(() => activePlayers.value.filter(row => !busyIds.value.has(row.participantId)))

/** Someone who is playing right now is listed, but grey and not to be picked. */
function playerItems(exclude: string | undefined) {
  return activePlayers.value
    .filter(row => row.participantId !== exclude)
    .map(row => ({
      label: row.name,
      value: row.participantId,
      disabled: busyIds.value.has(row.participantId),
    }))
}

const itemsA = computed(() => playerItems(playerB.value))
const itemsB = computed(() => playerItems(playerA.value))

const bestOfItems = computed(() => BEST_OF_CHOICES.map(choice => ({
  label: choice === 3 ? t('tournaments.queue.free.bestOf3') : t('tournaments.queue.free.single'),
  value: choice,
})))

const canPair = computed(() => canEdit.value && playerA.value !== undefined && playerB.value !== undefined && playerA.value !== playerB.value)

async function startDuel() {
  if (!canPair.value) {
    return
  }
  const ok = await call(
    () => $fetch<TournamentDetail>(`/api/tournaments/${props.tournament.id}/free-duels`, {
      method: 'POST',
      body: { participantAId: playerA.value, participantBId: playerB.value, bestOf: bestOf.value },
    }),
    'tournaments.queue.free.startFailed',
  )
  if (ok) {
    playerA.value = undefined
    playerB.value = undefined
  }
}

function removeDuel(duel: QueueDuelDto) {
  return call(
    () => $fetch<TournamentDetail>(`/api/tournaments/${props.tournament.id}/free-duels/${duel.id}`, { method: 'DELETE' }),
    'tournaments.queue.free.removeFailed',
  )
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
</script>

<template>
  <div
    class="space-y-4"
    data-testid="free-board"
  >
    <TournamentsQueueTable :tournament="tournament" />

    <p
      v-if="errorMessage"
      role="alert"
      class="text-sm text-error"
    >
      {{ errorMessage }}
    </p>

    <section
      v-if="canEdit"
      class="panel space-y-3 p-4"
      data-testid="free-pair"
    >
      <h2 class="text-base font-semibold text-highlighted">
        {{ t('tournaments.queue.free.pairTitle') }}
      </h2>
      <p class="text-xs text-muted">
        {{ t('tournaments.queue.free.pairHelp') }}
      </p>

      <!-- Four columns only where there is room beside the sidebar (xl); `minmax(0, …)` lets the menus shrink instead of
           pushing the page wider. Below that: two columns and the button on its own row. -->
      <div class="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,12rem)_auto]">
        <UFormField :label="t('tournaments.queue.free.playerA')">
          <USelect
            v-model="playerA"
            :items="itemsA"
            :placeholder="t('tournaments.queue.free.pickPlayer')"
            :aria-label="t('tournaments.queue.free.playerA')"
            class="w-full"
            data-testid="free-player-a"
          />
        </UFormField>
        <UFormField :label="t('tournaments.queue.free.playerB')">
          <USelect
            v-model="playerB"
            :items="itemsB"
            :placeholder="t('tournaments.queue.free.pickPlayer')"
            :aria-label="t('tournaments.queue.free.playerB')"
            class="w-full"
            data-testid="free-player-b"
          />
        </UFormField>
        <UFormField :label="t('tournaments.queue.free.playedAs')">
          <USelect
            v-model="bestOf"
            :items="bestOfItems"
            :aria-label="t('tournaments.queue.free.playedAs')"
            class="w-full"
            data-testid="free-best-of"
          />
        </UFormField>
        <UButton
          icon="i-lucide-swords"
          class="tap-target justify-center sm:col-span-2 xl:col-span-1"
          :label="t('tournaments.queue.free.start')"
          :disabled="!canPair"
          :loading="busy"
          data-testid="free-start"
          @click="startDuel"
        />
      </div>
      <p
        v-if="freePlayers.length < 2"
        class="text-xs text-warning"
        data-testid="free-no-players"
      >
        {{ t('tournaments.queue.free.noFreePlayers') }}
      </p>
    </section>

    <section class="panel space-y-3 p-4">
      <h2 class="text-base font-semibold text-highlighted">
        {{ t('tournaments.queue.free.openTitle') }}
      </h2>
      <p
        v-if="runningDuels.length === 0"
        class="text-sm text-muted"
      >
        {{ t('tournaments.queue.free.openEmpty') }}
      </p>
      <div
        v-else
        class="grid gap-2 lg:grid-cols-2"
        data-testid="free-open"
      >
        <TournamentsQueueDuelRow
          v-for="duel in runningDuels"
          :key="duel.id"
          :duel="duel"
          :can-edit="canEdit"
          :busy="busy"
          :best-of="queue.bestOf"
          by-round
          removable
          @result="result => report(duel, result)"
          @remove="removeDuel(duel)"
        />
      </div>
    </section>

    <section class="panel space-y-3 p-4">
      <h2 class="text-base font-semibold text-highlighted">
        {{ t('tournaments.queue.free.doneTitle') }}
      </h2>
      <p
        v-if="finishedDuels.length === 0"
        class="text-sm text-muted"
      >
        {{ t('tournaments.queue.free.doneEmpty') }}
      </p>
      <div
        v-else
        class="grid gap-2 lg:grid-cols-2"
        data-testid="free-done"
      >
        <TournamentsQueueDuelRow
          v-for="duel in finishedDuels"
          :key="duel.id"
          :duel="duel"
          :can-edit="canEdit"
          :busy="busy"
          :best-of="queue.bestOf"
          by-round
          @result="result => report(duel, result)"
        />
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
          <li>{{ t('tournaments.queue.free.help1') }}</li>
          <li>{{ t('tournaments.queue.free.help2') }}</li>
          <li>{{ t('tournaments.queue.free.help3') }}</li>
        </ul>
      </template>
    </UCollapsible>
  </div>
</template>
