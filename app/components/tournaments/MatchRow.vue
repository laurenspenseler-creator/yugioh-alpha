<script setup lang="ts">
import { BYE_GAMES } from '~~/shared/tournaments'
import type { ByeScoring, TournamentDetail, TournamentMatchDto } from '~~/shared/tournaments'

const props = defineProps<{
  match: TournamentMatchDto
  tournamentId: string
  byeScoring: ByeScoring
  /** Ids of participants taken out of the standings, to flag them in a void match. */
  withdrawnIds: string[]
  /** Organizer, tournament running, and the match's round is still pending. */
  canEdit: boolean
  swapMode: boolean
  selectedA: boolean
  selectedB: boolean
}>()

const emit = defineEmits<{
  updated: [detail: TournamentDetail]
  selectSlot: [slot: 'a' | 'b']
}>()

const { t } = useI18n()
const apiError = useApiError()

const isEditing = ref(!props.match.reported)
const isSubmitting = ref(false)
const errorMessage = ref('')

watch(() => props.match, (match) => {
  isEditing.value = !match.reported
}, { deep: true })

async function submitResult(a: number, b: number) {
  if (isSubmitting.value) {
    return
  }

  isSubmitting.value = true
  errorMessage.value = ''

  try {
    const detail = await $fetch<TournamentDetail>(
      `/api/tournaments/${props.tournamentId}/matches/${props.match.id}`,
      { method: 'PATCH', body: { gamesA: a, gamesB: b } },
    )
    isEditing.value = false
    emit('updated', detail)
  }
  catch (error) {
    errorMessage.value = apiError(error, 'tournaments.match.saveFailed')
  }
  finally {
    isSubmitting.value = false
  }
}

/**
 * The quick buttons are the only way to report a result (a match always has a
 * winner, ADR 0031): A wins 2:0 / 2:1, then B wins 1:2 / 0:2 (scores always read A:B).
 * The manual score fields were dropped on tester feedback; the server still
 * accepts any valid score.
 */
const quickScores = {
  a: [[2, 0], [2, 1]],
  b: [[1, 2], [0, 2]],
} as const

const withdrawnA = computed(() => props.withdrawnIds.includes(props.match.participantAId))
const withdrawnB = computed(() => props.match.participantBId !== null && props.withdrawnIds.includes(props.match.participantBId))

function sideName(side: 'a' | 'b'): string {
  return side === 'a' ? props.match.participantAName : (props.match.participantBName ?? '')
}

const winnerName = computed(() => {
  if (props.match.winnerParticipantId === props.match.participantAId) {
    return props.match.participantAName
  }
  if (props.match.winnerParticipantId === props.match.participantBId) {
    return props.match.participantBName
  }
  return null
})

const resultLabel = computed(() => (props.match.isDraw
  ? t('tournaments.match.draw')
  : t('tournaments.match.win', { name: winnerName.value ?? '' })))

const byeScore = computed(() => props.byeScoring === 'win'
  ? t('tournaments.match.byeScore', { score: `${BYE_GAMES}:0` })
  : t('tournaments.match.byeNoPoints'))

function onChipClick(slot: 'a' | 'b') {
  if (!props.swapMode) {
    return
  }
  emit('selectSlot', slot)
}
</script>

