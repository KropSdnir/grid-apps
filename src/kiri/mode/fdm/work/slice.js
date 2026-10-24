/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { layerProcessTop } from './post.js';
import { fill, fill_fixed } from './fill.js';
import { generateBeltAnchor, generateBeltPrime, embossBeltPooch, finalizeBeltBounds } from './belt.js';
import { getRangeParameters } from '../core/params.js';
import { newPoint } from '../../../../geo/point.js';
import { newPolygon } from '../../../../geo/polygon.js';
import { newSlice } from '../../../core/slice.js';
import { polygons as POLY } from '../../../../geo/polygons.js';
import { slice, sliceZ } from '../../../../geo/slicer.js';
import { util } from '../../../../geo/base.js';

const CONSTANTS = {
    // Support fill
    SUPPORT_FILL_LEGACY_OFFSET: 1000,  // hack to allow old code path detection (line 158)
    SUPPORT_AUTO_ANGLE_WIDE: 1090,     // auto-angle for wide support polygons (90°)
    SUPPORT_AUTO_ANGLE_TALL: 1000,     // auto-angle for tall support polygons (0°)
    SUPPORT_INSET_RATIO: 1/3,          // inset support fill by 33% of line width
    SUPPORT_CONNECT_DISTANCE_MULT: 2,  // connect fill lines within 2x spacing
    SUPPORT_TIE_SPACING: 10,           // mm between cross-tie lines on tie layers

    // Minimum areas and thresholds
    MIN_POLY_AREA: 0.1,                // minimum polygon area in mm²
    DENSE_INFILL_THRESHOLD: 0.995,     // 99.5% infill triggers solid layer
    SOLID_LAYER_COVERAGE_THRESHOLD: 0.5, // 50% solid coverage triggers full layer

    // Adaptive slicing
    ADAPTIVE_SLICE_TOLERANCE: 0.01,    // threshold for adaptive layer height adjustments

    // Belt mode
    BELT_PRECISION_ROUNDING: 3,        // decimal places for belt touch detection
    BELT_PEEK_LAYERS: 5,               // layers to check for brim width calculation
    BELT_ANCHOR_BUMP_SPACING_MULT: 2,  // anchor bump spacing multiplier
    BELT_MIN_WIDTH_FOR_HATCH: 10,      // minimum width in mm for hatch lines in bumps
    BELT_HATCH_SPACING: 3,             // hatch line spacing in mm for bumps

    // Pooch (belt text embossing)
    POOCH_Y_RANGE_MIN: 0,              // minimum Y offset for pooch detection
    POOCH_Y_RANGE_MAX: 3,              // maximum Y offset for pooch detection
    POOCH_FLATNESS_TOLERANCE: 0.01,    // flatness tolerance for pooch surface
    POOCH_WIDTH_TOLERANCE: 1,          // width matching tolerance in mm
    POOCH_DY_TOLERANCE: 0.1,           // height delta tolerance
    POOCH_DZ_TOLERANCE: 1,             // length delta tolerance
    POOCH_TEXT_SCALE_X: 1.2,           // text horizontal scale factor
    POOCH_TEXT_SCALE_Y: 1,             // text vertical scale factor
    POOCH_FONT_SIZE: 24,               // font size in pixels
    POOCH_PIXEL_THRESHOLD: 30,         // brightness threshold for pixel detection

    // Angled fill
    ANGLED_FILL_ROTATION: 45,          // rotation offset for angled fills
};

/**
 * @typedef {Object} SliceParams
 * @property {number} sliceHeight - Layer height in mm
 * @property {number} sliceLineWidth - Extrusion width in mm
 * @property {number} sliceTopLayers - Number of solid top layers
 * @property {number} sliceBottomLayers - Number of solid bottom layers
 * @property {number} sliceFillSparse - Infill density (0.0-1.0)
 * @property {string} sliceFillType - Infill pattern: 'hex', 'grid', 'gyroid', 'triangle', etc.
 * @property {number} sliceFillAngle - Base infill angle in degrees
 * @property {number} sliceFillWidth - Solid fill line width multiplier
 * @property {number} sliceFillGrow - Fill boundary expansion in mm
 * @property {number} sliceFillOverlap - Fill overlap with shells (0.0-0.8)
 * @property {number} sliceSolidMinArea - Minimum area in mm² for solid regions
 * @property {number} sliceSolidMinThick - Miminum "thickness" ratio for culling thin solids
 * @property {number} sliceSupportDensity - Support fill density (0.0-1.0)
 * @property {number} sliceSupportFill - Support fill angle (or auto if >= 1000)
 * @property {number} sliceSupportGap - Gap between support and part in mm
 * @property {boolean} sliceSupportOutline - Include support perimeter
 * @property {number} sliceSupportOffset - Support clip offset in mm
 * @property {number} sliceAdaptive - Enable adaptive layer heights
 * @property {number} sliceMinHeight - Minimum adaptive layer height in mm
 * @property {number} firstSliceHeight - First layer height in mm
 * @property {number} firstLayerBrim - Brim width in mm
 * @property {number} beltAnchor - Belt anchor length in mm
 * @property {number} firstLayerBeltLead - Belt lead-in length in mm
 * @property {number} firstLayerBeltBump - Belt anchor bump height in mm
 * @property {number} firstLayerFlatten - Belt base flattening height in mm
 */

/**
 * @typedef {Object} RenderContext
 * @property {boolean} isThin - Force thin line rendering
 * @property {boolean} isFlat - Force flat polygon rendering
 * @property {number} offset - Line generation offset (typically lineWidth/2)
 */

/**
 * @typedef {Object} FillOptions
 * @property {Object} settings - Global settings object
 * @property {SliceParams} process - Process parameters
 * @property {Object} device - Device configuration
 * @property {number} lineWidth - Extrusion width in mm
 * @property {number} spacing - Fill line spacing in mm
 * @property {number} density - Fill density (0.0-1.0)
 * @property {Object} bounds - Widget bounding box
 * @property {number} height - Layer height in mm
 * @property {string} type - Fill pattern type
 * @property {boolean} cache - Enable fill caching
 * @property {Promise[]} [promises] - Array for async operations
 */

/**
 * @typedef {Object} SupportFillOptions
 * @property {Slice} slice - Slice to process
 * @property {number} lineWidth - Extrusion width in mm
 * @property {number} density - Support density (0.0-1.0)
 * @property {number} minArea - Minimum polygon area in mm²
 * @property {boolean} isBelt - Belt printer mode
 * @property {number} [angle] - Fill angle in degrees (auto if >= 1000)
 * @property {boolean} outline - Include support outline
 * @property {number} [gap] - Gap from part surfaces in mm
 * @property {Promise[]} [promises] - Array for async operations
 */

/**
 * @typedef {Object} BeltData
 * @property {number} slope - Belt angle slope factor
 * @property {number} cosf - Cosine of belt angle
 * @property {number} sinf - Sine of belt angle
 * @property {number} miny - Minimum Y coordinate
 * @property {number} midy - Middle Y coordinate
 * @property {boolean} [touch] - Whether slice touches belt
 * @property {boolean} [anchor] - Whether slice is part of anchor
 */

let tracker = util.pwait,
    lopacity = 0.6,
    opacity = 1,
    fat = 1.5,
    COLOR = {
        anchor: { check: 0x999933, face: 0x999933, line: 0x999933, opacity, lopacity, fat },
        fill: { check: 0x005588, face: 0x005588, line: 0x005588, opacity, lopacity, fat },
        gaps: { check: 0xaa3366, face: 0xaa3366, line: 0xaa3366, opacity, lopacity, fat },
        infill: { check: 0x3322bb, face: 0x3322bb, line: 0x3322bb, opacity, lopacity, fat },
        inset: { line: 0xaaaaaa, check: 0xaaaaaa, face: 0 },
        shell: { check: 0x0077bb, face: 0x0077bb, line: 0x0077bb, opacity, lopacity, fat },
        support: { check: 0xbbbb00, face: 0xbbbb00, line: 0xbbbb00, opacity, lopacity, fat },
        part: { line: 0x333333, check: 0x333333 },
        thin: { check: 0xbb8800, face: 0xbb8800, line: 0xbb8800, opacity, lopacity, fat },
    },
    COLOR_DARK = Object.assign({}, COLOR, {
        fill: { check: 0x005588, face: 0x005588, line: 0x005588, opacity, lopacity, fat },
        infill: { check: 0x3322bb, face: 0x3322bb, line: 0x3322bb, opacity, lopacity, fat },
        inset: { line: 0x555555, check: 0x555555 },
        part: { line: 0x777777, check: 0x777777, face: 0  },
        thin: { check: 0xbb8800, face: 0xbb8800, line: 0xbb8800, opacity, lopacity, fat },
    }),
    noop = () => {},
    PROTO = Object.clone(COLOR),
    profile = false,
    profileStart = profile ? console.profile : noop,
    profileEnd = profile ? console.profileEnd : noop,
    debug = false;

/**
 * Apply visualization options based on render context
 * 
 * @param {Object} opt - Base options
 * @param {RenderContext} ctx - Render context
 * @returns {Object|null} Modified options or null
 */
function vopt(opt, ctx) {
    if (opt) {
        if (ctx.isFlat) {
            opt.flat = true;
            opt.outline = true;
            return opt;
        }
        if (ctx.isThin) return null;
    }
    return opt;
}

/**
 * return percentage values broken into ranges
 *
 * @param {number} plo 0.0-1.0 percentage value
 * @param {number} phi  0.0-1.0 high percentage value
 * @param {Array} pcts [{ lo, hi }, ...]
 */
function divide(plo, phi, pcts) {
    let sum = 0;
    let lo = plo;
    let rval = pcts.map(pct => {
        sum += pct;
        let diff = (phi - plo) * pct;
        let rval = { lo, hi: lo + diff };
        lo += diff;
        return rval;
    });
    if (Math.abs(1 - sum) > 0.001) {
        console.log('SUM FAIL', { rval, sum });
    }
    return rval;
}

/**
 * DRIVER SLICE CONTRACT
 *
 * Given a widget and settings object, call functions necessary to produce
 * slices and then the computations using those slices. This function is
 * designed to run client or server-side and provides all output via
 * callback functions.
 *
 * @param {Object} settings
 * @param {Widget} Widget
 * @param {Function} onupdate (called with % complete and optional message)
 * @param {Function} ondone (called when complete with an array of Slice objects)
 */
