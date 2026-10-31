// Maximum weight matching in a general graph (Edmonds' blossom algorithm, the O(n^3) version of Van Rantwijk's
// "mwmatching", the algorithm behind networkx.max_weight_matching). The Swiss pairing needs it (ADR 0042):
// pairing from the top of the table down runs into dead ends in the late rounds, a matching does not.
// Weights must be integers, so that the dual variables stay exact. Pure: no database, no browser.

/** An edge between vertex `i` and vertex `j` of weight `weight` (an integer). */
export type MatchingEdge = readonly [i: number, j: number, weight: number]

/**
 * The matching of the highest total weight; among those of a given weight, with `maxCardinality` the one with the
 * most edges comes first (the highest weight among the matchings that cannot be enlarged). Returns, for every
 * vertex, the vertex it is matched with or -1.
 */
export function maxWeightMatching(edges: readonly MatchingEdge[], maxCardinality = false): number[] {
  if (edges.length === 0) {
    return []
  }
  const nedge = edges.length
  let nvertex = 0
  for (const [i, j] of edges) {
    nvertex = Math.max(nvertex, i + 1, j + 1)
  }
  const maxweight = Math.max(0, ...edges.map(edge => edge[2]))

  // endpoint[2k] and endpoint[2k + 1] are the two ends of edge k; "p" below is such an end, p ^ 1 the other one.
  const endpoint: number[] = []
  for (let p = 0; p < 2 * nedge; p += 1) {
    endpoint.push(edges[p >> 1]![p & 1]!)
  }
  const neighbend: number[][] = Array.from({ length: nvertex }, () => [])
  edges.forEach(([i, j], k) => {
    neighbend[i]!.push(2 * k + 1)
    neighbend[j]!.push(2 * k)
  })

  const mate: number[] = new Array(nvertex).fill(-1)
  // Label of a vertex or blossom: 0 free, 1 S (outer), 2 T (inner); bit 4 marks it while a blossom is searched for.
  const label: number[] = new Array(2 * nvertex).fill(0)
  const labelend: number[] = new Array(2 * nvertex).fill(-1)
  const inblossom: number[] = Array.from({ length: nvertex }, (_, v) => v)
  const blossomparent: number[] = new Array(2 * nvertex).fill(-1)
  const blossomchilds: Array<number[] | null> = new Array(2 * nvertex).fill(null)
  const blossombase: number[] = [...Array.from({ length: nvertex }, (_, v) => v), ...new Array<number>(nvertex).fill(-1)]
  const blossomendps: Array<number[] | null> = new Array(2 * nvertex).fill(null)
  const bestedge: number[] = new Array(2 * nvertex).fill(-1)
  const blossombestedges: Array<number[] | null> = new Array(2 * nvertex).fill(null)
  const unusedblossoms: number[] = Array.from({ length: nvertex }, (_, b) => nvertex + b)
  const dualvar: number[] = [...new Array<number>(nvertex).fill(maxweight), ...new Array<number>(nvertex).fill(0)]
  const allowedge: boolean[] = new Array(nedge).fill(false)
  let queue: number[] = []

  const slack = (k: number): number => {
    const [i, j, wt] = edges[k]!
    return dualvar[i]! + dualvar[j]! - 2 * wt
  }

  const blossomLeaves = (b: number): number[] => {
    if (b < nvertex) {
      return [b]
    }
    const leaves: number[] = []
    for (const t of blossomchilds[b]!) {
      if (t < nvertex) {
        leaves.push(t)
      }
      else {
        leaves.push(...blossomLeaves(t))
      }
    }
    return leaves
  }

  const assignLabel = (w: number, t: number, p: number): void => {
    const b = inblossom[w]!
    label[w] = label[b] = t
    labelend[w] = labelend[b] = p
    bestedge[w] = bestedge[b] = -1
    if (t === 1) {
      queue.push(...blossomLeaves(b))
    }
    else if (t === 2) {
      const base = blossombase[b]!
      assignLabel(endpoint[mate[base]!]!, 1, mate[base]! ^ 1)
    }
  }

  // Trace back from v and w to find a new blossom's base, or -1 when the two paths reach different roots.
  const scanBlossom = (v0: number, w0: number): number => {
    let v = v0
    let w = w0
    const path: number[] = []
    let base = -1
    while (v !== -1 || w !== -1) {
      let b = inblossom[v]!
      if (label[b]! & 4) {
        base = blossombase[b]!
        break
      }
      path.push(b)
      label[b] = 5
      if (labelend[b] === -1) {
        v = -1
      }
      else {
        v = endpoint[labelend[b]!]!
        b = inblossom[v]!
        v = endpoint[labelend[b]!]!
      }
      if (w !== -1) {
        ;[v, w] = [w, v]
      }
    }
    for (const b of path) {
      label[b] = 1
    }
    return base
  }

  const addBlossom = (base: number, k: number): void => {
    let [v, w] = edges[k]!
    const bb = inblossom[base]!
    let bv = inblossom[v]!
    let bw = inblossom[w]!
    const b = unusedblossoms.pop()!
    blossombase[b] = base
    blossomparent[b] = -1
    blossomparent[bb] = b
    const path: number[] = []
    const endps: number[] = []
    blossomchilds[b] = path
    blossomendps[b] = endps
    while (bv !== bb) {
      blossomparent[bv] = b
      path.push(bv)
      endps.push(labelend[bv]!)
      v = endpoint[labelend[bv]!]!
      bv = inblossom[v]!
    }
    path.push(bb)
    path.reverse()
    endps.reverse()
    endps.push(2 * k)
    while (bw !== bb) {
      blossomparent[bw] = b
      path.push(bw)
      endps.push(labelend[bw]! ^ 1)
      w = endpoint[labelend[bw]!]!
      bw = inblossom[w]!
    }
    label[b] = 1
    labelend[b] = labelend[bb]!
    dualvar[b] = 0
    for (const leaf of blossomLeaves(b)) {
      if (label[inblossom[leaf]!] === 2) {
        queue.push(leaf)
      }
      inblossom[leaf] = b
    }
    // The least-slack edge from the new blossom to each other S-blossom.
    const bestedgeto: number[] = new Array(2 * nvertex).fill(-1)
    for (const sub of path) {
      const lists: number[][] = blossombestedges[sub] === null
        ? blossomLeaves(sub).map(leaf => neighbend[leaf]!.map(p => p >> 1))
        : [blossombestedges[sub]!]
      for (const list of lists) {
        for (const edge of list) {
          const [i, j] = edges[edge]!
          // The end of the edge that is outside the new blossom.
          const bj = inblossom[j]! === b ? inblossom[i]! : inblossom[j]!
          if (bj !== b && label[bj] === 1 && (bestedgeto[bj] === -1 || slack(edge) < slack(bestedgeto[bj]!))) {
            bestedgeto[bj] = edge
          }
        }
      }
      blossombestedges[sub] = null
      bestedge[sub] = -1
    }
    blossombestedges[b] = bestedgeto.filter(edge => edge !== -1)
    bestedge[b] = -1
    for (const edge of blossombestedges[b]!) {
      if (bestedge[b] === -1 || slack(edge) < slack(bestedge[b]!)) {
        bestedge[b] = edge
      }
    }
  }

  const expandBlossom = (b: number, endstage: boolean): void => {
    for (const s of blossomchilds[b]!) {
      blossomparent[s] = -1
      if (s < nvertex) {
        inblossom[s] = s
      }
      else if (endstage && dualvar[s] === 0) {
        expandBlossom(s, endstage)
      }
      else {
        for (const leaf of blossomLeaves(s)) {
          inblossom[leaf] = s
        }
      }
    }
    if (!endstage && label[b] === 2) {
      // The blossom was reached through a T-label: relabel the path through it.
      const entrychild = inblossom[endpoint[labelend[b]! ^ 1]!]!
      const childs = blossomchilds[b]!
      const endps = blossomendps[b]!
      let j = childs.indexOf(entrychild)
      let jstep: number
      let endptrick: number
      if (j & 1) {
        j -= childs.length
        jstep = 1
        endptrick = 0
      }
      else {
        jstep = -1
        endptrick = 1
      }
      const at = (list: number[], index: number): number => list[((index % list.length) + list.length) % list.length]!
      let p = labelend[b]!
      while (j !== 0) {
        label[endpoint[p ^ 1]!] = 0
        label[endpoint[at(endps, j - endptrick) ^ endptrick ^ 1]!] = 0
        assignLabel(endpoint[p ^ 1]!, 2, p)
        allowedge[at(endps, j - endptrick) >> 1] = true
        j += jstep
        p = at(endps, j - endptrick) ^ endptrick
        allowedge[p >> 1] = true
        j += jstep
      }
      let bv = at(childs, j)
      label[endpoint[p ^ 1]!] = label[bv] = 2
      labelend[endpoint[p ^ 1]!] = labelend[bv] = p
      bestedge[bv] = -1
      j += jstep
      while (at(childs, j) !== entrychild) {
        bv = at(childs, j)
        if (label[bv] === 1) {
          j += jstep
          continue
        }
        let v = -1
        for (const leaf of blossomLeaves(bv)) {
          v = leaf
          if (label[leaf] !== 0) {
            break
          }
        }
        if (label[v] !== 0) {
          label[v] = 0
          label[endpoint[mate[blossombase[bv]!]!]!] = 0
          assignLabel(v, 2, labelend[v]!)
        }
        j += jstep
      }
    }
    label[b] = labelend[b] = -1
    blossomchilds[b] = blossomendps[b] = null
    blossombase[b] = -1
    blossombestedges[b] = null
    bestedge[b] = -1
    unusedblossoms.push(b)
  }

  // Swap matched and unmatched edges over an alternating path inside blossom b, from the sub-blossom with v to the base.
  const augmentBlossom = (b: number, v: number): void => {
    let t = v
    while (blossomparent[t] !== b) {
      t = blossomparent[t]!
    }
    if (t >= nvertex) {
      augmentBlossom(t, v)
    }
    const childs = blossomchilds[b]!
    const endps = blossomendps[b]!
    const i = childs.indexOf(t)
    let j = i
    let jstep: number
    let endptrick: number
    if (i & 1) {
      j -= childs.length
      jstep = 1
      endptrick = 0
    }
    else {
      jstep = -1
      endptrick = 1
    }
    const at = (list: number[], index: number): number => list[((index % list.length) + list.length) % list.length]!
    while (j !== 0) {
      j += jstep
      t = at(childs, j)
      const p = at(endps, j - endptrick) ^ endptrick
      if (t >= nvertex) {
        augmentBlossom(t, endpoint[p]!)
      }
      j += jstep
      t = at(childs, j)
      if (t >= nvertex) {
        augmentBlossom(t, endpoint[p ^ 1]!)
      }
      mate[endpoint[p]!] = p ^ 1
      mate[endpoint[p ^ 1]!] = p
    }
    blossomchilds[b] = [...childs.slice(i), ...childs.slice(0, i)]
    blossomendps[b] = [...endps.slice(i), ...endps.slice(0, i)]
    blossombase[b] = blossombase[blossomchilds[b]![0]!]!
  }

  // Swap matched and unmatched edges over the augmenting path through edge k.
  const augmentMatching = (k: number): void => {
    const [v, w] = edges[k]!
    for (const [s0, p0] of [[v, 2 * k + 1], [w, 2 * k]] as const) {
      let s: number = s0
      let p: number = p0
      for (;;) {
        const bs = inblossom[s]!
        if (bs >= nvertex) {
          augmentBlossom(bs, s)
        }
        mate[s] = p
        if (labelend[bs] === -1) {
          break
        }
        const t = endpoint[labelend[bs]!]!
        const bt = inblossom[t]!
        s = endpoint[labelend[bt]!]!
        const j = endpoint[labelend[bt]! ^ 1]!
        if (bt >= nvertex) {
          augmentBlossom(bt, j)
        }
        mate[j] = labelend[bt]!
        p = labelend[bt]! ^ 1
      }
    }
  }

  // The main loop: one stage per vertex finds one augmenting path (or ends the search).
  for (let stage = 0; stage < nvertex; stage += 1) {
    label.fill(0)
    bestedge.fill(-1)
    for (let b = nvertex; b < 2 * nvertex; b += 1) {
      blossombestedges[b] = null
    }
    allowedge.fill(false)
    queue = []
    for (let v = 0; v < nvertex; v += 1) {
      if (mate[v] === -1 && label[inblossom[v]!] === 0) {
        assignLabel(v, 1, -1)
      }
    }
    let augmented = false
    for (;;) {
      // Label and scan until an augmenting path is found or no more can be done at this dual.
      while (queue.length > 0 && !augmented) {
        const v = queue.pop()!
        for (const p of neighbend[v]!) {
          const k = p >> 1
          const w = endpoint[p]!
          if (inblossom[v] === inblossom[w]) {
            continue
          }
          let kslack = 0
          if (!allowedge[k]) {
            kslack = slack(k)
            if (kslack <= 0) {
              allowedge[k] = true
            }
          }
          if (allowedge[k]) {
            if (label[inblossom[w]!] === 0) {
              assignLabel(w, 2, p ^ 1)
            }
            else if (label[inblossom[w]!] === 1) {
              const base = scanBlossom(v, w)
              if (base >= 0) {
                addBlossom(base, k)
              }
              else {
                augmentMatching(k)
                augmented = true
                break
              }
            }
            else if (label[w] === 0) {
              label[w] = 2
              labelend[w] = p ^ 1
            }
          }
          else if (label[inblossom[w]!] === 1) {
            const b = inblossom[v]!
            if (bestedge[b] === -1 || kslack < slack(bestedge[b]!)) {
              bestedge[b] = k
            }
          }
          else if (label[w] === 0) {
            if (bestedge[w] === -1 || kslack < slack(bestedge[w]!)) {
              bestedge[w] = k
            }
          }
        }
      }
      if (augmented) {
        break
      }

      // No path at this dual: change it by the smallest delta that makes a new edge tight (or ends the search).
      let deltatype = -1
      let delta = 0
      let deltaedge = -1
      let deltablossom = -1
      if (!maxCardinality) {
        deltatype = 1
        delta = Math.min(...dualvar.slice(0, nvertex))
      }
      for (let v = 0; v < nvertex; v += 1) {
        if (label[inblossom[v]!] === 0 && bestedge[v] !== -1) {
          const d = slack(bestedge[v]!)
          if (deltatype === -1 || d < delta) {
            delta = d
            deltatype = 2
            deltaedge = bestedge[v]!
          }
        }
      }
      for (let b = 0; b < 2 * nvertex; b += 1) {
        if (blossomparent[b] === -1 && label[b] === 1 && bestedge[b] !== -1) {
          const d = slack(bestedge[b]!) / 2
          if (deltatype === -1 || d < delta) {
            delta = d
            deltatype = 3
            deltaedge = bestedge[b]!
          }
        }
      }
      for (let b = nvertex; b < 2 * nvertex; b += 1) {
        if (blossombase[b]! >= 0 && blossomparent[b] === -1 && label[b] === 2 && (deltatype === -1 || dualvar[b]! < delta)) {
          delta = dualvar[b]!
          deltatype = 4
          deltablossom = b
        }
      }
      if (deltatype === -1) {
        deltatype = 1
        delta = Math.max(0, Math.min(...dualvar.slice(0, nvertex)))
      }
      for (let v = 0; v < nvertex; v += 1) {
        if (label[inblossom[v]!] === 1) {
          dualvar[v]! -= delta
        }
        else if (label[inblossom[v]!] === 2) {
          dualvar[v]! += delta
        }
      }
      for (let b = nvertex; b < 2 * nvertex; b += 1) {
        if (blossombase[b]! >= 0 && blossomparent[b] === -1) {
          if (label[b] === 1) {
            dualvar[b]! += delta
          }
          else if (label[b] === 2) {
            dualvar[b]! -= delta
          }
        }
      }
      if (deltatype === 1) {
        break
      }
      else if (deltatype === 2) {
        allowedge[deltaedge] = true
        const [i, j] = edges[deltaedge]!
        // The end of the edge that is in an S-blossom (labelled), not the free one.
        queue.push(label[inblossom[i]!] === 0 ? j : i)
      }
      else if (deltatype === 3) {
        allowedge[deltaedge] = true
        const [i] = edges[deltaedge]!
        queue.push(i)
      }
      else if (deltatype === 4) {
        expandBlossom(deltablossom, false)
      }
    }
    if (!augmented) {
      break
    }
    // End of a stage: expand the S-blossoms whose dual is zero.
    for (let b = nvertex; b < 2 * nvertex; b += 1) {
      if (blossomparent[b] === -1 && blossombase[b]! >= 0 && label[b] === 1 && dualvar[b] === 0) {
        expandBlossom(b, true)
      }
    }
  }

  for (let v = 0; v < nvertex; v += 1) {
    if (mate[v]! >= 0) {
      mate[v] = endpoint[mate[v]!]!
    }
  }
  return mate
}
