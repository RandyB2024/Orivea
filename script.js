const EMAILJS_SERVICE_ID = "service_r55nwxz";
const ORDER_TEMPLATE_ID = "template_u5h46h4";
const CONTACT_TEMPLATE_ID = "template_ehokbkn";
const EMAILJS_PUBLIC_KEY = "w3x9SY9OqatVgYJOw";

const menuBtn = document.getElementById("menuBtn");
const nav = document.getElementById("siteNav");
const orderForm = document.getElementById("orderForm");
const contactForm = document.getElementById("contactForm");
const orderProduct = document.getElementById("orderProduct");
const orderStatus = document.getElementById("orderStatus");
const contactStatus = document.getElementById("contactStatus");

if (window.emailjs) {
  emailjs.init(EMAILJS_PUBLIC_KEY);
}

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

document.querySelectorAll(".order-product").forEach((button) => {
  button.addEventListener("click", () => {
    orderProduct.value = button.dataset.product || "";
    document.getElementById("bestellen")?.scrollIntoView({ behavior: "smooth", block: "start" });
    orderProduct.focus({ preventScroll: true });
  });
});

const setStatus = (element, message, type = "") => {
  element.textContent = message;
  element.className = `form-status ${type}`.trim();
};

const submitWithEmailJS = async ({ form, statusElement, templateId, loadingMessage, successMessage }) => {
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
    setStatus(statusElement, successMessage, "success");
  } catch (error) {
    console.error("EmailJS verzendfout:", error);
    setStatus(statusElement, "Verzenden is niet gelukt. Probeer het opnieuw of mail naar shop@orivea.nl.", "error");
  } finally {
    submitButton.disabled = false;
    submitButton.removeAttribute("aria-busy");
  }
};

orderForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitWithEmailJS({
    form: orderForm,
    statusElement: orderStatus,
    templateId: ORDER_TEMPLATE_ID,
    loadingMessage: "Je bestelling wordt verzonden...",
    successMessage: "Bedankt voor je bestelling. We nemen zo snel mogelijk contact met je op via shop@orivea.nl.",
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
