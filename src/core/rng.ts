import type { RngState } from './types';

const UINT32_SIZE = 0x1_0000_0000;
const NON_ZERO_FALLBACK = 0x6d2b79f5;

function asUint32(value: number): number {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
    throw new Error('SeededRng values must be finite safe integers');
  }
  return value >>> 0;
}

function asCallCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('SeededRng call count must be a non-negative safe integer');
  }
  return value;
}

/** A serializable snapshot of SeededRng state. */
export type RngSnapshot = RngState;

/**
 * Small deterministic xorshift32 PRNG.
 *
 * It is intended for reproducible game rules, not cryptography. Every method
 * advances the same uint32 stream, and snapshot()/restore() make the stream
 * safe to persist inside a GameState or save file.
 */
export class SeededRng {
  public readonly algorithm = 'xorshift32-v1' as const;

  private readonly initialSeed: number;
  private currentState: number;
  private callCount: number;

  public constructor(seedOrState: number | RngState = 0) {
    if (typeof seedOrState === 'number') {
      const seed = asUint32(seedOrState);
      this.initialSeed = seed;
      this.currentState = seed === 0 ? NON_ZERO_FALLBACK : seed;
      this.callCount = 0;
      return;
    }

    if (seedOrState.algorithm !== 'xorshift32-v1') {
      throw new Error(`Unsupported RNG algorithm: ${String(seedOrState.algorithm)}`);
    }
    this.initialSeed = asUint32(seedOrState.seed);
    this.currentState = asUint32(seedOrState.state) || NON_ZERO_FALLBACK;
    this.callCount = asCallCount(seedOrState.calls);
  }

  public static fromState(state: RngState): SeededRng {
    return new SeededRng(state);
  }

  public get seed(): number {
    return this.initialSeed;
  }

  public get state(): number {
    return this.currentState;
  }

  public get calls(): number {
    return this.callCount;
  }

  /** Advance and return an unsigned 32-bit value. */
  public nextUint32(): number {
    let value = this.currentState;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.currentState = value >>> 0;
    // xorshift32 has a zero lock-up state. State snapshots from untrusted save
    // data are normalized here so one bad state cannot break determinism.
    if (this.currentState === 0) {
      this.currentState = NON_ZERO_FALLBACK;
    }
    this.callCount += 1;
    return this.currentState;
  }

  /** Return a deterministic float in [0, 1). */
  public nextFloat(): number {
    return this.nextUint32() / UINT32_SIZE;
  }

  /** Return an inclusive integer in [min, max]. */
  public nextInt(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
      throw new Error('SeededRng.nextInt requires safe integer bounds with min <= max');
    }
    const span = max - min + 1;
    if (span <= 0 || span > UINT32_SIZE) {
      throw new Error('SeededRng.nextInt range must fit in uint32');
    }

    // Rejection sampling avoids modulo bias when span does not divide 2^32.
    const limit = UINT32_SIZE - (UINT32_SIZE % span);
    let value: number;
    do {
      value = this.nextUint32();
    } while (value >= limit);
    return min + (value % span);
  }

  /** Alias useful when the caller thinks in terms of a random integer. */
  public randomInt(min: number, max: number): number {
    return this.nextInt(min, max);
  }

  /** Return true with the requested probability (default 50%). */
  public nextBoolean(probability = 0.5): boolean {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new Error('SeededRng.nextBoolean probability must be between 0 and 1');
    }
    return this.nextFloat() < probability;
  }

  /** Alias used by rules that describe a Bernoulli draw as a coin flip. */
  public chance(probability: number): boolean {
    return this.nextBoolean(probability);
  }

  /** Select one element, or throw for an empty collection. */
  public pick<T>(values: readonly T[]): T {
    if (values.length === 0) {
      throw new Error('SeededRng.pick cannot choose from an empty collection');
    }
    return values[this.nextInt(0, values.length - 1)];
  }

  /** Return a shuffled copy, leaving the source array untouched. */
  public shuffle<T>(values: readonly T[]): T[] {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = this.nextInt(0, index);
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  }

  public snapshot(): RngState {
    return {
      algorithm: this.algorithm,
      seed: this.initialSeed,
      state: this.currentState,
      calls: this.callCount,
    };
  }

  public serialize(): RngState {
    return this.snapshot();
  }

  public restore(state: RngState): void {
    if (state.algorithm !== this.algorithm) {
      throw new Error(`Unsupported RNG algorithm: ${String(state.algorithm)}`);
    }
    if (asUint32(state.seed) !== this.initialSeed) {
      throw new Error('RNG seed cannot change when restoring an existing stream');
    }
    this.currentState = asUint32(state.state) || NON_ZERO_FALLBACK;
    this.callCount = asCallCount(state.calls);
  }

  public clone(): SeededRng {
    return SeededRng.fromState(this.snapshot());
  }
}

export const createSeededRng = (seed: number): SeededRng => new SeededRng(seed);
