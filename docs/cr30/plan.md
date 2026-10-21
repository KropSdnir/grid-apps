# CR-30 / belt printer implementation plan

Branch: `cr30/phase0-belt-correctness` (from `master`).

Goal: make Kiri:Moto the best slicer for the Creality CR-30 (45 degree belt printer).
Phases 1-5 are a roadmap; **Phase 0 is fully specified below and is the only phase to
execute now.**

---

## Belt geometry reference (read before touching belt code)

Kiri rotates the model by the belt angle θ about X (in `worker.js` `rotate()`), slices
flat layers at constant slicer `z'`, then maps to the machine at export.

- Model frame: `x` across belt, `y` along belt (platform Y), `z` up from the belt.
- Slicer frame (after rotation by θ about X):
  `y' = y·cosθ − z·sinθ`, `z' = y·sinθ + z·cosθ`.
  The belt plane is `y' = z'·cotθ` (`belt.slope = tan(90°−θ) = cotθ`).
- Machine frame (exact for any θ):
  - belt axis `Zm = z' / sinθ`
  - gantry axis `Ym = −y' + z'·cotθ` (= distance from the belt; `Ym = 0` on the belt)
  - inverse (G-code preview): `y = Zm − Ym·cosθ`, `z = Ym·sinθ`
- At θ = 45° `cosθ = sinθ`, which is why the current export (`icos = 1/cos(π/4)`) works
  only at 45°. The general factor is `1/sinθ`.
- The belt (machine Z) must only ever move forward. Any reversal takes up belt and roller
  slack and shows up as layer misregistration.

---

## Roadmap (not in scope for Phase 0)

- **Phase 1, profile and UX:** a v2 CR-30 profile (prime strip replaces purge lines,
  correct `bed_width`, `z_move_max`, eject move, PLA/PETG/TPU, current keys only),
  a dedicated Belt settings group, `{belt_length}` G-code token, "end caps" relabel of
  top/bottom layers in belt mode.
- **Phase 2, belt-aware geometry:** orientation advisor and auto-orient, skin thickness
  in mm, belt-contact elephant-foot inset, rear seam policy, min-layer-time park mode,
  fan ramp by distance from the belt, long-part warnings, gravity-aware overhangs.
- **Phase 3, production:** batch builder (copies along and across the belt), M808 loop
  gap and per-copy prime options, mixed queue, eject.
- **Phase 4, calibration:** belt gap (Y offset), belt length scale (Z steps), gantry
  angle (uses Phase 0 device angle), belt X drift, flow/temperature bars.
- **Phase 5, preview:** machine-frame preview with contact highlighting, heated zone,
  belt-axis feedrate-aware time estimates.

---

## Phase 0: belt correctness (EXECUTE)

### Ground rules for the executing agent

1. Work on branch `cr30/phase0-belt-correctness`. Do not create other branches, do not
   push, do not open PRs.
2. **Never stage pre-existing modifications.** The working tree already contains
   unrelated changes (`src/ext/*`, `src/gpu/*`, `src/wasm/manifold.wasm`, deleted
   `web/fon2` and `web/font`, several `web/kiri/lang/*.js`). Never run `git add -A`,
   `git add .`, `git commit -a`, `git stash`, `git checkout -- <file>` or `git restore`.
   Stage only files you changed for the task, by explicit path.
3. **Language strings.** `src/kiri/app/lang-en.js` is a git symlink to
   `web/kiri/lang/en.js`, but on this Windows checkout it is a plain copy. Add new English
   strings to `web/kiri/lang/en.js` (this is the file you commit) and make the identical
   edit in `src/kiri/app/lang-en.js` so local builds see it. **Never stage
   `src/kiri/app/lang-en.js`.** Do not edit other languages; missing keys fall back to
   English.
4. Shell is Windows PowerShell. Run commands separately instead of chaining with `&&`.
5. Match the surrounding code style: 4-space indent, `let`/`const` as the file uses,
   no new dependencies, no reformatting of untouched lines. Only add a code comment when
   it states a constraint the code cannot show; never narrate changes in comments.
