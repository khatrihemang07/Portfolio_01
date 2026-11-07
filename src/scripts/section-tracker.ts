// One scroll tracker for the Dock and the Ruler. It decides which target is
// current and marks it with aria-current="true" in both navs. Reads only happen
// inside the frame callback, and the DOM is written only when the target changes.

type Tick = { link: HTMLAnchorElement; target: HTMLElement; group: string };

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
    ticks.forEach((tick, i) => {
      const top = tick.target.getBoundingClientRect().top;
      // The nearest target above the probe wins. On a tie (tiles side by
      // side) the first one in the page wins.
      if (top <= probe && top > bestTop) {
        index = i;
        bestTop = top;
      }
    });
    return index;
  }

  function placeHighlight(): void {
    if (!list || !highlight) return;
    const active = dockLinks.find(
      (link) => link.getAttribute("aria-current") === "true",
    );
    if (!active) return;
    highlight.style.transform = `translateX(${active.offsetLeft}px)`;
    highlight.style.width = `${active.offsetWidth}px`;
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
    placeHighlight();
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

  if (location.hash) lockTo(location.hash);
  update();
  // The first placement must not animate in from the left edge.
  requestAnimationFrame(() => dock.setAttribute("data-ready", ""));

  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", () => {
    placeHighlight();
    schedule();
  });
  window.addEventListener("load", schedule);
  window.addEventListener("hashchange", () => {
    // Back to a URL with no (or an unknown) hash must hand control back to the
    // scroll position, or the old lock would keep a stale section current.
    if (indexForHash(location.hash) < 0) unlock();
    else lockTo(location.hash);
    schedule();
  });
  window.addEventListener("pageshow", schedule);
  // A label grows or shrinks when its link becomes current, which moves the links.
  dock.addEventListener("transitionend", (event) => {
    if (event.propertyName === "max-width") placeHighlight();
  });
}
