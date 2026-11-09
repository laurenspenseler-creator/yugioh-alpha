import { describe, expect, it } from 'vitest'
import banlist from '../../server/utils/classic-plus-banlist.json'
import overrides from '../../scripts/classic-plus/overrides.json'
import { CLASSIC_PLUS_FORBIDDEN_TYPES } from '../../shared/classic-plus'

// Classic Plus v3.1 (ADR 0045): the card list of the change block ("Teil 3") and the corrections of "Teil 2" are the
// final limits of those cards in the generated banlist, whatever the classification says. The ids are the catalog's.

type Limit = 0 | 1 | 2 | 3

function limitOf(id: number): Limit {
  if (banlist.forbidden.includes(id)) {
    return 0
  }
  if (banlist.limited.includes(id)) {
    return 1
  }
  if (banlist.semiLimited.includes(id)) {
    return 2
  }
  return 3
}

/** [catalog id, official German name, limit in v3.1] */
const CARD_LIST: Array<[number, string, Limit]> = [
  // What moved.
  [86346643, 'Regenbogen-Neos', 2],
  [40854197, 'Elementar-HELD Absoluter Nullpunkt', 1],
  [79206925, 'Grabwächters Übernatürlicher', 2],
  [90434657, 'Pharaonengräber im Tal der Toten', 2],
  [20654247, 'Blauäugiger Chaosdrache', 1],
  [23015896, 'Feuerkönig Hochavatar Garunix', 1],
  [41578483, 'Millenniumäugiges Opfer', 1],
  [63519819, 'Tausendäugiges Opfer', 1],
  [70551291, 'Schwarz Glänzender Soldat - Legendärer Schwertkämpfer', 1],
  [59400890, 'Dunkler Magier der Zerstörung', 2],
  [90488465, 'Der Chaosschöpfer', 2],
  [82301904, 'Chaos-Imperatordrache - Gesandter des Endes', 2],
  [93920745, 'Pinguinsoldat', 2],
  // Unchanged, but now covered by a rule.
  [37630732, 'Kraftbündnis', 2],
  [23171610, 'Begrenzer-Entferner', 2],
  [22842126, 'Pantheismus der Monarchen', 2],
  [4929256, 'Möbius der Frostmonarch', 2],
  [60461804, 'Schicksals-HELD - Destroyer Phoenix Enforcer', 2],
  [31305911, 'Marshmallon', 2],
  [63176202, 'Großer Shogun Shien', 2],
  [47355498, 'Tal der Toten', 2],
  [70000776, 'Verborgene Tempel im Tal der Toten', 2],
  [58481572, 'Maskierter HELD Dunkles Gesetz', 2],
  // Unchanged and checked.
  [34966096, 'Chaosbetrüger', 1],
  [23020408, 'Seelendiener', 1],
  [37576645, 'Tollkühne Gier', 1],
  [19523799, 'Ookazi', 1],
  [87910978, 'Gehirnkontrolle', 1],
  [43228023, 'Blauäugiger alternativer ultimativer Drache', 1],
  [56532353, 'Neo-Blauäugiger ultimativer Drache', 1],
  [83555666, 'Ring der Zerstörung', 3],
  [16762927, 'Grabwächters Diener', 0],
]

describe('Classic Plus v3.1 card list', () => {
  it.each(CARD_LIST)('%i %s is at limit %i', (id, _name, limit) => {
    expect(limitOf(id)).toBe(limit)
  })

  it('is the final word: every override with a limit agrees with the generated banlist', () => {
    const withLimit = Object.entries(overrides).filter(([, override]) => 'maxCopies' in override)

    expect(withLimit.length).toBe(CARD_LIST.length)
    for (const [id, override] of withLimit) {
      expect(limitOf(Number(id)), `${id}: ${(override as { note: string }).note}`).toBe((override as { maxCopies: Limit }).maxCopies)
    }
    // The table above and the overrides are the same list.
    expect(new Set(CARD_LIST.map(([id]) => String(id)))).toEqual(new Set(withLimit.map(([id]) => id)))
  })

  it('forbids the Pendulum monster "Chaos-Imperator, der Drache des Armageddon" by rule 1 (K1)', () => {
    // The catalog has it as a "Pendulum Effect Monster"; rule 1's card-type filter covers that type, so it is not on the list.
    expect(CLASSIC_PLUS_FORBIDDEN_TYPES).toContain('Pendulum Effect Monster')
    expect(limitOf(4538826)).toBe(3)
  })

  it('applies rule 8 to Extra Deck monsters now (Ä1): the exemption is gone, and they are no longer unlimited', () => {
    // Fusion Monsters that can remove more than 1 card of the opponent: restricted at least to 2 (a body lifts rule 8 from 1
    // to 2, as with Regenbogen-Neos, unless the card has no real answer).
    const fusionWithMassRemoval: Array<[number, string]> = [
      [84433295, 'Quintet Magician'],
      [87751584, 'Gatling Dragon'],
      [49352945, 'Elemental HERO Storm Neos'],
      [90050480, 'Elemental HERO Cosmo Neos'],
      [85059922, 'Master of Chaos'],
    ]

    for (const [id, name] of fusionWithMassRemoval) {
      expect(limitOf(id), name).toBeLessThanOrEqual(2)
    }
  })

  it('has the tiers of Ä2 in the generated list for a card that was re-checked: a body lifts rule 8 to 2', () => {
    // Elemental HERO Storm Neos destroys all Spells and Traps on the field and is a body the opponent can attack.
    expect(limitOf(49352945)).toBe(2)
    // Quintet Magician has a body, but it cannot be destroyed by card effects, which is enough for rule 9(a): limit 1.
    expect(limitOf(84433295)).toBe(1)
  })

  it('forbids Mirror Force Dragon: it destroys all of the opponent\'s cards each time one of yours is targeted (frequency)', () => {
    expect(limitOf(84687358)).toBe(0)
  })
})
