/** Entry point shared by every page: wires up behaviour common to all layouts. */
import { initNav } from './ui/nav.js';
import { applyAuthState } from './ui/authState.js';
import { qs } from './core/dom.js';

initNav();
const year = qs('[data-year]');
if (year) year.textContent = new Date().getFullYear();
applyAuthState();
