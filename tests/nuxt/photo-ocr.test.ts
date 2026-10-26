// @vitest-environment node
// The pure parts of reading card photos on the device (ADR 0040): grey values, the
// local threshold, and the lines with the heights of their words.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adaptiveThreshold, confidentWords, linesFromWords, OCR_LONG_EDGE, OCR_PASSES, toGrayscale } from '../../app/utils/photo-ocr'

describe('toGrayscale', () => {
  it('turns RGBA into grey values with more contrast around the middle grey', () => {
    // black, white, a mid grey, and a saturated red
    const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255, 255, 0, 0, 255])

    const gray = toGrayscale(rgba, 1.5)

    // Black and white stay (clamped), the mid grey stays in the middle (127.99 rounds down),
    // and red, which looks dark to the eye (0.299), is pushed darker: (76 - 128) * 1.5 + 128.
    expect([...gray]).toEqual([0, 255, 127, 50])
  })

  it('can take only the red channel, where light lettering on a teal or brown bar stands out', () => {
    // a teal bar (red 40) and gold lettering on it (red 230), and a brown bar (red 120) with white lettering (red 255)
    const rgba = new Uint8ClampedArray([30, 140, 150, 255, 230, 190, 80, 255, 120, 80, 60, 255, 255, 255, 255, 255])

    const red = toGrayscale(rgba, 1, 'red')

    expect([...red]).toEqual([30, 230, 120, 255])
  })
})

describe('OCR_PASSES', () => {
  it('reads the red channel, the red channel with a local threshold, and the grey picture larger', () => {
    expect(OCR_PASSES.map(pass => [pass.channel, pass.binarize, pass.edge ?? OCR_LONG_EDGE])).toEqual([['red', false, 2900], ['red', true, 2600], ['luminance', false, 3200]])
  })
})

describe('adaptiveThreshold', () => {
  /** A width × height picture: `paper` brightness everywhere, with a dark bar of `ink` from x0 to x1 in the middle rows. */
  function picture(width: number, height: number, paper: number, bar: { x0: number, x1: number, ink: number }) {
    const gray = new Uint8Array(width * height).fill(paper)
    for (let y = 8; y < 12; y += 1) {
      for (let x = bar.x0; x < bar.x1; x += 1) {
        gray[y * width + x] = bar.ink
      }
    }
    return gray
  }

  it('makes dark text ink on a bar of any brightness, and the bar itself paper', () => {
    for (const paper of [90, 160, 230]) {
      const gray = picture(60, 20, paper, { x0: 20, x1: 40, ink: Math.round(paper * 0.4) })

      const result = adaptiveThreshold(gray, 60, 20, 12, 0.88)

      // The dark stroke is ink; far from it the surface is paper, whatever its brightness.
      expect(result[10 * 60 + 30]).toBe(0)
      expect(result[2 * 60 + 5]).toBe(255)
      expect(result[17 * 60 + 55]).toBe(255)
    }
  })

  it('leaves an even picture as paper', () => {
    const result = adaptiveThreshold(new Uint8Array(30 * 10).fill(120), 30, 10)

    expect(new Set(result)).toEqual(new Set([255]))
  })
})

describe('linesFromWords', () => {
  const word = (text: string, height: number) => ({ text, bbox: { y0: 100, y1: 100 + height } })

  it('keeps the text of a line and the height of each word relative to the usual word of the reading', () => {
    const lines = linesFromWords([
      [word('DARK', 40), word('MAGICIAN', 40)],
      // effect text: the usual height is that of these many small words
      [word('Once', 20), word('per', 20), word('turn,', 20), word('you', 20), word('can', 20), word('draw', 20)],
      [word('Another', 20), word('line', 20), word('of', 20), word('text', 20)],
    ])

    expect(lines).toEqual([
      { text: 'DARK MAGICIAN', heights: [2, 2] },
      { text: 'Once per turn, you can draw', heights: [1, 1, 1, 1, 1, 1] },
      { text: 'Another line of text', heights: [1, 1, 1, 1] },
    ])
  })

  it('leaves out noise: lines without a word of three letters, empty words and zero-height boxes do not count', () => {
    const lines = linesFromWords([
      [word('=', 10), word('|', 10), word('J', 10)],
      [word('  ', 20), word('Kuriboh', 30), word('', 20)],
      [word('ATK/300', 20), word('x', 0)],
    ])

    expect(lines.map(line => line.text)).toEqual(['Kuriboh', 'ATK/300 x'])
    expect(lines[0]!.heights).toHaveLength(1)
  })

  it('has nothing to say for a photo without text', () => {
    expect(linesFromWords([])).toEqual([])
    expect(linesFromWords([[]])).toEqual([])
  })
})

