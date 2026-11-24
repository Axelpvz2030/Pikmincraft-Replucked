export class Vec3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  static add(a, b) {
    return new Vec3(a.x + b.x, a.y + b.y, a.z + b.z);
  }

  static subtract(a, b) {
    return new Vec3(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  static scale(v, scalar) {
    return new Vec3(v.x * scalar, v.y * scalar, v.z * scalar);
  }

  static dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  static lengthSq(v) {
    return v.x * v.x + v.y * v.y + v.z * v.z;
  }

  static length(v) {
    return Math.sqrt(Vec3.lengthSq(v));
  }

  static distance(a, b) {
    return Vec3.length(Vec3.subtract(a, b));
  }

  static normalize(v) {
    const len = Vec3.length(v);
    if (len === 0) return new Vec3(0, 0, 0);
    return Vec3.scale(v, 1 / len);
  }

  /**
   * Returns the closest point on line segment AB to point P.
   */
  static closestPointOnSegment(p, a, b) {
    const ab = Vec3.subtract(b, a);
    const ap = Vec3.subtract(p, a);
    const abLenSq = Vec3.lengthSq(ab);
    if (abLenSq === 0) return new Vec3(a.x, a.y, a.z);

    const t = Math.max(0, Math.min(1, Vec3.dot(ap, ab) / abLenSq));
    return Vec3.add(a, Vec3.scale(ab, t));
  }

  /**
   * Returns the shortest distance from point P to line segment AB.
   */
  static distanceToSegment(p, a, b) {
    const closest = Vec3.closestPointOnSegment(p, a, b);
    return Vec3.distance(p, closest);
  }
}