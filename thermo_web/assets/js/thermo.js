/*
 * thermo.js - calculation engine for the Thermodynamic Reaction Energy Solver.
 * A line-for-line port of thermo.py, so the Python tests double as a check on this file.
 *
 * Conventions
 *  - Stoichiometric coefficients nu: products positive, reactants negative.
 *  - Reference state: T0 = 298.15 K, P0 = 1 bar; phase from the id suffix (g), (l), (s).
 *  - Cp/R = A + B*T + C*T^2 + D/T^2. The data stores A, 10^3 B, 10^6 C, 10^-5 D as printed in
 *    Smith, Van Ness & Abbott Appendix C; the scale factors are applied once, in the Species constructor.
 *  - Energies in J/mol of reaction as written, entropies in J/(mol K).
 */
(function (root) {
  "use strict";

  const R = 8.314;     // J/(mol K)
  const T0 = 298.15;   // K
  const P0 = 1.0;      // bar

  class ReactionError extends Error {}

  // ---------------------------------------------------------------- Cp integrals
  function intCp(A, B, C, D, Ta, Tb) {            // ∫ Cp/R dT  [K]
    return A * (Tb - Ta) + B / 2 * (Tb * Tb - Ta * Ta) + C / 3 * (Tb ** 3 - Ta ** 3)
      - D * (1 / Tb - 1 / Ta);
  }
  function intCpOverT(A, B, C, D, Ta, Tb) {       // ∫ (Cp/R)/T dT  [-]
    return A * Math.log(Tb / Ta) + B * (Tb - Ta) + C / 2 * (Tb * Tb - Ta * Ta)
      - D / 2 * (1 / (Tb * Tb) - 1 / (Ta * Ta));
  }

  // ---------------------------------------------------------------- Species
  class Species {
    constructor(r) {
      this.id = r.id; this.name = r.name; this.formula = r.formula; this.phase = r.phase;
      this.dHf = r.dHf_J_mol; this.dGf = r.dGf_J_mol; this.S0 = r.S0_J_molK;
      this.A = r.A;
      this.B = r.B_x1e3 * 1e-3;      // table gives 10^3 B
      this.C = r.C_x1e6 * 1e-6;      // table gives 10^6 C
      this.D = r["D_x1e-5"] * 1e5;   // table gives 10^-5 D
      this.Tmin = r.Tmin_K; this.Tmax = r.Tmax_K; this.Tb = r.Tb_K;
      this.cpSource = r.cp_source; this.formationSource = r.formation_source;
      this.entropySource = r.entropy_source;
    }
    cp(T) { return R * (this.A + this.B * T + this.C * T * T + this.D / (T * T)); }
    sensibleH(T, model = "variable") {
      if (model === "constant") return this.cp(T0) * (T - T0);
      return R * intCp(this.A, this.B, this.C, this.D, T0, T);
    }
    sensibleS(T, model = "variable") {
      if (model === "constant") return this.cp(T0) * Math.log(T / T0);
      return R * intCpOverT(this.A, this.B, this.C, this.D, T0, T);
    }
    get constantCpOnly() { return this.Tmin === this.Tmax; }
  }

  function loadSpecies(rows) {
    const db = new Map();
    rows.forEach(r => db.set(r.id, new Species(r)));
    return db;
  }

  // ---------------------------------------------------------------- parsing
  const SUB_IN = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9" };
  const SUB_OUT = "₀₁₂₃₄₅₆₇₈₉";

  function parseFormula(formula) {
    const tokens = formula.match(/[A-Z][a-z]?|\(|\)|\d+/g) || [];
    const stack = [{}];
    const add = (obj, el, n) => { obj[el] = (obj[el] || 0) + n; };
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok === "(") stack.push({});
      else if (tok === ")") {
        const group = stack.pop();
        let mult = 1;
        if (i + 1 < tokens.length && /^\d+$/.test(tokens[i + 1])) mult = parseInt(tokens[++i], 10);
        for (const [el, n] of Object.entries(group)) add(stack[stack.length - 1], el, n * mult);
      } else if (/^\d+$/.test(tok)) {
        throw new ReactionError(`Unexpected number in formula '${formula}'`);
      } else {
        let n = 1;
        if (i + 1 < tokens.length && /^\d+$/.test(tokens[i + 1])) n = parseInt(tokens[++i], 10);
        add(stack[stack.length - 1], tok, n);
      }
    }
    return stack[0];
  }

  function editDistance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1,
          d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }

  function resolveSpecies(token, db) {
    token = token.trim().replace(/[₀-₉]/g, c => SUB_IN[c]).replace(/\s+/g, "");
    if (db.has(token)) return token;
    for (const suffix of ["(g)", "(s)", "(l)"]) if (db.has(token + suffix)) return token + suffix;
    const low = token.toLowerCase();
    for (const [id, s] of db) {
      if (low === id.toLowerCase() || low === id.toLowerCase().slice(0, -3) || low === s.name.toLowerCase()) return id;
    }
    const close = [...db.keys()]
      .map(id => [id, editDistance(token.toLowerCase(), id.toLowerCase().replace(/\(.\)$/, ""))])
      .filter(([, d]) => d <= Math.max(1, Math.floor(token.length / 3)))
      .sort((a, b) => a[1] - b[1]).slice(0, 3).map(([id]) => id);
    const hint = close.length ? ` Did you mean ${close.join(", ")}?` : "";
    throw new ReactionError(`'${token}' is not in the species database.${hint}`);
  }

  const ARROW = /<=>|<->|->|=>|→|⇌|⟶|=/;
  const TERM = /^\s*(\d+\s*\/\s*\d+|\d*\.\d+|\d+)?\s*(.+?)\s*$/;

  function parseCoeff(s) {
    s = s.replace(/\s+/g, "");
    if (s.includes("/")) { const [n, d] = s.split("/").map(Number); return n / d; }
    return Number(s);
  }

  function parseReaction(text, db) {
    const sides = text.split(ARROW);
    if (sides.length !== 2) {
      throw new ReactionError("Write the reaction with exactly one arrow, for example: CO + 2 H2 -> CH3OH");
    }
    const stoich = new Map();
    [[sides[0], -1], [sides[1], 1]].forEach(([side, sign]) => {
      const terms = side.split("+");
      if (terms.some(t => !t.trim())) {
        throw new ReactionError("A '+' or the arrow has nothing next to it. Check the reaction.");
      }
      for (const term of terms) {
        const m = term.match(TERM);
        const coeff = m[1] ? parseCoeff(m[1]) : 1;
        if (!(coeff > 0) || !isFinite(coeff)) {
          throw new ReactionError(`Coefficient in '${term.trim()}' must be a positive number.`);
        }
        const id = resolveSpecies(m[2], db);
        stoich.set(id, (stoich.get(id) || 0) + sign * coeff);
      }
    });
    for (const [k, v] of [...stoich]) if (Math.abs(v) < 1e-12) stoich.delete(k);
    if (!stoich.size) throw new ReactionError("Every species cancels out; there is no net reaction.");
    return stoich;
  }

  function pretty(text) {
    return text.replace(/([A-Za-z)])(\d+)/g, (_, a, d) => a + [...d].map(c => SUB_OUT[+c]).join(""));
  }

  function fmtCoeff(nu) {
    const x = Math.abs(nu);
    for (let d = 1; d <= 12; d++) {
      const n = Math.round(x * d);
      if (Math.abs(n / d - x) < 1e-9) return n === d ? "" : (d === 1 ? String(n) : `${n}/${d}`);
    }
    return String(+x.toFixed(4));
  }

  // ---------------------------------------------------------------- Reaction
  class Reaction {
    constructor(stoich, db) {
      this.stoich = stoich;
      this.sp = new Map([...stoich.keys()].map(k => [k, db.get(k)]));
      const sum = f => [...stoich].reduce((acc, [k, nu]) => acc + nu * f(this.sp.get(k)), 0);
      this.dA = sum(s => s.A); this.dB = sum(s => s.B); this.dC = sum(s => s.C); this.dD = sum(s => s.D);
      this.dH0 = sum(s => s.dHf);
      this.dG0 = sum(s => s.dGf);
      this.dS0ThirdLaw = sum(s => s.S0);
      this.dS0FromG = (this.dH0 - this.dG0) / T0;
      this.dnGas = [...stoich].reduce((a, [k, nu]) => a + (this.sp.get(k).phase === "g" ? nu : 0), 0);
    }

    get reactants() { return [...this.stoich].filter(([, v]) => v < 0).map(([k, v]) => [k, -v]); }
    get products() { return [...this.stoich].filter(([, v]) => v > 0); }

    equation() {
      const side = list => list.map(([k, v]) => `${fmtCoeff(v)} ${pretty(k)}`.trim()).join(" + ");
      return `${side(this.reactants)} → ${side(this.products)}`;
    }

    elementBalance() {
      const net = {};
      for (const [k, nu] of this.stoich) {
        for (const [el, n] of Object.entries(parseFormula(this.sp.get(k).formula))) {
          net[el] = (net[el] || 0) + nu * n;
        }
      }
      return net;
    }
    isBalanced(tol = 1e-9) { return Object.values(this.elementBalance()).every(v => Math.abs(v) < tol); }

    dCp(T) { return R * (this.dA + this.dB * T + this.dC * T * T + this.dD / (T * T)); }

    dH(T, model = "variable") {
      if (model === "constant") return this.dH0 + this.dCp(T0) * (T - T0);
      return this.dH0 + R * intCp(this.dA, this.dB, this.dC, this.dD, T0, T);
    }
    dS0(route = "gibbs") { return route === "gibbs" ? this.dS0FromG : this.dS0ThirdLaw; }
    dS(T, model = "variable", route = "gibbs") {
      if (model === "constant") return this.dS0(route) + this.dCp(T0) * Math.log(T / T0);
      return this.dS0(route) + R * intCpOverT(this.dA, this.dB, this.dC, this.dD, T0, T);
    }
    dG(T, model = "variable", route = "gibbs") { return this.dH(T, model) - T * this.dS(T, model, route); }
    lnK(T, model = "variable", route = "gibbs") { return -this.dG(T, model, route) / (R * T); }

    pathBreakdown(T, model = "variable") {
      const cool = -this.reactants.reduce((a, [k, n]) => a + n * this.sp.get(k).sensibleH(T, model), 0);
      const heat = this.products.reduce((a, [k, n]) => a + n * this.sp.get(k).sensibleH(T, model), 0);
      return [
        ["1. Bring reactants from T to 298.15 K", cool],
        ["2. React at 298.15 K (ΔH°₂₉₈)", this.dH0],
        ["3. Bring products from 298.15 K to T", heat],
        ["Total = ΔH°(T)", cool + this.dH0 + heat],
      ];
    }

    speciesTable(T, model = "variable") {
      return [...this.stoich].map(([k, nu]) => {
        const s = this.sp.get(k);
        return {
          id: k, nu, cp298: s.cp(T0), cpT: model === "constant" ? s.cp(T0) : s.cp(T),
          dHsens: s.sensibleH(T, model), dSsens: s.sensibleS(T, model),
        };
      });
    }

    crossovers(Tlo, Thi, model = "variable", route = "gibbs") {
      const n = 600, roots = [];
      const g = t => this.dG(t, model, route);
      let t1 = Tlo, g1 = g(t1);
      for (let i = 1; i <= n; i++) {
        const t2 = Tlo + (Thi - Tlo) * i / n, g2 = g(t2);
        if (g1 === 0) roots.push(t1);
        else if (g1 * g2 < 0) {
          let a = t1, b = t2, ga = g1;
          for (let it = 0; it < 80; it++) {
            const m = (a + b) / 2, gm = g(m);
            if (ga * gm <= 0) b = m; else { a = m; ga = gm; }
          }
          roots.push((a + b) / 2);
        }
        t1 = t2; g1 = g2;
      }
      return roots;
    }

    /* Equilibrium conversion for a stoichiometric feed of reactants (no products, no inerts).
       Ideal-gas mixture; condensed species are pure phases (activity 1).
       Solves  prod y_i^nu_i = K (P/P0)^(-dn_gas).  Returns null if no gas species take part. */
    equilibriumConversion(T, P, model = "variable", route = "gibbs") {
      const gas = [...this.stoich.keys()].filter(k => this.sp.get(k).phase === "g");
      if (!gas.length) return null;
      const lnK = this.lnK(T, model, route);
      const n0 = new Map([...this.stoich].map(([k, nu]) => [k, nu < 0 ? -nu : 0]));
      const f = x => {
        let ntot = 0; const n = {};
        for (const k of gas) { n[k] = n0.get(k) + this.stoich.get(k) * x; ntot += n[k]; }
        let s = 0;
        for (const k of gas) s += this.stoich.get(k) * Math.log(n[k] / ntot);
        return s + this.dnGas * Math.log(P / P0) - lnK;
      };
      let lo = 1e-12, hi = 1 - 1e-12;
      if (f(lo) >= 0) return 0;
      if (f(hi) <= 0) return 1;
      for (let it = 0; it < 200; it++) {       // f is monotonic increasing in x
        const m = (lo + hi) / 2;
        if (f(m) > 0) hi = m; else lo = m;
      }
      return (lo + hi) / 2;
    }

    warnings(Tlo, Thi, model = "variable") {
      const out = [];
      for (const [k, s] of this.sp) {
        if (model === "variable") {
          if (s.constantCpOnly && (Tlo < T0 - 0.5 || Thi > T0 + 0.5)) {
            out.push(`${pretty(k)}: only a single Cp value at 298.15 K is available, so its Cp is held constant at every temperature.`);
          } else if (Tlo < s.Tmin - 0.5 || Thi > s.Tmax + 0.5) {
            out.push(`${pretty(k)}: the Cp correlation is valid from ${s.Tmin} to ${s.Tmax} K. Results outside that range are extrapolated.`);
          }
        }
        if (s.phase === "l" && s.Tb && Thi > s.Tb) {
          out.push(`${pretty(k)} is above its normal boiling point (${s.Tb} K). A liquid at 1 bar is not the stable phase there; consider the (g) form.`);
        }
      }
      const gap = T0 * Math.abs(this.dS0FromG - this.dS0ThirdLaw);
      if (gap > 1000) {
        out.push(`The ΔG°f data and the S° data disagree: T₀·|ΔS°(from ΔG°) − ΔS°(from S°)| = ${(gap / 1000).toFixed(1)} kJ/mol. Check the species data.`);
      }
      return out;
    }
  }

  const api = { R, T0, P0, ReactionError, Species, Reaction, loadSpecies, parseFormula, parseReaction, pretty, fmtCoeff };
  root.Thermo = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
