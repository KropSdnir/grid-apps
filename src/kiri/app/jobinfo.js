/** Job info overlay: material and time estimate, always visible in the viewport corner */

import { api } from './api.js';
import { client } from './workers.js';
import { MODES } from './consts.js';

const KEY = 'jobinfo';
let box, rows = {}, serial = 0, visible = true;

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

function build() {
    if (box) return;
    box = document.createElement('div');
    box.id = 'job-info';
    box.style.cssText = [
        'position:fixed', 'left:220px', 'top:76px', 'z-index:50', 'display:none', 'flex-direction:column', 'font-family:Arial,Helvetica,sans-serif',
        'padding:8px 12px', 'border-radius:6px', 'font-size:12px', 'line-height:1.35',
        'pointer-events:none', 'min-width:210px',
        'border:1px solid rgba(128,128,128,0.5)'
    ].join(';');
    box.append(
        row('filament density (g/cm^3)', 'density'),
        row('filament used (mm)', 'distance'),
        row('printed weight (g)', 'weight'),
        row('time estimate (h:m:s)', 'time', true)
    );
    document.body.appendChild(box);
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
    const weight = Math.PI * (dia / 2) * (dia / 2) * info.distance * density / 1000;
    rows.density.textContent = density.toFixed(2);
    rows.distance.textContent = Math.round(info.distance);
    rows.weight.textContent = weight.toFixed(2);
    rows.time.textContent = hms(info.time);
    visible = true;
    box.style.display = enabled() ? 'flex' : 'none';
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
        api.event.on('slice.begin', () => { serial++; hide(); });
        const item = document.getElementById('view-jobinfo');
        if (item) item.onclick = jobinfo.toggle;
    },
    toggle() {
        const on = !enabled();
        api.local.set(KEY, on ? 'on' : 'off');
        setIcon(on);
        if (box) box.style.display = on && rows.time.textContent ? 'flex' : 'none';
    },
    refresh
};
