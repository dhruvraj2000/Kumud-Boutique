/* Kumud Fashion Design — interactions */
(function(){
  "use strict";

  const $  = (sel, ctx=document)=> ctx.querySelector(sel);
  const $$ = (sel, ctx=document)=> Array.from(ctx.querySelectorAll(sel));

  /* ---------- Preloader ---------- */
  window.addEventListener('load', ()=>{
    const pre = $('#preloader');
    if(pre){
      setTimeout(()=> pre.classList.add('loaded'), 400);
      setTimeout(()=> pre.style.display='none', 1300);
    }
  });

  /* ---------- Year ---------- */
  const yearEl = $('#year');
  if(yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- Custom cursor ---------- */
  const dot = $('.cursor-dot');
  const ring = $('.cursor-ring');
  if(dot && ring && matchMedia('(hover:hover) and (pointer:fine)').matches){
    let mx=0,my=0, rx=0, ry=0;
    window.addEventListener('mousemove', e=>{
      mx = e.clientX; my = e.clientY;
      dot.style.transform = `translate(${mx}px,${my}px) translate(-50%,-50%)`;
    });
    (function loop(){
      rx += (mx-rx)*0.15; ry += (my-ry)*0.15;
      ring.style.transform = `translate(${rx}px,${ry}px) translate(-50%,-50%)`;
      requestAnimationFrame(loop);
    })();
    $$('a, button, .gallery-item, .collection-card').forEach(el=>{
      el.addEventListener('mouseenter', ()=> ring.classList.add('cursor-hover'));
      el.addEventListener('mouseleave', ()=> ring.classList.remove('cursor-hover'));
    });
  }

  /* ---------- Navbar scroll state + progress bar ---------- */
  const navbar = $('#navbar');
  const progress = $('#scrollProgress');
  const backToTop = $('#backToTop');
  function onScroll(){
    const y = window.scrollY;
    navbar && navbar.classList.toggle('scrolled', y > 40);
    backToTop && backToTop.classList.toggle('show', y > 600);
    const h = document.documentElement;
    const scrollPct = (h.scrollTop || document.body.scrollTop) / ((h.scrollHeight||document.body.scrollHeight) - h.clientHeight) * 100;
    if(progress) progress.style.width = scrollPct + '%';
  }
  document.addEventListener('scroll', onScroll, {passive:true});
  onScroll();
  backToTop && backToTop.addEventListener('click', ()=> window.scrollTo({top:0, behavior:'smooth'}));

  /* ---------- Mobile menu ---------- */
  const menuToggle = $('#menuToggle');
  const mobileMenu = $('#mobileMenu');
  function closeMenu(){
    menuToggle.classList.remove('active');
    mobileMenu.classList.remove('open');
    menuToggle.setAttribute('aria-expanded','false');
    document.body.style.overflow='';
  }
  if(menuToggle && mobileMenu){
    menuToggle.addEventListener('click', ()=>{
      const isOpen = mobileMenu.classList.toggle('open');
      menuToggle.classList.toggle('active', isOpen);
      menuToggle.setAttribute('aria-expanded', String(isOpen));
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });
    $$('.mobile-link').forEach(a=> a.addEventListener('click', closeMenu));
  }

  /* ---------- Smooth anchor scroll offset for fixed navbar ---------- */
  $$('a[href^="#"]').forEach(a=>{
    a.addEventListener('click', e=>{
      const id = a.getAttribute('href');
      if(id.length>1){
        const target = $(id);
        if(target){
          e.preventDefault();
          const top = target.getBoundingClientRect().top + window.scrollY - 84;
          window.scrollTo({top, behavior:'smooth'});
        }
      }
    });
  });

  /* ---------- Scroll reveal ---------- */
  const revealEls = $$('.reveal-up');
  const io = new IntersectionObserver((entries)=>{
    entries.forEach(entry=>{
      if(entry.isIntersecting){
        entry.target.classList.add('in-view');
        io.unobserve(entry.target);
      }
    });
  }, {threshold:0.15, rootMargin:'0px 0px -60px 0px'});
  revealEls.forEach(el=> io.observe(el));

  /* ---------- Petal field generator ---------- */
  const petalField = $('#petalField');
  if(petalField){
    const count = window.innerWidth < 700 ? 10 : 22;
    for(let i=0;i<count;i++){
      const p = document.createElement('span');
      p.className='petal';
      const left = Math.random()*100;
      const dur = 10 + Math.random()*10;
      const delay = Math.random()*-20;
      const size = 8 + Math.random()*10;
      p.style.left = left+'%';
      p.style.width = size+'px';
      p.style.height = size+'px';
      p.style.animationDuration = dur+'s';
      p.style.animationDelay = delay+'s';
      petalField.appendChild(p);
    }
  }

  /* ---------- Animated counters ---------- */
  const counters = $$('.stat-num');
  const counterIO = new IntersectionObserver((entries)=>{
    entries.forEach(entry=>{
      if(entry.isIntersecting){
        animateCount(entry.target);
        counterIO.unobserve(entry.target);
      }
    });
  }, {threshold:0.5});
  counters.forEach(c=> counterIO.observe(c));

  function animateCount(el){
    const target = parseInt(el.dataset.count, 10) || 0;
    const duration = 1400;
    const start = performance.now();
    function tick(now){
      const p = Math.min((now-start)/duration, 1);
      const eased = 1 - Math.pow(1-p, 3);
      el.textContent = Math.floor(eased*target);
      if(p<1) requestAnimationFrame(tick);
      else el.textContent = target;
    }
    requestAnimationFrame(tick);
  }

  /* ---------- Testimonial carousel ---------- */
  const track = $('#testiTrack');
  const dotsWrap = $('#testiDots');
  if(track && dotsWrap){
    const slides = $$('.testi-card', track);
    let index = 0;
    slides.forEach((_, i)=>{
      const b = document.createElement('button');
      if(i===0) b.classList.add('active');
      b.addEventListener('click', ()=> goTo(i));
      dotsWrap.appendChild(b);
    });
    const dots = $$('button', dotsWrap);

    function goTo(i){
      index = (i + slides.length) % slides.length;
      track.style.transform = `translateX(-${index*100}%)`;
      dots.forEach((d,di)=> d.classList.toggle('active', di===index));
    }
    let auto = setInterval(()=> goTo(index+1), 5500);
    [track, dotsWrap].forEach(el=>{
      el.addEventListener('mouseenter', ()=> clearInterval(auto));
      el.addEventListener('mouseleave', ()=> auto = setInterval(()=> goTo(index+1), 5500));
    });
  }

  /* ---------- Contact form (front-end only demo) ---------- */
  const form = $('#contactForm');
  if(form){
    form.addEventListener('submit', (e)=>{
      e.preventDefault();
      const btnText = $('#formBtnText');
      const note = $('#formNote');
      btnText.textContent = 'Sending…';
      setTimeout(()=>{
        btnText.textContent = 'Send Inquiry';
        note.textContent = "Thank you — your inquiry has been noted. The atelier will reach out within 48 hours.";
        form.reset();
      }, 1100);
    });
  }

  /* ---------- Tilt effect on collection cards ---------- */
  $$('.collection-card, .gallery-item').forEach(card=>{
    card.addEventListener('mousemove', (e)=>{
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left)/r.width - 0.5;
      const y = (e.clientY - r.top)/r.height - 0.5;
      card.style.transform = `perspective(900px) rotateX(${(-y*4).toFixed(2)}deg) rotateY(${(x*4).toFixed(2)}deg) translateZ(0)`;
    });
    card.addEventListener('mouseleave', ()=>{
      card.style.transform = '';
    });
  });

})();
