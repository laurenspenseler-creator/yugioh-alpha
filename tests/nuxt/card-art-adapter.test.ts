// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { applyArtAdapter, fitArtAdapter, identityAdapter } from '../../shared/card-art-adapter'
import { ART_ADAPTER_SIZE, ART_DIMENSION, ART_PARTS, ART_VECTOR, centerArtIndex, parseArtIndex } from '../../shared/card-art'
import type { ArtIndexMeta } from '../../shared/card-art'

/** A vector of two unit parts out of a fixed pseudo-random sequence. */
function randomVector(seed: number): Float32Array {
  const vector = new Float32Array(ART_VECTOR)
  let state = seed * 2654435761 % 4294967296
  const next = () => (state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5
  for (let part = 0; part < ART_PARTS; part += 1) {
    let sum = 0
    for (let d = 0; d < ART_DIMENSION; d += 1) {
      const value = next()
      vector[part * ART_DIMENSION + d] = value
      sum += value * value
    }
    for (let d = 0; d < ART_DIMENSION; d += 1) {
      vector[part * ART_DIMENSION + d]! /= Math.sqrt(sum)
    }
  }
  return vector
}

describe('the artwork adapter', () => {
  it('leaves a vector as it is with the identity', () => {
    const vector = randomVector(1)
    const moved = applyArtAdapter(identityAdapter(), vector)

    for (let i = 0; i < ART_VECTOR; i += 1) {
      expect(moved[i]).toBeCloseTo(vector[i]!, 5)
    }
  })

  it('is the identity where there is no data', () => {
    const matrix = fitArtAdapter([], [], 10)

    expect(matrix).toEqual(identityAdapter())
  })

  it('learns a map from enough pairs, and keeps each part a unit vector', () => {
    // The map to learn: every number moved one place on within its part.
    const shift = (vector: Float32Array) => {
      const out = new Float32Array(ART_VECTOR)
      for (let part = 0; part < ART_PARTS; part += 1) {
        for (let d = 0; d < ART_DIMENSION; d += 1) {
          out[part * ART_DIMENSION + (d + 1) % ART_DIMENSION] = vector[part * ART_DIMENSION + d]!
        }
      }
      return out
    }
    // Twice as many pairs as numbers, so that the shrinking towards the identity (lambda) hardly matters.
    const inputs = Array.from({ length: 1600 }, (_, i) => randomVector(i + 10))
    const matrix = fitArtAdapter(inputs, inputs.map(shift), 1e-4)
    const fresh = randomVector(5000)
    const moved = applyArtAdapter(matrix, fresh)
    const wanted = shift(fresh)

    let worst = 0
    for (let i = 0; i < ART_VECTOR; i += 1) {
      worst = Math.max(worst, Math.abs(moved[i]! - wanted[i]!))
    }
    expect(worst).toBeLessThan(0.01)
    for (let part = 0; part < ART_PARTS; part += 1) {
      const length = Math.hypot(...Array.from(moved.slice(part * ART_DIMENSION, (part + 1) * ART_DIMENSION)))
      expect(length).toBeCloseTo(1, 5)
    }
  }, 60_000)

  it('is held towards the identity by a large lambda', () => {
    const inputs = [randomVector(1)]
    const targets = [randomVector(2)]
    const matrix = fitArtAdapter(inputs, targets, 1e6)
    const vector = randomVector(3)
    const moved = applyArtAdapter(matrix, vector)

    for (let i = 0; i < ART_VECTOR; i += 1) {
      expect(moved[i]).toBeCloseTo(vector[i]!, 3)
    }
  }, 60_000)
})

describe('the index and its adapter', () => {
  const meta: ArtIndexMeta = { version: 2, model: 'x', dimension: ART_DIMENSION, parts: ART_PARTS, count: 1, cardIds: [1] }
  const binary = new ArrayBuffer(1 * ART_PARTS * 4 + ART_VECTOR)

  it('keeps an adapter of the right size, also centred, and ignores one of another size', () => {
    const adapter = identityAdapter()
    const index = parseArtIndex(meta, binary, undefined, adapter.buffer as ArrayBuffer)

    expect(index.adapter).toHaveLength(ART_ADAPTER_SIZE)
    expect(centerArtIndex(index).adapter).toBe(index.adapter)
    expect(parseArtIndex(meta, binary, undefined, new ArrayBuffer(100)).adapter).toBeUndefined()
    expect(parseArtIndex(meta, binary).adapter).toBeUndefined()
  })
})
