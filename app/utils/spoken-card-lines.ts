// What a speech recognizer wrote down for "drei Blauäugiger weißer Drache, zwei
// Dunkler Magier, ein Kuriboh und vier Mystische Elfe" becomes the card lines the
// quick capture and the deck import read: `3x Blauäugiger weißer Drache`. The
// words of the names are left as they were heard; the catalog matching (ADR 0003)
// settles misheard letters, this only finds where one card ends and the next
// begins, and how many of it were said (ADR 0040).

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
const MAX_SPOKEN_COPIES = 12

/** A number word or digit at the start of a segment, with the "mal" / "x" that may follow it. */
const LEADING_QUANTITY = /^(\d{1,2}|[a-zäöüß]+)\s*(?:x|×|mal)?\s+/i

function quantityOf(word: string): number | null {
  if (/^\d{1,2}$/.test(word)) {
    const value = Number(word)
    return value >= 1 && value <= MAX_SPOKEN_COPIES ? value : null
  }
  return NUMBER_WORDS[word.toLowerCase()] ?? null
}

/** Whether the text after a "und" starts a new card: a number word or digit, then a name. */
function startsWithQuantity(text: string): boolean {
  const match = LEADING_QUANTITY.exec(text)
  return match !== null && quantityOf(match[1]!) !== null
}

/** Splits at line ends and sentence punctuation, and at "und" / "and" only where a new quantity follows ("… Magier und vier Elfen"). */
function segments(transcript: string): string[] {
  // A small number in the middle of the text starts the next card ("… Pot of Greed 2 Dark Hole"):
  // a recognizer that wrote digits often leaves out the commas. Not after "Number" / "Nummer".
  const rough = transcript.split(/[\n.;!?,:]+/).flatMap(part => part.split(/(?<!\b(?:number|nummer|nr|no)\.?)\s+(?=\d{1,2}\s+\p{L})/iu))
  const out: string[] = []
  for (const part of rough) {
    // The separators stay in the result (odd positions), so a name keeps its own "und".
    const pieces = part.split(/(\s+(?:und|and|sowie)\s+)/i)
    let current = pieces[0] ?? ''
    for (let index = 1; index < pieces.length; index += 2) {
      const next = pieces[index + 1] ?? ''
      if (startsWithQuantity(next)) {
        out.push(current)
        current = next
      }
      else {
        current += pieces[index]! + next
      }
    }
    out.push(current)
  }
  return out
}

/**
 * What Whisper writes for sounds that are no words, "[Music]", "(Musik)", "* Musik *" or
 * "♪ …": nothing anyone said, and a break between two cards.
 */
const NON_SPEECH = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|[♪♫].*$/gmu

/** Stands in for the dots of "D.D." while the text is cut into cards, and is turned back into dots in the lines. */
const ABBREVIATION_DOT = '·'

/**
 * The card lines in a spoken list: one per card, `Nx name` when a number was
 * said before it. A leading "und" and filler like "Karte" are dropped; a segment
 * with no letters in it is not a card.
 */
export function spokenCardLines(transcript: string): string[] {
  const lines: string[] = []

  // "D.D. Kriegerin": the dots of letters spelled one by one are no sentence ends.
  const spelled = transcript.replace(NON_SPEECH, '\n').replace(/(?<![\p{L}])(?:\p{Lu}\.){2,}/gu, abbreviation => abbreviation.replaceAll('.', ABBREVIATION_DOT))

  for (const raw of segments(spelled)) {
    let text = raw.trim().replace(/^(?:und|and|dann|außerdem|ausserdem|also)\s+/i, '').replace(/\s+/g, ' ')
    // A segment that is only a number ("drei") names no card.
    if (!/\p{L}{2,}/u.test(text) || quantityOf(text.toLowerCase()) !== null) {
      continue
    }

    let quantity = 1
    const match = LEADING_QUANTITY.exec(text)
    const said = match ? quantityOf(match[1]!) : null
    if (match && said !== null) {
      quantity = said
      text = text.slice(match[0].length)
    }

    // "drei Karten Kuriboh" / "zwei mal die Karte Kuriboh": the name starts after the word "Karte(n)".
    text = text.replace(/^(?:die\s+|der\s+|das\s+)?(?:karten?|cards?)\s+/i, '').replace(/^(?:die|der|das)\s+/i, '').trim()
    if (text === '' || !/\p{L}{2,}/u.test(text)) {
      continue
    }

    lines.push((quantity > 1 ? `${quantity}x ${text}` : text).replaceAll(ABBREVIATION_DOT, '.'))
  }

  return lines
}
