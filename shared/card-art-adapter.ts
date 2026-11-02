// What a photo does to an artwork that the artwork index does not know (ADR 0041, round 8): the picture is smaller
// and softer, compressed, lit by a room and seen through a sleeve, and the model's vector of it moves away from
// the vector of the clean catalog picture, the same way for every card. A linear map from the vectors of windows
// on photos to the vectors of the catalog pictures they show learns that shift (a ridge regression towards the
// identity, so that where there is no data the vector stays as it is).
import { ART_ADAPTER_SIZE, ART_DIMENSION, ART_PARTS, ART_VECTOR } from './card-art'

/** The identity map: leaves every vector as it is. */
export function identityAdapter(): Float32Array {
  const matrix = new Float32Array(ART_ADAPTER_SIZE)
  for (let a = 0; a < ART_VECTOR; a += 1) {
    matrix[a * ART_VECTOR + a] = 1
  }
  return matrix
}

/** The vector moved by the map, each part made a unit vector again. */
export function applyArtAdapter(matrix: Float32Array, vector: Float32Array): Float32Array {
  const moved = new Float32Array(ART_VECTOR)
  for (let b = 0; b < ART_VECTOR; b += 1) {
    const value = vector[b]!
    if (value === 0) {
      continue
    }
    for (let a = 0; a < ART_VECTOR; a += 1) {
      moved[a]! += matrix[a * ART_VECTOR + b]! * value
    }
  }
  for (let part = 0; part < ART_PARTS; part += 1) {
    let sum = 0
    for (let d = 0; d < ART_DIMENSION; d += 1) {
      sum += moved[part * ART_DIMENSION + d]! ** 2
    }
    const length = Math.sqrt(sum) || 1
    for (let d = 0; d < ART_DIMENSION; d += 1) {
      moved[part * ART_DIMENSION + d]! /= length
    }
  }
  return moved
}

/**
 * The map that takes each of `inputs` closest to its `targets` (same order), with `lambda` for how strongly it is held to
 * the identity: `W = (T Xᵀ + λ I)(X Xᵀ + λ I)⁻¹`, solved in double precision. Vectors are `ART_VECTOR` long (unit parts).
 */
export function fitArtAdapter(inputs: readonly Float32Array[], targets: readonly Float32Array[], lambda: number): Float32Array {
  const n = ART_VECTOR
  const cross = new Float64Array(n * n)
  const target = new Float64Array(n * n)
  for (let k = 0; k < inputs.length; k += 1) {
    const x = inputs[k]!
    const t = targets[k]!
    for (let a = 0; a < n; a += 1) {
      const xa = x[a]!
      const ta = t[a]!
      const row = a * n
      for (let b = 0; b < n; b += 1) {
        const xb = x[b]!
        cross[row + b]! += xa * xb
        target[row + b]! += ta * xb
      }
    }
  }
  // Solve (X Xᵀ + λ I) Z = (T Xᵀ + λ I)ᵀ; the map is Zᵀ.
  const system = Float64Array.from(cross)
  const right = new Float64Array(n * n)
  for (let a = 0; a < n; a += 1) {
    system[a * n + a]! += lambda
    for (let b = 0; b < n; b += 1) {
      right[a * n + b] = target[b * n + a]! + (a === b ? lambda : 0)
    }
  }
  for (let column = 0; column < n; column += 1) {
    let pivot = column
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(system[row * n + column]!) > Math.abs(system[pivot * n + column]!)) {
        pivot = row
      }
    }
    if (pivot !== column) {
      for (let c = 0; c < n; c += 1) {
        const swapped = system[column * n + c]!
        system[column * n + c] = system[pivot * n + c]!
        system[pivot * n + c] = swapped
        const swappedRight = right[column * n + c]!
        right[column * n + c] = right[pivot * n + c]!
        right[pivot * n + c] = swappedRight
      }
    }
    const divisor = system[column * n + column]!
    for (let c = column; c < n; c += 1) {
      system[column * n + c]! /= divisor
    }
    for (let c = 0; c < n; c += 1) {
      right[column * n + c]! /= divisor
    }
    for (let row = 0; row < n; row += 1) {
      const factor = system[row * n + column]!
      if (row === column || factor === 0) {
        continue
      }
      for (let c = column; c < n; c += 1) {
        system[row * n + c]! -= factor * system[column * n + c]!
      }
      for (let c = 0; c < n; c += 1) {
        right[row * n + c]! -= factor * right[column * n + c]!
      }
    }
  }
  const matrix = new Float32Array(ART_ADAPTER_SIZE)
  for (let a = 0; a < n; a += 1) {
    for (let b = 0; b < n; b += 1) {
      matrix[a * n + b] = right[b * n + a]!
    }
  }
  return matrix
}