6. Line numbers below are approximate. Locate code by the quoted snippets.
7. After each task: run the verification commands, then commit with the given message.
   If verification fails, fix it before committing. If a task cannot be completed as
   specified, stop and report why instead of improvising a different design.

### Verification commands (used by every task)

```powershell
node --test "test/*.test.mjs"
node bin/esbuild.config.mjs
```

`node bin/esbuild.config.mjs` builds the bundles into `src/pack/` (gitignored) and fails
on syntax/import errors. Both must succeed.

---

### P0-1: pure belt kinematics module + tests

**Create `src/kiri/core/belt-kin.js`** (no imports, pure functions):

```js
/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

export const BELT_ANGLE_DEFAULT = 45;

export function beltAngle(device) {
    let angle = parseFloat(device?.bedBeltAngle);
    return angle >= 10 && angle <= 80 ? angle : BELT_ANGLE_DEFAULT;
}

export function beltConstants(angle = BELT_ANGLE_DEFAULT) {
    let rad = angle * Math.PI / 180;
    let cosf = Math.cos(rad);
    let sinf = Math.sin(rad);
    return {
        angle,
        rad,
        cosf,
        sinf,
        slope: Math.tan((90 - angle) * Math.PI / 180),
        zScale: 1 / sinf
    };
}

// slicer frame (y', z') to machine gantry Y and belt Z, before X mirroring and Y offsets
export function sliceToMachine(y, z, k) {
    let mz = z * k.zScale;
    return { y: -y + mz * k.cosf, z: mz };
}

// machine gantry Y and belt Z back to the unrotated model frame (y along belt, z up)
export function machineToWorld(ym, zm, k) {
    return { y: zm - ym * k.cosf, z: ym * k.sinf };
}
```

Keep `slope` computed with `Math.tan((90 - angle) ...)` exactly like `worker.js` does today
so slicing values do not change by even one ulp.

**Create `test/belt-kin.test.mjs`** using `node:test` and `node:assert/strict`, importing
`../src/kiri/core/belt-kin.js`. Tests (tolerance `1e-9` unless noted):

1. `beltAngle`: `undefined`, `{}`, `{bedBeltAngle: 0}`, `{bedBeltAngle: 90}`,
   `{bedBeltAngle: NaN}`, `{bedBeltAngle: "abc"}` all give 45; `{bedBeltAngle: 30}` gives
   30; `{bedBeltAngle: "44.5"}` gives 44.5.
2. `beltConstants(45)`: `slope ≈ 1`, `zScale ≈ Math.SQRT2`, `cosf ≈ sinf ≈ Math.SQRT1_2`.
3. Legacy parity at 45°: for at least 20 sample `(y, z)` pairs (include negatives and
   zero), `sliceToMachine(y, z, beltConstants(45))` equals the legacy export formula
   `bcos = Math.cos(Math.PI / 4); icos = 1 / bcos; Z = z * icos; Y = -y + Z * bcos`.
4. Round trip for θ ∈ {30, 44, 45, 46, 60}: for model points `(y, z)` with `z >= 0`,
   rotate into the slicer frame (`y' = y·cos − z·sin`, `z' = y·sin + z·cos`), map with
   `sliceToMachine`, then `machineToWorld` must return the original `(y, z)`.
5. Belt contact: for every θ above, a model point with `z = 0` maps to machine `Ym ≈ 0`.
6. Monotonic belt: for every θ, increasing `z'` (fixed `y'`) gives strictly increasing `Zm`.

**Edit `package.json`** `scripts`: add `"test": "node --test \"test/*.test.mjs\""`
(keep alphabetical position if the block is sorted; otherwise add after `start-dev`).

Acceptance: `node --test "test/*.test.mjs"` passes; esbuild passes.
Commit: `belt: pure belt kinematics module with tests`
Files: `src/kiri/core/belt-kin.js`, `test/belt-kin.test.mjs`, `package.json`.

---

### P0-2: belt angle becomes a device setting used everywhere

