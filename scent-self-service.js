(() => {
  const login = document.querySelector("[data-member-login]");
  const dashboard = document.querySelector("[data-member-dashboard]");
  const form = document.querySelector("[data-member-login-form]");
  const loginStatus = document.querySelector("[data-login-status]");
  let csrf = "", member = null, catalog = [];

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const formatDate = (value) => value ? new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric" }).format(new Date(value)) : "Nog niet bekend";

  async function api(path, options = {}) {
    const response = await fetch("/api/scent-club/" + path, {
      credentials: "same-origin",
      ...options,
      headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": csrf } : {}), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Er ging iets mis.");
    return data;
  }

  function detail(label, value) {
    return '<div><span>' + label + '</span><strong>' + esc(value) + '</strong></div>';
  }

  function localProduct(reference) {
    return (window.ORIVEA_PRODUCTS || []).find((item) => String(item.glantierNummer) === String(reference));
  }

  function catalogMarkup() {
    if (member.selection_mode !== "self_select") {
      return '<section class="club-account-card club-choice-panel"><h2>Maandgeur</h2><p>Je hebt gekozen om ORIVÈA jouw maandgeur te laten selecteren.</p></section>';
    }
    if (!member.selection_open) {
      return '<section class="club-account-card club-choice-panel"><h2>Maandgeur</h2><p>De keuzeperiode voor deze maand is gesloten.</p></section>';
    }
    const month = new Intl.DateTimeFormat("nl-NL", { month: "long" }).format(new Date());
    const cards = catalog.map((item) => {
      const product = localProduct(item.reference);
      const image = item.image || product?.premiumImage || product?.image || "favicon.svg";
      const profile = item.profile || product?.geurgroep || "Geurprofiel";
      return '<article><img src="' + esc(image) + '" alt="Glantier ' + esc(item.reference) + '" loading="lazy"><div><small>' + esc(profile) + '</small><h3>Glantier ' + esc(item.reference) + '</h3><button class="button ghost" data-select-reference="' + esc(item.reference) + '" type="button">Kies deze geur</button></div></article>';
    }).join("") || "<p>Er zijn momenteel geen geschikte geuren beschikbaar.</p>";
    return '<section class="club-account-card club-choice-panel"><h2>Kies jouw parfum voor ' + month + '</h2><div class="club-self-catalog">' + cards + '</div></section>';
  }

  function render() {
    login.hidden = true;
    dashboard.hidden = false;
    const pending = member.pending_action ? '<p class="club-request-note">Er staat al een wijzigingsverzoek open.</p>' : "";
    const actionButton = member.status === "paused"
      ? '<button class="button ghost" data-action="resume" type="button">Abonnement hervatten</button>'
      : '<button class="button ghost" data-action="pause" type="button">Abonnement pauzeren</button>';
    dashboard.innerHTML =
      '<div class="club-account-head"><div><p class="eyebrow">Mijn Scent Club</p><h1>Welkom, ' + esc(member.first_name) + '</h1><p>Bekijk je abonnement en regel je maandgeur.</p></div><button class="text-button" data-logout type="button">Uitloggen</button></div>' +
      '<div class="club-account-grid"><section class="club-account-card"><h2>Abonnement</h2>' +
      detail("Plan", member.plan) + detail("Status", member.status) + detail("Abonnementsnummer", member.member_code) +
      detail("Startdatum", formatDate(member.started_at)) + detail("Volgende verlengdatum", formatDate(member.next_renewal_at)) +
      detail("Geurkeuze", member.selection_mode === "self_select" ? "Zelf kiezen" : "ORIVÈA kiest") +
      detail("Ledenvoordeel", member.discount ? member.discount + "% op losse bestellingen" : "Niet van toepassing") +
      '</section><section class="club-account-card club-actions"><h2>Abonnement beheren</h2><p>Wijzigingen worden als verzoek geregistreerd en door ORIVÈA verwerkt.</p>' + pending +
      '<div>' + actionButton + '<button class="text-button danger" data-action="cancel" type="button">Abonnement opzeggen</button></div><p data-action-status role="status"></p></section></div>' +
      catalogMarkup();
    bindDashboard();
  }

  function bindDashboard() {
    dashboard.querySelector("[data-logout]")?.addEventListener("click", async () => {
      await api("logout", { method: "POST", body: "{}" }).catch(() => {});
      location.reload();
    });
    dashboard.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", async () => {
      const action = button.dataset.action;
      const labels = { pause: "pauzeren", resume: "hervatten", cancel: "opzeggen" };
      if (!confirm("Wil je je Scent Club-abonnement echt " + labels[action] + "? Dit verzoek wordt door ORIVÈA verwerkt.")) return;
      const reason = action === "cancel" ? (prompt("Reden voor opzegging (optioneel)") || "") : "";
      const output = dashboard.querySelector("[data-action-status]");
      try {
        const data = await api("action", { method: "POST", body: JSON.stringify({ action, reason }) });
        member = data.member;
        output.textContent = data.message;
        setTimeout(render, 1200);
      } catch (error) { output.textContent = error.message; }
    }));
    dashboard.querySelectorAll("[data-select-reference]").forEach((button) => button.addEventListener("click", async () => {
      const reference = button.dataset.selectReference;
      if (!confirm("Je kiest Glantier " + reference + " voor deze maand. Keuze bevestigen?")) return;
      try {
        const data = await api("selection", { method: "POST", body: JSON.stringify({ product_reference: reference }) });
        alert(data.message);
      } catch (error) { alert(error.message); }
    }));
  }

  async function open(data) {
    member = data.member;
    csrf = data.csrf_token;
    if (member.selection_mode === "self_select" && member.selection_open) {
      try { catalog = (await api("catalog")).products; } catch { catalog = []; }
    }
    render();
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginStatus.textContent = "Je gegevens worden gecontroleerd...";
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await open(await api("member-login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) }));
      form.reset();
    } catch (error) { loginStatus.textContent = error.message; }
    finally { button.disabled = false; }
  });
  api("session").then(open).catch(() => { login.hidden = false; dashboard.hidden = true; });
})();
