/** View navigator overlay: orientation cube, orbit / pan / zoom steps with a user chosen step size,
 *  exact azimuth / elevation / distance boxes and a perspective / orthographic switch.
 *
 *  Camera model (src/moto/orbit.js): the camera orbits a target around the scene Y axis (= world Z, up).
 *    azimuth  theta, 0 = looking at the front (camera on the -Y side of the bed), +90 = right, 180 = back, -90 = left
 *    elevation 90 - phi, 0 = level, +90 = top, -90 = bottom
 *  Angles are stored as JS doubles; the only limit is that phi stays 1e-6 rad away from the poles.
 *  The camera has no roll (camera.up is fixed to +Y), so there are no roll buttons.
 *  Views are relative to the world / bed axes, like the existing View > top and View > home.
 */

import { api } from './api.js';

const KEY = 'viewnav';
const DEG = Math.PI / 180;
const FOV = 35; // matches moto/space.js `perspective`
const MIN_STEP = 0.001; // degrees, and mm for the move step
const MAX_STEP = 90;
const NARROW = 700; // below this width the overlay starts as a small button
const W_FULL = 248; // expanded width in px (see index.css)
const SLIDER_BAND = 48; // px kept clear above the layer slider along the bottom edge
const GAP = 8;
const HOLD_DELAY = 400, HOLD_EVERY = 60; // ms, same as the layer slider buttons
const ANGLE_PRESETS = [15, 5, 1, 0.5, 0.1, 0.05, 0.01, 0.005, 0.001];
const MOVE_PRESETS = [50, 10, 5, 1, 0.5, 0.1, 0.05, 0.01];
// view name -> [azimuth deg, elevation deg]
const VIEWS = {
    front:  [0, 0],
    back:   [180, 0],
    right:  [90, 0],
    left:   [-90, 0],
    top:    [0, 90],
    bottom: [0, -90],
    iso:    [45, Math.atan(1 / Math.SQRT2) / DEG]
};

let root, body, cube, ui = {}, inited = false;
let step = 1, dstep = 5;
let lastSig = '', lastJob = '', frame = 0;

const local = {
    get(k) { try { return api.local.get(KEY + k) } catch (e) { return null } },
    set(k, v) { try { api.local.set(KEY + k, v) } catch (e) { } }
};

function enabled() {
    return local.get('') !== 'off';
}

function space() {
    return api.const.SPACE;
}

function ctrl() {
    return space().view.ctrl;
}

