async page => {
 const records=[],errors=[];page.on('pageerror',e=>errors.push(String(e)));
 for(const [width,height] of [[390,844],[360,740],[1280,720]])for(const locale of ['ja','en']){
  await page.setViewportSize({width,height});
  await page.evaluate(l=>{
   const qa=window.qa;qa.load(l,s=>{s.units=s.units.filter(u=>u.id==='police-1');s.units.push(qa.createUnit(s,`artillery-${s.nextUnitNumber++}`,'fieldArtillery',{q:24,r:26}),qa.createUnit(s,`scout-${s.nextUnitNumber++}`,'reconTeam',{q:35,r:25}));});
   const e=qa.ui.engine,id=e.getState().units.find(u=>u.type==='fieldArtillery').id;
   if(e.step({type:'ChangeUnitMode',unitId:id,mode:'deployed'}).error)throw Error('Deploy failed');
   const next=e.step({type:'EndTurn'});if(next.error)throw Error('End turn failed');qa.ui.loadState(next.state);qa.ui.selection={kind:'unit',id};qa.ui.sheetState='expanded';qa.ui.updateView();
  },locale);
  await page.locator('[data-action="unit-mode-attack"]').click();
  const action=await page.evaluate(()=>window.qa.ui.legalActions().find(a=>a.type==='AttackHex'));
  if(!action)throw Error('No bombardment target');
  await page.evaluate(a=>window.qa.ui.onTileTap(a.position),action);
  await page.locator('[data-action="confirm-attack"]').waitFor();
  const dimensions=await page.evaluate(()=>{
   const board=document.querySelector('.board-region').getBoundingClientRect(),box=document.querySelector('.unit-target-confirm').getBoundingClientRect(),supply=document.querySelector('[data-action="toggle-supply"]').getBoundingClientRect();
   return {board:{top:board.top,bottom:board.bottom},box:{top:box.top,bottom:box.bottom,left:box.left,right:box.right},fits:box.top>=supply.bottom&&box.bottom<=board.bottom&&box.left>=board.left&&box.right<=board.right};
  });
  if(!dimensions.fits)throw Error('Confirmation out of board '+JSON.stringify(dimensions));
  await page.screenshot({path:`output/playwright/v171-artillery-${width}-${locale}.png`});
  await page.locator('[data-action="unit-target-cancel"]').click();records.push({width,height,locale,...dimensions});
 }
 return {records,errors};
}
