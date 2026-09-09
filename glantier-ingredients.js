const cheerio = require("cheerio");

const LABEL = /^(ingrediënten|ingredienten|ingredients(?:\s*\/\s*inci)?|inci|samenstelling|composition|składniki)\s*:?[\s\u00a0]*$/i;
const LABEL_GLOBAL = /(ingrediënten|ingredienten|ingredients(?:\s*\/\s*inci)?|inci|samenstelling|composition|składniki)\s*:/ig;
const INCI = /\b(alcohol|parfum|aqua|limonene|linalool|citral|citronellol|geraniol|coumarin|benzyl\w*|cinnamal|salicylate|tocopherol|glycerin|glycol|sodium|potassium|acid|oil|extract)\b/ig;

const clean = (value) => String(value || "").replace(/\s+/g," ").replace(/\u00a0/g," ").trim();

function trimCandidate(value) {
  let text = clean(value).replace(
    /^(ingrediënten|ingredienten|ingredients(?:\s*\/\s*inci)?|inci|samenstelling|composition|składniki)\s*:\s*/i,
    ""
  );
  const explicitInci = [...text.matchAll(/\bINCI\s*:\s*/gi)].pop();
  if (explicitInci) text = text.slice(explicitInci.index + explicitInci[0].length);
  text = text.split(/\s+\b(?:referentie|ean13|grade|specifieke referenties|geurnoten|productdetails|beoordelingen|reviews?)\b\s*:*/i)[0];
  return text.replace(/^Alco\s+(?=Alcohol\b)/i, "").slice(0,6000).trim();
}

function plausible(value) {
  const text = trimCandidate(value);
  const terms = new Set((text.match(INCI) || []).map((item)=>item.toLowerCase()));
  const separated = (text.match(/[,;]/g) || []).length >= 2;
  return text.length >= 20 && text.length <= 6000 && terms.size >= 2 && separated;
}

function jsonCandidates(value, output, path = "") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) return value.forEach((item,index)=>jsonCandidates(item,output,`${path}[${index}]`));
  for (const [key,item] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (/(ingredients?|inci|composition|samenstelling|składniki)/i.test(key) && (typeof item === "string" || Array.isArray(item))) output.push({source:`json:${nextPath}`,text:Array.isArray(item)?item.join(", "):item});
    if (item && typeof item === "object") jsonCandidates(item,output,nextPath);
  }
}

function extractIngredients(html) {
  const $ = cheerio.load(html);
  const candidates = [];
  const labels = [];
  const add = (source, value) => { const text=trimCandidate(value); if(text) candidates.push({source,text}); };

  $("script[type='application/ld+json'],script[type='application/json'],script#__NEXT_DATA__,script[data-product]").each((_,element)=>{
    try { jsonCandidates(JSON.parse($(element).text()),candidates,$(element).attr("id") || "embedded"); } catch {}
  });
  $("[data-ingredients],[data-inci],[data-composition]").each((_,element)=>add("data-attribute",$(element).attr("data-ingredients") || $(element).attr("data-inci") || $(element).attr("data-composition") || $(element).text()));

  $("body *").each((_,element)=>{
    const node=$(element); const own=clean(node.clone().children().remove().end().text());
    if (!LABEL.test(own)) return;
    labels.push(own.replace(/:$/, ""));
    const controls=node.attr("aria-controls") || node.attr("data-target") || node.attr("data-bs-target") || node.attr("href");
    if (controls && /^#/.test(controls)) add("controlled-target",$(controls).text());
    if (element.tagName === "summary") add("details",node.parent("details").text());
    if (element.tagName === "dt") add("description-list",node.next("dd").text());
    const row=node.closest("tr"); if(row.length) add("table-row",row.find("td").last().text());
    add("next-sibling",node.next().text());
    add("parent",node.parent().text());
    let siblings=[]; let current=node.next();
    while(current.length && siblings.join(" ").length<5000){const text=clean(current.text());if(LABEL.test(text)||/^h[1-6]$/i.test(current[0]?.tagName))break;if(text)siblings.push(text);current=current.next();}
    add("sibling-range",siblings.join(" "));
  });

  const bodyText=clean($("body").text()); let match;
  while((match=LABEL_GLOBAL.exec(bodyText))){add("body-label",bodyText.slice(match.index,match.index+6500));}
  const valid=candidates.filter((candidate)=>plausible(candidate.text)).sort((a,b)=>a.text.length-b.text.length);
  const best=valid[0] || null;
  return {ingredients_source_text:best?.text || null,ingredients:best?best.text.split(/[,;]/).map(clean).filter(Boolean):[],ingredients_status:best?"approved_official":labels.length?"parse_failed":"not_found",extraction_source:best?.source || null,found_labels:[...new Set(labels)],candidates:candidates.slice(0,30)};
}

module.exports={extractIngredients,plausible,trimCandidate};