function camera() {
    return space().internals().camera;
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function wrap180(deg) {
    let d = ((deg + 180) % 360 + 360) % 360 - 180;
    return d === -180 ? 180 : d;
}

/** the current camera state: angles in degrees, distance in mm (perspective equivalent in ortho) */
function read() {
    const s = space(), c = ctrl(), cam = camera(), t = c.getTarget();
    const off = cam.position.clone().sub(t);
    // prefer the controller's own stored angles, they carry no atan2 noise
    const pos = c.getPosition();
    const theta = Number.isFinite(pos.left) ? pos.left : Math.atan2(off.x, off.z);
    const phi = Number.isFinite(pos.up) ? pos.up : Math.atan2(Math.hypot(off.x, off.z), off.y);
    const ortho = !!cam.isOrthographicCamera;
    let dist = off.length();
    if (ortho) {
        dist = ((cam.top - cam.bottom) / 2 / (cam.zoom || 1)) / Math.tan(FOV * DEG / 2);
    }
    return { theta, phi, az: wrap180(theta / DEG), el: 90 - phi / DEG, dist, ortho, target: t };
}

function setAngles(theta, phi) {
    ctrl().setPosition({ left: theta, up: phi });
}

/** orbit by dAz / dEl degrees (positive azimuth = camera moves toward the right side) */
function orbit(dAz, dEl) {
    const r = read();
    setAngles(r.theta + dAz * DEG, r.phi - dEl * DEG);
}

/** dolly so the (equivalent) distance changes by `delta` mm; keeps the target */
function dolly(delta) {
    const r = read();
    const d = Math.max(MIN_STEP, r.dist + delta);
    ctrl().setPosition({ scale: d / r.dist });
}

/** move the camera and target sideways: sx/sy = direction the model moves on screen */
function pan(sx, sy, mm) {
    const c = ctrl();
    camera().updateMatrix();
    c.panLeft(sx * mm);
    c.panUp(-sy * mm);
    c.update();
}

function snap(name) {
    const v = VIEWS[name];
    if (!v) return;
    const t = ctrl().getTarget();
    // keep the focal point so a spot under inspection stays centered while the side changes
    const phi = (90 - v[1]) * DEG;
    space().view.panTo(t.x, t.y, t.z, v[0] * DEG, phi, 220);
}

/** FreeCAD-style home: isometric (front right top, azimuth 45, elevation 35.264) and fit the contents in view.
 *  Projection (perspective / ortho) stays as the user has it; Kiri's own View > home is not used. */
function home() {
    const iso = VIEWS.iso;
    space().view.fit(undefined, { left: iso[0] * DEG, up: (90 - iso[1]) * DEG, time: 300 });
}

function setProjection(ortho) {
    const conf = api.conf.get();
    if (conf && conf.controller) conf.controller.ortho = ortho;
    if (api.ui && api.ui.ortho) api.ui.ortho.checked = ortho;
    space().view.setProjection(ortho ? 'orthographic' : 'perspective');
    try { api.conf.save() } catch (e) { }
    lastSig = '';
}

function mult(ev) {
    return ev && ev.shiftKey ? 0.1 : ev && ev.ctrlKey ? 10 : 1;
}

function effStep(base, ev) {
    return clamp(base * mult(ev), MIN_STEP, MAX_STEP * 10);
}

/** run one named action; `ev` carries Shift / Ctrl */
function act(name, ev) {
    const a = effStep(step, ev), d = effStep(dstep, ev);
    switch (name) {
        case 'orbit-left':  orbit(a, 0); break;
        case 'orbit-right': orbit(-a, 0); break;
        case 'orbit-up':    orbit(0, -a); break;
        case 'orbit-down':  orbit(0, a); break;
        case 'pan-left':    pan(-1, 0, d); break;
        case 'pan-right':   pan(1, 0, d); break;
        case 'pan-up':      pan(0, 1, d); break;
        case 'pan-down':    pan(0, -1, d); break;
        case 'zoom-in':     dolly(-d); break;
        case 'zoom-out':    dolly(d); break;
        case 'fit':         space().view.fit(); break;
        case 'home':        home(); break;
        case 'proj':        setProjection(!space().view.getProjection().startsWith('o')); break;
    }
}

/** button with press-and-hold repeat */
function holdable(btn, fn) {
    let delay, timer;
    const stop = () => {
        clearTimeout(delay);
        clearInterval(timer);
        delay = timer = undefined;
    };
    btn.addEventListener('pointerdown', ev => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        root.focus({ preventScroll: true });
        stop();
        const mods = { shiftKey: ev.shiftKey, ctrlKey: ev.ctrlKey };
        try { btn.setPointerCapture(ev.pointerId) } catch (e) { }
        fn(mods);
        delay = setTimeout(() => { timer = setInterval(() => fn(mods), HOLD_EVERY) }, HOLD_DELAY);
    });
    for (const n of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        btn.addEventListener(n, stop);
    }
    // keyboard activation (Enter / Space on a focused button) arrives as click with detail 0
    btn.addEventListener('click', ev => { if (ev.detail === 0) fn(ev) });
}

function fmt(v, n) {
    return (Math.abs(v) < 0.5 * Math.pow(10, -n) ? 0 : v).toFixed(n);
}

function fillPresets(sel, list, unit) {
    sel.innerHTML = '';
    const custom = document.createElement('option');
    custom.value = '';
    custom.textContent = 'custom';
    sel.appendChild(custom);
    for (const p of list) {
        const o = document.createElement('option');
        o.value = String(p);
        o.textContent = `${p} ${unit}`;
        sel.appendChild(o);
    }
}

function syncPreset(sel, v) {
    const hit = [...sel.options].find(o => o.value !== '' && parseFloat(o.value) === v);
    sel.value = hit ? hit.value : '';
}

