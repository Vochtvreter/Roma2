// src/game/world/heap.ts — a binary min-heap of tile indices keyed by priority (Dijkstra / A*). Owner: WP-A.
// Typed-array storage. Equal priorities pop the lower tile index first, so searches are deterministic whatever
// order the neighbours were pushed in.

/** Min-heap of (tile, priority) pairs; equal priorities pop the lowest tile first. */
export class MinHeap {
  private v: Int32Array;
  private p: Float64Array;
  private n = 0;

  /** Creates an empty heap with an initial capacity. */
  constructor(capacity = 1024) {
    this.v = new Int32Array(capacity);
    this.p = new Float64Array(capacity);
  }

  /** Number of queued entries. */
  get size(): number {
    return this.n;
  }

  /** Priority of the entry that would pop next. */
  peekPri(): number {
    return this.p[0];
  }

  /** Queues a tile with a priority. */
  push(tile: number, pri: number): void {
    if (this.n === this.v.length) {
      const v = new Int32Array(this.n * 2); v.set(this.v); this.v = v;
      const p = new Float64Array(this.n * 2); p.set(this.p); this.p = p;
    }
    const V = this.v, P = this.p;
    let k = this.n++;
    while (k > 0) {
      const u = (k - 1) >> 1;
      if (P[u] < pri || (P[u] === pri && V[u] < tile)) break;
      V[k] = V[u]; P[k] = P[u];
      k = u;
    }
    V[k] = tile; P[k] = pri;
  }

  /** Removes and returns the tile with the lowest priority. */
  pop(): number {
    const V = this.v, P = this.p;
    const top = V[0];
    const n = --this.n;
    if (n > 0) {
      const tv = V[n], tp = P[n];
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        if (l >= n) break;
        const r = l + 1;
        let m = l;
        if (r < n && (P[r] < P[l] || (P[r] === P[l] && V[r] < V[l]))) m = r;
        if (P[m] > tp || (P[m] === tp && V[m] > tv)) break;
        V[k] = V[m]; P[k] = P[m];
        k = m;
      }
      V[k] = tv; P[k] = tp;
    }
    return top;
  }
}
