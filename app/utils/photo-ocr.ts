// Reading card photos on the device (ADR 0040): Tesseract (WebAssembly) reads the
// text of a photo, several times with different thresholds, and the text goes to
// the server, which finds the card names in it (`server/utils/card-fragments.ts`).
// Nothing but the recognized text leaves the device; the photo itself does not.
//
// What makes it work on a photo with several cards: the red channel next to the grey
// picture (names are light or dark on bars of every colour, and in the red channel
// most of them stand out, foil lettering included), a threshold computed locally, not
// for the whole picture, and the height of every word, relative to the photo's usual
// word, which tells a printed card name from the effect text next to it.
import { AI_ASSETS, aiAssetServed } from '~/utils/ai-assets'

/** One line of OCR text with the height of each of its words relative to the photo's usual word. */
export interface OcrReadLine {
  text: string
  heights: number[]
}

export type OcrChannel = 'luminance' | 'red'

export interface OcrPass {
  /** Tesseract's page segmentation mode: 11 finds sparse text anywhere, 6 reads one block. */
  psm: '11' | '6'
  /** What is read: the grey picture or only its red channel. */
  channel: OcrChannel
  /** Binarize with a local threshold first; `ratio` is how much darker than its surroundings a pixel must be to be ink. */
  binarize: boolean
  ratio?: number
  /** The long edge of the picture this pass reads, in pixels (`OCR_LONG_EDGE` when left out). */
  edge?: number
}

/**
 * The readings of one photo. Measured in the browser on five photos of six cards (four
 * composed of catalog images, one real photo of laminated cards; 30 cards in all): these
 * three together found 27, with 3 wrong ones. The former set (two thresholds of the grey
 * picture and the grey picture) found 21 and took longer; the red channel alone found 20.
 * What one reading finds depends on small things like the size it is read at, so the
 * three differ in channel, threshold and size, and the first (the strongest alone) is
 * also the one that tells which way up the photo is.
 */
export const OCR_PASSES: readonly OcrPass[] = [
  { psm: '11', channel: 'red', binarize: false, edge: 2900 },
  { psm: '11', channel: 'red', binarize: true, ratio: 0.88 },
  { psm: '11', channel: 'luminance', binarize: false, edge: 3200 },
]

/** The long edge of the picture that is read, in pixels: card names are small in a photo of a table. */
export const OCR_LONG_EDGE = 2600
const MIN_SCALE = 0.4
const MAX_SCALE = 2
/** A word read with at least this confidence (0–100) counts towards the orientation of a photo. */
const MIN_CONFIDENCE = 60
/** Fewer confident words than this in the first reading of the upright photo: the cards may lie on their side. */
export const SIDEWAYS_BELOW = 3

export type Rotation = 0 | 90 | 270
/** Lines sent to the server per reading, and the length of one. */
const MAX_LINES = 500
const MAX_LINE_LENGTH = 300

/** Grey values with a little more contrast, from RGBA pixels: the brightness, or only the red channel. */
export function toGrayscale(rgba: Uint8ClampedArray, contrast = 1.3, channel: OcrChannel = 'luminance'): Uint8Array {
  const gray = new Uint8Array(rgba.length / 4)
  for (let i = 0; i < gray.length; i += 1) {
    const value = channel === 'red'
      ? rgba[i * 4]!
      : 0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!
    gray[i] = Math.max(0, Math.min(255, (value - 128) * contrast + 128))
  }
  return gray
}

/**
 * Ink (0) or paper (255) per pixel by a local threshold: a pixel is ink when it is
 * darker than `ratio` times the mean of the square of `radius` pixels around it
 * (an integral image keeps that cheap). Names on yellow, orange or green bars come
 * out as dark text on white, which one threshold for the whole photo does not do.
 */
export function adaptiveThreshold(gray: Uint8Array, width: number, height: number, radius = 22, ratio = 0.88): Uint8Array {
  const stride = width + 1
  const integral = new Float64Array(stride * (height + 1))
  for (let y = 0; y < height; y += 1) {
    let row = 0
    for (let x = 0; x < width; x += 1) {
      row += gray[y * width + x]!
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1]! + row
    }
  }

  const result = new Uint8Array(gray.length)
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius)
    const bottom = Math.min(height, y + radius + 1)
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius)
      const right = Math.min(width, x + radius + 1)
      const sum = integral[bottom * stride + right]! - integral[top * stride + right]! - integral[bottom * stride + left]! + integral[top * stride + left]!
      const mean = sum / ((right - left) * (bottom - top))
      result[y * width + x] = gray[y * width + x]! < mean * ratio ? 0 : 255
    }
  }
  return result
}

interface RecognizedWord {
  text: string
  bbox: { y0: number, y1: number }
  confidence?: number
}

/** Words that were read with some certainty and have four letters: a page of text read the right way up has dozens. */
export function confidentWords(lines: RecognizedWord[][]): number {
  return lines.reduce((sum, words) => sum + words.filter(word => (word.confidence ?? 0) >= MIN_CONFIDENCE && /\p{L}{4,}/u.test(word.text)).length, 0)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 1
}

/**
 * The lines of one reading as the server wants them: the text of each line (words
 * joined by one space, so word `i` of the text is word `i` of the heights), and the
 * height of every word relative to the median word of the whole reading. Lines
 * without a word of three letters are noise and left out.
 */
