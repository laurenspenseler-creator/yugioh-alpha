// Classic Plus: rule 1's card types and frame types, and the rule steps a card
// can hit with the copy limit each one sets. Shared by the built-in format
// (server/utils/rule-formats.ts) and the classification scripts
// (scripts/classic-plus/), which turn the steps into the Classic Plus banlist.
// Dependency-free on purpose: the scripts import it under plain Node type
// stripping.
//
// See docs/adr/0022-classic-plus-format.md.

export interface ClassicPlusStep {
  /** Rule and sub-step as the rulebook numbers it, e.g. `3.2` or `9a`. */
  code: string
  maxCopies: 0 | 1 | 2
  /** For review.csv and the script's summary. */
  label: string
}

/**
 * Every step that puts cards on the banlist, in rulebook order. Rule 1 is not
 * listed: it is a card-type filter. A card's banlist status is the strictest
 * limit of its steps. The numbers are the rulebook's adjustable values
 * ("Stellschrauben") — changing one here and rerunning combine.ts changes
 * the format without classifying anything again.
 */
export const CLASSIC_PLUS_STEPS: ClassicPlusStep[] = [
  { code: '2', maxCopies: 0, label: 'Rule 2: mentions Synchro, Xyz, Pendulum or Link' },
  { code: '3.1', maxCopies: 0, label: 'Rule 3.1: floodgate comparing both fields' },
  { code: '3.2', maxCopies: 2, label: 'Rule 3.2: floodgate the opponent can play around' },
  { code: '3.3', maxCopies: 1, label: 'Rule 3.3: floodgate on a card property' },
  { code: '3.4', maxCopies: 0, label: 'Rule 3.4: floodgate' },
  { code: '4', maxCopies: 0, label: 'Rule 4: hand trap' },
  { code: '5', maxCopies: 1, label: 'Rule 5: draw' },
  { code: '6a', maxCopies: 1, label: 'Rule 6a: effect damage' },
  { code: '6b', maxCopies: 1, label: 'Rule 6b: multiplies battle damage' },
  { code: '7a', maxCopies: 1, label: 'Rule 7a: takes control' },
  { code: '7b', maxCopies: 1, label: 'Rule 7b: revives from GY or banishment' },
  { code: '7c', maxCopies: 1, label: 'Rule 7c: Extra Deck summon without full materials' },
  { code: '7d', maxCopies: 1, label: 'Rule 7d: Fusion material from the Deck' },
  { code: '7e', maxCopies: 1, label: 'Rule 7e: Special Summons a monster from the Deck (v3.1, Ä13)' },
  { code: '8', maxCopies: 1, label: 'Rule 8: mass removal' },
  { code: '9a', maxCopies: 1, label: 'Rule 9a: protection from card effects' },
  { code: '9b', maxCopies: 2, label: 'Rule 9b: protection from battle' },
  { code: '10', maxCopies: 1, label: 'Rule 10: negation' },
  { code: '11a', maxCopies: 1, label: 'Rule 11: denies a phase or Normal Summon once' },
  { code: '11b', maxCopies: 0, label: 'Rule 11: denies a phase or Normal Summon repeatedly' },
  { code: '12', maxCopies: 1, label: 'Rule 12: alternative win condition, or searches its parts by name (v3.1, Ä12)' },
  { code: 'frequency', maxCopies: 0, label: 'Frequency modifier: limited effect usable twice per turn' },
  { code: 'stacking', maxCopies: 0, label: 'Stacking rule: protection plus multiplied battle damage' },
]

/**
 * What lifts or lowers the limit of one hit (Classic Plus v3.1, ADR 0045). `body`, `cost` and `noanswer` belong to the
 * rules 6(b), 7 and 8 (the "Stufung", Ä2), `bound` to rule 5 (Ä3), `chain` to any rule (the chain of named cards, Ä4).
 */
export const CLASSIC_PLUS_TRAITS = ['body', 'cost', 'noanswer', 'bound', 'chain'] as const
export type ClassicPlusTrait = typeof CLASSIC_PLUS_TRAITS[number]

