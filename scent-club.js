(() => {
  if (!document.querySelector('link[href="scent-club.css"]')) {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "scent-club.css";
    document.head.appendChild(stylesheet);
  }
  const STORAGE_KEY = "orivea_scent_club_subscription";
  const SCENT_CLUB_SELECTION_DEADLINE_DAY = 20;
  const plans = {
    essential: { name: "Essential", price: 17.95, discount: 0 },
    signature: { name: "Signature", price: 22.95, discount: 10 },
    duo: { name: "Duo", price: 34.95, discount: 10 }
  };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const money = (value) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(value);
  const monthKey = () => new Date().toISOString().slice(0, 7);
  const read = () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null; } catch { return null; }
  };
  const write = (subscription) => localStorage.setItem(STORAGE_KEY, JSON.stringify(subscription));
  const createId = () => `SC-${Date.now().toString(36).toUpperCase()}`;
  const nextBillingDate = () => {
    const date = new Date();
    date.setMonth(date.getMonth() + 1);
    return date.toISOString().slice(0, 10);
  };
  const formatDate = (value) => value ? new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T12:00:00`)) : "Nog niet bekend";

  window.ORIVEA_SCENT_CLUB = {
    selectionDeadlineDay: SCENT_CLUB_SELECTION_DEADLINE_DAY,
    createSubscriptionCheckout(subscription) {
      return { ok: false, status: "payment_configuration_required", subscription };
    },
    handleSubscriptionPayment() {
      throw new Error("Recurring payment provider is nog niet gekoppeld.");
    },
    processSubscriptionRenewal() {
      throw new Error("Subscription renewals vereisen een beveiligde backend.");
    }
  };

  const requestModal = $("[data-scent-modal]");
  const requestForm = $("[data-scent-request-form]");
  let modalTrigger = null;

  function closeRequestModal() {
    if (!requestModal) return;
    requestModal.hidden = true;
    document.body.classList.remove("scent-modal-open");
    modalTrigger?.focus();
  }

  function openRequestModal(planId, trigger) {
    if (!requestModal || !requestForm || !plans[planId]) return;
    modalTrigger = trigger;
    const plan = plans[planId];
    requestForm.reset();
    requestForm.elements.plan.value = planId;
    requestForm.elements.plan_price.value = money(plan.price);
    $("[data-request-plan]", requestModal).textContent = plan.name;
    $("[data-request-price]", requestModal).textContent = money(plan.price);
    $("[data-scent-request-status]", requestModal).textContent = "";
    $("[data-scent-form-view]", requestModal).hidden = false;
    $("[data-scent-success]", requestModal).hidden = true;
    requestModal.hidden = false;
    document.body.classList.add("scent-modal-open");
    requestForm.elements.first_name.focus();
  }

  $$('[data-select-plan]').forEach((button) => button.addEventListener("click", () => openRequestModal(button.dataset.selectPlan, button)));
  $$('[data-scent-close]').forEach((button) => button.addEventListener("click", closeRequestModal));
  requestModal?.addEventListener("click", (event) => { if (event.target === requestModal) closeRequestModal(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && requestModal && !requestModal.hidden) closeRequestModal(); });

  requestForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!requestForm.reportValidity()) return;
    const status = $("[data-scent-request-status]", requestModal);
    const submit = requestForm.querySelector('button[type="submit"]');
    const raw = Object.fromEntries(new FormData(requestForm).entries());
    const externalId = createId();
    const plan = plans[raw.plan];
    const submittedAt = new Intl.DateTimeFormat("nl-NL", { dateStyle: "long", timeStyle: "short" }).format(new Date());
    const intakeData = {type:"scent_club_request",request_id:externalId,first_name:raw.first_name,last_name:raw.last_name,email:raw.email,phone:raw.phone || "",plan:raw.plan,preference_gender:raw.gender_preference,preference_family:raw.fragrance_family,selection_mode:raw.selection_mode,notes:raw.notes || ""};
    const dataBlock = `--- ORIVEA-DATA ---\n${JSON.stringify(intakeData)}\n--- END ORIVEA-DATA ---`;
    const message = `NIEUWE ORIVÈA SCENT CLUB AANVRAAG\n\nAbonnement:\n${plan.name}\n\nPrijs:\n${money(plan.price)} per maand\n\nKLANT\n\nNaam:\n${raw.first_name} ${raw.last_name}\n\nE-mail:\n${raw.email}\n\nTelefoon:\n${raw.phone || "Niet opgegeven"}\n\nGEURVOORKEUR\n\nVoor wie:\n${raw.gender_preference}\n\nGeurfamilie:\n${raw.fragrance_family}\n\nMaandkeuze:\n${raw.selection_mode}\n\nOPMERKINGEN\n\n${raw.notes || "Geen opmerkingen"}\n\n${dataBlock}`;
    const payload = {
      request_type: "ORIVÈA Scent Club aanvraag", plan_name: plan.name,
      plan_price: `${money(plan.price)} per maand`, first_name: raw.first_name,
      last_name: raw.last_name, name: `${raw.first_name} ${raw.last_name}`,
      email: raw.email, phone: raw.phone || "Niet opgegeven",
      gender_preference: raw.gender_preference, fragrance_family: raw.fragrance_family,
      selection_mode: raw.selection_mode, notes: raw.notes || "Geen opmerkingen",
      submitted_at: submittedAt, subject: `Nieuwe ORIVÈA Scent Club aanvraag — ${plan.name}`,
      email_subject: `Nieuwe ORIVÈA Scent Club aanvraag — ${plan.name}`,
      message_type: "ORIVÈA Scent Club aanvraag", message_body: message, message, request_id:externalId, orivea_data:dataBlock
    };
    status.textContent = "Je aanvraag wordt verzonden...";
    submit.disabled = true;
    try {
      try {
        const saved = await fetch("/api/scent-club/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ external_id: externalId, first_name: raw.first_name, last_name: raw.last_name, email: raw.email, phone: raw.phone, plan: raw.plan, preference_gender: raw.gender_preference, preference_family: raw.fragrance_family, selection_mode: raw.selection_mode, notes: raw.notes }) });
        if (!saved.ok) console.warn("Scent Club registratie wordt later verwerkt, status:", saved.status);
      } catch (error) { console.warn("Scent Club API niet beschikbaar; e-mailflow gaat door:", error); }
      const templateId = window.ORIVEA_CONFIG?.emailJs?.scentClubTemplate || window.ORIVEA_CONFIG?.emailJs?.contactTemplate;
      if (!window.ORIVEA_EMAIL?.send) throw new Error("Bestaande EmailJS-helper is niet beschikbaar.");
      await window.ORIVEA_EMAIL.send(payload, templateId);
      write({
        subscription_id: externalId, customer_id: null, email: raw.email, first_name: raw.first_name,
        last_name: raw.last_name, plan: raw.plan, monthly_price: plan.price, status: "request_submitted",
        payment_status: "not_applicable", preference_gender: raw.gender_preference,
        preference_family: raw.fragrance_family, selection_mode: raw.selection_mode,
        current_month_selection: null, created_at: new Date().toISOString(), started_at: null,
        next_billing_date: null, notes: raw.notes || "", discount_percentage: plan.discount,
        order_type: "subscription_request"
      });
      $("[data-scent-form-view]", requestModal).hidden = true;
      $("[data-scent-success]", requestModal).hidden = false;
      $("[data-scent-success] button", requestModal)?.focus();
    } catch (error) {
      console.error("Scent Club aanvraag verzenden mislukt:", error);
      status.textContent = "Het versturen is helaas niet gelukt. Probeer het opnieuw of neem contact met ons op.";
    } finally {
      submit.disabled = false;
    }
  });

  function eligiblePerfumes(subscription) {
    const products = window.ORIVEA_PRODUCTS || [];
    return products.filter((product) => {
      if (!product.glantierNummer || !["Dames", "Heren", "Unisex"].includes(product.categorie)) return false;
      if (!subscription || ["Unisex", "Verrassing"].includes(subscription.preference_gender)) return true;
      return product.categorie === subscription.preference_gender || product.categorie === "Unisex";
    }).slice(0, 24);
  }

  function perfumeCard(product, selected) {
    return `<article class="club-perfume-card ${selected ? "selected" : ""}"><img src="${product.premiumImage || product.image}" alt="${product.naam}" loading="lazy"><div><p>${product.categorie} &middot; ${product.geurgroep || "Geurprofiel"}</p><h3>Glantier ${product.glantierNummer}</h3><button class="button ${selected ? "ghost" : "primary"}" type="button" data-club-select="${product.id}">${selected ? "Gekozen" : "Kies deze geur"}</button></div></article>`;
  }

  function showSubscriptionGate(target) {
    target.innerHTML = `<div class="club-empty"><p class="eyebrow">Nog geen abonnement gevonden</p><h2>Start bij de Scent Club.</h2><p>Op dit apparaat is nog geen abonnementsaanvraag opgeslagen.</p><a class="button primary" href="scent-club.html#abonnementen">Bekijk abonnementen</a></div>`;
  }

  function renderChoice() {
    const target = $("[data-club-choice]");
    if (!target) return;
    const subscription = read();
    if (!subscription) return showSubscriptionGate(target);
    const selection = subscription.current_month_selection;
    target.innerHTML = `<div class="club-choice-summary"><div><p class="eyebrow">Jouw geur voor deze maand</p><h1>${plans[subscription.plan]?.name || subscription.plan}</h1><p>${subscription.preference_gender} &middot; ${subscription.preference_family} &middot; keuze vóór de ${SCENT_CLUB_SELECTION_DEADLINE_DAY}e</p></div><a class="text-link" href="mijn-abonnement.html">Mijn abonnement</a></div><p class="club-deadline-note">Maak uiterlijk op dag ${SCENT_CLUB_SELECTION_DEADLINE_DAY} van de maand je keuze. Zonder keuze selecteert ORIV&Egrave;A later een geur op basis van je profiel.</p><div class="club-perfume-grid">${eligiblePerfumes(subscription).map((product) => perfumeCard(product, selection?.product_id === product.id)).join("")}</div><p class="club-selection-status" data-club-choice-status>${selection ? `Jouw geur voor deze maand is vastgelegd: Glantier ${selection.number}.` : "Je hebt deze maand nog geen geur gekozen."}</p>`;
    target.addEventListener("click", (event) => {
      const button = event.target.closest("[data-club-select]");
      if (!button) return;
      const product = (window.ORIVEA_PRODUCTS || []).find((item) => item.id === button.dataset.clubSelect);
      if (!product) return;
      subscription.current_month_selection = { product_id: product.id, number: product.glantierNummer, name: product.naam };
      subscription.selection_month = new Date().getMonth() + 1;
      subscription.selection_year = new Date().getFullYear();
      subscription.selection_period = monthKey();
      write(subscription);
      window.dispatchEvent(new CustomEvent("orivea:scent-club-event", { detail: { type: "monthly_selection_confirmed", subscription } }));
      renderChoice();
    }, { once: true });
  }

  function detail(label, value) { return `<div><span>${label}</span><strong>${value}</strong></div>`; }
  function renderAccount() {
    const target = $("[data-club-account]");
    if (!target) return;
    const subscription = read();
    if (!subscription) return showSubscriptionGate(target);
    const plan = plans[subscription.plan] || { name: subscription.plan, price: subscription.monthly_price };
    target.innerHTML = `<div class="club-account-head"><div><p class="eyebrow">Mijn abonnement</p><h1>Welkom, ${subscription.first_name}</h1><p>Beheer hier jouw geurprofiel en maandkeuze.</p></div><span class="club-status ${subscription.status}">${subscription.status === "pending_payment" ? "Wacht op betaalintegratie" : subscription.status}</span></div><div class="club-account-grid"><section class="club-account-card"><h2>Abonnement</h2>${detail("Plan", plan.name)}${detail("Prijs", `${money(plan.price)} per maand`)}${detail("Status", subscription.status)}${detail("Volgende verlengdatum", formatDate(subscription.next_billing_date))}${detail("Huidige maandkeuze", subscription.current_month_selection ? `Glantier ${subscription.current_month_selection.number}` : "Nog niet gekozen")}<a class="button primary" href="scent-club-keuze.html">Geur kiezen</a></section><section class="club-account-card"><h2>Geurprofiel</h2><form data-profile-form><label>Voor wie<select name="preference_gender"><option>Dames</option><option>Heren</option><option>Unisex</option><option>Verrassing</option></select></label><label>Favoriete geurfamilie<select name="preference_family"><option>Fris</option><option>Bloemig</option><option>Zoet</option><option>Oriëntaals</option><option>Houtachtig</option><option>Citrus</option><option>Kruidig</option><option>Geen voorkeur</option></select></label><label>Voorkeur<select name="selection_mode"><option value="self">Zelf iedere maand kiezen</option><option value="curated">ORIVÈA voor mij laten kiezen</option></select></label><button class="button ghost" type="submit">Voorkeur opslaan</button></form></section></div><section class="club-account-actions"><h2>Abonnement beheren</h2><p>Er is nog geen actieve periodieke betaling. Statuswijzigingen worden wel lokaal vastgelegd.</p><div><button class="button ghost" type="button" data-club-action="pause">Pauzeren</button><button class="button ghost" type="button" data-club-action="resume">Hervatten</button><button class="text-button" type="button" data-club-action="cancel">Abonnement opzeggen</button></div><p data-account-status></p></section>`;
    const form = $("[data-profile-form]", target);
    form.elements.preference_gender.value = subscription.preference_gender;
    form.elements.preference_family.value = subscription.preference_family;
    form.elements.selection_mode.value = subscription.selection_mode;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      Object.assign(subscription, Object.fromEntries(new FormData(form).entries()));
      write(subscription);
      $("[data-account-status]", target).textContent = "Je geurprofiel is bijgewerkt.";
    });
    target.addEventListener("click", (event) => {
      const action = event.target.closest("[data-club-action]")?.dataset.clubAction;
      if (!action) return;
      if (action === "cancel" && !window.confirm("Weet je zeker dat je jouw Scent Club-abonnement wilt opzeggen?")) return;
      if (action === "pause") Object.assign(subscription, { status: "paused", paused_at: new Date().toISOString() });
      if (action === "resume") Object.assign(subscription, { status: subscription.payment_status === "completed" ? "active" : "pending_payment", paused_at: null });
      if (action === "cancel") Object.assign(subscription, { status: "cancelled", cancelled_at: new Date().toISOString() });
      write(subscription);
      window.dispatchEvent(new CustomEvent("orivea:scent-club-event", { detail: { type: `subscription_${action}d`, subscription } }));
      renderAccount();
    }, { once: true });
  }

  renderChoice();
  renderAccount();
})();
