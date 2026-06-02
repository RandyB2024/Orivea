const EMAILJS_SERVICE_ID = "service_r55nwxz";
const ORDER_TEMPLATE_ID = "template_u5h46h4";
const CONTACT_TEMPLATE_ID = "template_ehokbkn";
const EMAILJS_PUBLIC_KEY = "w3x9SY9OqatVgYJOw";
const CART_STORAGE_KEY = "orivea_cart_v2";
const SHIPPING_COST = 4.95;
const FREE_SHIPPING_FROM = 60;

let products = [];
let fragranceMap = [];
let cart = [];
let activeFilter = "all";
let activeStep = 1;

const money = (value) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(value);
const byId = (id) => document.getElementById(id);
const page = document.body.dataset.page;

if (window.emailjs) emailjs.init(EMAILJS_PUBLIC_KEY);

const saveCart = () => localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
const loadCart = () => {
  try { cart = JSON.parse(localStorage.getItem(CART_STORAGE_KEY)) || []; } catch { cart = []; }
};

const subtotal = () => cart.reduce((sum, item) => {
  const product = products.find((entry) => entry.id === item.id);
  return sum + (product ? product.price * item.quantity : 0);
}, 0);
const shipping = () => (!cart.length || subtotal() >= FREE_SHIPPING_FROM ? 0 : SHIPPING_COST);
const grandTotal = () => subtotal() + shipping();
const totalQty = () => cart.reduce((sum, item) => sum + item.quantity, 0);

const productTone = (product) => {
  const categories = product.categories.join(" ");
  if (categories.includes("fris")) return "fresh";
  if (categories.includes("bloemig") || categories.includes("romantisch")) return "floral";
  if (categories.includes("zoet")) return "sweet";
  if (categories.includes("houtachtig")) return "wood";
  if (categories.includes("kruidig")) return "spice";
  if (categories.includes("avond")) return "night";
  return "luxury";
};

const productArt = (product) => `
  <figure class="product-art ${product.gender === "Heren" ? "product-art-tall" : ""}" data-tone="${productTone(product)}" aria-label="${product.number} flesje">
    <span class="bottle-cap"></span>
    <span class="bottle-neck"></span>
    <span class="bottle-body">
      <span class="bottle-shine"></span>
      <span class="bottle-label"><small>ORIVÈA</small><strong>No. ${product.number.split(" ").pop()}</strong></span>
    </span>
    <span class="bottle-reflection"></span>
  </figure>`;

const productCard = (product) => `
  <article class="product-card">
    ${productArt(product)}
    <p class="product-number">${product.number}</p>
    <h3>${product.name}</h3>
    <p>${product.description}</p>
    <div class="tags">${[product.gender, ...product.categories.slice(1, 3)].map((tag) => `<span>${tag}</span>`).join("")}</div>
    <div class="card-bottom"><strong>${money(product.price)}</strong><a href="product.html?id=${product.id}">Bekijk</a></div>
    <button class="button gold add-to-cart" type="button" data-id="${product.id}">In winkelwagen</button>
  </article>
`;

const renderRows = () => {
  const bestsellers = products.filter((p) => p.collections.includes("bestsellers")).slice(0, 8);
  const premium = products.filter((p) => p.collections.includes("premium")).slice(0, 8);
  if (byId("bestsellerGrid")) byId("bestsellerGrid").innerHTML = bestsellers.map(productCard).join("");
  if (byId("premiumGrid")) byId("premiumGrid").innerHTML = premium.map(productCard).join("");
};

const normalize = (value) => value
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const distance = (a, b) => {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return matrix[a.length][b.length];
};

const finderScore = (query, entry) => {
  const normalizedQuery = normalize(query);
  const candidates = [entry.origineel, entry.categorie, entry.omschrijving, ...(entry.aliases || [])].map(normalize);
  let best = 999;

  candidates.forEach((candidate) => {
    if (!candidate) return;
    if (candidate === normalizedQuery) best = Math.min(best, 0);
    if (candidate.startsWith(normalizedQuery)) best = Math.min(best, 1);
    if (candidate.includes(normalizedQuery)) best = Math.min(best, 2);
    if (normalizedQuery.includes(candidate)) best = Math.min(best, 3);
    best = Math.min(best, distance(normalizedQuery, candidate));
    candidate.split(" ").forEach((part) => {
      if (part.startsWith(normalizedQuery) || normalizedQuery.startsWith(part)) best = Math.min(best, 2);
      best = Math.min(best, distance(normalizedQuery, part) + 1);
    });
  });

  return best;
};

