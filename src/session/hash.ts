import { createHash, timingSafeEqual } from 'node:crypto';
import type { JsonValue } from '../core/types';
import {
  MAX_DECISION_SUMMARY_CODE_POINTS,
  SessionError,
  type PublicDecisionRecord,
} from './types';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  const encoded = JSON.stringify(canonicalize(value));
  if (encoded === undefined) throw new SessionError('not_json', 'Value is not JSON serializable');
  return encoded;
}

export function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function sha256Json(value: unknown): string {
  return sha256Text(canonicalJson(value));
}

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

export function hashesEqual(left: string, right: string): boolean {
  if (!isSha256(left) || !isSha256(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function integrityHash<T extends Record<string, unknown>>(value: T, field: keyof T): string {
  const copy = { ...value };
  delete copy[field];
  return sha256Json(copy);
}

export function assertSafeIdentifier(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER_PATTERN.test(value) || value === '.' || value === '..') {
    throw new SessionError('invalid_identifier', `${name} must be 1-128 safe ASCII characters`);
  }
}

export function normalizeDecisionSummary(value: unknown): string {
  if (typeof value !== 'string') throw new SessionError('invalid_step_input', 'decisionSummary must be a Unicode string');
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  if (length < 1 || length > MAX_DECISION_SUMMARY_CODE_POINTS) {
    throw new SessionError(
      'invalid_step_input',
      `decisionSummary must contain 1-${MAX_DECISION_SUMMARY_CODE_POINTS} Unicode characters after trimming`,
    );
  }
  return normalized;
}

export function decisionHash(record: Omit<PublicDecisionRecord, 'decisionHash'>): string {
  return sha256Json(record);
}

export function asJsonValue(value: unknown, name = 'value'): JsonValue {
  try {
    return JSON.parse(canonicalJson(value)) as JsonValue;
  } catch (error) {
    if (error instanceof SessionError) throw error;
    throw new SessionError('not_json', `${name} is not JSON serializable`);
  }
}