Today the worker rotates by the user-editable process setting `sliceAngle`, while export,
the G-code preview parser and paint use hardcoded 45°. Make the device the single source.

1. `src/kiri/app/conf/defaults.js`
   - In `device_from_code`, after `bedBelt: valueOf(set.bed_belt, false),` add
     `bedBeltAngle: valueOf(set.bed_belt_angle, 45),`.
   - In `defaults.fdm.d`, after `bedBelt: false,` add `bedBeltAngle: 45,`.
   - Leave `sliceAngle: 45` in the process defaults untouched (old workspaces import
     cleanly); nothing may read it after this task.
2. `src/kiri/app/init/input.js`: after the `deviceBelt:` line add
   `bedBeltAngle:     newInput(LANG.dv_bang_s, {title:LANG.dv_bang_l, convert:toFloat, size:5, modes:FDM, show:() => ui.deviceBelt.checked}),`
   (align like neighbours). Device fields are read/written generically by key, so no
   other wiring is needed. Check how `deviceZMax` is handled and mirror it anywhere else
   it appears.
3. `src/kiri/app/devices.js`: add `ui.bedBeltAngle,` to the "disable editing for
   non-local devices" array next to `ui.deviceBelt,`.
4. Language (`web/kiri/lang/en.js` and the same edit in `src/kiri/app/lang-en.js`), next
   to the `dv_belt_*` keys:
   `dv_bang_s:      "belt angle",`
   `dv_bang_l:      ["gantry angle to the belt","in degrees (CR-30 = 45)","valid 10 - 80"],`
5. `src/kiri/run/worker.js` `rotate()`: import `{ beltAngle, beltConstants }` from
   `'../core/belt-kin.js'`. Replace `let angle = proc.sliceAngle;` with
   `let angle = beltAngle(settings.device);` and compute `cosf`, `sinf`, `slope` from
   `beltConstants(angle)` instead of the inline `Math.cos/sin/tan` (values identical).
   `rotation` stays `angle` in radians. Remove variables that become unused.
6. `src/kiri/mode/fdm/work/export.js`: import `{ beltAngle, beltConstants, sliceToMachine }`
   from `'../../../core/belt-kin.js'`. Replace
   `bcos = Math.cos(Math.PI / 4), icos = 1 / bcos,` with a `belt = beltConstants(beltAngle(device))`
   constant (declare it before use). In `moveTo` belt branch replace
   `epos.z = pos.z * icos; epos.y = -pos.y + epos.z * bcos + belt_add_y;` with
   `let m = sliceToMachine(pos.y, pos.z, belt); epos.z = m.z; epos.y = m.y + belt_add_y;`.
   Replace `bmax = Math.max(bmax, pos.z * icos);` with `belt.zScale`. Remove `bcos`/`icos`
   once no references remain.
7. `src/kiri/core/print.js` `parseGCode`: import `{ beltConstants }` from `'./belt-kin.js'`.
   Read `opts.beltAngle` (default 45) into `const beltk = beltConstants(opts.beltAngle || 45);`
   next to `const belt = opts.belt;`. In `G0G1` replace
   `point.y -= point.z * BELTFACT; point.z *= BELTFACT;` with
   `point.y -= point.z * beltk.cosf; point.z *= beltk.sinf;` (order matters: `y` first).
   Delete the `BELTFACT` constant if unused.
8. `src/kiri/run/worker.js` `parse()`: pass `beltAngle: beltAngle(device)` in the options
   object next to `belt: device.bedBelt`.
9. `src/kiri/mode/fdm/app/init-ui.js`: the two uses of
   `(settings.process.sliceAngle || 45)` become `beltAngle(settings.device)` (import from
   `'../../../core/belt-kin.js'`).
10. `src/kiri/mode/fdm/app/init-menu.js`: delete the `sliceAngle:` menu line.
11. `src/kiri/dev/fdm/Creality.CR-30.json`: in `"settings"` add `"bed_belt_angle": 45,`
    after `"bed_belt": true,`.
