/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const Z_BACK = 1e-4;
const WORD = /([A-Za-z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))?/g;

export function checkBeltGcode(text, opts = {}) {
    const failures = [];
    const pos = { x: 0, y: 0, z: 0, e: 0 };
    const off = { x: 0, y: 0, z: 0, e: 0 };
    let absXYZ = true;
    let absE = true;
    let eModeSet = false;
    let motion = null;
    let inBody = false;
    let layers = 0;
    let machineZ = 0;
    let zMin = null;
    let zMax = null;
    let xMin = null;
    let xMax = null;
    let yMin = null;

    function fail(line, message) {
        failures.push({ line, message });
    }

    function noteZ(z) {
        if (zMin === null || z < zMin) zMin = z;
        if (zMax === null || z > zMax) zMax = z;
    }

    function noteXY(x, y) {
        if (xMin === null || x < xMin) xMin = x;
        if (xMax === null || x > xMax) xMax = x;
        if (yMin === null || y < yMin) yMin = y;
    }

    // machine position stays put; logical position becomes the G92 value
    function applyG92(axes) {
        for (const letter of ['X', 'Y', 'Z', 'E']) {
            if (axes[letter] === undefined || axes[letter].value === undefined) continue;
            const key = letter.toLowerCase();
            const machine = pos[key] + off[key];
            pos[key] = axes[letter].value;
            off[key] = machine - pos[key];
        }
        machineZ = pos.z + off.z;
    }

    function applyG28(axes) {
        const named = ['X', 'Y', 'Z', 'E'].filter(letter => axes[letter]);
        const keys = named.length ? named : ['X', 'Y', 'Z'];
        for (const letter of keys) {
            const key = letter.toLowerCase();
            pos[key] = 0;
            off[key] = 0;
        }
        machineZ = pos.z + off.z;
    }

    function applyMove(axes) {
        if (axes.X && axes.X.value !== undefined) {
            pos.x = absXYZ ? axes.X.value : pos.x + axes.X.value;
        }
        if (axes.Y && axes.Y.value !== undefined) {
            pos.y = absXYZ ? axes.Y.value : pos.y + axes.Y.value;
        }
        if (axes.Z && axes.Z.value !== undefined) {
            pos.z = absXYZ ? axes.Z.value : pos.z + axes.Z.value;
        }
        if (axes.E && axes.E.value !== undefined) {
            pos.e = absE ? axes.E.value : pos.e + axes.E.value;
        }
    }

    const lines = String(text).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const lineNo = i + 1;
        const raw = lines[i];
        if (/^;; --- layer/.test(raw)) {
            layers++;
            inBody = true;
        }

        const code = stripComment(raw);
        if (!code) continue;

        const words = parseWords(code);
        const gcodes = [];
        let mcode = null;
        const axes = {};
        for (const word of words) {
            if (word.letter === 'G' && word.value !== undefined) {
                gcodes.push(Math.trunc(word.value));
            } else if (word.letter === 'M' && word.value !== undefined && mcode === null) {
                mcode = Math.trunc(word.value);
            } else if (word.letter === 'X' || word.letter === 'Y' || word.letter === 'Z' || word.letter === 'E') {
                axes[word.letter] = word;
            }
        }

        if (gcodes.includes(90)) {
            absXYZ = true;
            if (!eModeSet) absE = true;
        }
        if (gcodes.includes(91)) {
            absXYZ = false;
            if (!eModeSet) absE = false;
        }
        if (mcode === 82) {
            absE = true;
            eModeSet = true;
        } else if (mcode === 83) {
            absE = false;
            eModeSet = true;
        }

        if (gcodes.includes(92)) {
            applyG92(axes);
            continue;
        }
        if (gcodes.includes(28)) {
            const prevZ = machineZ;
            applyG28(axes);
            if (inBody && machineZ < prevZ - Z_BACK) {
                fail(lineNo, `belt Z reversed from ${fmt(prevZ)} to ${fmt(machineZ)}`);
            }
            if (inBody) noteZ(machineZ);
            continue;
        }

        let move = null;
        for (const code of [0, 1, 2, 3]) {
            if (gcodes.includes(code)) move = code;
        }
        if (move !== null) {
            motion = move;
        } else if (axes.X || axes.Y || axes.Z || axes.E) {
            move = motion;
        }
        if (move === null) continue;

        const prevE = pos.e;
        const eWord = axes.E && axes.E.value !== undefined ? axes.E.value : undefined;
        applyMove(axes);
        const nextZ = pos.z + off.z;

        if (!inBody) {
            machineZ = nextZ;
            continue;
        }

        if (move === 2 || move === 3) {
            fail(lineNo, `G${move} arc in belt print`);
        }
        if (nextZ < machineZ - Z_BACK) {
            fail(lineNo, `belt Z reversed from ${fmt(machineZ)} to ${fmt(nextZ)}`);
        }
        noteZ(nextZ);
        machineZ = nextZ;

        const extruding = move === 1 && (absE ? pos.e > prevE : eWord > 0);
        if (!extruding) continue;

        noteXY(pos.x, pos.y);
        if (opts.xmin !== undefined && pos.x < opts.xmin) {
            fail(lineNo, `X ${fmt(pos.x)} below xmin ${opts.xmin}`);
        }
        if (opts.xmax !== undefined && pos.x > opts.xmax) {
            fail(lineNo, `X ${fmt(pos.x)} above xmax ${opts.xmax}`);
        }
        if (opts.ymin !== undefined && pos.y < opts.ymin) {
            fail(lineNo, `Y ${fmt(pos.y)} below ymin ${opts.ymin}`);
        }
    }

    return {
        ok: failures.length === 0,
        failures,
        stats: { layers, zMin, zMax, xMin, xMax, yMin }
    };
}

