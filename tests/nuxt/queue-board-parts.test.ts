import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import QueueDuelRow from '~/components/tournaments/QueueDuelRow.vue'
import QueueTable from '~/components/tournaments/QueueTable.vue'
import type { QueueDuelDto, QueueTableRowDto, TournamentDetail } from '~~/shared/tournaments'

enableAutoUnmount(afterEach)

const DUEL: QueueDuelDto = {
  id: 'd1',
  round: 1,
  kind: 'regular',
  status: 'running',
  participantAId: 'pa',
  participantAName: 'Anna',
  participantBId: 'pb',
  participantBName: 'Ben',
  winnerParticipantId: null,
  gamesA: null,
  gamesB: null,
  tableNumber: 2,
  startedAt: null,
  endedAt: null,
  queuePosition: null,
}

describe('a duel row', () => {
  it('enters a single game with two buttons, one per player', async () => {
    const component = await mountSuspended(QueueDuelRow, { props: { duel: DUEL, canEdit: true, bestOf: 1 } })

    const buttons = component.findAll('button')
    expect(buttons.map(button => button.text())).toEqual(['Anna hat gewonnen', 'Ben hat gewonnen'])
    await buttons[1]!.trigger('click')

    expect(component.emitted('result')).toEqual([[{ winnerId: 'pb' }]])
  })

  it('enters a best-of-3 duel with the score: the winner takes two games, the other none or one', async () => {
    const component = await mountSuspended(QueueDuelRow, { props: { duel: DUEL, canEdit: true, bestOf: 3 } })

    const buttons = component.findAll('button')
    expect(buttons.map(button => button.text())).toEqual(['Anna gewinnt 2:0', 'Anna gewinnt 2:1', 'Ben gewinnt 2:0', 'Ben gewinnt 2:1'])
    await buttons[1]!.trigger('click')
    await buttons[3]!.trigger('click')

    expect(component.emitted('result')).toEqual([
      [{ winnerId: 'pa', gamesA: 2, gamesB: 1 }],
      [{ winnerId: 'pb', gamesA: 1, gamesB: 2 }],
    ])
  })

  it('shows the score of a finished best-of-3 duel next to the winner', async () => {
    const finished = { ...DUEL, status: 'done' as const, winnerParticipantId: 'pb', gamesA: 1, gamesB: 2 }
    const component = await mountSuspended(QueueDuelRow, { props: { duel: finished, canEdit: false, bestOf: 3 } })

    expect(component.text()).toContain('Ben hat gewonnen')
    expect(component.text()).toContain('1:2')
  })

  it('can enter a duel that has not begun in Spieltage, and only there', async () => {
    const planned = { ...DUEL, status: 'planned' as const, tableNumber: null, round: 3 }
    const byRound = await mountSuspended(QueueDuelRow, { props: { duel: planned, canEdit: true, bestOf: 1, byRound: true } })
    const withQueue = await mountSuspended(QueueDuelRow, { props: { duel: planned, canEdit: true, bestOf: 1 } })

    expect(byRound.findAll('button').map(button => button.text())).toEqual(['Anna hat gewonnen', 'Ben hat gewonnen'])
    expect(withQueue.findAll('button')).toHaveLength(0)
  })

  it('names no table and no place in the queue with Spieltage', async () => {
    const waiting = { ...DUEL, status: 'planned' as const, tableNumber: null, queuePosition: 3 }
    const withQueue = await mountSuspended(QueueDuelRow, { props: { duel: waiting, canEdit: false } })
    const byRound = await mountSuspended(QueueDuelRow, { props: { duel: waiting, canEdit: false, byRound: true } })

    expect(withQueue.text()).toContain('Nr. 3')
    expect(byRound.text()).not.toContain('Nr. 3')
    const running = await mountSuspended(QueueDuelRow, { props: { duel: DUEL, canEdit: false, byRound: true } })
    expect(running.text()).not.toContain('Tisch')
  })
})

function row(patch: Partial<QueueTableRowDto>): QueueTableRowDto {
  return {
    participantId: 'pa',
    name: 'Anna',
    place: 1,
    wins: 1,
    points: 3,
    played: 1,
    open: 2,
    buchholz: 0,
    left: false,
    tied: false,
    tableNumber: null,
    queuePosition: null,
    ...patch,
  }
}

