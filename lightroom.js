(function () {
  const ready = (callback) => {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback);
    } else {
      callback();
    }
  };

  function initPreloader() {
    if (document.getElementById("preloader")) return;
    const preloader = document.createElement("div");
    preloader.id = "preloader";
    preloader.innerHTML = '<div class="pre-logo">ORIVÈA</div><div class="pre-bar-wrap"><div class="pre-bar"></div></div>';
    document.body.insertBefore(preloader, document.body.firstChild);

    const hide = () => {
      preloader.classList.add("is-hidden");
      window.setTimeout(() => preloader.remove(), 700);
    };

    if (document.readyState === "complete") {
      window.setTimeout(hide, 450);
    } else {
      window.addEventListener("load", () => window.setTimeout(hide, 450), { once: true });
      window.setTimeout(hide, 1800);
    }
  }

  function initCursor() {
    const finePointer = window.matchMedia("(pointer: fine) and (min-width: 768px)");
    if (!finePointer.matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const cursor = document.createElement("div");
    cursor.className = "luxury-cursor";
    document.body.appendChild(cursor);

    window.addEventListener("mousemove", (event) => {
      cursor.style.transform = `translate(${event.clientX}px, ${event.clientY}px) translate(-50%, -50%)`;
    }, { passive: true });

    document.addEventListener("mouseover", (event) => {
      if (event.target.closest("a, button, input, select, textarea, summary")) {
        cursor.classList.add("is-active");
      }
    });

    document.addEventListener("mouseout", (event) => {
      if (event.target.closest("a, button, input, select, textarea, summary")) {
        cursor.classList.remove("is-active");
      }
    });
  }

  function initReveals() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const selectors = [
      "main > section:not(.hero)",
      ".page-hero",
      ".product-card",
      ".policy-card",
      ".partner-benefits article",
      ".partner-step"
    ];
    const elements = Array.from(document.querySelectorAll(selectors.join(",")))
      .filter((element) => !element.closest(".cart-drawer") && !element.closest("[id*='paypal']"));

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });

    elements.forEach((element) => {
      element.classList.add("light-reveal");
      observer.observe(element);
    });
  }

  ready(() => {
    initPreloader();
    initCursor();
    initReveals();
  });
})();
