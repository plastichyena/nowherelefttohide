async page => {
 const records=[],errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(['warning','error'].includes(m.type()))errors.push(m.text());});
 const check=async name=>{
  const r=await page.evaluate(()=>{
   const visible=e=>e.checkVisibility({checkVisibilityCSS:true})&&!e.closest('.sr-only');
   const controls=[...document.querySelectorAll('#app button,#app summary,#app select,#app input')].filter(visible);
   const tiny=controls.filter(e=>{const r=e.getBoundingClientRect();return r.width<43.9||r.height<43.9;}).map(e=>e.outerHTML.slice(0,180));
   const small=[...document.querySelectorAll('#app *')].filter(e=>visible(e)&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(e).fontSize)<11).map(e=>e.outerHTML.slice(0,180));
   const text=document.querySelector('#app').innerText,u=window.qa.ui;
   const ids=[...u.state.units,...u.state.facilities,...u.state.checkpoints].map(e=>e.id).filter(id=>text.includes(id));
   const strip=document.querySelector('[data-situation-strip]');
   return {tiny,small,ids,overflow:document.documentElement.scrollWidth>innerWidth,stripOverflow:strip.scrollWidth>strip.clientWidth,upper:document.querySelector('.board-region').getBoundingClientRect().top,text:document.querySelector('.bottom-sheet').innerText};
  });records.push({name,...r});
 };
 for(const [width,height] of [[390,844],[360,740],[1280,720]])for(const locale of ['ja','en']){
  const prefix=`${width}-${locale}`;await page.setViewportSize({width,height});
  await page.evaluate(l=>window.qa.load(l,s=>{
    const qa=window.qa,p=s.facilities.find(f=>f.id==='capital').position;
    s.units.find(u=>u.id==='police-1').position={...p};
    const helicopter=qa.createUnit(s,'helicopter-50','multipurposeHelicopter',p);helicopter.flightState='airborne';helicopter.canMove=true;helicopter.movementDomain='air';helicopter.movement=s.config.units.multipurposeHelicopter.airborneMovement;
    s.units.push(helicopter,qa.createUnit(s,'hidden-zombie-52','zombie',{q:0,r:0}));s.nextUnitNumber=Math.max(s.nextUnitNumber,53);
  }),locale);await page.waitForFunction(()=>window.qa.ui.boardScene);
  const same=await page.evaluate(()=>{const u=window.qa.ui,p=u.state.facilities.find(f=>f.id==='capital').position,out=[];for(let i=0;i<4;i++){u.onTileTap(p);out.push(u.selection.id);}return out;});
  if(JSON.stringify(same)!==JSON.stringify(['police-1','helicopter-50','capital','police-1']))throw Error('Principal cycle '+JSON.stringify(same));
  await page.locator('[data-selection-kind="unit"][data-selection-id="helicopter-50"]').click();await check(prefix+'-airborne');
  await page.locator('[data-section="aviation"]').click();await check(prefix+'-aviation');
  await page.locator('[data-selection-kind="hex"]').click();await page.locator('[data-section="construction"]').click();await check(prefix+'-blocked-terrain');
  await page.evaluate(()=>{const u=window.qa.ui;u.onNav('domestic');u.onTileTap(u.state.facilities.find(f=>f.id==='capital').position);});
  if(await page.evaluate(()=>window.qa.ui.selection.id)!=='police-1')throw Error('Domestic reused repeat-cycle');
  await page.evaluate(l=>window.qa.load(l,s=>{const p=s.facilities.find(f=>f.id==='capital').position;s.units.push(window.qa.createUnit(s,'visible-zombie-51','zombie',p));s.nextUnitNumber=Math.max(s.nextUnitNumber,52);}),locale);
  await page.evaluate(()=>{const u=window.qa.ui;u.onTileTap(u.state.facilities.find(f=>f.id==='capital').position);});
  await page.locator('[data-selection-kind="zombie"]').click();await check(prefix+'-visible-zombie');
  await page.evaluate(l=>window.qa.load(l,s=>{s.resources.food=100000;s.resources.civilianGoods=100000;s.resources.militaryGoods=100000;s.resources.fuel=100000;}),locale);
  for(const type of ['simpleFarm','civilianDroneBase','temporaryHousing','windPowerPlant','reliefSupplyCenter']){
   const candidate=await page.evaluate(type=>window.qa.ui.constructibleFacilityCandidates(type).find(c=>c.legal),type);
   if(!candidate)throw Error('No build candidate '+type);
   await page.evaluate(c=>{const u=window.qa.ui;u.selection={kind:'hex',position:c.position};u.sheetState='standard';u.updateView();},candidate);
   await page.locator('[data-section="construction"]').click();await check(prefix+'-'+type+'-build');
   await page.locator(`[data-action="build-constructible-local"][data-facility-type="${type}"]`).click();
   const facility=await page.evaluate(c=>window.qa.ui.state.facilities.find(f=>f.position.q===c.position.q&&f.position.r===c.position.r),candidate);
   if(facility?.type!==type)throw Error('Build failed '+type);
   await page.evaluate(id=>{const u=window.qa.ui;u.selection={kind:'facility',id};u.sheetState='standard';u.updateView();},facility.id);await check(prefix+'-'+type);
  }
  const wire=await page.evaluate(()=>window.qa.ui.query().getBarbedWireCandidates().find(c=>c.legal));
  await page.evaluate(c=>{const u=window.qa.ui;u.selection={kind:'hex',position:c.position};u.sheetState='standard';u.updateView();},wire);
  await page.locator('[data-section="construction"]').click();await page.locator('[data-action="build-barbed-wire"]').click();await check(prefix+'-wire');
  await page.evaluate(l=>window.qa.load(l,s=>{s.resources.food=0;s.resources.civilianGoods=0;s.facilities.find(f=>f.id==='capital').infected=1;}),locale);
  await page.evaluate(()=>{const u=window.qa.ui;u.saveStatus='failed';u.updateView();});await check(prefix+'-warnings');
  const more=page.locator('[data-situation-strip] [data-overlay="more"]');
  if(await more.count()){
   const count=await page.evaluate(()=>window.qa.ui.overflowChips.length);await more.click();
   if(await page.locator('[data-upper-overlay] .situation-chip').count()!==count)throw Error('Wrong omitted chip count');
   await check(prefix+'-more');await page.keyboard.press('Escape');
  }
  await page.locator('[data-resource="food"]').first().click();
  await page.locator('.hud-pop').click();
  if(await page.evaluate(()=>window.qa.ui.resourceAccordion!==null))throw Error('Overlays not exclusive');
  await page.keyboard.press('Escape');
  if(await page.evaluate(()=>window.qa.ui.upperOverlay!==null))throw Error('Escape failed');
  await page.evaluate(async l=>{
    const qa=window.qa,{singleFinalWave}=await import('/src/core/testConfig.ts');
    const e=new qa.GameEngine(1547,qa.createDefaultConfig({mapMode:'fixed',horde:singleFinalWave(1),economy:{initialZombieCount:0,initialHunterCount:{min:0,max:0},initialGasCount:{min:0,max:0},initialResources:{food:100000,civilianGoods:100000,militaryGoods:100000,fuel:100000}} }));
    const result=e.step({type:'EndTurn'});if(result.error)throw Error(result.error.message);const s=e.getState();s.facilities.find(f=>f.id==='capital').infected=1;qa.prepareTestSnapshot(s);qa.ui.loadState(s);qa.ui.saveStatus='failed';qa.ui.updateView();
  },locale);await check(prefix+'-final-wave');
  if(width<=390&&!await more.count())throw Error('Final warning overflow was not condensed');
  if(await more.count()){const n=await page.evaluate(()=>window.qa.ui.overflowChips.length);await more.click();if(await page.locator('[data-upper-overlay] .situation-chip').count()!==n)throw Error('Final omitted count mismatch');await check(prefix+'-final-more');await page.keyboard.press('Escape');}
  await page.screenshot({path:`output/playwright/v171-${prefix}-warnings.png`});
 }
 return {count:records.length,errors,violations:records.filter(r=>r.tiny.length||r.small.length||r.ids.length||r.overflow||r.stripOverflow||r.name.startsWith('390-')&&r.upper>140),cases:records.map(r=>r.name)};
}
