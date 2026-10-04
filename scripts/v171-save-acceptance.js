async page => {
 const records=[],errors=[];page.on('pageerror',e=>errors.push(String(e)));
 for(const locale of ['ja','en']){
  const code=await page.evaluate(l=>{
   const qa=window.qa;qa.load(l,s=>{const capital=s.facilities.find(f=>f.id==='capital');s.facilities.find(f=>f.id==='city-1').workers+=capital.workers;capital.workers=0;s.units.push(qa.createUnit(s,`terminal-zombie-${s.nextUnitNumber++}`,'zombie',capital.position));});
   const result=qa.ui.engine.step({type:'EndTurn'});if(result.error||!result.state.gameOver)throw Error('Terminal fixture failed');
   const code=qa.encodeSaveCode(result.state);qa.ui.showLoadModal();return code;
  },locale);
  await page.locator('[data-input="save-code"]').fill(code);await page.locator('[data-action="load-code"]').click();
  if(!await page.evaluate(()=>window.qa.ui.state.gameOver&&window.qa.ui.state.result.reason==='capitalLost'))throw Error('Terminal Save not restored');
  const before=await page.evaluate(()=>({state:JSON.stringify(window.qa.ui.state),storage:JSON.stringify(localStorage)}));
  await page.evaluate(()=>window.qa.ui.showLoadModal());await page.locator('[data-input="save-code"]').fill('invalid');await page.locator('[data-action="load-code"]').click();
  const error=await page.locator('[data-load-error]').innerText();if(!error)throw Error('Invalid load has no reason');
  const after=await page.evaluate(()=>({state:JSON.stringify(window.qa.ui.state),storage:JSON.stringify(localStorage)}));
  if(before.state!==after.state||before.storage!==after.storage)throw Error('Rejected load changed data');
  await page.evaluate(l=>window.qa.load(l),locale);if(await page.evaluate(()=>window.qa.ui.state.gameOver))throw Error('Could not load current game after terminal');
  records.push({locale,terminalRestored:true,rejectedLoadPreserved:true,error});
 }
 return {records,errors};
}
