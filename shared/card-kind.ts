// The grouped "Kartenart" filter (catalog, inventory, the deck builder's card
// source): a card's kind is its frame (`shared/card-frame.ts`), not its exact
// `type` line. "Effekt" therefore covers every monster with an effect frame
// (Flip, Tuner, Spirit, Toon, Union, Gemini, ...), which the exact type filter
// ("Effect Monster" only) cannot. Pendulum is the second half of a frame, but
// as a kind it stands on its own (tester feedback, round 12: "Effekt" must mean
// plain Effect Monsters, Pendulum ones are picked as "Pendel"): a Pendulum
// monster of any frame has the kind "Pendel" only, so the kinds divide the
// cards and every card is in exactly one of them. The filter values are
// these keys; a card matches when it has any selected kind. Skill Cards have
// no kind.
import { cardFrame } from './card-frame'

export const CARD_KINDS = [
  'normal',
  'effect',
  'ritual',
  'fusion',
  'synchro',
  'xyz',
  'link',
  'pendulum',
  'token',
  'spell',
  'trap',
] as const

export type CardKind = typeof CARD_KINDS[number]

export function isCardKind(value: string): value is CardKind {
  return (CARD_KINDS as readonly string[]).includes(value)
}

/**
 * What kind of Spell or Trap a card is (Quick-Play, Continuous, Counter, ...) is kept in `race`, next to the races of the
 * monsters. These are the `race` values that belong to Spells and to Traps, so the filters can offer them where they
 * mean something (a Spell has no attribute, no level and no monster race).
 */
export const SPELL_RACES = ['Normal', 'Quick-Play', 'Continuous', 'Equip', 'Field', 'Ritual'] as const
export const TRAP_RACES = ['Normal', 'Continuous', 'Counter'] as const

/** Every `race` value that is the subtype of a Spell or a Trap. */
export const SPELL_TRAP_RACES: readonly string[] = [...new Set<string>([...SPELL_RACES, ...TRAP_RACES])]

/** The subtypes of the Spells and/or Traps among `kinds`, each once, in the order of the game's own list. */
export function spellTrapRaces(kinds: readonly CardKind[]): string[] {
  const wanted = [...(kinds.includes('spell') ? SPELL_RACES : []), ...(kinds.includes('trap') ? TRAP_RACES : [])]
  return [...new Set<string>(wanted)]
}

/**
 * The kind of one card (a list of one, or none), computed in code with the same rules as the SQL
 * filter (`server/utils/card-kind-sql.ts`); `[]` for a Skill Card or a card
 * without a type. A Pendulum monster is "pendulum" whatever its frame.
 */
export function cardKinds(card: { type?: string | null, frameType?: string | null }): CardKind[] {
  const frame = cardFrame(card)
  if (!frame) {
    return []
  }
  if (frame.pendulum) {
    return ['pendulum']
  }
  return isCardKind(frame.frame) ? [frame.frame] : []
}
