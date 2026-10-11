// Body proportions for rig-animal.js: quadruped builder data (dog, cat, horse, rabbit, cow, sheep),
// their head shapes, and the bird builder data (pigeon, chicken, duck).

// Quadruped proportions in withers heights (size = withers height in meters). Leg bones are [dy, dz]:
// [upper (to elbow / stifle), lower (to wrist / hock), foot (to the toe contact; its dy is solved to reach the ground)].
// Trunk parts are [[cx, cy, cz], [rx, ry, rz]] ellipsoids in the frame of the joint that carries them.
export const QUADS = {
  dog: {
    label: "狗", size: 0.55, hipY: 0.74, half: 0.34, spineDy: 0.02, chestDy: 0, w: 0.095,
    shoulder: [-0.08, 0.06], front: [[-0.2, -0.08], [-0.33, 0], [0, 0.05]],
    hip: [-0.02, 0], back: [[-0.25, 0.13], [-0.25, -0.16], [0, 0.04]],
    neckBase: [0.06, 0.07], neck: [0.18, 0.19], neckR: [0.12, 0.085],
    tailBase: [0.12, -0.17], tail: [[-0.05, -0.14], [-0.08, -0.13], [-0.07, -0.12]], tailR: [0.045, 0.024],
    rib: [[0, -0.05, -0.14], [0.15, 0.24, 0.3]], fore: [[0, -0.1, 0.04], [0.12, 0.17, 0.14]],
    loin: [[0, 0.05, -0.12], [0.12, 0.15, 0.25]], rump: [[0, 0.06, -0.02], [0.13, 0.17, 0.18]],
    frontR: [0.08, 0.06, 0.045], backR: [0.11, 0.06, 0.045], paw: [0.05, 0.032, 0.065], head: "dog", headTop: 0.13,
  },
  cat: {
    label: "貓", size: 0.25, hipY: 0.82, half: 0.44, spineDy: -0.02, chestDy: -0.04, w: 0.11,
    shoulder: [-0.1, 0.06], front: [[-0.16, -0.07], [-0.38, 0.02], [0, 0.05]],
    hip: [-0.02, 0], back: [[-0.25, 0.16], [-0.3, -0.2], [0, 0.04]],
    neckBase: [0.06, 0.08], neck: [0.13, 0.14], neckR: [0.1, 0.085],
    tailBase: [0.08, -0.2], tail: [[0.05, -0.3], [0.3, -0.12], [0.24, 0.06]], tailR: [0.045, 0.032],
    rib: [[0, -0.03, -0.18], [0.16, 0.21, 0.36]], fore: [[0, -0.08, 0.04], [0.13, 0.15, 0.13]],
    loin: [[0, 0.02, -0.15], [0.15, 0.17, 0.32]], rump: [[0, 0.04, -0.04], [0.16, 0.18, 0.2]],
    frontR: [0.08, 0.055, 0.045], backR: [0.115, 0.06, 0.045], paw: [0.05, 0.032, 0.055], head: "cat", headTop: 0.24,
  },
  horse: {
    label: "馬", size: 1.6, hipY: 0.8, half: 0.31, spineDy: -0.02, chestDy: 0.03, w: 0.1,
    shoulder: [-0.13, 0.08], front: [[-0.12, -0.08], [-0.27, 0], [0, 0.05]],
    hip: [-0.04, 0.02], back: [[-0.22, 0.13], [-0.25, -0.18], [0, 0.05]],
    neckBase: [0.1, 0.1], neck: [0.33, 0.32], neckR: [0.1, 0.07],
    tailBase: [0.17, -0.22], tail: [[-0.06, -0.08], [-0.25, -0.06], [-0.24, 0]], tailR: [0.045, 0.035],
    rib: [[0, -0.06, -0.16], [0.17, 0.22, 0.34]], fore: [[0, -0.1, 0.04], [0.13, 0.17, 0.12]],
    withers: [[0, 0.12, -0.08], [0.06, 0.07, 0.15]],
    loin: [[0, 0.02, -0.06], [0.16, 0.17, 0.28]], rump: [[0, 0.03, -0.03], [0.17, 0.18, 0.2]],
    frontR: [0.09, 0.06, 0.035], backR: [0.12, 0.06, 0.035], hoof: [0.04, 0.05, 0.07], head: "horse", headTop: 0.14,
  },
  // crouched: hips above the shoulders, long hind feet flat under the belly, big rump
  rabbit: {
    label: "兔", size: 0.18, hipY: 0.62, half: 0.36, spineDy: 0.06, chestDy: -0.16, w: 0.13,
    shoulder: [-0.1, 0.06], front: [[-0.2, -0.04], [-0.17, 0.03], [0, 0.07]],
    hip: [-0.04, 0.02], back: [[-0.2, 0.2], [-0.28, -0.3], [0, 0.5]],
    neckBase: [0.08, 0.1], neck: [0.16, 0.12], neckR: [0.17, 0.14],
    tailBase: [0.14, -0.3], tail: [[0.02, -0.03], [0.01, -0.02], [0.01, -0.01]], tailR: [0.09, 0.08],
    rib: [[0, -0.04, -0.12], [0.22, 0.24, 0.3]], fore: [[0, -0.1, 0.06], [0.17, 0.18, 0.15]],
    loin: [[0, 0.02, -0.12], [0.24, 0.26, 0.32]], rump: [[0, 0.06, -0.06], [0.28, 0.32, 0.3]],
    frontR: [0.07, 0.045, 0.035], backR: [0.17, 0.08, 0.055], paw: [0.05, 0.035, 0.08], head: "rabbit", headTop: 0.6,
  },
  cow: {
    label: "牛", size: 1.4, hipY: 0.76, half: 0.36, spineDy: -0.02, chestDy: 0.02, w: 0.12,
    shoulder: [-0.12, 0.06], front: [[-0.15, -0.05], [-0.22, 0.01], [0, 0.05]],
    hip: [-0.03, 0.02], back: [[-0.22, 0.12], [-0.22, -0.16], [0, 0.05]],
    neckBase: [0.06, 0.1], neck: [0.06, 0.3], neckR: [0.15, 0.12],
    tailBase: [0.16, -0.24], tail: [[-0.14, -0.04], [-0.18, -0.01], [-0.17, 0]], tailR: [0.025, 0.018], tuft: [0.04, 0.08, 0.04],
    rib: [[0, -0.08, -0.16], [0.21, 0.27, 0.42]], fore: [[0, -0.1, 0.05], [0.16, 0.2, 0.14]],
    loin: [[0, 0, -0.08], [0.2, 0.22, 0.34]], rump: [[0, 0.04, -0.03], [0.19, 0.2, 0.22]],
    frontR: [0.1, 0.055, 0.04], backR: [0.13, 0.06, 0.04], hoof: [0.045, 0.055, 0.06], head: "cow", headTop: 0.16,
  },
  // the trunk ellipsoids are the fleece, so the thin legs only show below the belly
  sheep: {
    label: "羊", size: 0.75, hipY: 0.76, half: 0.3, spineDy: 0, chestDy: 0, w: 0.11,
    shoulder: [-0.1, 0.06], front: [[-0.18, -0.04], [-0.24, 0.01], [0, 0.05]],
    hip: [-0.03, 0.02], back: [[-0.22, 0.12], [-0.24, -0.15], [0, 0.04]],
    neckBase: [0.08, 0.1], neck: [0.2, 0.16], neckR: [0.17, 0.13],
    tailBase: [0.12, -0.28], tail: [[-0.08, -0.04], [-0.06, -0.01], [-0.05, 0]], tailR: [0.07, 0.05],
    rib: [[0, -0.02, -0.12], [0.3, 0.33, 0.4]], fore: [[0, -0.06, 0.06], [0.26, 0.28, 0.2]],
    loin: [[0, 0.04, -0.08], [0.29, 0.31, 0.34]], rump: [[0, 0.05, -0.04], [0.28, 0.3, 0.26]],
    frontR: [0.07, 0.04, 0.03], backR: [0.09, 0.045, 0.03], hoof: [0.03, 0.035, 0.05], head: "sheep", headTop: 0.18,
  },
};

