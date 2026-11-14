import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { USelect } from '#components'
import QueueFreeBoard from '~/components/tournaments/QueueFreeBoard.vue'
import QueueLeaveDialog from '~/components/tournaments/QueueLeaveDialog.vue'
import type { QueueDuelDto, QueueTableRowDto, TournamentDetail } from '~~/shared/tournaments'
import { optionLabels, selectWithOption } from './fixtures/select-wrapper'
import type { SelectItem, SelectWrapper } from './fixtures/select-wrapper'

// Registered before the auto-unmount: afterEach hooks run in reverse, so the pages are unmounted first, then <body> is emptied.
afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

enableAutoUnmount(afterEach)

function row(id: string, name: string, patch: Partial<QueueTableRowDto> = {}): QueueTableRowDto {
  return {
    participantId: id,
    name,
    place: 1,
    wins: 0,
    losses: 0,
    points: 0,
    played: 0,
    matchdays: 0,
    open: 0,
    gamesWon: 0,
    gamesLost: 0,
    left: false,
    tied: false,
    tableNumber: null,
    queuePosition: null,
    ...patch,
  }
}

function duel(id: string, patch: Partial<QueueDuelDto>): QueueDuelDto {
  return {
    id,
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
    tableNumber: 1,
    startedAt: null,
    endedAt: null,
    queuePosition: null,
    bestOf: 3,
    ...patch,
  }
}

/**
 * A Spielabend in progress: Anna and Ben are playing a best of 3, Cara and Dirk have played a single game, Eva has left, and
 * Fritz has not played yet. So Cara, Dirk and Fritz are free.
 */
function evening(options: { role?: 'organizer' | 'participant', status?: 'running' | 'finished', duels?: QueueDuelDto[] } = {}): TournamentDetail {
  const duels = options.duels ?? [
    duel('d1', {}),
    duel('d2', { status: 'done', participantAId: 'pc', participantAName: 'Cara', participantBId: 'pd', participantBName: 'Dirk', winnerParticipantId: 'pc', bestOf: 1, tableNumber: 2 }),
  ]
  return {
    id: 't-1',
    role: options.role ?? 'organizer',
    status: options.status ?? 'running',
    selfParticipantId: null,
    participants: ['Anna', 'Ben', 'Cara', 'Dirk', 'Eva', 'Fritz'].map((name, index) => ({ id: `p${'abcdef'[index]}`, name, decks: [] })),
    queue: {
      mode: 'free',
      flow: 'rounds',
      bestOf: 1,
      tables: 4,
      duelMinutes: 30,
      duelsDone: duels.filter(candidate => candidate.status === 'done').length,
      duelsTotal: duels.length,
      remainingMinutes: null,
      table: [
        row('pa', 'Anna', { tableNumber: 1 }),
        row('pb', 'Ben', { place: 2, tableNumber: 1 }),
        row('pc', 'Cara', { place: 3, points: 3 }),
        row('pd', 'Dirk', { place: 4 }),
        row('pf', 'Fritz', { place: 5 }),
        row('pe', 'Eva', { place: null, left: true }),
      ],
      duels,
      pendingRematches: [],
      undecided: [],
      dropOptions: {},
      firstPlaceTie: [],
      canRecompute: false,
      canExtend: false,
    },
  } as unknown as TournamentDetail
}

function buttonWith(component: { findAll: (selector: string) => Array<{ text: () => string, trigger: (event: string) => Promise<void> }> }, text: string) {
  const button = component.findAll('button').find(candidate => candidate.text().includes(text))
  if (!button) {
    throw new Error('no button ' + text)
  }
  return button
}

/** The three selects of the pairing form, in the order of the page: player 1, player 2, "gespielt wird". */
async function mountBoard(detail: TournamentDetail) {
  const component = await mountSuspended(QueueFreeBoard, { props: { tournament: detail } })
  const selects = component.findAllComponents(USelect) as unknown as SelectWrapper[]
  return { component, selects }
}

const items = (select: SelectWrapper) => select.props('items') as Array<SelectItem & { disabled?: boolean }>

