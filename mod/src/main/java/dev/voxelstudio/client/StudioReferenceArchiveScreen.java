package dev.voxelstudio.client;

import com.google.gson.*;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.text.Text;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.function.BooleanSupplier;

/** Server drafts and immutable history. No model or world endpoints. Opening,
 * refreshing and selecting rows only read; each storage action has a separate
 * exact confirmation and stable locally persisted identity. */
final class StudioReferenceArchiveScreen extends Screen {
    private record Row(ClickableWidget widget,int offset){}
    private record Entry(String kind,JsonObject value){String id(){return kind+":"+text(value,kind.equals("draft")?"ownerId":"actionId");}}
    private record Loaded(JsonObject listing,List<JsonObject> local,String warning){}
    private final Screen parent;
    private final StudioReferenceScreen editor;
    private final List<Row> rows=new ArrayList<>();
    private final List<Entry> entries=new ArrayList<>();
    private final ReferenceArchiveUiOperation operation=new ReferenceArchiveUiOperation();
    private JsonObject listing,snapshot,record,reference,actionStatus;
    private List<JsonObject> local=List.of();
    private String tab="draft",selected,status="只读载入本机 Bridge 草稿及原操作；零模型调用，不修改世界。";
    private boolean attempted;
    private Runnable pendingEditorRestore;
    private volatile boolean active;
    private int scroll,cursor,bodyBottom;
    StudioReferenceArchiveScreen(Screen parent){super(Text.literal("参考图草稿 · 归档与原操作"));this.parent=parent;this.editor=parent instanceof StudioReferenceScreen s?s:null;}
    private static String text(JsonObject o,String key){return ReferencePreparationReceipt.text(o,key);}
    private Entry selected(){return entries.stream().filter(e->e.id().equals(selected)).findFirst().orElse(null);}
    private boolean allowed(){return active&&client!=null&&client.currentScreen==this;}
    private boolean busy(){return operation.busy();}
    private boolean complete(long ticket){
        var completion=operation.finish(ticket);if(!completion.released()||!allowed())return false;
        if(!completion.current()){status="旧页面结果未用于当前选择；原记录保留，请只读查询。";clearAndInit();return false;}return true;
    }
    private boolean terminal(){return actionStatus!=null&&Set.of("archived","restored","purged").contains(text(actionStatus,"state"));}
    private boolean archived(){return record!=null&&record.get("maintenance").isJsonNull()&&text(record.getAsJsonObject("status"),"state").equals("archived");}
    @Override protected void init(){
        active=true;rows.clear();entries.clear();cursor=0;bodyBottom=height-166;
        int tabWidth=(width-32)/3;String[] kinds={"draft","archive","local"},labels={"活跃准备草稿","服务器归档历史","本机原操作"};
        for(int i=0;i<3;i++){final String kind=kinds[i];var b=addDrawableChild(new StudioTheme.Button(10+i*(tabWidth+6),43,tabWidth,23,labels[i],tab.equals(kind)?StudioTheme.Kind.SELECTED:StudioTheme.Kind.NORMAL,()->{if(busy()||!allowed())return;tab=kind;selected=null;clearSelection();scroll=0;clearAndInit();}));b.active=!busy();}
        if(tab.equals("local"))for(var r:local)entries.add(new Entry("local",r.deepCopy()));
        else if(listing!=null)for(var e:listing.getAsJsonArray(tab.equals("draft")?"drafts":"actions"))entries.add(new Entry(tab,e.getAsJsonObject().deepCopy()));
        if(selected!=null&&selected()==null){selected=null;clearSelection();}
        int visibleHeight=Math.max(1,bodyBottom-78);scroll=StudioLayout.clampScroll(scroll,entries.size()*29,visibleHeight);
        for(var entry:entries){var value=entry.value();String label=text(value,"ownerId").substring(0,8)+" · "+(entry.kind().equals("draft")?(ReferencePreparationReceipt.flag(value,"archiveAllowed")?"可核对归档":"受保护，不能归档"):
                entry.kind().equals("local")?purposeLabel(text(value,"purpose"))+" · "+text(value,"actionId").substring(0,8):stateLabel(text(value,"state"))+" · "+text(value,"actionId").substring(0,8));
            var button=addDrawableChild(new StudioTheme.Button(10,78+cursor-scroll,width-20,23,label,entry.id().equals(selected)?StudioTheme.Kind.SELECTED:StudioTheme.Kind.NORMAL,()->{
                if(busy()||!allowed())return;selected=entry.id();clearSelection();clearAndInit();query();
            }));rows.add(new Row(button,cursor));cursor+=29;
        }
        int bw=(width-32)/3;int y=height-152;
        button(10,y,bw,"完整范围与详情",()->selected()!=null,()->client.setScreen(new StudioInfoScreen(this,"参考图原操作详情",details())));
        button(16+bw,y,bw,"只读查询原状态",()->selected()!=null,this::query);
        button(22+2*bw,y,bw,"继续同一原操作",()->reference!=null&&!terminal(),this::confirmContinue);
        y+=29;
        button(10,y,bw,"核对并归档草稿",()->selected()!=null&&selected().kind().equals("draft")&&ReferencePreparationReceipt.flag(selected().value(),"archiveAllowed"),this::prepareArchive);
        button(16+bw,y,bw,"恢复归档文件",this::archived,()->prepareMaintenance("restore"));
        button(22+2*bw,y,bw,"永久清理归档文件",this::archived,()->prepareMaintenance("purge"));
        y+=29;
        button(10,y,width-20,"选择准备版本 · 查看并导入为新图片草稿",
            ()->editor!=null&&editor.serverImagesEditable()&&selected()!=null&&selected().kind().equals("draft")&&snapshot!=null&&!snapshot.getAsJsonArray("preparationHashes").isEmpty(),this::chooseEditorRestore);
        addDrawableChild(new StudioTheme.Button(10,height-34,96,23,"返回图片编辑",StudioTheme.Kind.NORMAL,this::close));
        var refresh=addDrawableChild(new StudioTheme.Button(width-132,height-34,122,23,"只读刷新列表",StudioTheme.Kind.NORMAL,this::refresh));refresh.active=!busy();
        layoutRows();if(!attempted&&!busy())refresh();
    }
    private void button(int x,int y,int w,String label,BooleanSupplier enabled,Runnable callback){var b=addDrawableChild(new StudioTheme.Button(x,y,w,23,label,StudioTheme.Kind.NORMAL,()->{if(!busy()&&allowed()&&enabled.getAsBoolean())callback.run();}));b.active=!busy()&&enabled.getAsBoolean();}
    private void layoutRows(){for(var r:rows){var w=r.widget();w.setY(78+r.offset()-scroll);w.visible=w.getY()>=78&&w.getY()+w.getHeight()<=bodyBottom;w.active=!busy();}}
    private void clearSelection(){snapshot=record=reference=actionStatus=null;operation.invalidate();}
    private void refresh(){
        if(busy()||!allowed())return;long ticket=operation.begin();attempted=true;status="正在只读核对能力、草稿及本机原操作…";clearAndInit();
        var saved=StudioClient.BRIDGE.referenceArchiveActions().handle((values,error)->new Loaded(null,values==null?List.of():values,error==null?"":"本机记录未通过核验，保留："+StudioMessages.error(error)));
        var server=StudioClient.BRIDGE.referenceArchiveCapabilities().thenCompose(c->{if(ReferencePreparationReceipt.number(c,"version")!=3)throw new IllegalStateException("当前配套不支持准确原记录查询；未启用管理操作");return StudioClient.BRIDGE.referenceDraftArchives();})
            .handle((value,error)->new Loaded(value,List.of(),error==null?"":"服务端列表未读取；本机记录仍可查看："+StudioMessages.error(error)));
        saved.thenCombine(server,(l,s)->new Loaded(s.listing(),l.local(),l.warning()+(l.warning().isEmpty()||s.warning().isEmpty()?"":"；")+s.warning()))
            .whenComplete((result,error)->client.execute(()->{if(!complete(ticket))return;
                if(error!=null)status=StudioMessages.error(error);else{listing=result.listing();local=result.local();clearSelection();status=result.warning().isEmpty()?"已核对。选择准确草稿／原操作；归档、恢复、清理都需要另行确认。":result.warning();}
                clearAndInit();
            }));
    }
    private void query(){
        var entry=selected();if(busy()||entry==null||!allowed())return;long ticket=operation.begin();status="只读核对原范围与回执；不会继续移动、删除或发送模型…";
        if(entry.kind().equals("local"))reference=entry.value().deepCopy();clearAndInit();
        CompletableFuture<JsonObject> future=entry.kind().equals("draft")?StudioClient.BRIDGE.referenceArchiveSnapshot(text(entry.value(),"ownerId")):
            entry.kind().equals("local")?StudioClient.BRIDGE.readReferenceArchiveAction(entry.value()):StudioClient.BRIDGE.referenceArchiveRecord(text(entry.value(),"ownerId"),text(entry.value(),"actionId"),text(entry.value(),"snapshotHash"));
        future.whenComplete((result,error)->client.execute(()->{if(!complete(ticket))return;
            if(error!=null)status=StudioMessages.error(error)+"；原记录保留，不自动继续。";
            else{
                if(entry.kind().equals("draft"))snapshot=result;
                else if(entry.kind().equals("local"))actionStatus=result;
                else{record=result;actionStatus=result.get("maintenance").isJsonNull()?result.getAsJsonObject("status"):result.getAsJsonObject("maintenance").getAsJsonObject("status");var intent=result.get("maintenance").isJsonNull()?result.getAsJsonObject("originalIntent"):result.getAsJsonObject("maintenance").getAsJsonObject("intent");
                    reference=ReferenceArchiveReceipt.actionReference(result.get("maintenance").isJsonNull()?null:result.getAsJsonObject("originalIntent"),intent.getAsJsonObject("snapshot"),intent.getAsJsonObject("confirmation"));}
                status=actionStatus==null?"准确快照已核验；尚未执行归档。":"原操作状态："+stateLabel(text(actionStatus,"state"))+"；查询零模型／世界操作。";
            }clearAndInit();
        }));
    }
    private void prepareArchive(){
        var entry=selected();if(busy()||entry==null||!entry.kind().equals("draft")||!allowed())return;long ticket=operation.begin();clearAndInit();
        StudioClient.BRIDGE.referenceArchiveSnapshot(text(entry.value(),"ownerId")).whenComplete((s,error)->client.execute(()->{
            if(!complete(ticket))return;if(error!=null){status=StudioMessages.error(error);clearAndInit();return;}
            snapshot=s;String action=UUID.randomUUID().toString();confirmNew(null,s,"archive",action);
        }));
    }
    private void chooseEditorRestore(){
        if(busy()||!allowed()||editor==null||!editor.serverImagesEditable()||snapshot==null)return;
        var exact=snapshot.deepCopy();String owner=editor.serverImagesOwner();long revision=editor.serverImagesRevision();
        var choices=new ArrayList<StudioChoiceScreen.Choice>();int index=0;
        for(var e:exact.getAsJsonArray("preparationHashes")){
            String hash=e.getAsString();choices.add(new StudioChoiceScreen.Choice(hash,"准备版本 "+(++index)+" · "+hash.substring(0,12),hash+" · 只恢复图片，不继承模型请求"));
        }
        final Screen[] picker=new Screen[1];
        picker[0]=new StudioChoiceScreen(this,"明确选择原准备版本（不是自动选择最新）",choices,null,hash->{
            if(client.currentScreen!=picker[0]||!editor.serverImagesEditable()||!owner.equals(editor.serverImagesOwner())||revision!=editor.serverImagesRevision())return;
            // ChoiceScreen returns AFTER its consumer. Do not rely on execute()
            // being deferred on the game thread; start on the next parent tick.
            pendingEditorRestore=()->{if(snapshot!=null&&snapshot.equals(exact))loadEditorRestore(exact,hash,owner,revision);};
        });
        client.setScreen(picker[0]);
    }
    private void loadEditorRestore(JsonObject exact,String hash,String owner,long revision){
        if(busy()||!allowed()||editor==null||!editor.serverImagesEditable()||!owner.equals(editor.serverImagesOwner())||revision!=editor.serverImagesRevision())return;
        long ticket=operation.begin();status="后台只读核验准确原文件与图片像素；未替换当前编辑…";clearAndInit();
        StudioClient.BRIDGE.readReferenceImagesForNewDraft(exact,hash).whenComplete((loaded,error)->client.execute(()->{
            if(!complete(ticket))return;
            if(error!=null){status=StudioMessages.error(error);clearAndInit();return;}
            if(!editor.serverImagesEditable()||!owner.equals(editor.serverImagesOwner())||revision!=editor.serverImagesRevision()){
                status="当前图片或原任务状态已变化；准确旧读取保留，未替换编辑。";clearAndInit();return;
            }
            client.setScreen(new StudioReferenceRestoreScreen(this,editor,loaded,owner,revision));
        }));
    }
    private void prepareMaintenance(String purpose){
        if(busy()||!archived()||!allowed())return;var original=record.deepCopy();long ticket=operation.begin();clearAndInit();
        StudioClient.BRIDGE.referenceArchiveMaintenanceSnapshot(original,purpose).whenComplete((s,error)->client.execute(()->{
            if(!complete(ticket))return;if(error!=null){status=StudioMessages.error(error);clearAndInit();return;}
            confirmNew(original.getAsJsonObject("originalIntent"),s,purpose,UUID.randomUUID().toString());
        }));
    }
    private void confirmNew(JsonObject original,JsonObject s,String purpose,String action){
        client.setScreen(new StudioReferenceArchiveConfirmScreen(this,"确认"+purposeLabel(purpose),describe(purpose,s,action),"明确"+purposeLabel(purpose),purpose,(deletion,copies)->{
            client.setScreen(this);try{var c=purpose.equals("archive")?ReferenceArchiveReceipt.archiveConfirmation(s,action):ReferenceArchiveReceipt.maintenanceConfirmation(s,action,deletion,copies);
                run(ReferenceArchiveReceipt.actionReference(original,s,c),false);}catch(Exception e){status=StudioMessages.error(e);clearAndInit();}
        }));
    }
    private void confirmContinue(){
        if(busy()||reference==null||terminal()||!allowed())return;var exact=reference.deepCopy();String purpose=text(exact,"purpose");
        client.setScreen(new StudioReferenceArchiveConfirmScreen(this,"仅继续同一原操作",describe(purpose,exact.getAsJsonObject("snapshot"),text(exact,"actionId"))+"\n\n结果可能已提交。此按钮仅用原编号和原确认继续，不创建替代操作；不会重发模型。", "明确继续原操作",purpose,(deletion,copies)->{
            client.setScreen(this);if(purpose.equals("purge")&&(!deletion||!copies))return;run(exact,true);
        }));
    }
    private void run(JsonObject exact,boolean continuation){
        if(busy()||!allowed())return;reference=exact.deepCopy();long ticket=operation.begin();status="先保存准确原操作，再执行已明确确认的存储动作；不调用模型。";clearAndInit();
        BooleanSupplier exactScreen=()->allowed()&&operation.current(ticket);
        var future=continuation?StudioClient.BRIDGE.continueReferenceArchiveAction(exact,exactScreen):StudioClient.BRIDGE.startReferenceArchiveAction(exact,exactScreen);
        future.whenComplete((result,error)->client.execute(()->{if(!complete(ticket))return;
            if(error!=null)status=StudioMessages.error(error)+"；保留原操作。先只读查询，勿另建操作。";
            else{actionStatus=result;record=null;status="已核验原回执："+stateLabel(text(result,"state"))+"。请只读刷新列表查看最新记录。";}
            clearAndInit();
        }));
    }
    private String details(){
        if(reference!=null)return describe(text(reference,"purpose"),reference.getAsJsonObject("snapshot"),text(reference,"actionId"))+"\n\n原状态："+(actionStatus==null?"未知；不自动重复动作":stateLabel(text(actionStatus,"state")));
        if(snapshot!=null)return describe("archive",snapshot,"尚未确认操作");
        var entry=selected();return "先只读查询完整范围。列表只用于发现，不能授权归档、清理、模型调用或世界写入。\n\n"+(entry==null?"未选择":entry.value().toString());
    }
    private static String describe(String purpose,JsonObject s,String action){
        var inventory=s.has("inventory")?s.getAsJsonObject("inventory"):s;var files=inventory.getAsJsonArray("files");
        var out=new StringBuilder(purposeLabel(purpose)).append("只影响准确的服务器准备草稿文件。\n\n草稿：").append(text(s,"ownerId")).append("\n操作：").append(action)
            .append("\n范围 hash：").append(text(s,"snapshotHash")).append("\n文件：").append(files.size()).append(" 个；").append(ReferencePreparationReceipt.number(inventory,"totalBytes")).append(" 字节\n\n");
        if(purpose.equals("archive"))out.append("同盘保留移动，释放活跃准备配额；不永久删除。\n");
        else if(purpose.equals("restore"))out.append("恢复准确归档文件到活跃准备目录，拒绝覆盖现有草稿。这里只恢复服务端文件，不替换当前图片编辑，也不继承发送授权。\n");
        else out.append("永久删除下列归档文件，不可撤销；不是清除所有私人副本，也不释放原提交账本配额。\n");
        out.append("任务原图、模型回答、发送与审计记录保留。零新增模型调用，零世界写入；不会生成、放置或重发建筑。\n\n准确文件清单：\n");
        for(var e:files){var f=e.getAsJsonObject();out.append(text(f,"path")).append("\n  ").append(ReferencePreparationReceipt.number(f,"bytes")).append(" 字节 · ").append(text(f,"sha256")).append('\n');}
        return out.toString();
    }
    private static String purposeLabel(String p){return switch(p){case "restore"->"恢复归档";case "purge"->"永久清理归档";default->"归档准备草稿";};}
    private static String stateLabel(String state){return switch(state){case "archived"->"已归档";case "restored"->"已恢复";case "purged"->"已永久清理";case "pending","restore-pending","purge-pending"->"原操作待继续";case "moved-awaiting-receipt","restore-moved-awaiting-receipt","purged-awaiting-receipt"->"动作已发生，原回执待闭合";default->"不可核验，保留不动";};}
    @Override public void render(DrawContext d,int mx,int my,float delta){
        d.fill(0,0,width,height,StudioTheme.BG);d.drawText(textRenderer,title,10,12,StudioTheme.ACCENT,false);
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,"仅管理参考图准备文件；原任务图片和回答保留，不修改世界",width-20),10,29,StudioTheme.MUTED,false);
        if(entries.isEmpty())d.drawText(textRenderer,busy()?"后台核验中…":"此分类没有已核验记录",12,82,StudioTheme.MUTED,false);
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,status,width-20),10,height-57,StudioTheme.MUTED,false);super.render(d,mx,my,delta);
    }
    @Override public boolean mouseScrolled(double x,double y,double amount){if(y>=78&&y<=bodyBottom){scroll=StudioLayout.clampScroll(scroll-(int)(amount*29),cursor,Math.max(1,bodyBottom-78));layoutRows();return true;}return super.mouseScrolled(x,y,amount);}
    @Override public void tick(){if(pendingEditorRestore!=null&&allowed()&&!busy()){var next=pendingEditorRestore;pendingEditorRestore=null;next.run();}}
    @Override public void removed(){active=false;pendingEditorRestore=null;operation.invalidate();}
    @Override public void close(){client.setScreen(parent);}
    @Override public boolean shouldPause(){return false;}
}
