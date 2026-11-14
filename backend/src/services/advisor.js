'use strict';
/** Advisor: gathers the user's own aggregated figures, asks the AI model (Groq) to explain them, returns plain text. Stateless: no questions or answers are stored. */
const config = require('../config/env');
const ai = require('../ai/groq');
const { buildFacts } = require('../ai/context');
const { systemPrompt, PRESETS, MAX_QUESTION, buildPrompt } = require('../ai/prompt');
const users = require('./users');
const insights = require('./insights');
const budgetsSvc = require('./budgets');
const investments = require('./investments');

const LABEL = 'AI-generated explanation of your recorded figures. It can make mistakes and is not financial or tax advice. Check anything important against your own records.';
const MAX_ANSWER = 4000;

function status() {
  return {
    configured: ai.isConfigured(),
    model: ai.isConfigured() ? config.groq.model : null,
    presets: Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label })),
    maxQuestionLength: MAX_QUESTION,
    hourlyLimit: config.advisor.maxPerHour,
  };
}

async function getFacts(userId, now = new Date()) {
  const [forecast, anomalies, budgets, sips, pols, currency] = await Promise.all([
    insights.getForecast(userId, now),
    insights.getAnomalies(userId, now),
    budgetsSvc.getBudgets(userId, now.toISOString().slice(0, 7), now),
    investments.listSips(userId, now),
    investments.listPolicies(userId, now),
    users.getCurrency(userId),
  ]);
  return buildFacts({
    forecast, anomalies, budgets, now, currency,
    investments: { sipCount: sips.summary.activeCount, sipMonthly: sips.summary.monthlyCommitment },
    insurance: { activeCount: pols.summary.activeCount, monthlyEquivalent: pols.summary.monthlyEquivalent, dueSoon: pols.summary.dueSoon, overdue: pols.summary.overdue },
  });
}

async function ask(userId, { kind, question }, { now = new Date(), generate = ai.generate } = {}) {
  if (generate === ai.generate) ai.assertConfigured(); // fail before touching the database
  const facts = await getFacts(userId, now);
  const out = await generate({ system: systemPrompt(facts.currency), prompt: buildPrompt(facts, question) });
  return {
    kind, answer: out.text.slice(0, MAX_ANSWER), truncated: out.truncated || out.text.length > MAX_ANSWER, model: out.model,
    generatedAt: now.toISOString(), basedOn: { completeMonths: facts.completeMonthsOfHistory, currentMonth: facts.generatedOn.slice(0, 7), notes: facts.dataNotes },
    label: LABEL,
  };
}

module.exports = { status, getFacts, ask, LABEL };
