import fs from 'node:fs';
import { resolveProject } from './paths.mjs';

export function proposeColorMapping(colors, options = {}) {
  const blockColors = options.blockColors ?? JSON.parse(fs.readFileSync(resolveProject('config', 'block-colors.json'), 'utf8'));
  const threshold = options.reviewThreshold ?? 0.78;
  const targets = Object.entries(blockColors)
    .filter(([block]) => block !== 'minecraft:air')
    .map(([block, hex]) => ({ block, rgb: parseHex(hex) }));
  return colors.map(source => {
    const sourceHex = normalizeHex(source);
    const rgb = parseHex(sourceHex);
    let best = null;
    let bestDistance = Infinity;
    for (const target of targets) {
      const distance = Math.hypot(rgb[0] - target.rgb[0], rgb[1] - target.rgb[1], rgb[2] - target.rgb[2]);
      if (distance < bestDistance) { best = target; bestDistance = distance; }
    }
    const confidence = Math.max(0, 1 - bestDistance / Math.sqrt(3 * 255 ** 2));
    return {
      source: sourceHex,
      target: best.block,
      distance: Number(bestDistance.toFixed(3)),
      confidence: Number(confidence.toFixed(4)),
      reviewRequired: confidence < threshold,
    };
  });
}

function normalizeHex(value) {
  if (Number.isInteger(value) && value >= 0 && value <= 0xffffff) return `#${value.toString(16).padStart(6, '0')}`;
  if (typeof value === 'string' && /^#?[0-9a-f]{6}$/i.test(value)) return value.startsWith('#') ? value.toLowerCase() : `#${value.toLowerCase()}`;
  throw new TypeError(`Invalid RGB color: ${JSON.stringify(value)}`);
}

function parseHex(value) {
  const hex = normalizeHex(value);
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
}
