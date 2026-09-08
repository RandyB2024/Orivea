(() => {
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const labels = { existing_match: "Bestaand", new_glantier_product: "Nieuw product", found_but_locally_discontinued: "Lokaal uitgefaseerd", rejected_brand: "Merk afgewezen", missing_reference: "Referentie ontbreekt", conflict: "Conflict" };
  const key = "orivea_glantier_import_decisions";
  const decisions = JSON.parse(localStorage.getItem(key) || "{}");
  const save = () => localStorage.setItem(key, JSON.stringify(decisions));
  const setStatus = (message) => { document.querySelector("[data-import-status]").textContent = message; };
  Promise.all([
    fetch("../data/glantier-import-preview.json").then((response) => response.json()),
    fetch("../data/glantier-new-products.json").then((response) => response.json()),
    fetch("../data/glantier-import-report.json").then((response) => response.json())
  ]).then(([preview, newProducts, report]) => {
    const summary = [["Nieuw", report.new_products_found], ["Bestaand", report.existing_matches], ["Merk afgewezen", report.rejected_brand], ["Conflicten", report.conflicts_count], ["Prijs nodig", report.price_needed]];
    document.querySelector("[data-import-summary]").innerHTML = summary.map(([label, value]) => "<span><strong>" + Number(value || 0) + "</strong> " + label + "</span>").join("");
    document.querySelector("[data-import-rows]").innerHTML = preview.map((item) => {
      const reference = item.reference_number || "Geen referentie";
      const local = item.orivea ? escapeHtml(item.orivea.geurgroep) + "<small>" + escapeHtml(item.orivea.inhoud) + " · " + escapeHtml(item.orivea.categorie) + "</small>" : '<span class="import-status warning">Niet in ORIVÈA</span>';
      const blocked = ["rejected_brand", "found_but_locally_discontinued", "missing_reference"].includes(item.classification);
      return '<tr data-reference="' + escapeHtml(item.reference_number || "") + '"><td><strong>Glantier ' + escapeHtml(reference) + '</strong><a href="' + escapeHtml(item.official.official_product_url) + '" target="_blank" rel="noopener noreferrer">Officiële bron</a></td><td>' + local + '</td><td>' + escapeHtml(item.official.fragrance_family) + '<small>' + escapeHtml(item.official.volume) + ' · ' + escapeHtml(item.official.ingredients_status) + '</small></td><td><span class="import-status ' + (blocked || item.classification === "conflict" ? "conflict" : "safe") + '">' + escapeHtml(labels[item.classification] || item.classification) + '</span></td><td><div class="import-actions"><button type="button" data-decision="accept" ' + (blocked ? "disabled" : "") + '>Accepteren</button><button type="button" data-decision="skip">Overslaan</button></div></td></tr>';
    }).join("");
    document.querySelector("[data-new-products]").innerHTML = newProducts.length ? newProducts.map((item) => '<article>' + (item.image_url ? '<img src="' + escapeHtml(item.image_url) + '" alt="" loading="lazy">' : "") + '<p class="eyebrow">Prijs nodig</p><h3>' + escapeHtml(item.product_name) + '</h3><p>Glantier ' + escapeHtml(item.reference_number) + '</p><dl><dt>Categorie</dt><dd>' + escapeHtml(item.category) + '</dd><dt>Inhoud</dt><dd>' + escapeHtml(item.volume) + '</dd><dt>Ingrediënten</dt><dd>' + escapeHtml(item.ingredients_status) + '</dd><dt>Prijs</dt><dd>Ontbreekt</dd></dl><div class="import-actions"><button type="button" data-new-decision="import" data-reference="' + escapeHtml(item.catalog_id) + '">Importeren</button><button type="button" data-new-decision="ignore" data-reference="' + escapeHtml(item.catalog_id) + '">Niet opnemen</button></div></article>').join("") : "<p>Geen nieuwe producten gevonden.</p>";
    document.querySelector("[data-price-rows]").innerHTML = newProducts.map((item) => '<tr data-price-reference="' + escapeHtml(item.catalog_id) + '"><td>' + escapeHtml(item.reference_number) + '</td><td>' + escapeHtml(item.product_name) + '</td><td colspan="3"><input type="number" min="0.01" step="0.01" data-price aria-label="ORIVÈA verkoopprijs"></td><td><input type="checkbox" data-activate disabled aria-label="Activeren"></td></tr>').join("") || '<tr><td colspan="6">Geen producten zonder prijs.</td></tr>';
    document.addEventListener("click", (event) => {
      const choice = event.target.closest("[data-decision],[data-new-decision]");
      if (choice) { const reference = choice.dataset.reference || choice.closest("tr")?.dataset.reference; decisions[reference] = { decision: choice.dataset.decision || choice.dataset.newDecision, updated_at: new Date().toISOString() }; save(); }
      if (event.target.closest("[data-export-review]")) {
        const blob = new Blob([JSON.stringify({ decisions, exported_at: new Date().toISOString() }, null, 2)], { type: "application/json" });
        const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "glantier-import-review.json"; link.click(); URL.revokeObjectURL(link.href);
        setStatus("Reviewbestand geëxporteerd. Publicatie gebeurt pas via de gecontroleerde importscripts.");
      }
    });
    document.querySelectorAll("[data-price-reference]").forEach((row) => row.addEventListener("input", () => {
      const price = Number(row.querySelector("[data-price]").value);
      row.querySelector("[data-activate]").disabled = !(price > 0);
      if (price > 0) decisions[row.dataset.priceReference] = { decision: "price_ready", price, sale_enabled: false, updated_at: new Date().toISOString() };
      save();
    }));
  }).catch((error) => setStatus("Importdata kon niet worden geladen: " + error.message));
})();
