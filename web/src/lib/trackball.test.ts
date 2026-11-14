import { describe, expect, it } from 'vitest'
import { project, screenUp, unitOf, unproject, type Vec3 } from './polarCamera'
import { dragLevel, dragPose, flightPose, leveled, poseAt, softPoint, squared, turn, turnBetween, turnPose, twistTo, viewOf } from './trackball'

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const size = (a: Vec3) => Math.hypot(a[0], a[1], a[2])
const close = (a: Vec3, b: Vec3, digits = 9) => a.forEach((value, i) => expect(value).toBeCloseTo(b[i], digits))
/** How far the picture is from one pose to the next: the largest move of any of a few ground points, in disk units. */
function jump(a: ReturnType<typeof poseAt>, b: ReturnType<typeof poseAt>): number {
  const points = [unitOf(-89, 20), unitOf(-85, 140), unitOf(-80, -100), unitOf(-70, 0), unitOf(-88, -137)]
  return Math.max(
    ...points.map((point) => {
      const p = project(point, a.center, a.up)
      const q = project(point, b.center, b.up)
      return Math.hypot(p.x - q.x, p.y - q.y)
    }),
  )
}

describe('turns', () => {
  it('turn a vector around an axis, and find the turn between two', () => {
    close(turn([1, 0, 0], [0, 0, 1], Math.PI / 2), [0, 1, 0])
    const { axis, angle } = turnBetween([1, 0, 0], [0, 1, 0])
    close(axis, [0, 0, 1])
    expect(angle).toBeCloseTo(Math.PI / 2)
    expect(turnBetween([0, 1, 0], [0, 1, 0]).angle).toBe(0)
  })
})

describe('dragging', () => {
  it('puts the held ground under the pointer, exactly', () => {
    const pose = poseAt(-60, 30)
    const held = unitOf(-62, 41)
    const under = unitOf(-55, 25)
    const before = project(under, pose.center, pose.up)
    const after = dragPose(pose, held, under)
    const now = project(held, after.center, after.up)
    expect(now.x).toBeCloseTo(before.x, 9)
    expect(now.y).toBeCloseTo(before.y, 9)
  })

  it('keeps the camera square and unit length over thousands of small drags', () => {
    let pose = poseAt(-20, 0)
    for (let i = 0; i < 5000; i += 1) pose = dragPose(pose, unitOf(-20 + Math.sin(i) * 3, i % 7), unitOf(-20, 0))
    expect(size(pose.center)).toBeCloseTo(1, 9)
    expect(size(pose.up)).toBeCloseTo(1, 9)
    expect(dot(pose.center, pose.up)).toBeCloseTo(0, 9)
  })

  it('moves the picture no faster at the pole than anywhere else', () => {
    // A drag of 0.008 (about half a degree of ground) moves the picture by 0.008 and no more, right
    // beside the pole and exactly over it. The old camera swung the whole picture round here.
    const small = (pose: ReturnType<typeof poseAt>) => {
      const held = turn(pose.center, pose.up, 0.008)
      return jump(pose, dragPose(pose, held, pose.center))
    }
    expect(small(poseAt(-89.9, 137))).toBeLessThan(0.0081)
    expect(small(squared({ center: [0, 0, -1], up: [1, 0, 0] }))).toBeLessThan(0.0081)
    // And straight across the pole in small steps, the picture never leaps.
    let pose = poseAt(-88, 0)
    let worst = 0
    for (let i = 0; i < 400; i += 1) {
      const next = turnPose(pose, [0, 1, 0], -0.0005) // toward and past the pole along the 0 to 180 meridian
      worst = Math.max(worst, jump(pose, next))
      pose = next
    }
    expect(viewOf(pose).lat).toBeGreaterThan(-88.5)
    expect(worst).toBeLessThan(0.002)
  })
})

