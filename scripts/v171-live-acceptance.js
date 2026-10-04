async page => {
 const errors=[],records=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(['warning','error'].includes(m.type()))errors.push(m.text());});
 await page.evaluate(async()=>{window.qa.ui.showTitle();const {LiveAiViewer}=await import('/src/browser/live-ai.ts');window.live=new LiveAiViewer({buildId:'v171-browser-acceptance'});});
 const saved=await page.evaluate(()=>JSON.stringify(localStorage));
 for(const [width,height] of [[390,844],[360,740],[1280,720]])for(const locale of ['ja','en']){
  await page.setViewportSize({width,height});await page.evaluate(l=>{window.qa.ui.locale=l;document.documentElement.lang=l;},locale);
  await page.locator('.live-ai-launcher').click();
  await page.locator('.live-map-start select[name="mapMode"]').selectOption('fixed');
  await page.locator('[data-live-ai="start"]').click();await page.waitForFunction(()=>window.live.getSession()?.getContext().lifecycle==='active');
  await page.locator('[data-live-ai="fit"]').click();
  const box=await page.locator('.live-ai-board canvas').boundingBox();
  await page.mouse.click(box.x+box.width/2-Math.sqrt(3)*Math.min(box.width/(Math.sqrt(3)*75+2),box.height/77)*.94,box.y+box.height/2);
  const details=await page.locator('.live-ai-panel .public-board-details').innerText();
  if(!details.includes('[police-1]'))throw Error('Live public name / ID missing: '+details);
  const comment=`Keep police-1; civilianFactory stays verbatim. ${locale}`;
  const response=await page.evaluate(async comment=>{const observed=window.live.getSession().observe();return window.live.act({generation:observed.generation,baseRevision:observed.revision,requestId:'acceptance-wait',action:{type:'Wait',unitId:'police-1'},decisionSummary:comment});},comment);
  if(!response.ok)throw Error('Live step rejected');
  await page.waitForFunction(()=>document.querySelector('.live-ai-result').textContent.includes('[police-1]'));
  const current=await page.locator('.live-ai-current p').innerText();if(current!==comment)throw Error('AI comment modified');
  const hidden=await page.evaluate(()=>{const live=window.live,visible=new Set(live.latestObservation.map.tiles.filter(t=>t.visibleToPlayer).map(t=>`${t.q},${t.r}`));return live.board.entities.filter(e=>e.kind==='unit'&&!e.data.isPlayerUnit&&!visible.has(`${e.position.q},${e.position.r}`));});
  if(hidden.length)throw Error('Hidden enemy rendered');
  await page.screenshot({path:`output/playwright/v171-live-${width}-${locale}.png`,fullPage:true});
  records.push({width,height,locale,details,comment,publicOnly:!hidden.length});
  await page.locator('[data-live-ai="pause"]').click();await page.locator('[data-live-ai="close"]').click();
 }
 if(saved!==await page.evaluate(()=>JSON.stringify(localStorage)))throw Error('Live changed normal save');
 return {records,errors,storageUnchanged:true};
}
