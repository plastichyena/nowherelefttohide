import { existsSync, lstatSync, mkdirSync, realpathSync, type Stats } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { SessionError } from './types';

/**
 * A filesystem root whose lexical and physical locations are both verified.
 * Storage callers create this once, then use it for every Session input/output
 * path so a symlink or Windows reparse point cannot escape the Store root.
 */
export interface SafePathRoot {
  readonly lexicalPath: string;
  readonly realPath: string;
}

const PATH_VIOLATION = 'unsafe_path';

function fail(subject: string, detail: string): never {
  throw new SessionError(PATH_VIOLATION, `${subject} is unsafe: ${detail}`);
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US')
    : left === right;
}

function isWithin(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation));
}

function traversalFree(path: string): boolean {
  return !path.split(/[\\/]+/u).includes('..');
}

function lstatRequired(path: string, subject: string): Stats {
  try { return lstatSync(path); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') fail(subject, 'required path does not exist');
    throw error;
  }
}

function assertOrdinaryNode(path: string, subject: string): Stats {
  const node = lstatRequired(path, subject);
  // Node reports Windows junctions and other reparse links as symbolic links.
  if (node.isSymbolicLink()) fail(subject, 'symbolic link or reparse point is not permitted');
  return node;
}

function relativeComponents(root: SafePathRoot, candidate: string, subject: string): string[] {
  if (!isWithin(root.lexicalPath, candidate)) fail(subject, 'path escapes the configured root');
  const relation = relative(root.lexicalPath, candidate);
  return relation === '' ? [] : relation.split(sep);
}

function assertPhysicalContainment(root: SafePathRoot, path: string, subject: string): void {
  const physical = realpathSync.native(path);
  if (!isWithin(root.realPath, physical)) fail(subject, 'resolved path escapes the configured root');
}

function resolveCandidate(root: SafePathRoot, candidatePath: string, subject: string): string {
  if (typeof candidatePath !== 'string' || candidatePath.length === 0) fail(subject, 'path must be non-empty');
  if (!traversalFree(candidatePath)) fail(subject, 'parent traversal is not permitted');
  const candidate = isAbsolute(candidatePath) ? resolve(candidatePath) : resolve(root.lexicalPath, candidatePath);
  relativeComponents(root, candidate, subject);
  return candidate;
}

/** Opens an existing, ordinary directory as a no-link Session Store root. */
export function createSafePathRoot(rootPath: string): SafePathRoot {
  const lexicalPath = resolve(rootPath);
  const root = assertOrdinaryNode(lexicalPath, 'Session root');
  if (!root.isDirectory()) fail('Session root', 'root must be a directory');
  const realPath = realpathSync.native(lexicalPath);
  // This also catches a reparse point in an ancestor of the supplied root.
  if (!samePath(lexicalPath, realPath)) fail('Session root', 'root resolves through a symbolic link or reparse point');
  return Object.freeze({ lexicalPath, realPath });
}

/**
 * Resolves an existing input file inside root. Every existing ancestor is
 * lstat'ed and realpath-checked before it is returned for reading.
 */
export function assertSafeInputFile(root: SafePathRoot, candidatePath: string): string {
  const candidate = resolveCandidate(root, candidatePath, 'Session input');
  let current = root.lexicalPath;
  for (const component of relativeComponents(root, candidate, 'Session input')) {
    current = resolve(current, component);
    const node = assertOrdinaryNode(current, 'Session input');
    assertPhysicalContainment(root, current, 'Session input');
    if (current !== candidate && !node.isDirectory()) fail('Session input', 'parent is not a directory');
  }
  const target = assertOrdinaryNode(candidate, 'Session input');
  assertPhysicalContainment(root, candidate, 'Session input');
  if (!target.isFile()) fail('Session input', 'input must be a regular file');
  return candidate;
}

/** Resolves an existing directory inside root with the same no-link checks. */
export function assertSafeInputDirectory(root: SafePathRoot, candidatePath = '.'): string {
  const candidate = resolveCandidate(root, candidatePath, 'Session directory');
  let current = root.lexicalPath;
  for (const component of relativeComponents(root, candidate, 'Session directory')) {
    current = resolve(current, component);
    const node = assertOrdinaryNode(current, 'Session directory');
    assertPhysicalContainment(root, current, 'Session directory');
    if (!node.isDirectory()) fail('Session directory', 'path must be a directory');
  }
  return candidate;
}

/**
 * Creates an ordinary directory under root, checking every pre-existing and
 * newly-created component. Use this before writing an Artifact or payload.
 */
export function ensureSafeOutputDirectory(root: SafePathRoot, directoryPath: string): string {
  const directory = resolveCandidate(root, directoryPath, 'Session output');
  let current = root.lexicalPath;
  for (const component of relativeComponents(root, directory, 'Session output')) {
    current = resolve(current, component);
    if (!existsSync(current)) mkdirSync(current);
    const node = assertOrdinaryNode(current, 'Session output');
    assertPhysicalContainment(root, current, 'Session output');
    if (!node.isDirectory()) fail('Session output', 'parent is not a directory');
  }
  return directory;
}

/**
 * Verifies a write target is rooted under root and every existing ancestor is
 * ordinary. Call ensureSafeOutputDirectory for its parent before opening it.
 */
export function assertSafeOutputPath(root: SafePathRoot, candidatePath: string): string {
  const candidate = resolveCandidate(root, candidatePath, 'Session output');
  let current = root.lexicalPath;
  const components = relativeComponents(root, candidate, 'Session output');
  for (let index = 0; index < components.length; index += 1) {
    current = resolve(current, components[index]!);
    if (!existsSync(current)) break;
    const node = assertOrdinaryNode(current, 'Session output');
    assertPhysicalContainment(root, current, 'Session output');
    if (index < components.length - 1 && !node.isDirectory()) fail('Session output', 'parent is not a directory');
  }
  return candidate;
}