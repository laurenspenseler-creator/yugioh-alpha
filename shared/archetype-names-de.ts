// German names of the "Deckthemen" (the archetypes), tester feedback, round 15: "Gib mir die Deckthemen auch auf Deutsch", and
// round 16: "Die Deckthemen passen immer noch nicht". The official German name of each archetype comes from Yugipedia (the
// `German name` of the archetype's page, `scripts/archetypes/build.ts`, ADR 0049): about 760 of the 870 archetypes have one. An
// archetype without one (it came out in the OCG only, or the wiki has none) stays in English. The filter value is always the
// English name, only the label follows the card language.
//
// Two archetypes can have one German name ("Magna Warrior" and "Magnet Warrior" are both "Magnetkrieger"): the menu shows them
// as one entry (CardArchetypeFilter).
import namesDe from './data/archetype-names-de.json'

export const ARCHETYPE_NAMES_DE: Readonly<Record<string, string>> = namesDe

/**
 * The name of an archetype in the card language: the German one where there is one and the card language is German, else the
 * English name (also the filter value, which never changes).
 */
export function archetypeName(archetype: string, cardLocale: string): string {
  return cardLocale === 'de' ? ARCHETYPE_NAMES_DE[archetype] ?? archetype : archetype
}
