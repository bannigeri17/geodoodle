export const $ = id => document.getElementById(id);
const pad2 = n => String(n).padStart(2, '0');
export const dateKey = (d = new Date()) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
export const dayNumber = (d = new Date()) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
export const css = k => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
