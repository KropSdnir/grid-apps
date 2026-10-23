/** Job info overlay: material and time estimate, always visible in the viewport corner */

import { api } from './api.js';
import { client } from './workers.js';
import { MODES } from './consts.js';
import { filament } from './filament.js';

const KEY = 'jobinfo';
const SLIDER_BAND = 48; // px reserved at the bottom for the layer slider
let box, body, sum, arrow, rows = {}, serial = 0, visible = true, last;

function enabled() {
    return api.local.get(KEY) !== 'off';
}

function row(label, id, bold) {
    const r = document.createElement('div');
    r.style.cssText = 'display:flex;flex-direction:row;justify-content:space-between;gap:18px;' + (bold ? 'font-weight:bold;margin-top:4px;padding-top:4px;border-top:1px solid rgba(128,128,128,0.4);' : '');
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('span');
    v.style.cssText = 'font-family:monospace;text-align:right';
    rows[id] = v;
    r.append(l, v);
    return r;
}

function minimized() {
    return api.local.get(KEY + '-min') === 'on';
}

/** keep the whole box inside the window so the handle can always be grabbed */
function clamp() {
    if (!box || box.style.display === 'none') return;
    const w = box.offsetWidth || 210, h = box.offsetHeight || 30;
    const x = Math.min(Math.max(0, box.offsetLeft), Math.max(0, window.innerWidth - w));
    // keep clear of the layer slider bar along the bottom edge of the viewport
    const y = Math.min(Math.max(0, box.offsetTop), Math.max(0, window.innerHeight - h - SLIDER_BAND));
    box.style.left = x + 'px';
    box.style.top = y + 'px';
}

function applyMin() {
    const min = minimized();
    body.style.display = min ? 'none' : 'flex';
    sum.style.display = min ? '' : 'none';
    arrow.textContent = min ? '\u25B8' : '\u25BE';
    arrow.title = min ? 'expand' : 'collapse';
    box.style.minWidth = min ? '0' : '210px';
    clamp();
}

function toggleMin() {
    api.local.set(KEY + '-min', minimized() ? 'off' : 'on');
    applyMin();
}

/** header: drag to move, click the arrow (or double-click the header) to collapse */
function handle() {
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;flex-direction:row;align-items:center;gap:8px;cursor:move;user-select:none;pointer-events:auto;touch-action:none;font-weight:bold';
    head.title = 'drag to move, double-click to collapse';
    const grip = document.createElement('span');
    grip.textContent = '\u2630';
    grip.style.cssText = 'opacity:0.6';
    const title = document.createElement('span');
    title.textContent = 'job info';
    sum = document.createElement('span');
    sum.style.cssText = 'font-family:monospace;font-weight:normal;margin-left:4px';
    const grow = document.createElement('span');
    grow.style.flexGrow = '1';
    arrow = document.createElement('span');
    arrow.style.cssText = 'cursor:pointer;padding:0 4px;font-size:14px';
    head.append(grip, title, sum, grow, arrow);
    arrow.onclick = ev => { ev.stopPropagation(); toggleMin(); };
    arrow.onpointerdown = ev => ev.stopPropagation();
    head.ondblclick = toggleMin;
    head.onpointerdown = ev => {
        if (ev.button !== 0) return;
        const dx = ev.clientX - box.offsetLeft, dy = ev.clientY - box.offsetTop;
        head.setPointerCapture(ev.pointerId);
        head.onpointermove = mv => {
            box.style.left = (mv.clientX - dx) + 'px';
            box.style.top = (mv.clientY - dy) + 'px';
            clamp();
        };
        head.onpointerup = head.onpointercancel = up => {
            head.onpointermove = head.onpointerup = head.onpointercancel = null;
            try { head.releasePointerCapture(up.pointerId); } catch (e) { }
            api.local.set(KEY + '-pos', box.offsetLeft + ',' + box.offsetTop);
        };
        ev.preventDefault();
    };
    return head;
}