export function sliceOne(settings, widget, onupdate, ondone) {
    let render = settings.render !== false,
        { minions } = self.kiri_worker,
        { process, device, controller } = settings,
        { devel, assembly, threaded } = controller,
        isBelt = device.bedBelt,
        isBrick = devel && process.sliceZInterleave,
        useAssembly = assembly,
        isConcurrent = threaded && minions.concurrent && !process.xray,
        topLayers = process.sliceTopLayers || 0,
        bottomLayers = process.sliceBottomLayers || 0,
        vaseMode = process.sliceFillType === 'vase',
        metadata = widget.anno,
        maxtruder = Math.max(0, device.extruders.length - 1),
        extruder = Math.min(maxtruder, parseInt(metadata.extruder || 0)),
        sliceHeight = process.sliceHeight,
        sliceHeightBase = (isBelt ? sliceHeight : process.firstSliceHeight) || sliceHeight,
        lineWidth = process.sliceLineWidth || device.extruders[extruder].extNozzle,
        fillOffsetMult = 1.0 - bound(process.sliceFillOverlap, 0, 0.8),
        shellOffset = lineWidth,
        fillSpacing = lineWidth,
        fillOffset = lineWidth * fillOffsetMult,
        clipOffset = process.sliceSupportOffset + lineWidth / 2,
        sliceFillAngle = process.sliceFillAngle,
        supportDensity = process.sliceSupportDensity,
        // belt 'columns' support: hollow ribs, same positions top and bottom
        columnsMode = !!(process.sliceSupportColumns && isBelt),
        { sliceCompInner, sliceCompOuter } = process;

    // create render context for visualization
    /** @type {RenderContext} */
    const renderContext = {
        isFlat: controller.lineType === "flat",
        isThin: controller.lineType === "line",
        offset: lineWidth / 2
    };
    renderContext.isThin = !renderContext.isFlat && renderContext.isThin;

    // allow overriding support fill auto angle algorithm
    // also causes support fill to be aligned on start boundaries
    // best with angles that are a multiple of 90 degrees
    if (process.sliceSupportFill >= 0) {
        // yes, an ugly hack to allow it to pass through old code paths
        process.sliceSupportFill += CONSTANTS.SUPPORT_FILL_LEGACY_OFFSET;
    }

    if (renderContext.isFlat) {
        Object.values(COLOR).forEach(color => {
            color.flat = true;
            color.line = 1
            color.opacity = 1;
        });
    } else {
        Object.keys(COLOR).forEach(key => {
            const color = COLOR[key];
            const proto = PROTO[key]
            color.flat = proto.flat;
            color.line = proto.line;
            color.opacity = proto.opacity;
        });
    }

    if (!(sliceHeight > 0 && sliceHeight < 100)) {
        return ondone("invalid slice height");
    }
    if (!(lineWidth >= 0.01 && lineWidth < 100)) {
        return ondone("invalid nozzle size");
    }

    const sliceMinHeight = process.sliceAdaptive && !isBelt && process.sliceMinHeight > 0 ?
        Math.min(process.sliceMinHeight, sliceHeight) : 0;

    if (sliceHeightBase <= 0) {
        console.log("invalid first layer height < slice height");
        console.log("reverting to min valid slice height");
        sliceHeightBase = sliceMinHeight || sliceHeight;
    }

    let bounds = widget.getBoundingBox();
    let points = widget.getPoints();
    let indices = [];
    let heights = [];
    let healed = false;
    let slices; // set by decodeSlices()

    // handle z cutting (floor method) and base flattening
    let zPress = isBelt ? process.firstLayerFlatten || 0 : 0;
    let zCut = widget.track.zcut || 0;
    let { belt } = widget;
    if (zCut || zPress) {
        for (let p of points) {
            if (!p._z) {
                p._z = p.z;
                if (zPress) {
                    if (isBelt) {
                        let zd = (belt.slope * p.z) - p.y;
                        if (zd > 0 && zd <= zPress) {
                            p.y += zd * belt.cosf;
                            p.z -= zd * belt.sinf;
                        }
                    } else {
                        if (p.z <= zPress) p.z = 0;
                    }
                }
                if (zCut && !isBelt) {
                    p.z -= zCut;
                }
            }
        }
    }

    if (isConcurrent) {
        minions.setPoints(points);
    }

    // create Slice objects for specified list of Z heights
    // zGen() produces the list (or empty for slicer auto-detected)
    slice(points, {
        strict: true,
        debug: process.xray,
        xray: process.xray,
        zMin: bounds.min.z,
        zMax: bounds.max.z - zCut,
        bucketMin: minions.concurrent * 5,
        union: controller.healMesh,
        indices: process.indices || process.xray,
        useAssembly,
        post: 'FDM',
        post_args: {
            compInner: sliceCompInner,
            compOuter: sliceCompOuter,
            shellOffset,
            fillOffset, // distance: top inset for sparse/solid infill
            clipOffset, // distance: create simpler clip offset for supports
            lineWidth,
            vaseMode,
            process,
        },
        zGen,
        // slicer function (worker local or minion distributed)
        slicer(z, points, opts) {
            return (isConcurrent ? minions.sliceZ : sliceZ)(z, points, opts);
        },
        onupdate(update) {
            return onupdate(0.0 + update * 0.5)
        }
    })
    .then(decodeSlices)
    .then(processSlices)
    .then(() => {
        minions.setPoints([]);
    })
    .then(ondone);

    // z index generator (bottom up)
    function zGen(zopt) {
        if (process.xray) {
            return zopt.zIndexes;
        }
        let { zMin, zMax } = zopt;
        let h1 = sliceHeight;
        let h0 = Math.abs(zMin) < 0.0001 ? (sliceHeightBase || h1) : h1;
        let hm = sliceMinHeight || 0;
        let h = h0;
        let z = h0;
        let zi = indices; // indices
        let zh = heights; // heights
        if (hm) {
            // adaptive increments based on z indices (var map to legacy code)
            let zIncFirst = h0;
            let zInc = h1;
            let zIncMin = hm;
            let zHeights = heights;
            let zIndexes = indices;
            let zOrdered = Object.values(zopt.zIndexes).map(v => parseFloat(v));
            // console.log('adaptive slicing', zIncMin, ':', zInc, 'from', zMin, 'to', zMax);
            let zPos = zIncFirst,
                zOI = 0,
                zDelta,
                zDivMin,
                zDivMax,
                zStep,
                nextZ,
                lzp = zPos;
            // adaptive slice height
            // first slice/height is fixed from base
            zHeights.push(zIncFirst);
            zIndexes.push(zIncFirst);
            // console.log({zIncFirst, zOrdered})
            while (zPos < zMax && zOI < zOrdered.length) {
                nextZ = zOrdered[zOI++];
                if (zPos >= nextZ) {
                    // console.log('skip',{zPos},'>=',{nextZ});
                    continue;
                }
                zDelta = nextZ - zPos;
                if (zDelta < zIncMin) {
                    // console.log('skip',{zDelta},'<',{zIncMin});
                    continue;
                }
                zDivMin = Math.floor(zDelta / zIncMin);
                zDivMax = Math.floor(zDelta / zInc);
                if (zDivMax && zDivMax <= zDivMin) {
                    if (zDelta % zInc > CONSTANTS.ADAPTIVE_SLICE_TOLERANCE) zDivMax++;
                    zStep = zDelta / zDivMax;
                    // console.log(`--- zDivMax <= zDivMin ---`, zStep, zDelta % zInc)
                } else {
                    zStep = zDelta;
                }
                // console.log({nextZ, zPos, zDelta, zStep, zDivMin, zDivMax})
                while (zPos < nextZ) {
                    zHeights.push(zStep);
                    zIndexes.push(zPos + zStep);
                    zPos += zStep;
                    // console.log({D: zPos - lzp, zPos})
                    // lzp = zPos;
                }
            }
            // console.log({zIndexes, zHeights});
        } else {
            // simple based + fixed increment
            while (true) {
                // reduce slice position by half layer height
                let realz = (z - (h / 2)).round(3);
                if (realz > zMax) {
                    break;
                }
                zh.push(h);
                zi.push(realz);
                h = h1;
                z += h;
            }
        }
        return zi;
    }

    // turn slicer raw output into Slice objects
    // z index order should be bottom up at this point
    async function decodeSlices(output) {
        // post process slices and re-incorporate missing meta-data
        slices = output.slices.map(data => {
            let { z, clip, lines, groups, changes } = data;
            if (!data.tops) return null;
            let slice = newSlice(z).addTops(data.tops, { minArea: CONSTANTS.MIN_POLY_AREA });
            slice.index = indices.indexOf(z);
            slice.height = heights[slice.index];
            slice.clips = clip;
            // do not warn on merging supports
            if (changes) {
                healed = true;
                slice.changes = changes;
                if (devel) {
                    console.log('slice healed', slice.index, slice.z, changes);
                }
            }
            if (process.xray) {
                slice.index = process.xray.shift();
                slice.lines = lines;
                slice.groups = groups;
                slice.xray = slice.index;
            }
            return slice;
        }).filter(s => s);
    }

    // slicing is the first 50% of the update "time"
    function trackupdate(pct, from, to, msg) {
        // console.log(from.round(2), to.round(2), msg);
        onupdate(0.5 + (from + (pct * (to - from))) * 0.5, msg);
    }

    // calculate % complete and call onupdate()
    function doupdate(index, from, to, msg) {
        trackupdate(index / slices.length, from, to, msg);
    }

    // for each slice, perform a function and call doupdate()
    function forSlices(from, to, fn, msg) {
        slices.forEach(slice => {
            fn(slice);
            doupdate(slice.index, from, to, msg)
        });
    }

    /**
     * Process automatic and manual shadow-based support generation
     */
    async function processSupports(plo, phi) {
        if (process.sliceSupportType === 'disabled') {
            return;
        }

        let div = divide(plo, phi, [ 0.5, 0.5 ]);
        let stack = slices.slice();
        let indices = stack.map(s => s.z);
        let zAngNorm = Math.sin(process.sliceSupportAngle * Math.PI / 180);
        let manual = process.sliceSupportType === 'manual';
        let holeMax = process.sliceSupportHole || 0;

        // sort bottom up so shadows do not accumulate
        // since that is done later and clipped to slice.clips
        stack.sort((a,b) => a.z - b.z);

        // automatic supports
        if (!manual) {
            // find where shadow areas begin (async)
            await widget.computeShadowStack(indices, progress => {
                trackupdate(progress, div[0].lo, div[0].hi, "shadow");
            }, zAngNorm, sliceHeight);

            // assign to slices (sync)
            for (let slice of stack) {
                slice.shadow = await widget.shadowAt(slice.z, true);
                if (!(slice.up && slice.shadow?.length)) continue;
                // trim shadow to part overhangs
                let top = slice.up.topPolys();
                let bot = slice.topPolys();
                let bridge = [];
                POLY.subtract(top, bot, bridge, undefined, slice.z, 0, { wasm: true });
                // sliceSupportHole: the roof of a small closed hole (a hole in this
                // layer that the layer above covers) is bridged, not supported. cut
                // the hole areas out of the overhang so no shadow starts there
                if (holeMax > 0 && bridge.length && !(process.sliceSupportHoleDepth > 0)) {
                    let holes = [];
                    for (let poly of bot) {
                        for (let hole of poly.inner || []) {
                            if (Math.abs(hole.area()) <= holeMax) holes.push(hole.clone());
                        }
                    }
                    if (holes.length) {
                        let rest = [];
                        POLY.subtract(bridge, holes, rest, undefined, slice.z, lineWidth * lineWidth, { wasm: false });
                        bridge = rest;
                    }
                }
                slice.shadow = POLY.trimTo(slice.shadow, bridge, { minArea: 0 });
            }
        }

        // process manual supports if they exist
        let { paint } = widget.anno;
        let { belt } = widget;

        // apply belt transformations, if needed
        if (manual && belt && paint?.length) {
            let { anchor, angle, dy, slope } = belt;
            // make a copy we can modify
            paint = structuredClone(paint);
            for (let rec of paint) {
                let { point } = rec;
                // convert yz plane to xy plane to re-use point utility function
                let np = newPoint(point.y + dy, point.z, 0).rotate(angle * (Math.PI/180));
                point.y = np.x;
                point.z = np.y;
                if (anchor) {
                    point.y += anchor.len;
                    point.z += anchor.len;
                }
            }
        }

        // convert paint points to circles on matching slices
        if (manual && paint?.length) {
            let hpi = Math.PI/2;
            for (let slice of stack) {
                if (!slice.up) {
                    continue;
                }
                let polys = [];
                for (let rec of paint) {
                    let { point, radius } = rec;
                    let dz = Math.abs(slice.z - point.z);
                    if (dz < radius) {
                        // scale radius by distance from point.z
                        radius = (Math.acos(dz/radius) / hpi) * radius;
                        polys.push(newPolygon().centerCircle(point, radius, 10));
                    }
                }
                // trim polys to part overhangs
                let top = slice.up.topPolys();
                let bot = slice.topPolys();
                let bridge = [];
                let propose = POLY.setZ(POLY.union(polys, 0, true), slice.z);
                POLY.subtract(top, bot, bridge, undefined, slice.z, 0, { wasm: true });
                propose = POLY.trimTo(propose, bridge, { minArea: 0 });
                slice.shadow = propose;
                // if (devel) slice.output().setLayer("over", 0x8844aa).addPolys(bridge);
            }
        }

        // 1. accumulate / union shadow coverage top down
        // 2. trim to area outside slice.clips
        let minArea = lineWidth * lineWidth;
        let shadowSum;
        let length = stack.length;
        let count = 0;

        // convert shadows to trees, when specified
        if (process.sliceSupportTree) {
            // console.log('TREE OUTPUT');
        }

        // perform accumulation top down
        for (let slice of stack.slice().reverse()) {
            let shadow = slice.shadow ?? [];
            if (devel) slice.output().setLayer("shadow", 0xff0000).addPolys(shadow);
            if (process.sliceSupportExtra) {
                shadow = POLY.offset(shadow, process.sliceSupportExtra);
            }
            // shadows accumulate down
            if (shadowSum) {
                let carry = shadowSum;
                // belt printers: a support face may lean no further than the
                // printer's own tilt. sweep the shadow sideways as it goes down so
                // the outer face drops vertically (world) instead of leaning
                // sliceSupportVertical: +/-1 sweeps (keeps the angled shadow too),
                // +/-2 projects straight down in world space (pure vertical prism)
                let vert = process.sliceSupportVertical || 0;
                if (belt && vert) {
                    let sign = vert < 0 ? -1 : 1;
                    let dy = sign * sliceHeight * (belt.slope || 1);
                    carry = shadowSum.map(p => p.clone(true).move({ x: 0, y: dy, z: 0 }));
                    if (Math.abs(vert) < 2) carry = [ ...carry, ...shadowSum ];
                }
                shadow = POLY.union([...shadow, ...carry], minArea, true);
            }
            // subtract slice top areas (widget boundaries) from shadow projection
            if (true) {
                let rem  = [];
                let clips = [ slice.topPolys() ].filter(v => v).flat();
                clips = POLY.union(clips, minArea, true);
                POLY.subtract(shadow, clips, rem, null, slice.z, minArea, { wasm: false });
                shadow = rem;
            }
            // pump shadow to clean to clean it up
            if (true) {
                let bump = lineWidth * 2;
                shadow = POLY.offset(shadow,  bump, { z: slice.z });
                shadow = POLY.offset(shadow, -bump, { z: slice.z });
            }
            shadowSum = shadow;
            // if belt, clip shadow to belt angle projection along platform
            if (belt) {
                let boundsx = bounds.dim.x * 1.1;
                let boundsy = bounds.dim.y * 1.1;
                let skewy = slice.z * belt.slope;
                let clip = newPolygon()
                    .centerRectangle(newPoint(0, 0, slice.z), boundsx, boundsy)
                    .move({ x: 0, y: -boundsy / 2 + skewy, z: 0 });
                shadow = POLY.trimTo(shadow, [ clip ]);
                // if (devel) slice.output().setLayer("belt clip", 0xffff00).addPolys([ clip ]);
            }
            slice.supports = shadow;
            // if (devel) slice.output().setLayer("shadow", 0xff0000).addPolys(shadow);
            trackupdate((++count/length), div[1].lo, div[1].hi, "support");
        }

        // TODO layerDiff shadows to identify tops/bottoms of pillars
        if (false) {
        let ps = [];
        for (let slice of stack.slice().reverse()) {
            let { supports } = slice;
            let supportsDown = slice.down ? slice.down.supports : [];
            let bridges = [], flats = [];
            slice.supportsDiff = { bridges, flats };
            ps.push(self.kiri_worker.minions
                .subtract({
                    a: supports, b: supportsDown,
                    outA: bridges, outB: flats,
                    area: 1, wasm: true, z: slice.z,
                })
            );
        }
        await Promise.all(ps);
        console.log({ slices: slices.map(s => s.supportsDiff) });
        }

        // thicken narrow support regions to a minimum width so fins come out as
        // consistent plates instead of thin slivers at polygon edges. only grows
        // thin parts (never removes support); trimmed against the part right after
        let minW = process.sliceSupportMinWidth || 0;
        if (minW > 0) {
            for (let slice of stack) {
                let polys = slice.supports || [];
                if (!polys.length) continue;
                let o = { z: slice.z, flat: true, wasm: true };
                // erode then regrow: what survives is wide enough; offsets return
                // nothing when everything is thinner than the minimum width
                let eroded = POLY.offset(polys, -minW / 2, o) || [];
                let core = eroded.length ? (POLY.offset(eroded, minW / 2, o) || []) : [];
                let thin = [];
                POLY.subtract(polys, core, thin, null, slice.z, 0, { wasm: true });
                let grown = thin.length ? (POLY.offset(thin, minW / 2, o) || []) : [];
                let merged = POLY.union([ ...core, ...grown ], minArea, true)
                    .filter(p => p.points.length >= 3 && Math.abs(p.area()) > minArea);
                // belt: never grow past the belt plane
                if (belt) {
                    let boundsx = bounds.dim.x * 1.1;
                    let boundsy = bounds.dim.y * 1.1;
                    let skewy = slice.z * belt.slope;
                    let clip = newPolygon()
                        .centerRectangle(newPoint(0, 0, slice.z), boundsx, boundsy)
                        .move({ x: 0, y: -boundsy / 2 + skewy, z: 0 });
                    merged = POLY.trimTo(merged, [ clip ]);
                }
                slice.supports = POLY.setZ(merged, slice.z);
                // clear cached bounds so later steps recompute them from the points
                for (let q of slice.supports) q._bounds = undefined;
            }
        }

        // trim using support part offset value
        let gaps = process.sliceSupportGap;
        for (let slice of stack) {
            let clips = [
                slice.clips,
                gaps ? slice.up?.clips : undefined,
                gaps ? slice.down?.clips : undefined
            ].filter(v => v).flat();
            if (clips.length) {
                let rem  = [];
                clips = POLY.union(clips, minArea, true);
                POLY.subtract(slice.supports, clips, rem, null, slice.z, minArea, { wasm: false });
                slice.supports = rem;
            }
        }

        // drop support islands smaller than a minimum area (mm^2) so small
        // overhangs (holes, tiny lips) are bridged instead of getting thin poles
        // (min-area filtering below runs first; the base plate is added after it)
        // islands are judged as whole columns: polygons on adjacent slices whose
        // bounds overlap are linked, and a column is kept if its largest cross
        // section reaches the minimum (so wide supports stay solid where they narrow)
        // sliceSupportMinAreaPct makes the minimum relative: a percent of the largest
        // column cross section on this model, so it scales with model size. when both
        // are set the larger threshold applies
        let minSupport = process.sliceSupportMinArea || 0;
        let minSupportPct = process.sliceSupportMinAreaPct || 0;
        if (minSupport > 0 || minSupportPct > 0) {
            let nodes = [];
            let byPoly = new Map();
            let parent = [];
            let find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
            let overlap = (a, b) => a.minx <= b.maxx && b.minx <= a.maxx && a.miny <= b.maxy && b.miny <= a.maxy;
            let prev = [];
            for (let slice of stack) {
                let cur = [];
                for (let poly of slice.supports || []) {
                    let node = { slice, poly, area: Math.abs(poly.area()), id: nodes.length };
                    nodes.push(node);
                    byPoly.set(poly, node);
                    parent.push(node.id);
                    for (let other of prev) {
                        if (overlap(poly.bounds, other.poly.bounds)) {
                            parent[find(node.id)] = find(other.id);
                        }
                    }
                    cur.push(node);
                }
                prev = cur;
            }
            let biggest = {};
            for (let node of nodes) {
                let root = find(node.id);
                biggest[root] = Math.max(biggest[root] || 0, node.area);
            }
            if (minSupportPct > 0) {
                let largest = 0;
                for (let root in biggest) largest = Math.max(largest, biggest[root]);
                minSupport = Math.max(minSupport, largest * minSupportPct / 100);
            }
            for (let slice of stack) {
                slice.supports = (slice.supports || []).filter(p => {
                    let node = byPoly.get(p);
                    return node && biggest[find(node.id)] >= minSupport;
                });
            }
        }

        // pedestal base plate (belt): fill the support footprint that sits on the
        // belt into one clean rectangle instead of the ragged outline of the
        // part's shadow. slicing layers cut the shadow differently each layer.
        let plate = process.beltPedestalBase || 0;
        if (belt && plate > 0) {
            let touching = [];
            let bx0 = Infinity, bx1 = -Infinity;
            for (let slice of stack) {
                let skewy = slice.z * belt.slope;
                let on = (slice.supports || []).filter(p => p.bounds.maxy >= skewy - 0.05);
                if (on.length) {
                    touching.push(slice);
                    for (let p of on) {
                        bx0 = Math.min(bx0, p.bounds.minx);
                        bx1 = Math.max(bx1, p.bounds.maxx);
                    }
                }
            }
            if (touching.length) {
                let margin = process.beltPedestalMargin || 0;
                bx0 -= margin;
                bx1 += margin;
                let zmin = touching[0].z, zmax = touching[touching.length - 1].z;
                for (let slice of stack) {
                    if (slice.z < zmin || slice.z > zmax) continue;
                    let skewy = slice.z * belt.slope;
                    let rect = newPolygon().centerRectangle(
                        newPoint((bx0 + bx1) / 2, skewy - plate / 2, slice.z), bx1 - bx0, plate);
                    // the plate is its own polygon, filled solid; the fins are trimmed
                    // so nothing is printed twice
                    let rest = [];
                    if ((slice.supports || []).length) {
                        POLY.subtract(slice.supports, [ rect ], rest, null, slice.z, minArea, { wasm: false });
                    }
                    rect.solidPlate = true;
                    slice.supports = POLY.setZ([ ...rest, rect ], slice.z);
                }
            }
        }
    }

    /**
     * Process top and bottom layers or any other
     * layers detected and marked for solid fill
     */
    async function processSolidLayers(plo, phi) {
        forSlices(plo, phi, slice => {
            let range = slice.params;
            let isBottom = slice.index < bottomLayers;
            let isTop = topLayers && slice.index > slices.length - topLayers - 1;
            let isDense = range.sliceFillSparse > CONSTANTS.DENSE_INFILL_THRESHOLD;
            let isSolid = (isBottom || ((isTop || isDense) && !vaseMode));
            let solidWidth = isSolid ? range.sliceFillWidth || 1 : 0;
            if (solidWidth) {
                let fillSpace = fillSpacing * solidWidth;
                layerMakeSolid({ slice, spacing: fillSpace, angle: sliceFillAngle });
            }
            if (slice.index === slices.length - 1) {
                slice.isFlatsLayer = true;
            }
            sliceFillAngle = (sliceFillAngle + 90.0) % 360;
        }, "solid layers");
    }

    /**
     * Process layer diffs and project solid areas
     */
    async function processLayerDiffs(plo, phi) {
        let div = divide(plo, phi, [ 0.9, 0.05, 0.05 ]);
        // boolean diff layers to detect bridges and flats
        let promises = [];
        profileStart("delta");
        forSlices(div[0].lo, div[1].hi, slice => {
            let params = slice.params || process;
            let solidMinArea = params.sliceSolidMinArea;
            let sliceMinThick = params.sliceSolidMinThick;
            let sliceFillGrow = params.sliceFillGrow;
            let p = layerDiff(slice, {
                area: solidMinArea,
                grow: sliceFillGrow,
                thick: sliceMinThick,
                async: true
            });
            promises.push(p);
        }, "layer deltas");
        await Promise.all(promises);
        profileEnd();
        // project bridges and flats up and down into part
        profileStart("delta-project");
        forSlices(div[1].lo, div[1].hi, slice => {
            let params = slice.params || process;
            topLayers = params.sliceTopLayers || 0;
            bottomLayers = params.sliceBottomLayers || 0;
            if (topLayers) projectFlats(slice, topLayers);
            if (bottomLayers) projectBridges(slice, bottomLayers);
            if (slice.flats) POLY.setZ(slice.flats, slice.z);
        }, "layer deltas");
        profileEnd();
        // union solid areas
        profileStart("solid-union");
        forSlices(div[2].lo, div[2].hi, slice => {
            if (slice.solids) {
                slice.solids = POLY.union(slice.solids, 0, true);
            }
        });
        profileEnd();
    }

    /**
     * Process solid fill patterns
     */
    async function processSolidFills(plo, phi) {
        profileStart("solid-fill")
        let promises = isConcurrent ? [] : undefined;
        let div = divide(plo, phi, promises ? [ 0.8, 0.2 ] : [ 1 ]);
        forSlices(div[0].lo, div[0].hi, slice => {
            let params = slice.params || process;
            let solidWidth = params.sliceFillWidth || 1;
            let fillSpace = fillSpacing * solidWidth;
            let solidMinArea = params.sliceSolidMinArea;
            layerFillSolids({ slice, spacing: fillSpace, angle: sliceFillAngle, minArea: solidMinArea, promises });
            sliceFillAngle = (sliceFillAngle + 90.0) % 360;
        }, "fill solids");
        // very last layer (top) is set to finish solid rate
        slices.last().finishSolids = true
        if (promises) {
            await tracker(promises, (i, t) => {
                trackupdate(i / t, div[1].lo, div[1].hi);
            });
        }
        profileEnd();
    }

    /**
     * Process sparse infill patterns
     */
    async function processSparseInfill(plo, phi) {
        let lastType;
        let promises = isConcurrent ? [] : undefined;
        let div = divide(plo, phi, promises ? [ 0.8, 0.2 ] : [ 1 ]);
        forSlices(div[0].lo, div[0].hi, slice => {
            let params = slice.params || process;
            if (!params.sliceFillSparse) {
                return;
            }
            let newType = params.sliceFillType;
            layerSparseFill(slice, {
                settings,
                process,
                device,
                lineWidth,
                spacing: fillOffset,
                density: params.sliceFillSparse,
                bounds: widget.getBoundingBox(),
                height: sliceHeight,
                type: newType,
                cache: params._range !== true && lastType === newType,
                promises
            });
            lastType = newType;
        }, "infill");
        if (promises) {
            await tracker(promises, (i, t) => {
                trackupdate(i / t, div[1].lo, div[1].hi);
            });
        }
        // filter out tiny fill points less than nozzle diameter
        // if (false)
        for (let slice of slices) {
            for (let top of slice.tops) {
                if (top.fill_sparse)
                top.fill_sparse = top.fill_sparse.filter(p => p.perimeter() >= lineWidth);
            }
        }
        // back-fill slices marked for infill cloning
        for (let slice of slices) {
            if (slice._clone_sparse) {
                let tops = slice.tops;
                let down = slice.down.tops;
                for (let i=0; i<tops.length; i++) {
                    tops[i].fill_sparse = down[i].fill_sparse.map(p => p.cloneZ(slice.z));
                }
            }
        }
    }

    /**
     * Process support structure fills
     */
    async function processSupportFills(plo, phi) {
        profileStart("support-fill");
        let promises = false && isConcurrent ? [] : undefined;
        let div = divide(plo, phi, promises ? [ 0.8, 0.2 ] : [ 1 ]);
        let colCfg = columnsMode ? columnsConfig(process) : null;
        if (colCfg) {
            colCfg.shear = widget.belt && process.sliceSupportVertical === 2 ? widget.belt.slope : 0;
            if (colCfg.style === 'pillars') {
                colCfg.grids = planPillarGrids(slices, colCfg, lineWidth);
            }
        }
        forSlices(div[0].lo, div[0].hi, slice => {
            let params = slice.params || process;
            let density = params.sliceSupportDensity;
            layerSupportFill({
                angle: process.sliceSupportFill,
                density,
                spacingGap: params.sliceSupportSpacing || process.sliceSupportSpacing || 0,
                edge: params.sliceSupportEdge || process.sliceSupportEdge || false,
                minLine: params.sliceSupportMinLine || process.sliceSupportMinLine || 0,
                tie: params.sliceSupportTie || process.sliceSupportTie || 0,
                thinLen: process.sliceSupportThin || 0,
                flush: process.sliceSupportFlush || 0,
                finGap: process.sliceSupportFinGap || 0,
                columns: colCfg,
                // pillars stay vertical in the world: the fill grid follows the belt skew
                phase: widget.belt ? slice.z * widget.belt.slope : 0,
                isBelt,
                lineWidth,
                outline: process.sliceSupportOutline !== false,
                promises,
                slice,
            });
        }, "support fill");
        if (promises) {
            await tracker(promises, (i, t) => {
                trackupdate(i / t, div[1].lo, div[1].hi);
            });
        }
        // columns modes: nothing may hang in mid-air (see anchorFills)
        let anchor = process.sliceSupportAnchor === undefined || process.sliceSupportAnchor === null ? 1.0 : process.sliceSupportAnchor;
        if (colCfg && anchor > 0) {
            anchorFills(slices, anchor, lineWidth, colCfg.shear * sliceHeight, widget.belt);
        }
        profileEnd();
    }

    /**
     * Process brick/interleave mode slicing
     */
    async function processBrickMode() {
        let indices = slices.map(s => s.index);
        let first = indices[1];
        let last = indices[indices.length - 2];
        let nu = [];
        for (let slice of slices) {
            if (slice.index < first || slice.index > last) {
                continue;
            }
            let nuSlice = slice.clone();
            nuSlice.z -= slice.height / 2;
            if (slice.index === first) {
                nuSlice.z = slice.z - slice.height / 4;
                nuSlice.height = slice.height / 2;
            } else {
                nuSlice.height = slice.height;
            }
            nu.push(nuSlice);
            let ti = 0;
            for (let top of slice.tops || []) {
                let nuTop = nuSlice.tops[ti++];
                nuTop.shells = [];
                top.shells = top.shells.filter((s,i) => {
                    if (i % 2 === 0) {
                        return true;
                    } else {
                        nuTop.shells.push(s);
                        return false;
                    }
                });
            }
            if (slice.index === last) {
                let cap = nuSlice.clone();
                cap.z += (slice.height * 0.75);
                cap.height = (slice.height / 2);
                nu.push(cap);
                cap.tops?.forEach((top, i) => {
                    top.shells = nuSlice.tops[i].shells.clone();
                });
            }
        }
        slices.appendAll(nu);
        slices.sort((a,b) => a.z - b.z);
        slices.forEach((s,i) => s.index = i);
    }

    async function renderSlices(plo, phi) {
        forSlices(plo, phi, slice => {
            let params = slice.params || process;
            layerRender(slice, params, {
                dark: controller.dark,
                devel: controller.devel,
                renderContext
            });
        }, "render");
    }

    async function processSlices() {
        // alert non-manifold parts
        if (healed) {
            onupdate(null, null, "part may not be manifold");
        }

        // reverse slices to perform these ops top-down
        // remove all empty slices above part but leave below
        // for multi-part (multi-extruder) setups where the void is ok
        let found = false;
        slices = slices.reverse().filter(slice => {
            if (slice.tops.length) {
                return found = true;
            } else {
                return found;
            }
        }).reverse();

        // inject one empty slice at the top so that
        // top layer flats are detected properly
        slices.push(newSlice(slices.peek().index + 1));

        // attach slices to widget since the
        // variable will not be replaced after this
        widget.slices = slices;

        // exit if no slices detected with tops
        if (!slices || slices.length === 0) {
            return;
        }

        // connect slices into linked list for island/bridge projections
        for (let i=1; i<slices.length; i++) {
            slices[i-1].up = slices[i];
            slices[i].down = slices[i-1];
        }

        // attach range params to each slice
        // should slice.index be recalculated after filtering?
        for (let slice of slices) {
            slice.params = getRangeParameters(process, slice.index);
        }

        // reset solids, support projections, and other annotations
        for (let slice of slices) {
            slice.extruder = extruder;
            slice.solids = [];
            slice.widget = widget;
        }

        // process solid layers (top/bottom)
        await processSolidLayers(0.10, 0.20);

        // add lead in anchor when specified in belt mode (but not for synths)
        if (isBelt) {
            // generate belt anchor
            generateBeltAnchor({
                slices,
                widget,
                process,
                lineWidth,
                sliceHeight,
                sliceHeightBase,
                extruder
            });

            // calculate smin for pooch text embossing
            let smin = Infinity;
            for (let slice of slices) {
                if (slice.belt && slice.belt.miny < smin) {
                    smin = slice.belt.miny;
                }
            }

            // experimental emboss text on flat underside
            embossBeltPooch({
                slices,
                widget,
                process,
                lineWidth,
                smin
            });
        }

        // calculations only relevant when solid layers are used
        // layer boolean diffs need to be computed to find flat areas to fill
        // and overhangs that need to be supported. these are stored in flats
        // and bridges, projected up/down, and merged into an array of solids
        // for "real" objects, fill the remaining voids with sparse fill
        // sparse layers only present when non-vase mode and sparse % > 0
        if (!vaseMode) {
            await processLayerDiffs(0.2, 0.4);
            // support generation using either
            // enclosed shadow or manual painted supports
            await processSupports(0.4, 0.5);
            await processSolidFills(0.5, 0.6);
            await processSparseInfill(0.6, 0.8);
        }

        // sliceSupportHole: keep the footprint of small closed holes empty. just
        // below a hole's mouth, the (belt skewed) projected shadow of the part
        // underside overlaps the hole footprint and would stand a crescent of
        // support under the opening; cut the hole footprints of the next few
        // layers (the thin zone depth) out of the support
        if (process.sliceSupportHole > 0 && supportDensity) {
            let holeMax = process.sliceSupportHole;
            // depth below the mouth in which the hole footprint is kept free: its own
            // setting (mm), 0 = the thin zone length. a long depth would carve the hole
            // footprint as a vertical shaft down the whole pedestal
            let holeDepth = process.sliceSupportHoleDepth > 0 ? process.sliceSupportHoleDepth : (process.sliceSupportThinZone || 3);
            let zoneLayers = Math.max(1, Math.round(holeDepth / sliceHeight));
            let minArea = lineWidth * lineWidth;
            for (let slice of slices) {
                let polys = (slice.supports || []).filter(p => !p.solidPlate);
                if (!polys.length) continue;
                let holes = [];
                let s = slice.up;
                for (let i = 0; i < zoneLayers && s; i++, s = s.up) {
                    for (let top of s.topPolys() || []) {
                        for (let hole of top.inner || []) {
                            if (Math.abs(hole.area()) <= holeMax) holes.push(hole.clone());
                        }
                    }
                }
                if (!holes.length) continue;
                let rest = [];
                let plate = (slice.supports || []).filter(p => p.solidPlate);
                POLY.subtract(polys, POLY.union(holes, 0, true), rest, null, slice.z, minArea, { wasm: false });
                slice.supports = POLY.setZ([ ...plate, ...rest ], slice.z);
            }
        }

        // support contact zone (belt): the part of the support within a few mm of
        // the part is flagged thin and filled with short dashes (small pillars)
        // instead of full-width fins; the rest, and the base, keep the normal fill
        if (isBelt && (process.sliceSupportThin > 0 || columnsMode) && (supportDensity || columnsMode)) {
            // columns mode: no thin zone length (0) means no cap, only the fraction counts
            let zoneLayers = columnsMode && !(process.sliceSupportThinZone > 0)
                ? slices.length
                : Math.max(1, Math.round((process.sliceSupportThinZone || 3) / sliceHeight));
            let minArea = lineWidth * lineWidth;
            // sliceSupportThinFraction: the thin zone of a column is this fraction of the
            // column's own height (part above to belt below), at most the zone length
            let frac = Math.min(0.95, process.sliceSupportThinFraction || 0);
            let belt = widget.belt;
            for (let slice of slices) {
                let polys = (slice.supports || []).filter(p => !p.solidPlate);
                if (!polys.length) continue;
                let above = [];
                if (frac > 0 && belt) {
                    // a column stands vertical in the world: from layer to layer it moves
                    // 'shear' sideways (vertical = 2), while the belt plane moves the other
                    // way, so column and belt close in by dy + shear per layer. a point has
                    // u layers of part above (counted along the vertical column) and
                    // d = (belt - y) / (dy + shear) layers of column below; thin where
                    // u <= frac / (1 - frac) * d, so only y <= belt - m * rate / ratio
                    // may count the part m layers up
                    let dy = sliceHeight * (belt.slope || 1);
                    let shear = (process.sliceSupportVertical || 0) === 2 ? dy : 0;
                    let rate = dy + shear;
                    let ratio = frac / (1 - frac);
                    let skewy = slice.z * belt.slope;
                    let miny = Infinity, maxy = -Infinity;
                    for (let p of polys) {
                        miny = Math.min(miny, p.bounds.miny);
                        maxy = Math.max(maxy, p.bounds.maxy);
                    }
                    let s = slice.up;
                    for (let m = 1; m <= zoneLayers && s; m++, s = s.up) {
                        let ym = skewy - m * rate / ratio;
                        if (ym < miny) break;
                        let tops = (s.topPolys() || []).filter(v => v);
                        if (!tops.length) continue;
                        let moved = tops.map(p => p.clone(true));
                        // the support shadow starts unsheared on the layer under the part
                        if (shear && m > 1) moved.forEach(p => p.move({ x: 0, y: (m - 1) * shear, z: 0 }));
                        if (ym < maxy) {
                            let cut = newPolygon().centerRectangle(
                                newPoint(0, (miny - 10 + ym) / 2, slice.z), bounds.dim.x * 4 + 200, ym - miny + 10);
                            moved = POLY.trimTo(moved, [ cut ]) || [];
                        }
                        above.push(...moved);
                    }
                } else {
                    let s = slice.up;
                    for (let i = 0; i < zoneLayers && s; i++, s = s.up) {
                        above.push(...(s.topPolys() || []));
                    }
                }
                if (!above.length) continue;
                let contact = POLY.union(above, minArea, true);
                if (!contact.length) continue;
                let thin = POLY.trimTo(polys.map(p => p.clone(true)), contact) || [];
                let wide = [];
                POLY.subtract(polys, contact, wide, null, slice.z, minArea, { wasm: false });
                let plate = (slice.supports || []).filter(p => p.solidPlate);
                for (let p of thin) p.thinSupport = true;
                slice.supports = POLY.setZ([ ...plate, ...wide, ...thin ], slice.z);
            }
        }

        // fill all supports (auto and manual)
        if (supportDensity || columnsMode) {
            await processSupportFills(0.8, 0.84);
        }

        // belt prime strip (and pedestal anchor), after supports exist
        if (isBelt) {
            generateBeltPrime({
                slices,
                widget,
                process,
                lineWidth,
                sliceHeight,
                extruder,
                bedWidth: device.bedWidth
            });
        }

        // brick/interleave mode processing
        if (isBrick) {
            await processBrickMode(0.84, 0.85);
        }

        // render if not explicitly disabled
        if (render) {
            await renderSlices(0.85, 1.0);
        }

        if (isBelt) {
            finalizeBeltBounds({ slices, widget });
        }
    }
}

