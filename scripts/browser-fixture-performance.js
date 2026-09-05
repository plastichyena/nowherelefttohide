// Playwright CLI run-code expression. Replace FIXTURES with validated Save 11
// fixtures before running. Test storage belongs to an isolated browser session.
async (page) => {
  const fixtures = /* FIXTURES */ [];
  const records = [];
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.start');
  const paint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  for (const fixture of fixtures) {
    for (let session = 0; session < 3; session++) {
      await page.evaluate(save => localStorage.setItem('nowhere-left-to-hide:auto-save:v11', save), fixture.save);
      await page.reload();
      await page.getByRole('button', { name: '続きから', exact: true }).click();
      await paint();
      // Allow the optional texture loader and camera resize to settle before
      // capturing coordinates; this setup delay is outside every sample.
      await page.waitForTimeout(750);
      const box = await page.locator('canvas').boundingBox();
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const hex = (q, r) => ({ x: Math.round(center.x + Math.sqrt(3) * 30 * (q - 25 + (r - 25) / 2)), y: Math.round(center.y + 45 * (r - 25)) });
      const timed = async (operation, fn) => {
        await page.evaluate(() => {
          window.__uiMeasure = { start: performance.now(), firstMutation: null, firstPaint: null };
          const observer = new MutationObserver(() => {
            if (window.__uiMeasure.firstMutation !== null) return;
            window.__uiMeasure.firstMutation = performance.now() - window.__uiMeasure.start;
            requestAnimationFrame(() => { window.__uiMeasure.firstPaint = performance.now() - window.__uiMeasure.start; });
          });
          observer.observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true });
          window.__uiObserver = observer;
        });
        const start = Date.now();
        await fn();
        await paint();
        const timing = await page.evaluate(() => { window.__uiObserver.disconnect(); return window.__uiMeasure; });
        records.push({ fixture: fixture.name, session, operation, completedMs: Date.now() - start, firstMutationMs: timing.firstMutation, firstPaintMs: timing.firstPaint });
      };
      for (let i = 0; i < 10; i++) {
        const p = hex(i % 2 ? 26 : 24, 25);
        await timed('select-unit', () => page.mouse.click(p.x, p.y));
      }
      await timed('move-mode', () => page.getByRole('button', { name: '移動', exact: true }).click());
      if (fixture.destination) {
        const p = hex(...fixture.destination);
        await timed('move-preview', () => page.mouse.click(p.x, p.y));
        const confirm = page.locator('[data-action="confirm-move"]').first();
        if (await confirm.count()) await timed('move-commit', () => confirm.click());
        else records.push({ fixture: fixture.name, session, operation: 'move-commit', unavailable: 'destination has no legal movement preview' });
      }
      for (let i = 0; i < 4; i++) await timed('resource-panel', () => page.locator('[data-action="toggle-resource"][data-resource="food"]').click());
      const clear = page.locator('[data-action="unit-clear-selection"]');
      if (await clear.count()) await clear.click();
      // Use the visible header: the narrow drag handle can be underneath a
      // board context overlay at some mobile sheet heights.
      for (let i = 0; i < 3; i++) await timed('sheet-toggle', () => page.locator('.sheet-header[data-action="sheet-toggle"]').click());
      // Reset sheet and selection via a reload of the same validated snapshot.
      await page.evaluate(save => localStorage.setItem('nowhere-left-to-hide:auto-save:v11', save), fixture.save);
      await page.reload();
      await page.getByRole('button', { name: '続きから', exact: true }).click();
      await timed('end-turn', async () => {
        await page.locator('[data-action="end-turn"]').click();
        const confirm = page.locator('[data-action="end-turn-confirm"]');
        if (await confirm.count()) await confirm.click();
        await page.waitForFunction(turn => Number(document.querySelector('[data-bind="turn"]')?.textContent) !== turn || !!document.querySelector('[data-screen="game-over"]'), fixture.turn);
      });
      await timed('pan', async () => {
        await page.mouse.move(center.x, center.y + 80);
        await page.mouse.down();
        await page.mouse.move(center.x + 40, center.y + 95, { steps: 8 });
        await page.mouse.up();
      });
      await timed('pinch', async () => {
        for (let i = 0; i < 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: i === 0 ? 'touchStart' : 'touchMove', touchPoints: [{ x: center.x - 30 - i * 2, y: center.y, id: 1 }, { x: center.x + 30 + i * 2, y: center.y, id: 2 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      });
    }
  }
  const profile = await cdp.send('Profiler.stop');
  const metrics = await cdp.send('Performance.getMetrics');
  if (errors.length) throw new Error(errors.join('\n'));
  return { url: page.url(), viewport: page.viewportSize(), browser: await page.context().browser().version(), dpr: await page.evaluate(() => devicePixelRatio), cpuThrottle: 1, initialZoom: 1, renderer: 'WebGL', fixtures: fixtures.map(({ save, ...metadata }) => metadata), records, metrics, profile, errors };
}
