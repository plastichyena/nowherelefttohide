async page => {
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(['warning','error'].includes(m.type()))errors.push(m.text());});
 await page.waitForFunction(()=>window.qa);
 await page.evaluate(()=>{window.qa.load('ja');});
 await page.locator('.board-region canvas').waitFor();
 await page.waitForFunction(()=>window.qa.ui.boardScene);
 const paint=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const results=[];
 const measure=async name=>{await paint();const metrics=await page.evaluate(()=>{
   const app=document.querySelector('#app').getBoundingClientRect(), board=document.querySelector('.board-region').getBoundingClientRect(), sheet=document.querySelector('.bottom-sheet').getBoundingClientRect();
   const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('[hidden]');
   const text=[...document.querySelectorAll('#app *')].filter(e=>visible(e)&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&!e.classList.contains('sr-only'));
   const small=text.filter(e=>parseFloat(getComputedStyle(e).fontSize)<11).map(e=>[e.tagName,e.className,getComputedStyle(e).fontSize]);
   const targets=[...document.querySelectorAll('#app button,#app select,#app summary,#app input:not([type=hidden])')].filter(visible).filter(e=>!e.closest('.sr-only'));
   const tiny=targets.filter(e=>{const r=e.getBoundingClientRect();return r.width<43.9||r.height<43.9;}).map(e=>[e.textContent.slice(0,50),e.getBoundingClientRect().width,e.getBoundingClientRect().height]);
   const overflow=document.documentElement.scrollWidth>innerWidth;
   return {board:board.height,ratio:board.height/app.height,upper:board.top-app.top,sheet:sheet.height,small,tiny,overflow,text:document.querySelector('.bottom-sheet').innerText};
 });results.push({name,...metrics});};
 for(const [width,height] of [[390,844],[360,740],[1280,720]]) for(const locale of ['ja','en']) {
  await page.setViewportSize({width,height});
  await page.evaluate(locale=>window.qa.load(locale),locale);await page.waitForFunction(()=>window.qa.ui.boardScene);await paint();
  await measure(`${width}-${locale}-empty`);
  await page.evaluate(()=>{const u=window.qa.ui;const unit=u.state.units.find(x=>x.id==='police-1');u.boardScene.focusHex(unit.position);u.onTileTap(unit.position);});
  await measure(`${width}-${locale}-unit`);
  await page.screenshot({path:`output/playwright/v171-${width}-${locale}-unit.png`});
  await page.locator('[data-action="panel-details"]').click();
  const open=await page.locator('.panel-section[open]').count();if(open)throw Error('Details opened together');
  await measure(`${width}-${locale}-expanded`);
  await page.locator('.panel-section > summary').first().click();
  await page.locator('.panel-section > summary').nth(1).click();
  if(await page.locator('.panel-section[open]').count()!==1)throw Error('Details not exclusive');
  await page.locator('[data-nav="domestic"]').click();
  if(await page.locator('[data-unit-context-ui]').count())throw Error('Unit menu in domestic');
  await page.locator('[data-nav="map"]').click();
  if(await page.locator('.bottom-sheet').getAttribute('data-sheet')!=='standard')throw Error('Selection not restored');
  const facilityIds=await page.evaluate(()=>window.qa.ui.state.facilities.map(f=>f.id));
  for(const id of facilityIds) {
    await page.evaluate(id=>{const ui=window.qa.ui;const f=ui.state.facilities.find(f=>f.id===id);ui.selection={kind:'facility',id};ui.sheetState='standard';ui.updateView();},id);
    await measure(`${width}-${locale}-${id}`);
  }
  await page.evaluate(()=>{const ui=window.qa.ui;ui.selection={kind:'checkpoint',id:ui.state.checkpoints[0].id};ui.sheetState='standard';ui.updateView();});
  await measure(`${width}-${locale}-checkpoint`);
  await page.locator('[data-action="open-panel"][data-section="policy"]').click();
  if(!await page.locator('[data-policy]').isVisible())throw Error('Policy inaccessible');
  await page.evaluate(()=>{const ui=window.qa.ui;ui.selection={kind:'hex',position:{q:24,r:24}};ui.sheetState='standard';ui.updateView();});
  await measure(`${width}-${locale}-terrain`);
 }
 await page.evaluate(results=>window.qaResults=results,results);
 return {count:results.length,errors,metrics:results.filter(r=>/-empty$|-unit$/.test(r.name)).map(({name,board,ratio,upper,sheet})=>({name,board,ratio,upper,sheet})),violations:results.filter(r=>r.small.length||r.tiny.length||r.overflow||r.name.startsWith('390')&&(/-empty$/.test(r.name)?r.ratio<.55:/-unit$/.test(r.name)?r.ratio<.45:false))};
}
