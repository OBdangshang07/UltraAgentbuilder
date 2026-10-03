import fs from 'node:fs';
import path from 'node:path';

const SIGNALS = [
  ['dense-array', /new\s+Uint(?:8|16|32)Array\s*\(/g, 3],
  ['voxel-world-store', /\b(?:class\s+VoxelWorld|world\.data|makeWorld\s*\(|voxel(?:s|Data)?\s*=\s*new\s+Uint(?:8|16|32)Array)/g, 3],
  ['voxel-setter', /\b(?:setV|setVoxel|setBlock|boxShell|fill)\s*\(/g, 3],
  ['sparse-map', /new\s+Map\s*\(|\.chunks\b|\.cells\b/g, 2],
  ['instanced-cubes', /InstancedMesh|BoxGeometry/g, 2],
  ['three-scene', /THREE\.|from\s+["']three/g, 1],
  ['mesh-geometry', /BufferGeometry|\.obj\b|OBJLoader/g, -1],
  ['obfuscated', /[A-Za-z_$][\w$]*=[A-Za-z_$][\w$]*\[[A-Za-z_$][\w$]*\]/g, -1],
];

export function inspectVoxelHtml(file) {
  const html = fs.readFileSync(file, 'utf8');
  const signals = [];
  let score = 0;
  for (const [name, pattern, weight] of SIGNALS) {
    const matches = html.match(pattern)?.length ?? 0;
    if (matches) {
      signals.push({ name, matches, weight });
      score += Math.min(matches, 5) * weight;
    }
  }
  let route = 'manual-analysis';
  if (score >= 12 && signals.some(signal => ['voxel-setter', 'voxel-world-store'].includes(signal.name))) route = 'direct-voxel-adapter';
  else if (signals.some(signal => signal.name === 'instanced-cubes')) route = 'runtime-scene-capture';
  else if (signals.some(signal => signal.name === 'mesh-geometry')) route = 'mesh-voxelization';
  return {
    file: path.resolve(file),
    bytes: Buffer.byteLength(html),
    route,
    score,
    confidence: Math.abs(score) >= 15 ? 'high' : Math.abs(score) >= 7 ? 'medium' : 'low',
    signals,
    warning: 'Inspection is static and does not execute the HTML. Conversion still requires a reviewed adapter and block mapping.',
  };
}
