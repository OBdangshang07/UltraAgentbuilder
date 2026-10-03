package dev.voxelstudio.client;

import dev.voxelstudio.selection.WorldPatchPlacementService;
import dev.voxelstudio.selection.WorldPatchUndoService;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import net.minecraft.server.MinecraftServer;
import java.util.*;

/** Explicitly reopen progress, never resume/replay an operation from disk. */
final class WorldPatchOperationScreen extends Screen {
    private final Screen parent;private final WorldPatchPageState page=new WorldPatchPageState();private WorldPatchPlacementService.Operation operation;private MinecraftServer owner;private UUID player;
    private String message="只查询当前内置服务器事务；不会开始或恢复写入";private StudioTheme.Button cancel,undo,stopUndo;private boolean queried;private WorldPatchUndoService.Operation undoOperation;
    WorldPatchOperationScreen(Screen parent){super(Text.literal("原位事务 · 当前进度"));this.parent=parent;}
    private boolean same(){return client.getServer()==owner&&client.player!=null&&client.player.getUuid().equals(player);}
    @Override protected void init(){page.enter();if(operation!=null&&!same()){operation=null;undoOperation=null;}int w=Math.min(640,width-24),x=(width-w)/2;undo=addDrawableChild(new StudioTheme.Button(x+12,height-94,(w-30)/2,22,"准备保护式撤销 · 另行确认",StudioTheme.Kind.NORMAL,()->{if(operation!=null&&same())client.setScreen(new WorldPatchUndoScreen(this,operation));}));stopUndo=addDrawableChild(new StudioTheme.Button(x+18+(w-30)/2,height-94,(w-30)/2,22,"显式取消当前撤销",StudioTheme.Kind.NORMAL,()->{if(undoOperation!=null&&same())StudioClient.SELECTION.cancelPatchUndo(undoOperation);}));cancel=addDrawableChild(new StudioTheme.Button(x+12,height-66,(w-30)/2,22,"显式取消当前事务",StudioTheme.Kind.NORMAL,()->{if(operation!=null&&same())StudioClient.SELECTION.cancelPatchOperation(operation);}));addDrawableChild(new StudioTheme.Button(x+18+(w-30)/2,height-66,(w-30)/2,22,"返回 · 已确认事务继续",StudioTheme.Kind.NORMAL,this::close));query();buttons();}
    private void query(){queried=true;owner=client.getServer();player=client.player==null?null:client.player.getUuid();var publication=page.publication();StudioClient.SELECTION.currentPatchOperation().whenComplete((value,error)->client.execute(()->{if(!publication.getAsBoolean()||client.currentScreen!=this||!same())return;if(error!=null){message=root(error);}else{operation=value;message=value==null?"当前没有原位事务；历史磁盘记录不会自动恢复":value.status().reason();}buttons();}));StudioClient.SELECTION.currentPatchUndo().whenComplete((value,error)->client.execute(()->{if(!publication.getAsBoolean()||client.currentScreen!=this||!same())return;if(error==null)undoOperation=value;buttons();}));}
    private static String root(Throwable e){while(e.getCause()!=null)e=e.getCause();return String.valueOf(e.getMessage());}
    private void buttons(){if(cancel!=null)cancel.active=operation!=null&&!operation.result().isDone()&&same();if(undo!=null)undo.active=operation!=null&&same()&&operation.result().isDone()&&Set.of(WorldPatchPlacementService.State.COMPLETED,WorldPatchPlacementService.State.CANCELLED,WorldPatchPlacementService.State.CONFLICT).contains(operation.status().state())&&operation.status().confirmed()>0&&(undoOperation==null||undoOperation.result().isDone());if(stopUndo!=null)stopUndo.active=undoOperation!=null&&!undoOperation.result().isDone()&&same();}
    @Override public void tick(){if(operation!=null&&same()){var s=operation.status();message=s.state()+" · "+s.confirmed()+"/"+s.total()+" · "+s.reason();if(undoOperation!=null){var u=undoOperation.status();message+="\n撤销 "+u.state()+" · 检查 "+u.evaluated()+"/"+u.total()+"，恢复 "+u.restored()+"，保留 "+u.preserved()+" · "+u.reason();}}else if(owner!=null&&!same())message="世界或玩家已改变；此页不操作原事务";buttons();}
    @Override public void render(DrawContext d,int mx,int my,float delta){d.fill(0,0,width,height,StudioTheme.BG);int w=Math.min(640,width-24),x=(width-w)/2;StudioTheme.panel(d,x,12,w,height-24);d.drawText(textRenderer,title,x+12,25,StudioTheme.ACCENT,false);int y=52;for(var line:textRenderer.wrapLines(Text.literal(message+"\n\n关闭面板不取消已确认事务。显示的数量只说明 live 执行器明确确认的修改，不证明世界文件已落盘。待审查结果不自动重放，也不从历史审计创建写入权限。\n\n"+(operation==null?"":("事务："+operation.id()))),w-24)){if(y<height-120)d.drawText(textRenderer,line,x+12,y,StudioTheme.TEXT,false);y+=14;}super.render(d,mx,my,delta);}
    @Override public void removed(){page.leave();}
    @Override public void close(){page.leave();client.setScreen(parent);}
    @Override public boolean shouldPause(){return false;}
}