const findAlternative = (query) => {
  const clean = normalize(query);
  if (!clean) return null;
  return fragranceMap
    .map((entry) => ({ entry, score: finderScore(clean, entry) }))
    .sort((a, b) => a.score - b.score)[0];
};

const renderFinderResult = (query) => {
  const holder = byId("finderResult");
  if (!holder) return;
  const match = findAlternative(query);

  if (!match || match.score > Math.max(4, normalize(query).length * 0.45)) {
    holder.innerHTML = `
      <div class="finder-empty">
        <strong>Geen directe match gevonden.</strong>
        <p>Probeer een merknaam, geurnaam of één herkenbaar woord zoals “Sauvage”, “Dior”, “Opium” of “Million”.</p>
      </div>`;
    return;
  }

  const entry = match.entry;
  const product = products.find((item) => item.id === entry.productId);

  if (!product) return;

  holder.innerHTML = `
    <article class="finder-match">
      <div class="match-art">${productArt(product)}</div>
      <div>
        <p class="eyebrow">Beste match voor ${entry.origineel}</p>
        <h3>${product.number}</h3>
        <p class="match-title">${product.name}</p>
        <p>${entry.omschrijving}. ${product.description}</p>
        <dl>
          <dt>Geurprofiel</dt><dd>${product.profile}</dd>
          <dt>Categorie</dt><dd>${entry.categorie}</dd>
          <dt>Prijs</dt><dd>${money(product.price)}</dd>
        </dl>
        <div class="match-actions">
          <button class="button gold add-to-cart" type="button" data-id="${product.id}">Bestel deze geur</button>
          <a class="button ghost" href="product.html?id=${product.id}">Bekijk productpagina</a>
        </div>
      </div>
    </article>`;
};

const renderCatalog = () => {
  const grid = byId("catalogGrid");
  if (!grid) return;
  const query = (byId("searchInput")?.value || "").toLowerCase().trim();
  const filtered = products.filter((product) => {
    const haystack = [product.number, product.name, product.gender, product.profile, product.occasion, ...product.categories, ...product.collections, ...product.notes].join(" ").toLowerCase();
    const filterMatch = activeFilter === "all" || haystack.includes(activeFilter);
    const queryMatch = !query || haystack.includes(query);
    return filterMatch && queryMatch;
  });
  byId("catalogCount").textContent = `${filtered.length} van ${products.length} geuren getoond`;
  grid.innerHTML = filtered.map(productCard).join("");
};

const addToCart = (id) => {
  const found = cart.find((item) => item.id === id);
  if (found) found.quantity += 1;
  else cart.push({ id, quantity: 1 });
  updateCart();
  byId("checkout")?.scrollIntoView({ behavior: "smooth", block: "start" });
};

const setQty = (id, delta) => {
  cart = cart.map((item) => item.id === id ? { ...item, quantity: item.quantity + delta } : item).filter((item) => item.quantity > 0);
  updateCart();
};

const removeItem = (id) => {
  cart = cart.filter((item) => item.id !== id);
  updateCart();
};

const cartLines = () => cart.map((item) => {
  const product = products.find((entry) => entry.id === item.id);
  return product ? { ...product, quantity: item.quantity } : null;
}).filter(Boolean);

const orderNumber = () => `ORV-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${Math.floor(1000 + Math.random() * 9000)}`;

