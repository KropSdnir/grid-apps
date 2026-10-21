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