<template>
  <div
    data-testid="match-row"
    class="flex flex-col gap-2 rounded-lg border border-default p-3 sm:flex-row sm:items-center sm:justify-between"
  >
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-[0.6875rem] font-semibold tracking-wider text-muted uppercase">{{ t('tournaments.match.table', { number: match.tableNumber }) }}</span>

      <!-- Names are only interactive in swap mode (#35): outside of it a
           `<button>` announced no affordance and did nothing on click. -->
      <button
        v-if="swapMode"
        type="button"
        class="tap-target inline-flex cursor-pointer items-center rounded px-1 text-sm font-medium hover:bg-primary/10"
        :class="selectedA ? 'bg-primary/20 text-primary' : 'text-highlighted'"
        @click="onChipClick('a')"
      >
        {{ match.participantAName }}
      </button>
      <span
        v-else
        class="rounded px-1 text-sm font-medium text-highlighted"
      >
        {{ match.participantAName }}
      </span>
      <UBadge
        v-if="withdrawnA"
        size="sm"
        color="neutral"
        variant="subtle"
        :label="t('tournaments.withdrawn')"
      />

      <template v-if="match.isBye">
        <UBadge
          color="neutral"
          variant="subtle"
          :label="t('tournaments.match.bye')"
        />
        <span class="text-xs text-muted">{{ byeScore }}</span>
      </template>
      <template v-else>
        <span class="text-xs text-muted">{{ t('tournaments.match.versus') }}</span>
        <button
          v-if="swapMode"
          type="button"
          class="tap-target inline-flex cursor-pointer items-center rounded px-1 text-sm font-medium hover:bg-primary/10"
          :class="selectedB ? 'bg-primary/20 text-primary' : 'text-highlighted'"
          @click="onChipClick('b')"
        >
          {{ match.participantBName }}
        </button>
        <span
          v-else
          class="rounded px-1 text-sm font-medium text-highlighted"
        >
          {{ match.participantBName }}
        </span>
        <UBadge
          v-if="withdrawnB"
          size="sm"
          color="neutral"
          variant="subtle"
          :label="t('tournaments.withdrawn')"
        />
      </template>
    </div>

    <!-- A match with a withdrawn player is not scored (ADR 0031): an unplayed
         one reads "spielfrei" for the opponent and needs no result. -->
    <div
      v-if="match.voided"
      class="flex flex-wrap items-center gap-2"
    >
      <template v-if="match.reported">
        <span class="font-numeric text-base font-bold tracking-[0.04em] text-muted tabular-nums">{{ match.gamesA }}:{{ match.gamesB }}</span>
        <UBadge
          color="neutral"
          variant="subtle"
          :label="t('tournaments.match.voided')"
        />
      </template>
      <template v-else>
        <UBadge
          color="neutral"
          variant="subtle"
          :label="t('tournaments.match.bye')"
        />
        <span class="text-xs text-muted">{{ t('tournaments.match.notPlayed') }}</span>
      </template>
    </div>

    <div
      v-else-if="!match.isBye"
      class="flex flex-wrap items-center gap-2"
    >
      <template v-if="match.reported && !isEditing">
        <span class="font-numeric text-base font-bold tracking-[0.04em] text-highlighted tabular-nums">{{ match.gamesA }}:{{ match.gamesB }}</span>
        <UBadge
          variant="subtle"
          :color="match.isDraw ? 'neutral' : 'success'"
          :label="resultLabel"
        />
        <UButton
          v-if="canEdit"
          size="xs"
          color="neutral"
          variant="outline"
          :label="t('tournaments.match.editResult')"
          class="tap-target"
          @click="() => { isEditing = true }"
        />
      </template>

      <!-- The quick buttons report a result (#33). Two groups that wrap
           independently, so the 44px touch targets (#28) stack into two tidy
           lines on a phone instead of one ragged one. -->
      <template v-else-if="canEdit">
        <div
          v-for="side in (['a', 'b'] as const)"
          :key="side"
          class="flex flex-wrap items-center gap-2 max-sm:w-full"
        >
          <span class="max-w-32 truncate text-xs text-muted">{{ t('tournaments.match.win', { name: sideName(side) }) }}</span>
          <UButton
            v-for="[scoreA, scoreB] in quickScores[side]"
            :key="`${scoreA}:${scoreB}`"
            size="xs"
            :label="`${scoreA}:${scoreB}`"
            :aria-label="t('tournaments.match.winBy', { name: sideName(side), score: `${scoreA}:${scoreB}` })"
            class="tap-target max-sm:flex-auto"
            :loading="isSubmitting"
            @click="submitResult(scoreA, scoreB)"
          />
        </div>
      </template>
    </div>

    <p
      v-if="errorMessage"
      class="text-sm text-error"
    >
      {{ errorMessage }}
    </p>
  </div>
</template>
