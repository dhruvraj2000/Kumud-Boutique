// Full-screen loader: stays up until fonts, the window load event, the essential images and the
// first view are ready, then wipes away. Every wait has its own timeout and the whole thing has a
// hard cap, so a stuck file can never keep visitors on the loader.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIN_SHOW = 1300, HARD_CAP = 15000, ITEM_CAP = 9000;

export function createLoader() {
  const el = document.getElementById('curtain');
  const root = document.documentElement;
  if (!el) { root.classList.remove('is-loading'); return { track() {}, trackImages() {}, trackSelector() {}, finish: async () => {} }; }
  const pct = el.querySelector('.curtain-pct'), start = performance.now();
  let total = 0, done = 0, shown = 0, finished = false, raf = 0;

  const track = (p, cap = ITEM_CAP) => {
    total++;
    Promise.race([Promise.resolve(p).catch(() => {}), sleep(cap)]).then(() => { done++; });
  };
  const trackImages = () => {
    [...document.images].filter(i => i.loading !== 'lazy' && i.src).forEach(img => {
      track(img.complete && img.naturalWidth ? Promise.resolve() : new Promise(res => { img.addEventListener('load', res, { once: true }); img.addEventListener('error', res, { once: true }); }).then(() => (img.decode ? img.decode().catch(() => {}) : 0)));
    });
  };
  // wait for a selector to appear (and optionally gain a class), e.g. the scroll story mounting
  const trackSelector = (sel, cls) => track((async () => { for (let i = 0; i < 60; i++) { const n = document.querySelector(sel); if (!n || !cls || n.classList.contains(cls)) return; await sleep(100); } })(), 6000);

  const paint = () => {
    const target = finished ? 1 : Math.min(0.93, total ? done / total : 0.04);
    shown += Math.max(0, target - shown) * 0.1;          // only ever moves forward
    const v = Math.min(1, shown);
    el.style.setProperty('--p', v.toFixed(4));
    if (pct) pct.textContent = String(Math.round(v * 100)).padStart(2, '0');
    raf = requestAnimationFrame(paint);
  };
  raf = requestAnimationFrame(paint);

  async function finish() {
    const settled = (async () => { while (done < total) await sleep(40); })();
    await Promise.race([settled, sleep(HARD_CAP)]);
    await sleep(Math.max(0, MIN_SHOW - (performance.now() - start)));
    finished = true;
    for (let i = 0; i < 30 && shown < 0.995; i++) await sleep(20);
    cancelAnimationFrame(raf); el.style.setProperty('--p', 1); if (pct) pct.textContent = '100';
    await sleep(180);
    el.classList.add('go');
    root.classList.remove('is-loading');
    window.dispatchEvent(new Event('kb:loaded'));
    setTimeout(() => el.remove(), 1100);
  }
  return { track, trackImages, trackSelector, finish };
}
