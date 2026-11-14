'use strict';
/**
 * Income-tax rules for resident individuals, kept as DATA so that a change in law is an edit here, not in the engine.
 * Nothing in this file is computed by an AI model. Amounts are in rupees per year.
 *
 * Sources: published summaries of the Finance Act 2025, Union Budget 2026-27 (1 Feb 2026, no change to slabs, rebate,
 * surcharge or cess), the Income-tax Act, 2025 (in force from 1 April 2026; same rates, new section numbers) and the
 * Income-tax Rules, 2026 (HRA metro list). Checked 14 Nov 2026 against secondary sources only. The official
 * source is the Income Tax Department (incometax.gov.in); confirm there before relying on any figure.
 */

// [upper bound of band (exclusive of the next), rate in percent]; Infinity = no upper bound.
const NEW_REGIME_SLABS = [[400000, 0], [800000, 5], [1200000, 10], [1600000, 15], [2000000, 20], [2400000, 25], [Infinity, 30]];
const OLD_REGIME_SLABS = {
  under60: [[250000, 0], [500000, 5], [1000000, 20], [Infinity, 30]],
  senior: [[300000, 0], [500000, 5], [1000000, 20], [Infinity, 30]], // 60 to 79
  superSenior: [[500000, 0], [1000000, 20], [Infinity, 30]], // 80 and above
};

const BASE = {
  currency: 'INR',
  cessPercent: 4,
  roundingToNearest: 10, // sections 288A / 288B: income and tax are rounded to the nearest ten rupees
  newRegime: {
    label: 'New regime (default)',
    slabs: NEW_REGIME_SLABS,
    standardDeduction: 75000,
    rebate: { maxIncome: 1200000, maxRebate: 60000, marginalRelief: true },
    // Surcharge bands on total income: [income above, percent]. The new regime caps the rate at 25%.
    surcharge: [[5000000, 10], [10000000, 15], [20000000, 25]],
    employerNpsPercentOfBasic: 14,
    allowedDeductions: ['employerNps'],
  },
  oldRegime: {
    label: 'Old regime',
    slabs: OLD_REGIME_SLABS,
    standardDeduction: 50000,
    rebate: { maxIncome: 500000, maxRebate: 12500, marginalRelief: false },
    surcharge: [[5000000, 10], [10000000, 15], [20000000, 25], [50000000, 37]],
    employerNpsPercentOfBasic: 10,
    limits: {
      section80C: 150000,
      section80CCD1B: 50000,
      section80DSelf: 25000, section80DSelfSenior: 50000,
      section80DParents: 25000, section80DParentsSenior: 50000,
      homeLoanInterestSelfOccupied: 200000,
      section80TTA: 10000,
      section80TTB: 50000,
    },
  },
};

const METRO_4 = ['Mumbai', 'Delhi', 'Kolkata', 'Chennai'];
const METRO_8 = [...METRO_4, 'Bengaluru', 'Hyderabad', 'Pune', 'Ahmedabad'];

const RULES = Object.freeze({
  '2026-27': Object.freeze({
    ...BASE, id: '2026-27', label: 'Tax year 2026-27 (FY 2026-27, assessment year 2027-28)',
    startDate: '2026-04-01', endDate: '2027-03-31',
    act: 'Income-tax Act, 2025 (in force from 1 April 2026). Section numbers differ from the 1961 Act; rates and limits used here are unchanged.',
    metroCities: METRO_8, metroHraPercent: 50, nonMetroHraPercent: 40,
    verifiedOn: '2026-11-14',
  }),
  '2025-26': Object.freeze({
    ...BASE, id: '2025-26', label: 'FY 2025-26 (assessment year 2026-27)',
    startDate: '2025-04-01', endDate: '2026-03-31',
    act: 'Income-tax Act, 1961.',
    metroCities: METRO_4, metroHraPercent: 50, nonMetroHraPercent: 40,
    verifiedOn: '2026-11-14',
  }),
});

const DEFAULT_YEAR = '2026-27';
const YEARS = Object.keys(RULES);

/** Cities offered on the form: the 8 named metros plus "Other city". */
const CITY_CHOICES = METRO_8;

module.exports = { RULES, YEARS, DEFAULT_YEAR, CITY_CHOICES };