/** The rules whose base limit the traits `body`, `cost` and `noanswer` move. */
export const CLASSIC_PLUS_TIERED_RULES: readonly string[] = ['6b', '7a', '7b', '7c', '7d', '7e', '8']

/** The traits that mean something on a hit of `rule`; the others are ignored. */
export function applicableTraits(rule: string, traits: readonly string[]): ClassicPlusTrait[] {
  return CLASSIC_PLUS_TRAITS.filter((trait) => {
    if (!traits.includes(trait)) {
      return false
    }
    if (trait === 'chain') {
      return true
    }
    if (trait === 'bound') {
      return rule === '5'
    }
    return CLASSIC_PLUS_TIERED_RULES.includes(rule)
  })
}

/**
 * The limit of one hit: the step's own limit, moved by the hit's traits. Rules 6(b), 7 and 8 start at 1: `noanswer`
 * (no real answer) keeps it at 1, else a `body` or `cost` lifts it to 2. Rule 5 is lifted to 2 by `bound`. A `chain`
 * of named cards then makes it one step milder, at most 2. A step that is not limit 1 (forbidden, or 2 already) is
 * only moved by `chain`.
 */
export function hitLimit(rule: string, stepLimit: 0 | 1 | 2, traits: readonly string[]): 0 | 1 | 2 {
  const own = applicableTraits(rule, traits)
  let limit: number = stepLimit
  if (stepLimit === 1) {
    if (CLASSIC_PLUS_TIERED_RULES.includes(rule) && !own.includes('noanswer') && (own.includes('body') || own.includes('cost'))) {
      limit = 2
    }
    else if (rule === '5' && own.includes('bound')) {
      limit = 2
    }
  }
  if (own.includes('chain')) {
    limit = Math.min(2, limit + 1)
  }
  return limit as 0 | 1 | 2
}

/** Steps the classifier may report (rule 2 and the two cross-cutting rules are applied by script). */
export const CLASSIC_PLUS_CLASSIFIER_CODES = CLASSIC_PLUS_STEPS
  .map(step => step.code)
  .filter(code => code !== '2' && code !== 'frequency' && code !== 'stacking')

/**
 * Rule 1 as the format's filter: card types the format editor can show and
 * keep (it doesn't keep frame types). Pendulum cards whose type doesn't say so
 * (e.g. "Spirit Monster") go on the banlist instead, see combine.ts.
 */
export const CLASSIC_PLUS_FORBIDDEN_TYPES = [
  'Synchro Monster',
  'Synchro Tuner Monster',
  'Synchro Pendulum Effect Monster',
  'XYZ Monster',
  'XYZ Pendulum Effect Monster',
  'Link Monster',
  'Pendulum Normal Monster',
  'Pendulum Effect Monster',
  'Pendulum Tuner Effect Monster',
  'Pendulum Flip Effect Monster',
  'Pendulum Effect Fusion Monster',
  'Pendulum Effect Ritual Monster',
]

/** Rule 1 by frame type (`catalog_card.frame_type`), which is exact; the scripts use it. */
export const CLASSIC_PLUS_FORBIDDEN_FRAME_TYPES = [
  'synchro',
  'xyz',
  'link',
  'normal_pendulum',
  'effect_pendulum',
  'ritual_pendulum',
  'fusion_pendulum',
  'synchro_pendulum',
  'xyz_pendulum',
]

/** Rule 2, applied to the English card text: a case-sensitive whole-word mention. */
export const CLASSIC_PLUS_RULE_2_PATTERN = /\b(?:Synchro|Xyz|XYZ|Link|Pendulum)\b/

/** The Classic Plus banlist (`server/utils/classic-plus-banlist.json`, generated by scripts/classic-plus/combine.ts). */
export interface ClassicPlusBanlist {
  forbidden: number[]
  limited: number[]
  semiLimited: number[]
}
