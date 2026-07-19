(() => {
  const body = document.body;

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

  // Mobile hamburger menu toggle
  const mobileMenuToggle = document.querySelector(".mobile-menu-toggle");
  const mobileMenu = document.getElementById("mobile-menu");

  mobileMenuToggle?.addEventListener("click", () => {
    if (!mobileMenu) return;
    const willOpen = mobileMenu.hidden;
    mobileMenu.hidden = !willOpen;
    mobileMenuToggle.setAttribute("aria-expanded", String(willOpen));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && mobileMenu && !mobileMenu.hidden) {
      mobileMenu.hidden = true;
      mobileMenuToggle.setAttribute("aria-expanded", "false");
      mobileMenuToggle.focus();
    }
  });

  // Sticky header keeps its bottom border only once content scrolls under it.
  const siteHeader = document.querySelector(".site-header");
  if (siteHeader) {
    const syncHeader = () => {
      siteHeader.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    syncHeader();
    window.addEventListener("scroll", syncHeader, { passive: true });
  }

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
