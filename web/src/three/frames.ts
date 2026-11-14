import * as THREE from 'three'

/**
 * MOON_ME (x toward 0° E, y toward 90° E, z north) as Three.js scene axes, with north up the screen:
 * scene x = MOON_ME y, scene y = MOON_ME z, scene z = MOON_ME x. It's a cyclic swap, so it stays
 * right-handed and nothing is mirrored.
 */
export function meToScene(v: readonly number[]): THREE.Vector3 {
  return new THREE.Vector3(v[1], v[2], v[0])
}