// replace with tip2tipEmit?
/**
 * Cut fill lines into short dashes on a fixed grid so a support region prints as
 * small pillars. Dash positions are measured along the line minus `phase`, so
 * they line up from layer to layer (pillars stay vertical).
 * @param {Point[]} fill - flat array of point pairs (one line per pair)
 * @param {number} len - dash length in mm
 * @param {number} period - dash start to next dash start, in mm
 * @param {number} phase - offset subtracted from the Y coordinate (belt skew)
 */
function dash_lines(fill, len, period, phase) {
    const out = [];
    for (let i = 0; i + 1 < fill.length; i += 2) {
        const a = fill[i], b = fill[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const L = Math.hypot(dx, dy);
        if (!(L > 0.01)) continue;
        const alongY = Math.abs(dy) >= Math.abs(dx);
        const c0 = alongY ? a.y - phase : a.x;
        const dc = alongY ? dy : dx;
        const lo = Math.min(c0, c0 + dc), hi = Math.max(c0, c0 + dc);
        const emit = (s, e) => {
            const t0 = (s - c0) / dc, t1 = (e - c0) / dc;
            const p1 = a.clone(), p2 = a.clone();
            p1.x = a.x + dx * t0; p1.y = a.y + dy * t0;
            p2.x = a.x + dx * t1; p2.y = a.y + dy * t1;
            out.push(p1, p2);
        };
        let kept = 0;
        for (let k = Math.floor(lo / period); k * period <= hi; k++) {
            const s = Math.max(lo, k * period), e = Math.min(hi, k * period + len);
            if (e - s < len * 0.5) continue;
            emit(s, e);
            kept++;
        }
        // a line shorter than half a dash, or one that falls between grid slots,
        // must not vanish (the support would have a hole): one dash, centered
        if (!kept) {
            const mid = (lo + hi) / 2, half = Math.min(hi - lo, len) / 2;
            emit(mid - half, mid + half);
        }
    }
    out.forEach((p, i) => { p.index = (i / 2) | 0; });
    return out;
}

function connect_lines(lines, maxd = Infinity) {
    const newlines = [];
    let op2;
    let eo = 0;
    for (let i=0; i<lines.length; i += 2) {
        let p1 = lines[i];
        let p2 = lines[i+1];
        // swap p1 / p2 dir every other line
        if (eo++ % 2 === 1) {
            let t = p1;
            p1 = p2;
            p2 = t;
        }
        // connect short distances between ends
        if (op2 && p1.distTo2D(op2) <= maxd) {
            let op1 = p1.clone();
            newlines.push(op2);
            newlines.push(op1);
        }
        newlines.push(p1);
        newlines.push(p2);
        op2 = p2.clone();
    }
    let idx = 0;
    for (let p of newlines) {
        p.index = (idx++ / 2) | 0;
    }
    return newlines;
}

function bound(v,min,max) {
    return Math.max(min,Math.min(max,v));
}

/**
 * Render slice visualization for preview
 * @param {Slice} slice - Slice to render
 * @param {SliceParams} params - Slice parameters
 * @param {Object} opt - Render options
 * @param {boolean} opt.dark - Use dark color scheme
 * @param {boolean} opt.devel - Enable development visualization
 * @param {RenderContext} opt.renderContext - Rendering context
 */
function layerRender(slice, params, opt = {}) {
    const { dark, devel, renderContext: ctx } = opt;
    const { offset, isThin, isFlat } = ctx;

    const Color = dark ? COLOR_DARK : COLOR;
    const output = slice.output();
    const height = slice.height / 2;
    const solidWidth = params.sliceFillWidth || 1;

    if (slice.tops?.length)
    for (let top of slice.tops) {
        if (isThin) output
            .setLayer('part', Color.part)
            .addPolys([top.poly]);

        if (top.shells?.length) output
            .setLayer("shells", Color.shell)
            .addPolys(top.shells || [], vopt({ offset, height, clean: true }, ctx));

        if (isThin && top.thin_wall?.length) output
            .setLayer("walls", Color.thin)
            .addPolys(top.thin_wall.map(a => a.map(p => newPolygon().centerCircle(p, p.r, 12).setZ(slice.z))).flat(), vopt({ offset, height }, ctx));

        if (!isThin && top.thin_wall?.length) output
            .setLayer("walls", Color.thin)
            .addPolys(top.thin_wall.map(a =>
                    a.length === 1 ?
                    newPolygon().centerCircle(a[0], a[0].r/2, 12) :
                    newPolygon(a.map(p => newPoint(p.x, p.y)))
                        .setZ(slice.z)
                        .closeIf(height)
                ), vopt({ offset, height }, ctx));

        if (top.fill_lines?.length) output
            .setLayer("solid fill", Color.fill)
            .addLines(top.fill_lines || [], vopt({ offset: offset * solidWidth, height, z:slice.z }, ctx));

        if (!(slice.belt?.anchor)) output
            .setLayer("sparse fill", Color.infill)
            .addPolys(top.fill_sparse || [], vopt({ offset, height, outline: true, trace:true }, ctx))

        if (slice.belt?.anchor) output
            .setLayer("anchor", Color.anchor)
            .addPolys(top.fill_sparse || [], vopt({ offset, height, outline: true, trace:true }, ctx))

        if (top.thin_fill?.length) output
            .setLayer("thin fill", Color.thin)
            .addLines(top.thin_fill, vopt({ offset, height }, ctx));

        if (top.gaps?.length && devel) output
            .setLayer("gaps", Color.gaps)
            .addPolys(top.gaps, vopt({ offset, height, thin: true }, ctx));

        if (isThin && devel && top.fill_off?.length) {
            slice.output()
                .setLayer('fill inset', Color.inset)
                .addPolys(top.fill_off)
                .setLayer('last', { face: 0, line: 0x008888, check: 0x008888 })
                .addPolys(top.last);
        }
    }

    if (isThin && devel) {
        if (slice.solids?.length) output
            .setLayer("solids", { face: 0xbbbb00, check: 0xbbbb00 })
            .addAreas(slice.solids);

        if (slice.bridges?.length) output
            .setLayer("bridges", { face: 0x00cccc, line: 0x00cccc, check: 0x00cccc })
            .addAreas(slice.bridges);

        if (slice.flats?.length) output
            .setLayer("flats", { face: 0xaa00aa, line: 0xaa00aa, check: 0xaa00aa })
            .addAreas(slice.flats);
    }

    if (slice.supports && params.sliceSupportOutline) output
        .setLayer("support", Color.support)
        .addPolys(slice.supports, vopt({ offset, height }, ctx));

    if (slice.supports) slice.supports.forEach(poly => {
        if (poly.fill) output
            .setLayer("support", Color.support)
            .addLines(poly.fill, vopt({ offset, height }, ctx));
    });

    if (slice.xray) {
        const color = [ 0xff0000, 0x00aa00, 0x0000ff, 0xaaaa00, 0xff00ff, 0x0 ];
        if (slice.lines) {
            slice.lines.forEach((line, i) => {
                const group = i % 5;
                slice.output().setLayer(`l${group}`, color[group]).addLine(line.p1, line.p2);
            });
        }
        if (slice.groups)
        POLY.nest(slice.groups).forEach((poly, i) => {
            const group = i % 5;
            slice.addTop(poly);
            // slice.output().setLayer(`g${i}`, 0x888888).addPoly(poly);
            slice.output().setLayer(`g${i}`, color[group]).addPoly(poly);
        });
    }

    // console.log(slice.index, slice.render.stats);
}

/**
 * DRIVER SLICE CONTRACT
 * 
 * global slice operation run after all individual widget slice() complete
 */
export function slicePost(settings, onupdate) {
    // future home of brim and anchor generation
    let widgets = Object.values(self.kiri_worker.cache)
        .filter(w => !w.meta.disabled)
        .sort((a,b) => {
            return a.slices[0].z - b.slices[0].z
        });

    // assign grid_id which can be embedded in gcode and
    // used by the controller to cancel objects during print
    let { bounds } = settings;
    if (!bounds) return;
    for (let widget of widgets) {
        let { pos, box } = widget.track;
        // calculate top/left coordinate for widget
        // relative to bounding box for all widgets
        let tl = {
            x: Math.round((pos.x - box.w/2 - bounds.min.x) / 10) + 1,
            y: Math.round((pos.y - box.h/2 - bounds.min.y) / 10) + 1
        };
        widget.track.grid_id = tl.x * 100 + tl.y;
    }

    // count extruders used
    let ext = [];
    for (let w of widgets) {
        if (w.anno && w.anno.extruder >= 0) {
            let e = w.anno.extruder;
            if (ext.indexOf(e) < 0) {
                ext.push(e);
            }
        }
    }

    // sort widgets by first slice Z
    widgets.sort((a,b) => {
        return a.slices[0].z - b.slices[0].z;
    });

    // remove anchor slices from other widgets (only with multi-material)
    if (ext.length > 1) {
        // give first widget a pass since it should have the anchor
        for (let w of widgets.slice(1)) {
            w.slices = w.slices.filter(s => s.index >= 0);
        }
    }
}

/**
 * Compute offset shell polygons. For FDM, the first offset is usually half
 * of the nozzle width.  Each subsequent offset is a full nozzle width.  User
 * parameters control tweaks to these numbers to allow for better shell bonding.
 * The last shell generated is a "fillOffset" shell.  Fill lines are clipped to
 * this polygon.  Adjusting fillOffset controls bonding of infill to the shells.
 *
 * Most of this is done in slicePost() in FDM mode. now this is used by SLA, Laser
 *
 * @param {number} count
 * @param {number} offsetN
 * @param {number} fillOffset
 * @param {Obejct} options
 */
export function layerProcessTops(slice, count, offset1, offsetN, fillOffset, opt = {}) {
    for (let top of slice.tops) {
        layerProcessTop(slice.z, top, count, offset1, offsetN, fillOffset, opt);
    }
}

/**
 * Create an entirely solid layer by filling all top polygons
 * with an alternating pattern.
 *
 * @param {Object} args - Options object
 * @param {Slice} args.slice - Slice to fill
 * @param {number} args.spacing - Fill line spacing in mm
 * @param {number} args.angle - Fill angle in degrees
 */
function layerMakeSolid({ slice, spacing, angle }) {
    if (slice.xray) {
        return;
    }

    if (slice.tops.length === 0 || typeof(angle) != 'number') {
        slice.isSolidLayer = false;
        return;
    }

    slice.tops.forEach(function(top) {
        if (!top.fill_off) return; // missing for inner brick layers
        let lines = POLY.fillArea(top.fill_off, angle, spacing, null);
        top.fill_lines.appendAll(lines);
    });

    slice.isSolidLayer = true;
};

/**
 * Take output from pluggable sparse infill algorithm and clip to
 * the bounds of the top polygons and their inner solid areas.
 */
function layerSparseFill(slice, options = {}) {
    if (slice.xray || options.type === 'none') {
        return;
    }

    let process = options.process,
        spacing = options.spacing,  // spacing space between fill lines
        density = options.density,  // density of infill 0.0 - 1.0
        bounds = options.bounds,    // bounding box of widget
        height = options.height,    // z layer height
        cache = !(options.cache === false),
        type = options.type || 'hex';

    if (slice.tops.length === 0 || density === 0.0 || slice.isSolidLayer || slice.index < 0) {
        slice.isSparseFill = false;
        return;
    }

    let tops = slice.tops,
        down = slice.down,
        clib = self.ClipperLib,
        ctyp = clib.ClipType,
        ptyp = clib.PolyType,
        cfil = clib.PolyFillType,
        clip = new clib.Clipper(),
        ctre = new clib.PolyTree(),
        poly,
        polys = [],
        lines = [],
        line = [],
        solids = [],
        // callback passed to pluggable infill algorithm
        target = {
            // slice and slice property access
            slice: function() { return slice },
            zIndex: function() { return slice.index },
            zValue: function() { return slice.z },
            // various option map access
            options: function() { return options },
            lineWidth: function() { return options.lineWidth },
            bounds: function() { return bounds },
            zHeight: function() { return height },
            offset: function() { return spacing },
            density: function() { return density },
            repeat: function() { return process.sliceFillRepeat },
            // output functions
            emit: function(x,y) {
                if (isNaN(x)) {
                    solids.push(x);
                } else {
                    line.push(newPoint(x, y, slice.z));
                    slice.isSparseFill = true;
                }
            },
            newline: function() {
                if (line.length > 0) {
                    lines.push(line);
                    line = [];
                }
            }
        };

    // use specified fill type
    if (type && fill[type]) {
        fill[type](target);
    } else {
        console.log({missing_infill: type});
        return;
    }

    // force emit of last line
    target.newline();

    // prepare top infill structure
    for (let top of tops) {
        top.fill_sparse = top.fill_sparse || [];
        polys.appendAll(top.fill_off);
        polys.appendAll(top.solids);
    }

    // update fill fingerprint for this slice
    slice._fill_finger = POLY.fingerprint(polys);

    let skippable = cache && fill_fixed[type] ? true : false;
    let miss = false;
    // if the layer below has the same fingerprint,
    // we may be able to clone the infill instead of regenerating it
    if (skippable && slice.fingerprintSame(down)) {
        // the fill fingerprint can slightly different because of solid projections
        if (down._fill_finger && POLY.fingerprintCompare(slice._fill_finger, down._fill_finger)) {
            for (let i=0; i<tops.length; i++) {
                // the layer below may not have infill computed if it's solid
                if (!down.tops[i].fill_sparse) {
                    miss = true;
                }
            }
            // mark for infill cloning if nothing is missing
            if (!miss) {
                slice._clone_sparse = true;
                return;
            }
        }
    }

    let sparse_clip = slice.isSparseFill;

    // solid fill areas
    if (solids.length) {
        for (let top of tops) {
            if (!top.fill_off) return;
            let masks = top.fill_off.slice();
            if (top.solids) {
                masks = POLY.subtract(masks, top.solids, [], null, slice.z);
            }
            let angl = process.sliceFillAngle * ((slice.index % 2) + 1);
            for (let solid of solids) {
                let inter = [],
                    fillable = [];
                for (let mask of masks) {
                    let p = solid.mask(mask);
                    if (p && p.length) inter.appendAll(p);
                }
                // offset fill area to accommodate trace
                if (inter.length) {
                    POLY.expand(inter, -options.lineWidth/2, slice.z, fillable);
                }
                // fill intersected areas
                if (inter.length) {
                    slice.isSparseFill = true;
                    for (let p of inter) {
                        p.forEachSegment((p1, p2) => {
                            top.fill_lines.push(p1, p2);
                        });
                    }
                }
                if (fillable.length) {
                    let lines = POLY.fillArea(fillable, angl, options.lineWidth);
                    top.fill_lines.appendAll(lines);
                }
            }
        }
    }

    // if only solids were added and no lines to clip
    if (!sparse_clip) {
        return;
    }

    if (options.promises) {
        options.promises.push(self.kiri_worker.minions.clip(slice, polys, lines));
        return;
    }

    lines = lines.map(a => a.map(p => p.toClipper()));
    clip.AddPaths(lines, ptyp.ptSubject, false);
    clip.AddPaths(POLY.toClipper(polys), ptyp.ptClip, true);

    if (clip.Execute(ctyp.ctIntersection, ctre, cfil.pftNonZero, cfil.pftEvenOdd)) {
        for (let node of ctre.m_AllPolys) {
            poly = POLY.fromClipperNode(node, slice.z);
            for (let top of tops) {
                // use only polygons inside this top
                if (poly.isInside(top.poly)) {
                    top.fill_sparse.push(poly);
                }
            }
        }
    }
};

/**
 * Find difference between fill inset poly on two adjacent layers.
 * Used to calculate bridges, flats and then solid projections.
 * 'expand' is used for top offsets in SLA mode
 */
export function layerDiff(slice, options = {}) {
    const { sla, grow, area, thick } = options;

    if (slice.index < 0 || slice.xray) {
        return;
    }

    let boundary = !(slice.up && slice.down),
        top = slice,
        down = slice.down || newSlice(-1),
        topInner = sla ? top.topPolys() : top.topInners(),
        downInner = sla ? down.topPolys() : down.topInners(),
        bridges = top.bridges = [],
        flats = down.flats = [];

    // skip diffing layers that are identical
    if (!boundary && slice.fingerprintSame(down)) {
        top.bridges = bridges;
        down.flats = flats;
        // console.log(slice.z, 'layer fingerprint match');
        return;
    }

    let newBridges = [];
    let newFlats = [];

    if (options.async) {
        return self.kiri_worker.minions
            .subtract({
                a: topInner, b: downInner,
                outA: newBridges, outB: newFlats,
                area, wasm: true, z: slice.z,
            })
            .then(() => {
                layerDiffDone({ slice, bridges, flats, newBridges, newFlats, options });
            });
    } else {
        POLY.subtract(topInner, downInner, newBridges, newFlats, slice.z, area, {
            wasm: true
        });
        layerDiffDone({ slice, bridges, flats, newBridges, newFlats, options });
    }
}

function layerDiffDone({ slice, bridges, flats, newBridges, newFlats, options }) {
    const { sla, grow, area, thick } = options;

    // console.log(slice.z, { newBridges, newFlats });
    newBridges = newBridges.filter(p => p.areaDeep() >= area && p.thickness(true) >= thick);
    newFlats = newFlats.filter(p => p.areaDeep() >= area && p.thickness(true) >= thick);

    if (grow > 0 && newBridges.length) {
        newBridges = POLY.offset(newBridges, grow, { z: slice.z });
    }
    if (grow > 0 && newFlats.length) {
        newFlats = POLY.offset(newFlats, grow, { z: slice.z });
    }

    bridges.appendAll(newBridges);
    flats.appendAll(newFlats);
}

/**
 * Fill projected solid areas and store line data
 * 
 * @param {Object} args - Options object
 * @param {Slice} args.slice - Slice to process
 * @param {number} args.spacing - Fill line spacing in mm
 * @param {number} args.angle - Fill angle in degrees
 * @param {number} [args.minArea] - Minimum polygon area in mm² (default: 1)
 * @param {Promise[]} [args.promises] - Array for async operations
 * @return {boolean} true if filled, false if not
 */
function layerFillSolids({ slice, spacing, angle, minArea, promises: fillQ }) {
    let minarea = minArea || 1,
        tops = slice.tops,
        solids = slice.solids;

    if (!(tops && solids)) {
        return;
    }

    if (slice.isSolidLayer || slice.xray) {
        return;
    }

    let unioned = POLY.union(solids, undefined, true, { wasm: true }).flat(),
        isSLA = (spacing === undefined && angle === undefined);

    if (solids.length === 0) return false;
    if (unioned.length === 0) return false;

    let trims = [],
        inner = isSLA ? slice.topPolys() : slice.topFillOff();

    // trim each solid to the inner bounds
    for (let p of unioned) {
        p.setZ(slice.z);
        for (let i of inner) {
            let masks = p.mask(i);
            if (masks && masks.length > 0) {
                trims.appendAll(masks);
            }
        }
    }

    // clear old solids and make array for new
    tops.forEach(top => { top.solids = [] });

    // replace solids with merged and trimmed solids
    slice.solids = solids = trims;

    // parent each solid polygon inside the smallest bounding top
    let make_solid_layer = false;
    let tops_area = tops.length ? tops.map(top => top.poly.areaDeep()).reduce((a,i) => a+i) : 0;
    for (let solid of solids) {
        for (let top of tops) {
            let stop = [];
            if (top.poly.overlaps(solid)) {
                if (!solid.parent || solid.parent.area() > top.poly.area()) {
                    if (solid.areaDeep() < minarea) {
                        // console.log({i:slice.index,cull_solid:solid,area:solid.areaDeep()});
                        continue;
                    }
                    solid.parent = top.poly;
                    top.solids.push(solid);
                    stop.push(solid);
                }
            }
            // problematic for organic shapes with lots of big and small tops
            // the small tops tend to trigger entire layer fills. for now just
            // trip full solid layer if a single top area diff > 50%
            if (false && stop.length) {
                let top_area = top.poly.areaDeep();
                let stop_area = stop.map(p => p.areaDeep()).reduce((a,v) => a + v);
                // if the solid area > threshold of the top area, make entire layer solid
                if (stop_area / tops_area > CONSTANTS.SOLID_LAYER_COVERAGE_THRESHOLD) {
                    make_solid_layer = true;
                }
            }
        }
    }
    // if 50% of top is filled with solids, trigger layer conversion to solid
    // in future, this should be limited to a specific top, not entire layer
    if (make_solid_layer) {
        for (let top of tops) {
            top.solids = [];
        }
        layerMakeSolid({ slice, spacing, angle });
        return;
    }

    // for SLA to bypass line infill
    if (isSLA) {
        return true;
    }

    // create empty filled line array for each top
    for (let top of tops) {
        // synth belt anchor tops don't want fill
        if (!top.fill_lines) {
            continue;
        }
        const tofill = [];
        const angfill = [];
        const newfill = top.fill_lines = [];
        // determine fill orientation from top
        for (let solid of solids) {
            if (solid.parent === top.poly) {
                if (solid.fillang) {
                    angfill.push(solid);
                } else {
                    tofill.push(solid);
                }
            }
        }
        if (tofill.length > 0) {
            areaFill({ promises: fillQ, polys: tofill, angle, spacing, output: newfill });
        }
        if (angfill.length > 0) {
            top.fill_lines_ang = {spacing:spacing,list:[],poly:[]};
            for (let af of angfill) {
                areaFill({
                    promises: fillQ,
                    polys: [af],
                    angle: af.fillang.angle + CONSTANTS.ANGLED_FILL_ROTATION,
                    spacing,
                    output: newfill
                });
            }
        }
    }
}

/**
 * Fill area with line pattern
 * 
 * @param {Object} args - Options object
 * @param {Promise[]} [args.promises] - Array for async operations
 * @param {Polygon[]} args.polys - Polygons to fill
 * @param {number} args.angle - Fill angle in degrees
 * @param {number} args.spacing - Fill line spacing in mm
 * @param {Array} args.output - Output array for fill lines
 * @param {number} [args.minLen] - Minimum line length
 * @param {number} [args.maxLen] - Maximum line length
 */
function areaFill({ promises: fillQ, polys, angle, spacing, output, minLen, maxLen }) {
    if (fillQ) {
        fillQ.push(self.kiri_worker.minions.fill(polys, angle, spacing, output, minLen, maxLen));
    } else {
        POLY.fillArea(polys, angle, spacing, output, minLen, maxLen);
    }
}

/**
 * Generate support structure fill patterns for a slice
 *
 * @param {SupportFillOptions} args - Configuration object
 * @param {Promise[]} [args.promises] - Array for async fill operations (concurrent mode)
 * @param {Slice} args.slice - Current slice to process
 * @param {number} args.lineWidth - Extrusion width in mm (typically nozzle diameter)
 * @param {number} args.density - Fill density from 0.0 (0%) to 1.0 (100%)
 *                                 Typical support density is 0.10-0.25 (10-25%)
 * @param {boolean} args.isBelt - True for belt printer mode (affects auto-angle calculation)
 * @param {number} [args.angle] - Fill angle in degrees. Special values:
 *                                 - undefined/null: Auto-calculate based on polygon shape
 *                                 - >= 1000: Auto-calculate (1000=0° for tall, 1090=90° for wide)
 *                                 - 0-360: Use specified angle
 * @param {boolean} args.outline - Include support perimeter outline in output
 *                                  If false, only interior fill lines are generated
 *
 * @modifies {Slice} slice.supports - Updated with filled support polygons (array of Polygon)
 *                                     Each polygon has a .fill property with fill lines
 *
 * @see supportPolyFill - Called internally to generate fill patterns
 * @see CONSTANTS.SUPPORT_INSET_RATIO - Inset ratio (1/3 of line width)
 * @see CONSTANTS.SUPPORT_AUTO_ANGLE_WIDE - Auto angle for wide polygons (1090 = 90°)
 * @see CONSTANTS.SUPPORT_AUTO_ANGLE_TALL - Auto angle for tall polygons (1000 = 0°)
 * @see CONSTANTS.SUPPORT_CONNECT_DISTANCE_MULT - Distance multiplier for line connection (2x)
 */
function layerSupportFill({ promises, slice, lineWidth, density, isBelt, angle, outline, gap, spacingGap, minLine, tie, edge, thinLen, flush, finGap, columns, phase }) {
    let polys = slice.supports;
    if (columns && polys) assignColumnRegions(polys, columns, lineWidth);
    if (polys) {
        supportPolyFill({
            angle,
            density,
            isBelt,
            lineWidth,
            outline,
            polys,
            promises,
            spacingGap,
            minLine,
            edge,
            thinLen,
            flush,
            finGap,
            columns,
            phase,
            // every Nth layer prints cross lines (0 degrees) that tie the fins together
            tieLayer: tie > 0 && slice.index >= 0 && slice.index % tie === 0,
            tieSpacing: CONSTANTS.SUPPORT_TIE_SPACING,
            z: slice.z
        });
    }
}

/**
 * Generate fill patterns for individual support polygons
 *
 * This is an internal helper function called by doSupportFill() that processes each support
 * polygon individually to generate the hatching fill patterns. It handles:
 * - Automatic fill angle calculation based on polygon aspect ratio
 * - Intelligent inset to prevent perimeter over-extrusion
 * - Optional line connection to reduce travel moves when no outline is needed
 *
 * @param {Object} args - Configuration object
 * @param {Promise[]} [args.promises] - Array for async fill operations (concurrent mode)
 *                                       Pass same array through all calls for parallelism
 * @param {Polygon[]} args.polys - Array of support polygons to fill
 *                                  Must have valid .bounds property for aspect ratio calculation
 * @param {number} args.lineWidth - Extrusion width in mm (typically 0.4mm for 0.4mm nozzle)
 * @param {number} args.density - Fill density from 0.0 (0%) to 1.0 (100%)
 *                                 Typical support values: 0.10-0.25 (10-25%)
 *                                 Higher density = stronger support but harder to remove
 * @param {number} args.z - Current Z height in mm (for polygon operations)
 * @param {boolean} args.isBelt - True for belt printer mode
 *                                 Forces use of SUPPORT_AUTO_ANGLE_WIDE (1090/90°)
 * @param {number} [args.angle] - Fill angle in degrees. Special values:
 *                                 - undefined/null: Auto-calculate based on polygon aspect ratio
 *                                 - >= 1000: Auto-calculate (1000=0° for tall, 1090=90° for wide)
 *                                 - 0-360: Use specified angle
 * @param {boolean} args.outline - Controls line connection behavior:
 *                                  - true: Keep individual fill lines (for support with perimeter)
 *                                  - false: Connect nearby lines to reduce travel moves
 *
 * @modifies {Polygon} Each poly in polys array gets a new .fill property containing:
 *                     - Array of Polygon objects representing fill lines
 *                     - Lines are either individual segments (outline=true) or
 *                       connected paths (outline=false) for travel reduction
 * 
 * @see layerSupportFill - Parent function that calls this after clipping/union
 * @see areaFill - Lower-level function that generates the actual scan lines
 * @see connect_lines - Utility that connects nearby line segments
 * @see CONSTANTS.SUPPORT_AUTO_ANGLE_WIDE - Auto angle for wide polygons (1090 = 90°)
 * @see CONSTANTS.SUPPORT_AUTO_ANGLE_TALL - Auto angle for tall polygons (1000 = 0°)
 * @see CONSTANTS.SUPPORT_INSET_RATIO - Inset ratio for fill area (1/3)
 * @see CONSTANTS.SUPPORT_CONNECT_DISTANCE_MULT - Distance multiplier for line connection (2x)
 */
function supportPolyFill({ promises, polys, lineWidth, density, z, isBelt, angle, outline, spacingGap, minLine, tieLayer, tieSpacing, edge, thinLen, flush, finGap, columns, phase }) {
    // calculate fill spacing: an explicit open gap between lines (mm) wins over density
    let spacing = spacingGap > 0 ? lineWidth + spacingGap : lineWidth * (1 / density);
    for (let poly of polys) {
        // columns mode: hollow ribs at the region's column positions
        if (columns && !poly.solidPlate && poly.colRegion && !promises) {
            poly.fill = supportColumnFill(poly, columns, z, lineWidth, tieLayer, tieSpacing);
            continue;
        }
        // pillar spacing for thin (contact zone) support is the dash period along the line
        let thin = poly.thinSupport && thinLen > 0 && !tieLayer;
        // base plate polygons print solid (adjacent lines, no gaps)
        let polySpacing = poly.solidPlate ? lineWidth * 0.9 : (tieLayer ? Math.max(spacing, tieSpacing) : spacing);
        // calculate angle based on width/height ratio
        let auto = isBelt || (poly.bounds.width() / poly.bounds.height() > 1) ?
            CONSTANTS.SUPPORT_AUTO_ANGLE_WIDE :
            CONSTANTS.SUPPORT_AUTO_ANGLE_TALL;
        // inset support poly for fill lines
        let inset = POLY.offset([poly], -lineWidth * CONSTANTS.SUPPORT_INSET_RATIO, {flat: true, z, wasm: true});
        // do the fill
        if (inset && inset.length > 0) {
            // sliceSupportFinGap: fin columns spread evenly across the region, the first
            // and last on its edges (belt support, fins along y, not on tie layers)
            let finAng = (angle || auto) % 1000;
            let fins = finGap > 0 && isBelt && !promises && !poly.solidPlate && !tieLayer && Math.abs(finAng - 90) < 1;
            if (fins) {
                supportFinColumns(inset, finGap, poly.fill = [], minLine);
            } else
            areaFill({
                angle: tieLayer && !poly.solidPlate ? CONSTANTS.SUPPORT_AUTO_ANGLE_TALL : (angle || auto),
                output: poly.fill = [],
                polys: inset,
                promises,
                // tie layers use a wide, sparse spacing so only a few cross lines are drawn
                spacing: polySpacing,
                // drop fill lines shorter than this (mm): removes scraps at polygon edges
                minLen: minLine > 0 && !tieLayer && !poly.solidPlate ? minLine : undefined
            });
            // a small region can fall between the grid lines and get no fill at all
            // (a belt support region ends in a few mm of narrow column): give it one
            // pillar along its center line so the support does not stop short
            if (thin && !poly.fill.length) {
                let ang = (angle || auto) % 1000;
                let vert = Math.abs(Math.abs(ang) - 90) < 1;
                if (vert || Math.abs(ang) < 1) {
                    for (let ip of inset) {
                        let b = ip.bounds.clone();
                        // the first scan line sits on the start edge of the bounds
                        if (vert) { if (ang > 0) b.maxx = (b.minx + b.maxx) / 2; else b.minx = (b.minx + b.maxx) / 2; }
                        else b.miny = (b.miny + b.maxy) / 2;
                        let saved = ip._bounds;
                        let spacing1 = Math.max(b.width(), b.height()) * 2 + 10;
                        ip._bounds = b;
                        let extra = [];
                        areaFill({
                            angle: ang,
                            output: extra,
                            polys: [ ip ],
                            spacing: spacing1
                        });
                        ip._bounds = saved;
                        for (let i = 0; i + 1 < extra.length; i += 2) {
                            poly.fill.push(extra[i], extra[i + 1]);
                        }
                    }
                }
            }
            // thin (contact zone) support: short dashes on a fixed grid, vertical pillars
            if (thin && poly.fill.length) {
                poly.fill = dash_lines(poly.fill, thinLen, thinLen + Math.max(spacing - lineWidth, 1), phase || 0);
            }
            // edge fins: one fill line flush with each side of the region, so the
            // outermost column sits on the support edge instead of up to a grid step inside it
            if (edge && !fins && !poly.solidPlate && !poly.thinSupport && !tieLayer && !promises && isBelt) {
                let shrink = lineWidth * 0.3;
                for (let ip of inset) {
                    for (let ang of [ 90, -90 ]) {
                        let b = ip.bounds.clone();
                        if (ang > 0) b.maxx -= shrink; else b.minx += shrink;
                        let saved = ip._bounds;
                        ip._bounds = b;
                        let extra = [];
                        areaFill({
                            angle: ang,
                            output: extra,
                            polys: [ ip ],
                            // wider than the region: exactly one scan line, at the start edge
                            spacing: b.width() * 2 + 10,
                            minLen: minLine > 0 ? minLine : undefined
                        });
                        ip._bounds = saved;
                        // keep only complete lines (point pairs)
                        for (let i = 0; i + 1 < extra.length; i += 2) {
                            poly.fill.push(extra[i], extra[i + 1]);
                        }
                    }
                }
            }
            if (!outline && poly.fill.length && !thin) {
                let ok = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
                let joined = connect_lines(poly.fill, spacing * CONSTANTS.SUPPORT_CONNECT_DISTANCE_MULT);
                // keep the unconnected lines if joining produced invalid points
                poly.fill = joined.every(ok) ? joined : poly.fill.filter(ok);
            }
            // sliceSupportFlush: a continuous line right along the support footprint
            // (flush > 0: its outer face sits this many mm inside the footprint edge,
            // which is the part's underside outline, or the clearance line at a wall).
            // grid lines, dashes and edge fins leave the rim open: dashes have gaps
            // along the edge and stop up to a dash length short of the ends, so the
            // outermost bottom layers hang over nothing
            if (flush > 0 && !outline && !promises && !poly.solidPlate) {
                supportFlushRim(poly, z, lineWidth, flush);
            }
        }
    }
}

/**
 * Support only where it is held up. After the fills, each layer (bottom up) is tested
 * against what is printed under it: support lines of the two layers below, the part
 * of the layer below, and the belt plane, all within tol mm (a column moves dy per
 * layer sideways). Lines are followed along their chains (rim loops, ties, ribs): a
 * stretch that is not held up is a bridge when both ends are held up and it is at most
 * 12 mm long, anything else (a cantilever, a floating piece) is cut away. Plate
 * polygons are left alone.
 *
 * @param {Slice[]} slices bottom up
 * @param {number} tol how far from supporting material a line may be (mm)
 * @param {number} lw line width
 * @param {number} dy sideways move of a vertical column per layer in y (mm)
 * @param {object} belt belt data (slope), if any
 * @returns {number} mm of line removed
 */
function anchorFills(slices, tol, lw, dy, belt) {
    const G = 0.25, BRIDGE = 12, R = Math.max(1, Math.ceil(tol / G));
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (let slice of slices) {
        for (let p of slice.supports || []) {
            minx = Math.min(minx, p.bounds.minx); maxx = Math.max(maxx, p.bounds.maxx);
            miny = Math.min(miny, p.bounds.miny); maxy = Math.max(maxy, p.bounds.maxy);
        }
        for (let p of slice.topPolys() || []) {
            minx = Math.min(minx, p.bounds.minx); maxx = Math.max(maxx, p.bounds.maxx);
            miny = Math.min(miny, p.bounds.miny); maxy = Math.max(maxy, p.bounds.maxy);
        }
    }
    if (!isFinite(minx)) return 0;
    minx -= 4; miny -= 4;
    let nx = Math.ceil((maxx + 4 - minx) / G) + 2, ny = Math.ceil((maxy + 4 - miny) / G) + 2;
    let idx = (x, y) => {
        let ix = Math.round((x - minx) / G), iy = Math.round((y - miny) / G);
        return ix < 0 || iy < 0 || ix >= nx || iy >= ny ? -1 : iy * nx + ix;
    };
    let rl = Math.max(1, Math.round(lw / 2 / G));
    let stamp = (m, x, y) => {
        let ix = Math.round((x - minx) / G), iy = Math.round((y - miny) / G);
        for (let a = -rl; a <= rl; a++) for (let b = -rl; b <= rl; b++) {
            let jx = ix + a, jy = iy + b;
            if (jx >= 0 && jy >= 0 && jx < nx && jy < ny) m[jy * nx + jx] = 1;
        }
    };
    let stampLine = (m, a, b) => {
        let n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (G * 0.8)));
        for (let i = 0; i <= n; i++) stamp(m, a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n);
    };
    // even-odd scanline fill of the rings of polygons
    let fillPolys = (m, polys) => {
        let rings = [];
        for (let p of polys) {
            rings.push(p.points);
            for (let h of p.inner || []) rings.push(h.points);
        }
        for (let iy = 0; iy < ny; iy++) {
            let y = miny + iy * G, xs = [];
            for (let r of rings) {
                for (let i = 0, n = r.length; i < n; i++) {
                    let a = r[i], b = r[(i + 1) % n];
                    if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x));
                }
            }
            if (xs.length < 2) continue;
            xs.sort((u, v) => u - v);
            for (let k = 0; k + 1 < xs.length; k += 2) {
                let i0 = Math.max(0, Math.ceil((xs[k] - minx) / G)), i1 = Math.min(nx - 1, Math.floor((xs[k + 1] - minx) / G));
                for (let ix = i0; ix <= i1; ix++) m[iy * nx + ix] = 1;
            }
        }
    };
    let dilate = m => {
        let t = new Uint8Array(m.length), o = new Uint8Array(m.length);
        for (let iy = 0; iy < ny; iy++) {
            for (let ix = 0; ix < nx; ix++) {
                if (!m[iy * nx + ix]) continue;
                for (let a = Math.max(0, ix - R); a <= Math.min(nx - 1, ix + R); a++) t[iy * nx + a] = 1;
            }
        }
        for (let iy = 0; iy < ny; iy++) {
            for (let ix = 0; ix < nx; ix++) {
                if (!t[iy * nx + ix]) continue;
                for (let b = Math.max(0, iy - R); b <= Math.min(ny - 1, iy + R); b++) o[b * nx + ix] = 1;
            }
        }
        return o;
    };
    let held = [];   // dilated (printed support or part) of each processed layer
    let removed = 0;
    let key = pt => Math.round(pt.x * 20) + ',' + Math.round(pt.y * 20);
    slices.forEach((slice, j) => {
        let skewy = belt ? slice.z * belt.slope : Infinity;
        let isHeld = (x, y) => {
            if (y >= skewy - tol) return true;
            for (let k = 1; k <= 2; k++) {
                let m = held[j - k];
                if (!m) continue;
                let i = idx(x, y + dy * k);
                if (i >= 0 && m[i]) return true;
            }
            return false;
        };
        let printed = new Uint8Array(nx * ny);
        for (let poly of slice.supports || []) {
            let fill = poly.fill;
            if (poly.solidPlate || !fill || fill.length < 2 || j < 1) {
                if (fill) for (let i = 0; i + 1 < fill.length; i += 2) stampLine(printed, fill[i], fill[i + 1]);
                continue;
            }
            // split every line where it changes between held and not held
            let edges = [];
            for (let i = 0; i + 1 < fill.length; i += 2) {
                let a = fill[i], b = fill[i + 1];
                let len = Math.hypot(b.x - a.x, b.y - a.y);
                let m = Math.max(1, Math.ceil(len / G));
                let flags = [];
                for (let q = 0; q <= m; q++) flags.push(isHeld(a.x + (b.x - a.x) * q / m, a.y + (b.y - a.y) * q / m));
                // an edge is held when most of its samples are
                let q = 0;
                while (q < m) {
                    let q0 = q, f = flags[q] && flags[q + 1];
                    while (q + 1 < m && (flags[q + 1] && flags[q + 2]) === f) q++;
                    q++;
                    let p1 = a.clone(), p2 = a.clone();
                    p1.x = a.x + (b.x - a.x) * q0 / m; p1.y = a.y + (b.y - a.y) * q0 / m;
                    p2.x = a.x + (b.x - a.x) * q / m; p2.y = a.y + (b.y - a.y) * q / m;
                    p1.index = p2.index = a.index;
                    edges.push({ p1, p2, held: f, len: len * (q - q0) / m, k1: key(p1), k2: key(p2) });
                }
            }
            // components of edges that are not held (through shared end points)
            let byNode = new Map();
            edges.forEach((ed, i) => {
                for (let kk of [ ed.k1, ed.k2 ]) {
                    if (!byNode.has(kk)) byNode.set(kk, []);
                    byNode.get(kk).push(i);
                }
            });
            let state = new Uint8Array(edges.length);   // 1 = visited free edge, 2 = cut
            for (let i0 = 0; i0 < edges.length; i0++) {
                if (edges[i0].held || state[i0]) continue;
                let comp = [], stack = [ i0 ], contacts = [], total = 0;
                state[i0] = 1;
                while (stack.length) {
                    let i = stack.pop();
                    comp.push(i);
                    total += edges[i].len;
                    for (let [ kk, pt ] of [ [ edges[i].k1, edges[i].p1 ], [ edges[i].k2, edges[i].p2 ] ]) {
                        for (let o of byNode.get(kk)) {
                            if (edges[o].held) {
                                if (!contacts.some(c => Math.hypot(c.x - pt.x, c.y - pt.y) < 3)) contacts.push(pt);
                            } else if (!state[o]) {
                                state[o] = 1;
                                stack.push(o);
                            }
                        }
                    }
                }
                // a free stretch survives as a bridge: held at two places, short
                let ok = total <= tol || (contacts.length >= 2 && total <= BRIDGE);
                if (!ok) {
                    for (let i of comp) state[i] = 2;
                    removed += total;
                }
            }
            let keepPts = [];
            edges.forEach((ed, i) => { if (state[i] !== 2 && ed.len > 0.01) keepPts.push(ed.p1, ed.p2); });
            poly.fill = keepPts;
            for (let i = 0; i + 1 < keepPts.length; i += 2) stampLine(printed, keepPts[i], keepPts[i + 1]);
        }
        fillPolys(printed, slice.topPolys() || []);
        held[j] = dilate(printed);
    });
    return removed;
}

