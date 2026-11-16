import { describe, expect, it } from 'vitest'
import banlist from '../../server/utils/classic-plus-banlist.json'
import cardList from '../../scripts/classic-plus/card-list-v31.json'
import handtraps from '../../server/utils/classic-plus-handtraps.json'
import overrides from '../../scripts/classic-plus/overrides.json'
import { CLASSIC_PLUS_FORBIDDEN_TYPES, CLASSIC_PLUS_STEPS, hitLimit } from '../../shared/classic-plus'

// Classic Plus v3.1 (ADR 0045, 0050): the card list of the change block ("Teil 3") and the corrections of "Teil 2" are the
// final limits of those cards in the generated banlist, whatever the classification says. The ids are the catalog's. The list of 16\n// November 2026 is the complete one (119 cards named by the authors); 30 more are the cards the new rules 4 (Spells and Traps from the\n// hand, Ä17) and 12 (alternative win conditions, Ä12) hit by their wording ("source": "rule-text"): the authors confirm those.

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

/** [catalog id, German name, limit in v3.1]: the whole card list (scripts/classic-plus/card-list-v31.json, ADR 0045 and 0050). */
const CARD_LIST: Array<[number, string, Limit]> = cardList.cards.map(card => [card.id, card.name, card.limit as Limit])

/**
 * The rule authors' test table (tester feedback, round 12: "Das Format weist noch einige Fehler auf"): seven pairs of
 * cards, each pair testing one point of the rules, with the limit each card must have. [id, name, limit, id, name, limit,
 * what it checks]
 */
const TEST_TABLE: Array<[number, string, Limit, number, string, Limit, string]> = [
  [30241314, 'Makrokosmos', 0, 58481572, 'Maskierter HELD Dunkles Gesetz', 2, 'the same redirect effect: a Continuous Trap without a body (step 4) against a monster with a body (step 2)'],
  [24094653, 'Polymerisation', 3, 48130397, 'Superpolymerisation', 1, 'the same mechanic: the own material does not count, the opponent\'s does'],
  [20654247, 'Blauäugiger Chaosdrache', 1, 79206925, 'Grabwächters Übernatürlicher', 2, 'both rule 9(a): unconditional against conditional ("as long as Necrovalley is on the field")'],
  [19523799, 'Ookazi', 1, 83555666, 'Ring der Zerstörung', 3, 'both do damage: primary against a by-product of a destroyed monster'],
  [87910978, 'Gehirnkontrolle', 1, 64631466, 'Aufgegeben', 3, 'both take a monster: circumventing the price against the full Ritual price'],
  [57774843, 'Urteilsdrache', 0, 86346643, 'Regenbogen-Neos', 2, 'both mass removal: repeatable in the same turn against a hard "once per turn"'],
  [63519819, 'Tausendäugiges Opfer', 1, 63176202, 'Großer Shogun Shien', 2, 'both a monster with a lock: the lock makes its own answer worthless against a lock that lets it through'],
]

/** The card of the test table that needs a fixed limit of its own: no rule step gives the authors' answer. */
const TEST_TABLE_OVERRIDES = [64631466]