const renderCart = () => {
  const count = byId("cartCount");
  if (count) count.textContent = totalQty();
  const holder = byId("cartItems");
  const review = byId("checkoutReview");
  const lines = cartLines();
  const lineHtml = lines.length ? lines.map((item) => `
    <div class="cart-item">
      <div><strong>${item.number}</strong><span>${item.name} · ${money(item.price)}</span></div>
      <div class="quantity-control"><button type="button" data-action="decrease" data-id="${item.id}">-</button><span>${item.quantity}</span><button type="button" data-action="increase" data-id="${item.id}">+</button></div>
      <button class="remove-item" type="button" data-action="remove" data-id="${item.id}">Verwijder</button>
    </div>
  `).join("") : '<p class="empty-cart">Je winkelwagen is leeg.</p>';
  if (holder) holder.innerHTML = lineHtml;
  if (review) review.innerHTML = lineHtml;
  if (byId("subtotal")) byId("subtotal").textContent = money(subtotal());
  if (byId("shipping")) byId("shipping").textContent = money(shipping());
  if (byId("grandTotal")) byId("grandTotal").textContent = money(grandTotal());
  if (byId("cartItemsInput")) byId("cartItemsInput").value = lines.map((i) => `${i.quantity}x ${i.number} - ${i.name} (${money(i.price)})`).join("\n");
  if (byId("cartTotalInput")) byId("cartTotalInput").value = money(grandTotal());
  if (byId("orderHtmlInput")) byId("orderHtmlInput").value = `<h2>ORIVÈA bestelling</h2><p>Totaal: ${money(grandTotal())}</p><ul>${lines.map((i) => `<li>${i.quantity}x ${i.number} - ${i.name}</li>`).join("")}</ul>`;
  saveCart();
};

const updateCart = () => renderCart();

const setStep = (step) => {
  activeStep = Math.max(1, Math.min(5, step));
  document.querySelectorAll("[data-step]").forEach((button) => button.classList.toggle("active", Number(button.dataset.step) === activeStep));
  document.querySelectorAll("[data-step-panel]").forEach((panel) => panel.classList.toggle("active", Number(panel.dataset.stepPanel) === activeStep));
  const submit = document.querySelector(".submit-order");
  const next = byId("nextStep");
  if (submit) submit.style.display = activeStep === 5 ? "inline-flex" : "none";
  if (next) next.style.display = activeStep === 5 ? "none" : "inline-flex";
};

const setStatus = (element, message, type = "") => {
  if (!element) return;
  element.textContent = message;
  element.className = `form-status ${type}`.trim();
};

const sendEmailForm = async ({ form, status, templateId, loading, success, after }) => {
  if (!window.emailjs) {
    setStatus(status, "EmailJS kon niet worden geladen. Mail naar shop@orivea.nl.", "error");
    return;
  }
  const button = form.querySelector(".form-submit, .submit-order");
  if (button) button.disabled = true;
  setStatus(status, loading);
  try {
    await emailjs.sendForm(EMAILJS_SERVICE_ID, templateId, form);
    form.reset();
    after?.();
    setStatus(status, success, "success");
  } catch (error) {
    console.error("EmailJS verzendfout:", error);
    setStatus(status, "Verzenden is niet gelukt. Probeer opnieuw of mail naar shop@orivea.nl.", "error");
  } finally {
    if (button) button.disabled = false;
  }
};

const bindCommon = () => {
  byId("menuBtn")?.addEventListener("click", () => {
    const nav = byId("siteNav");
    const isOpen = nav.classList.toggle("active");
    byId("menuBtn").setAttribute("aria-expanded", String(isOpen));
  });
  document.addEventListener("click", (event) => {
    const add = event.target.closest(".add-to-cart");
    if (add) addToCart(add.dataset.id);
    const action = event.target.closest("[data-action]");
    if (action?.dataset.action === "increase") setQty(action.dataset.id, 1);
    if (action?.dataset.action === "decrease") setQty(action.dataset.id, -1);
    if (action?.dataset.action === "remove") removeItem(action.dataset.id);
  });
};