/**
 * Settings for the belt 'columns' support mode
 */
function columnsConfig(process) {
    let mode = process.sliceSupportColMode || 'mm';
    return {
        mode,
        // clear gap between neighbouring column faces (percent: of the region width,
        // mm, count: the number of columns)
        space: process.sliceSupportColSpace > 0 ? process.sliceSupportColSpace : (mode === 'count' ? 5 : mode === 'mm' ? 10 : 25),
        // base and top column width (percent: of the region size, mm, count mode: mm)
        base: process.sliceSupportColBase > 0 ? process.sliceSupportColBase : (mode === 'percent' ? 11 : 3.4),
        top: process.sliceSupportColTop > 0 ? process.sliceSupportColTop : (mode === 'percent' ? 6 : 1.9),
        shells: Math.max(1, Math.round(process.sliceSupportColShells || 1)),
        fill: Math.max(0, Math.min(100, process.sliceSupportColFill || 0)),
        flush: process.sliceSupportFlush || 0,
        // style 'pillars': a grid of separate pillars instead of continuous ribs
        style: process.sliceSupportColStyle === 'pillars' ? 'pillars' : 'ribs',
        // pillars: clear gap along the belt, same unit rule as the column gap
        rowGap: process.sliceSupportColGap > 0 ? process.sliceSupportColGap : (mode === 'count' ? 4 : mode === 'mm' ? 10 : 25),
        // pillars: length of a base pillar along the belt in mm (0 = as wide as its column)
        pillarLen: process.sliceSupportPillarLen > 0 ? process.sliceSupportPillarLen : 0,
        // rim line zone (ribs and pillars): 0 off, 1 contact (thin) zone only, 2 everywhere
        rim: process.sliceSupportColRim === undefined || process.sliceSupportColRim === null ? 1 : Math.max(0, Math.min(2, Math.round(process.sliceSupportColRim))),
        // rim line: 'continuous', 'perforated' (about 10 mm lines with 2 mm gaps, breaks off in pieces) or 'off'
        rimStyle: process.sliceSupportRimStyle === 'perforated' ? 'perforated' : process.sliceSupportRimStyle === 'off' ? 'off' : 'continuous',
        // vertical support moves sideways with the layers: u = y + shear * z stays constant along a pillar
        shear: 0,
        grids: null
    };
}

