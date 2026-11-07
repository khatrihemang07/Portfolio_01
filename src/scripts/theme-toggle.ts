// Flips the theme shown from the current effective theme: the stored choice,
// or the system setting when there is none. The head script applies the stored
// choice before first paint; this only changes it on click.

const button = document.querySelector<HTMLButtonElement>("[data-theme-toggle]");

if (button) {
  const root = document.documentElement;
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  const isDark = (): boolean =>
    root.dataset.theme ? root.dataset.theme === "dark" : systemDark.matches;

  const render = (): void => {
    button.setAttribute("aria-pressed", String(isDark()));
  };

  button.addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Storage is blocked: the choice still applies for this visit.
    }
    render();
  });

  // With no stored choice the button follows the system setting when it changes.
  systemDark.addEventListener("change", render);
  render();
}
