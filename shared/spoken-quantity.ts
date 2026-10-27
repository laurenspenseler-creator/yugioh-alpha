// How many copies a dictation says: "drei", "three", "3". Shared by the page, which finds the
// cards in what was written down (`app/utils/spoken-card-lines.ts`), and the server, which finds
// them in a line that was written without a break between them (`server/utils/spoken-lines.ts`).

const NUMBER_WORDS: Record<string, number> = {
  ein: 1,
  eine: 1,
  einen: 1,
  einem: 1,
  einer: 1,
  einmal: 1,
  zwei: 2,
  zwo: 2,
  zweimal: 2,
  drei: 3,
  dreimal: 3,
  vier: 4,
  viermal: 4,
  fünf: 5,
  fuenf: 5,
  fünfmal: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  elf: 11,
  zwölf: 12,
  zwoelf: 12,
  one: 1,
  a: 1,
  an: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
}

/** The most copies of one card that are said in a line; a larger number is a misheard name. */
export const MAX_SPOKEN_COPIES = 12

/** The number a word or digits say, or null. */
export function quantityOf(word: string): number | null {
  if (/^\d{1,2}$/.test(word)) {
    const value = Number(word)
    return value >= 1 && value <= MAX_SPOKEN_COPIES ? value : null
  }
  return NUMBER_WORDS[word.toLowerCase()] ?? null
}
