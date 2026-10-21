/** Filament type and price per kg, used for the cost estimate (material window, job info, gcode comment) */

import { api } from './api.js';

const TYPE_KEY = 'filament-type';
const PRICE_KEY = 'filament-price-';

/** default price in $ per kg (1 kg spool) for each type */
export const FILAMENT_DEFAULTS = {
    PLA: 20,
    PETG: 22,
    ABS: 20,
    TPU: 30,
    Other: 20
};

export const FILAMENT_TYPES = Object.keys(FILAMENT_DEFAULTS);

function type() {
    const t = api.local.get(TYPE_KEY);
    return FILAMENT_DEFAULTS[t] !== undefined ? t : 'PLA';
}

function price(t = type()) {
    const p = parseFloat(api.local.get(PRICE_KEY + t));
    return p >= 0 ? p : FILAMENT_DEFAULTS[t];
}

function setType(t) {
    if (FILAMENT_DEFAULTS[t] !== undefined) api.local.set(TYPE_KEY, t);
}

/** remembers the price for one type; a blank or invalid value goes back to the default */
function setPrice(t, p) {
    p = parseFloat(p);
    api.local.set(PRICE_KEY + t, p >= 0 ? p : '');
}

/** printed weight in grams from filament length (mm), diameter (mm) and density (g/cm^3) */
function weight(distance, dia, density) {
    return Math.round(Math.PI * (dia / 2) * (dia / 2) * distance * (parseFloat(density) || 1.25) / 10) / 100;
}

function cost(grams, pricePerKg = price()) {
    return grams / 1000 * pricePerKg;
}

function money(v) {
    return '$' + v.toFixed(2);
}

/** comment lines for the top of the gcode (comments only) */
function gcodeComments(grams) {
    const t = type(), p = price(t);
    return [
        `; filament: ${t} @ ${money(p)}/kg`,
        `; estimated material cost: ${money(cost(grams, p))} (${grams.toFixed(1)} g)`
    ];
}

/** header block (lines joined with newline) for the top of the gcode */
function gcodeHeader(distance, dia, density) {
    return gcodeComments(weight(distance, dia, density)).join('\n');
}

export const filament = { type, price, setType, setPrice, weight, cost, money, gcodeComments, gcodeHeader };
