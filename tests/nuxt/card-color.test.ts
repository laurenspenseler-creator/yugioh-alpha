import { describe, expect, it } from 'vitest'
import { ART_COLOR_DIMENSION, ART_COLOR_GRID, artColorDescriptor, colorSimilarity, dequantizeColor, meanColor, quantizeColor } from '../../shared/card-color'

/** A picture of `size` x `size` RGBA pixels where `paint(x, y)` gives the colour. */
function picture(size: number, paint: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = paint(x, y)
      out.set([r, g, b, 255], (y * size + x) * 4)
    }
  }
  return out
}

describe('artColorDescriptor', () => {
  it('has two numbers per cell of the grid', () => {
    expect(artColorDescriptor(picture(30, () => [10, 20, 30]), 30, 30)).toHaveLength(ART_COLOR_DIMENSION)
    expect(ART_COLOR_DIMENSION).toBe(ART_COLOR_GRID * ART_COLOR_GRID * 2)
  })

  it('is zero for grey of any brightness: the chromaticity does not depend on the light', () => {
    for (const grey of [30, 128, 220]) {
      const descriptor = artColorDescriptor(picture(30, () => [grey, grey, grey]), 30, 30)
      expect(Math.max(...descriptor.map(Math.abs))).toBe(0)
    }
  })

  it('tells red from blue and keeps where the colours are', () => {
    const left = artColorDescriptor(picture(30, x => (x < 15 ? [200, 40, 40] : [40, 40, 200])), 30, 30)
    const right = artColorDescriptor(picture(30, x => (x < 15 ? [40, 40, 200] : [200, 40, 40])), 30, 30)

    // First cell: red / green is large for red, blue / green is large for blue.
    expect(left[0]).toBeGreaterThan(1)
    expect(right[1]).toBeGreaterThan(1)
    expect(left[0]).toBeGreaterThan(right[0]!)
  })

  it('reads three-byte pictures too', () => {
    const rgb = Uint8Array.from({ length: 12 * 12 * 3 }, (_, i) => (i % 3 === 0 ? 200 : 50))

    expect(artColorDescriptor(rgb, 12, 12, 3)[0]).toBeGreaterThan(1)
  })
})

describe('quantizeColor', () => {
  it('stores a descriptor in bytes and gets it back almost as it was', () => {
    const descriptor = artColorDescriptor(picture(30, (x, y) => [x * 8, y * 8, 120]), 30, 30)
    const back = dequantizeColor(quantizeColor(descriptor))

    for (let d = 0; d < ART_COLOR_DIMENSION; d += 1) {
      expect(Math.abs(back[d]! - descriptor[d]!)).toBeLessThan(0.01)
    }
  })

  it('does not overflow a byte', () => {
    expect(quantizeColor(new Float32Array(ART_COLOR_DIMENSION).fill(9)).every(value => value === 127)).toBe(true)
    expect(quantizeColor(new Float32Array(ART_COLOR_DIMENSION).fill(-9)).every(value => value === -127)).toBe(true)
  })
})

describe('colorSimilarity', () => {
  const red = artColorDescriptor(picture(30, () => [200, 40, 40]), 30, 30)
  const blue = artColorDescriptor(picture(30, () => [40, 60, 200]), 30, 30)
  const green = artColorDescriptor(picture(30, () => [40, 200, 60]), 30, 30)
  const mean = meanColor([red, blue, green])

  it('is 1 for the same colour, whatever the tint of the light, and less for another', () => {
    const tinted = red.map(value => value + 0.2)

    expect(colorSimilarity(red, mean, red, mean)).toBeCloseTo(1, 5)
    expect(colorSimilarity(tinted, meanColor([tinted, blue.map(v => v + 0.2), green.map(v => v + 0.2)]), red, mean)).toBeGreaterThan(0.99)
    expect(colorSimilarity(red, mean, blue, mean)).toBeLessThan(0.2)
  })

  it('does not divide by zero for a picture that has exactly the shared colour', () => {
    expect(Number.isFinite(colorSimilarity(mean, mean, red, mean))).toBe(true)
  })
})