12. Grep `sliceAngle` across `src/` afterwards. The only remaining hit must be the
    process default in `defaults.js` (and possibly the doc comment in `slice.js`). Grep
    `Math.PI / 4` across `src/kiri`: the hits in `export.js` and `print.js` must be gone
    (`consts.js` `beltfact` and `belt.js` pooch code are out of scope; leave them).

Acceptance: tests and esbuild pass; the greps above are clean.
Commit: `belt: belt angle is a device setting used by slicing, export and preview`

---

### P0-3: no arc fitting (G2/G3) in belt mode

Belt export mirrors X and negates Y but writes arc I/J untransformed, so arcs would be
wrong. Arcs only shrink file size; disable them on belts.

1. `src/kiri/mode/fdm/work/prepare.js`: where `polyPrintPath` gets
   `arcOpts: fdmArcEnabled ? arcOpts : undefined,` change to
   `arcOpts: fdmArcEnabled && !isBelt ? arcOpts : undefined,`. Grep `arcOpts` in
   `prepare.js` and apply the same guard to any other call site.
2. `src/kiri/mode/fdm/app/init-menu.js`: `fdmArcEnabled` gets `show:isNotBelt`;
   `fdmArcTolerance`, `fdmArcResolution` and the separator after them use
   `show:() => ui.fdmArcEnabled.checked && isNotBelt()`.

Commit: `belt: disable arc fitting in belt mode`

---

### P0-4: z-hop is always 0 in belt mode

On a belt, z-hop drives the belt forward and back (a reversal) and forces a retraction on
every long travel.

1. `prepare.js` (`zhop = process.zHopDistance || 0,` in the big `let` list; `isBelt` is
   declared later in that list, so use the device directly):
   `zhop = device.bedBelt ? 0 : (process.zHopDistance || 0),`.
2. `export.js`: `zhop = process.zHopDistance || 0, // range` becomes
   `zhop = isBelt ? 0 : (process.zHopDistance || 0), // range`, and in `updateParams`
   `zhop = params.zHopDistance || 0; // range` becomes
   `zhop = isBelt ? 0 : (params.zHopDistance || 0); // range` (layer ranges must not
   re-enable it).
3. `init-menu.js`: `zHopDistance` gets `show:isNotBelt`.

Commit: `belt: force z-hop off in belt mode`

---

### P0-5: force off features that are wrong or meaningless on a belt

1. Scarf seams (move the belt during extrusion, skip the belt layer move):
   - `prepare.js`: `scarfLength = device.bedBelt ? 0 : (process.outputScarfLength || 0),`
   - `export.js`: `scarfZ = !isBelt && process.outputScarfLength ? true : false,`
2. Adaptive layers (react to layer-parallel faces, vary contact line width):
   - `slice.js`: `const sliceMinHeight = process.sliceAdaptive && !isBelt && process.sliceMinHeight > 0 ? ...`
3. Ironing (only affects layer-parallel faces, which barely exist on a belt):
   - `prepare.js`: `const ironFlow = device.bedBelt ? 0 : (process.outputIroningFlow || 0) / 100;`
4. "Belt first" (tooltip says testing no longer recommends it): in `prepare.js` remove
   the `beltFirst = process.outputBeltFirst || false,` declaration and the
   `if (beltFirst) { shellOrder = -1; }` block. Keep `startPoint = startClone;`.
   Leave the `outputBeltFirst` default in `defaults.js`.

Commit: `belt: force off scarf, adaptive layers, ironing and belt-first in belt mode`

---

### P0-6: hide controls that do not apply in belt mode

All in `src/kiri/mode/fdm/app/init-menu.js`:

- `sliceAdaptive`: `show:isNotBelt`; `sliceMinHeight`:
  `show:() => ui.sliceAdaptive.checked && isNotBelt()`.
- `sliceSupportTree`: `show:isNotBelt` (tree support is an unimplemented stub in
  `slice.js`).
- `outputIroningFlow`, `outputIroningSpace`, `outputIroningSpeed`, `outputIroningMinArea`:
  `show:isNotBelt`.