function build() {
    if (box) return;
    box = document.createElement('div');
    box.id = 'job-info';
    box.style.cssText = [
        'position:fixed', 'left:220px', 'top:76px', 'z-index:50', 'display:none', 'flex-direction:column', 'font-family:Arial,Helvetica,sans-serif',
        'padding:8px 12px', 'border-radius:6px', 'font-size:12px', 'line-height:1.35',
        'pointer-events:none', 'min-width:210px', 'overflow:hidden',
        'border:1px solid rgba(128,128,128,0.5)'
    ].join(';');
    body = document.createElement('div');
    body.style.cssText = 'display:flex;flex-direction:column;margin-top:6px';
    body.append(
        row('filament density (g/cm^3)', 'density'),
        row('filament used (mm)', 'distance'),
        row('printed weight (g)', 'weight'),
        row('filament type', 'ftype'),
        row('material cost', 'cost'),
        row('time estimate (h:m:s)', 'time', true)
    );
    box.append(handle(), body);
    const pos = (api.local.get(KEY + '-pos') || '').split(',').map(parseFloat);
    if (pos.length === 2 && pos.every(v => v >= 0)) {
        box.style.left = pos[0] + 'px';
        box.style.top = pos[1] + 'px';
    }
    document.body.appendChild(box);
    applyMin();
    window.addEventListener('resize', clamp);
}

function theme() {
    const dark = api.space && api.space.is_dark && api.space.is_dark();
    box.style.background = dark ? 'rgba(30,30,30,0.88)' : 'rgba(255,255,255,0.88)';
    box.style.color = dark ? '#ddd' : '#222';
}

function pad(v) {
    return v.toString().padStart(2, '0');
}

function hms(sec) {
    const t = Math.floor(sec), h = Math.floor(t / 3600), m = Math.floor((t - h * 3600) / 60);
    return [pad(h), pad(m), pad(t - h * 3600 - m * 60)].join(':');
}

function show(info) {
    build();
    theme();
    const set = api.conf.get();
    const density = parseFloat(api.local.get('print-density')) || 1.25;
    const dia = set.device && set.device.extruders && set.device.extruders[0] ? set.device.extruders[0].extFilament : 1.75;
    const weight = filament.weight(info.distance, dia, density);
    const price = filament.price();
    last = info;
    rows.density.textContent = density.toFixed(2);
    rows.distance.textContent = Math.round(info.distance);
    rows.weight.textContent = weight.toFixed(2);
    rows.ftype.textContent = `${filament.type()} @ ${filament.money(price)}/kg`;
    rows.cost.textContent = filament.money(filament.cost(weight, price));
    rows.time.textContent = hms(info.time);
    sum.textContent = `${filament.money(filament.cost(weight, price))}  ${hms(info.time)}`;
    visible = true;
    box.style.display = enabled() ? 'flex' : 'none';
    clamp();
}

function hide() {
    if (box) box.style.display = 'none';
}

/** compute totals for the current preview without opening the export dialog */
function refresh() {
    if (api.mode.get_id() !== MODES.FDM) {
        hide();
        return;
    }
    const mine = ++serial;
    client.export(api.conf.get(), () => {}, (output, error) => {
        if (mine !== serial || error || !output || !output.time) return;
        show(output);
    });
}

function setIcon(on) {
    const el = document.getElementById('view-jobinfo');
    const i = el && el.querySelector('i');
    if (i) i.className = on ? 'fas fa-eye' : 'fas fa-eye-slash';
}

export const jobinfo = {
    init() {
        build();
        setIcon(enabled());
        api.event.on('preview.end', refresh);
        // type, price or density edited in the export dialog
        api.event.on('filament.change', () => { if (last && box && box.style.display !== 'none') show(last); });
        api.event.on('slice.begin', () => { serial++; last = undefined; hide(); });
        const item = document.getElementById('view-jobinfo');
        if (item) item.onclick = jobinfo.toggle;
    },
    toggle() {
        const on = !enabled();
        api.local.set(KEY, on ? 'on' : 'off');
        setIcon(on);
        if (box) box.style.display = on && rows.time.textContent ? 'flex' : 'none';
        // switched on before any numbers exist (or while off during a preview): compute them now
        if (on && !rows.time.textContent) refresh();
        clamp();
    },
    refresh
};