// Heads in head-joint units: tilt pitches the face down (rad), parts are ellipsoids, nose = joint-view tip
export const HEADS = {
  dog: { tilt: 0.12, nose: [0, 0.0, 0.34], parts: [[[0, 0.03, 0.05], [0.11, 0.1, 0.12]], [[0, -0.02, 0.2], [0.065, 0.06, 0.12]], [[0, 0.005, 0.315], [0.032, 0.026, 0.02]]] },
  cat: { tilt: 0, nose: [0, -0.04, 0.27], parts: [[[0, 0.03, 0.06], [0.17, 0.15, 0.16]], [[0, -0.03, 0.12], [0.15, 0.1, 0.12]], [[0, -0.055, 0.21], [0.08, 0.055, 0.06]], [[0, -0.02, 0.262], [0.024, 0.018, 0.014]]] },
  horse: { tilt: 1.0, nose: [0, -0.02, 0.41], parts: [[[0, 0, 0.04], [0.075, 0.085, 0.09]], [[0, -0.05, 0.09], [0.065, 0.08, 0.08]], [[0, -0.01, 0.2], [0.055, 0.06, 0.16]], [[0, -0.02, 0.34], [0.058, 0.062, 0.07]]] },
  rabbit: { tilt: 0.3, nose: [0, 0, 0.31], parts: [[[0, 0.04, 0.04], [0.17, 0.17, 0.2]], [[0, -0.02, 0.18], [0.13, 0.12, 0.12]], [[0, 0, 0.29], [0.035, 0.03, 0.02]]] },
  cow: { tilt: 0.85, nose: [0, -0.02, 0.36], parts: [[[0, 0.02, 0.03], [0.09, 0.09, 0.1]], [[0, -0.01, 0.16], [0.075, 0.075, 0.14]], [[0, -0.02, 0.3], [0.085, 0.07, 0.06]]] },
  sheep: { tilt: 0.75, nose: [0, -0.03, 0.3], parts: [[[0, 0.04, 0.02], [0.11, 0.11, 0.11]], [[0, -0.01, 0.14], [0.07, 0.08, 0.13]], [[0, -0.03, 0.25], [0.06, 0.06, 0.05]]] },
};