- `outputScarfLength`: `show:isNotBelt`.
- Delete the `outputBeltFirst:` line and the `separator` with `show:isBelt` directly
  above it.
- `outputPurgeTower`: add a helper `function isMultiExtruder() { let dev = api.conf.get().device; return dev.extruders && dev.extruders.length > 1; }`
  next to `isMultiHead()` and use `show:isMultiExtruder` (belt multi-extruder setups keep
  the purge tower; single-extruder printers such as the CR-30 hide it).

Check that every group still renders (no group left with only separators) by reading the
final menu. Do not change other options.

Commit: `belt: hide settings that do not apply to belt printers`

---

### P0-7: belt G-code invariant checker + tests

**Create `bin/belt-gcode-check.mjs`** exporting `checkBeltGcode(text, opts = {})` and
running as a CLI only when executed directly
(`import.meta.url === pathToFileURL(process.argv[1]).href`).

CLI: `node bin/belt-gcode-check.mjs <file.gcode> [--xmin N] [--xmax N] [--ymin N]`.
Prints a short report (line count, layers, belt Z range, extrusion Y min, X range,
failures with line numbers) and exits 1 on any failure.

Parsing rules:

- Strip `;` comments; ignore blank lines. Commands are case-insensitive.
- Track `G90`/`G91` (absolute/relative XYZ), `M82`/`M83` (E mode), `G92` (set position:
  keep an offset per axis so "machine absolute" Z = logical Z + offset), `G28` (homing
  resets the axes named, or all if none).
- The print body starts at the first line matching `/^;; --- layer/` in the raw text.
  Belt checks apply from there to the end of the file.
- Belt reversal: in the body, machine-absolute Z must never decrease by more than
  `1e-4` mm on any G0/G1/G2/G3 move. A `G92 Z` that only redefines position (M808 loop
  start) is not a move and must not trip the check.
- Arcs: any `G2`/`G3` in the body is a failure.
- Extrusion moves are G1 moves with an E increase (absolute or relative). Report min/max
  X and min Y over extrusion moves in the body. Fail if X is outside
  `[opts.xmin, opts.xmax]` when given, or Y < `opts.ymin` when given.
- Return `{ ok, failures: [{ line, message }], stats: { layers, zMin, zMax, xMin, xMax, yMin } }`.

**Create `test/belt-gcode-check.test.mjs`** with synthetic G-code strings:

1. A clean body (layer markers, forward Z, extrusion) passes.
2. A Z reversal in the body fails and reports the right line number.
3. A `G2` in the body fails.
4. `M808 L2` + `G92 Z<current>` loop start followed by moves continuing from the reset
   value passes (no false reversal).
5. `G91` relative Z moves forward pass; a relative negative Z move fails.
6. Moves before the first `;; --- layer` marker (e.g. start G-code `G1 Z0.3` then
   `G92 Z0`) are ignored.
7. X/Y bounds are enforced only when the options are given.

Commit: `belt: G-code invariant checker for belt printers`

---

### Final report (executing agent)

When all tasks are committed, report back:

- the commit list (`git log --oneline master..HEAD`)
- output of the two verification commands (summarized)
- any deviation from this plan and why
- anything you could not verify

### Manual QA (for the user, after Phase 0)

Run `npm run dev`, open `http://localhost:8080/kiri/`, pick the Creality CR-30 device:

1. The device dialog shows "belt angle" = 45 when belt is checked.
2. Expert/Output no longer show slice angle, z-hop, arcs, scarf, ironing, adaptive,
   tree support, belt first, purge tower.
3. Slice `web/obj/cube.stl`, export G-code, then run
   `node bin/belt-gcode-check.mjs <file> --xmin 0 --xmax 220 --ymin 0`: it must pass.
4. Export the same cube from `master` and diff the two files: motion lines should be
   identical (Phase 0 must not change 45° output except where features were forced off).
5. Load the exported G-code back into Kiri (G-code preview): the part renders upright and
   in the same place as the sliced preview.
