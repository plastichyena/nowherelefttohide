import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractEvidence} from './extract-public-evidence.mjs';
test('keeps recorded execution separate from legal transfer candidates',()=>{
  const event={id:'event-6423',turn:54,type:'workers_assigned',payload:{facilityId:'farm-4',workers:0,difference:-30,movements:[{facilityId:'city-4',people:30}]}};
  const actual=extractEvidence({line:{kind:'action-result',accepted:true,originalRevision:533,requestId:'t54-f4-0',events:[event]}},'transcript.jsonl',3042);
  assert.equal(actual[0].executed,true);assert.equal(actual[0].payload.movements[0].facilityId,'city-4');assert.equal(actual[0].revision,533);
  const legal=extractEvidence({line:{kind:'query-result',target:'population-transfers',revision:533,items:[{fromFacilityId:'city-4',toFacilityId:'capital',min:1,max:30,legal:true}]}},'transcript.jsonl',3044);
  assert.equal(legal[0].executed,false);assert.equal(legal[0].eventId,null);assert.equal(legal[0].max,30);
  assert.deepEqual(extractEvidence({accepted:false,events:[event]},'source',1),[]);
});


test('extracts revision-pinned public history records without confusing query revision with execution',()=>{
  const records=[{decision:325,accepted:true,requestId:'T30-end',events:[{id:'event-3969',turn:30,type:'facility_recovered',payload:{facilityId:'oilfield-north',unitId:'SF-42'}}]}, {decision:326,accepted:false,events:[]}];
  const evidence=extractEvidence({kind:'query-result',target:'history',revision:533,items:records},'history.jsonl',1);
  assert.equal(evidence.length,1);assert.equal(evidence[0].revision,325);assert.equal(evidence[0].requestId,'T30-end');assert.equal(evidence[0].eventId,'event-3969');
});
