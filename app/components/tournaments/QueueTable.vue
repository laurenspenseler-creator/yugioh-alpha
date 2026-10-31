<script setup lang="ts">
import { splitMinutes } from '~~/shared/tournament-modes'
import type { TournamentDetail } from '~~/shared/tournaments'

// The standings of a duel-queue tournament (ADR 0042). It stays fixed at the top of the page while the schedule
// scrolls under it, so a player who comes late sees where they stand at once. Players who left are grey, last,
// without a place; their record stays.

const props = defineProps<{
  tournament: TournamentDetail
}>()

const { t } = useI18n()

const queue = computed(() => props.tournament.queue!)
const live = computed(() => props.tournament.status === 'running')

const remaining = computed(() => {
  const minutes = queue.value.remainingMinutes
  if (minutes === null) {
    return ''
  }
  const { hours, minutes: rest } = splitMinutes(minutes)
  return t('tournaments.queue.board.remaining', { hours, minutes: rest })
})
</script>

<template>
  <section
    class="panel sticky top-14 z-20 p-3 sm:p-4 lg:top-0"
    data-testid="queue-table"
  >
    <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 class="text-base font-semibold text-highlighted">
        {{ t('tournaments.queue.board.tableTitle') }}
      </h2>
      <p class="text-xs text-muted">
        {{ t('tournaments.queue.board.progress', { done: queue.duelsDone, total: queue.duelsTotal }) }}
        <template v-if="remaining">
          · {{ remaining }}
        </template>
      </p>
    </div>

    <div class="mt-2 max-h-[42vh] overflow-y-auto">
      <table class="w-full text-sm">
        <thead class="sticky top-0 bg-default text-xs text-muted">
          <tr class="text-left">
            <th
              class="w-9 py-1 pr-1 font-medium"
              :title="t('tournaments.queue.board.columns.place')"
            >
              #
            </th>
            <th class="py-1 pr-2 font-medium">
              {{ t('tournaments.queue.board.columns.player') }}
            </th>
            <th
              class="w-10 px-1 py-1 text-right font-medium"
              :title="t('tournaments.queue.board.columns.wins')"
            >
              {{ t('tournaments.queue.board.columns.wins') }}
            </th>
            <th
              class="w-12 px-1 py-1 text-right font-medium"
              :title="t('tournaments.queue.board.columns.played')"
            >
              {{ t('tournaments.queue.board.columns.played') }}
            </th>
            <th
              class="hidden w-12 px-1 py-1 text-right font-medium sm:table-cell"
              :title="t('tournaments.queue.board.columns.open')"
            >
              {{ t('tournaments.queue.board.columns.open') }}
            </th>
            <th
              class="hidden w-16 px-1 py-1 text-right font-medium sm:table-cell"
              :title="t('tournaments.queue.board.tableHelp')"
            >
              {{ t('tournaments.queue.board.columns.buchholz') }}
            </th>
            <th
              v-if="live"
              class="py-1 pl-2 text-right font-medium"
            >
              {{ t('tournaments.queue.board.columns.now') }}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-default">
          <tr
            v-for="row in queue.table"
            :key="row.participantId"
            :class="[
              row.left ? 'text-muted' : 'text-highlighted',
              row.tableNumber !== null ? 'bg-warning/5' : '',
              tournament.selfParticipantId === row.participantId ? 'font-semibold' : '',
            ]"
          >
            <td class="font-numeric py-1.5 pr-1 tabular-nums">
              {{ row.place ?? '–' }}
            </td>
            <td class="py-1.5 pr-2">
              <span :class="row.left ? 'italic' : ''">{{ row.name }}</span>
              <UBadge
                v-if="row.left"
                class="ml-1.5"
                size="sm"
                color="neutral"
                variant="subtle"
                :label="t('tournaments.queue.board.dropped')"
              />
              <UBadge
                v-else-if="row.tied"
                class="ml-1.5"
                size="sm"
                color="neutral"
                variant="subtle"
                :label="t('tournaments.queue.board.tied')"
              />
            </td>
            <td class="font-numeric px-1 py-1.5 text-right tabular-nums">
              {{ row.wins }}
            </td>
            <td class="font-numeric px-1 py-1.5 text-right tabular-nums">
              {{ row.played }}
            </td>
            <td class="font-numeric hidden px-1 py-1.5 text-right tabular-nums sm:table-cell">
              {{ row.left ? '–' : row.open }}
            </td>
            <td class="font-numeric hidden px-1 py-1.5 text-right tabular-nums sm:table-cell">
              {{ row.buchholz }}
            </td>
            <td
              v-if="live"
              class="py-1.5 pl-2 text-right"
            >
              <UBadge
                v-if="row.tableNumber !== null"
                size="sm"
                color="warning"
                variant="subtle"
                :label="t('tournaments.queue.board.atTable', { number: row.tableNumber })"
              />
              <UBadge
                v-else-if="row.queuePosition !== null"
                size="sm"
                color="neutral"
                variant="subtle"
                :label="t('tournaments.queue.board.inQueue', { position: row.queuePosition })"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="mt-2 text-xs text-muted">
      {{ t('tournaments.queue.board.tableHelp') }}
    </p>
  </section>
</template>
