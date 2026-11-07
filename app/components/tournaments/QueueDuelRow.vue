<script setup lang="ts">
import { GAMES_TO_WIN_BEST_OF_3 } from '~~/shared/tournament-modes'
import type { QueueDuelDto } from '~~/shared/tournaments'

// One duel of a duel-queue tournament: who plays whom, where, and (for the organizer) the buttons that enter the
// result: the winner, in a best-of-3 tournament with the score (2:0 or 2:1). A finished duel can be corrected; a
// struck one is shown crossed out.

const props = defineProps<{
  duel: QueueDuelDto
  canEdit: boolean
  busy?: boolean
  /** Show the table / queue number in front (the list of running duels does not need the status badge). */
  compact?: boolean
  /** 3 = the result is entered as a score; anything else is a single game. */
  bestOf?: number
  /** Spieltage have no tables and no queue, so no table number or place in the queue is shown. */
  byRound?: boolean
}>()

const emit = defineEmits<{
  result: [payload: { winnerId: string, gamesA?: number, gamesB?: number }]
}>()

const { t } = useI18n()

const correcting = ref(false)

const isVoid = computed(() => props.duel.status === 'void')
const winnerName = computed(() => {
  if (props.duel.winnerParticipantId === props.duel.participantAId) {
    return props.duel.participantAName
  }
  return props.duel.winnerParticipantId === props.duel.participantBId ? props.duel.participantBName : ''
})
const score = computed(() => props.duel.gamesA !== null && props.duel.gamesB !== null ? `${props.duel.gamesA}:${props.duel.gamesB}` : '')
// Spieltage force no order: a duel that has not begun can be entered too.
const entering = computed(() => props.canEdit && (props.duel.status === 'running' || (props.byRound && props.duel.status === 'planned') || (props.duel.status === 'done' && correcting.value)))

/** The ways a best-of-3 duel can end, for each player: they win 2:0 or 2:1. */
const scoreChoices = computed(() => [
  { key: 'a-0', winnerId: props.duel.participantAId, name: props.duel.participantAName, own: GAMES_TO_WIN_BEST_OF_3, other: 0, asA: true },
  { key: 'a-1', winnerId: props.duel.participantAId, name: props.duel.participantAName, own: GAMES_TO_WIN_BEST_OF_3, other: 1, asA: true },
  { key: 'b-0', winnerId: props.duel.participantBId, name: props.duel.participantBName, own: GAMES_TO_WIN_BEST_OF_3, other: 0, asA: false },
  { key: 'b-1', winnerId: props.duel.participantBId, name: props.duel.participantBName, own: GAMES_TO_WIN_BEST_OF_3, other: 1, asA: false },
])

const STATUS_COLORS = {
  planned: 'neutral',
  running: 'warning',
  done: 'success',
  void: 'neutral',
} as const

function choose(winnerId: string) {
  correcting.value = false
  emit('result', { winnerId })
}

function chooseScore(choice: { winnerId: string, own: number, other: number, asA: boolean }) {
  correcting.value = false
  emit('result', {
    winnerId: choice.winnerId,
    gamesA: choice.asA ? choice.own : choice.other,
    gamesB: choice.asA ? choice.other : choice.own,
  })
}
</script>

<template>
  <div
    class="flex flex-col gap-2 rounded-lg border border-default px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3"
    :class="isVoid ? 'opacity-60' : ''"
    data-testid="queue-duel"
  >
    <div class="min-w-0 sm:min-w-44 sm:flex-1">
      <div
        class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-highlighted"
        :class="isVoid ? 'line-through' : ''"
      >
        <UBadge
          v-if="!byRound && duel.tableNumber !== null && duel.status === 'running'"
          size="sm"
          color="warning"
          variant="subtle"
          :label="t('tournaments.queue.board.tableDuel', { number: duel.tableNumber })"
        />
        <UBadge
          v-else-if="!byRound && duel.queuePosition !== null"
          size="sm"
          color="neutral"
          variant="subtle"
          :label="t('tournaments.queue.board.queueNumber', { number: duel.queuePosition })"
        />
        <span :class="duel.winnerParticipantId === duel.participantAId ? 'font-semibold' : ''">{{ duel.participantAName }}</span>
        <span class="text-muted">{{ t('tournaments.queue.board.vs') }}</span>
        <span :class="duel.winnerParticipantId === duel.participantBId ? 'font-semibold' : ''">{{ duel.participantBName }}</span>
        <UBadge
          v-if="duel.kind !== 'regular'"
          size="sm"
          color="info"
          variant="subtle"
          :label="t(`tournaments.queue.board.kind.${duel.kind}`)"
        />
        <UBadge
          v-if="!compact"
          size="sm"
          :color="STATUS_COLORS[duel.status]"
          variant="subtle"
          :label="t(`tournaments.queue.board.status.${duel.status}`)"
        />
      </div>
      <p
        v-if="duel.status === 'done' && winnerName"
        class="mt-0.5 text-xs text-muted"
      >
        {{ t('tournaments.queue.board.wonBy', { name: winnerName }) }}<template v-if="score">
          · <span class="font-numeric">{{ score }}</span>
        </template>
      </p>
    </div>

    <!-- Four score buttons are too wide for one line in a card: two columns, under the names. -->
    <div
      v-if="entering && bestOf === 3"
      class="grid w-full grid-cols-2 gap-2"
    >
      <UButton
        v-for="choice in scoreChoices"
        :key="choice.key"
        size="sm"
        color="primary"
        variant="outline"
        class="tap-target"
        :disabled="busy"
        :label="t('tournaments.queue.board.setWinnerScore', { name: choice.name, own: choice.own, other: choice.other })"
        @click="chooseScore(choice)"
      />
    </div>
    <div
      v-else-if="entering"
      class="grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:flex-wrap"
    >
      <UButton
        size="sm"
        color="primary"
        variant="outline"
        class="tap-target"
        :disabled="busy"
        :label="t('tournaments.queue.board.setWinner', { name: duel.participantAName })"
        @click="choose(duel.participantAId)"
      />
      <UButton
        size="sm"
        color="primary"
        variant="outline"
        class="tap-target"
        :disabled="busy"
        :label="t('tournaments.queue.board.setWinner', { name: duel.participantBName })"
        @click="choose(duel.participantBId)"
      />
    </div>
    <UButton
      v-else-if="canEdit && duel.status === 'done'"
      size="xs"
      color="neutral"
      variant="ghost"
      class="tap-target"
      :label="t('tournaments.queue.board.correct')"
      @click="correcting = true"
    />
  </div>
</template>
