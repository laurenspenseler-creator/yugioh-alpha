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
// Spieltage have no tables and no queue: the last column only says who is playing right now.
const byRound = computed(() => queue.value.flow === 'rounds')

/** The decks each player plays (ADR 0039), by name; shown next to the player so everybody knows what they face. */
const decksOf = computed(() => new Map(props.tournament.participants.map(participant => [participant.id, participant.decks.map(deck => deck.name).join(', ')])))

// The table can be folded away (it takes a lot of room on a small screen); the choice is kept in this browser.
const HIDDEN_KEY = 'ygo-queue-table-hidden'
const hidden = ref(false)

onMounted(() => {
  try {
    hidden.value = localStorage.getItem(HIDDEN_KEY) === '1'
  }
  catch {
    // Storage can be blocked: the table is simply shown.
  }
})

function toggleHidden() {
  hidden.value = !hidden.value
  try {
    localStorage.setItem(HIDDEN_KEY, hidden.value ? '1' : '0')
  }
  catch {
    // Not remembered, still hidden for now.
  }
}

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
      <div class="flex items-center gap-2">
        <p class="text-xs text-muted">
          {{ t('tournaments.queue.board.progress', { done: queue.duelsDone, total: queue.duelsTotal }) }}
          <template v-if="remaining">
            · {{ remaining }}
          </template>
        </p>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          :icon="hidden ? 'i-lucide-eye' : 'i-lucide-eye-off'"
          :label="hidden ? t('tournaments.queue.board.showTable') : t('tournaments.queue.board.hideTable')"
          :aria-pressed="hidden"
          data-testid="queue-table-toggle"
          @click="toggleHidden"
        />
      </div>
    </div>

    <div
      v-show="!hidden"
      class="mt-2 max-h-[26vh] overflow-y-auto sm:max-h-[42vh]"
    >
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
              class="w-12 px-1 py-1 text-right font-medium"
              :title="t('tournaments.queue.board.columns.pointsHelp')"
            >
              {{ t('tournaments.queue.board.columns.points') }}
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
            <th class="hidden px-2 py-1 font-medium md:table-cell">
              {{ t('tournaments.queue.board.columns.decks') }}
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
                v-else-if="row.tied && row.played > 0"
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
            <td
              class="font-numeric px-1 py-1.5 text-right tabular-nums"
              data-testid="queue-table-points"
            >
              {{ row.points }}
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
              class="hidden max-w-56 truncate px-2 py-1.5 text-xs font-normal text-toned md:table-cell"
              :title="decksOf.get(row.participantId) || undefined"
              data-testid="queue-table-decks"
            >
              {{ decksOf.get(row.participantId) || '–' }}
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
                :label="byRound ? t('tournaments.queue.board.playing') : t('tournaments.queue.board.atTable', { number: row.tableNumber })"
              />
              <UBadge
                v-else-if="!byRound && row.queuePosition !== null"
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

    <!-- On a phone the card stays pinned, so the explanation moves to the help at the bottom of the page. -->
    <p
      v-show="!hidden"
      class="mt-2 hidden text-xs text-muted sm:block"
    >
      {{ t('tournaments.queue.board.tableHelp') }}
    </p>
  </section>
</template>
