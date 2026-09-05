import type { JsonValue } from '../core/types';
import { cloneJson } from '../agent/action';
import { SessionError, type JsonPatchOperation } from './types';

const FORBIDDEN_PATH_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function validateSegment(segment: unknown): asserts segment is string | number {
  if (typeof segment === 'string') {
    if (FORBIDDEN_PATH_KEYS.has(segment)) throw new SessionError('public_diff_invalid', `Forbidden patch path segment: ${segment}`);
    return;
  }
  if (typeof segment !== 'number' || !Number.isSafeInteger(segment) || segment < 0) {
    throw new SessionError('public_diff_invalid', 'Patch array indices must be non-negative safe integers');
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonical(record[key])]));
  }
  return value;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

/** A JSON-only, browser-safe and lossless structural diff. Array order is significant. */
export function createLosslessJsonDiff(before: JsonValue, after: JsonValue): JsonPatchOperation[] {
  const operations: JsonPatchOperation[] = [];
  const visit = (left: JsonValue, right: JsonValue, path: Array<string | number>): void => {
    if (same(left, right)) return;
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) {
        let prefix = 0;
        while (prefix < left.length && prefix < right.length && same(left[prefix], right[prefix])) prefix += 1;
        let suffix = 0;
        while (suffix < left.length - prefix && suffix < right.length - prefix && same(left[left.length - 1 - suffix], right[right.length - 1 - suffix])) suffix += 1;
        operations.push({ op: 'splice', path, index: prefix, deleteCount: left.length - prefix - suffix, values: cloneJson(right.slice(prefix, right.length - suffix)) });
        return;
      }
      for (let index = 0; index < right.length; index += 1) visit(left[index]!, right[index]!, [...path, index]);
      return;
    }
    if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
      const leftRecord = left as Record<string, JsonValue>;
      const rightRecord = right as Record<string, JsonValue>;
      for (const key of [...Object.keys(leftRecord), ...Object.keys(rightRecord)]) validateSegment(key);
      for (const key of Object.keys(leftRecord).filter((key) => !Object.prototype.hasOwnProperty.call(rightRecord, key)).sort()) operations.push({ op: 'delete', path: [...path, key] });
      for (const key of Object.keys(rightRecord).sort()) {
        if (!Object.prototype.hasOwnProperty.call(leftRecord, key)) operations.push({ op: 'set', path: [...path, key], value: cloneJson(rightRecord[key]!) });
        else visit(leftRecord[key]!, rightRecord[key]!, [...path, key]);
      }
      return;
    }
    operations.push({ op: 'set', path, value: cloneJson(right) });
  };
  visit(before, after, []);
  return operations;
}

export function applyLosslessJsonDiff(before: JsonValue, operations: readonly JsonPatchOperation[]): JsonValue {
  let root = cloneJson(before);
  for (const operation of operations) {
    validateLosslessJsonDiffOperations([operation]);
    if (operation.op === 'splice') {
      if (!Number.isSafeInteger(operation.index) || operation.index < 0 || !Number.isSafeInteger(operation.deleteCount) || operation.deleteCount < 0 || !Array.isArray(operation.values)) throw new SessionError('public_diff_invalid', 'Patch splice bounds and values are invalid');
      let target: unknown = root;
      for (const segment of operation.path) {
        if (target === null || typeof target !== 'object') throw new SessionError('public_diff_invalid', 'Patch splice path does not resolve to an array');
        if (Array.isArray(target)) {
          if (typeof segment !== 'number' || segment >= target.length) throw new SessionError('public_diff_invalid', 'Patch splice array path is out of bounds');
        } else if (typeof segment !== 'string' || !Object.prototype.hasOwnProperty.call(target, segment)) throw new SessionError('public_diff_invalid', 'Patch splice object path does not exist');
        target = (target as Record<string | number, unknown>)[segment];
      }
      if (!Array.isArray(target) || operation.index > target.length || operation.index + operation.deleteCount > target.length) throw new SessionError('public_diff_invalid', 'Patch splice range is out of bounds');
      target.splice(operation.index, operation.deleteCount, ...cloneJson(operation.values));
      continue;
    }
    if (operation.path.length === 0) {
      if (operation.op !== 'set') throw new SessionError('public_diff_invalid', 'A root patch must be a set operation');
      root = cloneJson(operation.value);
      continue;
    }
    let parent: unknown = root;
    for (const segment of operation.path.slice(0, -1)) {
      if (parent === null || typeof parent !== 'object') throw new SessionError('public_diff_invalid', 'Patch path does not resolve to a container');
      if (Array.isArray(parent)) {
        if (typeof segment !== 'number' || segment >= parent.length) throw new SessionError('public_diff_invalid', 'Patch array path is out of bounds');
      } else if (typeof segment !== 'string' || !Object.prototype.hasOwnProperty.call(parent, segment)) {
        throw new SessionError('public_diff_invalid', 'Patch object path does not exist');
      }
      parent = (parent as Record<string | number, unknown>)[segment];
    }
    if (parent === null || typeof parent !== 'object') throw new SessionError('public_diff_invalid', 'Patch parent is not a container');
    const key = operation.path.at(-1)!;
    if (operation.op === 'delete') {
      if (Array.isArray(parent)) {
        if (typeof key !== 'number' || key >= parent.length) throw new SessionError('public_diff_invalid', 'Patch delete array index is out of bounds');
        parent.splice(key, 1);
      } else {
        if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(parent, key)) throw new SessionError('public_diff_invalid', 'Patch delete object key does not exist');
        delete (parent as Record<string, unknown>)[key];
      }
    } else {
      if (!Object.prototype.hasOwnProperty.call(operation, 'value')) throw new SessionError('public_diff_invalid', 'Patch set operation requires a value');
      if (Array.isArray(parent)) {
        if (typeof key !== 'number' || key >= parent.length) throw new SessionError('public_diff_invalid', 'Patch set array index is out of bounds');
        parent[key] = cloneJson(operation.value);
      } else {
        if (typeof key !== 'string') throw new SessionError('public_diff_invalid', 'Patch object key must be a string');
        (parent as Record<string, unknown>)[key] = cloneJson(operation.value);
      }
    }
  }
  return root;
}

/** Validates an untrusted persisted patch without needing its full base document. */
export function validateLosslessJsonDiffOperations(operations: unknown): asserts operations is JsonPatchOperation[] {
  if (!Array.isArray(operations)) throw new SessionError('public_diff_invalid', 'Patch operations must be an array');
  for (const operation of operations) {
    if (operation === null || typeof operation !== 'object') throw new SessionError('public_diff_invalid', 'Patch operation must be an object');
    const candidate = operation as Partial<JsonPatchOperation>;
    if ((candidate.op !== 'set' && candidate.op !== 'delete' && candidate.op !== 'splice') || !Array.isArray(candidate.path)) throw new SessionError('public_diff_invalid', 'Patch operation must have a known op and path array');
    candidate.path.forEach(validateSegment);
    if (candidate.op === 'set' && !Object.prototype.hasOwnProperty.call(candidate, 'value')) throw new SessionError('public_diff_invalid', 'Patch set operation requires a value');
    if (candidate.op === 'splice' && (!Number.isSafeInteger(candidate.index) || candidate.index! < 0 || !Number.isSafeInteger(candidate.deleteCount) || candidate.deleteCount! < 0 || !Array.isArray(candidate.values))) throw new SessionError('public_diff_invalid', 'Patch splice bounds and values are invalid');
  }
}