/**
 * Column layout along one axis. Widths are independent of the gap: the number of
 * columns follows from the size, the gap and the width (the gap is the largest clear
 * gap wanted), the outer columns are flush with the ends and the pitch is adjusted
 * evenly (the clear gap is pitch - width).
 *
 * @param {number} extent size along the axis (mm)
 * @param {number} gap wanted clear gap (mm)
 * @param {number} wb base width (mm)
 * @param {number} wt top width (mm)
 * @param {number} count fixed number of columns (0 = from the gap)
 */
function layoutAxis(extent, gap, wb, wt, count, lw) {
    wb = Math.max(lw, wb);
    wt = Math.max(lw, Math.min(wt, wb));
    if (!(extent > 2 * wb + lw)) return { n: 1, pitch: 0, wb: Math.max(lw, extent), wt: Math.max(lw, extent) };
    // the gap is an upper bound for the clear gap between the TOP faces (the contact): as
    // many columns as needed to keep it at or under the wanted gap
    let n = count > 0 ? Math.max(2, Math.round(count)) : Math.max(2, Math.ceil((extent - wb) / (wt + gap) - 1e-6) + 1);
    let pitch = (extent - wb) / (n - 1);
    // columns closer than their width would merge: fewer columns
    while (n > 2 && pitch < wb * 1.15) { n--; pitch = (extent - wb) / (n - 1); }
    wb = Math.min(wb, pitch * 0.95);
    wt = Math.min(wt, wb);
    return { n, pitch, wb, wt };
}

