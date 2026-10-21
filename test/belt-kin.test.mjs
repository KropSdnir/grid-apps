import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    beltAngle,
    beltConstants,
    sliceToMachine,
    machineToWorld
} from '../src/kiri/core/belt-kin.js';

const EPS = 1e-9;
const ANGLES = [30, 44, 45, 46, 60];

test('beltAngle defaults and bounds', () => {
    assert.equal(beltAngle(undefined), 45);
    assert.equal(beltAngle({}), 45);
    assert.equal(beltAngle({ bedBeltAngle: 0 }), 45);
    assert.equal(beltAngle({ bedBeltAngle: 90 }), 45);
    assert.equal(beltAngle({ bedBeltAngle: NaN }), 45);
    assert.equal(beltAngle({ bedBeltAngle: "abc" }), 45);
    assert.equal(beltAngle({ bedBeltAngle: 30 }), 30);
    assert.equal(beltAngle({ bedBeltAngle: "44.5" }), 44.5);
});

test('beltConstants(45)', () => {
    let k = beltConstants(45);
    assert.ok(Math.abs(k.slope - 1) < EPS);
    assert.ok(Math.abs(k.zScale - Math.SQRT2) < EPS);
    assert.ok(Math.abs(k.cosf - Math.SQRT1_2) < EPS);
    assert.ok(Math.abs(k.sinf - Math.SQRT1_2) < EPS);
});

test('legacy parity at 45 degrees', () => {
    let k = beltConstants(45);
    let bcos = Math.cos(Math.PI / 4);
    let icos = 1 / bcos;
    let ys = [-10, -1, -0.5, 0, 0.25, 1, 3.5, 12];
    let zs = [-5, -0.1, 0, 0.2, 1, 2.5, 10];
    let samples = [];
    for (let y of ys) {
        for (let z of zs) {
            samples.push([y, z]);
        }
    }
    assert.ok(samples.length >= 20);
    for (let [y, z] of samples) {
        let m = sliceToMachine(y, z, k);
        let Z = z * icos;
        let Y = -y + Z * bcos;
        assert.ok(Math.abs(m.z - Z) < EPS, `z mismatch at (${y}, ${z})`);
        assert.ok(Math.abs(m.y - Y) < EPS, `y mismatch at (${y}, ${z})`);
    }
});

test('round trip through slicer and machine frames', () => {
    let points = [
        [0, 0],
        [1, 0],
        [0, 1],
        [-3, 0],
        [5, 2],
        [-4, 7],
        [10, 0.01],
        [-0.5, 12]
    ];
    for (let theta of ANGLES) {
        let k = beltConstants(theta);
        for (let [y, z] of points) {
            let yp = y * k.cosf - z * k.sinf;
            let zp = y * k.sinf + z * k.cosf;
            let m = sliceToMachine(yp, zp, k);
            let w = machineToWorld(m.y, m.z, k);
            assert.ok(Math.abs(w.y - y) < EPS, `y theta=${theta} (${y}, ${z})`);
            assert.ok(Math.abs(w.z - z) < EPS, `z theta=${theta} (${y}, ${z})`);
        }
    }
});

test('belt contact maps to machine Y of zero', () => {
    let ys = [-8, -1, 0, 2, 15];
    for (let theta of ANGLES) {
        let k = beltConstants(theta);
        for (let y of ys) {
            let yp = y * k.cosf;
            let zp = y * k.sinf;
            let m = sliceToMachine(yp, zp, k);
            assert.ok(Math.abs(m.y) < EPS, `Ym theta=${theta} y=${y} got ${m.y}`);
        }
    }
});

test('monotonic belt axis', () => {
    let yps = [-10, -1, 0, 3, 20];
    for (let theta of ANGLES) {
        let k = beltConstants(theta);
        for (let yp of yps) {
            let prev = -Infinity;
            for (let zp = -5; zp <= 20; zp += 0.5) {
                let m = sliceToMachine(yp, zp, k);
                assert.ok(m.z > prev, `theta=${theta} yp=${yp} zp=${zp}`);
                prev = m.z;
            }
        }
    }
});
