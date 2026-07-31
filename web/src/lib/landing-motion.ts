export function mountLandingMotion(): void {
  const root = document.documentElement;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const revealNodes = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
  const nav = document.querySelector<HTMLElement>("[data-cinema-nav]");

  const revealAll = (): void => revealNodes.forEach((node) => node.classList.add("is-visible"));
  const canReveal = !reducedMotion && "IntersectionObserver" in window;

  if (!canReveal) {
    revealAll();
    root.classList.add("cinema-ready");
  } else {
    root.classList.add("cinema-motion");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12%", threshold: 0.12 },
    );
    revealNodes.forEach((node) => observer.observe(node));
  }

  const parallaxNodes = reducedMotion
    ? []
    : Array.from(document.querySelectorAll<HTMLElement>("[data-parallax]"));
  const glow = document.querySelector<HTMLElement>("[data-cursor-glow]");
  let ticking = false;

  const updateScroll = (): void => {
    ticking = false;
    const scrollMax = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
    const progress = Math.min(Math.max(window.scrollY / scrollMax, 0), 1);
    root.style.setProperty("--cinema-scroll", progress.toString());
    nav?.classList.toggle("is-scrolled", window.scrollY > 40);

    for (const node of parallaxNodes) {
      const rect = node.parentElement?.getBoundingClientRect();
      if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) continue;
      const strength = Number(node.dataset.parallax ?? "0.06");
      const centerOffset = rect.top + rect.height / 2 - window.innerHeight / 2;
      node.style.setProperty("--parallax-y", `${centerOffset * -strength}px`);
    }
  };

  const requestScrollUpdate = (): void => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(updateScroll);
  };

  window.addEventListener("scroll", requestScrollUpdate, { passive: true });
  window.addEventListener("resize", requestScrollUpdate, { passive: true });

  const supportsFinePointer = !reducedMotion && window.matchMedia("(pointer: fine)").matches;
  if (supportsFinePointer) {
    window.addEventListener(
      "pointermove",
      (event) => {
        root.style.setProperty("--pointer-x", `${event.clientX}px`);
        root.style.setProperty("--pointer-y", `${event.clientY}px`);
        glow?.classList.add("is-active");
      },
      { passive: true },
    );
  }

  window.requestAnimationFrame(() => {
    root.classList.add("cinema-ready");
    updateScroll();
  });
}
