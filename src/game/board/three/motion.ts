import * as THREE from 'three';

/** Entirely local, presentation-only animation. These values never touch game state. */
export type DecorationKind = 'tree' | 'sheep' | 'rock' | 'brick' | 'wheat';
export const AMBIENT_FRAME_MS = 50; // At most ~20 scene updates/second, including on desktop.
export const REACTION_DURATION_MS = 950;

export function oceanWaveHeight(x: number, z: number, seconds: number): number {
  // Broad, slow, low-relief surface breathing: no choppy crests or sideways travel.
  return .006 * Math.sin(x * .78 + z * .20 + seconds * .42)
    + .004 * Math.cos(z * .93 - x * .25 - seconds * .35);
}

export function boatPose(seconds: number, index: number, x: number, z: number) {
  const phase = seconds * .65 + index * 1.47;
  return {
    height: oceanWaveHeight(x, z, seconds) * .8 + .006 * Math.sin(phase),
    pitch: .008 * Math.sin(phase + .8),
    roll: .011 * Math.cos(phase * .82),
  };
}

/** A brief spring reaction that settles exactly back to its original position. */
export function decorationReaction(kind: DecorationKind, elapsedMs: number) {
  const t = Math.max(0, Math.min(1, elapsedMs / REACTION_DURATION_MS));
  const envelope = Math.sin(Math.PI * t) * (1 - .2 * t);
  if (t >= 1) return { y: 0, x: 0, z: 0, finished: true };
  if (kind === 'sheep') return {
    y: .18 * Math.abs(Math.sin(Math.PI * t * 2.2)) * envelope,
    x: .10 * Math.sin(Math.PI * t * 3) * envelope,
    z: .04 * Math.sin(Math.PI * t * 2) * envelope,
    finished: false,
  };
  if (kind === 'tree' || kind === 'wheat') return {
    y: 0,
    x: (kind === 'tree' ? .13 : .10) * Math.sin(Math.PI * t * 4.4) * envelope,
    z: .07 * Math.sin(Math.PI * t * 3.5 + .4) * envelope,
    finished: false,
  };
  return {
    y: .028 * Math.abs(Math.sin(Math.PI * t * 3)) * envelope,
    x: .075 * Math.sin(Math.PI * t * 4) * envelope,
    z: .055 * Math.sin(Math.PI * t * 3.6) * envelope,
    finished: false,
  };
}

interface MovingBuffer {
  attribute: THREE.BufferAttribute;
  original: Float32Array;
  amplitude: number;
}

/** Reuses existing Three buffer attributes and materials: no new geometry per frame. */
export class OceanMotion {
  private layers: MovingBuffer[];
  constructor(ocean: THREE.Group) {
    this.layers = [
      this.layer(ocean, 'depth-gradient-water', 1),
    ];
  }
  private layer(root: THREE.Group, name: string, amplitude: number): MovingBuffer {
    const object = root.getObjectByName(name);
    if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) throw new Error('Missing ocean art layer: ' + name);
    const attribute = object.geometry.getAttribute('position');
    if (!(attribute instanceof THREE.BufferAttribute)) throw new Error('Missing ocean positions: ' + name);
    return { attribute, original: Float32Array.from(attribute.array), amplitude };
  }
  update(seconds: number): void {
    for (const layer of this.layers) {
      const { original, amplitude, attribute } = layer;
      for (let i = 0; i < attribute.count; i++) {
        const k = i * 3;
        // Only the sea surface is animated; the shoreline, X/Z layout,
        // foam, docks and all gameplay targets remain completely stationary.
        attribute.setY(i, original[k + 1] + amplitude * oceanWaveHeight(original[k], original[k + 2], seconds));
      }
      attribute.needsUpdate = true;
    }
  }
  sample() {
    return this.layers.map(layer => layer.attribute.getY(Math.min(24, layer.attribute.count - 1)));
  }
}
