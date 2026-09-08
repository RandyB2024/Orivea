import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("functions/api/scent-club/_shared.js", "utf8");
const shared = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

assert.equal(shared.plans.essential.discount, 0, "Essential has no webshop discount");
assert.equal(shared.plans.signature.discount, 10, "Signature has 10% discount");
assert.equal(shared.plans.duo.discount, 10, "Duo has 10% discount");
assert.equal(shared.maskCode("SC-12345678").endsWith("5678"), true, "Only final member-code characters remain visible");
assert.equal(shared.maskCode("SC-12345678").includes("1234"), false, "Member code is masked");
assert.equal(shared.cutoffOpen({ next_renewal_at: "2026-09-30" }, { SCENT_SELECTION_CUTOFF_DAYS: "5" }, new Date("2026-09-24T12:00:00Z")), true);
assert.equal(shared.cutoffOpen({ next_renewal_at: "2026-09-30" }, { SCENT_SELECTION_CUTOFF_DAYS: "5" }, new Date("2026-09-26T12:00:00Z")), false);

console.log("Scent Club self-service policy tests passed.");
