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

  it('puts the buttons of the player named first on the left, in a column, and the other player right', async () => {
    const component = await mountSuspended(QueueDuelRow, { props: { duel: DUEL, canEdit: true, bestOf: 3 } })

    const grid = component.find('[data-testid="queue-duel-scores"]')
    // Filled column by column in two rows: the first two buttons (Anna) are the left column, the last two (Ben) the right one.
    expect(grid.classes()).toEqual(expect.arrayContaining(['grid', 'grid-flow-col', 'grid-cols-2', 'grid-rows-2']))
    expect(grid.findAll('button').map(button => button.text())).toEqual(['Anna gewinnt 2:0', 'Anna gewinnt 2:1', 'Ben gewinnt 2:0', 'Ben gewinnt 2:1'])
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
    losses: 0,
    points: 3,
    played: 1,
    matchdays: 1,
    open: 2,
    gamesWon: 1,
    gamesLost: 0,
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
      localStorage.removeItem('ygo-queue-table-pinned')
    }
    catch {
      // Without storage there is nothing to clear.
    }
  })

  it('shows the decks of every player next to them, and a dash for a player without one', async () => {
    const component = await mountSuspended(QueueTable, { props: { tournament: tournament('queue') } })

    const decks = component.findAll('[data-testid="queue-table-decks"]').map(cell => cell.text())
    // Separated by a slash and centred in their column (tester feedback, round 9).
    expect(decks).toEqual(['Dunkler Magier / Chaos', '–'])
    expect(component.find('[data-testid="queue-table-decks"]').classes()).toContain('text-center')
  })

  it('puts every number under its own heading', async () => {
    const detail = tournament('rounds')
    detail.queue!.table = [row({ participantId: 'pa', name: 'Anna', place: 4, wins: 7, losses: 2, points: 21, played: 9, matchdays: 6, open: 5, gamesWon: 15, gamesLost: 8 })]
    const component = await mountSuspended(QueueTable, { props: { tournament: detail } })

    const headings = component.findAll('thead th').map(heading => heading.text())
    const cells = component.findAll('tbody tr')[0]!.findAll('td').map(cell => cell.text())
    const under = (heading: string) => cells[headings.indexOf(heading)]
    expect(under('Spieltage')).toBe('6')
    expect(under('Punkte')).toBe('21')
    // Tester feedback, round 12: Wins and Defeats are the duels (games) won and lost, not the matches.
    expect(under('Wins')).toBe('15')
    expect(under('Defeats')).toBe('8')
    expect(under('Diff.')).toBe('+7')
  })

  // Tester feedback, round 12: "Ich brauche nur Spieltage, Punkte, gewonnene Duelle (Wins), verlorene Duelle (Defeats) und Differenz."
  it('has just the Spieltage, the points, the wins, the defeats and the difference, in that order, after the player', async () => {
    const component = await mountSuspended(QueueTable, { props: { tournament: tournament('rounds') } })

    const headings = component.findAll('thead th').map(heading => heading.text())
    expect(headings.slice(0, 7)).toEqual(['#', 'Spieler', 'Spieltage', 'Punkte', 'Wins', 'Defeats', 'Diff.'])
    for (const gone of ['Siege', 'Niederlagen', 'Matches', 'Partien', 'Offen']) {
      expect(headings).not.toContain(gone)
    }
    // Nothing of it is hidden on a phone.
    const classes = component.findAll('thead th').slice(2, 7).map(heading => heading.classes().join(' '))
    expect(classes.every(value => !value.includes('hidden'))).toBe(true)
  })

  it('shows a negative difference with its minus and a level one as 0', async () => {
    const detail = tournament('rounds')
    detail.queue!.table = [
      row({ participantId: 'pa', name: 'Anna', gamesWon: 1, gamesLost: 3 }),
      row({ participantId: 'pb', name: 'Ben', place: 2, gamesWon: 2, gamesLost: 2 }),
    ]
    const component = await mountSuspended(QueueTable, { props: { tournament: detail } })

    const headings = component.findAll('thead th').map(heading => heading.text())
    const column = headings.indexOf('Diff.')
    expect(component.findAll('tbody tr').map(tr => tr.findAll('td')[column]!.text())).toEqual(['-2', '0'])
  })

  it('follows the reader down the page when it is pinned, and scrolls away with the page when it is released', async () => {
    const component = await mountSuspended(QueueTable, { props: { tournament: tournament('queue') } })
    const section = () => component.find('[data-testid="queue-table"]')
    const body = () => component.find('[data-testid="queue-table-body"]')

    // Pinned is the way it comes: stuck to the top, and it scrolls inside so it never covers the page.
    expect(section().classes()).toContain('sticky')
    expect(body().classes()).toContain('overflow-y-auto')
    expect(component.find('[data-testid="queue-table-pin"]').text()).toBe('Tabelle lösen')

    await component.find('[data-testid="queue-table-pin"]').trigger('click')

    // Released: part of the page, every player at once, nothing scrolls inside.
    expect(section().classes()).not.toContain('sticky')
    expect(body().classes()).not.toContain('overflow-y-auto')
    expect(body().classes().join(' ')).not.toContain('max-h')
    expect(component.find('thead').classes()).not.toContain('sticky')
    expect(component.find('[data-testid="queue-table-pin"]').text()).toBe('Tabelle anheften')
    expect(localStorage.getItem('ygo-queue-table-pinned')).toBe('0')

    await component.find('[data-testid="queue-table-pin"]').trigger('click')
    expect(section().classes()).toContain('sticky')
    expect(localStorage.getItem('ygo-queue-table-pinned')).toBe('1')
  })

  it('says so when the pinned table scrolls inside and some players are out of sight, and not when it is released', async () => {
    const component = await mountSuspended(QueueTable, { props: { tournament: tournament('rounds') } })
    const hint = () => component.find('[data-testid="queue-table-scrolls"]')
    const body = component.find('[data-testid="queue-table-body"]').element
    expect(hint().exists()).toBe(false)

    // The table is taller than its box (a layout engine would know; the test says so).
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 500 })
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 300 })
    window.dispatchEvent(new Event('resize'))
    await nextTick()
    expect(hint().exists()).toBe(true)
    expect(hint().text()).toContain('Tabelle lösen')

    await component.find('[data-testid="queue-table-pin"]').trigger('click')
    await nextTick()
    await nextTick()
    expect(hint().exists()).toBe(false)
  })

  it('opens released when it was released before', async () => {
    localStorage.setItem('ygo-queue-table-pinned', '0')
    const component = await mountSuspended(QueueTable, { props: { tournament: tournament('queue') } })

    expect(component.find('[data-testid="queue-table"]').classes()).not.toContain('sticky')
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
