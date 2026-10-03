/** Run from the portable package: runtime/node/node examples/v169-portable-turn.mjs */
import { spawnSync } from 'node:child_process';
import { existsSync,mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const cli=existsSync(join(directory,'session-cli.mjs'))?join(directory,'session-cli.mjs'):join(directory,'dist/portable/session-cli.mjs');
const metadataPath=join(directory,'PORTABLE_PACKAGE.json');
const metadata=existsSync(metadataPath)?JSON.parse(readFileSync(metadataPath,'utf8')):null;
const env=metadata?{...process.env,NLTH_BUILD_ID:metadata.buildId,NLTH_GIT_COMMIT:metadata.commit}:process.env;
const id=`public-example-${Date.now()}`,root=resolve('output/public-example-sessions');
function call(command,args=[],input){
  const child=spawnSync(process.execPath,[cli,command,`--root=${root}`,`--session=${id}`,...args],{input:input===undefined?'':JSON.stringify(input),encoding:'utf8',env,maxBuffer:32*1024*1024});
  if(child.error)throw child.error;
  const response=JSON.parse(child.status===0?child.stdout:child.stderr);
  if(!response.ok)throw Object.assign(new Error(response.error),{code:response.code});
  return response;
}
const initial=call('new',['--scenario=una','--seed=7','--map-mode=random','--map-seed=42','--gameplay-seed=7']);
const inputDirectory=resolve('output/public-example-inputs');mkdirSync(inputDirectory,{recursive:true});
const moveFilter=join(inputDirectory,`${id}.json`);writeFileSync(moveFilter,JSON.stringify({type:'Move'}));
const legal=call('query',['--target=legal-actions',`--revision=${initial.revision}`,`--input=${moveFilter}`]);
const move=legal.items.find(action=>action.type==='Move');
function execute(action){
  const status=call('status');
  if(status.observation.gameOver){
    console.log(JSON.stringify({kind:'terminal',progressActionsAllowed:false,result:status.observation.result,details:['status','artifact']}));
    return;
  }
  const prediction=call('preview',[`--revision=${status.revision}`],action).preview;
  console.log(JSON.stringify({kind:'prediction',summary:prediction.summary}));
  if(!prediction.legal || prediction.summary?.movement?.destinationReached===false)return;
  try {
    const result=call('step',[],{action,expectedRevision:status.revision,decisionSummary:'Use the current public preview and re-query after execution.'});
    console.log(JSON.stringify({kind:'result',summary:result.summary}));
    if(!result.accepted)return;
    const current=call('status'); // Public observation; no private Session files are read.
    if(current.observation.gameOver){
      console.log(JSON.stringify({kind:'terminal',progressActionsAllowed:false,result:current.observation.result,details:['status','artifact']}));
      return;
    }
    console.log(JSON.stringify({kind:'actual-state',revision:current.revision,units:current.observation.units.map(u=>({id:u.id,position:u.position,charges:u.attackChargesRemaining})),visibleTargets:current.observation.visibleEnemies.map(z=>z.id)}));
  } catch(error) {
    if(error.code!=='stale_revision')throw error;
    console.log(JSON.stringify({kind:'replan',status:call('status')}));
  }
}
if(move)execute(move);
execute({type:'Wait',unitId:'missing'});
execute({type:'EndTurn'});
