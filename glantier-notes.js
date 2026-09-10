const NOTE_FIELDS = ["top_notes", "heart_notes", "base_notes"];
const PROSE_BOUNDARY = /\b(?:Geurfamilie|Deze parfum|Voor wie(?: is deze parfum geschikt)?|Waarom kiezen voor|Past perfect bij|Geschikt voor|Ontwikkeld voor|Dagelijks gebruik|Ingrediënten|Referentie)\b/i;
const PROSE_TERMS = /\b(?:hoogwaardige|prijs-kwaliteit|geproduceerd|cosmeticawetgeving|gelegenheid)\b/i;

function cleanNote(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function inspectNote(value) {
  const original = cleanNote(value);
  if (!original) return { value: null, status: "empty", suspicious: false };
  const boundary = original.search(PROSE_BOUNDARY);
  const trimmed = cleanNote(boundary > 0 ? original.slice(0, boundary) : original).replace(/[.;:,-]+$/, "").trim();
  const suspicious = original.length > 250 || boundary >= 0 || PROSE_TERMS.test(original) || (original.match(/[.!?](?:\s|$)/g) || []).length > 1;
  if (!suspicious) return { value: original, status: "valid", suspicious: false };
  if (boundary > 0 && trimmed && trimmed.length <= 250 && !PROSE_BOUNDARY.test(trimmed) && !PROSE_TERMS.test(trimmed)) {
    return { value: trimmed, status: "sanitized", suspicious: true };
  }
  return { value: null, status: "review_required", suspicious: true };
}

function sanitizeProductNotes(product) {
  const result = { ...product };
  const audit = [];
  for (const field of NOTE_FIELDS) {
    const inspected = inspectNote(product?.[field]);
    if (inspected.suspicious) audit.push({ field, status: inspected.status, original_length: cleanNote(product?.[field]).length });
    result[field] = inspected.value;
  }
  result.fragrance_notes = NOTE_FIELDS.map((field) => result[field]).filter(Boolean);
  return { product: result, audit, review_required: audit.some((item) => item.status === "review_required") };
}

module.exports = { NOTE_FIELDS, inspectNote, sanitizeProductNotes };
