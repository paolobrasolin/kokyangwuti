import { describe, expect, test } from '@rstest/core';
import { distToSegment, getIntersection } from '../src/geometry';

describe('getIntersection', () => {
  test('finds the crossing point of two perpendicular segments', () => {
    const hit = getIntersection(0, 0, 10, 0, 5, -5, 5, 5);
    expect(hit).not.toBeNull();
    expect(hit?.x).toBeCloseTo(5);
    expect(hit?.y).toBeCloseTo(0);
  });

  test('finds the crossing point of two diagonals', () => {
    const hit = getIntersection(0, 0, 10, 10, 0, 10, 10, 0);
    expect(hit?.x).toBeCloseTo(5);
    expect(hit?.y).toBeCloseTo(5);
  });

  test('returns null for parallel segments', () => {
    expect(getIntersection(0, 0, 10, 0, 0, 5, 10, 5)).toBeNull();
  });

  test('returns null for collinear (overlapping) segments — degenerate determinant', () => {
    expect(getIntersection(0, 0, 10, 0, 5, 0, 15, 0)).toBeNull();
  });

  test('returns null for a zero-length segment', () => {
    expect(getIntersection(5, 5, 5, 5, 0, 0, 10, 10)).toBeNull();
  });

  test('returns null when the infinite lines cross outside both segments', () => {
    // Lines y=0 and x=100 cross at (100,0), beyond the end of both segments.
    expect(getIntersection(0, 0, 10, 0, 100, -5, 100, 5)).toBeNull();
  });

  test('returns null when the crossing is past the end of only one segment', () => {
    // The vertical segment stops short of y=0.
    expect(getIntersection(0, 0, 10, 0, 5, 2, 5, 8)).toBeNull();
  });

  test('counts a touching endpoint as a hit', () => {
    const hit = getIntersection(0, 0, 10, 0, 10, 0, 10, 10);
    expect(hit?.x).toBeCloseTo(10);
    expect(hit?.y).toBeCloseTo(0);
  });

  test('is symmetric in the two segments', () => {
    const a = getIntersection(0, 0, 10, 10, 0, 10, 10, 0);
    const b = getIntersection(0, 10, 10, 0, 0, 0, 10, 10);
    expect(a?.x).toBeCloseTo(b?.x ?? Number.NaN);
    expect(a?.y).toBeCloseTo(b?.y ?? Number.NaN);
  });

  test('handles a T junction where one segment ends on the other', () => {
    const hit = getIntersection(0, 0, 10, 0, 3, 0, 3, 9);
    expect(hit?.x).toBeCloseTo(3);
    expect(hit?.y).toBeCloseTo(0);
  });
});

describe('distToSegment', () => {
  test('measures the perpendicular distance for a projection inside the segment', () => {
    expect(distToSegment(5, 5, 0, 0, 10, 0)).toBeCloseTo(5);
    expect(distToSegment(5, -3, 0, 0, 10, 0)).toBeCloseTo(3);
  });

  test('clamps to the start endpoint when the projection falls before it', () => {
    expect(distToSegment(-4, 3, 0, 0, 10, 0)).toBeCloseTo(5);
  });

  test('clamps to the end endpoint when the projection falls after it', () => {
    expect(distToSegment(14, 3, 0, 0, 10, 0)).toBeCloseTo(5);
  });

  test('is zero on the segment', () => {
    expect(distToSegment(4, 0, 0, 0, 10, 0)).toBeCloseTo(0);
    expect(distToSegment(0, 0, 0, 0, 10, 0)).toBeCloseTo(0);
    expect(distToSegment(10, 0, 0, 0, 10, 0)).toBeCloseTo(0);
  });

  test('handles a degenerate (zero-length) segment as point distance', () => {
    expect(distToSegment(3, 4, 0, 0, 0, 0)).toBeCloseTo(5);
  });

  test('works on a diagonal segment', () => {
    // Distance from (0,10) to the line y=x, clamped inside the segment.
    expect(distToSegment(0, 10, 0, 0, 10, 10)).toBeCloseTo(Math.sqrt(50));
  });

  test('is never negative', () => {
    for (let i = -20; i <= 20; i += 3) {
      expect(distToSegment(i, i * 2, -5, 1, 7, -3)).toBeGreaterThanOrEqual(0);
    }
  });
});
