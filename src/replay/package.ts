import { applyLosslessJsonDiff } from '../session/public-diff';
import { APP_VERSION, ARTIFACT_SCHEMA_VERSION, OBSERVATION_API_VERSION, GAME_RULES_VERSION, SAVE_FORMAT_VERSION, AGENT_API_VERSION, BRIDGE_API_VERSION } from '../agent/types';
import { SESSION_ARTIFACT_PACKAGE_VERSION, SESSION_SCHEMA_VERSION } from '../session/types';
import type { AgentMapObservation } from '../agent/types';
import type { PublicDecisionRecord, SessionArtifactManifest, SessionDescriptor, SessionPayloadReference, SessionPublicDocument, SessionPublicSnapshotPayload, SessionPublicDiffPayload, SessionRunBase } from '../session/types';
import type { JsonValue } from '../core/types';
import { hexKey, hexDistance } from '../core/hex';
import { Digest, canonical, checkHash, hashJson } from './digest';

const MiB = 1024 * 1024;
export const REPLAY_LIMITS = { entryCount: 200000, directoryBytes: 32 * MiB, payloadBytes: 64 * MiB, lineBytes: 4 * MiB, chunkBytes: MiB, decisions: 1000000, cacheBytes: 16 * MiB };
type Entry = { name: string; offset: number; compressed: number; size: number; method: number; crc: number };
const crcTable = new Uint32Array(256).map((_, i) => { let n = i; for (let j=0;j<8;j++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0); return n; });
const fail = (message: string): never => { throw new Error(message); };
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
export class ReplayZip {
  entries = new Map<string, Entry>();
  expandedBytes = 0;
  constructor(public readonly file: Blob, private signal: AbortSignal) {}
  check() { this.signal.throwIfAborted(); }
  async open() {
    this.check(); const tail = new Uint8Array(await this.file.slice(Math.max(0, this.file.size - 65557)).arrayBuffer());
    const v = new DataView(tail.buffer); let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (v.getUint32(i,true) === 0x06054b50 && i + 22 + v.getUint16(i+20,true) === tail.length) { end = i; break; }
    if (end < 0) fail('ZIP directory is missing');
    const count = v.getUint16(end+10,true), bytes = v.getUint32(end+12,true), offset = v.getUint32(end+16,true);
    if (v.getUint16(end+4,true) || v.getUint16(end+6,true) || count === 65535 || bytes > REPLAY_LIMITS.directoryBytes || count > REPLAY_LIMITS.entryCount || offset + bytes > this.file.size - 22) fail('Unsupported ZIP directory size or multi-volume/ZIP64 container');
    const data = new Uint8Array(await this.file.slice(offset, offset + bytes).arrayBuffer()), d = new DataView(data.buffer), decoder = new TextDecoder('utf-8', {fatal:true});
    let at = 0;
    for (let i=0;i<count;i++) {
      this.check(); if (at+46>bytes || d.getUint32(at,true)!==0x02014b50) fail('Invalid ZIP directory entry');
      const len=d.getUint16(at+28,true), extra=d.getUint16(at+30,true), comment=d.getUint16(at+32,true);
      if(at+46+len+extra+comment>bytes) fail('Truncated ZIP entry');
      const name=decoder.decode(data.subarray(at+46,at+46+len));
      if (!name || name.includes('\\') || name.startsWith('/') || name.includes(':') || name.split('/').some(p=>!p || p==='.' || p==='..') || this.entries.has(name)) fail('Unsafe or duplicate ZIP entry name');
      if (d.getUint16(at+8,true)&1 || ((d.getUint32(at+38,true) >>> 16) & 0xf000) === 0xa000) fail('Encrypted or symbolic-link ZIP entry');
      const entry: Entry = {name, offset:d.getUint32(at+42,true), compressed:d.getUint32(at+20,true),size:d.getUint32(at+24,true),method:d.getUint16(at+10,true),crc:d.getUint32(at+16,true)};
      if (![0,8].includes(entry.method) || entry.offset+30+entry.compressed>offset) fail('Unsupported ZIP entry');
      this.entries.set(name,entry); at+=46+len+extra+comment;
    }
    if(at!==bytes) fail('ZIP directory length mismatch');
    return this;
  }
  async *stream(name: string, maxBytes = Number.MAX_SAFE_INTEGER): AsyncGenerator<Uint8Array> {
    this.check(); const entry=this.entries.get(name) ?? fail(`Missing ZIP entry: ${name}`);
    if(entry.size>maxBytes) fail(`Resource limit: ${name} exceeds ${maxBytes} bytes`);
    const local=new Uint8Array(await this.file.slice(entry.offset,entry.offset+30).arrayBuffer()), v=new DataView(local.buffer);
    if(local.length!==30 || v.getUint32(0,true)!==0x04034b50 || v.getUint16(8,true)!==entry.method) fail('Invalid ZIP local header');
    const n=v.getUint16(26,true), x=v.getUint16(28,true), begin=entry.offset+30+n+x;
    const localName=new TextDecoder().decode(await this.file.slice(entry.offset+30,entry.offset+30+n).arrayBuffer());
    if(localName!==name || begin+entry.compressed>this.file.size) fail('ZIP local entry mismatch');
    let stream=this.file.slice(begin,begin+entry.compressed).stream();
    if(entry.method===8) stream=stream.pipeThrough(new DecompressionStream('deflate-raw'));
    const reader=stream.getReader(); let total=0, crc=0xffffffff;
    try { while(true) { this.check(); const {value,done}=await reader.read(); if(done) break; total+=value.length; if(total>maxBytes || total>entry.size) fail('ZIP expansion limit exceeded'); for(const byte of value) crc=crcTable[(crc^byte)&255]!^(crc>>>8); yield value; } }
    finally { await reader.cancel(); }
    if(total!==entry.size || ((crc^0xffffffff)>>>0)!==entry.crc) fail('ZIP size or CRC mismatch');
    this.expandedBytes+=total;
  }
  async read(name:string,max=REPLAY_LIMITS.payloadBytes):Promise<Uint8Array> { const chunks:Uint8Array[]=[];let size=0;for await(const c of this.stream(name,max)){chunks.push(c);size+=c.length;} const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}return bytes; }
  async json<T>(name:string,max=REPLAY_LIMITS.payloadBytes):Promise<T> {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await this.read(name,max))) as T;}
}
type Header={kind:'header';descriptor:SessionDescriptor;runBase:SessionRunBase;finalPublicHash:string};
type Index={offset:number;length:number;turn:number;snapshot:number};
export class ReplayPackage {
  manifest!:SessionArtifactManifest; map!:AgentMapObservation; header!:Header;
  index:Index[]=[]; internalExpandedBytes=0; observationCumulativeBytes=0;
  private initial!:SessionPublicDocument; private snapshots=new Map<number,SessionPublicDocument>(); private cacheSize=0;
  constructor(public zip:ReplayZip) {}
  private async payload<T>(ref:SessionPayloadReference):Promise<T> {
    const hashPattern=/^[a-f0-9]{64}$/;
    if(!ref || ref.domain!=='public' || ref.encoding!=='canonical-json+gzip-chunks' || !hashPattern.test(ref.contentHash) || !Number.isSafeInteger(ref.logicalBytes) || ref.logicalBytes<0 || ref.logicalBytes>REPLAY_LIMITS.payloadBytes || !Array.isArray(ref.chunks) || ref.chunks.length>65) fail('Unsupported public payload or resource limit');
    const indexed=await this.zip.json(`payloads/public/refs/${ref.contentHash.slice(0,2)}/${ref.contentHash}.json`,MiB);
    if(canonical(indexed)!==canonical(ref)) fail('Payload reference mismatch');
    const chunks:Uint8Array[]=[];let length=0, compressed=0;const digest=new Digest();
    for(const c of ref.chunks){
      this.zip.check(); if(!hashPattern.test(c.hash) || c.compressedBytes>MiB*2) fail('Invalid payload chunk');
      const bytes=await this.zip.read(`payloads/public/chunks/${c.hash.slice(0,2)}/${c.hash}.gz`,MiB*2);
      if(bytes.length!==c.compressedBytes || new Digest().update(bytes).hex()!==c.hash) fail('Payload compressed hash mismatch');
      compressed+=bytes.length;
      const reader=new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();let chunkSize=0;
      try{while(true){this.zip.check();const {value,done}=await reader.read();if(done)break;chunkSize+=value.length;length+=value.length;if(chunkSize>MiB || length>ref.logicalBytes || length>REPLAY_LIMITS.payloadBytes)fail('Internal payload expansion limit exceeded');digest.update(value);chunks.push(value);}}finally{await reader.cancel();}
    }
    if(length!==ref.logicalBytes || compressed!==ref.compressedBytes || digest.hex()!==ref.contentHash) fail('Payload logical hash mismatch');
    this.internalExpandedBytes+=length;
    const raw=new Uint8Array(length);let at=0;for(const c of chunks){raw.set(c,at);at+=c.length;}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)) as T;
  }
  async open():Promise<this> {
    await this.zip.open();this.manifest=await this.zip.json('manifest.json',MiB);
    checkHash(this.manifest as unknown as Record<string,unknown>,'manifestHash');
    const m=this.manifest;
    if(m.gameRulesVersion!==GAME_RULES_VERSION || String(m.saveFormatVersion)!==SAVE_FORMAT_VERSION || m.agentApiVersion!==AGENT_API_VERSION || m.bridgeApiVersion!==BRIDGE_API_VERSION || m.appVersion!==APP_VERSION || m.artifactSchemaVersion!==ARTIFACT_SCHEMA_VERSION || m.observationApiVersion!==OBSERVATION_API_VERSION || m.mapId!=='fixed-51x51-v4' || m.packageVersion!==SESSION_ARTIFACT_PACKAGE_VERSION || m.sessionSchemaVersion!==SESSION_SCHEMA_VERSION) fail('Unsupported replay version: v1.5.7 public Artifact required; start a new v1.5.7 game/Session (旧Replay非対応、新規v1.5.7 Sessionを開始してください)');
    // Exported streams are stored, permitting random byte-range access without extracting history.
    const stream=this.zip.entries.get('artifact.ndjson');if(!stream || stream.method!==0)fail('Replay requires a stored artifact.ndjson entry; use the Portable ZIP export');
    const digest=new Digest();let pending=new Uint8Array(), accepted=0, offset=0, previous='0'.repeat(64), snapshot=-1, footer=false, document:SessionPublicDocument|undefined;
    for await(const chunk of this.zip.stream('artifact.ndjson')) {
      digest.update(chunk);const joined=new Uint8Array(pending.length+chunk.length);joined.set(pending);joined.set(chunk,pending.length);let start=0;
      for(let at=0;at<joined.length;at++)if(joined[at]===10){
        const line=joined.subarray(start,at);if(line.length>REPLAY_LIMITS.lineBytes)fail('Decision line resource limit');
        const entry=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(line));
        if(footer)fail('Trailing Artifact records');
        if(!this.header){
          if(entry.kind!=='header')fail('Missing Artifact header');this.header=entry as Header;
          checkHash(this.header.descriptor as unknown as Record<string,unknown>,'descriptorIntegrityHash');checkHash(this.header.runBase as unknown as Record<string,unknown>,'runBaseIntegrityHash');
          for(const field of ['appVersion','gameRulesVersion','saveFormatVersion','artifactSchemaVersion','agentApiVersion','observationApiVersion','bridgeApiVersion','buildId','gitCommit','mapId','sessionSchemaVersion','sessionId'] as const)if(this.header.descriptor[field]!==m[field])fail(`Header ${field} mismatch`);
          if(canonical(this.header.descriptor.branchBase)!==canonical(m.branchBase) || this.header.descriptor.parentSessionId!==m.lineage.parentSessionId || this.header.descriptor.parentCheckpointId!==m.lineage.parentCheckpointId)fail('Lineage mismatch');
          this.map=await this.payload(this.header.runBase.fixedMap);if(this.map.id!==m.mapId || !this.map.roads || this.map.width!==51 || this.map.height!==51 || this.map.tiles.length!==2601)fail('Invalid recorded map');
          const validPosition=(p:{q:number;r:number})=>Number.isSafeInteger(p.q)&&Number.isSafeInteger(p.r)&&p.q>=0&&p.r>=0&&p.q<51&&p.r<51;
          if(this.map.tiles.some(t=>!validPosition(t))||new Set(this.map.tiles.map(hexKey)).size!==2601)fail('Invalid recorded tile coordinates');
          if(this.map.roads!.generatorVersion!=='connector-roads-v1'||!Array.isArray(this.map.roads!.segments)||this.map.roads!.segments.length>10000)fail('Invalid road metadata');
          const roadIds=new Set<string>();for(const segment of this.map.roads!.segments){if(roadIds.has(segment.id)||!['trunk','collector','access'].includes(segment.role)||segment.path.length<2||segment.path.length>2601||segment.path.some((p,i)=>!validPosition(p)||(i>0&&hexDistance(p,segment.path[i-1]!)!==1)))fail('Invalid recorded road segment');roadIds.add(segment.id);}

          const initial=await this.payload<SessionPublicSnapshotPayload>(this.header.runBase.initialPublicState);
          if(initial.kind!=='snapshot' || hashJson(initial.document)!==initial.documentHash || initial.documentHash!==this.header.runBase.initialPublicHash)fail('Invalid initial snapshot');
          this.initial=initial.document;document=initial.document;
          if (m.branchBase && (!Number.isSafeInteger(m.branchBase.baseDecision) || m.branchBase.baseDecision < 0 || m.branchBase.baseDecision > m.decisionCount)) fail('Invalid branch base Decision');
          if(m.branchBase?.baseDecision===0 && (m.branchBase.basePublicSnapshotHash!==initial.documentHash || m.branchBase.baseTraceHeadHash!==previous)) fail('Invalid empty branch base');
          if(initial.document.observation.apiVersion!==OBSERVATION_API_VERSION || initial.document.observation.gameRulesVersion!==GAME_RULES_VERSION) fail('Initial public version mismatch');
        }else if(entry.kind==='decision'){
          const r=entry.record as PublicDecisionRecord;checkHash(r as unknown as Record<string,unknown>,'decisionHash');
          if(typeof r.accepted!=='boolean' || !Number.isSafeInteger(r.turn) || r.turn<1 || (r.decisionSummary!=null && typeof r.decisionSummary!=='string') || !Array.isArray(r.events))fail('Invalid Decision shape');
          if(r.accepted)accepted++;
          if(r.decision!==this.index.length+1 || r.previousDecisionHash!==previous)fail('Invalid Decision hash chain');
          if(this.index.length>=REPLAY_LIMITS.decisions)fail('Decision index resource limit');
          this.index.push({offset:offset+start,length:at-start,turn:r.turn,snapshot});
          document=await this.apply(document!,r);
          if(r.publicPayloadKind==='snapshot')snapshot=this.index.length-1;
          if(m.branchBase?.baseDecision===r.decision && (m.branchBase.baseTraceHeadHash!==r.decisionHash || m.branchBase.basePublicSnapshotHash!==r.afterPublicHash))fail('Branch base mismatch');
          previous=r.decisionHash;
        }else if(entry.kind==='footer'){
          footer=true;if(canonical(entry.result)!==canonical(document!.result))fail('Footer result mismatch');
        }else fail('Unknown Artifact record');
        start=at+1;await tick();this.zip.check();
      }
      offset+=start;pending=joined.slice(start);if(pending.length>REPLAY_LIMITS.lineBytes)fail('Decision line resource limit');
    }
    if(accepted!==m.acceptedActionCount || this.index.length-accepted!==m.invalidActionCount || pending.length || !footer || digest.hex()!==m.streamHash || this.index.length!==m.decisionCount || hashJson(document)!==this.header.finalPublicHash)fail('Incomplete or corrupt Artifact stream');
    return this;
  }
  private async record(i:number):Promise<PublicDecisionRecord>{
    const index=this.index[i]??fail('Decision out of range'),e=this.zip.entries.get('artifact.ndjson')!;
    const h=new DataView(await this.zip.file.slice(e.offset,e.offset+30).arrayBuffer());const begin=e.offset+30+h.getUint16(26,true)+h.getUint16(28,true)+index.offset;
    return JSON.parse(await this.zip.file.slice(begin,begin+index.length).text()).record as PublicDecisionRecord;
  }
  private async apply(before:SessionPublicDocument,r:PublicDecisionRecord):Promise<SessionPublicDocument>{
    this.zip.check();if(hashJson(before)!==r.beforePublicHash)fail('Decision public base mismatch');
    let after:SessionPublicDocument;
    if(r.publicPayloadKind==='snapshot'){
      const s=await this.payload<SessionPublicSnapshotPayload>(r.publicPayload);if(s.kind!=='snapshot' || s.documentHash!==r.afterPublicHash)fail('Invalid Decision snapshot');after=s.document;
    }else{
      const d=await this.payload<SessionPublicDiffPayload>(r.publicPayload);if(d.kind!=='diff' || d.beforeDocumentHash!==r.beforePublicHash || d.afterDocumentHash!==r.afterPublicHash)fail('Invalid Decision diff');
      after=applyLosslessJsonDiff(before as unknown as JsonValue,d.operations) as unknown as SessionPublicDocument;
    }
    if(hashJson(after)!==r.afterPublicHash || (!r.accepted && r.beforePublicHash!==r.afterPublicHash))fail('Decision result hash mismatch');
    this.observationCumulativeBytes+=new TextEncoder().encode(canonical(after.observation)).length;
    return after;
  }
  async decision(i:number):Promise<{before:SessionPublicDocument;after:SessionPublicDocument;record:PublicDecisionRecord}>{
    this.zip.check();const entry=this.index[i]??fail('Decision out of range');let from=entry.snapshot,document=this.initial;
    if(from>=0){
      const cached=this.snapshots.get(from);
      if(cached)document=cached;else{const r=await this.record(from),s=await this.payload<SessionPublicSnapshotPayload>(r.publicPayload);if(s.kind!=='snapshot'||hashJson(s.document)!==r.afterPublicHash)fail('Seek snapshot mismatch');document=s.document;
        const size=new TextEncoder().encode(canonical(document)).length;if(size<=REPLAY_LIMITS.cacheBytes){if(this.cacheSize+size>REPLAY_LIMITS.cacheBytes){this.snapshots.clear();this.cacheSize=0;}this.snapshots.set(from,document);this.cacheSize+=size;}}
    }
    for(let j=from+1;j<i;j++){document=await this.apply(document,await this.record(j));await tick();}
    const record=await this.record(i);return {before:document,after:await this.apply(document,record),record};
  }
}
