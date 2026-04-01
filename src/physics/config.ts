export const PHYSICS = {
  gravity: 0.15,
  globalDamping: 0.01,
  segmentLength: 25,
  frameSpacing: 60,
  maxDt: 32,
  defaultNodeMass: 0.1,
  spiderMassMultiplier: 5.0,
  constraintIterations: 6,
  reducedIterations: 3,
  skipPhysicsSpeed: 1000,
  reducedIterationsSpeed: 20,
  cleanupInterval: 60,
  breakingThreshold: 1.0, // fraction above maxExtension that causes break
};