/**
 * Gap, widths and count for a region size in the chosen unit (columns across: the
 * gap is cfg.space, rows along the belt: cfg.rowGap)
 */
function axisParams(cfg, extent, gapValue) {
    if (cfg.mode === 'percent') {
        // widths above a quarter of the region would leave no gap: values from before the
        // widths became independent of the spacing (60 / 33 %) end up capped
        return { gap: gapValue / 100 * extent, wb: Math.min(cfg.base, 25) / 100 * extent, wt: Math.min(cfg.top, 15) / 100 * extent, count: 0 };
    }
    if (cfg.mode === 'count') {
        return { gap: 0, wb: cfg.base, wt: cfg.top, count: gapValue };
    }
    return { gap: gapValue, wb: cfg.base, wt: cfg.top, count: 0 };
}

/**
 * Group the support polygons of a layer into regions (the thin and wide pieces of
 * one support region touch each other) and work out the column positions once per
 * region, so the base and the top of a column share the same position.
 *
 * Each polygon gets .colRegion = { minx, maxx, count, pitch, centers, base }
 */
function groupSupportPolys(polys) {
    let list = polys.filter(p => !p.solidPlate && p.points.length >= 3);
    let parent = list.map((p, i) => i);
    let find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
    let tol = 0.6;
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            let a = list[i].bounds, b = list[j].bounds;
            if (a.minx <= b.maxx + tol && b.minx <= a.maxx + tol && a.miny <= b.maxy + tol && b.miny <= a.maxy + tol) {
                parent[find(i)] = find(j);
            }
        }
    }
    let groups = new Map();
    list.forEach((p, i) => {
        let r = find(i);
        if (!groups.has(r)) groups.set(r, []);
        groups.get(r).push(p);
    });
    return [ ...groups.values() ];
}

