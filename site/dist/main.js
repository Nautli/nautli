(() => {
  const root = document.documentElement;
  const body = document.body;

  function systemTheme() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function storedTheme() {
    try {
      const value = localStorage.getItem("nautli-theme");
      return value === "light" || value === "dark" ? value : null;
    } catch {
      return null;
    }
  }

  function applyTheme(theme, persist = false) {
    root.dataset.theme = theme;
    const button = document.querySelector(".theme-button");
    if (button) {
      const nextIsLight = theme === "dark";
      button.textContent = nextIsLight ? "☀" : "☾";
      button.setAttribute(
        "aria-label",
        nextIsLight ? button.dataset.lightLabel : button.dataset.darkLabel,
      );
    }
    if (persist) {
      try {
        localStorage.setItem("nautli-theme", theme);
      } catch {
        // The selected theme still applies for this page view.
      }
    }
  }

  applyTheme(storedTheme() ?? systemTheme());

  document.querySelector(".theme-button")?.addEventListener("click", () => {
    applyTheme(root.dataset.theme === "dark" ? "light" : "dark", true);
  });

  const languageButton = document.querySelector(".language-button");
  const languageMenu = document.querySelector(".language-menu");

  function closeLanguageMenu({ restoreFocus = false } = {}) {
    if (!languageButton || !languageMenu) return;
    languageMenu.hidden = true;
    languageButton.setAttribute("aria-expanded", "false");
    if (restoreFocus) languageButton.focus();
  }

  languageButton?.addEventListener("click", () => {
    if (!languageMenu) return;
    const willOpen = languageMenu.hidden;
    languageMenu.hidden = !willOpen;
    languageButton.setAttribute("aria-expanded", String(willOpen));
    if (willOpen) languageMenu.querySelector("a")?.focus();
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".language-picker")) closeLanguageMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && languageMenu && !languageMenu.hidden) {
      closeLanguageMenu({ restoreFocus: true });
    }
  });

  async function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }

    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy]");
    if (!button) return;

    const statusId = button.getAttribute("aria-describedby");
    const status = statusId ? document.getElementById(statusId) : null;
    button.disabled = true;
    try {
      const copied = await copyText(button.dataset.copy);
      if (!copied) throw new Error("copy unavailable");
      if (status) status.textContent = body.dataset.copySuccess;
    } catch {
      window.prompt(body.dataset.copyPrompt, button.dataset.copy);
      if (status) status.textContent = body.dataset.copyFailure;
    } finally {
      button.disabled = false;
      window.setTimeout(() => {
        if (status) status.textContent = "";
      }, 2000);
    }
  });

  if (body.dataset.page === "c") {
    const params = new URLSearchParams(window.location.search);
    const valueNodes = [...document.querySelectorAll("[data-share-value]")];
    let populated = false;

    for (const node of valueNodes) {
      const raw = params.get(node.dataset.shareValue);
      if (raw === null || !/^\d+(?:\.\d+)?$/.test(raw)) continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      node.textContent = raw;
      populated = true;
    }

    if (populated) {
      document.getElementById("share-empty").hidden = true;
      document.getElementById("share-result").hidden = false;
    }
  }
})();
