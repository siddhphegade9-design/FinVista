'use strict';
/**
 * Deterministic income-tax calculator for a resident individual (salary, interest and other income taxed at slab rates).
 * Pure functions: no database, no network, no AI. Every figure in the result can be traced to a line in `lines`.
 *
 * NOT covered (the result says so): capital gains and other special-rate income, business or professional income,
 * let-out property, foreign income, advance tax and TDS already paid, AMT, perquisites, professional tax, and deductions
 * other than those listed. It is an estimate, not a tax return.
 */
const { RULES } = require('./rules');

const rup = (n) => Math.round(n);
const roundToTen = (n, step) => Math.round(n / step) * step;

/** Tax on `income` using slab bands. Returns { total, bands: [{from, to, rate, amount, tax}] } with only bands that apply. */
function slabTax(income, slabs) {
  let lower = 0;
  let total = 0;
  const bands = [];
  for (const [upper, rate] of slabs) {
    if (income > lower) {
      const amount = Math.min(income, upper) - lower;
      const tax = (amount * rate) / 100;
      total += tax;
      bands.push({ from: lower, to: upper === Infinity ? null : upper, rate, amount: rup(amount), tax: rup(tax) });
    }
    lower = upper;
    if (income <= upper) break;
  }
  return { total, bands };
}

function surchargeRate(income, table) {
  let rate = 0;
  for (const [above, pct] of table) if (income > above) rate = pct;
  return rate;
}

/** HRA exemption (old regime only): the least of HRA received, rent paid minus 10% of basic, and 50% or 40% of basic. */
function hraExemption({ hraReceived, rentPaid, basic, isMetro }, rules) {
  if (!(hraReceived > 0) || !(rentPaid > 0) || !(basic > 0)) return { exempt: 0, parts: null };
  const pct = isMetro ? rules.metroHraPercent : rules.nonMetroHraPercent;
  const a = hraReceived;
  const b = Math.max(0, rentPaid - 0.1 * basic);
  const c = (pct / 100) * basic;
  return { exempt: rup(Math.min(a, b, c)), parts: { hraReceived: rup(a), rentMinus10PercentBasic: rup(b), percentOfBasic: rup(c), percent: pct } };
}

/**
 * Tax for one regime given the already-built income figures.
 * @param taxable  taxable income in rupees (already rounded)
 */
function taxOnTaxable(taxable, regimeRules, slabs, rounding, cessPercent) {
  const base = slabTax(taxable, slabs);
  let tax = base.total;
  const lines = { slabBands: base.bands, slabTax: rup(base.total) };

  // Section 87A rebate (resident individuals).
  let rebate = 0;
  let rebateNote = null;
  const rb = regimeRules.rebate;
  if (taxable <= rb.maxIncome) {
    rebate = Math.min(tax, rb.maxRebate);
    tax -= rebate;
    if (rebate > 0) rebateNote = `Section 87A rebate: your taxable income is within ₹${rb.maxIncome.toLocaleString('en-IN')}.`;
  } else if (rb.marginalRelief) {
    const capped = taxable - rb.maxIncome;
    if (tax > capped) {
      rebate = tax - capped;
      tax = capped;
      rebateNote = `Marginal relief: just above ₹${rb.maxIncome.toLocaleString('en-IN')} the tax is limited to the income above that amount.`;
    }
  }
  lines.rebate = rup(rebate);
  lines.rebateNote = rebateNote;
  lines.taxAfterRebate = rup(tax);

  // Surcharge with marginal relief at each threshold.
  const rate = surchargeRate(taxable, regimeRules.surcharge);
  let surcharge = (tax * rate) / 100;
  let surchargeRelief = 0;
  if (rate > 0) {
    const threshold = [...regimeRules.surcharge].reverse().find(([above]) => taxable > above)[0];
    const atThreshold = slabTax(threshold, slabs).total;
    const rateAtThreshold = surchargeRate(threshold, regimeRules.surcharge);
    const totalAtThreshold = atThreshold + (atThreshold * rateAtThreshold) / 100;
    const maxTotal = totalAtThreshold + (taxable - threshold);
    if (tax + surcharge > maxTotal) {
      surchargeRelief = tax + surcharge - maxTotal;
      surcharge -= surchargeRelief;
    }
  }
  lines.surchargePercent = rate;
  lines.surcharge = rup(surcharge);
  lines.surchargeMarginalRelief = rup(surchargeRelief);

  const beforeCess = tax + surcharge;
  const cess = (beforeCess * cessPercent) / 100;
  lines.cessPercent = cessPercent;
  lines.cess = rup(cess);
  lines.totalTax = roundToTen(beforeCess + cess, rounding);
  return lines;
}

