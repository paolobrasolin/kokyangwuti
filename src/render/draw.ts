import type { RenderSnapshot } from '../types';

export function draw(ctx: CanvasRenderingContext2D, snapshot: RenderSnapshot): void {
  ctx.fillStyle = '#050510';
  ctx.fillRect(0, 0, snapshot.width, snapshot.height);

  const { world } = snapshot;

  // Draw all springs as polylines through node positions
  // Group springs by thread for continuous polylines where possible
  const drawnSprings = new Set<number>();

  // Draw threads as polylines
  for (const thread of world.threads) {
    if (thread.springIds.length === 0) continue;

    const points: Array<{ x: number; y: number }> = [];
    let color = '';
    let lineWidth = 1.5;
    let allValid = true;

    for (let i = 0; i < thread.springIds.length; i++) {
      const spring = world.springMap.get(thread.springIds[i]);
      if (!spring || spring.broken) { allValid = false; break; }

      if (i === 0) {
        color = spring.color;
        lineWidth = spring.type === 'capture' ? 1 : spring.type === 'frame' ? 2 : 1.5;
      }

      const nodeA = world.nodeMap.get(spring.nodeA);
      if (!nodeA) { allValid = false; break; }

      if (i === 0) {
        points.push({ x: nodeA.x, y: nodeA.y });
      }

      const nodeB = world.nodeMap.get(spring.nodeB);
      if (!nodeB) { allValid = false; break; }
      points.push({ x: nodeB.x, y: nodeB.y });

      drawnSprings.add(spring.id);
    }

    if (allValid && points.length >= 2) {
      // Stress coloring for non-frame threads
      if (thread.type !== 'frame') {
        const firstSpring = world.springMap.get(thread.springIds[0]);
        if (firstSpring) {
          const nodeA = world.nodeMap.get(firstSpring.nodeA)!;
          const nodeB = world.nodeMap.get(firstSpring.nodeB)!;
          const currentLen = Math.hypot(nodeB.x - nodeA.x, nodeB.y - nodeA.y);
          const stressRatio = currentLen / firstSpring.maxExtension;
          if (stressRatio > 0.7) {
            const t = Math.min(1, (stressRatio - 0.7) / 0.3);
            // Blend toward warm red/orange as stress increases
            const r = Math.round(255 * t);
            const g = Math.round(150 * t);
            color = `rgba(${Math.max(r, 80)}, ${g}, ${Math.round(40 * (1 - t))}, ${0.4 + t * 0.4})`;
          }
        }
      }

      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }

  // Draw any unthreaded springs (shouldn't happen normally, but safety)
  for (const spring of world.springs) {
    if (spring.broken || drawnSprings.has(spring.id)) continue;
    const nodeA = world.nodeMap.get(spring.nodeA);
    const nodeB = world.nodeMap.get(spring.nodeB);
    if (!nodeA || !nodeB) continue;

    ctx.beginPath();
    ctx.moveTo(nodeA.x, nodeA.y);
    ctx.lineTo(nodeB.x, nodeB.y);
    ctx.strokeStyle = spring.color;
    ctx.lineWidth = spring.type === 'capture' ? 1 : 1.5;
    ctx.stroke();
  }

  // Draw agents
  snapshot.agents.forEach((agent) => {
    // Draw caught flies
    ctx.fillStyle = '#ffaa00';
    agent.fliesCaught.forEach((fly) => {
      const alpha = Math.max(0, 1 - fly.ageMs / 6000);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(fly.x, fly.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    if (!agent.alive) return;

    // Draw active drop line (dragline)
    if (agent.state === 'falling' && agent.dropStartPos) {
      ctx.strokeStyle = agent.webColor;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(agent.dropStartPos.x, agent.dropStartPos.y);
      ctx.lineTo(agent.x, agent.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
    }

    // Draw spider body
    ctx.save();
    ctx.translate(agent.x, agent.y);

    if (agent.state === 'crawling') {
      const spring = world.springMap.get(agent.currentSpringId);
      if (spring) {
        const nodeA = world.nodeMap.get(spring.nodeA);
        const nodeB = world.nodeMap.get(spring.nodeB);
        if (nodeA && nodeB) {
          const angle = Math.atan2(nodeB.y - nodeA.y, nodeB.x - nodeA.x);
          ctx.rotate(angle);
        }
      }
    } else {
      const angle = Math.atan2(agent.vy, agent.vx);
      ctx.rotate(angle);
    }

    const bodyScale = Math.min(1.4, 0.7 + agent.genome.bodyMass * 0.4);
    ctx.fillStyle = agent.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, 6 * bodyScale, 3 * bodyScale, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = agent.color;
    const wiggle = Math.sin(snapshot.globalTime * 10 + agent.legPhase) * 2;
    for (let i = -1; i <= 1; i += 2) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-5 * i, -8 + wiggle);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(5 * i, -8 - wiggle);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-8 * i, 8 + wiggle);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(8 * i, 8 - wiggle);
      ctx.stroke();
    }
    ctx.restore();
  });
}
