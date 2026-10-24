/** Preview feature filter: quick buttons ("support only", "part only", "all") for the FDM preview feature layers.
 *
 *  The preview renderer (core/render.js) puts printed lines of each layer into three feature layers:
 *    part    shells, solid / sparse / thin fill, ironing
 *    support support structure
 *    brim    brim (incl. belt brim wings), anchor / prime strip layers, skirt, purge tower
 *  Each one is an ordinary preview layer, so it gets its own checkbox in the row at the bottom of the preview
 *  (next to tool / move / retract / engage), is saved with the other checkbox states, and only toggles mesh
 *  visibility: the layer slider range and the single layer view keep working and nothing is re-sliced.
 *  Job info numbers come from the G-code export, not from the preview meshes, so they do not change.
 */

import { api } from './api.js';

export const FEATURES = ['part', 'support', 'brim'];

const MODE = 'FDM';
let bar, observer, inited = false;

function labels() {
    try { return api.stacks.getLabels() } catch (e) { return [] }
}

function present() {
    const have = labels();
    return FEATURES.filter(f => have.includes(f));
}

/** current visibility of the feature checkboxes */
function state() {
    const out = {};
    for (const f of present()) {
        const ctrl = api.ui.dyn && api.ui.dyn[f];
        out[f] = ctrl ? ctrl.toggle.checked : true;
    }
    return out;
}

/** set the visibility of one feature layer; also records it like a click on its checkbox would */
function setFeature(label, show) {
    if (!present().includes(label)) return;
    api.stacks.setVisible(label, show);
    api.event.emit(show ? 'stack.show' : 'stack.hide', label);
}

function apply(want) {
    for (const f of present()) setFeature(f, want[f] !== false);
    paint();
    api.space.update && api.space.update();
}

function mode() {
    const s = state();
    const on = FEATURES.filter(f => s[f] === true), off = FEATURES.filter(f => s[f] === false);
    if (!off.length) return 'all';
    if (on.length === 1 && on[0] === 'support') return 'support';
    if (on.length === 1 && on[0] === 'part') return 'part';
    return 'custom';
}

const actions = {
    support: () => apply({ part: false, support: true, brim: false }),
    part: () => apply({ part: true, support: false, brim: false }),
    all: () => apply({ part: true, support: true, brim: true })
};

function paint() {
    if (!bar) return;
    const m = mode();
    for (const b of bar.querySelectorAll('button')) b.classList.toggle('on', b.dataset.ff === m);
}

function build() {
    bar = document.createElement('span');
    bar.id = 'pf-quick';
    bar.title = 'preview filter: which printed lines are shown (does not re-slice)';
    for (const [key, text, tip] of [
        ['support', 'support only', 'hide the part and the brim / base, show only support lines'],
        ['part', 'part only', 'hide support and brim / base, show only the part'],
        ['all', 'all', 'show part, support and brim / base']
    ]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.tabIndex = -1;
        b.dataset.ff = key;
        b.textContent = text;
        b.title = tip;
        b.onclick = ev => { ev.stopPropagation(); actions[key]() };
        bar.appendChild(b);
    }
}

/** keep the buttons at the end of the checkbox row (stacks.clear() wipes the row on every new preview) */
function attach() {
    const row = document.getElementById('layers');
    if (!row) return;
    const show = present().includes('support') && present().includes('part');
    if (show) {
        // keep the feature checkboxes at the end of the row in a fixed order (part, support, brim), then the buttons
        const want = FEATURES.map(f => [...row.children].find(r => r !== bar && r.textContent.trim() === f)).filter(Boolean);
        const tail = [...row.children].slice(-(want.length + 1));
        const ordered = tail.length === want.length + 1 && want.every((r, i) => tail[i] === r) && tail[want.length] === bar;
        if (!ordered) {
            for (const r of want) row.appendChild(r);
            row.appendChild(bar);
        }
        paint();
    } else if (bar.parentNode) {
        bar.parentNode.removeChild(bar);
    }
}

/** forget a hidden filter when a different set of models is loaded, so a new part is never shown hidden by accident */
function reset() {
    try {
        const saved = api.conf.get().labels;
        for (const k of Object.keys(saved)) {
            if (k.startsWith(MODE + '-') && FEATURES.some(f => k.endsWith('-' + f))) delete saved[k];
        }
    } catch (e) { }
}

function menu(id, fn) {
    const el = document.getElementById(id);
    if (el) el.onclick = () => {
        if (!present().length) return api.show.alert('the preview filter is available in the FDM preview', 3);
        fn();
    };
}

export const featurefilter = {
    init() {
        if (inited) return;
        inited = true;
        build();
        const row = document.getElementById('layers');
        if (row) {
            observer = new MutationObserver(() => {
                observer.disconnect();
                try { attach() } finally { observer.observe(row, { childList: true }) }
            });
            observer.observe(row, { childList: true });
        }
        api.event.on('stack.show', () => paint());
        api.event.on('stack.hide', () => paint());
        api.event.on('widget.add', reset);
        menu('view-support-only', actions.support);
        menu('view-part-only', actions.part);
        menu('view-show-all', actions.all);
        api.featurefilter = { state, mode, support: actions.support, part: actions.part, all: actions.all, FEATURES };
    }
};
