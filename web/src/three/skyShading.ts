/**
 * How the Sun and Earth are colored, shared by every view that draws them (the 3D terrain and the
 * Surface tab), so they look the same wherever they appear. GLSL only: each view supplies its own
 * geometry and calls these.
 */

/** NASA Blue Marble (public domain), equirectangular, for the look of Earth only. */
export const EARTH_MAP_URL = `${import.meta.env.BASE_URL}data/maps/earth_color.jpg`

/**
 * Earth's color at one point of its disk. `sunFacing` is the cosine of the angle between the
 * surface there and the Sun (so the phase is the one seen from the site), `facing` the cosine
 * between the surface and the viewer (1 in the middle of the disk, 0 at its edge).
 */
export const EARTH_SHADING = /* glsl */ `
vec3 earthColor(vec3 surface, float sunFacing, float facing) {
  float day = smoothstep(-0.03, 0.12, sunFacing);
  // A thin blue haze, thicker toward the limb, as Earth's air looks from space.
  float limb = 1.0 - clamp(facing, 0.0, 1.0);
  vec3 lit = mix(surface * 1.15, vec3(0.45, 0.65, 1.0), 0.12 + 0.45 * pow(limb, 3.0));
  vec3 night = surface * 0.03 + vec3(0.01, 0.015, 0.04);
  return mix(night, lit, day);
}`

/**
 * The Sun as it looks through a filter: white-hot in the middle, darker and warmer toward the edge
 * (limb darkening), with a faint granular texture. `mu` is 1 in the middle of the disk and 0 at its
 * edge; `spot` is the point on a unit ball, for the grain.
 */
export const SUN_SHADING = /* glsl */ `
float sunHash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
float sunNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(sunHash(i), sunHash(i + vec3(1, 0, 0)), f.x), mix(sunHash(i + vec3(0, 1, 0)), sunHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(sunHash(i + vec3(0, 0, 1)), sunHash(i + vec3(1, 0, 1)), f.x), mix(sunHash(i + vec3(0, 1, 1)), sunHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
vec3 sunColor(float mu, vec3 spot) {
  // Quadratic limb-darkening law with typical visible-light coefficients.
  float darkening = 1.0 - 0.47 * (1.0 - mu) - 0.23 * (1.0 - mu) * (1.0 - mu);
  float grain = 0.93 + 0.07 * sunNoise(spot * 24.0) + 0.03 * sunNoise(spot * 60.0);
  vec3 core = vec3(1.0, 0.98, 0.93);
  vec3 edge = vec3(1.0, 0.58, 0.20);
  return mix(edge, core, pow(mu, 0.45)) * darkening * grain;
}`
