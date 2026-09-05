// Playwright CLI expression, using isolated test Save 11 fixtures.
async (page) => {
  const fixtures = /* FIXTURES */ [];
  const attackSave = /* ATTACK */ '';
  const records=[];const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const paint=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const load=async save=>{await page.evaluate(save=>localStorage.setItem('nowhere-left-to-hide:auto-save:v11',save),save);await page.reload();await page.getByRole('button',{name:'続きから',exact:true}).click();const guide=page.locator('[data-action="guide-close"]');if(await guide.count())await guide.click();await page.waitForTimeout(750);};
  const center=async()=>{const b=await page.locator('canvas').boundingBox();return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}};
  const timed=async(fixture,session,operation,fn)=>{const start=Date.now();await fn();await paint();records.push({fixture,session,operation,completedMs:Date.now()-start})};
  for(const fixture of fixtures)for(let session=0;session<3;session++){
    await load(fixture.save);const c=await center();await page.mouse.click(c.x,c.y);
    const tab=page.locator('[data-action="select-same-target"][data-selection-kind="facility"]');if(await tab.count())await tab.click();
    await page.locator('[data-nav="domestic"]').click();
    const slider=page.locator('[data-transfer-slider="true"]');
    await slider.scrollIntoViewIfNeeded();await slider.focus();
    for(let i=0;i<10;i++)await timed(fixture.name,session,'population-slider',()=>slider.press(i%2?'ArrowLeft':'ArrowRight'));
  }
  for(let session=0;session<3;session++){
    await load(attackSave);const c=await center();await page.mouse.click(c.x+52,c.y);
    await timed('reachable-attack-turn4',session,'attack-mode',()=>page.getByRole('button',{name:'攻撃',exact:true}).click());
    await timed('reachable-attack-turn4',session,'attack-preview',()=>page.mouse.click(c.x,c.y-90));
    await timed('reachable-attack-turn4',session,'attack-commit',()=>page.locator('[data-action="confirm-attack"]').first().click());
    const summary=await page.locator('[data-bind="selection-summary"]').textContent();
    if(!summary.includes('攻撃権 0/1'))throw new Error('Attack did not consume a charge');
  }
  if(errors.length)throw new Error(errors.join('\n'));
  return{url:page.url(),viewport:page.viewportSize(),records,errors};
}
