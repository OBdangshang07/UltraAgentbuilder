package dev.voxelstudio.client;

import dev.voxelstudio.*;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import java.util.*;

/** Read-only recovery landing page. Ambiguous batches never expose an automatic restore action. */
final class StudioRecoveryScreen extends Screen {
    private final Screen parent;private List<JournalRecovery.Review> records=List.of();private String status="正在读取当前世界/维度的日志…",scope;private int page;private boolean requested;
    StudioRecoveryScreen(Screen parent){super(Text.literal("世界操作 / 恢复中心"));this.parent=parent;}
    StudioRecoveryScreen auditFixture(){if(!net.fabricmc.loader.api.FabricLoader.getInstance().isDevelopmentEnvironment()||!Boolean.getBoolean("voxelstudio.uitest"))throw new IllegalStateException("Development UI fixture only");requested=true;status="测试数据：有 1 条记录需要人工审查，不会自动恢复";records=List.of(new JournalRecovery.Review("11111111-1111-1111-1111-111111111111",new com.google.gson.JsonObject(),List.of(),1,1,false,null));return this;}
    @Override protected void init(){
        int x=Math.max(12,(width-480)/2),w=Math.min(480,width-24),limit=Math.max(1,(height-125)/28),start=page*limit;
        addDrawableChild(new StudioTheme.Button(x,height-36,80,23,"返回",StudioTheme.Kind.NORMAL,this::close));
        if(page>0)addDrawableChild(new StudioTheme.Button(x+86,height-36,80,23,"上一页",StudioTheme.Kind.NORMAL,()->{page--;clearAndInit();}));
        if(start+limit<records.size())addDrawableChild(new StudioTheme.Button(x+w-80,height-36,80,23,"下一页",StudioTheme.Kind.NORMAL,()->{page++;clearAndInit();}));
        for(int i=start;i<Math.min(records.size(),start+limit);i++){
            var r=records.get(i);String state=r.needsReview()?"需人工审查":r.undone()?"已有撤销记录":"需核对当前世界";
            addDrawableChild(new StudioTheme.Button(x,77+(i-start)*28,w,23,state+" · "+r.id().substring(0,8)+" · 日志 "+r.entries().size()+" 格",r.needsReview()?StudioTheme.Kind.DANGER:StudioTheme.Kind.NORMAL,()->details(r)));
        }
        if(!requested){requested=true;scope=StudioClient.PROJECTION.key();
            if(client.getServer()==null||client.player==null){status="需要进入单人创造世界";return;}
            PlacementService.journals(client.getServer(),client.player.getUuid()).whenComplete((r,e)->client.execute(()->{
                if(!scope.equals(StudioClient.PROJECTION.key())){status="世界变化，未显示旧世界记录";return;}if(e!=null){status=StudioMessages.error(e);return;}records=r;status=r.isEmpty()?"当前维度没有记录":"仅列出最近 100 条；日志数量不等于重启后世界实际写入数量";if(client.currentScreen==this)clearAndInit();
            }));
        }
    }
    private void details(JournalRecovery.Review r){
        if(!scope.equals(StudioClient.PROJECTION.key())||client.getServer()==null||client.player==null){status="世界变化，请返回重查";return;}
        if(r.metadata().has("player")){status="正在只读核对世界方块…";PlacementService.audit(client.getServer(),client.player.getUuid(),r).whenComplete((audit,e)->client.execute(()->{if(e!=null){status=StudioMessages.error(e);return;}if(client.currentScreen!=this||!scope.equals(StudioClient.PROJECTION.key()))return;showDetails(r,"\n\n当前世界核对：等于原状态 "+audit.matchesBefore()+"；等于写后状态 "+audit.matchesAfter()+"；后续修改/风险 "+audit.conflicts()+"；未加载/不可用 "+audit.unavailable()+"。\n这是只读瞬时统计，撤销执行时仍重新核验。缺回执部分没有可据以恢复的事实，即使方块看起来相同也不能自动恢复。");}));}
        else showDetails(r,"");
    }
    private void showDetails(JournalRecovery.Review r,String audit){
        var metadata=r.metadata().deepCopy();metadata.remove("player");
        String text="记录："+r.id()+"\n意图批次："+r.intentBatches()+"\n有回执的方块："+r.entries().size()+"\n缺回执批次："+r.missingReceipts()+"\n已有撤销标记："+r.undone()+"\n问题："+(r.issue()==null?"无已知格式错误":r.issue())+"\n\n建筑/位置元数据（已省略玩家标识）：\n"+metadata+audit+"\n\n日志回执落盘不代表世界区块已保存。请先备份世界和日志；重启后应核对实际方块。缺少回执或日志损坏时不会猜测续写/撤销。\n\n明确撤销只处理当前仍匹配本次 after 状态的方块；已经等于 before 的格子不重复处理，后续其他修改保留。";
        if(r.needsReview()||r.undone())client.setScreen(new StudioInfoScreen(this,"恢复审查 · 不自动写入",text));
        else client.setScreen(new StudioInfoScreen(this,"核对后撤销此记录？",text,"确认撤销此记录",true,()->{
            if(!scope.equals(StudioClient.PROJECTION.key())||StudioClient.PROJECTION.busy){status="世界或操作状态变化，请返回重查";client.setScreen(this);return;}
            var p=StudioClient.PROJECTION;p.busy=true;PlacementService.undo(client.getServer(),client.player.getUuid(),r.id(),result->client.execute(()->{p.busy=!result.finished();p.status=StudioMessages.operation(result.message())+" · 恢复 "+result.changed()+" · 冲突 "+result.conflicts();}));client.setScreen(parent);
        }));
    }
    @Override public void render(DrawContext d,int mx,int my,float delta){d.fill(0,0,width,height,StudioTheme.BG);d.drawText(textRenderer,title,14,16,StudioTheme.ACCENT,false);int y=34;for(var line:textRenderer.wrapLines(Text.literal(status),width-28)){d.drawText(textRenderer,line,14,y,StudioTheme.MUTED,false);y+=12;if(y>65)break;}super.render(d,mx,my,delta);}
    @Override public void close(){client.setScreen(parent);}
    @Override public boolean shouldPause(){return false;}
}