function stripComment(line) {
    const cut = line.indexOf(';');
    return (cut >= 0 ? line.slice(0, cut) : line).trim();
}

function parseWords(code) {
    const words = [];
    WORD.lastIndex = 0;
    let match;
    while ((match = WORD.exec(code))) {
        words.push({
            letter: match[1].toUpperCase(),
            value: match[2] === undefined ? undefined : Number(match[2])
        });
    }
    return words;
}

function fmt(n) {
    return String(Math.round(n * 1e6) / 1e6);
}

function lineCount(text) {
    const parts = String(text).split(/\r?\n/);
    if (parts.length && parts[parts.length - 1] === '') parts.pop();
    return parts.length;
}

function printReport(text, result) {
    const { stats, failures } = result;
    const z = stats.zMin === null ? 'n/a' : `${fmt(stats.zMin)} .. ${fmt(stats.zMax)}`;
    const x = stats.xMin === null ? 'n/a' : `${fmt(stats.xMin)} .. ${fmt(stats.xMax)}`;
    const y = stats.yMin === null ? 'n/a' : fmt(stats.yMin);
    console.log(`lines: ${lineCount(text)}`);
    console.log(`layers: ${stats.layers}`);
    console.log(`belt Z: ${z}`);
    console.log(`extrusion Y min: ${y}`);
    console.log(`extrusion X: ${x}`);
    if (!failures.length) {
        console.log('ok');
        return;
    }
    for (const failure of failures) {
        console.log(`FAIL ${failure.line}: ${failure.message}`);
    }
}

function parseCli(argv) {
    const opts = {};
    let file = null;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--xmin' || arg === '--xmax' || arg === '--ymin') {
            const value = Number(argv[++i]);
            if (!Number.isFinite(value)) {
                return { error: `missing number for ${arg}` };
            }
            opts[arg.slice(2)] = value;
        } else if (!arg.startsWith('-') && file === null) {
            file = arg;
        } else {
            return { error: `unexpected argument ${arg}` };
        }
    }
    if (!file) return { error: 'missing gcode file' };
    return { file, opts };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const parsed = parseCli(process.argv.slice(2));
    if (parsed.error) {
        console.error(parsed.error);
        console.error('usage: node bin/belt-gcode-check.mjs <file.gcode> [--xmin N] [--xmax N] [--ymin N]');
        process.exit(1);
    }
    let text;
    try {
        text = readFileSync(parsed.file, 'utf8');
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
    const result = checkBeltGcode(text, parsed.opts);
    printReport(text, result);
    process.exit(result.ok ? 0 : 1);
}
