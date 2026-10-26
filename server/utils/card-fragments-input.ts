// The request body of `POST /api/cards/match-fragments` (ADR 0040), checked and
// cut to size: the text of a photo as read in the browser is user input.
import { MAX_FRAGMENT_LENGTH, MAX_FRAGMENT_PASSES, MAX_FRAGMENTS_PER_PASS } from './card-fragments'
import type { OcrLine } from './card-fragments'

/** More words than this in a line are noise; the heights past it are dropped with them. */
const MAX_WORDS_PER_LINE = 60

function parseLine(raw: unknown): OcrLine | null {
  if (typeof raw === 'string') {
    return { text: raw.slice(0, MAX_FRAGMENT_LENGTH) }
  }
  if (typeof raw !== 'object' || raw === null || typeof (raw as { text?: unknown }).text !== 'string') {
    return null
  }

  const { text, heights } = raw as { text: string, heights?: unknown }
  const line: OcrLine = { text: text.slice(0, MAX_FRAGMENT_LENGTH) }
  if (heights !== undefined) {
    if (!Array.isArray(heights) || heights.length > MAX_WORDS_PER_LINE * 2 || !heights.every(height => typeof height === 'number' && Number.isFinite(height) && height >= 0 && height < 1000)) {
      return null
    }
    line.heights = heights.slice(0, MAX_WORDS_PER_LINE)
  }
  return line
}

/** The readings in the request, or null when the body is not what the endpoint takes. */
export function parseFragmentPasses(raw: unknown): OcrLine[][] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_FRAGMENT_PASSES) {
    return null
  }

  const passes: OcrLine[][] = []
  for (const pass of raw) {
    if (!Array.isArray(pass) || pass.length > MAX_FRAGMENTS_PER_PASS) {
      return null
    }
    const lines: OcrLine[] = []
    for (const entry of pass) {
      const line = parseLine(entry)
      if (!line) {
        return null
      }
      lines.push(line)
    }
    passes.push(lines)
  }
  return passes
}
