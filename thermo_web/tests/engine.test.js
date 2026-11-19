// Run with:  node tests/engine.test.js   (checks the website's engine against textbook and hand values)
const D = require("../assets/js/data.js");
const Th = require("../assets/js/thermo.js");
const db = Th.loadSpecies(D.species);
const rx = eq => new Th.Reaction(Th.parseReaction(eq, db), db);
let pass = 0, total = 0;
function check(label, got, want, tol) {
  total++; const ok = Math.abs(got - want) <= tol; if (ok) pass++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}: got ${got.toFixed(2)}, expected ${want.toFixed(2)} (±${tol})`);
}
function truthy(label, ok) { total++; if (ok) pass++; console.log(`[${ok ? "PASS" : "FAIL"}] ${label}`); }

const m = rx("CO + 2 H2 -> CH3OH(g)");
check("ΔA, methanol synthesis", m.dA, -7.663, 1e-6);
check("ΔH°298, methanol synthesis (J/mol)", m.dH0, -90135, 0.5);
check("ΔH° at 800 °C, methanol synthesis (SVA Ch. 4 example, J/mol)", m.dH(1073.15), -103566, 30);
truthy("unbalanced CH4 + O2 -> CO2 + H2O is detected", !rx("CH4 + O2 -> CO2 + H2O(g)").isBalanced());
check("ΔH°298 CH4 combustion, H2O(l)", rx("CH4 + 2 O2 -> CO2 + 2 H2O(l)").dH0, -890649, 1);
check("ΔH°298 CH4 combustion, H2O(g)", rx("CH4 + 2 O2 -> CO2 + 2 H2O(g)").dH0, -802625, 1);
check("ΔH°298 NH3 synthesis", rx("N2 + 3 H2 -> 2 NH3").dH0, -92220, 1);
check("ΔG°298 water-gas shift", rx("CO + H2O -> CO2 + H2").dG(298.15), -28618, 1);
const smr = rx("CH4 + H2O -> CO + 3 H2");
check("ΔG°(298.15) equals ΣνΔG°f for SMR", smr.dG(298.15), smr.dG0, 1e-6);
check("ν(O2) in 'H₂ + 1/2 O₂ -> H₂O'", Th.parseReaction("H₂ + 1/2 O₂ -> H₂O", db).get("O2(g)"), -0.5, 1e-12);
const nh3 = rx("N2 + 3 H2 -> 2 NH3");
truthy("NH3 conversion at 700 K rises from 1 to 100 bar", nh3.equilibriumConversion(700, 100) > nh3.equilibriumConversion(700, 1));
let refused = false; try { Th.parseReaction("CH4 + Xe -> CO2", db); } catch (e) { refused = e instanceof Th.ReactionError; }
truthy("unknown species is refused", refused);
// Published check: water-gas shift K within 15% of Moe (1962) between 500 and 900 K
truthy("WGS K within 15% of Moe (1962), 500–900 K", [500, 600, 700, 800, 900].every(T =>
  Math.abs(Math.exp(rx("CO + H2O(g) -> CO2 + H2").lnK(T) - (4577.8 / T - 4.33)) - 1) < 0.15));
console.log(`\n${pass}/${total} checks passed`);
process.exitCode = pass === total ? 0 : 1;
