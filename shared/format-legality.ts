// The "Zulässigkeit" filter of the catalog and the inventory (tester feedback, round 14): which cards a rule format
// allows, and in how many copies. The copy limit comes from the rule engine (`maxCopies`, shared/rule-formats.ts): 0 is a
// card the format does not allow (forbidden, or outside what the format's rules let in), 1 and 2 are limited and
// semi-limited, 3 is no restriction. Pure, no Vue, no Drizzle.

export const FORMAT_LEGALITIES = ['legal', 'illegal', 'unlimited', 'semi_limited', 'limited'] as const

export type FormatLegality = typeof FORMAT_LEGALITIES[number]

/** What the filter shows when a format is picked and nothing else: the cards one may play in it. */
export const DEFAULT_FORMAT_LEGALITY: FormatLegality = 'legal'

/** The most copies a format lets in; a card at this limit is not restricted. */
const UNRESTRICTED_COPIES = 3

export function isFormatLegality(value: unknown): value is FormatLegality {
  return typeof value === 'string' && (FORMAT_LEGALITIES as readonly string[]).includes(value)
}

/**
 * Whether a card with the copy limit `maxCopies` passes the filter `legality`:
 * - `legal`: allowed at all (1 to 3 copies)
 * - `illegal`: not allowed (0)
 * - `unlimited`: no restriction (3)
 * - `semi_limited`: 2 copies
 * - `limited`: 1 copy
 */
export function legalityMatches(legality: FormatLegality, maxCopies: number): boolean {
  switch (legality) {
    case 'legal':
      return maxCopies >= 1
    case 'illegal':
      return maxCopies < 1
    case 'unlimited':
      return maxCopies >= UNRESTRICTED_COPIES
    case 'semi_limited':
      return maxCopies === 2
    case 'limited':
      return maxCopies === 1
  }
}
