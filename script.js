(() => {
  const CONFIG = window.ORIVEA_CONFIG || {};
  const PRODUCTS = window.ORIVEA_PRODUCTS || [];
  const CART_KEY = "orivea_glantier_cart";
  const currency = new Intl.NumberFormat("nl-NL", { style: "currency", currency: CONFIG.currency || "EUR" });

  if (window.emailjs && CONFIG.emailJs?.publicKey) {
    emailjs.init(CONFIG.emailJs.publicKey);
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const money = (value) => currency.format(Number(value || 0));
  const normalize = (value) => String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const productById = (id) => PRODUCTS.find((product) => product.id === id);

  function cart() {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY)) || [];
    } catch {
      return [];
    }
  }

  function saveCart(items) {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
    renderCartState();
  }

  function addToCart(id, qty = 1) {
    const product = productById(id);
    if (!product) return;
    const items = cart();
    const line = items.find((item) => item.id === id);
    if (line) line.qty += qty;
    else items.push({ id, qty });
    saveCart(items);
    openCart();
  }

  function updateQty(id, qty) {
    if (qty < 1) {
      removeFromCart(id);
      return;
    }
    saveCart(cart().map((item) => item.id === id ? { ...item, qty } : item));
  }

  function removeFromCart(id) {
    saveCart(cart().filter((item) => item.id !== id));
  }

  function totals() {
    const lines = cart().map((item) => ({ ...item, product: productById(item.id) })).filter((line) => line.product);
    const subtotal = lines.reduce((sum, line) => sum + line.product.prijs * line.qty, 0);
    const shipping = subtotal >= CONFIG.freeShippingFrom ? 0 : subtotal >= CONFIG.minimumOrderAmount ? CONFIG.shippingCost : 0;
    return { lines, subtotal, shipping, total: subtotal + shipping };
  }

  function cartLineHtml(line) {
    return `<div class="cart-line">
      <img src="${line.product.image}" alt="${line.product.naam}" loading="lazy">
      <div><strong>${line.product.naam}</strong><p>${line.product.type} · ${line.product.inhoud}</p><div class="qty-control"><button type="button" data-qty-minus="${line.id}">-</button><span>${line.qty}</span><button type="button" data-qty-plus="${line.id}">+</button><button type="button" class="remove-line" data-remove="${line.id}">Verwijder</button></div></div>
      <strong>${money(line.product.prijs * line.qty)}</strong>
    </div>`;
  }

  function totalsHtml(data) {
    const notice = data.subtotal > 0 && data.subtotal < CONFIG.minimumOrderAmount ? `<p class="notice">Bestellen kan vanaf ${money(CONFIG.minimumOrderAmount)}.</p>` : "";
    return `<div class="totals"><div><span>Subtotaal</span><strong>${money(data.subtotal)}</strong></div><div><span>Verzendkosten</span><strong>${data.subtotal >= CONFIG.freeShippingFrom ? "Gratis" : money(data.shipping)}</strong></div><div><span>Totaal</span><strong>${money(data.total)}</strong></div>${notice}</div>`;
  }

  function renderCartState() {
    const data = totals();
    $$("[data-cart-count]").forEach((el) => el.textContent = data.lines.reduce((sum, line) => sum + line.qty, 0));
    $$("[data-mini-cart]").forEach((el) => {
      el.innerHTML = data.lines.length ? data.lines.map(cartLineHtml).join("") + totalsHtml(data) : '<p class="empty">Je winkelwagen is nog leeg.</p>';
    });
    const checkoutItems = $("[data-checkout-items]");
    if (checkoutItems) checkoutItems.innerHTML = data.lines.length ? data.lines.map(cartLineHtml).join("") : '<p class="empty">Je winkelwagen is nog leeg.</p>';
    const checkoutTotals = $("[data-checkout-totals]");
    if (checkoutTotals) checkoutTotals.innerHTML = totalsHtml(data);
  }

  function openCart() {
    $("[data-cart-drawer]")?.classList.add("open");
  }

  function closeCart() {
    $("[data-cart-drawer]")?.classList.remove("open");
  }

  function productCard(product) {
    const ref = product.parfumReferentie ? `<p>Referentie: ${product.parfumReferentie}</p>` : "";
    return `<article class="product-card">
      <img src="${product.image}" alt="${product.naam}" loading="lazy">
      <div class="product-body">
        <span class="product-meta">${product.glantierNummer ? `Glantier ${product.glantierNummer}` : product.categorie}</span>
        <h3>${product.naam}</h3>
        <p>${product.geurgroep}</p>${ref}
        <div class="product-footer"><span class="price">${money(product.prijs)}</span><button class="button primary" type="button" data-add-to-cart="${product.id}">Toevoegen</button></div>
      </div>
    </article>`;
  }

  function renderHomeProducts() {
    $$("[data-products]").forEach((target) => {
      const type = target.dataset.products;
      let items = PRODUCTS;
      if (type === "bestsellers") {
        items = PRODUCTS.filter((product) => product.zoektermen?.some((term) => ["bestseller", "sauvage", "one million", "good girl", "black opium", "coco mademoiselle"].includes(term))).slice(0, 8);
      }
      if (type === "gifts") {
        items = PRODUCTS.filter((product) => ["Boxen", "Geurstokjes", "Geurhangers", "15 ml", "Bodymist"].includes(product.categorie)).slice(0, 4);
      }
      target.innerHTML = items.map(productCard).join("");
    });
  }

  function levenshtein(a, b) {
    if (!a || !b) return Math.max(a.length, b.length);
    const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
    for (let j = 0; j <= a.length; j += 1) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i += 1) {
      for (let j = 1; j <= a.length; j += 1) {
        matrix[i][j] = b[i - 1] === a[j - 1] ? matrix[i - 1][j - 1] : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
      }
    }
    return matrix[b.length][a.length];
  }

  function scoreProduct(product, query) {
    const q = normalize(query);
    if (!q) return 0;
    const haystack = [product.id, product.glantierNummer, product.naam, product.type, product.doelgroep, product.categorie, product.geurgroep, product.merkReferentie, product.parfumReferentie, ...(product.zoektermen || [])].map(normalize).filter(Boolean);
    let score = 0;
    for (const term of haystack) {
      if (term === q) score = Math.max(score, 100);
      if (term.includes(q) || q.includes(term)) score = Math.max(score, 78);
      for (const part of term.split(" ")) {
        const distance = levenshtein(part, q);
        if (q.length > 3 && distance <= 2) score = Math.max(score, 58 - distance);
      }
    }
    return score;
  }

  function findMatches(query, limit = 4) {
    return PRODUCTS.map((product) => ({ product, score: scoreProduct(product, query) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.product.prijs - b.product.prijs)
      .slice(0, limit)
      .map((item) => item.product);
  }

  function renderMatch(query) {
    const result = $("[data-match-result]");
    if (!result) return;
    const matches = findMatches(query, 4);
    if (!matches.length) {
      result.innerHTML = '<p class="notice">Geen directe match gevonden. Probeer een merknaam, geurgroep of Glantier nummer.</p>';
      return;
    }
    result.innerHTML = matches.map((product) => `<div class="match-card"><img src="${product.image}" alt="${product.naam}"><div><p class="eyebrow">Beste match</p><h3>${product.naam}</h3><p>${product.geurgroep} · ${product.doelgroep} · ${product.inhoud}</p><p>${product.omschrijving}</p><p class="price">${money(product.prijs)}</p><div class="hero-actions"><button class="button primary" type="button" data-add-to-cart="${product.id}">Toevoegen aan winkelwagen</button><a class="button ghost" href="catalogus.html">Bekijk collectie</a></div><p class="notice">Alle merknamen worden uitsluitend gebruikt als vergelijkingsreferentie. ORIVÈA verkoopt Glantier-producten.</p></div></div>`).join("");
  }

  function initMatch() {
    const form = $("[data-match-form]");
    if (!form) return;
    const input = $("[data-match-input]");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      renderMatch(input.value);
    });
    input.addEventListener("input", () => renderMatch(input.value));
    $$("[data-match-examples] button").forEach((button) => button.addEventListener("click", () => {
      input.value = button.textContent;
      renderMatch(input.value);
    }));
  }

  function initCatalog() {
    const grid = $("[data-catalog-grid]");
    if (!grid) return;
    const filters = ["Dames", "Heren", "Unisex", "Premium", "15 ml", "Boxen", "Geurstokjes", "Geurhangers", "Fris", "Bloemig", "Zoet", "Houtachtig", "Kruidig", "Oriëntaals", "Aquatisch", "Aromatisch", "Chypre"];
    const filterList = $("[data-filter-list]");
    let active = new URLSearchParams(location.search).get("filter") || "";
    if (filterList) filterList.innerHTML = filters.map((filter) => `<button type="button" data-filter="${filter}" class="${normalize(filter) === normalize(active) ? "active" : ""}">${filter}</button>`).join("");

    function render() {
      const query = $("[data-catalog-search]")?.value || "";
      let items = PRODUCTS.filter((product) => !active || normalize([product.doelgroep, product.categorie, product.geurgroep, product.type, product.premiumBeschikbaar ? "Premium" : ""].join(" ")).includes(normalize(active)));
      if (query) {
        items = items.map((product) => ({ product, score: scoreProduct(product, query) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).map((item) => item.product);
      }
      const sort = $("[data-sort]")?.value;
      if (sort === "price-asc") items.sort((a, b) => a.prijs - b.prijs);
      if (sort === "price-desc") items.sort((a, b) => b.prijs - a.prijs);
      if (sort === "number") items.sort((a, b) => String(a.glantierNummer || "9999").localeCompare(String(b.glantierNummer || "9999")));
      grid.innerHTML = items.map(productCard).join("");
      const count = $("[data-product-count]");
      if (count) count.textContent = `${items.length} producten`;
    }

    filterList?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-filter]");
      if (!button) return;
      active = active === button.dataset.filter ? "" : button.dataset.filter;
      $$("[data-filter]", filterList).forEach((btn) => btn.classList.toggle("active", btn.dataset.filter === active));
      render();
    });
    $("[data-catalog-search]")?.addEventListener("input", render);
    $("[data-sort]")?.addEventListener("change", render);
    render();
  }

  function initCheckout() {
    const form = $("[data-checkout-form]");
    if (!form) return;
    let step = 1;
    const showStep = (next) => {
      step = Math.min(5, Math.max(1, next));
      $$("[data-step]").forEach((el) => el.classList.toggle("active", Number(el.dataset.step) === step));
      $$("[data-step-tab]").forEach((el) => el.classList.toggle("active", Number(el.dataset.stepTab) === step));
      renderCartState();
    };
    $$("[data-next-step]").forEach((button) => button.addEventListener("click", () => showStep(step + 1)));
    $$("[data-prev-step]").forEach((button) => button.addEventListener("click", () => showStep(step - 1)));
    $$("[data-step-tab]").forEach((button) => button.addEventListener("click", () => showStep(Number(button.dataset.stepTab))));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = $("[data-order-status]");
      const data = totals();
      if (!data.lines.length) {
        status.textContent = "Je winkelwagen is nog leeg.";
        return;
      }
      if (data.subtotal < CONFIG.minimumOrderAmount) {
        status.textContent = `Bestellen kan vanaf ${money(CONFIG.minimumOrderAmount)}.`;
        return;
      }
      const formData = Object.fromEntries(new FormData(form).entries());
      const date = new Date();
      const orderNumber = `ORI-${date.toISOString().slice(0, 10).replaceAll("-", "")}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      const orderLines = data.lines.map((line) => `${line.qty}x ${line.product.naam} (${line.product.type}, ${line.product.inhoud}) - ${money(line.product.prijs * line.qty)}`).join("\n");
      const payload = { ...formData, order_number: orderNumber, customer_address: `${formData.street} ${formData.house_number}, ${formData.postal_code} ${formData.city}`, products: orderLines, subtotal: money(data.subtotal), shipping: money(data.shipping), total: money(data.total), order_date: date.toLocaleString("nl-NL"), contact_email: CONFIG.contactEmail };
      status.textContent = "Bestelling wordt verzonden...";
      try {
        if (!window.emailjs) throw new Error("EmailJS niet geladen");
        await emailjs.send(CONFIG.emailJs.serviceId, CONFIG.emailJs.orderTemplate, payload);
        localStorage.removeItem(CART_KEY);
        renderCartState();
        status.textContent = `Bedankt voor je bestelling. Je ordernummer is ${orderNumber}. We nemen zo snel mogelijk contact met je op via ${CONFIG.contactEmail}.`;
      } catch {
        status.textContent = "Verzenden lukte niet direct. Mail je bestelling naar shop@orivea.nl, dan helpen we je verder.";
      }
    });
  }

  function initContact() {
    const form = $("[data-contact-form]");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = $("[data-contact-status]");
      status.textContent = "Bericht wordt verzonden...";
      const payload = Object.fromEntries(new FormData(form).entries());
      try {
        if (!window.emailjs) throw new Error("EmailJS niet geladen");
        await emailjs.send(CONFIG.emailJs.serviceId, CONFIG.emailJs.contactTemplate, payload);
        form.reset();
        status.textContent = "Bedankt voor je bericht. ORIVÈA neemt zo snel mogelijk contact met je op.";
      } catch {
        status.textContent = "Verzenden lukte niet direct. Mail ons via shop@orivea.nl.";
      }
    });
  }

  function initNewsletter() {
    const form = $("[data-newsletter-form]");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = $("[data-newsletter-status]");
      status.textContent = "Aanmelding wordt verzonden...";
      const payload = Object.fromEntries(new FormData(form).entries());
      payload.message = `Nieuwe nieuwsbriefaanmelding via orivea.nl\nNaam: ${payload.name}\nE-mail: ${payload.email}`;
      try {
        if (!window.emailjs) throw new Error("EmailJS niet geladen");
        await emailjs.send(CONFIG.emailJs.serviceId, CONFIG.emailJs.contactTemplate, payload);
        form.reset();
        status.textContent = "Bedankt voor je aanmelding. Je ontvangt binnenkort ORIVÈA updates.";
      } catch {
        status.textContent = "Aanmelden lukte niet direct. Mail ons via shop@orivea.nl.";
      }
    });
  }

  document.addEventListener("click", (event) => {
    const add = event.target.closest("[data-add-to-cart]");
    if (add) addToCart(add.dataset.addToCart);
    const plus = event.target.closest("[data-qty-plus]");
    if (plus) {
      const line = cart().find((item) => item.id === plus.dataset.qtyPlus);
      updateQty(plus.dataset.qtyPlus, (line?.qty || 1) + 1);
    }
    const minus = event.target.closest("[data-qty-minus]");
    if (minus) {
      const line = cart().find((item) => item.id === minus.dataset.qtyMinus);
      updateQty(minus.dataset.qtyMinus, (line?.qty || 1) - 1);
    }
    const remove = event.target.closest("[data-remove]");
    if (remove) removeFromCart(remove.dataset.remove);
  });

  $("[data-cart-open]")?.addEventListener("click", openCart);
  $("[data-cart-close]")?.addEventListener("click", closeCart);
  $("[data-cart-drawer]")?.addEventListener("click", (event) => {
    if (event.target.matches("[data-cart-drawer]")) closeCart();
  });
  $(".menu-toggle")?.addEventListener("click", () => $(".main-nav")?.classList.toggle("open"));
  const header = $(".site-header");
  const updateHeaderState = () => header?.classList.toggle("scrolled", window.scrollY > 8);
  updateHeaderState();
  window.addEventListener("scroll", updateHeaderState, { passive: true });

  renderCartState();
  renderHomeProducts();
  initMatch();
  initCatalog();
  initCheckout();
  initContact();
  initNewsletter();
})();