export function linesFromWords(lines: RecognizedWord[][]): OcrReadLine[] {
  const heights = lines.flatMap(words => words.map(word => word.bbox.y1 - word.bbox.y0)).filter(height => height > 0)
  const usual = median(heights) || 1

  return lines
    .map(words => words.filter(word => word.text.trim() !== ''))
    .filter(words => words.some(word => /\p{L}{3,}/u.test(word.text)))
    .map(words => ({
      text: words.map(word => word.text.trim()).join(' ').slice(0, MAX_LINE_LENGTH),
      heights: words.map(word => Math.round(((word.bbox.y1 - word.bbox.y0) / usual) * 100) / 100),
    }))
    .slice(0, MAX_LINES)
}

interface Rendered {
  canvas: HTMLCanvasElement
  grays: Record<OcrChannel, Uint8Array>
}

/** The photo at a long edge of `edge` pixels, turned by `rotation` degrees clockwise, with its grey values. */
function render(bitmap: ImageBitmap, edge: number, rotation: Rotation): Rendered {
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, edge / Math.max(bitmap.width, bitmap.height)))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = rotation === 0 ? width : height
  canvas.height = rotation === 0 ? height : width
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  if (rotation === 0) {
    context.drawImage(bitmap, 0, 0, width, height)
  }
  else {
    context.translate(canvas.width / 2, canvas.height / 2)
    context.rotate((rotation * Math.PI) / 180)
    context.drawImage(bitmap, -width / 2, -height / 2, width, height)
  }
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  return { canvas, grays: { luminance: toGrayscale(pixels), red: toGrayscale(pixels, 1.3, 'red') } }
}

/** Draws grey values (or ink and paper) onto the canvas, as the picture Tesseract reads. */
function paint(canvas: HTMLCanvasElement, values: Uint8Array) {
  const context = canvas.getContext('2d')!
  const image = context.createImageData(canvas.width, canvas.height)
  for (let i = 0; i < values.length; i += 1) {
    image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = values[i]!
    image.data[i * 4 + 3] = 255
  }
  context.putImageData(image, 0, 0)
}

/**
 * Reads one photo with every pass of `OCR_PASSES`: the lines of each reading, to
 * be matched against the catalog together. `onPass` says which reading starts
 * (0-based) so the page can show progress; a photo takes about fifteen seconds per pass.
 *
 * A photo of cards that lie on their side (taken with the phone upright) is read
 * as nothing at all. So when the first reading of the photo as it is has hardly any
 * confident word, the same reading is made with the photo turned a quarter either
 * way, and whichever way gives the most confident words is the way the photo is read.
 */
export async function readPhotoLines(
  file: File,
  options: { languages?: string[], onPass?: (pass: number, passes: number) => void } = {},
): Promise<OcrReadLine[][]> {
  const { languages = ['eng', 'deu'], onPass } = options
  const { createWorker } = await import('tesseract.js')
  const bitmap = await createImageBitmap(file)

  // The code is always served with the app; the language data only when the build has it.
  const local = await aiAssetServed('ocr/lang/eng.traineddata.gz')
  const worker = await createWorker(languages, 1, {
    workerPath: `${AI_ASSETS}/ocr/worker.min.js`,
    // Start the worker from its own file, not from a blob: URL that imports it: the
    // Content-Security-Policy allows workers from the app's origin only (ADR 0029).
    workerBlobURL: false,
    corePath: `${AI_ASSETS}/ocr/core`,
    ...(local ? { langPath: `${AI_ASSETS}/ocr/lang` } : {}),
  })

  const renders = new Map<string, Rendered>()
  const rendered = (edge: number, rotation: Rotation) => {
    const key = `${edge}:${rotation}`
    if (!renders.has(key)) {
      renders.set(key, render(bitmap, edge, rotation))
    }
    return renders.get(key)!
  }

  async function read(pass: OcrPass, rotation: Rotation): Promise<{ lines: OcrReadLine[], confident: number }> {
    const { canvas, grays } = rendered(pass.edge ?? OCR_LONG_EDGE, rotation)
    const gray = grays[pass.channel]
    paint(canvas, pass.binarize ? adaptiveThreshold(gray, canvas.width, canvas.height, 22, pass.ratio) : gray)
    await worker.setParameters({ tessedit_pageseg_mode: pass.psm as never })
    const { data } = await worker.recognize(canvas, {}, { blocks: true })
    const words = (data.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.map(line => line.words)))
    return { lines: linesFromWords(words), confident: confidentWords(words) }
  }

  try {
    const passes: OcrReadLine[][] = []
    let rotation: Rotation = 0
    for (const [index, pass] of OCR_PASSES.entries()) {
      onPass?.(index, OCR_PASSES.length)
      let reading = await read(pass, rotation)
      if (index === 0) {
        for (const turn of reading.confident < SIDEWAYS_BELOW ? [90, 270] as const : []) {
          const turned = await read(pass, turn)
          if (turned.confident > reading.confident && turned.confident >= SIDEWAYS_BELOW - 1) {
            reading = turned
            rotation = turn
          }
        }
      }
      passes.push(reading.lines)
    }
    return passes
  }
  finally {
    bitmap.close()
    await worker.terminate()
  }
}
