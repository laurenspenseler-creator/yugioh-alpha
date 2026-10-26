// What "hand traps" means when a rulebook forbids them (ADR 0038). The rule
// engine can't read what a card does, so an imported rulebook that says "no
// hand traps" asks the user which definition to use; each one becomes a list of
// card ids (a `card_status` rule), not a text filter.
//
//  - 'classic-plus': the cards the Classic Plus classification put under rule 4
//    ("a monster effect that can be activated from the hand in the opponent's
//    turn, if it negates or prevents an action or removes a card; effects that
//    work only in the Battle Phase or against battle damage are allowed"),
//    generated with the Classic Plus banlist (scripts/classic-plus/combine.ts).
//  - 'restrictive': every monster whose text says it is used from the hand
//    outside the owner's Main Phase, whatever the effect does. Found by the card
//    text at request time, so new cards are included; it is a heuristic and may
//    contain a card too many or miss one, which the format editor shows by name.

import { and, inArray, isNull, like } from 'drizzle-orm'
import type { useDb } from '../db'
import { catalogCard } from '../db/schema'
import classicPlusHandtrapsJson from './classic-plus-handtraps.json'

type Db = ReturnType<typeof useDb>

export const HANDTRAP_DEFINITIONS = ['classic-plus', 'restrictive'] as const
export type HandtrapDefinition = typeof HANDTRAP_DEFINITIONS[number]

export function isHandtrapDefinition(value: unknown): value is HandtrapDefinition {
  return typeof value === 'string' && (HANDTRAP_DEFINITIONS as readonly string[]).includes(value)
}

/** The card itself leaves the hand as a cost or is used from the hand … */
const FROM_HAND = /\b(?:discard|send|reveal|banish|Tribute)s? this card\b[^.:;]{0,40}\bhand\b|\bdiscard this card\b|\bsend this card from your hand\b|\breveal this card in your hand\b|\bdiscard it\b[^.]{0,30}\bhand\b/i
const SUMMON_FROM_HAND = /Special Summon this card from your hand/i
const QUICK_SUMMON = /Quick Effect|opponent'?s turn|during your opponent/i
/** … at a time that is not the owner's own Main Phase. */
const OUTSIDE_MAIN_PHASE = /Quick Effect|during your opponent'?s (?:Main|Battle|End|Standby|Draw) Phase|during the Battle Phase|during the Damage Step|Damage calculation|(?:When|If) your opponent (?:Normal Summons|Special Summons|Normal or Special Summons|activates|declares|adds|targets|would)|when (?:a|an) (?:opponent'?s )?(?:monster|card|effect|Spell|Trap)|opponent'?s turn|either player'?s turn/i

/** Whether a monster's text says it is used from the hand outside the owner's Main Phase. */
export function playedFromHandOutsideMainPhase(desc: string): boolean {
  return (FROM_HAND.test(desc) || (SUMMON_FROM_HAND.test(desc) && QUICK_SUMMON.test(desc))) && OUTSIDE_MAIN_PHASE.test(desc)
}

/**
 * The ids of the cards a definition covers, without the card of `except`, the
 * one whose English name is exactly that: "außer Kuriboh" takes out Kuriboh, not
 * "Ankuriboh" or "Clear Kuriboh", and nothing at all when the definition
 * doesn't contain a card of that name.
 */
export function handtrapCardIds(db: Db, definition: HandtrapDefinition, except?: string): number[] {
  let cards: Array<{ id: number, name: string }>

  if (definition === 'classic-plus') {
    cards = db
      .select({ id: catalogCard.id, name: catalogCard.name })
      .from(catalogCard)
      .where(inArray(catalogCard.id, classicPlusHandtrapsJson.ids))
      .all()
  }
  else {
    cards = db
      .select({ id: catalogCard.id, name: catalogCard.name, desc: catalogCard.desc })
      .from(catalogCard)
      .where(and(isNull(catalogCard.retiredAt), like(catalogCard.type, '%Monster%')))
      .all()
      .filter(card => playedFromHandOutsideMainPhase(card.desc))
  }

  const needle = except?.trim().toLowerCase()
  if (needle) {
    cards = cards.filter(card => card.name.toLowerCase() !== needle)
  }

  return cards.map(card => card.id).sort((a, b) => a - b)
}
