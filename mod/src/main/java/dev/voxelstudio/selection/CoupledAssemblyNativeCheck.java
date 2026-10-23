package dev.voxelstudio.selection;

import java.lang.reflect.Proxy;
import java.util.*;
import java.util.function.Function;
import net.minecraft.block.*;
import net.minecraft.block.enums.DoubleBlockHalf;
import net.minecraft.command.argument.BlockArgumentParser;
import net.minecraft.registry.Registries;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.WorldView;

/** Native state/placement oracle only, NOT a source, lease or confirmation.
 * A future server-owned Source must bound all supplied reads to its ORIGINAL
 * loaded chunks/C. No method here loads chunks, mutates worlds or adopts a
 * report. Pending-group reads simulate exact AFTER before either door write. */
final class CoupledAssemblyNativeCheck {
    enum Mode { FORWARD,UNDO }
    private final Mode mode;private final int minY,maxY;private final Function<SelectionRegion.Point,BlockState> reader;private final Map<String,BlockState> states=new HashMap<>();
    CoupledAssemblyNativeCheck(Mode mode,int minY,int maxY,Function<SelectionRegion.Point,BlockState> reader){this.mode=Objects.requireNonNull(mode);this.reader=Objects.requireNonNull(reader);if(minY< -2048||maxY>2048||minY>=maxY)throw new IllegalArgumentException("Original bounded native world height required");this.minY=minY;this.maxY=maxY;}
    boolean canAuthorizePlacement(){return false;}
    private static void targetOrExplicitClear(String text){if(!text.equals("minecraft:air"))AssemblyCoupledPolicy.target(text);}
    private BlockState state(String text)throws Exception{
        var value=states.get(text);if(value==null){value=BlockArgumentParser.block(Registries.BLOCK.getReadOnlyWrapper(),text,false).blockState();if(value.hasBlockEntity()||!BlockStateFacts.read(value).state().equals(text))throw new IllegalArgumentException("Original complete native state required");states.put(text,value);}return value;
    }
    private BlockState read(SelectionRegion.Point point){if(point.y()<minY||point.y()>=maxY)throw new IllegalStateException("Native group read outside original world height");var value=Objects.requireNonNull(reader.apply(point),"Unknown/unloaded native group read");if(value.hasBlockEntity())throw new IllegalStateException("Native group read reached protected block entity");return value;}
    private static SelectionRegion.Point point(BlockPos pos){return new SelectionRegion.Point(pos.getX(),pos.getY(),pos.getZ());}
    private WorldView pending(Map<SelectionRegion.Point,BlockState> after){
        // Intentionally NOT a forwarding view. Unknown native world methods
        // fail closed instead of falling through to a chunk-loading API.
        return (WorldView)Proxy.newProxyInstance(WorldView.class.getClassLoader(),new Class<?>[]{WorldView.class},(proxy,method,args)->{
            String name=method.getName();int count=args==null?0:args.length;
            if(count==0){if(name.equals("getBottomY"))return minY;if(name.equals("getHeight"))return maxY-minY;if(name.equals("getTopY"))return maxY;}
            if(count==1&&args[0] instanceof BlockPos pos&&(name.equals("getBlockState")||name.equals("getFluidState"))){var p=point(pos);var value=after.get(p);if(value==null)value=read(p);return name.equals("getBlockState")?value:value.getFluidState();}
            if(count==1&&name.equals("isOutOfHeightLimit")){int y;if(args[0] instanceof BlockPos pos)y=pos.getY();else if(args[0] instanceof Integer value)y=value;else throw new IllegalStateException("Unknown native height read");return y<minY||y>=maxY;}
            throw new IllegalStateException("Native group requested an unadmitted world method: "+name);
        });
    }
    boolean check(List<WorldPatchCompiler.Write> rows,boolean after){
        try{
            if(rows==null||rows.isEmpty()||rows.size()>2)return false;var targets=new LinkedHashMap<SelectionRegion.Point,BlockState>();var before=new ArrayList<BlockState>();var next=new ArrayList<BlockState>();
            for(var row:rows){
                if(row==null||row.position().y()<minY||row.position().y()>=maxY)return false;
                if(mode==Mode.FORWARD){WorldPatchStatePolicy.requireStatic(row.before());targetOrExplicitClear(row.after());}else{targetOrExplicitClear(row.before());WorldPatchStatePolicy.requireStatic(row.after());}
                var b=state(row.before());var a=state(row.after());if(targets.put(row.position(),a)!=null||!read(row.position()).equals(after?a:b))return false;before.add(b);next.add(a);
            }
            var paired=mode==Mode.FORWARD?next:before;boolean door=paired.stream().anyMatch(s->s.getBlock() instanceof DoorBlock);
            if(door){
                if(rows.size()!=2||!(paired.get(0).getBlock() instanceof DoorBlock)||paired.get(0).getBlock()!=paired.get(1).getBlock())return false;
                int lower=mode==Mode.FORWARD?0:1,upper=1-lower;var low=paired.get(lower);var high=paired.get(upper);var p=rows.get(lower).position();var q=rows.get(upper).position();
                if(low.get(DoorBlock.HALF)!=DoubleBlockHalf.LOWER||high.get(DoorBlock.HALF)!=DoubleBlockHalf.UPPER||q.x()!=p.x()||q.z()!=p.z()||q.y()!=p.y()+1)return false;
                if(low.get(DoorBlock.FACING)!=high.get(DoorBlock.FACING)||low.get(DoorBlock.HINGE)!=high.get(DoorBlock.HINGE)||!low.get(DoorBlock.OPEN).equals(high.get(DoorBlock.OPEN))||!low.get(DoorBlock.POWERED).equals(high.get(DoorBlock.POWERED)))return false;
            }else if(rows.size()!=1)return false;
            var view=pending(targets);
            for(int i=0;i<rows.size();i++){var p=rows.get(i).position();if(!next.get(i).canPlaceAt(view,new BlockPos(p.x(),p.y(),p.z())))return false;}
            return true;
        }catch(Exception error){return false;}
    }
}
