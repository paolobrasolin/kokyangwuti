import {
  AGENT_STRIDE,
  FLY_STRIDE,
  MARK_STRIDE,
  type RenderFrame,
  SEGMENT_WIDTHS,
} from './frame';

const TAU = Math.PI * 2;
const BACKGROUND = '#050510';

export function draw(ctx: CanvasRenderingContext2D, frame: RenderFrame): void {
  const { width, height, palette } = frame;
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, width, height);

  // Silk and substrate, batched by (colour, width): a web of thousands of
  // springs becomes a couple of dozen stroke calls.
  const buckets = new Map<number, number[]>();
  const count = frame.segmentColor.length;
  for (let i = 0; i < count; i++) {
    const key =
      frame.segmentColor[i] * SEGMENT_WIDTHS.length + frame.segmentWidth[i];
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(i);
  }
  const seg = frame.segments;
  for (const [key, indices] of buckets) {
    ctx.strokeStyle = palette[Math.floor(key / SEGMENT_WIDTHS.length)];
    ctx.lineWidth = SEGMENT_WIDTHS[key % SEGMENT_WIDTHS.length];
    ctx.beginPath();
    for (const i of indices) {
      const o = i * 4;
      ctx.moveTo(seg[o], seg[o + 1]);
      ctx.lineTo(seg[o + 2], seg[o + 3]);
    }
    ctx.stroke();
  }

  // Live prey: a dark body with a wing blur, tinted while stuck and thrashing.
  const flies = frame.flies;
  for (let o = 0; o < flies.length; o += FLY_STRIDE) {
    const x = flies[o];
    const y = flies[o + 1];
    const stuck = flies[o + 4] > 0;
    const radius = 1.2 + flies[o + 2] * 3;
    const buzz =
      Math.sin(frame.globalTime * 40 + flies[o + 3]) * (stuck ? 2 : 1);

    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = stuck ? '#ffcc66' : '#cfd6ff';
    ctx.beginPath();
    ctx.ellipse(x, y, radius * 2.2, radius * 0.9, buzz * 0.2, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = stuck ? '#ffaa33' : '#20242f';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = stuck ? 'rgba(255,180,80,0.9)' : 'rgba(200,210,255,0.8)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  // Where flies were eaten, fading out.
  const marks = frame.marks;
  ctx.fillStyle = '#ffaa00';
  for (let o = 0; o < marks.length; o += MARK_STRIDE) {
    ctx.globalAlpha = marks[o + 2];
    ctx.beginPath();
    ctx.arc(marks[o], marks[o + 1], 1.5, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Spiders.
  const agents = frame.agents;
  for (let o = 0; o < agents.length; o += AGENT_STRIDE) {
    const x = agents[o];
    const y = agents[o + 1];
    const angle = agents[o + 2];
    const bodyScale = agents[o + 3];
    const color = palette[agents[o + 7]];
    const webColor = palette[agents[o + 8]];

    if (agents[o + 4] > 0) {
      // The dragline being paid out.
      ctx.strokeStyle = webColor;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(agents[o + 5], agents[o + 6]);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, 6 * bodyScale, 3 * bodyScale, 0, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    const wiggle = Math.sin(frame.globalTime * 10 + agents[o + 9]) * 2;
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
  }
}

/** The canvas while graphics are switched off: a note, nothing else. */
export function drawIdle(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  lines: readonly string[],
): void {
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(160, 160, 255, 0.5)';
  ctx.font = '12px "Courier New", Courier, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    ctx.fillText(
      line,
      width / 2,
      height / 2 + (i - (lines.length - 1) / 2) * 18,
    );
  });
}
