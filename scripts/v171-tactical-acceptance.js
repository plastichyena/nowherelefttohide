async page => {
 const records=[],errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const load=async locale=>page.evaluate(l=>window.qa.load(l,s=>{
  s.units=s.units.filter(u=>u.id==='police-1');
  for(const [type,p] of [['ifv',{q:23,r:25}],['multipurposeHelicopter',{q:24,r:24}],['fieldArtillery',{q:24,r:26}]])s.units.push(window.qa.createUnit(s,`${type}-${s.nextUnitNumber++}`,type,p));
 }),locale);
 const select=async type=>page.evaluate(type=>{const u=window.qa.ui;u.selection={kind:'unit',id:u.state.units.find(x=>x.type===type).id};u.sheetState='standard';u.updateView();},type);
 const audit=async name=>{const result=await page.evaluate(()=>{
  const text=document.querySelector('#app').innerText,u=window.qa.ui;
  const ids=u.state.units.map(x=>x.id).filter(id=>text.includes(id));
  const visible=e=>e.checkVisibility({checkVisibilityCSS:true})&&!e.closest('.sr-only');
  const tiny=[...document.querySelectorAll('#app button,#app summary')].filter(visible).filter(e=>{const r=e.getBoundingClientRect();return r.width<43.9||r.height<43.9;}).map(e=>e.textContent);
  const small=[...document.querySelectorAll('#app *')].filter(e=>visible(e)&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(e).fontSize)<11).map(e=>e.textContent);
  return {ids,tiny,small,overflow:document.documentElement.scrollWidth>innerWidth};
 });records.push({name,...result});};
 for(const [width,height] of [[390,844],[360,740],[1280,720]])for(const locale of ['ja','en']){
  await page.setViewportSize({width,height});const prefix=`${width}-${locale}`;
  await load(locale);await select('ifv');await page.locator('[data-section="aviation"]').click();
  const board=page.locator('[data-action="aviation-preview"]').filter({hasText:locale==='ja'?'搭乗':'Board'}).first();await board.click();await audit(prefix+'-board-confirm');
  if((await page.locator('[data-modal="aviation"]').innerText()).includes('BoardTransport'))throw Error('Untranslated transport action');
  await page.locator('[data-action="aviation-confirm"]').click();
  if(!await page.evaluate(()=>window.qa.ui.state.units.find(u=>u.type==='ifv').cargoUnitId))throw Error('Board did not execute');
  await audit(prefix+'-cargo-and-disabled-disembark');
  await load(locale);await select('multipurposeHelicopter');await page.locator('[data-section="aviation"]').click();
  await page.locator('[data-action="aviation-preview"]').filter({hasText:locale==='ja'?'離陸':'Take off'}).first().click();await audit(prefix+'-takeoff-confirm');await page.locator('[data-action="aviation-confirm"]').click();
  if(await page.evaluate(()=>window.qa.ui.state.units.find(u=>u.type==='multipurposeHelicopter').flightState)!=='airborne')throw Error('Takeoff did not execute');
  await audit(prefix+'-airborne-actions');
  await load(locale);await select('fieldArtillery');await page.locator('[data-action="change-artillery-mode"]').click();
  if(await page.evaluate(()=>window.qa.ui.state.units.find(u=>u.type==='fieldArtillery').mode)!=='deployed')throw Error('Artillery did not deploy');
  await audit(prefix+'-artillery');
  await page.evaluate(()=>{const u=window.qa.ui;u.selection={kind:'facility',id:u.state.facilities.find(f=>f.type==='airBase').id};u.droneTargetFacilityId=u.selection.id;u.sheetState='collapsed';u.updateView();});
  await audit(prefix+'-drone-target');
  const inside=await page.evaluate(()=>{const b=document.querySelector('.board-region').getBoundingClientRect(),c=document.querySelector('[data-unit-context-ui]').getBoundingClientRect(),s=document.querySelector('[data-action="toggle-supply"]').getBoundingClientRect();return c.left>=b.left&&c.right<=b.right&&c.top>=s.bottom&&c.bottom<=b.bottom;});if(!inside)throw Error('Drone controls outside board or over Supply');
  await page.locator('[data-action="drone-cancel"]').click();
  if(await page.evaluate(()=>window.qa.ui.droneTargetFacilityId!==null))throw Error('Drone target did not cancel');
 }
 return {count:records.length,errors,violations:records.filter(r=>r.ids.length||r.tiny.length||r.small.length||r.overflow)};
}
