// One scroll tracker for the Dock and the Ruler. It decides which target is
// current and marks it with aria-current="true" in both navs. Target positions
// are cached (from layout, so reveal transforms do not skew them), a scroll frame
// only compares numbers, and the DOM is written only when the target changes.

type Tick = { link: HTMLAnchorElement; target: HTMLElement; group: string };

// Highlight glide: a critically damped spring (no overshoot) lasting GLIDE_MS. The
// label takes 0.35 s to grow or shrink, so the glide outlasts it and ends on the
// pill's settled geometry.
const GLIDE_MS = 500;
const SPRING_K = 12;
const settle = (t: number): number =>
  1 - (1 + SPRING_K * t) * Math.exp(-SPRING_K * t);
const SETTLE_END = settle(1);

// A target is current once its top has passed this share of the viewport height.
const PROBE = 0.35;

const dock = document.querySelector<HTMLElement>('nav[aria-label="Dock"]');
const ruler = document.querySelector<HTMLElement>('nav[aria-label="Ruler"]');

if (dock && ruler) {
  const ticks: Tick[] = [];
  for (const link of ruler.querySelectorAll<HTMLAnchorElement>(
    'a[href^="#"]',
  )) {
    const target = document.getElementById(link.hash.slice(1));
    if (target)
      ticks.push({ link, target, group: link.dataset.group ?? target.id });
  }

  const dockLinks = [
    ...dock.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'),
  ];
  const list = dock.querySelector<HTMLElement>(".dock-list");
  const highlight = dock.querySelector<HTMLElement>(".dock-highlight");

  // Page-space top of each target, from layout (offsetTop chain), refreshed on resize.
  let tops: number[] = [];
  const pageTop = (el: HTMLElement): number => {
    let top = 0;
    for (
      let node: HTMLElement | null = el;
      node;
      node = node.offsetParent as HTMLElement | null
    )
      top += node.offsetTop;
    return top;
  };
  function measure(): void {
    tops = ticks.map((tick) => pageTop(tick.target));
  }

  let current = -1;
  let frame = 0;
  // A target the visitor just chose (a click or a #hash). It stays current
  // until they scroll by hand, because a short page cannot always scroll a
  // chosen section to the probe line.
  let locked = -1;

  // Last tick whose target top has passed the probe line. At the very bottom
  // the last tick wins, so a short Contact section still becomes current.
  function indexAtScroll(): number {
    if (locked >= 0) return locked;
    const maxScroll =
      document.documentElement.scrollHeight - window.innerHeight;
    if (maxScroll > 0 && window.scrollY >= maxScroll - 2)
      return ticks.length - 1;
    const probe = window.innerHeight * PROBE;
    let index = 0;
    let bestTop = Number.NEGATIVE_INFINITY;
    tops.forEach((pageY, i) => {
      const top = pageY - window.scrollY;
      // The nearest target above the probe wins. On a tie (tiles side by
      // side) the first one in the page wins.
      if (top <= probe && top > bestTop) {
        index = i;
        bestTop = top;
      }
    });
    return index;
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  // What the highlight currently shows, so a new glide starts where the last one is.
  let shown = { x: 0, w: 0 };
  let glide = 0;

  function activeLink(): HTMLAnchorElement | undefined {
    return dockLinks.find(
      (link) => link.getAttribute("aria-current") === "true",
    );
  }

  function paint(x: number, w: number): void {
    if (!highlight) return;
    shown = { x, w };
    highlight.style.transform = `translateX(${x}px)`;
    highlight.style.width = `${w}px`;
  }

  // Instant placement on the active item's real geometry.
  function placeHighlight(): void {
    cancelAnimationFrame(glide);
    glide = 0;
    const active = activeLink();
    if (active) paint(active.offsetLeft, active.offsetWidth);
  }

  // Slide to the active item. Every frame reads the item's real geometry once
  // (it is changing while the label grows) and then writes once, so layout is
  // not forced twice in a frame. The last frame lands exactly on the real pill.
  function glideHighlight(): void {
    const active = activeLink();
    if (!active || !highlight) return;
    cancelAnimationFrame(glide);
    if (reduceMotion.matches || !dock?.hasAttribute("data-ready")) {
      placeHighlight();
      return;
    }
    const from = shown;
    const start = performance.now();
    const step = (now: number): void => {
      const x = active.offsetLeft;
      const w = active.offsetWidth;
      const t = Math.min(1, (now - start) / GLIDE_MS);
      const p = t >= 1 ? 1 : settle(t) / SETTLE_END;
      paint(from.x + (x - from.x) * p, from.w + (w - from.w) * p);
      glide = t < 1 ? requestAnimationFrame(step) : 0;
    };
    glide = requestAnimationFrame(step);
  }

  function markCurrent(index: number): void {
    current = index;
    const group = ticks[index]?.group;
    ticks.forEach((tick, i) => {
      if (i === index) tick.link.setAttribute("aria-current", "true");
      else tick.link.removeAttribute("aria-current");
    });
    dockLinks.forEach((link) => {
      if (link.hash.slice(1) === group)
        link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
    glideHighlight();
  }

  function update(): void {
    frame = 0;
    const index = indexAtScroll();
    if (index !== current) markCurrent(index);
  }

  function schedule(): void {
    if (!frame) frame = requestAnimationFrame(update);
  }

  function indexForHash(hash: string): number {
    const id = hash.replace(/^#/, "");
    return ticks.findIndex((tick) => tick.target.id === id);
  }

  function lockTo(hash: string): void {
    const index = indexForHash(hash);
    if (index < 0) return;
    locked = index;
    if (index !== current) markCurrent(index);
  }

  function unlock(): void {
    if (locked < 0) return;
    locked = -1;
    schedule();
  }

  for (const link of [...dockLinks, ...ticks.map((tick) => tick.link)]) {
    link.addEventListener("click", () => lockTo(link.hash));
  }
  // Any scrolling the visitor does themselves hands control back to the scroll position.
  for (const type of ["wheel", "touchstart", "pointerdown"] as const) {
    window.addEventListener(type, unlock, { passive: true });
  }
  window.addEventListener("keydown", (event) => {
    if (
      [
        "ArrowUp",
        "ArrowDown",
        "PageUp",
        "PageDown",
        "Home",
        "End",
        " ",
      ].includes(event.key)
    )
      unlock();
  });

  measure();
  if (location.hash) lockTo(location.hash);
  update();
  // The first placement must not animate in from the left edge.
  requestAnimationFrame(() => dock.setAttribute("data-ready", ""));

  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", () => {
    measure();
    placeHighlight();
    schedule();
  });
  window.addEventListener("load", () => {
    measure();
    placeHighlight();
    schedule();
  });
  // Late layout changes (fonts, lazy images) move targets and can resize the pill.
  const main = document.querySelector("main");
  if (main && "ResizeObserver" in window) {
    new ResizeObserver(() => {
      measure();
      schedule();
    }).observe(main);
  }
  if (list && "ResizeObserver" in window) {
    new ResizeObserver(() => {
      if (!glide) placeHighlight();
    }).observe(list);
  }
  window.addEventListener("hashchange", () => {
    // Back to a URL with no (or an unknown) hash must hand control back to the
    // scroll position, or the old lock would keep a stale section current.
    if (indexForHash(location.hash) < 0) unlock();
    else lockTo(location.hash);
    schedule();
  });
  window.addEventListener("pageshow", schedule);
}