describe('Classic Plus v3.1 card list', () => {
  it.each(CARD_LIST)('%i %s is at limit %i', (id, _name, limit) => {
    expect(limitOf(id)).toBe(limit)
  })

  it('is the final word: every override with a limit agrees with the generated banlist', () => {
    const withLimit = Object.entries(overrides).filter(([, override]) => 'maxCopies' in override)

    for (const [id, override] of withLimit) {
      expect(limitOf(Number(id)), `${id}: ${(override as { note: string }).note}`).toBe((override as { maxCopies: Limit }).maxCopies)
    }
    // The card list above (and the one card of the test table below) and the overrides are the same list.
    expect(new Set([...CARD_LIST.map(([id]) => String(id)), ...TEST_TABLE_OVERRIDES.map(String)])).toEqual(new Set(withLimit.map(([id]) => id)))
  })

  it('forbids the Pendulum monster "Chaos-Imperator, der Drache des Armageddon" by rule 1 (K1)', () => {
    // The catalog has it as a "Pendulum Effect Monster"; rule 1's card-type filter covers that type, and since the list of 16 November
    // names it, it is on the banlist as forbidden too.
    expect(CLASSIC_PLUS_FORBIDDEN_TYPES).toContain('Pendulum Effect Monster')
    expect(limitOf(4538826)).toBe(0)
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

describe('Classic Plus: the rule authors\' test table (round 12)', () => {
  const cards = TEST_TABLE.flatMap(([idA, nameA, limitA, idB, nameB, limitB, checks]) => [
    [idA, nameA, limitA, checks] as const,
    [idB, nameB, limitB, checks] as const,
  ])

  it.each(cards)('%i %s is at limit %i (%s)', (id, _name, limit) => {
    expect(limitOf(id)).toBe(limit)
  })

  it('has fixed limits only where no rule step gives the answer', () => {
    for (const id of TEST_TABLE_OVERRIDES) {
      expect(overrides[String(id) as keyof typeof overrides], String(id)).toBeDefined()
    }
    // Everything else of the table comes out of the rules: Makrokosmos is forbidden by its hit, Superpolymerisation is 1 by its traits.
    for (const [id] of cards.filter(([id]) => !TEST_TABLE_OVERRIDES.includes(id) && !CARD_LIST.some(([listed]) => listed === id))) {
      expect(overrides[String(id) as keyof typeof overrides], String(id)).toBeUndefined()
    }
  })

  // Row 1, ruling 37: a lasting redirect of the cards that go to the Graveyard restricts moving cards between zones, so it is
  // a floodgate (rule 3). The same sentence on a card of any kind gets the limit of its step.
  it('treats the same redirect effect alike on every card that has it', () => {
    // On a monster the opponent can attack (step 2): 2 copies, as Masked HERO Dark Law.
    expect(limitOf(61528025), 'Verbanner des Lichts').toBe(2)
    expect(limitOf(94853057), 'Verbanner des Strahlens').toBe(2)
    // On a Spell/Trap without a body (step 4): forbidden, as Macro Cosmos; Dimensional Fissure only reaches monsters (step 3).
    expect(limitOf(66100045), 'Auswanderungsstopp').toBe(0)
    expect(limitOf(81674782), 'Dimensionsriss').toBe(1)
    // Not a lasting restriction: one turn only, the controller's own Graveyard only, the battles of one card only.
    expect(limitOf(31849106), 'Boden einer anderen Dimension').toBe(3)
    expect(limitOf(6500778), 'Chaos Destillation').toBe(3)
    expect(limitOf(42233477), 'Kampfwachen-Wut').toBe(3)
    expect(limitOf(12385638), 'Kozmotrauer').toBe(3)
  })

  // Row 2, ruling 38: an effect that cannot be responded to has no real answer, so a tiered hit stays at 1.
  it('keeps an effect that cannot be responded to at 1 where it would be 2 otherwise', () => {
    for (const [id, name] of [
      [48130397, 'Superpolymerisation'],
      [44886582, 'Super-Duper-Polymerisation'],
      [76647978, 'Ultra-Polymerisation'],
      [90050480, 'Elementar-HELD Kosmo Neos'],
    ] as const) {
      expect(limitOf(id), name).toBe(1)
    }
    // The plain Polymerisation has no mass removal at all.
    expect(limitOf(24094653)).toBe(3)
  })
})

// The hand-over of 16 November 2026 (ADR 0050): the complete card list and the rules Ä6 to Ä18.
describe('Classic Plus: the hand-over of 16 November 2026', () => {
  const byName = (name: string) => cardList.cards.find(card => card.name === name)!

  it('has the 119 cards the authors named, and the cards the new rules hit by their wording flagged for them to confirm', () => {
    expect(cardList.cards.filter(card => card.source === 'list')).toHaveLength(119)
    const byRule = cardList.cards.filter(card => card.source === 'rule-text')
    expect(byRule.length).toBeGreaterThan(0)
    // Each of them names the rule and says it is for the authors to confirm.
    for (const card of byRule) {
      expect(overrides[String(card.id) as keyof typeof overrides]?.note, card.name).toContain('For the rule authors to confirm')
    }
    expect(new Set(cardList.cards.map(card => card.id)).size).toBe(cardList.cards.length)
  })

  it('has the Exodia complex at limit 1: the five parts, Auslöschen!!!, its Blaze, Millennium Ankh, the Incarnations, Necross and the Defender', () => {
    for (const name of ['Exodia, die Verbotene', 'Rechter Arm der Verbotenen', 'Linker Arm der Verbotenen', 'Rechtes Bein der Verbotenen', 'Linkes Bein der Verbotenen', 'Auslöschen!!!', 'Auslöschen!!!-Lohe', 'Millenniums-Anch', 'Inkarnation der legendären Exodia', 'Inkarnation der unaufhaltbaren Exodia', 'Exodia Necross', 'Exodia, die legendäre Verteidigerin']) {
      expect(limitOf(byName(name).id), name).toBe(1)
    }
    // "Vertrag mit Exodia" was decided to stay unlimited.
    expect(limitOf(byName('Vertrag mit Exodia').id)).toBe(3)
  })

  it('treats a Trap Card that can be activated from the hand as a hand trap (Ä17): Unendliche Unbeständigkeit is forbidden', () => {
    expect(limitOf(10045474)).toBe(0)
    expect(handtraps.ids).toContain(10045474)
    // Those among them that negate or remove something are forbidden too, as the rule says ...
    for (const [id, name] of [[14883228, 'Taifun'], [23002292, 'Roter Neustart'], [58053438, 'Lieder der Beherrscher'], [97045737, 'Dominus-Säuberung']] as const) {
      expect(limitOf(id), name).toBe(0)
      expect(handtraps.ids, name).toContain(id)
    }
    // ... and one that neither negates nor removes anything is not forbidden by rule 4 (NEXT summons, Tachyon Spiral Galaxy protects).
    expect(limitOf(74414885), 'NEXT').toBeGreaterThan(0)
    expect(limitOf(89789152), 'Tachyonen-Spiralgalaxie').toBeGreaterThan(0)
    // A Spell that is activated from the hand in the own turn only is no hand trap.
    expect(limitOf(2295831), 'Symbol der Freundschaft').toBe(3)
  })

  it('limits the cards with an alternative win condition to 1, and forbids the one nothing can interrupt (Ä12)', () => {
    // Destiny Board and its Spirit Messages, Exodius, Jackpot 7: limit 1. Final Countdown is a Normal Spell: nothing stays on the field.
    for (const [id, name] of [[94212438, 'Schicksalstafel'], [31893528, 'Geisternachricht I'], [67287533, 'Geisternachricht N'], [94772232, 'Geisternachricht A'], [30170981, 'Geisternachricht L'], [13893596, 'Exodius'], [81171949, 'Jackpot-7']] as const) {
      expect(limitOf(id), name).toBe(1)
    }
    expect(limitOf(95308449), 'Letzter Countdown').toBe(0)
    expect(limitOf(8062132), 'Vennominaga').toBe(0)
    // Rule 12 part 2: what searches or places the parts of Destiny Board by name.
    expect(limitOf(14386013), 'Beherrschung des dunklen Geistes').toBe(1)
    expect(limitOf(40771118), 'Verhängnisvolle Strafe').toBe(1)
  })

  it('moves what Ä7, Ä10, Ä11, Ä13, Ä15 and Ä18 decide: the Cannon cards, the Duo, Neos\' Spirit, the June monsters of 7(e)', () => {
    expect(limitOf(99877698), 'Grabwächters Kanonenträger').toBe(1)
    expect(limitOf(11384280), 'Kanonensoldat').toBe(1)
    expect(limitOf(44763025), 'Verbrecher-Duo').toBe(1)
    expect(limitOf(13256226), 'Elementar-HELD Geist von Neos').toBe(1)
    expect(limitOf(81843628), 'Nadelwurm').toBe(1)
    for (const [id, name] of [[97017120, 'Riesenratte'], [24317029, 'Grabwächters Spion'], [57839750, 'Mutter Grizzly'], [95956346, 'Glänzender Elf (Strahlender Engel)'], [60806437, 'UFO-Schildkröte'], [77044671, 'Pyramidenschildkröte']] as const) {
      expect(limitOf(id), name).toBe(2)
    }
  })

  it('keeps the cards that were checked and found unlimited unlimited', () => {
    for (const card of cardList.cards.filter(card => card.limit === 3)) {
      expect(limitOf(card.id), card.name).toBe(3)
    }
    expect(cardList.cards.filter(card => card.limit === 3).length).toBeGreaterThan(20)
  })

  // Teil 5 of the hand-over, "Testliste für Alpha": the pairs look alike and have different answers (the seven first ones are the
  // test table above); the eighth pair and the single cases.
  it('answers the eighth pair and the single cases of the test list', () => {
    expect([limitOf(48130397), limitOf(44763025)], 'Superpolymerisation / Verbrecher-Duo').toEqual([1, 1])
    for (const [id, name, limit] of [
      [4538826, 'Chaos-Imperator, der Drache des Armageddon', 0],
      [58921041, 'Antimagischer Duft', 0],
      [16762927, 'Grabwächters Diener', 0],
      [10045474, 'Unendliche Unbeständigkeit', 0],
      [24317029, 'Grabwächters Spion', 2],
      [97017120, 'Riesenratte', 2],
      [81843628, 'Nadelwurm', 1],
    ] as const) {
      expect(limitOf(id), name).toBe(limit)
    }
  })

  it('has the steps 7e and 12, 7e tiered like the other Preisumgehung rules', () => {
    const codes = CLASSIC_PLUS_STEPS.map(step => step.code)
    expect(codes).toContain('7e')
    expect(codes).toContain('12')
    // A body lifts it to 2, no real answer keeps it at 1.
    expect(hitLimit('7e', 1, ['body'])).toBe(2)
    expect(hitLimit('7e', 1, ['body', 'noanswer'])).toBe(1)
    expect(hitLimit('12', 1, ['body'])).toBe(1)
  })
})