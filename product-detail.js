(() => {
  const dialog = document.querySelector("[data-product-info-dialog]");
  dialog?.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  const requestedVariant = new URLSearchParams(location.search).get("variant");
  const variant = requestedVariant ? document.querySelector(`[data-detail-variant="${CSS.escape(requestedVariant)}"]`) : null;
  if (variant) {
    document.querySelectorAll("[data-detail-variant]").forEach((button) => button.classList.toggle("selected", button === variant));
    const add = document.querySelector(".detail-add[data-add-to-cart]");
    if (add) add.dataset.variant = requestedVariant;
  }
})();