const bindHome = () => {
  renderRows();
  renderCatalog();
  byId("finderInput")?.addEventListener("input", (event) => renderFinderResult(event.target.value));
  byId("finderButton")?.addEventListener("click", () => renderFinderResult(byId("finderInput").value));
  document.querySelectorAll("[data-query]").forEach((button) => button.addEventListener("click", () => {
    byId("finderInput").value = button.dataset.query;
    renderFinderResult(button.dataset.query);
  }));
  byId("searchInput")?.addEventListener("input", renderCatalog);
  byId("filters")?.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    activeFilter = button.dataset.filter;
    document.querySelectorAll("#filters button").forEach((item) => item.classList.toggle("active", item === button));
    renderCatalog();
  });
  document.querySelectorAll(".quick-filter, .quick-link").forEach((button) => button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    byId("catalogus")?.scrollIntoView({ behavior: "smooth" });
    document.querySelectorAll("#filters button").forEach((item) => item.classList.toggle("active", item.dataset.filter === activeFilter));
    renderCatalog();
  }));
  byId("clearCart")?.addEventListener("click", () => { cart = []; updateCart(); });
  byId("prevStep")?.addEventListener("click", () => setStep(activeStep - 1));
  byId("nextStep")?.addEventListener("click", () => setStep(activeStep + 1));
  document.querySelectorAll("[data-step]").forEach((button) => button.addEventListener("click", () => setStep(Number(button.dataset.step))));
  byId("checkoutForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!cart.length) return setStatus(byId("checkoutStatus"), "Voeg eerst producten toe aan je winkelwagen.", "error");
    byId("orderNumberInput").value = orderNumber();
    sendEmailForm({
      form: event.currentTarget,
      status: byId("checkoutStatus"),
      templateId: ORDER_TEMPLATE_ID,
      loading: "Je bestelling wordt verzonden...",
      success: "Bedankt voor je bestelling. We nemen zo snel mogelijk contact met je op via shop@orivea.nl.",
      after: () => { cart = []; updateCart(); setStep(5); },
    });
  });
  byId("contactForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    sendEmailForm({ form: event.currentTarget, status: byId("contactStatus"), templateId: CONTACT_TEMPLATE_ID, loading: "Je bericht wordt verzonden...", success: "Bedankt voor je bericht. ORIVÈA neemt zo snel mogelijk contact met je op." });
  });
  setStep(1);
};

const bindProduct = () => {
  const id = new URLSearchParams(location.search).get("id") || products[0]?.id;
  const product = products.find((entry) => entry.id === id) || products[0];
  if (!product) return;
  document.title = `${product.number} ${product.name} | ORIVÈA`;
  document.querySelector("meta[name='description']")?.setAttribute("content", product.description);
  document.querySelector("meta[property='og:title']")?.setAttribute("content", `${product.number} ${product.name}`);
  document.querySelector("meta[property='og:description']")?.setAttribute("content", product.description);
  byId("productDetail").innerHTML = `
    <div class="detail-grid">
      <div class="detail-art">${productArt(product)}</div>
      <div>
        <p class="eyebrow">${product.gender} · ${product.size}</p>
        <h1>${product.number}</h1>
        <h2>${product.name}</h2>
        <p>${product.description}</p>
        <dl><dt>Geurprofiel</dt><dd>${product.profile}</dd><dt>Doelgroep</dt><dd>${product.gender}</dd><dt>Moment</dt><dd>${product.occasion}</dd><dt>Categorie</dt><dd>${product.categories.join(", ")}</dd><dt>Inhoud</dt><dd>${product.size}</dd><dt>Prijs</dt><dd>${money(product.price)}</dd></dl>
        <button class="button gold add-to-cart" data-id="${product.id}" type="button">In winkelwagen</button>
      </div>
    </div>`;
  const related = product.related.map((rid) => products.find((entry) => entry.id === rid)).filter(Boolean);
  byId("relatedGrid").innerHTML = related.map(productCard).join("");
};

const init = async () => {
  loadCart();
  [products, fragranceMap] = await Promise.all([
    fetch("products.json").then((response) => response.json()),
    fetch("fragrance-map.json").then((response) => response.json()),
  ]);
  window.ORIVEA_FRAGRANCE_DATABASE = fragranceMap;
  bindCommon();
  if (page === "product") bindProduct();
  else bindHome();
  renderCart();
};

init();