function assignColumnRegions(polys, cfg, lineWidth) {
    let prevList = cfg.lastRegions || [], nextList = [];
    cfg.lastRegions = nextList;
    for (let members of groupSupportPolys(polys)) {
        // the extent of a region comes from its real pieces: a sliver (a strip in a channel
        // of the part, a tongue under a fillet) joins the cluster and would move the columns
        let solid = members.filter(p => {
            let per = p.perimeter();
            return per > 0 && 2 * Math.abs(p.area()) / per >= 3 * lineWidth;
        });
        let minx = Infinity, maxx = -Infinity;
        for (let p of solid.length ? solid : members) {
            minx = Math.min(minx, p.bounds.minx);
            maxx = Math.max(maxx, p.bounds.maxx);
        }
        let x0 = minx + cfg.flush, x1 = maxx - cfg.flush;
        let extent = x1 - x0;
        let ap = axisParams(cfg, extent, cfg.space);
        let lay = layoutAxis(extent, ap.gap, ap.wb, ap.wt, ap.count, lineWidth);
        let region = { minx: x0, maxx: x1, count: lay.n, pitch: lay.pitch, base: lay.wb, top: lay.wt, centers: [ (x0 + x1) / 2 ] };
        if (lay.n > 1) {
            region.centers = [];
            for (let i = 0; i < lay.n; i++) region.centers.push(x0 + lay.wb / 2 + lay.pitch * i);
        }
        // the same region on the layer below keeps its columns: the extent of a cluster
        // changes a little from layer to layer (a tongue joins or leaves) and the columns
        // would otherwise stand a few mm beside the ones below, floating
        let prev = prevList.find(r => {
            let ov = Math.min(r.maxx, region.maxx) - Math.max(r.minx, region.minx);
            return ov > 0.6 * Math.min(r.maxx - r.minx, region.maxx - region.minx) && Math.abs(r.minx - region.minx) < 5 && Math.abs(r.maxx - region.maxx) < 5;
        });
        if (prev) region = prev;
        nextList.push(region);
        for (let p of members) p.colRegion = region;
    }
}

/**
 * Fill one support polygon with hollow ribs (columns). Columns run along y, one per
 * region column position; the edge columns keep their outer face on the region edge.
 * A rib is a loop of shells with an optional inner fill; one too narrow for its
 * shells collapses to solid lines. Tie layers add cross lines over the ribs.
 *
 * @returns {Point[]} point pairs (fill lines)
 */
function supportColumnFill(poly, cfg, z, lineWidth, tieLayer, tieSpacing) {
    let region = poly.colRegion;
    if (cfg.style === 'pillars' && cfg.grids && cfg.grids.length && !cfg.noGrid) {
        return supportPillarFill(poly, cfg, z, lineWidth, tieLayer, tieSpacing);
    }
    let out = [];
    let idx = 0;
    let pair = (a, b) => {
        let p1 = a.clone(), p2 = b.clone();
        p1.index = p2.index = idx;
        out.push(p1, p2);
    };
    let ring = pts => {
        if (!pts || pts.length < 3) return;
        let keep = [ pts[0] ];
        for (let i = 1; i < pts.length; i++) {
            if (pts[i].distTo2D(keep[keep.length - 1]) >= 0.15) keep.push(pts[i]);
        }
        if (keep.length > 2 && keep[0].distTo2D(keep[keep.length - 1]) < 0.15) keep.pop();
        if (keep.length < 3) return;
        for (let i = 0; i < keep.length; i++) { pair(keep[i], keep[(i + 1) % keep.length]); idx++; }
    };
    let loops = polys => {
        for (let q of polys || []) {
            ring(q.points);
            for (let h of q.inner || []) ring(h.points);
        }
    };
    let lw = lineWidth;
    let step = lw * 0.9;
    let thin = !!poly.thinSupport;
    let b = poly.bounds;
    let ymid = (b.miny + b.maxy) / 2, yh = b.maxy - b.miny + 4;
    for (let i = 0; i < region.count; i++) {
        let last = i === region.count - 1;
        let first = i === 0;
        // width of this column here: base (wide) or top (thin) in mm
        let w = region.count === 1 ? region.base : (thin ? region.top : region.base);
        w = Math.max(lw, w);
        let x0, x1;
        if (region.count === 1) {
            x0 = region.minx; x1 = region.maxx;
        } else if (first) {
            x0 = region.minx; x1 = x0 + w;
        } else if (last) {
            x1 = region.maxx; x0 = x1 - w;
        } else {
            let c = region.centers[i];
            x0 = c - w / 2; x1 = c + w / 2;
        }
        if (x1 - x0 < lw * 0.5) continue;
        let rect = newPolygon().centerRectangle(newPoint((x0 + x1) / 2, ymid, z), x1 - x0, yh);
        let shapes = POLY.trimTo([ poly.clone(true) ], [ rect ]) || [];
        shapes = shapes.filter(sh => Math.abs(sh.area()) > lw * lw);
        for (let shape of shapes) {
            let width = x1 - x0;
            let o = { flat: true, z, wasm: true };
            if (width < (2 * cfg.shells + 1) * step) {
                // too narrow for hollow: solid lines along the rib, evenly spread over
                // its width (one line when it is no wider than two line widths)
                let core = POLY.offset([ shape.clone(true) ], -lw / 2, o) || [];
                if (!core.length) core = [ shape ];
                let span = Math.max(0, width - lw);
                let n = span < lw * 0.3 ? 1 : Math.ceil(span / lw - 0.02) + 1;
                for (let k = 0; k < n; k++) {
                    let x = n === 1 ? (x0 + x1) / 2 : x0 + lw / 2 + 0.02 + (span - 0.04) * k / (n - 1);
                    for (let ip of core) {
                        let bb = ip.bounds.clone();
                        bb.maxx = x;
                        bb.minx = x - 1;
                        let saved = ip._bounds;
                        ip._bounds = bb;
                        let lines = [];
                        POLY.fillArea([ ip ], 90, 1000, lines);
                        ip._bounds = saved;
                        for (let m = 0; m + 1 < lines.length; m += 2) pair(lines[m], lines[m + 1]);
                    }
                }
                idx++;
                continue;
            }
            for (let s = 0; s < cfg.shells; s++) {
                let ring_ = POLY.offset([ shape.clone(true) ], -(lw / 2 + s * step), o) || [];
                loops(ring_);
            }
            if (cfg.fill > 0) {
                let inner = POLY.offset([ shape.clone(true) ], -(lw / 2 + (cfg.shells - 1) * step + lw), o) || [];
                if (inner.length) {
                    let lines = [];
                    POLY.fillArea(inner, 90, lw / (cfg.fill / 100), lines);
                    for (let k = 0; k + 1 < lines.length; k += 2) pair(lines[k], lines[k + 1]);
                }
            }
            idx++;
        }
    }
    // tie layers: cross lines over the whole region keep the ribs together
    if (tieLayer && region.count > 1) {
        let inset = POLY.offset([ poly.clone(true) ], -lw / 3, { flat: true, z, wasm: true }) || [];
        if (inset.length) {
            let lines = [];
            POLY.fillArea(inset, 0, tieSpacing, lines);
            for (let k = 0; k + 1 < lines.length; k += 2) pair(lines[k], lines[k + 1]);
        }
    }
    // flush edge: the continuous rim line along the region footprint (replaces the
    // outer wall of the edge columns), so the underside outline is covered between
    // the columns too
    if (cfg.flush > 0 && cfg.rimStyle !== 'off' && (cfg.rim === 2 || (cfg.rim === 1 && thin))) {
        poly.fill = out;
        supportFlushRim(poly, z, lineWidth, cfg.flush, cfg.rimStyle === 'perforated');
        return poly.fill;
    }
    return out;
}

/**
 * Pillars: lay out one grid per underside (roof) region. The roof is the overhang
 * shadow of a layer (at least 60 mm2); its extent across (x) and along the belt (u =
 * y + shear * z, constant along a vertical pillar) gives the columns and the rows,
 * the outer ones flush with the roof ends. A support polygon on any layer is then
 * filled with the pillars of the grids it overlaps.
 */
function planPillarGrids(slices, cfg, lw) {
    let grids = [];
    for (let slice of slices) {
        for (let p of slice.shadow || []) {
            if (Math.abs(p.area()) < 60) continue;
            let b = p.bounds;
            let g = { x0: b.minx, x1: b.maxx, u0: b.miny + cfg.shear * slice.z, u1: b.maxy + cfg.shear * slice.z };
            let same = grids.find(o => {
                let xo = Math.min(g.x1, o.x1) - Math.max(g.x0, o.x0);
                let uo = Math.min(g.u1, o.u1) - Math.max(g.u0, o.u0);
                return xo > 0.5 * Math.min(g.x1 - g.x0, o.x1 - o.x0) && uo > 0.5 * Math.min(g.u1 - g.u0, o.u1 - o.u0);
            });
            if (same) {
                same.x0 = Math.min(same.x0, g.x0); same.x1 = Math.max(same.x1, g.x1);
                same.u0 = Math.min(same.u0, g.u0); same.u1 = Math.max(same.u1, g.u1);
            } else {
                grids.push(g);
            }
        }
    }
    for (let g of grids) {
        let x0 = g.x0 + cfg.flush, x1 = g.x1 - cfg.flush;
        let ap = axisParams(cfg, x1 - x0, cfg.space);
        let cl = layoutAxis(x1 - x0, ap.gap, ap.wb, ap.wt, ap.count, lw);
        g.cols = { x0, x1, n: cl.n, pitch: cl.pitch, wb: cl.wb, wt: cl.wt };
        // rows along the belt: pillar length = pillarLen (base) or the column width
        if (cfg.style !== 'pillars') {
            // ribs: one row along the whole underside, clipped to the support polygon
            g.rows = { u0: g.u0 - 0.5, u1: g.u1 + 0.5, n: 1, pitch: 0, wb: g.u1 - g.u0 + 1, wt: g.u1 - g.u0 + 1 };
            continue;
        }
        let u0 = g.u0 + cfg.flush, u1 = g.u1 - cfg.flush;
        let rp = axisParams(cfg, u1 - u0, cfg.rowGap);
        let Lb = cfg.pillarLen > 0 ? cfg.pillarLen : cl.wb;
        let Lt = cfg.pillarLen > 0 ? cfg.pillarLen * (cl.wt / cl.wb) : cl.wt;
        let rl = layoutAxis(u1 - u0, rp.gap, Lb, Lt, rp.count, lw);
        g.rows = { u0, u1, n: rl.n, pitch: rl.pitch, wb: rl.wb, wt: rl.wt };
    }
    return grids;
}

// strips of an axis layout for a base (wide) or top (thin) pillar: [ lo, hi ] pairs
function axisStrips(ax, lo, hi, thin) {
    let w = thin ? ax.wt : ax.wb;
    let out = [];
    if (ax.n === 1) return [ [ lo, hi ] ];
    for (let i = 0; i < ax.n; i++) {
        if (i === 0) out.push([ lo, lo + w ]);
        else if (i === ax.n - 1) out.push([ hi - w, hi ]);
        else { let c = lo + ax.wb / 2 + ax.pitch * i; out.push([ c - w / 2, c + w / 2 ]); }
    }
    return out;
}

/**
 * Pillars style of the columns mode: a grid of separate pillars. A pillar is the
 * support polygon cut to one grid cell (a column strip and a row strip). Wide base
 * pillars and thin top pillars share the grid positions (edge pillars keep their
 * outer face on the region edge); a pillar is a hollow loop, or solid lines when too
 * small for its shells. Tie layers print the grid lines through the pillar centers in
 * both directions, the rim line covers the underside edge. Parts of the support
 * outside every grid get the ribs style.
 */
