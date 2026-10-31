<script setup lang="ts">
import type { QueueDuelDto } from '~~/shared/tournaments'

// One duel of a duel-queue tournament: who plays whom, where, and (for the organizer) the two buttons that enter
// the winner. A finished duel can be corrected; a struck one is shown crossed out.

const props = defineProps<{
  duel: QueueDuelDto
  canEdit: boolean
  busy?: boolean
  /** Show the table / queue number in front (the list of running duels does not need the status badge). */
  compact?: boolean
}>()

const emit = defineEmits<{
  winner: [participantId: string]
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
const entering = computed(() => props.canEdit && (props.duel.status === 'running' || (props.duel.status === 'done' && correcting.value)))

const STATUS_COLORS = {
  planned: 'neutral',
  running: 'warning',
  done: 'success',
  void: 'neutral',
} as const

function choose(participantId: string) {
  correcting.value = false
  emit('winner', participantId)
}
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-default px-3 py-2"
    :class="isVoid ? 'opacity-60' : ''"
    data-testid="queue-duel"
  >
    <div class="min-w-0 flex-1">
      <div
        class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-highlighted"
        :class="isVoid ? 'line-through' : ''"
      >
        <UBadge
          v-if="duel.tableNumber !== null && duel.status === 'running'"
          size="sm"
          color="warning"
          variant="subtle"
          :label="t('tournaments.queue.board.tableDuel', { number: duel.tableNumber })"
        />
        <UBadge
          v-else-if="duel.queuePosition !== null"
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
        {{ t('tournaments.queue.board.wonBy', { name: winnerName }) }}
      </p>
    </div>

    <div
      v-if="entering"
      class="flex flex-wrap gap-2"
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