// Birds in meters (times size). Joint offsets [dy, dz] from the parent; leg = hip from the body [x, dy, dz],
// thigh = knee from the hip, the shank to the ankle is solved so the toes (radius toeR) touch the ground.
// White parts: body ellipsoids in the pitched body frame (tilt, rad), head ellipsoids, beak = cone [r, h, pos]
// or bill = flat ellipsoid, tail ellipsoid [c, r, rotX], wing / wingTip ellipsoids (left side), limb radii.
// back = top of the back above the body joint (for the shoulder height in the catalog).
export const BIRDS = {
  bird: {
    label: "鳥", size: 1.12, headTop: 0.033, back: 0.058, bodyY: 0.125, tilt: -0.45,
    neck: [0.04, 0.07], head: [0.055, 0.02], headTip: [0.003, 0.052], tail: [-0.01, -0.095], tailTip: [-0.02, -0.12],
    wing: [0.04, 0.025, 0.045], wingTip: [0.07, -0.005], wingEnd: [0.21, -0.03],
    leg: [0.024, -0.045, -0.005], thigh: [-0.032, -0.012], ankleDz: 0.012, toe: 0.034, toeR: 0.0028,
    body: [[[0, 0, -0.012], [0.052, 0.058, 0.112]], [[0, 0.012, 0.048], [0.047, 0.05, 0.056]]], neckR: [0.027, 0.019],
    headParts: [[[0, 0.008, 0.006], [0.022, 0.024, 0.027]]], beak: [0.0058, 0.024, [0, 0.003, 0.028]],
    tailPart: [[0, -0.008, -0.058], [0.032, 0.007, 0.066], -0.16],
    wingPart: [[0.035, 0, -0.012], [0.045, 0.01, 0.045]], wingTipPart: [[0.1, 0, -0.02], [0.115, 0.007, 0.036]],
    thighR: [0.014, 0.009], shankR: [0.0038, 0.0032],
  },
  // hen: round body, comb and wattle, upright tail fan, bare shanks
  chicken: {
    label: "雞", size: 1, headTop: 0.058, back: 0.09, bodyY: 0.22, tilt: -0.3,
    neck: [0.07, 0.1], head: [0.08, 0.02], headTip: [0, 0.05], tail: [0.02, -0.13], tailTip: [0.08, -0.07],
    wing: [0.07, 0.03, 0.04], wingTip: [0.08, -0.01], wingEnd: [0.2, -0.04],
    leg: [0.035, -0.05, -0.01], thigh: [-0.06, -0.01], ankleDz: 0.01, toe: 0.05, toeR: 0.004,
    body: [[[0, 0, -0.01], [0.085, 0.095, 0.15]], [[0, 0.01, 0.07], [0.08, 0.085, 0.085]]], neckR: [0.035, 0.024],
    headParts: [[[0, 0.01, 0.01], [0.024, 0.028, 0.032]], [[0, 0.04, 0.008], [0.006, 0.018, 0.026]], [[0, -0.022, 0.03], [0.007, 0.014, 0.009]]],
    beak: [0.008, 0.022, [0, 0, 0.036]],
    tailPart: [[0, 0.04, -0.04], [0.025, 0.07, 0.05], 0.5],
    wingPart: [[0.04, 0, -0.015], [0.055, 0.012, 0.06]], wingTipPart: [[0.1, 0, -0.025], [0.11, 0.009, 0.045]],
    thighR: [0.03, 0.02], shankR: [0.007, 0.006],
  },
  // level body, long neck, flat bill, short legs set back, webbed feet
  duck: {
    label: "鴨", size: 1, headTop: 0.03, back: 0.07, bodyY: 0.17, tilt: -0.1,
    neck: [0.05, 0.13], head: [0.11, 0], headTip: [-0.004, 0.08], tail: [0.01, -0.16], tailTip: [0.03, -0.06],
    wing: [0.06, 0.03, 0.05], wingTip: [0.09, -0.01], wingEnd: [0.25, -0.04],
    leg: [0.04, -0.04, -0.04], thigh: [-0.04, 0], ankleDz: 0.01, toe: 0.06, toeR: 0.004, webbed: true,
    body: [[[0, 0, -0.01], [0.08, 0.07, 0.17]], [[0, 0, 0.09], [0.07, 0.065, 0.08]]], neckR: [0.03, 0.022],
    headParts: [[[0, 0.01, 0.005], [0.026, 0.028, 0.034]]], bill: [[0, -0.004, 0.05], [0.017, 0.007, 0.03]],
    tailPart: [[0, 0.01, -0.03], [0.04, 0.012, 0.045], -0.4],
    wingPart: [[0.045, 0, -0.015], [0.06, 0.01, 0.065]], wingTipPart: [[0.12, 0, -0.025], [0.13, 0.008, 0.045]],
    thighR: [0.025, 0.018], shankR: [0.007, 0.006],
  },
};