describe('the rim of the disk', () => {
  const pose = poseAt(-40, 60)
  const angleFromMiddle = (v: Vec3) => Math.acos(Math.max(-1, Math.min(1, dot(v, pose.center))))

  it('is the exact ground under the pointer on the inner part of the disk', () => {
    for (const [x, y] of [[0, 0], [0.3, -0.2], [-0.5, 0.45], [0.7, 0]] as const) {
      close(softPoint(x, y, pose.center, pose.up), unproject(x, y, pose.center, pose.up) as Vec3)
    }
  })

  it('never runs out near the rim or off the disk, and never jumps', () => {
    // Along a line from the middle to far outside the disk: always a direction, turning less and less.
    let previous = softPoint(0, 0, pose.center, pose.up)
    let worstStep = 0
    for (let i = 1; i <= 300; i += 1) {
      const next = softPoint(i / 100, 0, pose.center, pose.up)
      expect(size(next)).toBeCloseTo(1, 9)
      worstStep = Math.max(worstStep, angleFromMiddle(next) - angleFromMiddle(previous))
      previous = next
    }
    // Each 0.01 step turns at most 0.014 rad, at the edge of the exact part; the exact sphere turns
    // 0.14 rad on its last step to the rim, and nothing at all beyond it.
    expect(worstStep).toBeLessThan(0.015)
    // Even three disks away the turn stays below a right angle.
    expect(angleFromMiddle(previous)).toBeLessThan(Math.PI / 2)
  })
})

describe('dragging the usual way up', () => {
  it('puts the held ground under the pointer and turns no more than it is allowed', () => {
    const pose = turnPose(poseAt(-30, 50), unitOf(-30, 50), 0.6)
    const held = softPoint(0.1, 0.2, pose.center, pose.up)
    const after = dragLevel(pose, held, 0.15, 0.1, 0.05)
    const at = project(held, after.center, after.up)
    expect(at.x).toBeCloseTo(0.15, 6)
    expect(at.y).toBeCloseTo(0.1, 6)
    // Compared with the same drag left free, it has turned toward the usual way up by the 0.05 allowed.
    const free = dragPose(pose, held, softPoint(0.15, 0.1, pose.center, pose.up))
    const offFree = Math.abs(twistTo(free, screenUp(free.center)))
    const offLevel = Math.abs(twistTo(after, screenUp(after.center)))
    expect(offFree - offLevel).toBeCloseTo(0.05, 2)
  })

  it('with no twist allowed, is the free drag', () => {
    const pose = poseAt(-70, 10)
    const held = softPoint(0, 0.1, pose.center, pose.up)
    const free = dragPose(pose, held, softPoint(0.05, 0.05, pose.center, pose.up))
    const kept = dragLevel(pose, held, 0.05, 0.05, 0)
    close(kept.center, free.center)
    close(kept.up, free.up)
  })

  it('crosses the pole and the place where the usual way up flips without a leap, in small steps', () => {
    // A long drag at constant speed, from the near side over the south pole and on past 77° S at 180°,
    // where north and the polar map's way up point opposite ways.
    for (const start of [poseAt(-60, 0), poseAt(-70, 175)]) {
      let pose = start
      let worst = 0
      for (let i = 0; i < 600; i += 1) {
        const held = softPoint(0, 0, pose.center, pose.up)
        // Drag the middle of the view 0.004 down the screen, the twist capped at three times that.
        const next = dragLevel(pose, held, 0, -0.004, 0.012)
        worst = Math.max(worst, jump(pose, next))
        pose = next
      }
      expect(worst).toBeLessThan(0.03)
    }
  })
})

describe('coming back the right way up', () => {
  it('eases up toward the usual way up without moving the view', () => {
    const tilted = turnPose(poseAt(-30, 50), unitOf(-30, 50), 0.6)
    expect(Math.abs(twistTo(tilted, screenUp(tilted.center)))).toBeCloseTo(0.6, 6)
    const half = leveled(tilted, 0.5)
    close(half.center, tilted.center)
    expect(Math.abs(twistTo(half, screenUp(half.center)))).toBeCloseTo(0.3, 6)
    const done = leveled(tilted, 1)
    close(done.up, screenUp(done.center), 6)
  })
})

describe('a flight', () => {
  it('starts where it is, ends on the place the usual way up, and never leaps on the way', () => {
    const from = turnPose(poseAt(-32, 170), unitOf(-32, 170), 0.4)
    const goal = unitOf(-89.45, -137.15)
    close(flightPose(from, goal, 0).center, from.center)
    close(flightPose(from, goal, 0).up, from.up)
    const end = flightPose(from, goal, 1)
    close(end.center, goal, 6)
    close(end.up, screenUp(goal), 6)
    let worst = 0
    for (let i = 0; i < 200; i += 1) worst = Math.max(worst, jump(flightPose(from, goal, i / 200), flightPose(from, goal, (i + 1) / 200)))
    expect(worst).toBeLessThan(0.03)
  })
})
