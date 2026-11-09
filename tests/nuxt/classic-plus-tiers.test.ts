// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { applicableTraits, hitLimit } from '../../shared/classic-plus'

// The tiers of Classic Plus v3.1 (ADR 0045): what a hit's traits do to the limit of its step.

describe('hitLimit', () => {
  it('keeps a hit without traits at the limit of its step', () => {
    expect(hitLimit('8', 1, [])).toBe(1)
    expect(hitLimit('7b', 1, [])).toBe(1)
    expect(hitLimit('9b', 2, [])).toBe(2)
    expect(hitLimit('4', 0, [])).toBe(0)
  })

  it('lifts rules 6(b), 7 and 8 to 2 for a body or own costs (Ä2)', () => {
    for (const rule of ['6b', '7a', '7b', '7c', '7d', '8']) {
      expect(hitLimit(rule, 1, ['body']), rule).toBe(2)
      expect(hitLimit(rule, 1, ['cost']), rule).toBe(2)
      expect(hitLimit(rule, 1, ['body', 'cost']), rule).toBe(2)
    }
  })

  it('brings it back to 1 when the card has no real answer, whatever else is true (Ä2)', () => {
    expect(hitLimit('8', 1, ['body', 'cost', 'noanswer'])).toBe(1)
    expect(hitLimit('7b', 1, ['noanswer'])).toBe(1)
  })

  it('does not lift the other rules for a body or costs: they are flat', () => {
    // Rule 5 only has `bound`, rule 6(a) and rule 10 and 11 stay flat (Ä5).
    expect(hitLimit('5', 1, ['body', 'cost'])).toBe(1)
    expect(hitLimit('6a', 1, ['body', 'cost'])).toBe(1)
    expect(hitLimit('10', 1, ['body', 'cost'])).toBe(1)
    expect(hitLimit('11a', 1, ['cost'])).toBe(1)
  })

  it('lifts a draw card to 2 when its cost is bound to one specific card (Ä3)', () => {
    expect(hitLimit('5', 1, ['bound'])).toBe(2)
    expect(hitLimit('8', 1, ['bound'])).toBe(1)
  })

  it('makes a chain of named cards one step milder, at most limit 2 (Ä4)', () => {
    expect(hitLimit('9a', 1, ['chain'])).toBe(2)
    expect(hitLimit('10', 1, ['chain'])).toBe(2)
    expect(hitLimit('9b', 2, ['chain'])).toBe(2)
    expect(hitLimit('3.4', 0, ['chain'])).toBe(1)
    // After the tiers: a body lifts rule 8 to 2 and the chain cannot go above 2.
    expect(hitLimit('8', 1, ['body', 'chain'])).toBe(2)
    // No real answer first (1), then the chain (2).
    expect(hitLimit('8', 1, ['noanswer', 'chain'])).toBe(2)
  })
})

describe('applicableTraits', () => {
  it('drops a trait on a rule it does not belong to and keeps the order of the trait list', () => {
    expect(applicableTraits('10', ['body', 'cost', 'chain'])).toEqual(['chain'])
    expect(applicableTraits('8', ['chain', 'body', 'bound'])).toEqual(['body', 'chain'])
    expect(applicableTraits('5', ['bound', 'body'])).toEqual(['bound'])
    expect(applicableTraits('7b', [])).toEqual([])
  })
})