/** typed value in a step box */
function bindStep(input, sel, key, get, set, lo, hi) {
    const apply = () => {
        const v = parseFloat(input.value);
        if (!Number.isFinite(v) || v <= 0) {
            input.value = String(get());
            input.classList.remove('bad');
            return;
        }
        const c = clamp(v, lo, hi);
        set(c);
        input.value = String(c);
        input.classList.remove('bad');
        syncPreset(sel, c);
        local.set(key, String(c));
    };
    input.addEventListener('change', apply);
    input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        input.classList.toggle('bad', !(v >= lo && v <= hi));
        if (v >= lo && v <= hi) { set(v); syncPreset(sel, v); }
    });
    sel.addEventListener('change', () => {
        if (sel.value === '') return;
        const v = parseFloat(sel.value);
        set(v);
        input.value = String(v);
        input.classList.remove('bad');
        local.set(key, String(v));
    });
}

/** typed camera readout: Enter or leaving the box applies it, Escape restores */
function bindReadout(input, apply) {
    input.addEventListener('change', () => {
        const v = parseFloat(input.value);
        if (Number.isFinite(v)) apply(v);
        input.classList.remove('bad');
        lastSig = '';
    });
    input.addEventListener('keydown', ev => {
        ev.stopPropagation();
        if (ev.key === 'Escape') { lastSig = ''; input.blur(); }
        else if (ev.key === 'Enter') { input.blur(); }
    });
    input.addEventListener('keyup', ev => ev.stopPropagation());
    input.addEventListener('keypress', ev => ev.stopPropagation());
}

function key(ev) {
    const t = ev.target;
    if (t && (t.nodeName === 'INPUT' || t.nodeName === 'SELECT' || t.nodeName === 'TEXTAREA')) return;
    let name;
    const alt = ev.altKey;
    switch (ev.key) {
        case 'ArrowLeft':  name = alt ? 'pan-left' : 'orbit-left'; break;
        case 'ArrowRight': name = alt ? 'pan-right' : 'orbit-right'; break;
        case 'ArrowUp':    name = alt ? 'pan-up' : 'orbit-up'; break;
        case 'ArrowDown':  name = alt ? 'pan-down' : 'orbit-down'; break;
        case 'PageUp':
        case '+':
        case '=':          name = 'zoom-in'; break;
        case 'PageDown':
        case '-':
        case '_':          name = 'zoom-out'; break;
        default: return;
    }
    // handled here: keep the arrow keys from rotating the selected object
    ev.preventDefault();
    ev.stopPropagation();
    act(name, ev);
}

function isNarrow() {
    return window.innerWidth < NARROW;
}

/** collapsed? the choice is saved separately for narrow windows (default there: collapsed to a small button) */
function isMin() {
    if (window.innerWidth < W_FULL + 24) return true; // cannot fit expanded
    const v = local.get(isNarrow() ? '-min-narrow' : '-min');
    return isNarrow() ? v !== 'off' : v === 'on';
}

function applyMin() {
    const min = isMin();
    root.classList.toggle('vn-min', min);
    root.classList.toggle('vn-tiny', min && isNarrow());
    document.getElementById('vn-fold-ico').textContent = min ? '\u25B8' : '\u25BE';
}

function toggleMin() {
    local.set(isNarrow() ? '-min-narrow' : '-min', isMin() ? 'off' : 'on');
    place();
}

/** the job info box, when it is on screen */
function jobRect() {
    const j = document.getElementById('job-info');
    if (!j || getComputedStyle(j).display === 'none') return null;
    const r = j.getBoundingClientRect();
    return r.width > 0 ? r : null;
}

/** keep the whole box inside the window and clear of the layer slider band (same rule as the job info box) */
function clampPos(x, y, w, h) {
    return [
        Math.min(Math.max(0, x), Math.max(0, window.innerWidth - w)),
        Math.min(Math.max(0, y), Math.max(0, window.innerHeight - h - SLIDER_BAND))
    ];
}

function hits(x, y, w, h, J) {
    return x < J.right && x + w > J.left && y < J.bottom && y + h > J.top;
}

/** the job info box is never covered: if the navigator lands on it, move the navigator to the nearest free side */
function resolve(x, y, w, h, J) {
    if (!J || !hits(x, y, w, h, J)) return [x, y];
    const cands = [
        [x, J.top - h - GAP], [x, J.bottom + GAP],
        [J.left - w - GAP, y], [J.right + GAP, y]
    ].map(c => clampPos(c[0], c[1], w, h));
    let best, bd = Infinity;
    for (const c of cands) {
        if (hits(c[0], c[1], w, h, J)) continue;
        const d = Math.abs(c[0] - x) + Math.abs(c[1] - y);
        if (d < bd) { bd = d; best = c; }
    }
    return best || cands[0];
}

