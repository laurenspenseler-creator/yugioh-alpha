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
const decksOf = computed(() => new Map(props.tournament.participants.map(participant => [participant.id, participant.decks.map(deck => deck.name).join(' / ')])))

// The table can be folded away (it takes a lot of room on a small screen) and it can be pinned, i.e. follow the
// reader down the page, or be released and scroll away with the rest. Both choices are kept in this browser.
const HIDDEN_KEY = 'ygo-queue-table-hidden'
const PINNED_KEY = 'ygo-queue-table-pinned'
const hidden = ref(false)
const pinned = ref(true)

// A pinned table scrolls inside itself and so can hide rows (tester feedback: "Ben is not shown"): it says so.
const body = ref<HTMLElement | null>(null)
const overflowing = ref(false)

function measure() {
  overflowing.value = pinned.value && !hidden.value && body.value !== null && body.value.scrollHeight > body.value.clientHeight + 1
}

onMounted(() => {
  try {
    hidden.value = localStorage.getItem(HIDDEN_KEY) === '1'
    pinned.value = localStorage.getItem(PINNED_KEY) !== '0'
  }
  catch {
    // Storage can be blocked: the table is simply shown, and pinned.
  }
  measure()
  window.addEventListener('resize', measure)
})

onBeforeUnmount(() => window.removeEventListener('resize', measure))

watch([() => queue.value.table.length, pinned, hidden], () => nextTick(measure), { flush: 'post' })

function remember(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  }
  catch {
    // Not remembered, still set for now.
  }
}

function toggleHidden() {
  hidden.value = !hidden.value
  remember(HIDDEN_KEY, hidden.value)
}

function togglePinned() {
  pinned.value = !pinned.value
  remember(PINNED_KEY, pinned.value)
}

/** The difference of the games, with its sign, as the table shows it. */
function difference(won: number, lost: number): string {
  const value = won - lost
  return value > 0 ? `+${value}` : String(value)
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
    class="panel p-3 sm:p-4"
    :class="pinned ? 'sticky top-14 z-20 lg:top-0' : ''"
    data-testid="queue-table"
  >
    <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 class="text-base font-semibold text-highlighted">
        {{ t('tournaments.queue.board.tableTitle') }}
      </h2>
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
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
          :icon="pinned ? 'i-lucide-pin-off' : 'i-lucide-pin'"
          :label="pinned ? t('tournaments.queue.board.unpinTable') : t('tournaments.queue.board.pinTable')"
          :title="pinned ? t('tournaments.queue.board.unpinTableHelp') : t('tournaments.queue.board.pinTableHelp')"
          :aria-pressed="pinned"
          data-testid="queue-table-pin"
          @click="togglePinned"
        />
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

    <!-- Pinned, the table stays on screen and so it may not take more than a part of it: it scrolls inside. Released, it
         is part of the page and shows every player at once. -->
    <div
      v-show="!hidden"
      ref="body"
      class="mt-2"
      :class="pinned ? 'max-h-[26vh] overflow-y-auto sm:max-h-[42vh]' : ''"
      data-testid="queue-table-body"
    >
      <table class="w-full text-sm">
        <thead
          class="bg-default text-xs text-muted"
          :class="pinned ? 'sticky top-0' : ''"
        >
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
              class="hidden w-14 px-1 py-1 text-right font-medium sm:table-cell"
              :title="t('tournaments.queue.board.columns.matchdaysHelp')"
            >
              {{ t('tournaments.queue.board.columns.matchdays') }}
            </th>
            <th
              class="w-10 px-1 py-1 text-right font-medium"
              :title="t('tournaments.queue.board.columns.wins')"
            >
              {{ t('tournaments.queue.board.columns.wins') }}
            </th>
            <th
              class="w-12 px-1 py-1 text-right font-medium"
              :title="t('tournaments.queue.board.columns.pointsHelp')"
            >
              {{ t('tournaments.queue.board.columns.points') }}
            </th>
            <th
              class="w-12 px-1 py-1 text-right font-medium"
              :title="t('tournaments.queue.board.columns.played')"
            >
              {{ t('tournaments.queue.board.columns.played') }}
            </th>
            <th
              class="hidden w-16 px-1 py-1 text-right font-medium sm:table-cell"
              :title="t('tournaments.queue.board.columns.gamesHelp')"
            >
              {{ t('tournaments.queue.board.columns.games') }}
            </th>
            <th
              class="hidden w-12 px-1 py-1 text-right font-medium sm:table-cell"
              :title="t('tournaments.queue.board.columns.diffHelp')"
            >
              {{ t('tournaments.queue.board.columns.diff') }}
            </th>
            <th class="hidden px-2 py-1 text-center font-medium md:table-cell">
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
            <td
              class="font-numeric hidden px-1 py-1.5 text-right tabular-nums sm:table-cell"
              data-testid="queue-table-matchdays"
            >
              {{ row.matchdays }}
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
              {{ row.gamesWon }}:{{ row.gamesLost }}
            </td>
            <td class="font-numeric hidden px-1 py-1.5 text-right tabular-nums sm:table-cell">
              {{ difference(row.gamesWon, row.gamesLost) }}
            </td>
            <td
              class="hidden max-w-56 truncate px-2 py-1.5 text-center text-xs font-normal text-toned md:table-cell"
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

    <p
      v-if="overflowing"
      class="mt-2 text-xs text-warning"
      data-testid="queue-table-scrolls"
    >
      {{ t('tournaments.queue.board.tableScrolls') }}
    </p>

    <!-- On a phone the card stays pinned, so the explanation moves to the help at the bottom of the page. -->
    <p
      v-show="!hidden"
      class="mt-2 hidden text-xs text-muted sm:block"
    >
      {{ t('tournaments.queue.board.tableHelp') }}
    </p>
  </section>
</template>
