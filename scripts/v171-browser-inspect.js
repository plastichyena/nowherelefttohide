async page => {
 const records=[],errors=[];
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(['warning','error'].includes(m.type()))errors.push(m.text());});
 const select=async(kind,id)=>page.evaluate(({kind,id})=>{const u=window.qa.ui;u.selection={kind,id};u.sheetState='standard';u.updateView();},{kind,id});
 const audit=async(name)=>{
  const result=await page.evaluate(()=>{
   const visible=e=>e.checkVisibility({checkVisibilityCSS:true})&&!e.closest('.sr-only');
   const controls=[...document.querySelectorAll('#app button,#app summary,#app select,#app input')].filter(visible);
   const tiny=controls.filter(e=>{const r=e.getBoundingClientRect();return r.width<43.9||r.height<43.9;}).map(e=>[e.outerHTML.slice(0,140),e.getBoundingClientRect().width,e.getBoundingClientRect().height]);
   const small=[...document.querySelectorAll('#app *')].filter(e=>visible(e)&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(e).fontSize)<11).map(e=>[e.tagName,e.className]);
   const text=document.querySelector('#app').innerText;
   const u=window.qa.ui,ids=[...u.state.units,...u.state.facilities,...u.state.checkpoints].map(x=>x.id).filter(id=>text.includes(id));
   const keys=['civilianFactory','powerPlant','militaryFactory','proficiency.','facilityStatus'].filter(k=>text.includes(k));
   const b=document.querySelector('.board-region').getBoundingClientRect(),s=document.querySelector('[data-action="toggle-supply"]').getBoundingClientRect();
   const menus=[...document.querySelectorAll('[data-unit-context-ui]')].filter(visible).map(e=>e.getBoundingClientRect());
   const overlaps=menus.some(m=>m.left<s.right&&m.right>s.left&&m.top<s.bottom&&m.bottom>s.top);
   return {tiny,small,ids,keys,overflow:document.documentElement.scrollWidth>innerWidth,overlaps,upper:b.top};
  });records.push({name,...result});
 };
 for(const [width,height] of [[390,844],[360,740],[1280,720]])for(const locale of ['ja','en']){
  await page.setViewportSize({width,height});await page.evaluate(l=>window.qa.load(l,s=>{s.facilities.find(f=>f.id==='city-1').workers=50;}),locale);await page.waitForFunction(()=>window.qa.ui.boardScene);
  const prefix=`${width}-${locale}`;
  await select('unit','police-1');
  await page.evaluate(()=>{const u=window.qa.ui;u.sheetState='collapsed';u.updateView();});await audit(prefix+'-collapsed');
  await page.evaluate(()=>{const u=window.qa.ui;u.sheetState='standard';u.updateView();});
  const move=await page.evaluate(()=>window.qa.ui.legalActions().find(a=>a.type==='Move'&&a.unitId==='police-1'));
  if(!move)throw Error('No legal move fixture');
  await page.locator('[data-action="unit-mode-move"]').click();await page.evaluate(a=>window.qa.ui.onTileTap(a.destination),move);
  await audit(prefix+'-move-confirm');
  await page.locator('[data-action="unit-target-cancel"]').click();
  await page.locator('[data-nav="domestic"]').click();await page.locator('[data-nav="map"]').click();
  if(await page.evaluate(()=>Boolean(window.qa.ui.unitActionMode||window.qa.ui.pendingMove)))throw Error('Pending move restored');
  await page.locator('[data-action="unit-mode-move"]').click();await page.evaluate(a=>window.qa.ui.onTileTap(a.destination),move);await page.locator('[data-action="confirm-move"]').click();
  if(!await page.evaluate(a=>{const p=window.qa.ui.state.units.find(u=>u.id===a.unitId).position;return p.q===a.destination.q&&p.r===a.destination.r;},move))throw Error('Move not committed');
  await select('facility','capital');await page.locator('[data-section="population"]').click();
  await page.locator('[data-transfer-number]').fill('2');await page.locator('[data-transfer-number]').dispatchEvent('input');
  if(await page.locator('[data-transfer-slider]').inputValue()!=='2')throw Error('Transfer inputs not synchronized');
  await audit(prefix+'-transfer');await page.locator('[data-action="transfer-population"]').click();await audit(prefix+'-transfer-confirm');if(await page.locator('[data-action="dismiss-modal"]').count())await page.locator('[data-action="dismiss-modal"]').click();
  const workerId=await page.evaluate(()=>window.qa.ui.state.facilities.find(f=>f.owner==='player'&&f.type==='farm').id);
  await select('facility',workerId);await page.locator('[data-section="population"]').click();
  const old=Number(await page.locator('[data-worker-number]').inputValue());await page.locator('[data-worker-number]').fill(String(old-1));await page.locator('[data-worker-number]').dispatchEvent('input');
  if(await page.locator('[data-worker-slider]').inputValue()!==String(old-1))throw Error('Worker inputs not synchronized');
  await page.locator('[data-worker-number]').dispatchEvent('change');
  if(!await page.evaluate(({id,value})=>window.qa.ui.state.facilities.find(f=>f.id===id).workers===value,{id:workerId,value:old-1}))throw Error('Worker allocation not applied');
  await audit(prefix+'-workers');
  const facilityIds=await page.evaluate(()=>window.qa.ui.state.facilities.map(f=>f.id));
  for(const id of facilityIds){
   await select('facility',id);const sections=await page.locator('[data-panel-actions] [data-section]').evaluateAll(es=>es.map(e=>e.dataset.section));
   for(const section of sections){await page.locator(`[data-panel-actions] [data-section="${section}"]`).click();await audit(prefix+'-'+id+'-'+section);}
  }
  const checkpoint=await page.evaluate(()=>window.qa.ui.state.checkpoints[0].id);
  await select('checkpoint',checkpoint);await page.locator('[data-section="policy"]').click();await page.locator('[data-policy]').selectOption('strict');await audit(prefix+'-checkpoint-policy');
  await page.locator('[data-section="operations"]').click();await page.locator('[data-action="relocate-checkpoint"]').click();
  if(!await page.locator('[data-action="checkpoint-place-cancel"]').isVisible())throw Error('Placement cancellation hidden');
  await audit(prefix+'-checkpoint-relocate');await page.locator('[data-action="checkpoint-place-cancel"]').click();
  await page.evaluate(()=>{const u=window.qa.ui;u.onNav('domestic');u.onTileTap(u.state.units.find(x=>x.id==='police-1').position);});
  if(await page.evaluate(()=>window.qa.ui.navMode)!=='map')throw Error('Domestic board tap did not return to map');
  for(const action of ['population','horde','menu']) {
   const target=page.locator(`[data-action="toggle-upper"][data-overlay="${action}"]`);if(!await target.count())continue;
   await target.click();await audit(prefix+'-'+action);await page.keyboard.press('Escape');
  }
  await page.screenshot({path:`output/playwright/v171-${prefix}-operations.png`});
 }
 return {count:records.length,errors,violations:records.filter(r=>r.tiny.length||r.small.length||r.ids.length||r.keys.length||r.overflow||r.overlaps),checked:records.map(({name})=>name)};
}
