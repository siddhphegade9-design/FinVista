/** Landing page motion: scroll reveals and a replay of the example advisor chat. Content is fully visible without JS. */
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.documentElement;

if (!reduce && 'IntersectionObserver' in window) {
  root.classList.add('js-reveal');
  const items = [...document.querySelectorAll('.reveal')];
  // Stagger siblings that share a parent (bento tiles, steps, shields).
  items.forEach((node) => {
    const siblings = [...node.parentElement.children].filter((c) => c.classList.contains('reveal'));
    const i = siblings.indexOf(node);
    if (siblings.length > 1) node.style.transitionDelay = `${Math.min(i, 6) * 70}ms`;
  });
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  items.forEach((n) => io.observe(n));
  // Anything already on screen shows at once.
  requestAnimationFrame(() => items.forEach((n) => { if (n.getBoundingClientRect().top < innerHeight * 0.92) n.classList.add('is-in'); }));

  const chat = document.querySelector('[data-chat]');
  if (chat) {
    const msgs = [...chat.querySelectorAll('.chat__msg')];
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const play = async () => {
      chat.classList.add('is-playing');
      for (const m of msgs) {
        if (m.classList.contains('chat__msg--ai')) { chat.classList.add('is-typing'); await wait(1100); chat.classList.remove('is-typing'); }
        m.classList.add('is-shown');
        await wait(m.classList.contains('chat__msg--me') ? 500 : 900);
      }
    };
    const co = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { co.disconnect(); play(); } }, { threshold: 0.35 });
    co.observe(chat);
  }
}

// Shadow under the header once the page scrolls.
const header = document.querySelector('.site-header');
if (header) {
  const onScroll = () => header.classList.toggle('is-scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
}