describe('the board of a Spielabend', () => {
  it('has the standings, the pairing form, the running duels and the played ones', async () => {
    const { component } = await mountBoard(evening())

    expect(component.find('[data-testid="queue-table"]').exists()).toBe(true)
    expect(component.find('[data-testid="free-pair"]').exists()).toBe(true)
    expect(component.find('[data-testid="free-open"]').text()).toContain('Anna')
    expect(component.find('[data-testid="free-open"]').text()).toContain('Best of 3')
    expect(component.find('[data-testid="free-done"]').text()).toContain('Cara')
    expect(component.find('[data-testid="free-done"]').text()).toContain('Einzelduell')
    // No schedule and no tables: the Spielabend says what has been played.
    expect(component.text()).toContain('1 Duell gespielt')
    expect(component.text()).not.toContain('Zeitplan')
  })

  it('offers the players who have not left in the drop-downs, the ones in a duel greyed out', async () => {
    const { selects } = await mountBoard(evening())

    const [playerA, playerB] = selects
    expect(optionLabels(playerA!)).toEqual(['Anna', 'Ben', 'Cara', 'Dirk', 'Fritz'])
    expect(items(playerA!).filter(item => item.disabled).map(item => item.label)).toEqual(['Anna', 'Ben'])
    expect(optionLabels(playerB!)).toEqual(['Anna', 'Ben', 'Cara', 'Dirk', 'Fritz'])
  })

  it('takes the player chosen in one drop-down out of the other, so nobody plays himself', async () => {
    const { selects } = await mountBoard(evening())
    const [playerA, playerB] = selects

    await playerA!.setValue('pc')

    expect(optionLabels(playerB!)).toEqual(['Anna', 'Ben', 'Dirk', 'Fritz'])
    expect(selectWithOption([playerB!], 'pc')).toBeUndefined()
  })

  it('starts a duel with the two players and the best-of chosen for it, and clears the players', async () => {
    const detail = evening()
    const fetchSpy = vi.fn(async (_url: string, _options?: unknown) => detail)
    vi.stubGlobal('$fetch', fetchSpy)
    const { component, selects } = await mountBoard(detail)
    const [playerA, playerB, playedAs] = selects

    const start = component.find('[data-testid="free-start"]')
    expect(start.attributes('disabled')).toBeDefined()
    await playerA!.setValue('pc')
    expect(component.find('[data-testid="free-start"]').attributes('disabled')).toBeDefined()
    await playerB!.setValue('pd')
    await playedAs!.setValue(3)
    expect(component.find('[data-testid="free-start"]').attributes('disabled')).toBeUndefined()

    await component.find('[data-testid="free-start"]').trigger('click')
    await flushPromises()

    const call = fetchSpy.mock.calls.find(entry => entry[0] === '/api/tournaments/t-1/free-duels')!
    expect(call[1]).toMatchObject({ method: 'POST', body: { participantAId: 'pc', participantBId: 'pd', bestOf: 3 } })
    expect(component.emitted('updated')).toHaveLength(1)
    expect(playerA!.props('modelValue')).toBeUndefined()
    expect(playerB!.props('modelValue')).toBeUndefined()
    // What is played stays: an evening is mostly the same kind of duel.
    expect(playedAs!.props('modelValue')).toBe(3)
  })

  it('shows the answer of the server when a duel cannot be started, and keeps the players', async () => {
    vi.stubGlobal('$fetch', vi.fn(async () => {
      throw { data: { data: { code: 'invalid_pair' } } }
    }))
    const { component, selects } = await mountBoard(evening())
    const [playerA, playerB] = selects

    await playerA!.setValue('pc')
    await playerB!.setValue('pd')
    await component.find('[data-testid="free-start"]').trigger('click')
    await flushPromises()

    expect(component.find('[role="alert"]').text()).toBe('Wähle zwei verschiedene Teilnehmer, die noch dabei sind.')
    expect(component.emitted('updated')).toBeUndefined()
    expect(playerA!.props('modelValue')).toBe('pc')
  })

  it('says so when fewer than two players are free', async () => {
    const busy = evening({
      duels: [
        duel('d1', {}),
        duel('d2', { participantAId: 'pc', participantAName: 'Cara', participantBId: 'pd', participantBName: 'Dirk', tableNumber: 2 }),
      ],
    })
    const some = await mountBoard(evening())
    const none = await mountBoard(busy)

    expect(some.component.find('[data-testid="free-no-players"]').exists()).toBe(false)
    expect(none.component.find('[data-testid="free-no-players"]').text()).toContain('weniger als zwei Teilnehmer')
  })

  it('enters the result of a best-of-3 duel with the score, and of a single game with the winner', async () => {
    const duels = [
      duel('d1', {}),
      duel('d3', { participantAId: 'pc', participantAName: 'Cara', participantBId: 'pf', participantBName: 'Fritz', tableNumber: 2, bestOf: 1 }),
    ]
    const detail = evening({ duels })
    const fetchSpy = vi.fn(async (_url: string, _options?: unknown) => detail)
    vi.stubGlobal('$fetch', fetchSpy)
    const { component } = await mountBoard(detail)

    await buttonWith(component, 'Anna gewinnt 2:1').trigger('click')
    await buttonWith(component, 'Fritz hat gewonnen').trigger('click')
    await flushPromises()

    const calls = fetchSpy.mock.calls.filter(entry => String(entry[0]).endsWith('/result'))
    expect(calls.map(entry => entry[0])).toEqual(['/api/tournaments/t-1/duels/d1/result', '/api/tournaments/t-1/duels/d3/result'])
    expect(calls[0]![1]).toMatchObject({ method: 'POST', body: { winnerParticipantId: 'pa', gamesA: 2, gamesB: 1 } })
    expect(calls[1]![1]).toMatchObject({ method: 'POST', body: { winnerParticipantId: 'pf' } })
  })

  it('takes back a running duel', async () => {
    const detail = evening()
    const fetchSpy = vi.fn(async (_url: string, _options?: unknown) => detail)
    vi.stubGlobal('$fetch', fetchSpy)
    const { component } = await mountBoard(detail)

    await component.find('[data-testid="queue-duel-remove"]').trigger('click')
    await flushPromises()

    const call = fetchSpy.mock.calls.find(entry => entry[0] === '/api/tournaments/t-1/free-duels/d1')!
    expect(call[1]).toMatchObject({ method: 'DELETE' })
    expect(component.emitted('updated')).toHaveLength(1)
  })

  it('lets a finished duel be corrected, but there is nothing to take back', async () => {
    const { component } = await mountBoard(evening({ duels: [duel('d2', { status: 'done', winnerParticipantId: 'pa', bestOf: 1 })] }))

    expect(component.find('[data-testid="free-done"]').text()).toContain('Ergebnis ändern')
    expect(component.find('[data-testid="queue-duel-remove"]').exists()).toBe(false)
  })

  it('only shows the evening to a participant: no pairing form, no buttons', async () => {
    const { component } = await mountBoard(evening({ role: 'participant' }))

    expect(component.find('[data-testid="free-pair"]').exists()).toBe(false)
    expect(component.find('[data-testid="free-open"]').text()).toContain('Anna')
    expect(component.find('[data-testid="queue-duel-scores"]').exists()).toBe(false)
    expect(component.find('[data-testid="queue-duel-remove"]').exists()).toBe(false)
  })

  it('has no pairing form and no buttons once the evening is over', async () => {
    const { component } = await mountBoard(evening({ status: 'finished' }))

    expect(component.find('[data-testid="free-pair"]').exists()).toBe(false)
    expect(component.find('[data-testid="queue-duel-remove"]').exists()).toBe(false)
  })

  it('says what there is to see before the first duel', async () => {
    const { component } = await mountBoard(evening({ duels: [] }))

    expect(component.text()).toContain('Gerade läuft kein Duell.')
    expect(component.text()).toContain('Noch kein Duell gespielt.')
  })
})

describe('the leave dialog of a Spielabend', () => {
  // UModal teleports its content to <body>.
  const dialogText = () => new DOMWrapper(document.body).text()

  async function openFor(detail: TournamentDetail) {
    await mountSuspended(QueueLeaveDialog, { props: { tournament: detail, participantId: 'pd', mode: 'leave', open: true } })
    await flushPromises()
  }

  it('says what the options do without promising replacement matches, which there are none of', async () => {
    const detail = evening()
    detail.queue!.dropOptions = { pd: { A: true, B: true } }

    await openFor(detail)

    expect(dialogText()).toContain('Alle Duelle der Person werden gestrichen, auch die gespielten.')
    expect(dialogText()).toContain('Die gespielten Duelle bleiben. Die Person wird nicht mehr gepaart.')
    expect(dialogText()).not.toContain('Ersatzmatch')
  })

  it('keeps the texts with the replacement matches for every other mode', async () => {
    const detail = evening()
    detail.queue!.mode = 'swiss'
    detail.queue!.dropOptions = { pd: { A: true, B: true } }

    await openFor(detail)

    expect(dialogText()).toContain('Ersatzmatch')
    expect(dialogText()).not.toContain('Die Person wird nicht mehr gepaart.')
  })
})