function savedPos() {
    const raw = local.get('-pos');
    if (!raw) return null;
    const p = String(raw).split(',').map(parseFloat);
    return p.length === 2 && p.every(Number.isFinite) ? p : null;
}

/** default spot: stacked directly above the job info box (right edges aligned), else under the toolbar at the top right */
function defaultPos(w, h, J) {
    if (J) return [J.right - w, Math.max(45 + GAP, J.top - h - GAP)];
    let top = 45;
    const bar = document.getElementById('mode-tools');
    if (bar) for (const k of bar.children) if (k.offsetHeight > 0) top = Math.max(top, k.getBoundingClientRect().bottom);
    // stay left of the right panel and of the speed legend that appears beside it in previews
    let right = 16;
    for (const id of ['panel-right', 'speedbar']) {
        const e = document.getElementById(id);
        if (!e || getComputedStyle(e).display === 'none') continue;
        const r = e.getBoundingClientRect();
        if (r.width > 0 && r.left < window.innerWidth) right = Math.max(right, window.innerWidth - r.left + 16);
    }
    return [window.innerWidth - right - w, top + GAP];
}

/** position: the dragged spot if the user moved it, else above the job info box (following it) */
function place() {
    if (!root || root.style.display === 'none') return;
    applyMin();
    root.style.right = 'auto';
    root.style.maxHeight = Math.max(80, window.innerHeight - 45 - SLIDER_BAND) + 'px';
    const w = root.offsetWidth, h = root.offsetHeight;
    const J = jobRect();
    const tiny = root.classList.contains('vn-tiny');
    const sp = tiny ? null : savedPos();
    let [x, y] = sp || defaultPos(w, h, J);
    [x, y] = clampPos(x, y, w, h);
    [x, y] = resolve(x, y, w, h, J);
    root.style.left = x + 'px';
    root.style.top = y + 'px';
}

/** grip / title bar: drag to move (saved), double-click to collapse, double-click the grip for the default spot */
function bindBar() {
    const bar = document.getElementById('vn-bar');
    const fold = document.getElementById('vn-fold');
    const grip = document.getElementById('vn-grip');
    fold.addEventListener('pointerdown', ev => ev.stopPropagation());
    fold.addEventListener('dblclick', ev => ev.stopPropagation());
    fold.addEventListener('click', ev => { ev.stopPropagation(); toggleMin() });
    bar.addEventListener('dblclick', toggleMin);
    grip.addEventListener('dblclick', ev => {
        ev.stopPropagation();
        local.set('-pos', '');
        place();
    });
    bar.addEventListener('pointerdown', ev => {
        if (ev.button !== 0 || root.classList.contains('vn-tiny')) return;
        const dx = ev.clientX - root.offsetLeft, dy = ev.clientY - root.offsetTop;
        const w = root.offsetWidth, h = root.offsetHeight;
        try { bar.setPointerCapture(ev.pointerId) } catch (e) { }
        bar.onpointermove = mv => {
            const [x, y] = clampPos(mv.clientX - dx, mv.clientY - dy, w, h);
            root.style.left = x + 'px';
            root.style.top = y + 'px';
        };
        bar.onpointerup = bar.onpointercancel = up => {
            bar.onpointermove = bar.onpointerup = bar.onpointercancel = null;
            try { bar.releasePointerCapture(up.pointerId) } catch (e) { }
            // dropped on the job info box: nudge to the nearest free side, then remember it
            let [x, y] = clampPos(root.offsetLeft, root.offsetTop, w, h);
            [x, y] = resolve(x, y, w, h, jobRect());
            root.style.left = x + 'px';
            root.style.top = y + 'px';
            local.set('-pos', Math.round(x) + ',' + Math.round(y));
        };
        ev.preventDefault();
    });
}

function setIcon(on) {
    const el = document.getElementById('view-navigator');
    const i = el && el.querySelector('i');
    if (i) i.className = on ? 'fas fa-eye' : 'fas fa-eye-slash';
}

