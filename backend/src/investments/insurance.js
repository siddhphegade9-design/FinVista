'use strict';
/** Insurance maths: premium normalisation and renewal reminders. Pure; the date is passed in. */
const PER_YEAR = { monthly: 12, quarterly: 4, half_yearly: 2, yearly: 1 };
const DAY = 86_400_000;
const dayNum = (isoDate) => Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / DAY);

/** Premium per year in paise. */
const annualPremiumPaise = (premiumPaise, frequency) => premiumPaise * PER_YEAR[frequency];

/** Days until the next due date (negative when overdue). */
const daysUntil = (dueIso, todayIso) => dayNum(dueIso) - dayNum(todayIso);

/** 'overdue' | 'due_soon' (within 30 days) | 'upcoming' | 'inactive'. */
function renewalStatus(policy, todayIso) {
  if (!policy.isActive) return 'inactive';
  const d = daysUntil(policy.nextDueDate, todayIso);
  if (d < 0) return 'overdue';
  return d <= 30 ? 'due_soon' : 'upcoming';
}

module.exports = { PER_YEAR, annualPremiumPaise, daysUntil, renewalStatus };
