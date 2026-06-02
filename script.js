const EMAILJS_SERVICE_ID = "service_r55nwxz";
const ORDER_TEMPLATE_ID = "template_u5h46h4";
const CONTACT_TEMPLATE_ID = "template_ehokbkn";
const EMAILJS_PUBLIC_KEY = "w3x9SY9OqatVgYJOw";
const CART_STORAGE_KEY = "orivea_cart";

const menuBtn = document.getElementById("menuBtn");
const nav = document.getElementById("siteNav");
const checkoutForm = document.getElementById("checkoutForm");
const contactForm = document.getElementById("contactForm");
const checkoutStatus = document.getElementById("checkoutStatus");
const contactStatus = document.getElementById("contactStatus");
const cartItems = document.getElementById("cartItems");
const cartCount = document.getElementById("cartCount");
const cartTotalQty = document.getElementById("cartTotalQty");
const cartItemsInput = document.getElementById("cartItemsInput");
const clearCartButton = document.getElementById("clearCart");

let cart = [];

if (window.emailjs) {
  emailjs.init(EMAILJS_PUBLIC_KEY);
}

const loadCart = () => {
  try {
    cart = JSON.parse(localStorage.getItem(CART_STORAGE_KEY)) || [];
  } catch {
    cart = [];
  }
};

const saveCart = () => {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
};

const totalQuantity = () => cart.reduce((total, item) => total + item.quantity, 0);

const cartSummaryText = () => {
  if (!cart.length) {
    return "";
  }

  return cart
    .map((item) => `${item.quantity}x ${item.product} (${item.category})`)
    .join("\n");
};

const renderCart = () => {
  const quantity = totalQuantity();
  cartCount.textContent = String(quantity);
  cartTotalQty.textContent = `${quantity} geur(en)`;
  cartItemsInput.value = cartSummaryText();

  if (!cart.length) {
    cartItems.innerHTML = '<p class="empty-cart">Je winkelmand is nog leeg.</p>';
    return;
  }

  cartItems.innerHTML = cart
    .map(
      (item) => `
        <div class="cart-item">
          <div>
            <strong>${item.product}</strong>
            <span>${item.category} · ${item.profile}</span>
          </div>
          <div class="quantity-control" aria-label="Aantal ${item.product}">
            <button type="button" data-cart-action="decrease" data-id="${item.id}" aria-label="Aantal verlagen">-</button>
            <span>${item.quantity}</span>
            <button type="button" data-cart-action="increase" data-id="${item.id}" aria-label="Aantal verhogen">+</button>
          </div>
          <button class="remove-item" type="button" data-cart-action="remove" data-id="${item.id}">Verwijder</button>
        </div>
      `
    )
    .join("");
};

const updateCart = () => {
  saveCart();
  renderCart();
};

const addToCart = ({ product, category, profile }) => {
  const id = product;
  const existingItem = cart.find((item) => item.id === id);

  if (existingItem) {
    existingItem.quantity += 1;
  } else {
    cart.push({ id, product, category, profile, quantity: 1 });
  }

  updateCart();
  document.getElementById("checkout")?.scrollIntoView({ behavior: "smooth", block: "start" });
  setStatus(checkoutStatus, `${product} is toegevoegd aan je winkelmand.`, "success");
};

const changeQuantity = (id, delta) => {
  cart = cart
    .map((item) => (item.id === id ? { ...item, quantity: item.quantity + delta } : item))
    .filter((item) => item.quantity > 0);
  updateCart();
};

const removeFromCart = (id) => {
  cart = cart.filter((item) => item.id !== id);
  updateCart();
};

menuBtn?.addEventListener("click", () => {
  const isOpen = nav.classList.toggle("active");
  menuBtn.setAttribute("aria-expanded", String(isOpen));
});

document.querySelectorAll("a[href^='#']").forEach((link) => {
  link.addEventListener("click", (event) => {
    const target = document.querySelector(link.getAttribute("href"));

    if (!target) {
      return;
    }

    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    nav.classList.remove("active");
    menuBtn?.setAttribute("aria-expanded", "false");
  });
});

document.querySelectorAll(".add-to-cart").forEach((button) => {
  button.addEventListener("click", () => {
    addToCart({
      product: button.dataset.product,
      category: button.dataset.category,
      profile: button.dataset.profile,
    });
  });
});

cartItems?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-cart-action]");

  if (!button) {
    return;
  }

  const { cartAction, id } = button.dataset;

  if (cartAction === "increase") {
    changeQuantity(id, 1);
  }

  if (cartAction === "decrease") {
    changeQuantity(id, -1);
  }

  if (cartAction === "remove") {
    removeFromCart(id);
  }
});

clearCartButton?.addEventListener("click", () => {
  cart = [];
  updateCart();
  setStatus(checkoutStatus, "Je winkelmand is leeggemaakt.");
});

const setStatus = (element, message, type = "") => {
  if (!element) {
    return;
  }

  element.textContent = message;
  element.className = `form-status ${type}`.trim();
};

const submitWithEmailJS = async ({ form, statusElement, templateId, loadingMessage, successMessage, onSuccess }) => {
  if (!window.emailjs) {
    setStatus(statusElement, "EmailJS kon niet worden geladen. Probeer het later opnieuw of mail naar shop@orivea.nl.", "error");
    return;
  }

  const submitButton = form.querySelector(".form-submit");
  submitButton.disabled = true;
  submitButton.setAttribute("aria-busy", "true");
  setStatus(statusElement, loadingMessage);

  try {
    await emailjs.sendForm(EMAILJS_SERVICE_ID, templateId, form);
    form.reset();
    onSuccess?.();
    setStatus(statusElement, successMessage, "success");
  } catch (error) {
    console.error("EmailJS verzendfout:", error);
    setStatus(statusElement, "Verzenden is niet gelukt. Probeer het opnieuw of mail naar shop@orivea.nl.", "error");
  } finally {
    submitButton.disabled = false;
    submitButton.removeAttribute("aria-busy");
  }
};

checkoutForm?.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!cart.length) {
    setStatus(checkoutStatus, "Voeg eerst minimaal één geur toe aan je winkelmand.", "error");
    document.getElementById("collectie")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  cartItemsInput.value = cartSummaryText();

  submitWithEmailJS({
    form: checkoutForm,
    statusElement: checkoutStatus,
    templateId: ORDER_TEMPLATE_ID,
    loadingMessage: "Je checkout wordt verzonden...",
    successMessage: "Bedankt voor je bestelling. We nemen zo snel mogelijk contact met je op via shop@orivea.nl.",
    onSuccess: () => {
      cart = [];
      updateCart();
    },
  });
});

contactForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitWithEmailJS({
    form: contactForm,
    statusElement: contactStatus,
    templateId: CONTACT_TEMPLATE_ID,
    loadingMessage: "Je bericht wordt verzonden...",
    successMessage: "Bedankt voor je bericht. ORIVÈA neemt zo snel mogelijk contact met je op.",
  });
});

loadCart();
renderCart();
