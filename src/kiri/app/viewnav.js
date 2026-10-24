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
const NARROW = 700; // below this width the overlay is a small button
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
let transientOpen = false, forcedMin = false, lastSig = '', frame = 0;

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
        case 'home':        space().view.home(); break;
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

/** the expanded box would land on top of the job info box */
function crowded(left, top, h) {
    const j = document.getElementById('job-info');
    if (!j || j.style.display === 'none') return false;
    const r = j.getBoundingClientRect();
    return r.width > 0 && left < r.right + 8 && top < r.bottom && top + h > r.top;
}

function isMin() {
    return forcedMin ? !transientOpen : local.get('-min') === 'on';
}

/** top: under the toolbar; right: left of the right panel; 16px margins */
function place() {
    if (!root || root.style.display === 'none') return;
    const bar = document.getElementById('mode-tools');
    let top = 45;
    if (bar) {
        const kids = [...bar.children].filter(k => k.offsetHeight > 0);
        for (const k of kids) top = Math.max(top, k.getBoundingClientRect().bottom);
    }
    top += 8;
    // stay left of the right panel and of the speed legend that appears beside it in previews
    let right = 16;
    for (const id of ['panel-right', 'speedbar']) {
        const e = document.getElementById(id);
        if (!e || getComputedStyle(e).display === 'none') continue;
        const r = e.getBoundingClientRect();
        if (r.width > 0 && r.left < window.innerWidth) right = Math.max(right, window.innerWidth - r.left + 16);
    }
    root.style.top = top + 'px';
    root.style.right = right + 'px';
    root.style.maxHeight = Math.max(80, window.innerHeight - top - 60) + 'px';
    const width = 248, left = window.innerWidth - right - width;
    const was = forcedMin;
    forcedMin = isNarrow() || crowded(left, top, root.classList.contains('vn-min') ? 260 : root.offsetHeight);
    if (forcedMin !== was) transientOpen = false;
    applyMin();
    // collapsed button on a very narrow window: step below the job info box instead of covering it
    if (root.classList.contains('vn-min')) {
        const j = document.getElementById('job-info');
        if (j && j.style.display !== 'none') {
            const jr = j.getBoundingClientRect(), nr = root.getBoundingClientRect();
            if (jr.width > 0 && nr.left < jr.right + 8 && nr.right > jr.left && top < jr.bottom + 8 && top + nr.height > jr.top) {
                root.style.top = (jr.bottom + 8) + 'px';
            }
        }
    }
}

function applyMin() {
    const min = isMin();
    root.classList.toggle('vn-min', min);
    document.getElementById('vn-fold-ico').textContent = min ? '▶' : '▼';
    document.getElementById('vn-fold-txt').textContent = min ? 'view' : 'view navigator';
}

function toggleMin() {
    if (forcedMin) {
        transientOpen = !transientOpen;
    } else {
        local.set('-min', isMin() ? 'off' : 'on');
    }
    applyMin();
    place();
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
    if (++frame % 30 === 0) place();
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
    document.getElementById('vn-fold').addEventListener('click', toggleMin);
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
