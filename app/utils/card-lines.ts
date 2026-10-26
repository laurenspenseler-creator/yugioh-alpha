/**
 * Puts card lines (`3x Dark Magician`) under what is already in a list box,
 * each on its own line, so photos and dictation add to a list instead of
 * replacing it. The result ends with a line break, so typing goes on on a fresh line.
 */
export function appendCardLines(text: string, lines: string[]): string {
  const kept = text.replace(/\s+$/, '')
  return `${[kept, ...lines].filter(part => part !== '').join('\n')}\n`
}
