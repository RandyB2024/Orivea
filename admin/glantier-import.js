(() => {
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[character]));
  const labels = { existing_match:"Bestaand", new_glantier_product:"Nieuw product", found_but_locally_discontinued:"Lokaal uitgefaseerd", rejected_brand:"Merk afgewezen", missing_reference:"Referentie ontbreekt", conflict:"Conflict" };
  const storageKey = "orivea_glantier_import_decisions";
  const decisions = JSON.parse(localStorage.getItem(storageKey) || "{}");
  const saveDecisions = () => localStorage.setItem(storageKey,JSON.stringify(decisions));
  const status = document.querySelector("[data-import-status]");
  const reportBox = document.querySelector("[data-price-report]");
  const setStatus = (message,type="") => { status.textContent=message;status.dataset.type=type; };
  const categoryRank = (item) => { const text=`${item.product_type||""} ${item.product_name||""}`;return /sample/i.test(text)?1:/doucheolie/i.test(text)?0:/baardolie/i.test(text)?2:3; };
  const sortProducts = (products) => [...products].sort((a,b) => categoryRank(a)-categoryRank(b) || String(a.reference_number||"").localeCompare(String(b.reference_number||""),"nl",{numeric:true}));
  const hasValidPrice = (value) => /^\d+(?:[.,]\d{1,2})?$/.test(String(value).trim()) && Number(String(value).replace(",",".")) > 0;
  const fallbackImage = (item) => /baard/i.test(`${item.product_type||""} ${item.product_name||""}`) ? "../assets/images/orivea-baardolie.webp" : "../assets/images/orivea-doucheolie.webp";

  async function api(path,options={}) {
    const response=await fetch(path,{headers:{"Content-Type":"application/json",...(options.headers||{})},...options});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);return data;
  }

  function renderReport(result) {
    reportBox.hidden=false;
    reportBox.innerHTML=`<strong>${Number(result.pricesSaved||0)} prijzen opgeslagen</strong><span>${Number(result.activated||0)} producten geactiveerd</span><span>${Number(result.remaining||0)} producten nog zonder prijs</span>${result.skipped?`<span>${result.skipped} incomplete regels overgeslagen</span>`:""}${result.errors?.length?`<ul>${result.errors.map((error)=>`<li>${escapeHtml(error)}</li>`).join("")}</ul>`:""}`;
  }

  function priceRows(products) {
    return sortProducts(products).map((item) => {
      const stored=decisions[item.catalog_id]?.price;const value=item.price??stored??"";
      const fallback=fallbackImage(item);const image=item.image_url&&!/\/h$/i.test(item.image_url)?item.image_url:fallback;
      return `<tr data-price-reference="${escapeHtml(item.catalog_id)}"><td data-label="Afbeelding"><img class="price-product-image" src="${escapeHtml(image)}" alt="${escapeHtml(item.product_name)}" loading="lazy" onerror="this.onerror=null;this.src='${escapeHtml(fallback)}'"></td><td data-label="Ref."><strong>${escapeHtml(item.reference_number||"-")}</strong></td><td data-label="Product">${escapeHtml(item.product_name)}</td><td data-label="Inhoud">${escapeHtml(item.volume||"-")}</td><td data-label="Categorie">${escapeHtml(item.product_type||item.category||"-")}</td><td data-label="Status"><span class="import-status ${item.status==="active"?"safe":"warning"}" data-row-status>${escapeHtml(item.status||"needs_price")}</span></td><td data-label="Prijs"><label class="price-input"><span>€</span><input type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(value)}" data-price aria-label="ORIVÈA verkoopprijs voor ${escapeHtml(item.product_name)}"></label><small class="price-error" data-price-error></small></td><td data-label="Activeren"><label class="activate-choice"><input type="checkbox" data-activate ${item.status==="active"?"checked disabled":""}><span>${item.status==="active"?"Actief":"Activeren"}</span></label></td></tr>`;
    }).join("") || '<tr><td colspan="8">Geen nieuwe producten gevonden.</td></tr>';
  }

  function collectRows() {
    return [...document.querySelectorAll("[data-price-reference]")].map((row) => ({row,catalog_id:row.dataset.priceReference,price:row.querySelector("[data-price]").value.trim(),activate:row.querySelector("[data-activate]").checked&&!row.querySelector("[data-activate]").disabled}));
  }

  function validateRows(rows) {
    let invalidActivations=0;
    rows.forEach(({row,price,activate})=>{const error=row.querySelector("[data-price-error]");error.textContent="";row.classList.remove("has-error");if(price&&!hasValidPrice(price)){error.textContent="Gebruik een bedrag hoger dan € 0,00 met maximaal 2 decimalen.";row.classList.add("has-error");}if(activate&&!hasValidPrice(price)){error.textContent="Een geldige prijs is verplicht voor activatie.";row.classList.add("has-error");invalidActivations++;}});
    return invalidActivations===0;
  }

  Promise.all([
    fetch("../data/glantier-import-preview.json").then((response)=>response.json()),
    fetch("../data/glantier-new-products.json").then((response)=>response.json()),
    fetch("../data/glantier-import-report.json").then((response)=>response.json()),
    api("/api/catalog-import").then((data)=>data.products).catch(()=>null)
  ]).then(([preview,newProducts,report,staging]) => {
    const products=(staging||newProducts).filter((item)=>item.status==="needs_price"||item.status==="active");
    const summary=[["Nieuw",report.new_products_found],["Bestaand",report.existing_matches],["Merk afgewezen",report.rejected_brand],["Conflicten",report.conflicts_count],["Prijs nodig",products.filter((item)=>!hasValidPrice(item.price)).length]];
    document.querySelector("[data-import-summary]").innerHTML=summary.map(([label,value])=>`<span><strong>${Number(value||0)}</strong> ${label}</span>`).join("");
    document.querySelector("[data-import-rows]").innerHTML=preview.map((item)=>{const reference=item.reference_number||"Geen referentie";const local=item.orivea?`${escapeHtml(item.orivea.geurgroep)}<small>${escapeHtml(item.orivea.inhoud)} · ${escapeHtml(item.orivea.categorie)}</small>`:'<span class="import-status warning">Niet in ORIVÈA</span>';const blocked=["rejected_brand","found_but_locally_discontinued","missing_reference"].includes(item.classification);return `<tr data-reference="${escapeHtml(item.reference_number||"")}"><td><strong>Glantier ${escapeHtml(reference)}</strong><a href="${escapeHtml(item.official.official_product_url)}" target="_blank" rel="noopener noreferrer">Officiële bron</a></td><td>${local}</td><td>${escapeHtml(item.official.fragrance_family)}<small>${escapeHtml(item.official.volume)} · ${escapeHtml(item.official.ingredients_status)}</small></td><td><span class="import-status ${blocked||item.classification==="conflict"?"conflict":"safe"}">${escapeHtml(labels[item.classification]||item.classification)}</span></td><td><div class="import-actions"><button type="button" data-decision="accept" ${blocked?"disabled":""}>Accepteren</button><button type="button" data-decision="skip">Overslaan</button></div></td></tr>`;}).join("");
    document.querySelector("[data-new-products]").innerHTML=newProducts.length?sortProducts(newProducts).map((item)=>`<article>${item.image_url?`<img src="${escapeHtml(item.image_url)}" alt="" loading="lazy">`:""}<p class="eyebrow">Prijs nodig</p><h3>${escapeHtml(item.product_name)}</h3><p>Glantier ${escapeHtml(item.reference_number)}</p><dl><dt>Categorie</dt><dd>${escapeHtml(item.product_type||item.category)}</dd><dt>Inhoud</dt><dd>${escapeHtml(item.volume)}</dd><dt>Prijs</dt><dd>Ontbreekt</dd></dl></article>`).join(""):"<p>Geen nieuwe producten gevonden.</p>";
    document.querySelector("[data-price-rows]").innerHTML=priceRows(products);

    document.addEventListener("input",(event)=>{const input=event.target.closest("[data-price]");if(!input)return;const row=input.closest("[data-price-reference]");const valid=hasValidPrice(input.value);row.querySelector("[data-price-error]").textContent=input.value&&!valid?"Maximaal 2 decimalen en hoger dan € 0,00.":"";row.classList.toggle("has-error",Boolean(input.value&&!valid));decisions[row.dataset.priceReference]={...(decisions[row.dataset.priceReference]||{}),decision:"price_ready",price:input.value,updated_at:new Date().toISOString()};saveDecisions();});
    document.addEventListener("click",async(event)=>{
      const choice=event.target.closest("[data-decision]");if(choice){const reference=choice.closest("tr")?.dataset.reference;decisions[reference]={decision:choice.dataset.decision,updated_at:new Date().toISOString()};saveDecisions();}
      if(event.target.closest("[data-save-prices]")){const rows=collectRows();if(!validateRows(rows)){setStatus("Controleer de gemarkeerde regels.","error");return;}try{setStatus("Prijzen worden opgeslagen...");const result=await api("/api/catalog-import/prices",{method:"POST",body:JSON.stringify({products:rows.filter((item)=>item.price).map(({catalog_id,price,activate})=>({catalog_id,price,activate}))})});renderReport(result);setStatus("Prijsbeheer is bijgewerkt.","success");}catch(error){setStatus(`${error.message} Start lokaal met: npm run admin:catalog`,"error");}}
      if(event.target.closest("[data-activate-priced]")){if(!confirm("Alle producten met een geldige opgeslagen prijs activeren voor verkoop en Merchant Center?"))return;try{const result=await api("/api/catalog-import/activate-priced",{method:"POST",body:JSON.stringify({confirm:true})});renderReport(result);setStatus("Bulkactivatie voltooid. Vernieuw de pagina voor de actuele statussen.","success");}catch(error){setStatus(error.message,"error");}}
      if(event.target.closest("[data-generate]")){if(!confirm("Productpagina's en Merchant feed nu opnieuw genereren?"))return;try{setStatus("Generators worden uitgevoerd...");const result=await api("/api/catalog-import/generate",{method:"POST",body:"{}"});setStatus(result.commands.map((item)=>`${item.script}: ${item.ok?"gereed":"mislukt"}`).join(" · "),"success");}catch(error){setStatus(`${error.message} Voer anders uit: npm run generate:products en npm run generate:feed`,"error");}}
      if(event.target.closest("[data-export-review]")){const blob=new Blob([JSON.stringify({decisions,exported_at:new Date().toISOString()},null,2)],{type:"application/json"});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download="glantier-import-review.json";link.click();URL.revokeObjectURL(link.href);setStatus("Reviewbestand geëxporteerd.");}
    });
  }).catch((error)=>setStatus(`Importdata kon niet worden geladen: ${error.message}`,"error"));
})();
