// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { appendCardLines } from '../../app/utils/card-lines'

describe('appendCardLines', () => {
  it('puts the lines under an existing list, one per line, and ends with a line break', () => {
    expect(appendCardLines('3x Dark Magician', ['2x Kuriboh', 'Sangan'])).toBe('3x Dark Magician\n2x Kuriboh\nSangan\n')
    expect(appendCardLines('3x Dark Magician\n\n  ', ['Sangan'])).toBe('3x Dark Magician\nSangan\n')
  })

  it('starts a list when there is none', () => {
    expect(appendCardLines('', ['2x Kuriboh'])).toBe('2x Kuriboh\n')
    expect(appendCardLines('   ', ['2x Kuriboh'])).toBe('2x Kuriboh\n')
  })
})
