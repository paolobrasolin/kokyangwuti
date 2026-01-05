import type { RenderSnapshot } from '../types';

export function draw(ctx: CanvasRenderingContext2D, snapshot: RenderSnapshot): void {
  ctx.fillStyle = '#050510';
  ctx.fillRect(0, 0, snapshot.width, snapshot.height);

  ctx.lineWidth = 2;
  snapshot.frameLines.forEach((line) => {
    ctx.beginPath();
    ctx.moveTo(line.x1, line.y1);
    ctx.lineTo(line.x2, line.y2);
    ctx.strokeStyle = '#333';
    ctx.stroke();
  });

  snapshot.agents.forEach((agent) => {
    if (!agent.alive) return;

    ctx.lineWidth = 1;
    agent.lines.forEach((line) => {
      ctx.beginPath();
      ctx.moveTo(line.x1, line.y1);
      ctx.lineTo(line.x2, line.y2);
      ctx.strokeStyle = line.color;
      ctx.stroke();
    });

    ctx.fillStyle = '#ffaa00';
    agent.fliesCaught.forEach((fly) => {
      ctx.beginPath();
      ctx.arc(fly.x, fly.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    });

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

    ctx.save();
    ctx.translate(agent.x, agent.y);
    if (agent.state === 'crawling') {
      const line =
        agent.currentLineIdx < 4
          ? snapshot.frameLines[agent.currentLineIdx]
          : agent.lines[agent.currentLineIdx - 4];
      if (line) {
        const angle = Math.atan2(line.y2 - line.y1, line.x2 - line.x1);
        ctx.rotate(angle);
      }
    } else {
      const angle = Math.atan2(agent.vy, agent.vx);
      ctx.rotate(angle);
    }

    ctx.fillStyle = agent.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, 6, 3, 0, 0, Math.PI * 2);
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