describe('confidentWords', () => {
  const word = (text: string, confidence: number) => ({ text, bbox: { y0: 0, y1: 10 }, confidence })

  it('counts the words of four letters that were read with some certainty', () => {
    expect(confidentWords([[word('Kuriboh', 90), word('Dark', 61), word('Dar', 95), word('Magician', 40)], [word('Zaloog', 75), word('1234', 99)]])).toBe(3)
    expect(confidentWords([])).toBe(0)
  })
})

describe('readPhotoLines', () => {
  afterEach(() => {
    vi.doUnmock('tesseract.js')
    vi.unstubAllGlobals()
  })

  /** A reading Tesseract returns: `words` on one line, each with its confidence. */
  function reading(...words: Array<[string, number]>) {
    return { data: { blocks: [{ paragraphs: [{ lines: [{ words: words.map(([text, confidence]) => ({ text, confidence, bbox: { y0: 0, y1: 20 } })) }] }] }] } }
  }

  /** The browser pieces `readPhotoLines` draws with, as stubs; the context records how the photo was turned. */
  function stubBrowser(recognize: () => Promise<unknown>) {
    const worker = { setParameters: vi.fn(), recognize: vi.fn(recognize), terminate: vi.fn() }
    const createWorker = vi.fn(() => Promise.resolve(worker))
    vi.doMock('tesseract.js', () => ({ createWorker }))
    const context = {
      drawImage: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      getImageData: (_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
      createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: vi.fn(),
    }
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) })
    vi.stubGlobal('createImageBitmap', () => Promise.resolve({ width: 10, height: 20, close: vi.fn() }))
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false }))
    return { worker, createWorker, context }
  }

  it('starts the OCR worker from its own file, because the CSP allows no blob: workers (ADR 0029), and reads English and German', async () => {
    const { worker, createWorker } = stubBrowser(() => Promise.resolve({ data: { blocks: [] } }))

    const { readPhotoLines } = await import('../../app/utils/photo-ocr')
    const passes = await readPhotoLines(new File([''], 'card.jpg'))

    expect(passes).toHaveLength(3)
    expect(createWorker).toHaveBeenCalledWith(['eng', 'deu'], 1, expect.objectContaining({ workerPath: '/ai/ocr/worker.min.js', workerBlobURL: false }))
    expect(worker.terminate).toHaveBeenCalled()
  })

  it('reads a photo that is the right way up in three readings, without trying it turned', async () => {
    const { worker, context } = stubBrowser(() => Promise.resolve(reading(['Kuriboh', 90], ['Raigeki', 88], ['Zaloog', 80], ['Tomate', 70])))

    const { readPhotoLines } = await import('../../app/utils/photo-ocr')
    await readPhotoLines(new File([''], 'cards.jpg'))

    expect(worker.recognize).toHaveBeenCalledTimes(3)
    expect(context.rotate).not.toHaveBeenCalled()
  })

  it('turns a photo of cards lying on their side: the way with the most confident words is the way it is read', async () => {
    // upright: nothing; a quarter clockwise: one word; a quarter the other way: the cards' names.
    const answers = [reading(['|', 10]), reading(['Kuri', 50]), reading(['Kuriboh', 90], ['Raigeki', 88], ['Zaloog', 80])]
    let call = 0
    const { worker, context } = stubBrowser(() => Promise.resolve(answers[call++] ?? reading(['Kuriboh', 90], ['Raigeki', 88], ['Zaloog', 80])))

    const { readPhotoLines } = await import('../../app/utils/photo-ocr')
    const passes = await readPhotoLines(new File([''], 'sideways.jpg'))

    // The first reading three times (as it is, 90°, 270°), then the other two readings the way that won.
    expect(worker.recognize).toHaveBeenCalledTimes(5)
    // Drawn turned: 90° and 270° for the probes of the first reading, then 270° once for each of the other two readings (each has its own size).
    expect(context.rotate.mock.calls.map(([radians]) => Math.round((radians as number) * 180 / Math.PI))).toEqual([90, 270, 270, 270])
    expect(passes).toHaveLength(3)
    expect(passes[0]!.map(line => line.text)).toEqual(['Kuriboh Raigeki Zaloog'])
  })

  it('keeps the photo as it is when turning it finds no more', async () => {
    const { context } = stubBrowser(() => Promise.resolve(reading(['|', 10])))

    const { readPhotoLines } = await import('../../app/utils/photo-ocr')
    await readPhotoLines(new File([''], 'blank.jpg'))

    // Only the probes of the first reading turned the picture (once each way); the later readings did not.
    expect(context.rotate).toHaveBeenCalledTimes(2)
  })
})
