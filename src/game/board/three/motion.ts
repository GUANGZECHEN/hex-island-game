import * as THREE from 'three';

/** Entirely local, presentation-only animation. These values never touch game state. */
export type DecorationKind = 'tree' | 'sheep' | 'rock' | 'brick' | 'wheat';
export const AMBIENT_FRAME_MS = 50; // At most ~20 scene updates/second, including on desktop.
export const REACTION_DURATION_MS = 950;

export function oceanWaveHeight(x: number, z: number, seconds: number): number {
  // Actual shallow relief on the water mesh, with slow broad swell directions.
  // No scrolling stripe textures, horizontal shifts or effects on gameplay.
  return .017 * Math.sin(x * .90 + z * .16 + seconds * .52)
    + .007 * Math.cos(z * 1.16 - x * .23 - seconds * .39);
}

export function boatPose(seconds: number, index: number, x: number, z: number) {
  // Restore the original, user-approved ship rocking amplitude and tempo.
  const phase = seconds * 1.1 + index * 1.47;
  return {
    height: oceanWaveHeight(x, z, seconds) * .8 + .016 * Math.sin(phase),
    pitch: .019 * Math.sin(phase + .8),
    roll: .027 * Math.cos(phase * .82),
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
  geometry: THREE.BufferGeometry;
  attribute: THREE.BufferAttribute;
  original: Float32Array;
}

/** Animate the real ocean surface and its open sidewalls, keeping them seamless.
 * Updating its vertex normals makes the low physical relief visible in lighting.
 * There is no overlapping underwater cap and no animated shadow overlay.
 */
export class OceanMotion {
  private water: MovingBuffer;
  private rim: MovingBuffer;
  constructor(ocean: THREE.Group) {
    this.water = this.layer(ocean, 'depth-gradient-water');
    this.rim = this.layer(ocean, 'ocean-depth');
  }
  private layer(root: THREE.Group, name: string): MovingBuffer {
    const object = root.getObjectByName(name);
    if (!(object instanceof THREE.Mesh)) throw new Error('Missing ocean mesh: ' + name);
    const geometry = object.geometry;
    const attribute = geometry.getAttribute('position');
    if (!(attribute instanceof THREE.BufferAttribute)) throw new Error('Missing ocean positions: ' + name);
    return { geometry, attribute, original: Float32Array.from(attribute.array) };
  }
  update(seconds: number): void {
    const { original, attribute, geometry } = this.water;
    for (let i = 0; i < attribute.count; i++) {
      const k = i * 3;
      attribute.setY(i, original[k + 1] + oceanWaveHeight(original[k], original[k + 2], seconds));
    }
    attribute.needsUpdate = true;
    geometry.computeVertexNormals();

    // Every other rim vertex is an upper edge point. The lower half of the
    // sidewall stays fixed; its upper edge follows the sea surface exactly.
    const side = this.rim;
    for (let i = 0; i < side.attribute.count; i += 2) {
      const k = i * 3;
      side.attribute.setY(i, side.original[k + 1] + oceanWaveHeight(side.original[k], side.original[k + 2], seconds));
    }
    side.attribute.needsUpdate = true;
    side.geometry.computeVertexNormals();
  }
  sample(): number[] {
    return [this.water.attribute.getY(Math.min(24, this.water.attribute.count - 1))];
  }
}
