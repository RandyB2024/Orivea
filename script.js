(() => {
  const CONFIG = window.ORIVEA_CONFIG || {};
  const PRODUCTS = window.ORIVEA_PRODUCTS || [];
  const CART_KEY = "orivea_glantier_cart";
  const ORDERS_KEY = "orivea_orders";
  const LAST_ORDER_KEY = "orivea_last_order";
  const CATALOG_CONFIG = {
    productsPerPage: 8
  };
  const PAYPAL_CONFIG = {
    clientId: CONFIG.paypalClientId || "AdHVkRJT6Lr_2eatUAvqxQmJfEkrXuWYwHp1Rrs1qtzR10EWFNna5XJIa80RLEnvfQHJ--E16dnpBS3a",
    currency: CONFIG.paypalCurrency || CONFIG.currency || "EUR",
    intent: "capture"
  };
  let paypalSdkPromise = null;
  let emailJsInitialized = false;
  let emailJsSdkPromise = null;
  const currency = new Intl.NumberFormat("nl-NL", { style: "currency", currency: CONFIG.currency || "EUR" });

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const money = (value) => currency.format(Number(value || 0));
  const VAT_RATE = 0.21;
  const VAT_LABEL = "21%";
  const vatFromIncluded = (value) => {
    const amount = Number(value || 0);
    return amount - (amount / (1 + VAT_RATE));
  };
  const normalize = (value) => String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const productById = (id) => PRODUCTS.find((product) => product.id === id);
  const freeShippingFrom = Number(CONFIG.freeShippingFrom || 75);
  const itemKey = (item) => item.key || `${item.id}:${item.variant || "signature"}`;
  const paypalClientIdLooksIncomplete = () => !PAYPAL_CONFIG.clientId || PAYPAL_CONFIG.clientId.length < 30;
  const paypalUnavailableMessage = () => paypalClientIdLooksIncomplete()
    ? "PayPal Client ID lijkt ongeldig of onvolledig. Controleer de live Client ID in PayPal Developer."
    : "PayPal is tijdelijk niet beschikbaar. Probeer het later opnieuw.";
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
    const shippableSubtotal = lines.reduce((sum, line) => line.product.freeShipping ? sum : sum + line.product.prijs * line.qty, 0);
    const shipping = shippingFor(shippableSubtotal);
    const total = subtotal + shipping;
    const vat = {
      rate: VAT_LABEL,
      subtotal: vatFromIncluded(subtotal),
      shipping: vatFromIncluded(shipping),
      total: vatFromIncluded(total)
    };
    return { lines, subtotal, shipping, total, vat };
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
      <div><span>Subtotaal incl. btw</span><strong>${money(data.subtotal)}</strong></div>
      <div><span>Waarvan 21% btw</span><strong>${money(data.vat?.total || 0)}</strong></div>
      <div><span>Verzendkosten incl. btw</span><strong>${money(data.shipping)}</strong></div>
      <div><span>Totaal incl. btw</span><strong>${money(data.total)}</strong></div>
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
      const reference = product.parfumReferentie ? `<p class="product-reference">Geïnspireerd door de geurbeleving van ${product.parfumReferentie}</p>` : "";
      return `<div class="match-card"><img src="${product.premiumImage || product.image}" alt="${product.naam}"><div><p class="eyebrow">Beste match</p><h3>GLANTIER ${product.glantierNummer || product.id}</h3>${reference}<p>${scentGroup} • ${product.doelgroep}</p><p>${product.omschrijving}</p><p class="price">50 ml ${money(product.prijs)}</p><div class="hero-actions"><button class="button primary cart-symbol-button" type="button" data-add-to-cart="${product.id}" aria-label="Toevoegen aan winkelwagen">${cartIcon()}</button><a class="button ghost" href="catalogus.html">Bekijk collectie</a></div><p class="notice">Alle merknamen worden uitsluitend gebruikt als vergelijkingsreferentie. ORIVÈA verkoopt Glantier-producten.</p></div></div>`;
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

  function normalizePostcode(postcode) {
    const compact = String(postcode || "").toUpperCase().replace(/\s+/g, "");
    return /^[1-9][0-9]{3}[A-Z]{2}$/.test(compact) ? `${compact.slice(0, 4)} ${compact.slice(4)}` : compact;
  }

  function isValidDutchPostcode(postcode) {
    return /^[1-9][0-9]{3}\s?[A-Z]{2}$/i.test(String(postcode || "").trim());
  }

  function normalizeHouseNumber(value) {
    const match = String(value || "").match(/\d+/);
    return match ? match[0] : "";
  }

  async function lookupAddress(postcode, houseNumber, addition = "") {
    const normalizedPostcode = normalizePostcode(postcode);
    const normalizedHouseNumber = normalizeHouseNumber(houseNumber);
    if (!normalizedPostcode || !normalizedHouseNumber) return null;
    const params = new URLSearchParams();
    params.set("rows", "10");
    params.set("q", "*:*");
    params.append("fq", "type:adres");
    params.append("fq", `postcode:${normalizedPostcode.replace(/\s+/g, "")}`);
    params.append("fq", `huisnummer:${normalizedHouseNumber}`);
    const url = `https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?${params.toString()}`;
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Adreslookup mislukt");
    const data = await response.json();
    const docs = data?.response?.docs || [];
    const normalizedAddition = normalize(addition);
    const doc = normalizedAddition
      ? docs.find((item) => normalize([item.huisletter, item.huisnummertoevoeging, item.huis_nlt].filter(Boolean).join(" ")).includes(normalizedAddition)) || docs[0]
      : docs[0];
    if (!doc) return null;
    return {
      street: doc.straatnaam || doc.weergavenaam?.split(" ")[0] || "",
      houseNumber: doc.huisnummer || normalizedHouseNumber,
      addition: doc.huisletter || doc.huisnummertoevoeging || addition || "",
      postalCode: normalizePostcode(doc.postcode || normalizedPostcode),
      city: doc.woonplaatsnaam || "",
      province: doc.provincienaam || ""
    };
  }

  function formatAddress(addressData) {
    if (!addressData) return "";
    const addition = addressData.addition ? ` ${addressData.addition}` : "";
    return `${addressData.street} ${addressData.houseNumber}${addition}\n${addressData.postalCode} ${addressData.city}`.trim();
  }

  function loadEmailJsSdk() {
    if (window.emailjs) return Promise.resolve(window.emailjs);
    if (emailJsSdkPromise) return emailJsSdkPromise;
    emailJsSdkPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector("script[data-emailjs-sdk]");
      if (existing) {
        existing.addEventListener("load", () => window.emailjs ? resolve(window.emailjs) : reject(new Error("EmailJS SDK niet beschikbaar na laden")), { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
      script.dataset.emailjsSdk = "true";
      script.dataset.cookieconsent = "ignore";
      script.onload = () => window.emailjs ? resolve(window.emailjs) : reject(new Error("EmailJS SDK niet beschikbaar na laden"));
      script.onerror = () => {
        emailJsSdkPromise = null;
        reject(new Error("EmailJS SDK kon niet laden"));
      };
      document.head.appendChild(script);
    });
    return emailJsSdkPromise;
  }

  async function initEmailJs() {
    await loadEmailJsSdk();
    const publicKey = CONFIG.emailJs?.publicKey || "w3x9SY9OqatVgYJOw";
    if (!emailJsInitialized && publicKey) {
      emailjs.init(publicKey);
      emailJsInitialized = true;
    }
    return publicKey;
  }

  function setupAddressAutocomplete(form) {
    if (!form || form.dataset.addressAutocomplete === "true") return;
    const postal = form.elements.postal_code;
    const houseNumber = form.elements.house_number;
    const addition = form.elements.addition;
    const street = form.elements.street;
    const city = form.elements.city;
    const province = form.elements.province;
    if (!postal || !houseNumber || !street || !city) return;
    form.dataset.addressAutocomplete = "true";
    const result = form.querySelector("[data-address-result]");

    let status = form.querySelector("[data-address-status]");
    if (!status) {
      status = document.createElement("p");
      status.className = "address-status";
      status.dataset.addressStatus = "true";
      city.closest("label")?.insertAdjacentElement("afterend", status);
    }

    const setAddressFieldsVisible = (visible) => {
      if (result) result.hidden = !visible;
      [street, city, province].filter(Boolean).forEach((field) => {
        field.disabled = !visible;
      });
    };
    setAddressFieldsVisible(Boolean(street.value || city.value));

    let timer = null;
    let lastLookup = "";
    const runLookup = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const normalizedPostcode = normalizePostcode(postal.value);
        const normalizedHouseNumber = normalizeHouseNumber(houseNumber.value);
        if (postal.value && normalizedPostcode !== postal.value.toUpperCase()) postal.value = normalizedPostcode;
        if (!normalizedPostcode || !normalizedHouseNumber || !isValidDutchPostcode(normalizedPostcode)) {
          status.textContent = "";
          setAddressFieldsVisible(false);
          return;
        }
        const key = `${normalizedPostcode}|${normalizedHouseNumber}|${addition?.value || ""}`;
        if (key === lastLookup) return;
        lastLookup = key;
        status.textContent = "Adres zoeken...";
        try {
          const address = await lookupAddress(normalizedPostcode, normalizedHouseNumber, addition?.value || "");
          if (!address?.street || !address?.city) {
            setAddressFieldsVisible(true);
            status.textContent = "Adres niet gevonden. Vul je adres handmatig in.";
            return;
          }
          setAddressFieldsVisible(true);
          street.value = address.street;
          houseNumber.value = address.houseNumber;
          if (addition && address.addition) addition.value = address.addition;
          postal.value = address.postalCode;
          city.value = address.city;
          if (province) province.value = address.province || "";
          status.textContent = "Adres gevonden";
        } catch (error) {
          console.info("Adreslookup niet beschikbaar", error);
          status.textContent = "Adres niet gevonden. Vul je adres handmatig in.";
        }
      }, 450);
    };

    [postal, houseNumber, addition].filter(Boolean).forEach((field) => {
      field.addEventListener("input", runLookup);
      field.addEventListener("blur", runLookup);
    });
  }

  function formatOrderLines(data) {
    const lines = data.lines.map((line) => {
      const variant = [line.product.type, line.product.inhoud].filter(Boolean).join(" - ");
      return `${line.qty}x ${line.product.naam}${variant ? ` - ${variant}` : ""} - ${money(line.product.prijs * line.qty)}`;
    });
    if (lines.length) lines.push("1x ORIVÈA Discovery Sample - Gratis");
    return lines.join("\n");
  }

  function checkoutFormData(form) {
    const formData = Object.fromEntries(new FormData(form).entries());
    const addressData = {
      street: formData.street || "",
      houseNumber: formData.house_number || "",
      addition: formData.addition || "",
      postalCode: normalizePostcode(formData.postal_code || ""),
      city: formData.city || "",
      province: formData.province || ""
    };
    return {
      ...formData,
      postal_code: addressData.postalCode,
      customer_address: formatAddress(addressData)
    };
  }

  function normalizeOrderFormData(source) {
    const formData = source instanceof HTMLFormElement ? checkoutFormData(source) : source || {};
    const addressData = {
      street: formData.street || "",
      houseNumber: formData.house_number || "",
      addition: formData.addition || "",
      postalCode: normalizePostcode(formData.postal_code || ""),
      city: formData.city || "",
      province: formData.province || ""
    };
    return {
      ...formData,
      postal_code: addressData.postalCode,
      customer_address: formData.customer_address || formatAddress(addressData)
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
      vat_rate: VAT_LABEL,
      vat_amount: money(data.vat?.total || 0),
      subtotal_incl_vat: money(data.subtotal),
      shipping_incl_vat: money(data.shipping),
      total_incl_vat: money(data.total),
      paypal_transaction_id: paypal?.transactionId || "",
      payment_status: paypal?.paymentStatus || "",
      payment_method: paypal?.paymentMethod || "PayPal",
      note: formData.note || ""
    };
  }

  function orderEmailStorageKey(payload) {
    return `orivea_order_email_sent_${payload.paypal_transaction_id || payload.order_number}`;
  }

  function publicOrderPayload(payload) {
    const fallbackFields = [];
    if (!String(payload.customer_name || "").trim()) fallbackFields.push("customer_name");
    if (!String(payload.customer_address || "").trim()) fallbackFields.push("customer_address");
    if (fallbackFields.length) console.warn("EmailJS order parameters gebruiken fallback:", fallbackFields);
    return {
      order_number: payload.order_number || "",
      customer_name: payload.customer_name || "Klant",
      customer_email: payload.customer_email || "",
      customer_phone: payload.customer_phone || "",
      customer_address: payload.customer_address || "Adres niet ingevuld",
      order_date: payload.order_date || new Date().toLocaleString("nl-NL"),
      order_items: payload.order_items || "",
      subtotal: payload.subtotal || money(0),
      shipping_cost: payload.shipping_cost || money(0),
      total: payload.total || money(0),
      vat_rate: payload.vat_rate || VAT_LABEL,
      vat_amount: payload.vat_amount || money(0),
      subtotal_incl_vat: payload.subtotal_incl_vat || payload.subtotal || money(0),
      shipping_incl_vat: payload.shipping_incl_vat || payload.shipping_cost || money(0),
      total_incl_vat: payload.total_incl_vat || payload.total || money(0),
      paypal_transaction_id: payload.paypal_transaction_id || "",
      payment_status: payload.payment_status || "",
      payment_method: payload.payment_method || "PayPal"
    };
  }

  function validateOrderEmailPayload(payload) {
    const required = [
      "order_number",
      "customer_name",
      "customer_email",
      "customer_phone",
      "customer_address",
      "order_date",
      "order_items",
      "subtotal",
      "shipping_cost",
      "total",
      "vat_rate",
      "vat_amount",
      "subtotal_incl_vat",
      "shipping_incl_vat",
      "total_incl_vat",
      "paypal_transaction_id",
      "payment_status",
      "payment_method"
    ];
    const missing = required.filter((key) => !String(payload[key] || "").trim());
    if (missing.length) console.warn("EmailJS order parameters ontbreken:", missing);
    if (!String(payload.customer_email || "").trim()) throw new Error("Orderbevestiging niet verstuurd: klant e-mailadres ontbreekt");
    if (payload.payment_status !== "COMPLETED") throw new Error(`Orderbevestiging niet verstuurd: betalingstatus is ${payload.payment_status || "onbekend"}`);
    return missing;
  }

  function storeOrder(payload) {
    const stored = JSON.parse(localStorage.getItem(ORDERS_KEY) || "[]");
    stored.push(payload);
    localStorage.setItem(ORDERS_KEY, JSON.stringify(stored.slice(-50)));
    localStorage.setItem(LAST_ORDER_KEY, JSON.stringify(payload));
  }

  function loadPayPalSdk() {
    if (window.paypal) {
      console.log("PayPal SDK loaded");
      return Promise.resolve(window.paypal);
    }
    if (paypalSdkPromise) return paypalSdkPromise;
    const clientId = PAYPAL_CONFIG.clientId || "";
    if (!clientId) {
      console.error("PayPal Client ID ontbreekt");
      return Promise.reject(new Error("PayPal Client ID ontbreekt"));
    }
    if (clientId.length < 30) {
      console.warn("PayPal Client ID lijkt kort of mogelijk onvolledig:", clientId);
    }
    const enabledFunding = (CONFIG.paypalEnabledFunding || ["ideal"]).join(",");
    paypalSdkPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector("script[data-paypal-sdk]");
      if (existing) {
        existing.addEventListener("load", () => {
          if (!window.paypal) {
            paypalSdkPromise = null;
            reject(new Error("PayPal SDK niet beschikbaar na laden"));
            return;
          }
          console.log("PayPal SDK loaded");
          resolve(window.paypal);
        }, { once: true });
        existing.addEventListener("error", (error) => {
          paypalSdkPromise = null;
          reject(error);
        }, { once: true });
        return;
      }
      const script = document.createElement("script");
      const params = new URLSearchParams({
        "client-id": clientId,
        components: "buttons,applepay,funding-eligibility",
        currency: PAYPAL_CONFIG.currency,
        intent: PAYPAL_CONFIG.intent,
        "enable-funding": enabledFunding
      });
      script.src = `https://www.paypal.com/sdk/js?${params.toString()}`;
      script.dataset.paypalSdk = "true";
      script.onload = () => {
        if (!window.paypal) {
          paypalSdkPromise = null;
          reject(new Error("PayPal SDK niet beschikbaar na laden"));
          return;
        }
        console.log("PayPal SDK loaded");
        resolve(window.paypal);
      };
      script.onerror = () => {
        paypalSdkPromise = null;
        reject(new Error("PayPal SDK kon niet laden"));
      };
      document.head.appendChild(script);
    });
    return paypalSdkPromise;
  }

  async function sendOrderConfirmation(payload) {
    const publicKey = await initEmailJs();
    const templateParams = publicOrderPayload(payload);
    validateOrderEmailPayload(templateParams);
    const sentKey = orderEmailStorageKey(templateParams);
    const existing = JSON.parse(localStorage.getItem(sentKey) || "null");
    if (existing?.sent === true) {
      console.log("EmailJS order confirmation already sent:", existing);
      return Promise.resolve(existing.response || { skipped: true });
    }
    console.log("Building EmailJS templateParams...");
    console.log("EmailJS templateParams:", templateParams);
    console.log("VAT amount:", templateParams.vat_amount);
    console.log("Order total incl VAT:", templateParams.total_incl_vat);
    console.log("Sending EmailJS order confirmation...");
    return emailjs
      .send(
        CONFIG.emailJs?.serviceId || "service_r55nwxz",
        CONFIG.emailJs?.orderTemplate || "template_ehokbkn",
        templateParams,
        publicKey
      )
      .then((response) => {
        console.log("EmailJS order confirmation sent:", response);
        localStorage.setItem(sentKey, JSON.stringify({
          sent: true,
          order_number: templateParams.order_number,
          paypal_transaction_id: templateParams.paypal_transaction_id,
          response
        }));
        return response;
      })
      .catch((error) => {
        console.error("EmailJS order confirmation failed:", error);
        try {
          console.error("EmailJS error JSON:", JSON.stringify(error, null, 2));
        } catch {
          console.error("EmailJS error JSON:", String(error));
        }
        throw error;
      });
  }

  async function finalizePaidOrder(source, payment, options = {}) {
    const payload = buildOrderPayload(source, payment);
    const statusTarget = options.orderStatus || options.status;
    if (payload.payment_status !== "COMPLETED") {
      throw new Error(`Order afronden geblokkeerd: betalingstatus is ${payload.payment_status || "onbekend"}`);
    }
    try {
      await sendOrderConfirmation(payload);
    } catch (error) {
      payload.email_status = "FAILED";
      storeOrder(payload);
      if (statusTarget) {
        statusTarget.textContent = `Je betaling is ontvangen, maar de automatische bevestigingsmail kon niet worden verzonden. Neem contact op via shop@orivea.nl met je ordernummer ${payload.order_number}.`;
      }
      throw error;
    }
    payload.email_status = "SENT";
    storeOrder(payload);
    localStorage.removeItem(CART_KEY);
    renderCartState();
    if (options.successPanel) options.successPanel.hidden = false;
    if (statusTarget) statusTarget.textContent = `Order ${payload.order_number} is bevestigd. De betaling is succesvol ontvangen.`;
    if (options.redirect) window.location.href = options.redirect;
    if (options.showStep) options.showStep(5);
    return payload;
  }

  function paypalApiBase() {
    return (CONFIG.paypalApiBase || "/api/paypal").replace(/\/$/, "");
  }

  async function createServerPayPalOrder(data) {
    const response = await fetch(`${paypalApiBase()}/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: data.total.toFixed(2),
        currency: CONFIG.paypalCurrency || CONFIG.currency || "EUR",
        description: "ORIVÈA Glantier bestelling"
      })
    });
    if (!response.ok) throw new Error("PayPal order kon niet worden aangemaakt");
    return response.json();
  }

  async function captureServerPayPalOrder(orderId) {
    const response = await fetch(`${paypalApiBase()}/capture-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId })
    });
    if (!response.ok) throw new Error("PayPal order kon niet worden gecaptured");
    return response.json();
  }

  function paypalCapture(details) {
    return details?.purchase_units?.[0]?.payments?.captures?.[0] || null;
  }

  function paypalCaptureCompleted(details) {
    const capture = paypalCapture(details);
    return capture?.status === "COMPLETED" || details?.status === "COMPLETED";
  }

  function paypalPaymentMethod(data, fallback = "PayPal") {
    const source = String(data?.paymentSource || data?.fundingSource || "").toLowerCase();
    if (source === "ideal") return "iDEAL via PayPal";
    if (source === "wero") return "Wero via PayPal";
    if (source === "card") return "Betaalkaart via PayPal";
    if (source === "applepay") return "Apple Pay";
    return fallback;
  }

  function paypalFundingLabel(fundingSource) {
    const source = String(fundingSource || "").toLowerCase();
    if (source === "ideal") return "iDEAL via PayPal";
    if (source === "wero") return "Wero via PayPal";
    if (source === "card") return "Creditcard via PayPal";
    return "PayPal";
  }

  function paypalFundingStyle(fundingSource) {
    const style = { layout: "vertical", color: "gold", shape: "rect" };
    if (!fundingSource || String(fundingSource).toLowerCase() === "paypal") style.label = "paypal";
    return style;
  }

  function paypalCaptureId(details) {
    return paypalCapture(details)?.id || "";
  }

  function logPayPalError(error) {
    console.error("PayPal error:", error);
    try {
      console.error("PayPal error JSON:", JSON.stringify(error, null, 2));
    } catch {
      console.error("PayPal error JSON:", String(error));
    }
  }

  function paypalButtonOptions({ source, status, validate, onSuccess, paymentMethod, fundingSource }) {
    let processing = false;
    let paymentStarted = false;
    const label = paymentMethod || "PayPal";
    const options = {
      style: paypalFundingStyle(fundingSource),
      onClick: (data, actions) => {
        console.log("PayPal button clicked");
        if (validate && !validate()) {
          return actions.reject();
        }
        return actions.resolve();
      },
      createOrder: (data, actions) => {
        console.log("createOrder started");
        if (processing) throw new Error("Betaling wordt al verwerkt");
        if (validate && !validate()) throw new Error("Checkout niet compleet");
        const current = totals();
        const cartItems = current.lines.map((line) => ({
          id: line.product.id,
          name: line.product.naam,
          qty: line.qty,
          price: Number(line.product.prijs),
          total: Number(line.product.prijs * line.qty)
        }));
        console.log("Cart items:", cartItems);
        console.log("Subtotal:", current.subtotal);
        console.log("Shipping:", current.shipping);
        console.log("Total:", current.total);
        if (!current.lines.length) {
          if (status) status.textContent = "Je winkelwagen is nog leeg.";
          throw new Error("Winkelwagen leeg");
        }
        if (Number(current.total) <= 0) {
          if (status) status.textContent = "Ongeldig totaalbedrag.";
          throw new Error("Ongeldig totaalbedrag");
        }
        paymentStarted = true;
        const orderTotal = Number(current.total).toFixed(2);
        console.log("PayPal total:", orderTotal);
        return actions.order.create({
          purchase_units: [{
            description: "ORIVÈA Glantier bestelling",
            amount: {
              currency_code: PAYPAL_CONFIG.currency,
              value: orderTotal
            }
          }]
        }).then((orderId) => {
          console.log("Order ID:", orderId);
          return orderId;
        });
      },
      onApprove: (data, actions) => {
        console.log("onApprove started:", data);
        if (processing) return;
        processing = true;
        let captureCompleted = false;
        if (status) status.textContent = "Betaling wordt bevestigd...";
        return actions.order.capture().then(async (details) => {
          console.log("PayPal capture status:", details?.status);
          console.log("PayPal capture details:", details);
          console.log("Capture result:", details);
          if (!details || details.status !== "COMPLETED") {
            throw new Error(`PayPal capture niet voltooid. Status: ${details && details.status}`);
          }
          const captureId = paypalCaptureId(details);
          console.log("PayPal transaction ID:", captureId);
          console.log("Capture ID:", captureId);
          if (!captureId) throw new Error("PayPal capture ID ontbreekt");
          captureCompleted = true;
          const payment_method = paypalPaymentMethod({ ...data, fundingSource }, label);
          console.log("PayPal payment method:", payment_method);
          await finalizePaidOrder(source(), {
            transactionId: captureId,
            paymentStatus: "COMPLETED",
            paymentMethod: payment_method
          }, { ...(onSuccess || {}), status });
        }).catch((error) => {
          processing = false;
          if (captureCompleted) {
            console.error("Betaling ontvangen, ordermail afronden mislukt:", error);
            return;
          }
          console.error("Payment error:", error);
          logPayPalError(error);
          if (status) status.textContent = `${label} kon de betaling niet bevestigen. Probeer opnieuw of kies PayPal.`;
        });
      },
      onCancel: (data) => {
        processing = false;
        paymentStarted = false;
        console.warn("PayPal payment cancelled:", data);
        if (status) status.textContent = "Betaling geannuleerd. Je winkelwagen is bewaard.";
      },
      onError: (error) => {
        processing = false;
        const shouldShowError = paymentStarted;
        paymentStarted = false;
        console.error("Payment error:", error);
        logPayPalError(error);
        if (status) status.textContent = shouldShowError ? `${label} kon de betaling niet starten of bevestigen. Probeer opnieuw of kies PayPal.` : "";
      }
    };
    if (fundingSource) options.fundingSource = fundingSource;
    return options;
  }

  async function renderPayPalFundingButtons({ paypal, target, source, status, validate, onSuccess }) {
    target.innerHTML = "";
    if (status) status.textContent = "";
    let renderedButtons = 0;
    const fundingSources = [
      paypal.FUNDING?.PAYPAL,
      paypal.FUNDING?.IDEAL,
      paypal.FUNDING?.WERO,
      paypal.FUNDING?.CARD
    ].filter(Boolean);
    console.log("Available PayPal funding sources:", fundingSources);
    if (!paypal.FUNDING?.IDEAL) console.error("iDEAL/Wero unavailable:", "iDEAL funding source ontbreekt in PayPal SDK");
    if (!paypal.FUNDING?.WERO) console.error("iDEAL/Wero unavailable:", "Wero funding source ontbreekt in PayPal SDK");
    for (const fundingSource of fundingSources) {
      const options = paypalButtonOptions({
        source,
        status,
        validate,
        onSuccess,
        fundingSource,
        paymentMethod: paypalFundingLabel(fundingSource)
      });
      try {
        const buttons = paypal.Buttons(options);
        if (buttons.isEligible && !buttons.isEligible()) {
          if (String(fundingSource).toLowerCase() === "ideal" || String(fundingSource).toLowerCase() === "wero") {
            console.error("iDEAL/Wero unavailable:", fundingSource);
          }
          continue;
        }
        const paypalSlot = document.createElement("div");
        paypalSlot.className = "paypal-funding-slot";
        target.appendChild(paypalSlot);
        console.log("Rendering PayPal buttons in:", paypalSlot);
        await buttons.render(paypalSlot);
        renderedButtons += 1;
      } catch (error) {
        if (String(fundingSource).toLowerCase() === "ideal" || String(fundingSource).toLowerCase() === "wero") {
          console.error("iDEAL/Wero unavailable:", error);
        }
        console.warn(`${paypalFundingLabel(fundingSource)} knop kon niet renderen`, error);
      }
    }
    if (!renderedButtons) {
      throw new Error("Geen geschikte PayPal betaalmethodes beschikbaar");
    }
    if (status) status.textContent = "";
  }

  async function applePayConfig(paypal) {
    if (!window.ApplePaySession || !window.ApplePaySession.canMakePayments?.() || !paypal?.Applepay) {
      console.error("Apple Pay eligibility failed:", "Apple PaySession of PayPal Applepay niet beschikbaar");
      return null;
    }
    const applepay = paypal.Applepay();
    const config = await applepay.config();
    if (config?.isEligible === false) {
      console.error("Apple Pay eligibility failed:", config);
      return null;
    }
    return { applepay, config };
  }

  async function applePayDomainAssociationAvailable() {
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return true;
    try {
      const response = await fetch("/.well-known/apple-developer-merchantid-domain-association", {
        method: "GET",
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`Apple Pay domain association status ${response.status}`);
      return true;
    } catch (error) {
      console.error("Apple Pay eligibility failed:", error);
      return false;
    }
  }

  async function renderApplePayButton({ target, source, status, validate, onSuccess, label = "Snel betalen met Apple Pay" }) {
    if (!target || target.dataset.applePayReady === "true") return;
    target.hidden = true;
    try {
      const paypal = await loadPayPalSdk();
      const available = await applePayConfig(paypal);
      if (!available) return;
      const domainReady = await applePayDomainAssociationAvailable();
      if (!domainReady) return;
      const { applepay, config } = available;
      target.dataset.applePayReady = "true";
      target.hidden = false;
      target.innerHTML = `<p class="apple-pay-label">${label}</p><button class="apple-pay-button" type="button" aria-label="${label}"></button>`;
      const button = $(".apple-pay-button", target);
      button.addEventListener("click", () => {
        if (button.disabled) return;
        if (validate && !validate()) return;
        const current = totals();
        if (!current.lines.length) {
          if (status) status.textContent = "Je winkelwagen is nog leeg.";
          return;
        }
        const amount = current.total.toFixed(2);
        const request = {
          countryCode: CONFIG.applePayCountryCode || "NL",
          currencyCode: CONFIG.paypalCurrency || CONFIG.currency || "EUR",
          merchantCapabilities: config.merchantCapabilities || ["supports3DS"],
          supportedNetworks: config.supportedNetworks || ["visa", "masterCard", "amex"],
          total: { label: "ORIVÈA", amount },
          requiredBillingContactFields: ["postalAddress", "name", "email"]
        };
        const session = new ApplePaySession(4, request);
        let processing = false;
        session.onvalidatemerchant = async (event) => {
          try {
            const validation = await applepay.validateMerchant({ validationUrl: event.validationURL });
            session.completeMerchantValidation(validation.merchantSession || validation);
          } catch (error) {
            console.warn("Apple Pay merchant validatie mislukt", error);
            session.abort();
          }
        };
        session.onpaymentauthorized = async (event) => {
          if (processing) return;
          processing = true;
          button.disabled = true;
          if (status) status.textContent = "Apple Pay betaling wordt bevestigd...";
          try {
            const order = await createServerPayPalOrder(current);
            const orderId = order.id || order.orderID;
            if (!orderId) throw new Error("Geen PayPal order ID ontvangen");
            await applepay.confirmOrder({
              orderId,
              orderID: orderId,
              token: event.payment.token,
              billingContact: event.payment.billingContact,
              shippingContact: event.payment.shippingContact
            });
            const captureDetails = await captureServerPayPalOrder(orderId);
            const capture = captureDetails?.purchase_units?.[0]?.payments?.captures?.[0];
            const confirmed = capture?.status === "COMPLETED" || captureDetails?.status === "COMPLETED";
            if (!confirmed) throw new Error("Apple Pay betaling niet voltooid via PayPal");
            console.log("PayPal capture status:", captureDetails?.status || capture?.status);
            console.log("PayPal capture details:", captureDetails);
            console.log("PayPal transaction ID:", capture?.id || orderId);
            console.log("PayPal payment method:", "Apple Pay");
            session.completePayment(ApplePaySession.STATUS_SUCCESS);
            await finalizePaidOrder(source(), {
              transactionId: capture?.id || orderId,
              paymentStatus: "COMPLETED",
              paymentMethod: "Apple Pay"
            }, { ...(onSuccess || {}), status });
          } catch (error) {
            console.error("Payment error:", error);
            console.warn("Apple Pay betaling mislukt", error);
            session.completePayment(ApplePaySession.STATUS_FAILURE);
            button.disabled = false;
            processing = false;
            if (status) status.textContent = "Apple Pay kon de betaling niet afronden. Kies PayPal of probeer opnieuw.";
          }
        };
        session.begin();
      });
    } catch (error) {
      console.error("Apple Pay eligibility failed:", error);
      console.warn("Apple Pay is niet beschikbaar", error);
      target.hidden = true;
    }
  }

  function quickCheckoutModal() {
    document.querySelector("[data-quick-checkout-modal]")?.remove();
    const modal = document.createElement("div");
    modal.className = "premium-modal quick-checkout-modal";
    modal.dataset.quickCheckoutModal = "true";
    modal.innerHTML = `<div class="premium-modal-panel quick-checkout-panel" role="dialog" aria-modal="true" aria-label="Snel bestellen met PayPal">
      <button class="drawer-close" type="button" data-quick-close>Sluiten</button>
      <div>
        <p class="eyebrow">Snel betalen</p>
        <h2>Snel bestellen</h2>
        <p class="quick-intro">Vul je gegevens in en rond je bestelling veilig af via PayPal of Apple Pay.</p>
        <form class="quick-checkout-form" data-quick-form>
          <label>Naam<input name="customer_name" autocomplete="name" required></label>
          <label>E-mailadres<input type="email" name="customer_email" autocomplete="email" required></label>
          <label>Telefoon<input name="customer_phone" autocomplete="tel" required></label>
          <div class="two-col">
            <label>Huisnummer<input name="house_number" inputmode="numeric" pattern="[0-9]*" required></label>
            <label>Postcode<input name="postal_code" autocomplete="postal-code" required></label>
          </div>
          <div class="address-addition-row">
            <label>Toevoeging<input name="addition" autocomplete="address-line2"></label>
          </div>
          <p class="address-status" data-address-status></p>
          <div class="address-result" data-address-result hidden>
            <div class="two-col">
              <label>Straat<input name="street" autocomplete="address-line1" required></label>
              <label>Plaats<input name="city" autocomplete="address-level2" required></label>
            </div>
            <label>Provincie<input name="province" autocomplete="address-level1"></label>
          </div>
          <button class="button primary full" type="submit">Betaalopties tonen</button>
        </form>
      </div>
      <div class="quick-payment-panel">
        <h3>Overzicht</h3>
        <div data-quick-totals></div>
        <p class="notice">Bij iedere bestelling ontvang je gratis een willekeurige ORIV&Eacute;A Discovery Sample.</p>
        <div data-quick-apple-pay hidden></div>
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
    if (!drawerPanel.querySelector("[data-continue-shopping]")) {
      const continueLink = document.createElement("a");
      continueLink.className = "button ghost full continue-shopping-button";
      continueLink.href = "catalogus.html";
      continueLink.dataset.continueShopping = "true";
      continueLink.textContent = "Verder winkelen";
      checkoutLink.insertAdjacentElement("beforebegin", continueLink);
    }
    const quickBlock = document.createElement("section");
    quickBlock.className = "quick-cart-pay";
    quickBlock.innerHTML = `<h3>Snel betalen</h3><p>Veilig, snel en vertrouwd.</p><button class="button ghost full" type="button" data-quick-checkout-open>Snel bestellen met PayPal</button>`;
    checkoutLink.insertAdjacentElement("afterend", quickBlock);

    quickBlock.querySelector("[data-quick-checkout-open]").addEventListener("click", () => {
      const data = totals();
      const message = quickBlock.querySelector("p");
      if (!data.lines.length) {
        if (message) message.textContent = "Je winkelwagen is nog leeg.";
        return;
      }
      if (message) message.textContent = "Veilig, snel en vertrouwd.";
      closeCart();
      const modal = quickCheckoutModal();
      const form = $("[data-quick-form]", modal);
      const paypalTarget = $("[data-quick-paypal]", modal);
      const applePayTarget = $("[data-quick-apple-pay]", modal);
      const status = $("[data-quick-status]", modal);
      const totalsTarget = $("[data-quick-totals]", modal);
      let quickFormData = null;
      let paypalRendered = false;

      setupAddressAutocomplete(form);
      totalsTarget.innerHTML = totalsHtml(data);
      modal.addEventListener("click", (event) => {
        if (event.target === modal || event.target.closest("[data-quick-close]")) modal.remove();
      });

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const hiddenAddress = form.querySelector("[data-address-result][hidden]");
        if (hiddenAddress) {
          hiddenAddress.hidden = false;
          $$("input", hiddenAddress).forEach((field) => { field.disabled = false; });
          const addressStatus = $("[data-address-status]", form);
          if (addressStatus) addressStatus.textContent = "Controleer je adres of vul het handmatig aan.";
        }
        if (!form.reportValidity()) return;
        quickFormData = checkoutFormData(form);
        paypalTarget.hidden = false;
        await renderApplePayButton({
          target: applePayTarget,
          source: () => quickFormData,
          status,
          validate: () => Boolean(quickFormData) && form.reportValidity(),
          onSuccess: { redirect: "checkout.html?order=success" },
          label: "Snel betalen met Apple Pay"
        });
        if (paypalRendered) return;
        try {
          const paypal = await loadPayPalSdk();
          paypalRendered = true;
          status.textContent = "";
          await renderPayPalFundingButtons({
            paypal,
            target: paypalTarget,
            source: () => quickFormData,
            status,
            validate: () => Boolean(quickFormData) && form.reportValidity(),
            onSuccess: { redirect: "checkout.html?order=success" }
          });
      } catch (error) {
        console.warn("Snelle PayPal checkout kon niet laden", error);
        status.textContent = paypalUnavailableMessage();
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
    setupAddressAutocomplete(form);
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
      if (step === 4) {
        renderApplePayButton({
          target: $('[data-apple-pay-buttons]'),
          source: () => form,
          status,
          validate: validateCheckout,
          onSuccess: { successPanel, orderStatus, showStep },
          label: "Snel betalen met Apple Pay"
        });
        renderPayPalButtons();
      }
    };

    const validateVisibleStep = () => {
      const current = $(`[data-step="${step}"]`, form);
      const hiddenAddress = current?.querySelector("[data-address-result][hidden]");
      if (hiddenAddress) {
        hiddenAddress.hidden = false;
        $$("input", hiddenAddress).forEach((field) => { field.disabled = false; });
        const addressStatus = $("[data-address-status]", current);
        if (addressStatus) addressStatus.textContent = "Controleer je adres of vul het handmatig aan.";
        const streetFocus = hiddenAddress.querySelector("input[name='street']");
        if (streetFocus) streetFocus.focus();
        return false;
      }
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
        await renderPayPalFundingButtons({
          paypal,
          target,
          source: () => form,
          status,
          validate: validateCheckout,
          onSuccess: { successPanel, orderStatus, showStep }
        });
      } catch (error) {
        console.warn("PayPal kon niet laden", error);
        if (status) status.textContent = paypalUnavailableMessage();
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
        await initEmailJs();
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
        await initEmailJs();
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

  function initVisualLayer() {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const revealTargets = $$("body[data-page='home'] .hero-match, body[data-page='home'] .campaign-section, body[data-page='home'] .category-strip, body[data-page='home'] .product-showcase, body[data-page='home'] .split-band, body[data-page='home'] .sample-usp-section, body[data-page='home'] .newsletter-section, body[data-page='home'] .faq, body[data-page='catalogus'] .page-hero");
    if (!reduced && "IntersectionObserver" in window) {
      revealTargets.forEach((element) => element.classList.add("reveal"));
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12 });
      revealTargets.forEach((element) => observer.observe(element));
    } else {
      revealTargets.forEach((element) => element.classList.add("visible"));
    }

    const canvas = $("#particles");
    if (!canvas || reduced) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let width = 0;
    let height = 0;
    let particles = [];
    let raf = 0;
    const createParticle = () => ({
      x: Math.random() * width,
      y: height + Math.random() * height * 0.3,
      radius: 35 + Math.random() * 70,
      speed: 0.12 + Math.random() * 0.32,
      drift: (Math.random() - 0.5) * 0.25,
      alpha: 0.035 + Math.random() * 0.09,
      life: Math.random() * 400
    });
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = Array.from({ length: Math.min(28, Math.max(12, Math.round(width / 60))) }, createParticle);
    };
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      particles.forEach((particle, index) => {
        particle.y -= particle.speed;
        particle.x += particle.drift + Math.sin(particle.life * 0.018) * 0.08;
        particle.life += 1;
        if (particle.y < -particle.radius) particles[index] = createParticle();
        const gradient = ctx.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, particle.radius);
        gradient.addColorStop(0, `rgba(201,169,110,${particle.alpha})`);
        gradient.addColorStop(1, "rgba(201,169,110,0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        ctx.fill();
      });
      raf = window.requestAnimationFrame(draw);
    };
    resize();
    window.addEventListener("resize", resize, { passive: true });
    raf = window.requestAnimationFrame(draw);
    window.addEventListener("pagehide", () => window.cancelAnimationFrame(raf), { once: true });
  }

  renderCartState();
  initQuickCheckout();
  initCampaigns();
  renderHomeProducts();
  initMatch();
  initCatalog();
  initCheckout();
  initContact();
  initNewsletter();
  initVisualLayer();
})();
