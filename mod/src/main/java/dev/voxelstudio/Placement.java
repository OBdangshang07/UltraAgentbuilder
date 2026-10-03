package dev.voxelstudio;

import net.minecraft.block.BlockState;
import net.minecraft.util.BlockMirror;
import net.minecraft.util.BlockRotation;
import net.minecraft.util.math.BlockPos;

/** Shared projection/placement transform. Mirror X first, rotate clockwise next. */
public record Placement(Asset asset, BlockPos anchor, int rotation, boolean mirror, long transformRevision, boolean replace) {
    public Placement { anchor = anchor.toImmutable(); rotation = Math.floorMod(rotation, 4); }
    public int width() { return rotation % 2 == 0 ? asset.width : asset.length; }
    public int length() { return rotation % 2 == 0 ? asset.length : asset.width; }
    public BlockPos local(int index) {
        int x = index % asset.width, y = index / (asset.width * asset.length), z = index / asset.width % asset.length;
        if (mirror) x = asset.width - 1 - x;
        return switch(rotation) {
            case 1 -> new BlockPos(asset.length - 1 - z, y, x);
            case 2 -> new BlockPos(asset.width - 1 - x, y, asset.length - 1 - z);
            case 3 -> new BlockPos(z, y, asset.width - 1 - x);
            default -> new BlockPos(x, y, z);
        };
    }
    public BlockPos world(int index) { return local(index).add(anchor); }
    public BlockState state(int index) {
        BlockState state = asset.state(index);
        if (mirror) {
            BlockState original=state;state=state.mirror(BlockMirror.FRONT_BACK);
            // Vanilla stairs' neighbor-placement mirror rules are not a rigid model reflection.
            // A stored explicit corner always changes handedness when reflecting local X.
            if(original.getBlock() instanceof net.minecraft.block.StairsBlock){
                var shape=original.get(net.minecraft.state.property.Properties.STAIR_SHAPE);
                state=state.with(net.minecraft.state.property.Properties.STAIR_SHAPE,switch(shape){
                    case INNER_LEFT -> net.minecraft.block.enums.StairShape.INNER_RIGHT;
                    case INNER_RIGHT -> net.minecraft.block.enums.StairShape.INNER_LEFT;
                    case OUTER_LEFT -> net.minecraft.block.enums.StairShape.OUTER_RIGHT;
                    case OUTER_RIGHT -> net.minecraft.block.enums.StairShape.OUTER_LEFT;
                    default -> shape;
                });
            }
        }
        return state.rotate(switch(rotation) { case 1 -> BlockRotation.CLOCKWISE_90; case 2 -> BlockRotation.CLOCKWISE_180; case 3 -> BlockRotation.COUNTERCLOCKWISE_90; default -> BlockRotation.NONE; });
    }
}