function tournament(flow: 'queue' | 'rounds'): TournamentDetail {
  const deck = (name: string) => ({ id: name, name, deckId: null, hasList: false, legal: null, issueCount: null, snapshot: null })
  return {
    id: 't-1',
    status: 'running',
    selfParticipantId: null,
    participants: [
      { id: 'pa', name: 'Anna', decks: [deck('Dunkler Magier'), deck('Chaos')] },
      { id: 'pb', name: 'Ben', decks: [] },
    ],
    queue: {
      flow,
      duelsDone: 1,
      duelsTotal: 5,
      remainingMinutes: null,
      table: [
        row({ participantId: 'pa', name: 'Anna', tableNumber: 2 }),
        row({ participantId: 'pb', name: 'Ben', place: 2, wins: 0, queuePosition: 4 }),
      ],
    },
  } as unknown as TournamentDetail
}

describe('the standings table of a duel tournament', () => {
  beforeEach(() => {
    try {
      localStorage.removeItem('ygo-queue-table-hidden')
    }
    catch {
      // Without storage there is nothing to clear.
    }
  })

  it('shows the decks of every player next to them, and a dash for a player without one', async () => {
    const component = await mountSuspended(QueueTable, { props: { tournament: tournament('queue') } })

    const decks = component.findAll('[data-testid="queue-table-decks"]').map(cell => cell.text())
    expect(decks).toEqual(['Dunkler Magier, Chaos', '–'])
  })

  it('puts every number under its own heading', async () => {
    const detail = tournament('rounds')
    detail.queue!.table = [row({ participantId: 'pa', name: 'Anna', place: 4, wins: 7, points: 21, played: 9, open: 5, buchholz: 11 })]
    const component = await mountSuspended(QueueTable, { props: { tournament: detail } })

    const headings = component.findAll('thead th').map(heading => heading.text())
    const cells = component.findAll('tbody tr')[0]!.findAll('td').map(cell => cell.text())
    const under = (heading: string) => cells[headings.indexOf(heading)]
    expect(under('Siege')).toBe('7')
    expect(under('Punkte')).toBe('21')
    expect(under('Duelle')).toBe('9')
    expect(under('Offen')).toBe('5')
    expect(under('Buchholz')).toBe('11')
  })

  it('shows the points next to the wins', async () => {
    const component = await mountSuspended(QueueTable, { props: { tournament: tournament('rounds') } })

    expect(component.find('thead').text()).toContain('Punkte')
    expect(component.findAll('[data-testid="queue-table-points"]').map(cell => cell.text())).toEqual(['3', '3'])
  })

  it('can be hidden and shown again, and remembers it', async () => {
    const component = await mountSuspended(QueueTable, { props: { tournament: tournament('queue') } })
    const wrapper = () => component.find('table').element.parentElement as HTMLElement

    expect(wrapper().style.display).not.toBe('none')
    await component.find('[data-testid="queue-table-toggle"]').trigger('click')
    expect(wrapper().style.display).toBe('none')
    expect(component.find('[data-testid="queue-table-toggle"]').text()).toBe('Tabelle einblenden')
    expect(localStorage.getItem('ygo-queue-table-hidden')).toBe('1')

    await component.find('[data-testid="queue-table-toggle"]').trigger('click')
    expect(wrapper().style.display).not.toBe('none')
    expect(localStorage.getItem('ygo-queue-table-hidden')).toBe('0')
  })

  it('opens hidden when it was hidden before', async () => {
    localStorage.setItem('ygo-queue-table-hidden', '1')
    const component = await mountSuspended(QueueTable, { props: { tournament: tournament('queue') } })

    expect((component.find('table').element.parentElement as HTMLElement).style.display).toBe('none')
  })

  it('says "Tisch 2" and the place in the queue with a queue, only who plays with Spieltage', async () => {
    const withQueue = await mountSuspended(QueueTable, { props: { tournament: tournament('queue') } })
    expect(withQueue.text()).toContain('Tisch 2')
    expect(withQueue.text()).toContain('Wartet · Nr. 4')

    const byRound = await mountSuspended(QueueTable, { props: { tournament: tournament('rounds') } })
    expect(byRound.text()).toContain('Spielt')
    expect(byRound.text()).not.toContain('Tisch 2')
    expect(byRound.text()).not.toContain('Wartet')
  })
})
