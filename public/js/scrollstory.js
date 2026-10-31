// Scroll-driven story: one pinned stage, one number (r = screens scrolled) drives every
// opacity / scale / blur / glow. No timelines or tweens — each frame we map r through fit().
const clamp01 = x => Math.min(1, Math.max(0, x));
// map x from [a,b] to [c,d], clamped, optional easing
export const fit = (x, a, b, c, d, ease = t => t) => c + (d - c) * ease(clamp01((x - a) / (b - a)));
const expoOut = t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const smooth = t => t * t * (3 - 2 * t);

// wrap every character in a span (keeps words together so wrapping still works)
function split(el) {
  const chars = [];
  const walk = node => {
    [...node.childNodes].forEach(n => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach(part => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.append(' '); return; }
          const w = document.createElement('span'); w.className = 'ss-w';
          [...part].forEach(ch => { const c = document.createElement('span'); c.className = 'ss-ch'; c.textContent = ch; w.append(c); chars.push(c); });
          frag.append(w);
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1) walk(n);
    });
  };
  walk(el);
  el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
  return chars;
}

export function mountScrollStory(root, onLeave) {
  if (!root || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const $ = s => root.querySelector(s);
  const bg2 = $('[data-ss=bg2]'), bg3 = $('[data-ss=bg3]'), glow = $('[data-ss=glow]'), hint = $('[data-ss=hint]');
  const artA = $('[data-ss=artA]'), artB = $('[data-ss=artB]'), artC = $('[data-ss=artC]');
  const spark = $('[data-ss=spark]'), marq = $('[data-ss=marq]'), seal = $('[data-ss=seal]'), dots = [...root.querySelectorAll('[data-ss=dots] li')];
  const sp = Array.from({ length: 16 }, (_, i) => { const s = document.createElement('i'); s.textContent = '✦'; const x = (i * 37 + 11) % 100, y = (i * 53 + 7) % 100, z = 0.4 + ((i * 29) % 10) / 10; s.style.cssText = `left:${x}%;top:${y}%;font-size:${8 + z * 14}px`; s._z = z; s._p = i; spark.append(s); return s; });
  let mx = 0, my = 0, tx = 0, ty = 0;
  const onMove = e => { tx = e.clientX / innerWidth - 0.5; ty = e.clientY / innerHeight - 0.5; };
  addEventListener('pointermove', onMove, { passive: true }); onLeave(() => removeEventListener('pointermove', onMove));
  const imgB = artB.querySelector('img'), imgC = artC.querySelector('img');
  const title = $('[data-ss=title]'), titleChars = split(title);
  title.querySelectorAll('.ss-ch').forEach(c => { c.style.display = 'inline-block'; });
  // text blocks: [selector, fadeIn start, fadeIn end, fadeOut start, fadeOut end]
  const blocks = [['t1', 0.05, 0.5, 0.6, 0.95], ['t2h', 1.45, 1.95, 2.3, 2.65], ['t2p', 1.7, 2.1, 2.3, 2.65], ['t3h', 2.75, 3.2, 9, 10], ['t3p', 2.95, 3.3, 9, 10]]
    .map(([k, a, b, c, d]) => {
      const el = $(`[data-ss=${k}]`), chars = el.hasAttribute('data-split') ? split(el) : [];
      return { el, chars, a, b, c, d };
    });
  root.classList.add('is-live');

  let cur = 0, last = performance.now(), raf = 0, visible = false;
  const maxR = () => Math.max(0.01, root.offsetHeight / innerHeight - 1);

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const rect = root.getBoundingClientRect();
    const target = Math.min(maxR(), Math.max(0, -rect.top / innerHeight));
    cur += (target - cur) * (1 - Math.exp(-dt * 9));   // one place of smoothing
    if (Math.abs(target - cur) < 0.0004) cur = target;
    const r = cur;
    mx += (tx - mx) * 0.07; my += (ty - my) * 0.07;
    const tilt = ` perspective(1200px) rotateY(${mx * 9}deg) rotateX(${my * -6}deg)`;
    title.style.transform = `translate3d(${mx * -2.2}vw,${my * -1.5}vh,0)`;
    // sparkles drift upward with scroll, each at its own depth
    sp.forEach(s => { s.style.transform = `translate3d(${mx * s._z * 40}px,${-((r * 260 * s._z) % 700) + my * s._z * 30}px,0)`; s.style.opacity = (0.25 + 0.55 * Math.abs(Math.sin(now / 900 + s._p))) * (1 - fit(r, 3.1, 3.5, 0, 0.6)); });
    // outline text band slides sideways, seal spins
    marq.style.opacity = fit(r, 1.2, 1.8, 0, 0.9) * (1 - fit(r, 2.9, 3.3, 0, 0.7));
    marq.style.transform = `translate3d(${-r * 16 + 8}vw,0,0)`;
    seal.style.opacity = fit(r, 1.5, 2.0, 0, 1) * (1 - fit(r, 2.4, 2.8, 0, 1)) + fit(r, 2.9, 3.3, 0, 1);
    seal.style.transform = `translate(-50%,-50%) rotate(${r * 140}deg) scale(${fit(r, 1.5, 2.0, 0.8, 1, expoOut)})`;
    dots.forEach((d, i) => d.classList.toggle('on', (i === 0 && r < 1.2) || (i === 1 && r >= 1.2 && r < 2.6) || (i === 2 && r >= 2.6)));

    // backgrounds
    bg2.style.opacity = fit(r, 0.75, 1.4, 0, 1);
    bg3.style.opacity = fit(r, 2.25, 2.9, 0, 1);
    hint.style.opacity = 1 - fit(r, 0.05, 0.3, 0, 1);

    // big title letters leave one by one
    titleChars.forEach((c, i) => {
      const k = i / Math.max(1, titleChars.length - 1), p = fit(r, 0.25 + k * 0.25, 0.85 + k * 0.25, 0, 1, smooth);
      c.style.opacity = 1 - p; c.style.transform = `translateY(${-p * 14}vh)`; c.style.filter = `blur(${p * 0.12}em)`;
    });

    // A: whole garment drifts toward you and fades
    const aOut = fit(r, 0.85, 1.35, 0, 1);
    artA.style.opacity = 1 - aOut;
    artA.style.transform = `translate3d(0,${fit(r, 0, 1.35, 0, -5, smooth)}vh,0) scale(${fit(r, 0, 1.35, 1, 1.3, smooth)})${tilt}`;
    artA.style.filter = aOut > 0.01 ? `blur(${aOut * 8}px)` : 'none';

    // B: detail zoom in an arch
    const bIn = fit(r, 1.1, 1.75, 0, 1), bOut = fit(r, 2.3, 2.85, 0, 1);
    artB.style.opacity = bIn * (1 - bOut);
    artB.style.transform = `scale(${fit(r, 1.1, 1.75, 0.72, 1, expoOut) * fit(r, 2.3, 2.85, 1, 0.78, smooth)}) translate3d(${fit(r, 2.3, 2.85, 0, -8, smooth)}vw,0,0)${tilt}`;
    artB.style.filter = `blur(${(1 - bIn) * 10 + bOut * 8}px)`;
    imgB.style.transform = `scale(${fit(r, 1.3, 2.6, 1.5, 2.4, smooth)})`;

    // C: the twirl photo arrives, edge glow starts travelling
    const cIn = fit(r, 2.55, 3.15, 0, 1);
    artC.style.opacity = cIn;
    artC.style.transform = `translate3d(0,${(1 - cIn) * 8}vh,0) scale(${fit(r, 2.55, 3.15, 0.82, 1, expoOut)})${tilt}`;
    artC.style.filter = `blur(${(1 - cIn) * 10}px)`;
    imgC.style.transform = `scale(${fit(r, 2.55, 3.5, 1.18, 1, smooth)})`;
    const g = fit(r, 2.55, 3.0, 0, 1);
    glow.style.opacity = g;
    if (g > 0.01) glow.style.setProperty('--ga', ((r / maxR()) * 360 + (now / 2000) * 360) % 360 + 'deg');   // a pulse every 2s, starting from scroll position

    // text blocks
    blocks.forEach(({ el, chars, a, b, c, d }) => {
      const pin = fit(r, a, b, 0, 1), pout = fit(r, c, d, 0, 1), vis = pin * (1 - pout);
      el.style.opacity = chars.length ? (vis > 0.001 ? 1 : 0) : vis;
      el.style.pointerEvents = vis > 0.6 ? 'auto' : 'none';
      el.style.filter = pout > 0.01 ? `blur(${pout * 0.12}em)` : 'none';
      if (!chars.length) { el.style.transform = `translateY(${(1 - pin) * 24 + pout * -16}px)`; return; }
      chars.forEach((ch, i) => {
        const k = i / Math.max(1, chars.length - 1);
        ch.style.opacity = fit(pin, k * 0.3, k * 0.3 + 0.4, 0, 1, expoOut) * (1 - pout);
        ch.style.transform = `translateX(${fit(pin, k * 0.3, k * 0.3 + 0.6, 0.25, 0, expoOut)}ex)`;
        ch.style.filter = `blur(${fit(pin, k * 0.3, k * 0.3 + 0.6, 0.1, 0, expoOut)}em)`;
      });
    });

    if (visible) raf = requestAnimationFrame(frame);
  }

  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }, { rootMargin: '100px' });
  io.observe(root);
  onLeave(() => { io.disconnect(); visible = false; if (raf) cancelAnimationFrame(raf); });
  requestAnimationFrame(frame);
}
