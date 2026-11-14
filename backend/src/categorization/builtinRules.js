'use strict';
/**
 * Built-in keyword rules, used when none of the user's own rules match. Keywords are matched as whole
 * words (or whole word sequences) in the normalised description, never as parts of words. Category names
 * must exist in config/defaultCategories.js (a test checks that). Users can override any of this with
 * their own rules, which always win.
 */
const RULES = [
  { kind: 'expense', category: 'Food & Dining', keywords: ['swiggy', 'zomato', 'restaurant', 'cafe', 'coffee', 'starbucks', 'dominos', 'pizza hut', 'pizza', 'mcdonalds', 'kfc', 'burger king', 'subway', 'bigbasket', 'blinkit', 'zepto', 'instamart', 'grocery', 'groceries', 'supermarket', 'dmart', 'reliance fresh', 'bakery', 'lunch', 'dinner', 'breakfast', 'dining', 'food'] },
  { kind: 'expense', category: 'Transport', keywords: ['uber', 'ola', 'rapido', 'metro', 'cab', 'taxi', 'auto rickshaw', 'fuel', 'petrol', 'diesel', 'bpcl', 'hpcl', 'iocl', 'indian oil', 'fastag', 'parking', 'bus pass', 'toll'] },
  { kind: 'expense', category: 'Bills & Utilities', keywords: ['electricity', 'bescom', 'tata power', 'water bill', 'gas bill', 'broadband', 'airtel', 'jio', 'vodafone', 'recharge', 'mobile bill', 'postpaid', 'dth', 'tata play', 'insurance', 'lic premium', 'wifi'] },
  { kind: 'expense', category: 'Housing', keywords: ['rent', 'house rent', 'maintenance', 'housing society', 'society charges', 'property tax', 'home loan', 'plumber', 'electrician'] },
  { kind: 'expense', category: 'Shopping', keywords: ['amazon', 'flipkart', 'myntra', 'ajio', 'nykaa', 'meesho', 'croma', 'reliance digital', 'ikea', 'decathlon', 'shopping'] },
  { kind: 'expense', category: 'Health', keywords: ['pharmacy', 'apollo', '1mg', 'pharmeasy', 'netmeds', 'hospital', 'clinic', 'doctor', 'medical', 'diagnostic', 'lab test', 'dental', 'gym', 'cult fit', 'cultfit'] },
  { kind: 'expense', category: 'Entertainment', keywords: ['netflix', 'spotify', 'prime video', 'hotstar', 'disney', 'youtube', 'bookmyshow', 'pvr', 'inox', 'cinema', 'movie', 'steam', 'sony liv', 'zee5', 'gaming'] },
  { kind: 'expense', category: 'Education', keywords: ['tuition', 'school fee', 'college fee', 'course fee', 'udemy', 'coursera', 'byjus', 'unacademy', 'exam fee', 'book store', 'stationery'] },
  { kind: 'expense', category: 'Travel', keywords: ['irctc', 'makemytrip', 'goibibo', 'cleartrip', 'indigo', 'air india', 'vistara', 'hotel', 'airbnb', 'oyo', 'flight', 'booking com', 'railway'] },
  { kind: 'income', category: 'Salary', keywords: ['salary', 'payroll', 'wages'] },
  { kind: 'income', category: 'Freelance', keywords: ['freelance', 'client payment', 'consulting', 'consultancy'] },
  { kind: 'income', category: 'Investments', keywords: ['dividend', 'interest', 'mutual fund', 'fd maturity', 'capital gain'] },
];

module.exports = Object.freeze(RULES);