/** follow the camera: cube, boxes, projection label */
function tick() {
    requestAnimationFrame(tick);
    if (!root || root.style.display === 'none' || !space().internals().camera) return;
    // follow the job info box when it moves, appears or is resized
    const j = document.getElementById('job-info');
    const js = j ? [j.style.display, j.offsetLeft, j.offsetTop, j.offsetWidth, j.offsetHeight].join() : '';
    if (js !== lastJob || ++frame % 30 === 0) { lastJob = js; place(); }
    let r;
    try { r = read() } catch (e) { return }
    const sig = [r.theta, r.phi, r.dist, r.ortho].join('|');
    if (sig === lastSig) return;
    lastSig = sig;
    cube.style.transform = `rotateX(${-r.el}deg) rotateY(${-r.az}deg)`;
    const act = document.activeElement;
    if (act !== ui.az) ui.az.value = fmt(r.az, 3);
    if (act !== ui.el) ui.el.value = fmt(r.el, 3);
    if (act !== ui.dist) ui.dist.value = fmt(r.dist, 2);
    ui.proj.textContent = r.ortho ? 'ortho' : 'persp';
    ui.proj.classList.toggle('on', r.ortho);
}

function build() {
    root = document.getElementById('view-nav');
    body = document.getElementById('vn-body');
    cube = document.getElementById('vn-cube');
    for (const id of ['proj', 'step', 'stepPre', 'dstep', 'dstepPre', 'az', 'el', 'dist']) {
        ui[id] = (api.ui && api.ui.nav && api.ui.nav[id]) || document.getElementById('vn-' + id.replace(/[A-Z]/g, c => '-' + c.toLowerCase()));
    }
    step = clamp(parseFloat(local.get('-step')) || 1, MIN_STEP, MAX_STEP);
    dstep = clamp(parseFloat(local.get('-dstep')) || 5, MIN_STEP, 1e6);

    fillPresets(ui.stepPre, ANGLE_PRESETS, '°');
    fillPresets(ui.dstepPre, MOVE_PRESETS, 'mm');
    ui.step.value = String(step);
    ui.dstep.value = String(dstep);
    syncPreset(ui.stepPre, step);
    syncPreset(ui.dstepPre, dstep);
    bindStep(ui.step, ui.stepPre, '-step', () => step, v => { step = v }, MIN_STEP, MAX_STEP);
    bindStep(ui.dstep, ui.dstepPre, '-dstep', () => dstep, v => { dstep = v }, MIN_STEP, 1e6);
    for (const i of [ui.step, ui.dstep]) {
        i.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter' || ev.key === 'Escape') i.blur() });
        i.addEventListener('keyup', ev => ev.stopPropagation());
        i.addEventListener('keypress', ev => ev.stopPropagation());
    }

    bindReadout(ui.az, v => { const r = read(); setAngles(v * DEG, r.phi) });
    bindReadout(ui.el, v => { const r = read(); setAngles(r.theta, (90 - clamp(v, -90, 90)) * DEG) });
    bindReadout(ui.dist, v => { if (v > 0) { const r = read(); ctrl().setPosition({ scale: v / r.dist }) } });

    for (const b of root.querySelectorAll('[data-act]')) {
        const name = b.dataset.act;
        if (name === 'proj' || name === 'fit' || name === 'home') {
            b.addEventListener('click', ev => { act(name, ev) });
        } else {
            holdable(b, mods => act(name, mods));
        }
    }
    for (const b of root.querySelectorAll('[data-view]')) {
        b.addEventListener('click', ev => { root.focus({ preventScroll: true }); snap(b.dataset.view) });
    }
    bindBar();
    root.addEventListener('keydown', key);
    // keep the camera controls from seeing wheel / pointer events meant for this box
    root.addEventListener('wheel', ev => ev.stopPropagation(), { passive: true });
    window.addEventListener('resize', place);
    const pr = document.getElementById('panel-right');
    if (pr && window.ResizeObserver) new ResizeObserver(place).observe(pr);
}

export const viewnav = {
    init() {
        if (inited) return;
        inited = true;
        build();
        setIcon(enabled());
        const item = document.getElementById('view-navigator');
        if (item) item.onclick = viewnav.toggle;
        root.style.display = enabled() ? 'block' : 'none';
        place();
        requestAnimationFrame(tick);
        // exposed for tests and scripts
        api.viewnav = { read, act, snap, setProjection, step: () => step, dstep: () => dstep, MIN_STEP };
    },
    toggle() {
        const on = !enabled();
        local.set('', on ? 'on' : 'off');
        setIcon(on);
        root.style.display = on ? 'block' : 'none';
        lastSig = '';
        place();
    }
};
