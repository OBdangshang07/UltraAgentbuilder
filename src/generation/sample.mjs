export function sampleSpec() {
  return {
    schemaVersion: 1, id: 'lantern-house', seed: 42, units: 'block', bounds: { width: 19, height: 14, length: 17 },
    palette: { wall: 'quartz', floor: 'spruce', roof: 'blue', glass: 'glass', lamp: 'sea_lantern', beam: 'dark_oak' },
    nodes: [
      { nodeId: 'foundation', op: 'box', origin: [0, 0, 0], size: [19, 1, 17], material: 'floor' },
      { nodeId: 'room', op: 'shell', origin: [2, 1, 2], size: [15, 7, 13], material: 'wall' },
      { nodeId: 'floor', op: 'box', origin: [3, 1, 3], size: [13, 1, 11], material: 'floor' },
      { nodeId: 'doorway', op: 'clear', origin: [8, 2, 2], size: [3, 3, 2] },
      { nodeId: 'front-windows', op: 'box', origin: [4, 3, 2], size: [2, 3, 1], material: 'glass', repeat: { count: 2, step: [9, 0, 0] } },
      { nodeId: 'back-window', op: 'box', origin: [5, 3, 14], size: [9, 3, 1], material: 'glass' },
      { nodeId: 'lamps', op: 'box', origin: [5, 6, 5], size: [1, 1, 1], material: 'lamp', repeat: { count: 3, step: [4, 0, 0] } },
      { nodeId: 'eaves', op: 'box', origin: [1, 8, 1], size: [17, 1, 15], material: 'beam' },
      ...Array.from({ length: 5 }, (_, i) => ({ nodeId: `roof-${i}`, op: 'box', origin: [2 + i, 9 + i, 2], size: [15 - i * 2, 1, 13], material: 'roof' })),
    ],
    constraints: { interior: true, walkable: true, passages: [{ origin: [8, 2, 2], size: [3, 2, 7] }] },
  };
}
