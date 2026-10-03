package dev.voxelstudio.selection;

import com.google.gson.*;
import java.util.*;

public record WorldSelection(WorldIdentity world,long revision,SelectionRegion context,SelectionRegion edit,List<SelectionRegion> protectedRegions) {
    public record WorldIdentity(String worldId,String dimension,int minY,int maxY) {
        public WorldIdentity {if(worldId==null||!worldId.matches("[a-zA-Z0-9_-]{1,128}")||dimension==null||dimension.length()>128||!dimension.matches("[a-z0-9_.-]+:[a-z0-9_./-]+")||minY<-2048||maxY>2048||minY>=maxY||maxY-minY>1024)throw new IllegalArgumentException("无效的世界或维度身份");}
        public JsonObject json(){var o=new JsonObject();o.addProperty("worldId",worldId);o.addProperty("dimension",dimension);o.addProperty("minY",minY);o.addProperty("maxY",maxY);return o;}
    }
    public WorldSelection {
        Objects.requireNonNull(world);Objects.requireNonNull(context);Objects.requireNonNull(edit);Objects.requireNonNull(protectedRegions);
        if(revision<0||revision>9007199254740991L)throw new IllegalArgumentException("无效的选区版本");context.height(world.minY,world.maxY);edit.height(world.minY,world.maxY);
        if(!context.contains(edit))throw new IllegalArgumentException("内层必须完整位于外层只读范围中");
        if(context.cells()>SelectionLimits.contextCells()||edit.cells()>SelectionLimits.editCells())throw new IllegalArgumentException("选区体积超出安全额度");
        if(protectedRegions.size()>SelectionLimits.protectedRegions())throw new IllegalArgumentException("保护区过多");
        var copy=new ArrayList<>(protectedRegions);copy.sort(Comparator.comparing(r->r.json().toString()));
        for(var region:copy)if(!context.contains(region))throw new IllegalArgumentException("保护区不能超出外层");
        if(new HashSet<>(copy).size()!=copy.size())throw new IllegalArgumentException("保护区重复");protectedRegions=List.copyOf(copy);
    }
    public boolean protectedAt(SelectionRegion.Point point){return !edit.contains(point)||protectedRegions.stream().anyMatch(r->r.contains(point));}
    public JsonObject json(){var o=new JsonObject();o.addProperty("format","WorldSelection");o.addProperty("version",1);o.add("world",world.json());o.addProperty("revision",revision);o.add("context",context.json());o.add("edit",edit.json());var p=new JsonArray();protectedRegions.forEach(r->p.add(r.json()));o.add("protected",p);return o;}
    public record Chunk(int x,int z,SelectionRegion region){}
    public List<Chunk> chunks(){var result=new ArrayList<Chunk>();for(int z=Math.floorDiv(context.min().z(),16);z<=Math.floorDiv(context.max().z()-1,16);z++)for(int x=Math.floorDiv(context.min().x(),16);x<=Math.floorDiv(context.max().x()-1,16);x++){
        var min=new SelectionRegion.Point(Math.max(context.min().x(),x*16),context.min().y(),Math.max(context.min().z(),z*16));
        var max=new SelectionRegion.Point(Math.min(context.max().x(),(x+1)*16),context.max().y(),Math.min(context.max().z(),(z+1)*16));
        result.add(new Chunk(x,z,new SelectionRegion(min,max)));
    }if(result.size()>SelectionLimits.chunks())throw new IllegalArgumentException("区块数量超限");return List.copyOf(result);}
}
