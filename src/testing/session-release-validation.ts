import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { resolveSessionIdentity } from '../session/agent-adapter';
import { SessionService } from '../session/service';
import { sha256Json } from '../session/hash';
import { SessionStore } from '../session/store';
import type { GameAction, JsonValue } from '../core/types';
import { ZERO_HASH } from '../session/types';
import type { SessionGameFactory, SessionGameRuntime, SessionQueryResult } from '../session/types';
import { createSessionReleaseFixtureFactory } from './session-release-fixture';
import type { SessionStatusProbeReport } from './session-status-probe';
interface ParsedArguments {
    decisions: number;
    largeMiB: number | null;
    jsonOut: string | null;
}
interface DirectoryStats {
    bytes: number;
    files: number;
}
interface StageTimings {
    setupMs: number;
    oldFormatCaptureMs: number;
    referenceStepMs: number;
    sessionStepMs: number;
    storageScanMs: number;
    queryMs: number;
    statusMs: number;
    checkpointBranchMs: number;
    artifactMs: number;
    historyLengthComparisonMs: number;
    totalMs: number;
}
const STATUS_SAMPLES = 9;
const NORMAL_STORAGE_SAMPLE_INTERVAL = 25;
const LARGE_STORAGE_SAMPLE_INTERVAL = 1000;
const LARGE_MAX_DECISIONS = 2000000;
function usage(): string {
    return [
        'Usage: npx --no-install vite-node --script src/testing/session-release-validation.ts',
        '--decisions 1000 [--large-mib 512] [--json-out output/session-release.json]',
    ].join(' ') + '\n';
}
function parseInteger(argument: string, name: string, minimum: number): number {
    if (!/^\d+$/u.test(argument))
        throw new Error(`${name} must be an integer`);
    const value = Number(argument);
    if (!Number.isSafeInteger(value) || value < minimum)
        throw new Error(`${name} must be at least ${minimum}`);
    return value;
}
export function parseSessionReleaseArguments(argv: readonly string[]): ParsedArguments {
    let decisions = 1000;
    let largeMiB: number | null = null;
    let jsonOut: string | null = null;
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index]!;
        const take = (name: string): string => {
            const inline = argument.startsWith(`${name}=`) ? argument.slice(name.length + 1) : null;
            if (inline !== null)
                return inline;
            if (argument !== name || index + 1 >= argv.length)
                throw new Error(`${name} requires a value`);
            index += 1;
            return argv[index]!;
        };
        if (argument === '--help')
            throw new Error(usage());
        if (argument === '--decisions' || argument.startsWith('--decisions='))
            decisions = parseInteger(take('--decisions'), '--decisions', 1);
        else if (argument === '--large-mib' || argument.startsWith('--large-mib='))
            largeMiB = parseInteger(take('--large-mib'), '--large-mib', 1);
        else if (argument === '--json-out' || argument.startsWith('--json-out='))
            jsonOut = take('--json-out');
        else
            throw new Error(`Unknown option: ${argument}`);
    }
    return { decisions, largeMiB, jsonOut };
}
function bytes(value: unknown): number {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
function assert(condition: unknown, message: string): asserts condition {
    if (!condition)
        throw new Error(message);
}
function directoryStats(path: string): DirectoryStats {
    const stats: DirectoryStats = { bytes: 0, files: 0 };
    const visit = (entry: string): void => {
        const node = lstatSync(entry);
        if (node.isSymbolicLink())
            throw new Error(`Unexpected symbolic link in release fixture output: ${entry}`);
        if (node.isDirectory()) {
            for (const child of readdirSync(entry))
                visit(join(entry, child));
            return;
        }
        if (!node.isFile())
            throw new Error(`Unexpected non-file release fixture entry: ${entry}`);
        stats.bytes += node.size;
        stats.files += 1;
    };
    visit(path);
    return stats;
}
function ioReadBytes(): number | null {
    if (process.platform !== 'linux')
        return null;
    const match = /^read_bytes:\s+(\d+)$/mu.exec(readFileSync('/proc/self/io', 'utf8'));
    return match ? Number(match[1]) : null;
}
function percentile(values: readonly number[], ratio: number): number {
    const sorted = [...values].sort((left, right) => left - right);
    const position = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
    return sorted[position]!;
}
function chooseAction(
    legalActions: readonly GameAction[],
    decision: number,
    requireEndTurn = false,
): GameAction {
    if (requireEndTurn) {
        const endTurn = legalActions.find((action) => action.type === 'EndTurn');
        if (!endTurn) throw new Error(`EndTurn is not a legal Core action at decision ${decision}`);
        return endTurn;
    }
    const preferred = decision % 3 === 1 ? 'Move' : decision % 3 === 2 ? 'Wait' : 'EndTurn';
    return legalActions.find((action) => action.type === preferred)
        ?? legalActions.find((action) => action.type === 'EndTurn')
        ?? legalActions[0]
        ?? (() => { throw new Error(`No legal Core action at decision ${decision}`); })();
}
function fullDocument(runtime: SessionGameRuntime): {
    observation: unknown;
    legalActions: GameAction[];
    privateState: JsonValue;
} {
    return {
        observation: runtime.getObservation(),
        legalActions: runtime.getLegalActions(),
        privateState: runtime.exportPrivateState(),
    };
}
function mapPageDigest(service: SessionService, sessionId: string, revision: number): {
    pages: number;
    tiles: number;
    hash: string;
} {
    let cursor: string | undefined;
    let pages = 0;
    let tiles = 0;
    const keys = new Set<string>();
    const hash = createHash('sha256');
    do {
        const page = service.query(sessionId, { target: 'map', expectedRevision: revision, cursor, pageSize: 500 });
        assert(page.target === 'map' && Array.isArray(page.items), 'Map query did not return a page');
        for (const item of page.items) {
            const tile = item as {
                q?: unknown;
                r?: unknown;
            };
            assert(Number.isSafeInteger(tile.q) && Number.isSafeInteger(tile.r), 'Map pagination returned a malformed tile');
            const key = `${tile.q},${tile.r}`;
            assert(!keys.has(key), 'Map pagination returned a duplicate tile');
            keys.add(key);
            hash.update(JSON.stringify(item));
        }
        tiles += page.items.length;
        pages += 1;
        cursor = page.nextCursor ?? undefined;
    } while (cursor);
    assert(tiles === 51 * 51 && keys.size === 51 * 51, `Expected 2601 map tiles, received ${tiles}`);
    return { pages, tiles, hash: hash.digest('hex') };
}
function compactResult(service: SessionService, sessionId: string): {
    bytes: number;
    result: ReturnType<SessionService['status']>;
    elapsedMs: number;
} {
    const started = performance.now();
    const result = service.status(sessionId);
    return { bytes: bytes(result), result, elapsedMs: performance.now() - started };
}
function reportPath(argument: string | null): string {
    if (argument)
        return resolve(argument);
    return resolve('output', `session-release-validation-${Date.now()}.json`);
}
function measure<T>(timings: StageTimings, stage: keyof StageTimings, operation: () => T): T {
    const started = performance.now();
    try {
        return operation();
    }
    finally {
        timings[stage] += performance.now() - started;
    }
}
function runFreshStatusProbe(root: string, session: string): SessionStatusProbeReport {
    const probe = resolve('node_modules', 'vite-node', 'vite-node.mjs');
    const result = spawnSync(process.execPath, [
        probe,
        '--script',
        'src/testing/session-status-probe.ts',
        `--root=${root}`,
        `--session=${session}`,
    ], {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`Fresh Session status probe failed for ${session}: ${result.stderr || result.stdout}`);
    }
    try {
        return JSON.parse(result.stdout) as SessionStatusProbeReport;
    } catch (error) {
        throw new Error(`Fresh Session status probe returned invalid JSON for ${session}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
function probeSummary(probe: SessionStatusProbeReport): Omit<SessionStatusProbeReport, 'root' | 'session'> {
    const { root: _root, session: _session, ...summary } = probe;
    return summary;
}
export function runSessionReleaseValidation(options: ParsedArguments): Record<string, unknown> {
    const totalStarted = performance.now();
    const timings: StageTimings = {
        setupMs: 0,
        oldFormatCaptureMs: 0,
        referenceStepMs: 0,
        sessionStepMs: 0,
        storageScanMs: 0,
        queryMs: 0,
        statusMs: 0,
        checkpointBranchMs: 0,
        artifactMs: 0,
        historyLengthComparisonMs: 0,
        totalMs: 0,
    };
    const output = reportPath(options.jsonOut);
    if (existsSync(output))
        throw new Error(`Refusing to overwrite existing report: ${output}`);
    mkdirSync(dirname(output), { recursive: true });
    const sessionRoot = join(dirname(output), `${output.split(/[\\/]/u).at(-1)!.replace(/\.json$/u, '')}-store`);
    if (existsSync(sessionRoot))
        throw new Error(`Refusing to reuse existing Session root: ${sessionRoot}`);
    const identity = resolveSessionIdentity();
    const factory = createSessionReleaseFixtureFactory(identity.buildId);
    const largeFixture = options.largeMiB !== null;
    const store = new SessionStore(sessionRoot, undefined, largeFixture ? { gzipLevel: 0 } : undefined);
    const service = new SessionService(
        store,
        factory,
        identity,
        largeFixture ? { publicSnapshotInterval: 1 } : undefined,
    );
    const sessionId = 'release-root';
    const childSessionId = 'release-branch';
    const seed = 1511;
    const created = measure(timings, 'setupMs', () => service.newSession({
        sessionId,
        seed,
        agentId: 'session-release-fixture',
        checkpointInterval: largeFixture ? 1 : 5,
    }));
    assert(created.active.revision === 0, 'New release Session did not begin at revision 0');
    const reference = measure(timings, 'setupMs', () => factory.createNew({ seed, agentId: 'session-release-fixture' }));
    const initial = reference.getObservation();
    assert(
        initial.map.width === 51 && initial.map.height === 51 && initial.units.length === 21,
        'Release fixture is not the required 51x51 / 21 unit Core state',
    );
    let revision = created.active.revision;
    let oldStorageBytes = 0;
    let peakRssBytes = process.memoryUsage().rss;
    let storage = measure(timings, 'storageScanMs', () => directoryStats(sessionRoot));
    const largeTargetBytes = options.largeMiB === null ? null : options.largeMiB * 1024 * 1024;
    const storageSampleInterval = options.largeMiB === null
        ? NORMAL_STORAGE_SAMPLE_INTERVAL
        : LARGE_STORAGE_SAMPLE_INTERVAL;
    let largeTargetReached = largeTargetBytes === null;
    let decisionsExecuted = 0;
    while (decisionsExecuted < options.decisions || !largeTargetReached) {
        if (decisionsExecuted >= LARGE_MAX_DECISIONS)
            throw new Error(`Large validation did not reach ${options.largeMiB} MiB after ${LARGE_MAX_DECISIONS} valid Core actions`);
        const decision = decisionsExecuted + 1;
        const before = measure(timings, 'oldFormatCaptureMs', () => fullDocument(reference));
        const action = chooseAction(before.legalActions, decision, largeFixture);
        const sessionResult = measure(timings, 'sessionStepMs', () => service.step(sessionId, {
            action,
            decisionSummary: `release fixture Core action ${decision}`,
            expectedRevision: revision,
        }));
        assert(sessionResult.accepted && sessionResult.error === null, `Session rejected valid Core action ${decision}`);
        const referenceResult = measure(timings, 'referenceStepMs', () => reference.step({
            action,
            decisionSummary: `release fixture Core action ${decision}`,
        }));
        assert(referenceResult.error === null, `Reference GameEngine rejected selected action ${decision}`);
        const after = measure(timings, 'oldFormatCaptureMs', () => fullDocument(reference));
        assert(
            sha256Json(before.privateState) !== sha256Json(after.privateState),
            `Accepted Core action ${decision} did not change the real GameState`,
        );
        oldStorageBytes += bytes({
            decision,
            action,
            observationBefore: before.observation,
            legalActionsBefore: before.legalActions,
            observationAfter: after.observation,
            legalActionsAfter: after.legalActions,
            privateGeneration: after.privateState,
        });
        revision = sessionResult.active.revision;
        decisionsExecuted = decision;
        peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
        if (decision % storageSampleInterval === 0 || decision === options.decisions) {
            storage = measure(timings, 'storageScanMs', () => directoryStats(sessionRoot));
            largeTargetReached = largeTargetBytes === null || storage.bytes > largeTargetBytes;
        }
    }
    const historyLengthComparison = measure(timings, 'historyLengthComparisonMs', () => {
        const currentPrivateState = reference.exportPrivateState();
        const currentPrivateStateHash = sha256Json(currentPrivateState);
        const currentPublicStateHash = sha256Json({
            observation: reference.getObservation(),
            legalActions: reference.getLegalActions(),
        });
        const shortRoot = `${sessionRoot}-current-state-short`;
        if (existsSync(shortRoot)) throw new Error(`Refusing to reuse current-state comparison root: ${shortRoot}`);

        const shortSessionId = 'release-current-state-short';
        const currentStateFactory: SessionGameFactory = {
            createNew: ({ seed: restoredSeed, agentId }) => factory.restore({
                privateState: currentPrivateState,
                seed: restoredSeed,
                agentId,
                sessionId: shortSessionId,
                decision: 0,
                traceHeadHash: ZERO_HASH,
            }),
            restore: (input) => factory.restore(input),
        };
        const shortStore = new SessionStore(
            shortRoot,
            undefined,
            largeFixture ? { gzipLevel: 0 } : undefined,
        );
        const shortService = new SessionService(
            shortStore,
            currentStateFactory,
            identity,
            largeFixture ? { publicSnapshotInterval: 1 } : undefined,
        );
        const shortCreated = shortService.newSession({
            sessionId: shortSessionId,
            seed,
            agentId: 'session-release-fixture',
            checkpointInterval: largeFixture ? 1 : 5,
        });
        assert(shortCreated.active.decision === 0, 'Current-state comparison Session must have zero retained Decisions');
        assert(
            sha256Json(shortStore.load(shortSessionId).privateState) === currentPrivateStateHash,
            'Current-state comparison Session did not preserve the final private GameState',
        );
        const shortFull = shortService.query(shortSessionId, {
            target: 'full-snapshot',
            expectedRevision: shortCreated.active.revision,
        });
        assert(
            shortFull.value !== undefined && sha256Json(shortFull.value) === currentPublicStateHash,
            'Current-state comparison Session did not preserve Observation and Legal Actions',
        );

        const longProbe = runFreshStatusProbe(sessionRoot, sessionId);
        const shortProbe = runFreshStatusProbe(shortRoot, shortSessionId);
        assert(
            longProbe.publicObservationLegalSha256 === currentPublicStateHash
                && shortProbe.publicObservationLegalSha256 === currentPublicStateHash,
            'Long and short history probes do not expose the same current public state',
        );
        const memoryAllowanceBytes = 128 * 1024 * 1024;
        assert(
            longProbe.peakRssBytes <= shortProbe.peakRssBytes + memoryAllowanceBytes,
            `Long-history fresh status RSS exceeds same-state short-history RSS by more than ${memoryAllowanceBytes} bytes`,
        );
        return {
            sameCurrentPrivateState: true,
            sameCurrentPublicState: true,
            currentPrivateStateHash,
            currentPublicStateHash,
            historyDecisions: decisionsExecuted,
            shortHistoryDecisions: 0,
            memoryAllowanceBytes,
            longHistory: probeSummary(longProbe),
            shortHistory: probeSummary(shortProbe),
        };
    });
    const { mapPages, full, expectedFull } = measure(timings, 'queryMs', () => {
        const pagedMap = mapPageDigest(service, sessionId, revision);
        const snapshot = service.query(sessionId, {
            target: 'full-snapshot',
            expectedRevision: revision,
        }) as SessionQueryResult;
        assert(snapshot.target === 'full-snapshot' && snapshot.value !== undefined, 'Full Snapshot query failed');
        return {
            mapPages: pagedMap,
            full: snapshot,
            expectedFull: {
                observation: reference.getObservation(),
                legalActions: reference.getLegalActions(),
            },
        };
    });
    assert(sha256Json(full.value) === sha256Json(expectedFull), 'Full Snapshot does not equal the reference AgentGame public state');
    const oldFullResponseBytes = bytes(expectedFull);
    const statuses: number[] = [];
    let compactResponseBytes = 0;
    const readBefore = ioReadBytes();
    measure(timings, 'statusMs', () => {
        for (let index = 0; index < STATUS_SAMPLES; index += 1) {
            const compact = compactResult(service, sessionId);
            assert(compact.result.active.revision === revision, 'status changed the current revision');
            compactResponseBytes = Math.max(compactResponseBytes, compact.bytes);
            statuses.push(compact.elapsedMs);
            peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
        }
    });
    const readAfter = ioReadBytes();
    const { checkpoint, branchStep } = measure(timings, 'checkpointBranchMs', () => {
        const saved = service.saveCheckpoint(sessionId);
        const branch = service.loadCheckpoint(sessionId, saved.checkpointId, childSessionId);
        assert(
            branch.active.revision === revision && branch.session.branchBase?.baseDecision === revision,
            'Checkpoint branch did not preserve its immutable base revision',
        );
        const branchAction = chooseAction(reference.getLegalActions(), decisionsExecuted + 1, largeFixture);
        const stepped = service.step(childSessionId, {
            action: branchAction,
            decisionSummary: 'release fixture branch Core action',
            expectedRevision: revision,
        });
        assert(
            stepped.accepted && stepped.active.revision === revision + 1,
            'Branched Session could not resume with a valid Core action',
        );
        return { checkpoint: saved, branchStep: stepped };
    });
    const sessionStorage = measure(timings, 'storageScanMs', () => directoryStats(sessionRoot));
    const { artifactPath, artifact, manifest, readManifest, replay } = measure(timings, 'artifactMs', () => {
        const packagePath = join(sessionRoot, 'release-branch.nlth-artifact');
        const exported = service.exportArtifact(childSessionId, packagePath);
        assert(exported.decisionCount === revision + 1, 'Artifact has an unexpected decision count');
        const read = service.readArtifact(packagePath);
        const replayed = service.replayArtifact(packagePath);
        assert(
            read.manifestHash === exported.manifestHash && replayed.matched === true,
            'Artifact read or replay did not match',
        );
        return {
            artifactPath: packagePath,
            artifact: directoryStats(packagePath),
            manifest: exported,
            readManifest: read,
            replay: replayed,
        };
    });
    const compactRatio = compactResponseBytes / Math.max(1, oldFullResponseBytes);
    const storageRatio = sessionStorage.bytes / Math.max(1, oldStorageBytes);
    assert(compactRatio <= 0.25, `Compact response ratio ${compactRatio.toFixed(4)} exceeds 25%`);
    // The normal 1,000-action job is the compression-ratio acceptance test.
    // Large mode deliberately uses the Store's schema-valid gzip level 0 test
    // codec so a reader must process a physical 512 MiB Package; its size is
    // therefore reported but cannot satisfy the production-compression limit.
    if (!largeFixture) {
        assert(storageRatio <= 0.5, `Session storage ratio ${storageRatio.toFixed(4)} exceeds 50%`);
    }
    if (largeTargetBytes !== null) {
        assert(
            artifact.bytes > largeTargetBytes,
            `Artifact Package (${artifact.bytes}) does not exceed ${largeTargetBytes} bytes`,
        );
    }

    timings.totalMs = performance.now() - totalStarted;
    return {
        ok: true,
        fixture: {
            map: initial.map.id,
            width: initial.map.width,
            height: initial.map.height,
            humanUnits: initial.units.length,
            actionPattern: largeFixture ? ['EndTurn'] : ['Move', 'Wait', 'EndTurn'],
        },
        execution: {
            requestedDecisions: options.decisions,
            executedDecisions: decisionsExecuted,
            largeMiB: options.largeMiB,
            largeTargetBytes,
            gzipLevel: largeFixture ? 0 : 9,
            publicSnapshotInterval: largeFixture ? 1 : 50,
            checkpointInterval: largeFixture ? 1 : 5,
            physicalArtifactPackageTargetReached: largeTargetBytes === null || artifact.bytes > largeTargetBytes,
            node: process.version,
            platform: process.platform,
            arch: process.arch,
        },
        compact: {
            bytes: compactResponseBytes,
            oldFullBytes: oldFullResponseBytes,
            ratio: compactRatio,
            acceptanceLimit: 0.25,
        },
        storage: {
            bytes: sessionStorage.bytes,
            files: sessionStorage.files,
            oldFullGenerationBytes: oldStorageBytes,
            ratio: storageRatio,
            acceptanceLimit: largeFixture ? null : 0.5,
            compressionAcceptanceApplies: !largeFixture,
        },
        performance: {
            peakRssBytes,
            statusSamples: STATUS_SAMPLES,
            statusP50Ms: percentile(statuses, 0.5),
            statusP95Ms: percentile(statuses, 0.95),
            ioReadBytes: readBefore === null || readAfter === null ? null : readAfter - readBefore,
            stageTimingsMs: timings,
        },
        historyLengthComparison,
        query: { mapPages, fullSnapshotMatched: true },
        branch: {
            checkpointId: checkpoint.checkpointId,
            baseRevision: revision,
            resumedRevision: branchStep.active.revision,
        },
        artifact: {
            path: artifactPath,
            bytes: artifact.bytes,
            files: artifact.files,
            manifestHash: manifest.manifestHash,
            decisionCount: manifest.decisionCount,
            readMatched: readManifest.manifestHash === manifest.manifestHash,
            replayMatched: replay.matched,
        },
    };
}
export function runCli(argv: readonly string[] = process.argv.slice(2)): number {
    const options = parseSessionReleaseArguments(argv);
    const output = reportPath(options.jsonOut);
    const report = runSessionReleaseValidation(options);
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`${JSON.stringify({ ok: true, output, executedDecisions: report.execution && (report.execution as {
            executedDecisions: number;
        }).executedDecisions })}\n`);
    return 0;
}
const entry = process.argv[1];
if (entry && /session-release-validation\.(?:ts|js|mjs)$/u.test(entry)) {
    try {
        process.exitCode = runCli();
    }
    catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
