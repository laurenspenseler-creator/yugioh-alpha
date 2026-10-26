import type { useDb } from '../db'
import { analyzeRulebook } from '../../shared/format-rulebook'
import type { RulebookImport } from '../../shared/format-rulebook'
import { MAX_FILTER_ENTRIES, MAX_RULES_PER_FORMAT, referencedCardIds, validateRuleSet } from '../../shared/rule-formats'
import type { Rule, RuleSet } from '../../shared/rule-formats'
import { suggestCatalogMatches } from './card-entry'
import { loadCardNameRecords } from './deck-validation'

type Db = ReturnType<typeof useDb>

/** What the endpoint answers, minus where the text came from (the endpoint knows that). */
export type FormatImportResult = Omit<RulebookImport, 'source'>

/** A card name counts as found for an exact name (English or German) or a near-certain match. */
const NAME_MATCH_SCORE = 0.9

/**
 * Turns the text of a rulebook into a rule set (ADR 0037): the pure reader
 * (`analyzeRulebook`), then the parts that need the database (named card
 * lists become `card_status` rules by catalog id), then the engine's own
 * validation, so what comes out is what the format editor accepts.
 */
export function importRulebook(db: Db, text: string): FormatImportResult {
  const analysis = analyzeRulebook(text)
  const findings = [...analysis.findings]
  const rules: Rule[] = [...analysis.rules]

  for (const list of analysis.cardLists) {
    const ids = new Set<number>()
    const missing: string[] = []
    for (const name of list.names.slice(0, MAX_FILTER_ENTRIES)) {
      const best = suggestCatalogMatches(db, { raw: name, quantity: 1, query: name }, { limit: 1 })[0]
      if (best && (best.matchedBy === 'exact' || best.score >= NAME_MATCH_SCORE)) {
        ids.add(best.cardId)
      }
      else {
        missing.push(name)
      }
    }

    const found = [...ids]
    for (let start = 0; start < found.length; start += MAX_FILTER_ENTRIES) {
      rules.push({ kind: 'card_status', status: list.status, cardIds: found.slice(start, start + MAX_FILTER_ENTRIES) })
    }
    if (found.length > 0) {
      findings.push({ status: 'applied', code: 'card_list', source: list.source, params: { status: list.status, found: found.length, total: list.names.length } })
    }
    if (missing.length > 0) {
      findings.push({ status: 'unsupported', code: 'card_names_missing', source: list.source, params: { names: missing.slice(0, 8).join(', '), count: missing.length } })
    }
  }

  // Each rule alone through the engine's validation: one bad rule must not cost the others.
  const valid: Rule[] = []
  for (const rule of rules) {
    try {
      valid.push(...validateRuleSet({ rules: [rule] }).rules)
    }
    catch {
      findings.push({ status: 'unsupported', code: 'rule_invalid', source: '', params: { kind: rule.kind } })
    }
  }
  if (valid.length > MAX_RULES_PER_FORMAT) {
    findings.push({ status: 'unsupported', code: 'too_many_rules', source: '', params: { max: MAX_RULES_PER_FORMAT } })
    valid.length = MAX_RULES_PER_FORMAT
  }

  const ruleSet: RuleSet = { rules: valid }
  const { cardNames, cardNamesDe } = loadCardNameRecords(db, referencedCardIds(ruleSet))

  return {
    name: analysis.name,
    description: analysis.description,
    rules: ruleSet,
    findings,
    cardNames,
    cardNamesDe,
    builtinId: analysis.builtinId,
    textLength: text.length,
  }
}
