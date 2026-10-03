package dev.voxelstudio.selection;

import java.util.*;

/** Pure editable UI state. Atomic mutations cannot enlarge another scope. */
public final class SelectionDraft {
    public enum Target { CONTEXT,EDIT,PROTECTED }
    private WorldSelection.WorldIdentity world;private long revision;private SelectionRegion context,edit;
    private List<SelectionRegion> protectedRegions=new ArrayList<>();private Target target=Target.CONTEXT;private int protectionIndex=-1;private SelectionRegion.Point first;
    public SelectionDraft(WorldSelection.WorldIdentity world){this.world=Objects.requireNonNull(world);}
    public WorldSelection.WorldIdentity world(){return world;}
    public long revision(){return revision;}
    public SelectionRegion context(){return context;}
    public SelectionRegion edit(){return edit;}
    public List<SelectionRegion> protectedRegions(){return List.copyOf(protectedRegions);}
    public SelectionRegion.Point first(){return first;}
    public Target target(){return target;}
    public int protectionIndex(){return protectionIndex;}
    private void bump(){if(revision>=9007199254740991L)throw new IllegalStateException("选区版本超限");revision++;}
    public void target(Target next,int index){Objects.requireNonNull(next);if(next==Target.PROTECTED&&(index<-1||index>=protectedRegions.size()))throw new IllegalArgumentException("不存在的保护区");if(first!=null){first=null;bump();}target=next;protectionIndex=next==Target.PROTECTED?index:-1;}
    public void first(SelectionRegion.Point point){Objects.requireNonNull(point);if(point.y()<world.minY()||point.y()>=world.maxY())throw new IllegalArgumentException("点超出维度高度");first=point;bump();}
    public void second(SelectionRegion.Point point){if(first==null)throw new IllegalStateException("先选第一个点");region(SelectionRegion.corners(first,point));first=null;}
    public SelectionRegion current(){return switch(target){case CONTEXT->context;case EDIT->edit;case PROTECTED->protectionIndex<0?null:protectedRegions.get(protectionIndex);};}
    private void validate(SelectionRegion c,SelectionRegion e,List<SelectionRegion> p){if(c!=null){c.height(world.minY(),world.maxY());if(c.cells()>SelectionLimits.contextCells())throw new IllegalArgumentException("外层体积超限");}
        if(e!=null){e.height(world.minY(),world.maxY());if(c==null||!c.contains(e))throw new IllegalArgumentException("小选区必须位于外层");if(e.cells()>SelectionLimits.editCells())throw new IllegalArgumentException("小选区体积超限");}
        if(p.size()>SelectionLimits.protectedRegions()||new HashSet<>(p).size()!=p.size())throw new IllegalArgumentException("保护区重复或过多");for(var r:p)if(c==null||!c.contains(r))throw new IllegalArgumentException("保护区超出外层");
    }
    public void region(SelectionRegion region){Objects.requireNonNull(region);var c=context;var e=edit;var p=new ArrayList<>(protectedRegions);
        switch(target){case CONTEXT->c=region;case EDIT->e=region;case PROTECTED->{if(protectionIndex<0)p.add(region);else p.set(protectionIndex,region);}}
        validate(c,e,p);bump();context=c;edit=e;protectedRegions=p;if(target==Target.PROTECTED&&protectionIndex<0)protectionIndex=p.size()-1;first=null;
    }
    public void move(int axis,int step){if(current()==null)throw new IllegalStateException("尚无当前选区");region(current().move(axis,step));}
    public void face(int axis,boolean maximum,int value){if(current()==null)throw new IllegalStateException("尚无当前选区");region(current().face(axis,maximum,value));}
    public void clear(){bump();first=null;switch(target){case CONTEXT->{context=edit=null;protectedRegions=new ArrayList<>();}case EDIT->edit=null;case PROTECTED->{if(protectionIndex>=0)protectedRegions.remove(protectionIndex);protectionIndex=-1;}}}
    public void world(WorldSelection.WorldIdentity next){if(world.equals(next))return;bump();world=Objects.requireNonNull(next);context=edit=null;protectedRegions=new ArrayList<>();first=null;target=Target.CONTEXT;protectionIndex=-1;}
    public WorldSelection selection(){if(first!=null)throw new IllegalStateException("先完成两点选择");if(context==null||edit==null)throw new IllegalStateException("需要外层环境范围和内层改造范围");return new WorldSelection(world,revision,context,edit,protectedRegions);}
}
