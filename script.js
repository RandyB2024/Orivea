(() => {
  const CONFIG = window.ORIVEA_CONFIG || {};
  const PRODUCTS = window.ORIVEA_PRODUCTS || [];
  const CART_KEY = "orivea_glantier_cart";
  const ORDERS_KEY = "orivea_orders";
  const LAST_ORDER_KEY = "orivea_last_order";
  const CATALOG_CONFIG = {
    productsPerPage: 8
  };
  const currency = new Intl.NumberFormat("nl-NL", { style: "currency", currency: CONFIG.currency || "EUR" });

  if (window.emailjs && CONFIG.emailJs?.publicKey) {
    emailjs.init(CONFIG.emailJs.publicKey);
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const money = (value) => currency.format(Number(value || 0));
  const normalize = (value) => String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const productById = (id) => PRODUCTS.find((product) => product.id === id);
  const freeShippingFrom = Number(CONFIG.freeShippingFrom || 75);
  const itemKey = (item) => item.key || `${item.id}:${item.variant || "signature"}`;
  const vaderdagScents = {
    "717": { inspiredBy: "Acqua di Gio", image: "assets/images/orivea-vaderdag-set-717.png" },
    "724": { inspiredBy: "Invictus", image: "assets/images/orivea-vaderdag-set-724.png" },
    "728": { inspiredBy: "Boss Bottled", image: "assets/images/orivea-vaderdag-set-728.png" },
    "759": { inspiredBy: "One Million", image: "assets/images/orivea-vaderdag-set-759.png" },
    "771": { inspiredBy: "Sauvage", image: "assets/images/orivea-vaderdag-set-771.png" },
    "782": { inspiredBy: "Bad Boy", image: "assets/images/orivea-vaderdag-set-782.png" }
  };

  function shippingFor(subtotal) {
    if (!subtotal) return 0;
    const rule = (CONFIG.shippingRules || []).find((item) => subtotal >= item.min && (item.max === null || subtotal <= item.max));
    return Number(rule?.cost ?? 0);
  }

  function productVariant(product, variant = "signature") {
    if (!product) return null;
    if (product.id === "vaderdag-premium-set") {
      const scent = String(variant || "").replace("vaderdag-", "");
      const selected = vaderdagScents[scent] || vaderdagScents["717"];
      const glantier = vaderdagScents[scent] ? scent : "717";
      return {
        ...product,
        naam: `${product.naam} - Glantier ${glantier}`,
        type: "Vaderdag Premium Set",
        inhoud: "Premium parfum 50 ml, doucheolie 400 ml en luxe cadeautas",
        parfumReferentie: `Geïnspireerd door de geurbeleving van ${selected.inspiredBy}`,
        image: selected.image,
        prijs: product.prijs
      };
    }
    if (variant === "discovery") {
      return { ...product, naam: `${product.naam} Discovery 15 ml`, type: "Discovery", inhoud: "15 ml", prijs: CONFIG.pricing?.discovery15 || 5.95, image: "assets/images/orivea-discovery-sample-transparent.png" };
    }
    if (variant === "premium" && product.premiumBeschikbaar) {
      return { ...product, naam: `${product.naam} Premium 50 ml`, type: "Premium", inhoud: "50 ml", prijs: product.premiumPrijs || CONFIG.pricing?.premium50 || 16.95, image: product.premiumImage || product.image };
    }
    if ((String(variant || "").startsWith("geur-") || product.geurKeuzes?.length) && product.geurKeuzes?.length) {
      const number = String(variant || "").startsWith("geur-") ? String(variant).replace("geur-", "") : product.geurKeuzes[0].nummer;
      const choice = product.geurKeuzes.find((item) => item.nummer === number) || product.geurKeuzes[0];
      return { ...product, naam: `${product.naam} - ${choice.naam}`, type: product.type, inhoud: `${product.inhoud} - ${choice.geurgroep}`, prijs: product.prijs };
    }
    return { ...product, type: product.id === "vaderdag-premium-set" ? product.type : "Signature EDP", inhoud: product.inhoud || "50 ml", prijs: product.prijs };
  }

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

  function addToCart(id, qty = 1, variant = "signature") {
    const product = productById(id);
    if (!product) return;
    if (variant === "premium" && !product.premiumBeschikbaar) return;
    const items = cart();
    const key = `${id}:${variant}`;
    const line = items.find((item) => itemKey(item) === key);
    if (line) line.qty += qty;
    else items.push({ id, variant, key, qty });
    saveCart(items);
    openCart();
  }

  function updateQty(key, qty) {
    if (qty < 1) {
      removeFromCart(key);
      return;
    }
    saveCart(cart().map((item) => itemKey(item) === key ? { ...item, qty } : item));
  }

  function removeFromCart(key) {
    saveCart(cart().filter((item) => itemKey(item) !== key));
  }

  function totals() {
    const lines = cart().map((item) => {
      const base = productById(item.id);
      return { ...item, key: itemKey(item), product: productVariant(base, item.variant || "signature") };
    }).filter((line) => line.product);
    const subtotal = lines.reduce((sum, line) => sum + line.product.prijs * line.qty, 0);
    const shipping = shippingFor(subtotal);
    return { lines, subtotal, shipping, total: subtotal + shipping };
  }

  function cartLineHtml(line) {
    return `<div class="cart-line">
      <img src="${line.product.image}" alt="${line.product.naam}" loading="lazy">
      <div><strong>${line.product.naam}</strong><p>${line.product.type} · ${line.product.inhoud}</p><div class="qty-control"><button type="button" data-qty-minus="${line.key}">-</button><span>${line.qty}</span><button type="button" data-qty-plus="${line.key}">+</button><button type="button" class="remove-line" data-remove="${line.key}">Verwijder</button></div></div>
      <strong>${money(line.product.prijs * line.qty)}</strong>
    </div>`;
  }

  function totalsHtml(data) {
    const remaining = Math.max(0, freeShippingFrom - data.subtotal);
    const progress = Math.min(100, Math.round((data.subtotal / freeShippingFrom) * 100));
    const notice = data.subtotal > 0 && remaining > 0 ? `Nog ${money(remaining)} voor gratis verzending` : data.subtotal > 0 ? "Gratis verzending bereikt" : `Gratis verzending vanaf ${money(freeShippingFrom)}`;
    return `<div class="totals">
      <p class="shipping-note">Gratis verzending vanaf ${money(freeShippingFrom)}</p>
      <div class="shipping-progress" aria-label="${notice}"><span style="width:${progress}%"></span></div>
      <p class="notice">${notice}</p>
      <div><span>Subtotaal</span><strong>${money(data.subtotal)}</strong></div>
      <div><span>Verzendkosten</span><strong>${data.shipping === 0 && data.subtotal > 0 ? "Gratis" : money(data.shipping)}</strong></div>
      <div><span>Totaal</span><strong>${money(data.total)}</strong></div>
    </div>`;
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

  function cartIcon(label = "Toevoegen aan winkelwagen") {
    return `<svg class="cart-symbol" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6.2 6h15l-1.9 8.4a2 2 0 0 1-2 1.6H9.1a2 2 0 0 1-2-1.7L5.5 3H2.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9.7" cy="20" r="1.4" fill="currentColor"/><circle cx="17.3" cy="20" r="1.4" fill="currentColor"/></svg><span class="sr-only">${label}</span>`;
  }

  function productCard(product) {
    const isFragrance = ["Dames", "Heren", "Unisex"].includes(product.categorie) && product.glantierNummer;
    const reference = product.parfumReferentie ? `<p class="product-reference">Geïnspireerd door de geurbeleving van ${product.parfumReferentie}</p>` : "";
    const scentGroup = product.geurgroep ? product.geurgroep.replace(/\s*-\s*/g, " • ") : "";
    const title = product.glantierNummer ? `GLANTIER ${product.glantierNummer}` : product.naam;
    const premiumInfo = product.premiumBeschikbaar ? `<button class="premium-info-link" type="button" data-premium-info="${product.id}">Wat is Premium?</button>` : "";
    const choiceSelector = product.geurKeuzes?.length ? `<label class="choice-selector">Kies je geur<select data-card-choice>${product.geurKeuzes.map((choice) => `<option value="geur-${choice.nummer}">${choice.naam} - ${choice.geurgroep}</option>`).join("")}</select></label>` : "";
    const variantSelector = isFragrance ? `<div class="variant-selector" data-card-variants>
          <button class="variant-option" type="button" data-card-variant="discovery">15 ml <span>${money(CONFIG.pricing?.discovery15 || 5.95)}</span></button>
          <button class="variant-option selected" type="button" data-card-variant="signature">50 ml <span>${money(product.prijs)}</span></button>
          ${product.premiumBeschikbaar ? `<button class="variant-option premium-option" type="button" data-card-variant="premium">Premium 50 ml <span>${money(product.premiumPrijs || CONFIG.pricing?.premium50 || 16.95)}</span></button>` : ""}
        </div>` : "";
    const priceLine = isFragrance ? "" : `<p class="price product-price">${money(product.prijs)}</p>`;
    const actions = product.id === "vaderdag-premium-set"
      ? `<button class="button primary" type="button" data-add-to-cart="${product.id}">Bestel Vaderdag Set</button>`
      : `<div class="product-buy-row"><div class="card-qty"><button type="button" data-card-qty-minus>-</button><input type="number" min="1" value="1" inputmode="numeric" data-card-qty aria-label="Aantal"><button type="button" data-card-qty-plus>+</button></div><button class="button primary cart-symbol-button" type="button" data-card-add="${product.id}" aria-label="Toevoegen aan winkelwagen">${cartIcon()}</button></div>`;
    return `<article class="product-card product-card-refined ${product.premiumBeschikbaar ? "premium-available" : ""}" data-product-card>
      <img src="${product.premiumImage || product.image}" alt="${product.naam}" loading="lazy">
      <div class="product-body">
        <span class="product-meta">${product.categorie}</span>
        <h3>${title}</h3>
        ${reference}
        <p class="scent-group">${scentGroup}</p>
        <p class="product-short">${product.omschrijving}</p>
        ${priceLine}
        <p class="sample-mini">Gratis ORIV&Eacute;A Discovery Sample bij iedere bestelling.</p>
        <div class="product-purchase">
          ${choiceSelector}
          ${variantSelector}
          ${premiumInfo}
          ${actions}
        </div>
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
        items = PRODUCTS.filter((product) => ["Boxen", "Geurstokjes", "Bodymist"].includes(product.categorie)).slice(0, 4);
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
    result.innerHTML = matches.map((product) => {
      const scentGroup = product.geurgroep ? product.geurgroep.replace(/\s*-\s*/g, " &bull; ") : "";
      const reference = product.parfumReferentie ? `<p>Geïnspireerd door de geurbeleving van ${product.parfumReferentie}</p>` : "";
      return `<div class="match-card"><img src="${product.premiumImage || product.image}" alt="${product.naam}"><div><p class="eyebrow">Beste match</p><h3>GLANTIER ${product.glantierNummer || product.id}</h3>${reference}<p>${scentGroup} • ${product.doelgroep}</p><p>${product.omschrijving}</p><p class="price">Vanaf ${money(product.prijs)}</p><div class="hero-actions"><button class="button primary cart-symbol-button" type="button" data-add-to-cart="${product.id}" aria-label="Toevoegen aan winkelwagen">${cartIcon()}</button><a class="button ghost" href="catalogus.html">Bekijk collectie</a></div><p class="notice">Alle merknamen worden uitsluitend gebruikt als vergelijkingsreferentie. ORIVÈA verkoopt Glantier-producten.</p></div></div>`;
    }).join("");
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
    const filters = ["Dames", "Heren", "Unisex", "Premium", "Bodymist", "Boxen", "Geurstokjes", "Fris", "Bloemig", "Zoet", "Houtachtig", "Kruidig", "Oriëntaals", "Aquatisch", "Aromatisch", "Chypre"];
    const filterList = $("[data-filter-list]");
    let active = new URLSearchParams(location.search).get("filter") || "";
    let currentPage = 1;
    let filteredProducts = [];
    let totalPages = 1;
    const productsPerPage = CATALOG_CONFIG.productsPerPage;
    const catalogContent = grid.parentElement;
    const paginationInfo = document.createElement("p");
    const paginationTop = document.createElement("div");
    const paginationBottom = document.createElement("div");

    paginationInfo.className = "catalog-page-info";
    paginationTop.className = "catalog-pagination catalog-pagination-top";
    paginationBottom.className = "catalog-pagination catalog-pagination-bottom";
    grid.insertAdjacentElement("beforebegin", paginationInfo);
    grid.insertAdjacentElement("beforebegin", paginationTop);
    grid.insertAdjacentElement("afterend", paginationBottom);

    if (filterList) filterList.innerHTML = filters.map((filter) => `<button type="button" data-filter="${filter}" class="${normalize(filter) === normalize(active) ? "active" : ""}">${filter}</button>`).join("");

    function getFilteredProducts() {
      const query = $("[data-catalog-search]")?.value || "";
      let items = PRODUCTS.filter((product) => !active || normalize([product.doelgroep, product.categorie, product.geurgroep, product.type, product.premiumBeschikbaar ? "Premium" : ""].join(" ")).includes(normalize(active)));
      if (query) {
        items = items.map((product) => ({ product, score: scoreProduct(product, query) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).map((item) => item.product);
      }
      const sort = $("[data-sort]")?.value;
      if (sort === "price-asc") items.sort((a, b) => a.prijs - b.prijs);
      if (sort === "price-desc") items.sort((a, b) => b.prijs - a.prijs);
      if (sort === "number") items.sort((a, b) => String(a.glantierNummer || "9999").localeCompare(String(b.glantierNummer || "9999")));
      return items;
    }

    function pageNumbers() {
      if (totalPages <= 5) return Array.from({ length: totalPages }, (_, index) => index + 1);
      if (window.matchMedia("(max-width: 620px)").matches) {
        const start = Math.max(1, Math.min(currentPage - 1, totalPages - 2));
        return [start, start + 1, start + 2];
      }
      const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
      return Array.from({ length: 5 }, (_, index) => start + index);
    }

    function renderPagination() {
      const showPagination = totalPages > 1;
      const numbers = pageNumbers().map((page) => `<button type="button" data-page-action="page" data-page="${page}" class="${page === currentPage ? "active" : ""}" aria-current="${page === currentPage ? "page" : "false"}">${page}</button>`).join("");
      const html = showPagination ? `<button type="button" data-page-action="previous" ${currentPage === 1 ? "disabled" : ""}>Vorige</button><div class="page-numbers">${numbers}</div><span class="mobile-page-count">${currentPage} / ${totalPages}</span><button type="button" data-page-action="next" ${currentPage === totalPages ? "disabled" : ""}>Volgende</button>` : "";
      paginationTop.innerHTML = html;
      paginationBottom.innerHTML = html;
      paginationTop.hidden = !showPagination;
      paginationBottom.hidden = !showPagination;
    }

    function renderCatalog() {
      filteredProducts = getFilteredProducts();
      totalPages = Math.max(1, Math.ceil(filteredProducts.length / productsPerPage));
      currentPage = Math.min(currentPage, totalPages);
      const start = (currentPage - 1) * productsPerPage;
      const end = start + productsPerPage;
      const pagedItems = filteredProducts.slice(start, end);
      grid.innerHTML = pagedItems.length ? pagedItems.map(productCard).join("") : '<p class="empty">Geen producten gevonden.</p>';
      const from = filteredProducts.length ? start + 1 : 0;
      const to = Math.min(end, filteredProducts.length);
      const resultText = filteredProducts.length === 1 ? "product" : "producten";
      const rangeText = filteredProducts.length ? `Toont ${from}-${to} van ${filteredProducts.length} ${resultText}` : "Geen producten gevonden";
      const count = $("[data-product-count]");
      if (count) count.textContent = rangeText;
      paginationInfo.textContent = rangeText;
      renderPagination();
    }

    function goToPage(page) {
      currentPage = Math.min(totalPages, Math.max(1, Number(page) || 1));
      renderCatalog();
      catalogContent?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function nextPage() {
      goToPage(currentPage + 1);
    }

    function previousPage() {
      goToPage(currentPage - 1);
    }

    function resetAndRender() {
      currentPage = 1;
      renderCatalog();
    }

    function handlePaginationClick(event) {
      const button = event.target.closest("[data-page-action]");
      if (!button || button.disabled) return;
      event.preventDefault();
      const action = button.dataset.pageAction;
      if (action === "page") goToPage(button.dataset.page);
      if (action === "previous") previousPage();
      if (action === "next") nextPage();
    }

    [paginationTop, paginationBottom].forEach((pagination) => {
      pagination.addEventListener("click", handlePaginationClick);
    });

    filterList?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-filter]");
      if (!button) return;
      active = active === button.dataset.filter ? "" : button.dataset.filter;
      $$('[data-filter]', filterList).forEach((btn) => btn.classList.toggle("active", btn.dataset.filter === active));
      resetAndRender();
    });
    $("[data-catalog-search]")?.addEventListener("input", resetAndRender);
    $("[data-sort]")?.addEventListener("change", resetAndRender);
    window.addEventListener("resize", renderPagination, { passive: true });
    renderCatalog();
  }

  function generateOrderNumber() {
    const date = new Date();
    return `ORI-${date.toISOString().slice(0, 10).replaceAll("-", "")}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  }

  function formatOrderLines(data) {
    return data.lines.map((line) => `${line.qty}x ${line.product.naam} (${line.product.type}, ${line.product.inhoud}) - ${money(line.product.prijs * line.qty)}`).join("\n");
  }

  function checkoutFormData(form) {
    const formData = Object.fromEntries(new FormData(form).entries());
    return {
      ...formData,
      customer_address: ((formData.street || "") + " " + (formData.house_number || "") + ", " + (formData.postal_code || "") + " " + (formData.city || "")).trim()
    };
  }

  function normalizeOrderFormData(source) {
    const formData = source instanceof HTMLFormElement ? checkoutFormData(source) : source || {};
    return {
      ...formData,
      customer_address: formData.customer_address || ((formData.street || "") + " " + (formData.house_number || "") + ", " + (formData.postal_code || "") + " " + (formData.city || "")).trim()
    };
  }

  function buildOrderPayload(form, paypal) {
    const data = totals();
    const formData = normalizeOrderFormData(form);
    const orderNumber = generateOrderNumber();
    return {
      order_number: orderNumber,
      customer_name: formData.customer_name || "",
      customer_email: formData.customer_email || "",
      customer_phone: formData.customer_phone || "",
      customer_address: formData.customer_address,
      order_date: new Date().toLocaleString("nl-NL"),
      order_items: formatOrderLines(data),
      subtotal: money(data.subtotal),
      shipping_cost: data.shipping === 0 ? "Gratis" : money(data.shipping),
      total: money(data.total),
      paypal_transaction_id: paypal?.transactionId || "",
      payment_status: paypal?.paymentStatus || "Betaald",
      note: formData.note || ""
    };
  }

  function storeOrder(payload) {
    const stored = JSON.parse(localStorage.getItem(ORDERS_KEY) || "[]");
    stored.push(payload);
    localStorage.setItem(ORDERS_KEY, JSON.stringify(stored.slice(-50)));
    localStorage.setItem(LAST_ORDER_KEY, JSON.stringify(payload));
  }

  function loadPayPalSdk() {
    if (window.paypal) return Promise.resolve(window.paypal);
    const clientId = CONFIG.paypalClientId || "";
    if (!clientId) return Promise.reject(new Error("PayPal Client ID ontbreekt"));
    return new Promise((resolve, reject) => {
      const existing = document.querySelector("script[data-paypal-sdk]");
      if (existing) {
        existing.addEventListener("load", () => window.paypal ? resolve(window.paypal) : reject(new Error("PayPal SDK niet beschikbaar na laden")));
        existing.addEventListener("error", reject);
        return;
      }
      const script = document.createElement("script");
      script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(CONFIG.paypalCurrency || CONFIG.currency || "EUR")}&intent=capture`;
      script.dataset.paypalSdk = "true";
      script.onload = () => window.paypal ? resolve(window.paypal) : reject(new Error("PayPal SDK niet beschikbaar na laden"));
      script.onerror = () => reject(new Error("PayPal SDK kon niet laden"));
      document.head.appendChild(script);
    });
  }

  function sendOrderConfirmation(payload) {
    if (!window.emailjs) return Promise.reject(new Error("EmailJS niet geladen"));
    return emailjs.send(CONFIG.emailJs.serviceId, CONFIG.emailJs.orderTemplate, payload);
  }

  function quickCheckoutModal() {
    document.querySelector("[data-quick-checkout-modal]")?.remove();
    const modal = document.createElement("div");
    modal.className = "premium-modal quick-checkout-modal";
    modal.dataset.quickCheckoutModal = "true";
    modal.innerHTML = `<div class="premium-modal-panel quick-checkout-panel" role="dialog" aria-modal="true" aria-label="Snel bestellen met PayPal">
      <button class="drawer-close" type="button" data-quick-close>Sluiten</button>
      <div>
        <p class="eyebrow">Snel betalen met PayPal</p>
        <h2>Snel bestellen</h2>
        <p class="quick-intro">Vul je gegevens in en rond je bestelling veilig af via PayPal.</p>
        <form class="quick-checkout-form" data-quick-form>
          <label>Naam<input name="customer_name" autocomplete="name" required></label>
          <label>E-mailadres<input type="email" name="customer_email" autocomplete="email" required></label>
          <label>Telefoon<input name="customer_phone" autocomplete="tel" required></label>
          <div class="two-col">
            <label>Straat<input name="street" autocomplete="address-line1" required></label>
            <label>Huisnummer<input name="house_number" required></label>
          </div>
          <div class="two-col">
            <label>Postcode<input name="postal_code" autocomplete="postal-code" required></label>
            <label>Plaats<input name="city" autocomplete="address-level2" required></label>
          </div>
          <button class="button primary full" type="submit">PayPal betaling tonen</button>
        </form>
      </div>
      <div class="quick-payment-panel">
        <h3>Overzicht</h3>
        <div data-quick-totals></div>
        <p class="notice">Bij iedere bestelling ontvang je gratis een willekeurige ORIV&Eacute;A Discovery Sample.</p>
        <div data-quick-paypal hidden></div>
        <p class="form-status" data-quick-status></p>
      </div>
    </div>`;
    document.body.appendChild(modal);
    return modal;
  }

  function initQuickCheckout() {
    const drawerPanel = $(".drawer-panel");
    if (!drawerPanel || drawerPanel.querySelector("[data-quick-checkout-open]")) return;
    const checkoutLink = drawerPanel.querySelector('a[href="checkout.html"]');
    if (!checkoutLink) return;
    const quickBlock = document.createElement("section");
    quickBlock.className = "quick-cart-pay";
    quickBlock.innerHTML = `<h3>Snel betalen</h3><p>Betaal direct veilig via PayPal.</p><button class="button ghost full" type="button" data-quick-checkout-open>PayPal snel betalen</button>`;
    checkoutLink.insertAdjacentElement("afterend", quickBlock);

    quickBlock.querySelector("[data-quick-checkout-open]").addEventListener("click", () => {
      const data = totals();
      const message = quickBlock.querySelector("p");
      if (!data.lines.length) {
        if (message) message.textContent = "Je winkelwagen is nog leeg.";
        return;
      }
      if (message) message.textContent = "Betaal direct veilig via PayPal.";
      const modal = quickCheckoutModal();
      const form = $("[data-quick-form]", modal);
      const paypalTarget = $("[data-quick-paypal]", modal);
      const status = $("[data-quick-status]", modal);
      const totalsTarget = $("[data-quick-totals]", modal);
      let quickFormData = null;
      let paypalRendered = false;
      let processing = false;

      totalsTarget.innerHTML = totalsHtml(data);
      modal.addEventListener("click", (event) => {
        if (event.target === modal || event.target.closest("[data-quick-close]")) modal.remove();
      });

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        quickFormData = checkoutFormData(form);
        paypalTarget.hidden = false;
        if (paypalRendered) return;
        try {
          const paypal = await loadPayPalSdk();
          paypalRendered = true;
          status.textContent = "";
          paypal.Buttons({
            style: { layout: "vertical", color: "gold", shape: "rect", label: "paypal" },
            createOrder: (_data, actions) => {
              if (processing) return Promise.reject(new Error("Betaling wordt al verwerkt"));
              const current = totals();
              if (!current.lines.length) {
                status.textContent = "Je winkelwagen is nog leeg.";
                return Promise.reject(new Error("Winkelwagen leeg"));
              }
              return actions.order.create({
                purchase_units: [{
                  description: "ORIVÈA Glantier bestelling",
                  amount: { currency_code: CONFIG.paypalCurrency || CONFIG.currency || "EUR", value: current.total.toFixed(2) }
                }]
              });
            },
            onApprove: async (data, actions) => {
              if (processing) return;
              processing = true;
              paypalTarget.style.pointerEvents = "none";
              paypalTarget.style.opacity = "0.58";
              status.textContent = "Betaling wordt bevestigd...";
              const details = await actions.order.capture();
              const capture = details?.purchase_units?.[0]?.payments?.captures?.[0];
              const confirmed = capture?.status === "COMPLETED" || details?.status === "COMPLETED";
              if (!confirmed) throw new Error("PayPal betaling niet bevestigd");
              const payload = buildOrderPayload(quickFormData, {
                transactionId: capture?.id || data.orderID || details?.id || "",
                paymentStatus: "COMPLETED"
              });
              storeOrder(payload);
              try {
                await sendOrderConfirmation(payload);
              } catch (error) {
                console.warn("Orderbevestiging kon niet direct worden verzonden", error);
              }
              localStorage.removeItem(CART_KEY);
              renderCartState();
              window.location.href = "checkout.html?order=success";
            },
            onError: () => {
              processing = false;
              paypalTarget.style.pointerEvents = "";
              paypalTarget.style.opacity = "";
              status.textContent = "PayPal kon de betaling niet bevestigen. Probeer opnieuw.";
            }
          }).render(paypalTarget);
        } catch (error) {
          console.warn("Snelle PayPal checkout kon niet laden", error);
          status.textContent = "PayPal is tijdelijk niet beschikbaar. Probeer het later opnieuw.";
        }
      });
    });
  }

  function openPremiumModal(product) {
    if (!product) return;
    document.querySelector("[data-premium-modal]")?.remove();
    const modal = document.createElement("div");
    modal.className = "premium-modal";
    modal.dataset.premiumModal = "true";
    modal.innerHTML = `<div class="premium-modal-panel" role="dialog" aria-modal="true" aria-label="Premium uitvoering"><button class="drawer-close" type="button" data-premium-close>Sluiten</button><div><p class="eyebrow">Premium</p><h2>Premium uitvoering</h2><ul><li>22% parfumolie</li><li>Luxe premium flacon</li><li>Luxe verpakking</li><li>Langere geurbeleving</li></ul></div><img src="${product.premiumImage || product.image}" alt="Glantier Premium ${product.glantierNummer || ""}"></div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (event) => {
      if (event.target === modal || event.target.closest("[data-premium-close]")) modal.remove();
    });
  }

  function initCheckout() {
    const form = $("[data-checkout-form]");
    if (!form) return;
    let step = 1;
    let paypalRendered = false;
    const status = $("[data-paypal-status]");
    const orderStatus = $("[data-order-status]");
    const successPanel = $("[data-order-success]");
    const params = new URLSearchParams(window.location.search);

    const showStep = (next) => {
      step = Math.min(5, Math.max(1, next));
      $$('[data-step]').forEach((el) => el.classList.toggle('active', Number(el.dataset.step) === step));
      $$('[data-step-tab]').forEach((el) => el.classList.toggle('active', Number(el.dataset.stepTab) === step));
      renderCartState();
      if (step === 4) renderPayPalButtons();
    };

    const validateVisibleStep = () => {
      const current = $(`[data-step="${step}"]`, form);
      const fields = current ? $$('input, textarea, select', current) : [];
      for (const field of fields) {
        if (!field.checkValidity()) {
          field.reportValidity();
          return false;
        }
      }
      return true;
    };

    const validateCheckout = () => {
      const data = totals();
      if (!data.lines.length) {
        if (status) status.textContent = 'Je winkelwagen is nog leeg.';
        return false;
      }
      if (!form.reportValidity()) return false;
      return true;
    };

    const renderPayPalButtons = async () => {
      const target = $('[data-paypal-buttons]');
      if (!target || paypalRendered) return;
      try {
        const paypal = await loadPayPalSdk();
        paypalRendered = true;
        if (status) status.textContent = '';
        paypal.Buttons({
          style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'paypal' },
          createOrder: (_data, actions) => {
            if (!validateCheckout()) return Promise.reject(new Error('Checkout niet compleet'));
            const data = totals();
            return actions.order.create({
              purchase_units: [{
                description: 'ORIVÈA Glantier bestelling',
                amount: { currency_code: CONFIG.paypalCurrency || CONFIG.currency || 'EUR', value: data.total.toFixed(2) }
              }]
            });
          },
          onApprove: async (data, actions) => {
            if (status) status.textContent = 'Betaling wordt bevestigd...';
            const details = await actions.order.capture();
            const capture = details?.purchase_units?.[0]?.payments?.captures?.[0];
            const confirmed = capture?.status === 'COMPLETED' || details?.status === 'COMPLETED';
            if (!confirmed) throw new Error('PayPal betaling niet bevestigd');
            const payload = buildOrderPayload(form, {
              transactionId: capture?.id || data.orderID || details?.id || '',
              paymentStatus: 'Betaald'
            });
            storeOrder(payload);
            try {
              await sendOrderConfirmation(payload);
              localStorage.removeItem(CART_KEY);
              renderCartState();
              if (successPanel) successPanel.hidden = false;
              if (orderStatus) orderStatus.textContent = `Order ${payload.order_number} is bevestigd. De betaling is succesvol ontvangen.`;
              showStep(5);
            } catch {
              localStorage.removeItem(CART_KEY);
              renderCartState();
              if (successPanel) successPanel.hidden = false;
              if (orderStatus) orderStatus.textContent = `Order ${payload.order_number} is bevestigd. De betaling is succesvol ontvangen. De bevestigingsmail kon niet direct worden verzonden.`;
              showStep(5);
            }
          },
          onError: () => {
            if (status) status.textContent = 'PayPal kon de betaling niet bevestigen. Controleer je gegevens en probeer opnieuw.';
          }
        }).render(target);
      } catch (error) {
        console.warn("PayPal kon niet laden", error);
        if (status) status.textContent = 'PayPal is tijdelijk niet beschikbaar. Probeer het later opnieuw.';
      }
    };

    $$('[data-next-step]').forEach((button) => button.addEventListener('click', () => {
      if (validateVisibleStep()) showStep(step + 1);
    }));
    $$('[data-prev-step]').forEach((button) => button.addEventListener('click', () => showStep(step - 1)));
    $$('[data-step-tab]').forEach((button) => button.addEventListener('click', () => showStep(Number(button.dataset.stepTab))));
    form.addEventListener('submit', (event) => event.preventDefault());
    if (params.get("order") === "success") {
      if (successPanel) successPanel.hidden = false;
      const lastOrder = JSON.parse(localStorage.getItem(LAST_ORDER_KEY) || "null");
      if (orderStatus && lastOrder?.order_number) orderStatus.textContent = `Order ${lastOrder.order_number} is bevestigd. De betaling is succesvol ontvangen.`;
      showStep(5);
    }
  }

  function initContact() {
    const form = $("[data-contact-form]");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = $("[data-contact-status]");
      status.textContent = "Bericht wordt verzonden...";
      const raw = Object.fromEntries(new FormData(form).entries());
      const payload = {
        name: raw.name || "",
        email: raw.email || "",
        subject: "Contactaanvraag",
        message: raw.message || "",
        email_subject: "Bedankt voor je bericht | ORIVÈA",
        message_type: "Contactaanvraag ontvangen",
        message_body: "Bedankt voor je bericht. Ons team bekijkt je aanvraag zo snel mogelijk en neemt indien nodig contact met je op."
      };
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
      const action = event.submitter?.value === "unsubscribe" ? "unsubscribe" : "subscribe";
      const isUnsubscribe = action === "unsubscribe";
      status.textContent = isUnsubscribe ? "Afmelding wordt verzonden..." : "Aanmelding wordt verzonden...";
      const raw = Object.fromEntries(new FormData(form).entries());
      const payload = {
        name: raw.name || "",
        email: raw.email || "",
        subject: isUnsubscribe ? "Nieuwsbrief afmelding" : "Nieuwsbrief aanmelding",
        message: (isUnsubscribe ? "Nieuwsbrief afmelding" : "Nieuwsbrief aanmelding") + " via orivea.nl\nNaam: " + (raw.name || "") + "\nE-mail: " + (raw.email || ""),
        email_subject: isUnsubscribe ? "Je nieuwsbriefvoorkeur is bijgewerkt | ORIVÈA" : "Welkom bij ORIVÈA",
        message_type: isUnsubscribe ? "Nieuwsbrief afmelding bevestigd" : "Nieuwsbrief aanmelding bevestigd",
        message_body: isUnsubscribe ? "Je bent succesvol afgemeld voor de ORIVÈA nieuwsbrief." : "Bedankt voor je aanmelding voor de ORIVÈA nieuwsbrief. Je ontvangt als eerste nieuws over nieuwe collecties, exclusieve acties en premium geuren."
      };
      try {
        if (!window.emailjs) throw new Error("EmailJS niet geladen");
        await emailjs.send(CONFIG.emailJs.serviceId, CONFIG.emailJs.contactTemplate, payload);
        form.reset();
        status.textContent = isUnsubscribe ? "Je bent succesvol afgemeld voor de ORIVÈA nieuwsbrief." : "Bedankt voor je aanmelding voor de ORIVÈA nieuwsbrief.";
      } catch {
        status.textContent = isUnsubscribe ? "Afmelden lukte niet direct. Mail ons via shop@orivea.nl." : "Aanmelden lukte niet direct. Mail ons via shop@orivea.nl.";
      }
    });
  }

  function initCampaigns() {
    const campaign = $("[data-vaderdag-campaign]");
    if (!campaign) return;
    const product = productById("vaderdag-premium-set");
    const start = new Date(product?.campaignStart || "2026-05-22T00:00:00+02:00");
    const end = new Date(product?.campaignEnd || "2026-06-21T23:59:59+02:00");
    const now = new Date();
    if (now < start || now > end || !product) {
      campaign.hidden = true;
      return;
    }
    let selectedScent = "717";
    const image = $("[data-vaderdag-image]", campaign);
    const photoLabel = $("[data-vaderdag-photo-label]", campaign);
    const setSelectedScent = (scent) => {
      selectedScent = scent;
      $$("[data-vaderdag-scent]", campaign).forEach((card) => {
        const active = card.dataset.vaderdagScent === scent;
        card.classList.toggle("selected", active);
        card.setAttribute("aria-pressed", String(active));
      });
      const selected = vaderdagScents[scent] || vaderdagScents["717"];
      if (image) {
        image.src = selected.image;
        image.alt = `Glantier Vaderdag Premium Set ${scent}`;
      }
      if (photoLabel) photoLabel.textContent = `Glantier ${scent}`;
    };
    $$("[data-vaderdag-scent]", campaign).forEach((card) => card.addEventListener("click", () => setSelectedScent(card.dataset.vaderdagScent)));
    $("[data-vaderdag-add]", campaign)?.addEventListener("click", () => addToCart("vaderdag-premium-set", 1, `vaderdag-${selectedScent}`));
    const timer = $("[data-vaderdag-countdown]", campaign);
    const update = () => {
      const diff = end - new Date();
      if (diff <= 0) {
        campaign.hidden = true;
        return;
      }
      const days = Math.floor(diff / 86400000);
      if (timer) timer.textContent = `Nog ${days} dagen beschikbaar`;
    };
    setSelectedScent(selectedScent);
    update();
    window.setInterval(update, 60000);
  }

  document.addEventListener("click", (event) => {
    const variantChoice = event.target.closest("[data-card-variant]");
    if (variantChoice) {
      const card = variantChoice.closest("[data-product-card]");
      $$("[data-card-variant]", card).forEach((button) => button.classList.toggle("selected", button === variantChoice));
    }
    const cardQtyPlus = event.target.closest("[data-card-qty-plus]");
    if (cardQtyPlus) {
      const input = $("[data-card-qty]", cardQtyPlus.closest("[data-product-card]"));
      if (input) input.value = String(Math.max(1, Number(input.value || 1) + 1));
    }
    const cardQtyMinus = event.target.closest("[data-card-qty-minus]");
    if (cardQtyMinus) {
      const input = $("[data-card-qty]", cardQtyMinus.closest("[data-product-card]"));
      if (input) input.value = String(Math.max(1, Number(input.value || 1) - 1));
    }
    const cardAdd = event.target.closest("[data-card-add]");
    if (cardAdd) {
      const card = cardAdd.closest("[data-product-card]");
      const variant = $("[data-card-choice]", card)?.value || $("[data-card-variant].selected", card)?.dataset.cardVariant || "signature";
      const qty = Math.max(1, Number($("[data-card-qty]", card)?.value || 1));
      addToCart(cardAdd.dataset.cardAdd, qty, variant);
    }
    const premiumInfo = event.target.closest("[data-premium-info]");
    if (premiumInfo) openPremiumModal(productById(premiumInfo.dataset.premiumInfo));
    const add = event.target.closest("[data-add-to-cart]");
    if (add) addToCart(add.dataset.addToCart, 1, add.dataset.variant || "signature");
    const plus = event.target.closest("[data-qty-plus]");
    if (plus) {
      const line = cart().find((item) => itemKey(item) === plus.dataset.qtyPlus);
      updateQty(plus.dataset.qtyPlus, (line?.qty || 1) + 1);
    }
    const minus = event.target.closest("[data-qty-minus]");
    if (minus) {
      const line = cart().find((item) => itemKey(item) === minus.dataset.qtyMinus);
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
  initQuickCheckout();
  initCampaigns();
  renderHomeProducts();
  initMatch();
  initCatalog();
  initCheckout();
  initContact();
  initNewsletter();
})();
