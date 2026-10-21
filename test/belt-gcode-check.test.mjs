import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBeltGcode } from '../bin/belt-gcode-check.mjs';

function gcode(lines) {
    return lines.join('\n');
}

test('clean belt body passes', () => {
    const text = gcode([
        'G90',
        'M82',
        'G28',
        ';; --- layer 0 ---',
        'G1 X10 Y5 Z0.2 E0.05 F1200',
        'G1 X20 Y5 Z0.2 E0.10',
        ';; --- layer 1 ---',
        'G1 X10 Y6 Z0.4 E0.15',
        'G1 X20 Y6 Z0.4 E0.20'
    ]);
    const result = checkBeltGcode(text);
    assert.equal(result.ok, true);
    assert.deepEqual(result.failures, []);
    assert.equal(result.stats.layers, 2);
    assert.ok(Math.abs(result.stats.zMin - 0.2) < 1e-9);
    assert.ok(Math.abs(result.stats.zMax - 0.4) < 1e-9);
    assert.equal(result.stats.xMin, 10);
    assert.equal(result.stats.xMax, 20);
    assert.equal(result.stats.yMin, 5);
});

test('belt Z reversal reports the move line', () => {
    const text = gcode([
        'G90',
        ';; --- layer 0 ---',
        'G1 Z1',
        'G1 Z2',
        'G1 Z1.5'
    ]);
    const result = checkBeltGcode(text);
    assert.equal(result.ok, false);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].line, 5);
    assert.match(result.failures[0].message, /belt Z reversed/);
});

test('G2 in the body fails and a preamble arc does not', () => {
    const bad = gcode([
        ';; --- layer 0 ---',
        'G1 X10 Y10 Z0.2 E0.1',
        'G2 X12 Y10 I1 J0 Z0.4 E0.2'
    ]);
    const badResult = checkBeltGcode(bad);
    assert.equal(badResult.ok, false);
    assert.equal(badResult.failures[0].line, 3);
    assert.match(badResult.failures[0].message, /G2 arc/);

    const preamble = gcode([
        'G2 X1 Y1 I1 J0',
        ';; --- layer 0 ---',
        'G1 X2 Y2 Z0.2 E0.1'
    ]);
    assert.equal(checkBeltGcode(preamble).ok, true);
});

test('M808 G92 loop start is not a belt reversal', () => {
    const current = gcode([
        'G90',
        'M82',
        ';; --- layer 0 ---',
        'G1 X10 Y4 Z8 E0.2',
        'M808 L2',
        'G92 Z8',
        ';; --- layer 1 ---',
        'G1 X10 Y4 Z8.2 E0.4',
        'G1 X12 Y4 Z8.4 E0.6',
        'M808'
    ]);
    const same = checkBeltGcode(current);
    assert.equal(same.ok, true, JSON.stringify(same.failures));
    assert.ok(same.stats.zMax >= 8.4 - 1e-9);

    const reset = gcode([
        'G90',
        'M82',
        ';; --- layer 0 ---',
        'G1 X15 Y4 Z12 E0.2',
        'M808 L2',
        'G92 Z0',
        ';; --- layer 1 ---',
        'G1 X15 Y4 Z0.2 E0.4',
        'G1 X18 Y4 Z0.4 E0.6',
        'M808'
    ]);
    const rewound = checkBeltGcode(reset);
    assert.equal(rewound.ok, true, JSON.stringify(rewound.failures));
    assert.ok(rewound.stats.zMax > 12);
});

test('relative Z moves', () => {
    const forward = gcode([
        'G91',
        ';; --- layer 0 ---',
        'G1 Z0.2',
        'G1 Z0.2 E0.05'
    ]);
    const ok = checkBeltGcode(forward);
    assert.equal(ok.ok, true, JSON.stringify(ok.failures));
    assert.ok(Math.abs(ok.stats.zMax - 0.4) < 1e-9);

    const backward = gcode([
        'G90',
        ';; --- layer 0 ---',
        'G1 Z1',
        'G91',
        'G1 Z-0.2'
    ]);
    const bad = checkBeltGcode(backward);
    assert.equal(bad.ok, false);
    assert.equal(bad.failures[0].line, 5);
    assert.match(bad.failures[0].message, /belt Z reversed/);
});

test('moves before the first layer marker are ignored', () => {
    const text = gcode([
        'G90',
        'G1 Z0.3 F3000',
        'G92 Z0',
        ';; --- layer 0 ---',
        'G1 X10 Y2 Z0.2 E0.05',
        'G1 X20 Y2 Z0.4 E0.10'
    ]);
    const result = checkBeltGcode(text);
    assert.equal(result.ok, true, JSON.stringify(result.failures));
    assert.equal(result.stats.layers, 1);
    assert.ok(result.stats.zMin >= 0.2 - 1e-9);
});

test('X and Y bounds apply only when options are given', () => {
    const text = gcode([
        ';; --- layer 0 ---',
        'G1 X-5 Y-2 Z0.2 E0.1',
        'G1 X300 Y1 Z0.4 E0.2'
    ]);
    assert.equal(checkBeltGcode(text).ok, true);

    const xLow = checkBeltGcode(text, { xmin: 0 });
    assert.equal(xLow.ok, false);
    assert.equal(xLow.failures[0].line, 2);
    assert.match(xLow.failures[0].message, /xmin/);

    const xHigh = checkBeltGcode(text, { xmax: 220 });
    assert.equal(xHigh.ok, false);
    assert.ok(xHigh.failures.some(f => f.line === 3 && /xmax/.test(f.message)));

    const yLow = checkBeltGcode(text, { ymin: 0 });
    assert.equal(yLow.ok, false);
    assert.equal(yLow.failures[0].line, 2);
    assert.match(yLow.failures[0].message, /ymin/);

    const inside = gcode([
        ';; --- layer 0 ---',
        'G1 X10 Y2 Z0.2 E0.1',
        'G1 X20 Y3 Z0.4 E0.2'
    ]);
    assert.equal(checkBeltGcode(inside, { xmin: 0, xmax: 220, ymin: 0 }).ok, true);
});
