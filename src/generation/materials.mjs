// Curated vanilla materials; no entities, fluids, falling blocks or powered mechanisms.
const extended={};
// Canonical names for already-approved plank blocks, retaining the original aliases.
for(const wood of ['oak','spruce','dark_oak'])extended[wood+'_planks']='minecraft:'+wood+'_planks';
// Ordinary 1.20.1 architectural blocks; explicit catalog entries, never arbitrary IDs.
extended.polished_blackstone='minecraft:polished_blackstone';
extended.smooth_stone_slab='minecraft:smooth_stone_slab[type=bottom,waterlogged=false]';
for(const name of ['calcite','tuff','polished_andesite','polished_diorite','polished_granite','deepslate_bricks','polished_deepslate','chiseled_stone_bricks','mossy_stone_bricks','cracked_stone_bricks','smooth_quartz','quartz_bricks','smooth_sandstone','cut_sandstone','red_sandstone','smooth_red_sandstone','packed_mud','mud_bricks','copper_block','cut_copper','oxidized_copper','waxed_cut_copper','prismarine','dark_prismarine','end_stone_bricks','nether_bricks','red_nether_bricks','blackstone','polished_blackstone_bricks','birch_planks','cherry_planks','bamboo_planks','stripped_oak_log','stripped_spruce_log'])extended[name]='minecraft:'+name+(name.endsWith('_log')?'[axis=y]':'');
for(const color of ['orange','magenta','light_blue','lime','pink','light_gray','purple','brown','green'])extended[color]='minecraft:'+color+'_concrete';
for(const color of ['white','gray','black','brown','green','orange']){extended[color+'_terracotta']='minecraft:'+color+'_terracotta';extended[color+'_glass']='minecraft:'+color+'_stained_glass';}
// Explicit glazing names avoid confusing the existing colour-only CONCRETE
// aliases with glass. Historical blue_glass remains light-blue below.
for(const color of ['white','orange','magenta','light_blue','yellow','lime','pink','gray','light_gray','cyan','purple','blue','brown','green','red','black']){
  extended[color+'_glass']='minecraft:'+color+'_stained_glass';
  extended[color+'_stained_glass']='minecraft:'+color+'_stained_glass';
}
for(const wood of ['oak','spruce','birch','dark_oak','cherry','bamboo']){
  extended[wood+'_door']=`minecraft:${wood}_door[facing=north,half=lower,hinge=left,open=false,powered=false]`;
  extended[wood+'_trapdoor']=`minecraft:${wood}_trapdoor[facing=north,half=bottom,open=false,powered=false,waterlogged=false]`;
}
for(const base of ['oak','spruce','birch','dark_oak','cherry','bamboo','stone','stone_brick','cobblestone','brick','quartz','sandstone','smooth_sandstone','deepslate_brick','polished_blackstone_brick','mud_brick','cut_copper']){
  extended[base+'_stairs']=`minecraft:${base}_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]`;
  extended[base+'_slab']=`minecraft:${base}_slab[type=bottom,waterlogged=false]`;
}
export const MATERIALS = Object.freeze({
  ...extended,
  stone: 'minecraft:stone', stone_bricks: 'minecraft:stone_bricks', smooth_stone: 'minecraft:smooth_stone',
  // Exact ordinary ground states also serve as captured BEFORE/neighbour
  // facts. No snowy variants, arbitrary terrain IDs or physics guarantees.
  dirt: 'minecraft:dirt', grass_block: 'minecraft:grass_block[snowy=false]',
  cobblestone: 'minecraft:cobblestone', bricks: 'minecraft:bricks', quartz: 'minecraft:quartz_block',
  white: 'minecraft:white_concrete', gray: 'minecraft:gray_concrete', black: 'minecraft:black_concrete',
  red: 'minecraft:red_concrete', blue: 'minecraft:blue_concrete', cyan: 'minecraft:cyan_concrete',
  yellow: 'minecraft:yellow_concrete', terracotta: 'minecraft:terracotta', sandstone: 'minecraft:sandstone',
  oak: 'minecraft:oak_planks', spruce: 'minecraft:spruce_planks', dark_oak: 'minecraft:dark_oak_planks',
  oak_log: 'minecraft:oak_log[axis=y]', spruce_log: 'minecraft:spruce_log[axis=y]',
  glass: 'minecraft:glass', blue_glass: 'minecraft:light_blue_stained_glass',
  leaves: 'minecraft:oak_leaves[persistent=true]', moss: 'minecraft:moss_block',
  glowstone: 'minecraft:glowstone', sea_lantern: 'minecraft:sea_lantern', shroomlight: 'minecraft:shroomlight',
  light: 'minecraft:light[level=15,waterlogged=false]',
  oak_stairs_north: 'minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]',
  oak_stairs_south: 'minecraft:oak_stairs[facing=south,half=bottom,shape=straight,waterlogged=false]',
  oak_stairs_east: 'minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]',
  oak_stairs_west: 'minecraft:oak_stairs[facing=west,half=bottom,shape=straight,waterlogged=false]',
});
export const MATERIAL_VERSION = 'vanilla-stable-1.20.1-v2';