function supportPillarFill(poly, cfg, z, lw, tieLayer, tieSpacing) {
    let out = [];
    let idx = 0;
    let pair = (a, b) => {
        let p1 = a.clone(), p2 = b.clone();
        p1.index = p2.index = idx;
        out.push(p1, p2);
    };
    let ring = pts => {
        if (!pts || pts.length < 3) return;
        let keep = [ pts[0] ];
        for (let i = 1; i < pts.length; i++) {
            if (pts[i].distTo2D(keep[keep.length - 1]) >= 0.15) keep.push(pts[i]);
        }
        if (keep.length > 2 && keep[0].distTo2D(keep[keep.length - 1]) < 0.15) keep.pop();
        if (keep.length < 3) return;
        for (let i = 0; i < keep.length; i++) { pair(keep[i], keep[(i + 1) % keep.length]); idx++; }
    };
    let loops = polys => {
        for (let q of polys || []) {
            ring(q.points);
            for (let h of q.inner || []) ring(h.points);
        }
    };
    // one scan line through polygons, along y at x (dir 'y') or along x at y (dir 'x')
    let scan = (polys, v, dir) => {
        for (let ip of polys) {
            let bb = ip.bounds.clone();
            if (dir === 'y') { bb.maxx = v; bb.minx = v - 1; }
            else { bb.miny = v; bb.maxy = v + 1; }
            let saved = ip._bounds;
            ip._bounds = bb;
            let lines = [];
            POLY.fillArea([ ip ], dir === 'y' ? 90 : 0, 1000, lines);
            ip._bounds = saved;
            for (let m = 0; m + 1 < lines.length; m += 2) pair(lines[m], lines[m + 1]);
        }
    };
    let step = lw * 0.9;
    let thin = !!poly.thinSupport;
    let shear = cfg.shear;
    let b = poly.bounds;
    let o = { flat: true, z, wasm: true };
    let minside = (2 * cfg.shells + 1) * step;
    let rects = [];
    let cells = [];
    for (let g of cfg.grids) {
        // does this grid reach the polygon?
        if (g.x1 < b.minx || g.x0 > b.maxx) continue;
        if (g.u1 - shear * z < b.miny || g.u0 - shear * z > b.maxy) continue;
        let colS = axisStrips(g.cols, g.cols.x0, g.cols.x1, thin);
        let rowS = axisStrips(g.rows, g.rows.u0, g.rows.u1, thin);
        rects.push(newPolygon().centerRectangle(
            newPoint((g.x0 + g.x1) / 2, ((g.u0 + g.u1) / 2) - shear * z, z), g.x1 - g.x0, g.u1 - g.u0));
        for (let [ x0, x1 ] of colS) {
            for (let [ u0, u1 ] of rowS) {
                let y0 = u0 - shear * z, y1 = u1 - shear * z;
                if (y1 < b.miny - 0.01 || y0 > b.maxy + 0.01 || x1 < b.minx || x0 > b.maxx) continue;
                // grids of neighbouring undersides can overlap: never print a cell twice
                let area = (x1 - x0) * (y1 - y0);
                if (cells.some(c => {
                    let ov = Math.max(0, Math.min(x1, c[1]) - Math.max(x0, c[0])) * Math.max(0, Math.min(y1, c[3]) - Math.max(y0, c[2]));
                    return ov > 0.5 * Math.min(area, c[4]);
                })) continue;
                cells.push([ x0, x1, y0, y1, area ]);
                let rect = newPolygon().centerRectangle(newPoint((x0 + x1) / 2, (y0 + y1) / 2, z), x1 - x0, y1 - y0);
                let shapes = POLY.trimTo([ poly.clone(true) ], [ rect ]) || [];
                shapes = shapes.filter(sh => Math.abs(sh.area()) > lw * lw * 0.6);
                for (let shape of shapes) {
                    let sb = shape.bounds;
                    let w = sb.maxx - sb.minx, h = sb.maxy - sb.miny;
                    if (Math.min(w, h) < minside) {
                        // too small to be hollow: solid lines along the long side
                        let core = POLY.offset([ shape.clone(true) ], -lw / 2, o) || [];
                        if (!core.length) core = [ shape ];
                        let alongY = h >= w;
                        let short = alongY ? w : h;
                        let lo = alongY ? sb.minx : sb.miny;
                        let span = Math.max(0, short - lw);
                        let n = span < lw * 0.3 ? 1 : Math.ceil(span / lw - 0.02) + 1;
                        for (let k = 0; k < n; k++) {
                            let v = n === 1 ? lo + short / 2 : lo + lw / 2 + 0.02 + (span - 0.04) * k / (n - 1);
                            scan(core, v, alongY ? 'y' : 'x');
                        }
                        idx++;
                        continue;
                    }
                    for (let s2 = 0; s2 < cfg.shells; s2++) {
                        loops(POLY.offset([ shape.clone(true) ], -(lw / 2 + s2 * step), o) || []);
                    }
                    if (cfg.fill > 0) {
                        let inner = POLY.offset([ shape.clone(true) ], -(lw / 2 + (cfg.shells - 1) * step + lw), o) || [];
                        if (inner.length) {
                            let lines = [];
                            POLY.fillArea(inner, 90, lw / (cfg.fill / 100), lines);
                            for (let k = 0; k + 1 < lines.length; k += 2) pair(lines[k], lines[k + 1]);
                        }
                    }
                    idx++;
                }
            }
        }
        // tie layers: ribs get cross lines every tieSpacing mm
        if (tieLayer && cfg.style !== 'pillars' && colS.length > 1) {
            let inset = POLY.offset([ poly.clone(true) ], -lw / 3, o) || [];
            let box = newPolygon().centerRectangle(
                newPoint((g.x0 + g.x1) / 2, ((g.u0 + g.u1) / 2) - shear * z, z), g.x1 - g.x0, g.u1 - g.u0);
            inset = POLY.trimTo(inset, [ box ]) || [];
            if (inset.length) {
                let lines = [];
                POLY.fillArea(inset, 0, tieSpacing, lines);
                for (let k = 0; k + 1 < lines.length; k += 2) pair(lines[k], lines[k + 1]);
                idx++;
            }
        }
        // tie layers: the grid lines through the pillar centers, along and across
        if (tieLayer && cfg.style === 'pillars' && (colS.length > 1 || rowS.length > 1)) {
            let inset = POLY.offset([ poly.clone(true) ], -lw / 3, o) || [];
            let box = newPolygon().centerRectangle(
                newPoint((g.x0 + g.x1) / 2, ((g.u0 + g.u1) / 2) - shear * z, z), g.x1 - g.x0, g.u1 - g.u0);
            inset = POLY.trimTo(inset, [ box ]) || [];
            if (inset.length) {
                for (let [ x0, x1 ] of colS) scan(inset, (x0 + x1) / 2, 'y');
                for (let [ u0, u1 ] of rowS) scan(inset, (u0 + u1) / 2 - shear * z, 'x');
                idx++;
            }
        }
    }
    // parts of the support that no grid covers keep the ribs style
    let rest = [ poly ];
    if (rects.length) {
        rest = [];
        POLY.subtract([ poly ], rects, rest, null, z, lw * lw * 4, { wasm: false });
    }
    if (rest.length) {
        let rests = rest.filter(q => Math.abs(q.area()) > 4);
        if (rests.length) {
            let rcfg = Object.assign({}, cfg, { style: 'ribs', grids: null, noGrid: true });
            for (let q of rests) q.thinSupport = thin;
            assignColumnRegions(rests, rcfg, lw);
            for (let q of rests) {
                if (!q.colRegion) continue;
                q.fill = undefined;
                for (let pt of supportColumnFill(q, Object.assign({}, rcfg, { flush: 0 }), z, lw, tieLayer, tieSpacing)) out.push(pt);
            }
        }
    }
    // rim line along the footprint edge: contact zone only (1) or everywhere (2)
    if (cfg.flush > 0 && cfg.rimStyle !== 'off' && (cfg.rim === 2 || (cfg.rim === 1 && thin))) {
        poly.fill = out;
        supportFlushRim(poly, z, lw, cfg.flush, cfg.rimStyle === 'perforated');
        return poly.fill;
    }
    return out;
}

/**
 * sliceSupportFinGap: fin columns (vertical fill lines, along y) spread evenly
 * across the width of a support region, one on each edge. the number of columns
 * is the region width over the target gap (rounded), at least two, so the real
 * gap is between 2/3 and 2x of the target and the outer columns are flush with
 * the region edges instead of wherever a fixed grid happens to land.
 *
 * @param {Polygon[]} inset - region polygons (already inset for the line width)
 * @param {number} gap - target gap between neighbouring columns in mm
 * @param {Point[]} out - receives line end point pairs
 * @param {number} minLine - drop lines shorter than this (mm)
 */
function supportFinColumns(inset, gap, out, minLine) {
    let minx = Infinity, maxx = -Infinity;
    for (let ip of inset) {
        minx = Math.min(minx, ip.bounds.minx);
        maxx = Math.max(maxx, ip.bounds.maxx);
    }
    let extent = maxx - minx;
    if (!(extent > 0)) return;
    // keep the end columns just inside the polygon so the clipper keeps them
    let edge = Math.min(0.05, extent / 4);
    let x0 = minx + edge, x1 = maxx - edge;
    let count = Math.max(2, Math.round(extent / gap) + 1);
    for (let i = 0; i < count; i++) {
        let x = x0 + (x1 - x0) * i / (count - 1);
        for (let ip of inset) {
            let b = ip.bounds.clone();
            // narrow bounds + wide spacing = exactly one scan line, at the start edge (maxx)
            b.maxx = x;
            b.minx = x - 1;
            let saved = ip._bounds;
            ip._bounds = b;
            let lines = [];
            // spacing far beyond the region: the scan stops after the one line at maxx
            POLY.fillArea([ ip ], 90, 1000, lines, minLine > 0 ? minLine : undefined);
            ip._bounds = saved;
            for (let k = 0; k + 1 < lines.length; k += 2) {
                lines[k].index = lines[k + 1].index = i;
                out.push(lines[k], lines[k + 1]);
            }
        }
    }
}

/**
 * sliceSupportFlush: add one continuous line along the edge of a support region
 * (and around its holes) and drop the fill lines the rim already covers.
 *
 * @param {Polygon} poly - support polygon, poly.fill holds its (point pair) lines
 * @param {number} z - layer z
 * @param {number} lineWidth - extrusion width in mm
 * @param {number} flush - clearance in mm between the rim line's outer face and the
 *                         region edge (0.2 keeps it from fusing to the neighbour)
 */
function supportFlushRim(poly, z, lineWidth, flush, perforated) {
    let rims = POLY.offset([ poly ], -(flush + lineWidth / 2), { flat: true, z, wasm: true });
    if (!rims || !rims.length) return;
    let rings = [];
    for (let rim of rims) {
        rings.push(rim.points);
        for (let hole of rim.inner || []) rings.push(hole.points);
    }
    // ring segments, merged into fewer points: curves from offsets are very dense
    let segs = [];
    let minSeg = 0.15;
    for (let pts of rings) {
        if (!pts || pts.length < 3) continue;
        let keep = [ pts[0] ];
        for (let i = 1; i < pts.length; i++) {
            if (pts[i].distTo2D(keep[keep.length - 1]) >= minSeg) keep.push(pts[i]);
        }
        if (keep.length > 2 && keep[0].distTo2D(keep[keep.length - 1]) < minSeg) keep.pop();
        if (keep.length < 3) continue;
        for (let i = 0; i < keep.length; i++) {
            segs.push([ keep[i], keep[(i + 1) % keep.length] ]);
        }
    }
    if (!segs.length) return;
    // distance from a point to the nearest rim segment (the full rim, also when perforated)
    let near = p => {
        let best = Infinity;
        for (let [ a, b ] of segs) {
            let dx = b.x - a.x, dy = b.y - a.y;
            let l2 = dx * dx + dy * dy;
            let t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
            let d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
            if (d < best) best = d;
        }
        return best;
    };
    // drop fill lines that lie along the rim (both ends within a line width of it
    // and the middle too); lines that run into the rim from inside are kept
    let cover = lineWidth * 0.9;
    let fill = poly.fill, kept = [];
    for (let i = 0; i + 1 < fill.length; i += 2) {
        let a = fill[i], b = fill[i + 1];
        let mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (near(a) < cover && near(b) < cover && near(mid) < cover) continue;
        kept.push(a, b);
    }
    // one pair of points per rim segment, numbered along the loop so the fill
    // ordering walks the rim instead of jumping between segments
    let base = kept.length ? kept.reduce((m, p) => Math.max(m, p.index || 0), 0) + 1 : 0;
    if (perforated) {
        // about 10 mm of line, 2 mm of gap along each ring, so the rim snaps off in pieces
        let on = 10, off = 2, period = on + off;
        let pos = 0, n = 0;
        let emit = (a, b, t0, t1) => {
            let p1 = a.clone(), p2 = b.clone();
            p1.x = a.x + (b.x - a.x) * t0; p1.y = a.y + (b.y - a.y) * t0;
            p2.x = a.x + (b.x - a.x) * t1; p2.y = a.y + (b.y - a.y) * t1;
            p1.index = p2.index = base + n++;
            kept.push(p1, p2);
        };
        let ringStart = true;
        let lastKey = null;
        for (let [ a, b ] of segs) {
            let len = a.distTo2D(b);
            if (!(len > 0)) continue;
            // a new ring starts when this segment does not continue the last one
            if (lastKey && Math.hypot(a.x - lastKey.x, a.y - lastKey.y) > 1e-6) pos = 0;
            lastKey = b;
            let s0 = 0;
            while (s0 < len - 1e-9) {
                let ph = (pos + s0) % period;
                if (ph < on) {
                    let run = Math.min(on - ph, len - s0);
                    emit(a, b, s0 / len, (s0 + run) / len);
                    s0 += run;
                } else {
                    s0 += Math.min(period - ph, len - s0);
                }
            }
            pos += len;
        }
    } else {
        segs.forEach(([ a, b ], i) => {
            let p1 = a.clone(), p2 = b.clone();
            p1.index = p2.index = base + i;
            kept.push(p1, p2);
        });
    }
    poly.fill = kept;
}

/**
 * Project solid areas up or down through slices
 * 
 * @param {Object} args - Options object
 * @param {Slice} args.slice - Current slice
 * @param {Polygon[]} args.polys - Polygons to project
 * @param {number} args.count - Number of layers to project
 * @param {boolean} args.up - Project upward (true) or downward (false)
 * @param {boolean} args.first - First projection (hint fill angles)
 */
function projectSolid({ slice, polys, count, up, first }) {
    if (slice && !up && count === 1) {
        slice.isBridgeLayer = true;
    }

    if (!slice || count <= 0) {
        return;
    }

    let clones = polys.clone(true);
    if (first) {
        for (let clone of clones) {
            clone.hintFillAngle();
        }
    }

    if (slice.solids) {
        slice.solids.appendAll(clones);
    } else if (clones && clones.length) {
        console.log({no_solids_in: slice, for: clones})
    }

    if (count > 0) {
        projectSolid({
            count: count - 1,
            first: false,
            polys,
            slice: up ? slice.up : slice.down,
            up
        });
    }
}

/**
 * project bottom flats down into part
 */
export function projectFlats(slice, count, expand) {
    if (!slice.down || !slice.flats) return;
    // these flats are marked for finishing print speed
    if (slice.flats?.length) {
        slice.finishSolids = true;
        slice.isFlatsLayer = true;
        const polys = expand ? POLY.expand(slice.flats, expand) : slice.flats;
        projectSolid({ slice, polys, count, up: false, first: true });
    }
}

/**
 * project top bridges up into part
 */
export function projectBridges(slice, count, expand) {
    if (!slice.up || !slice.bridges) return;
    // these bridges are marked for finishing print speed
    if (slice.bridges?.length) {
        slice.finishSolids = true;
        slice.isBridgeLayer = true;
        const polys = expand ? POLY.expand(slice.bridges, expand) : slice.bridges;
        projectSolid({ slice, polys, count, up: true, first: true });
    }
}
