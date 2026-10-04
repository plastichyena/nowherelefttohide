async page => {
 const outcomes=['won','lost'], records=[], errors=[];
 const fixtures=await (await page.request.get(new URL('/output/playwright/v171-fixtures-latest.json',page.url()).href)).json();
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(['warning','error'].includes(m.type()))errors.push(m.text());});
 await page.evaluate(()=>{window.qa.ui.destroyBoard();});
 const saved=await page.evaluate(()=>JSON.stringify(localStorage));
 for(const [width,height] of [[390,844],[360,740],[1280,720]]) for(const locale of ['ja','en']) for(const outcome of outcomes) {
  await page.setViewportSize({width,height});
  await page.evaluate(async locale=>{document.documentElement.lang=locale;const {showReplay}=await import('/src/replay/view.ts');showReplay(document.querySelector('#app'),locale,()=>{});},locale);
  await page.locator('[data-replay="file"]').setInputFiles(fixtures.records.find(record=>record.outcome===outcome).output);
  await page.waitForFunction(()=>document.querySelector('[data-replay="position"]').textContent.includes('1/3'));
  await page.locator('[data-replay="next"]').click();await page.waitForFunction(()=>document.querySelector('[data-replay="position"]').textContent.includes('2/3'));
  await page.locator('[data-replay="next"]').click();await page.waitForFunction(()=>document.querySelector('[data-replay="position"]').textContent.includes('3/3'));
  await page.locator('[data-replay="speed"]').selectOption('4');
  await page.locator('[data-replay="play"]').click();
  await page.waitForFunction(outcome=>document.querySelector('[data-replay="position"]').textContent.includes(outcome==='won'?(document.documentElement.lang==='ja'?'勝利':'Victory'):(document.documentElement.lang==='ja'?'敗北':'Defeat')),outcome);
  const ending=await page.locator('[data-replay="position"]').innerText();
  await page.screenshot({path:`output/playwright/v171-replay-${width}-${locale}-${outcome}.png`,fullPage:true});
  await page.locator('[data-replay="prev"]').click();await page.waitForFunction(()=>document.querySelector('[data-replay="position"]').textContent.includes('2/3'));await page.locator('[data-replay="prev"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-replay="position"]').textContent.includes('1/3'));
  const canvas=page.locator('[data-replay="board"]');const box=await canvas.boundingBox();
  // PublicBoardRenderer's fit projects the central capital/adjacent deployment into this center region.
  await page.mouse.click(box.x+box.width/2-Math.sqrt(3)*Math.min(box.width/(Math.sqrt(3)*75+2),box.height/77)*.94,box.y+box.height/2);
  const details=await page.locator('.public-board-details').innerText();
  if(!details.includes('[police-1]'))throw Error('Unit name / full ID missing: '+details);
  records.push({width,height,locale,outcome,ending,details});
  await page.locator('[data-replay="exit"]').click();
 }
 const after=await page.evaluate(()=>JSON.stringify(localStorage));
 if(saved!==after)throw Error('Replay changed normal-game storage');
 return {records,errors,storageUnchanged:saved===after};
}
