package dev.voxelstudio;

import net.minecraft.block.*;
import net.minecraft.block.enums.DoubleBlockHalf;
import net.minecraft.state.property.Properties;
import java.util.*;

/** Door halves are one logical edit. State transforms still use Minecraft's block implementation. */
public final class SpecialBlocks {
    private SpecialBlocks(){}
    public static boolean door(BlockState state){return state.getBlock() instanceof DoorBlock;}
    public static int offset(BlockState state){return state.get(Properties.DOUBLE_BLOCK_HALF)==DoubleBlockHalf.LOWER?1:-1;}
    public static boolean matching(BlockState a,BlockState b){return door(a)&&door(b)&&a.getBlock()==b.getBlock()&&offset(a)==-offset(b)&&a.get(Properties.HORIZONTAL_FACING)==b.get(Properties.HORIZONTAL_FACING)&&a.get(Properties.DOOR_HINGE)==b.get(Properties.DOOR_HINGE)&&a.get(Properties.OPEN)==b.get(Properties.OPEN)&&a.get(Properties.POWERED)==b.get(Properties.POWERED);}
    public static void validate(Asset asset){
        int plane=asset.width*asset.length;
        for(int i=0;i<asset.volume();i++)if(door(asset.state(i))){int y=i/plane,j=i+offset(asset.state(i))*plane;
            if(j<0||j>=asset.volume()||!matching(asset.state(i),asset.state(j)))throw new IllegalArgumentException("门的上下半部缺失或状态不一致");
        }
    }
    /** Preview may contain unsupported doors; world writes may not. KEEP uses actual terrain. */
    public static void requireSupport(Placement p,int index,net.minecraft.server.world.ServerWorld world){
        BlockState state=p.state(index);if(!door(state)||offset(state)!=1)return;
        var below=p.world(index).down();if(!world.isChunkLoaded(below)||world.isOutOfHeightLimit(below)||!world.getWorldBorder().contains(below))throw new IllegalStateException("门下方支撑不可读取；请换位置并重新检查");
        BlockState support=world.getBlockState(below);int other=index-p.asset().width*p.asset().length;
        if(other>=0&&p.asset().cell(other)!=0&&(p.replace()||support.isAir()))support=p.state(other);
        if(!support.isSideSolidFullSquare(world,below,net.minecraft.util.math.Direction.UP))throw new IllegalStateException("门下方缺少完整支撑面，不能建造；请先修正建筑或调整位置（可继续预览）");
    }
    /** Include both old and new pair relationships (also handles vertically shifted doors). */
    public static List<Integer> group(Placement p,int first,java.util.function.IntFunction<BlockState> before){
        int plane=p.asset().width*p.asset().length;var found=new LinkedHashSet<Integer>();var queue=new ArrayList<Integer>();found.add(first);queue.add(first);
        for(int at=0;at<queue.size();at++){int i=queue.get(at);for(BlockState state:List.of(before.apply(i),p.state(i)))if(door(state)){
            int next=i+offset(state)*plane;if(next<0||next>=p.asset().volume()||p.asset().cell(next)==0)throw new IllegalStateException("不能仅覆盖/挖除半扇门；请让建筑掩码包含完整上下两格");
            if(found.add(next))queue.add(next);
        }}return queue;
    }
}