function ageKey(age) { return age === '60-79' ? 'senior' : age === '80+' ? 'superSenior' : 'under60'; }

/**
 * @param input  validated figures in rupees per year (see validation/tax.js)
 * @param rules  a rule set from rules.js
 */
function compute(input, rules = RULES['2026-27']) {
  const isMetro = rules.metroCities.includes(input.city);
  const isSenior = input.age !== 'under60' && input.age !== '<60';
  const age = input.age === 'under60' ? 'under60' : input.age;
  const rounding = rules.roundingToNearest;
  const results = {};

  const interestSavings = input.interestSavings || 0;
  const interestDeposits = input.interestDeposits || 0;
  const otherIncome = input.otherIncome || 0;
  const gross = input.grossSalary || 0;
  const basic = input.basicSalary || 0;

  for (const key of ['new', 'old']) {
    const isNew = key === 'new';
    const reg = isNew ? rules.newRegime : rules.oldRegime;
    const slabs = isNew ? reg.slabs : reg.slabs[ageKey(age)];
    const items = []; // every line shown to the user: { label, amount, note? }
    const add = (label, amount, note) => items.push({ label, amount: rup(amount), ...(note ? { note } : {}) });

    // ----- Salary -----
    add('Gross salary', gross);
    let hraExempt = 0;
    if (!isNew) {
      const h = hraExemption({ hraReceived: input.hraReceived || 0, rentPaid: input.rentPaid || 0, basic, isMetro }, rules);
      hraExempt = h.exempt;
      if (hraExempt > 0) add('Less: HRA exemption', -hraExempt, `Least of HRA received, rent paid minus 10% of basic, and ${h.parts.percent}% of basic.`);
    } else if ((input.hraReceived || 0) > 0) {
      items.push({ label: 'HRA exemption', amount: 0, note: 'Not available in the new regime.' });
    }
    const stdDeduction = gross > 0 ? Math.min(reg.standardDeduction, gross - hraExempt) : 0;
    if (stdDeduction > 0) add('Less: standard deduction', -stdDeduction);
    const salaryIncome = Math.max(0, gross - hraExempt - stdDeduction);

    // ----- House property (self-occupied home loan interest, old regime only) -----
    let housePropertyLoss = 0;
    if (!isNew && (input.homeLoanInterest || 0) > 0) {
      housePropertyLoss = Math.min(input.homeLoanInterest, reg.limits.homeLoanInterestSelfOccupied);
      add('Less: home loan interest (self-occupied)', -housePropertyLoss, `Capped at ₹${reg.limits.homeLoanInterestSelfOccupied.toLocaleString('en-IN')}.`);
    } else if (isNew && (input.homeLoanInterest || 0) > 0) {
      items.push({ label: 'Home loan interest (self-occupied)', amount: 0, note: 'Not allowed in the new regime.' });
    }

    // ----- Other income -----
    const interestTotal = interestSavings + interestDeposits + otherIncome;
    if (interestTotal > 0) add('Interest and other income', interestTotal);
    const gti = Math.max(0, salaryIncome - housePropertyLoss + interestTotal);
    add('Gross total income', gti);

    // ----- Deductions (Chapter VI-A) -----
    const deductions = [];
    const claim = (label, claimed, cap, note) => {
      const c = Math.max(0, claimed || 0);
      if (c <= 0) return;
      const applied = cap === null ? c : Math.min(c, cap);
      deductions.push({ label, claimed: rup(c), allowed: rup(applied), cap: cap === null ? null : rup(cap), ...(note ? { note } : {}) });
    };
    const employerCap = (reg.employerNpsPercentOfBasic / 100) * basic;
    claim('Employer NPS contribution (80CCD(2))', input.employerNps, employerCap, `Up to ${reg.employerNpsPercentOfBasic}% of basic salary and DA.`);
    if (!isNew) {
      const L = reg.limits;
      claim('Section 80C (PPF, ELSS, life insurance, EPF and similar)', input.section80C, L.section80C);
      claim('NPS, extra contribution (80CCD(1B))', input.section80CCD1B, L.section80CCD1B);
      claim('Health insurance for self and family (80D)', input.section80DSelf, isSenior ? L.section80DSelfSenior : L.section80DSelf);
      claim('Health insurance for parents (80D)', input.section80DParents, input.parentsSenior ? L.section80DParentsSenior : L.section80DParents);
      claim('Education loan interest (80E)', input.section80E, null, 'No upper limit; allowed for up to 8 years.');
      if (isSenior) claim('Interest on deposits (80TTB)', Math.min(interestSavings + interestDeposits, input.section80TTBClaim ?? interestSavings + interestDeposits), L.section80TTB);
      else claim('Savings account interest (80TTA)', interestSavings, L.section80TTA);
    }
    let totalDeductions = deductions.reduce((a, d) => a + d.allowed, 0);
    if (totalDeductions > gti) {
      deductions.push({ label: 'Limited to gross total income', claimed: 0, allowed: gti - totalDeductions, cap: null });
      totalDeductions = gti;
    }
    const taxableRaw = gti - totalDeductions;
    const taxable = roundToTen(taxableRaw, rounding);

    const t = taxOnTaxable(taxable, reg, slabs, rounding, rules.cessPercent);
    results[key] = {
      regime: key, label: reg.label,
      lines: items, deductions, totalDeductions: rup(totalDeductions),
      grossTotalIncome: rup(gti), taxableIncome: taxable,
      ...t,
      effectiveRatePercent: gross + interestTotal > 0 ? Math.round((t.totalTax / (gross + interestTotal)) * 10000) / 100 : 0,
      monthlyTax: rup(t.totalTax / 12),
    };
  }

  const diff = results.old.totalTax - results.new.totalTax;
  const better = diff === 0 ? 'same' : diff > 0 ? 'new' : 'old';
  return {
    taxYear: rules.id,
    ...results,
    comparison: { better, saving: Math.abs(diff), summary: summary(better, Math.abs(diff)) },
    assumptions: ASSUMPTIONS,
  };
}

const money = (n) => `₹${n.toLocaleString('en-IN')}`;
function summary(better, saving) {
  if (better === 'same') return 'Both regimes give the same tax on these figures.';
  return `On these figures the ${better} regime gives ${money(saving)} less tax.`;
}

const ASSUMPTIONS = [
  'Resident individual. Salary, interest and other income taxed at slab rates only.',
  'Not included: capital gains and other special-rate income, business income, let-out property, foreign income, perquisites, professional tax, and deductions that are not listed.',
  'Not included: TDS or advance tax already paid, so this is the tax on your income, not the amount still to pay.',
  'Amounts are annual. Income and tax are rounded to the nearest ₹10, as the law requires.',
  'This is an estimate for planning, not a tax return or tax advice.',
];

module.exports = { compute, slabTax, hraExemption, taxOnTaxable, surchargeRate, ASSUMPTIONS };
