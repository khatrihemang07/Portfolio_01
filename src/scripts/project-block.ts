// Progressive enhancement for Project Blocks: tabs for the text and controls for
// the Gallery. Without this script every tab panel is visible and the Gallery is
// a plain scrollable, snapping strip, so nothing here is required to read the page.

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function setupTabs(block: HTMLElement): void {
  const list = block.querySelector<HTMLElement>('[role="tablist"]');
  if (!list) return;
  const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const panels = tabs.map((tab) =>
    document.getElementById(tab.getAttribute("aria-controls") ?? ""),
  );
  if (tabs.length === 0 || panels.some((panel) => !panel)) return;

  function select(index: number, focus: boolean): void {
    tabs.forEach((tab, i) => {
      const on = i === index;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      if (panels[i]) panels[i].hidden = !on;
    });
    if (focus) tabs[index]?.focus();
  }

  list.addEventListener("keydown", (event) => {
    const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    let next = -1;
    if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
    else if (event.key === "ArrowLeft")
      next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    select(next, true);
  });
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(i, false));
  });

  block.classList.add("tabs-ready");
  list.hidden = false;
  select(0, false);
}

function setupGallery(block: HTMLElement): void {
  const track = block.querySelector<HTMLElement>("[data-gallery-track]");
  const controls = block.querySelector<HTMLElement>("[data-gallery-controls]");
  if (!track || !controls) return;
  const slides = [...track.children] as HTMLElement[];
  // One Slide has nothing to flip through: the controls stay hidden.
  if (slides.length < 2) return;

  const dots = [
    ...controls.querySelectorAll<HTMLButtonElement>("[data-gallery-dot]"),
  ];
  const prev = controls.querySelector<HTMLButtonElement>("[data-gallery-prev]");
  const next = controls.querySelector<HTMLButtonElement>("[data-gallery-next]");

  let active = 0;
  const show = (index: number): void => {
    active = index;
    dots.forEach((dot, i) => {
      if (i === index) dot.setAttribute("aria-current", "true");
      else dot.removeAttribute("aria-current");
    });
    if (prev) prev.disabled = index === 0;
    if (next) next.disabled = index === slides.length - 1;
  };

  // The dots always follow the real scroll position, so they stay right however the
  // strip moved (buttons, dots, trackpad, touch, keyboard) and in every browser.
  // `aim` is where the last button press is heading: a quick second press continues
  // from there instead of from a strip that has not moved yet (an interrupted smooth
  // scroll would otherwise snap back).
  let aim = 0;
  const base = (): number => {
    const target = slides[aim];
    const arrived =
      target && Math.abs(track.scrollLeft - target.offsetLeft) < 2;
    return arrived ? active : aim;
  };
  const goTo = (index: number): void => {
    aim = Math.max(0, Math.min(slides.length - 1, index));
    track.scrollTo({
      left: slides[aim]?.offsetLeft ?? 0,
      behavior: reduceMotion.matches ? "auto" : "smooth",
    });
  };
  // A hand on the strip overrides any pending aim.
  for (const type of ["wheel", "touchstart", "pointerdown", "keydown"] as const)
    track.addEventListener(
      type,
      () => {
        aim = active;
      },
      { passive: true },
    );

  let frame = 0;
  track.addEventListener(
    "scroll",
    () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        let nearest = 0;
        let best = Number.POSITIVE_INFINITY;
        slides.forEach((slide, i) => {
          const distance = Math.abs(slide.offsetLeft - track.scrollLeft);
          if (distance < best) {
            best = distance;
            nearest = i;
          }
        });
        if (nearest !== active) show(nearest);
      });
    },
    { passive: true },
  );

  prev?.addEventListener("click", () => goTo(base() - 1));
  next?.addEventListener("click", () => goTo(base() + 1));
  dots.forEach((dot, i) => {
    dot.addEventListener("click", () => goTo(i));
  });

  controls.hidden = false;
  show(0);
}

for (const block of document.querySelectorAll<HTMLElement>(".project-block")) {
  setupTabs(block);
  setupGallery(block);
}
