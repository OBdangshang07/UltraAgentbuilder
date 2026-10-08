package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.*;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.texture.NativeImageBackedTexture;
import net.minecraft.text.Text;
import net.minecraft.util.Identifier;
import java.io.ByteArrayInputStream;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.function.BooleanSupplier;

/** Explicit local PNG/JPEG import, source-space crop and actual output preview.
 * No model call on opening, importing, editing or free preparation. */
final class StudioReferenceScreen extends Screen {
    record PixelTarget(BooleanSupplier editable,java.util.function.BiConsumer<ReferenceImageDraft.Snapshot,BridgeClient.ReferencePixels> receive) {
        PixelTarget {Objects.requireNonNull(editable);Objects.requireNonNull(receive);}
    }
    private record Row(ClickableWidget widget,int offset,BooleanSupplier enabled) {}
    private final Screen parent;
    private final ReferenceImageDraft draft;
    private final ReferenceDraftStore localStore;
    private final PixelTarget pixelTarget;
    private final WorldPatchPageState pixelPage=new WorldPatchPageState();
    private final List<Row> rows=new ArrayList<>();
    private String selected,path="",caption="",purpose="exterior",view="unknown",scaleDimension="height",meters="";
    private String status="仅本机图片草稿；先在创作页选择建筑提示词、支持图片的 Codex 模型与组件化档位。";
    private int statusColor=StudioTheme.MUTED,sideWidth,cursor,scroll,bodyTop=112,bodyBottom;
    private boolean busy,cropMode,dragging,previewPending;
    private double dragX0,dragY0,dragX1,dragY1;
    private int imageX,imageY,imageWidth,imageHeight,previewTicket;
    private TextFieldWidget pathField,scaleField;
    private StudioEditBoxWidget captionField;
    private Identifier texture;
    private ReferenceImageNormalizer.Result shown;
    private StudioTheme.Button prepare;
    StudioReferenceScreen(Screen parent,ReferenceImageDraft draft){this(parent,draft,null);}
    StudioReferenceScreen(Screen parent,ReferenceImageDraft draft,PixelTarget target){super(Text.literal(target==null?"参考图建筑 · 编辑与发送准备":"参考图＋选区 · 编辑图片"));this.parent=parent;this.draft=draft;pixelTarget=target;this.localStore=new ReferenceDraftStore(StudioClient.BRIDGE.dataDirectory().resolve("client-state/reference-images-v1"));if(target!=null)status="仅准备准确图片；不调用模型、不沿用新建建筑授权。";}
    private ReferenceImageDraft.Photo photo(){return selected==null?null:draft.photo(selected);}
    private boolean targetEditable(){return pixelTarget==null?StudioScreen.referenceDraftEditable():pixelTarget.editable().getAsBoolean();}
    boolean serverImagesEditable(){return !busy&&targetEditable();}
    String serverImagesOwner(){return draft.ownerId();}
    long serverImagesRevision(){return draft.revision();}
    void restoreServerImages(ReferenceImageRestoreReceipt.Loaded loaded,String owner,long revision){
        ReferenceImageRestoreReceipt.apply(loaded,draft,owner,revision,serverImagesEditable());
        selected=null;cropMode=false;dragging=false;path="";
        message("已导入准确规范化图片为新草稿；旧准备与 SEND 失效，未自动保存或调用模型。");
        client.setScreen(this);
    }
    private void select(String id){selected=id;loadAnnotation();clearAndInit();}
    private void loadAnnotation(){
        var p=photo();if(p==null)return;var a=p.annotation();purpose=a.get("purpose").getAsString();view=a.get("view").getAsString();caption=a.get("caption").getAsString();
        scaleDimension=a.has("scale")?a.getAsJsonObject("scale").get("dimension").getAsString():"height";meters=a.has("scale")?a.getAsJsonObject("scale").get("meters").getAsString():"";
    }
    private boolean saveAnnotation(){try{if(selected!=null)draft.annotate(selected,ReferenceImageDraft.annotation(purpose,view,caption,scaleDimension,meters));return true;}catch(Exception e){error(e);return false;}}
    private void error(Throwable e){status=StudioMessages.error(e);statusColor=StudioTheme.ERROR;}
    private void message(String text){status=text;statusColor=StudioTheme.MUTED;}
    @Override protected void init(){
        pixelPage.enter();
        rows.clear();captionField=null;scaleField=null;cursor=0;sideWidth=Math.max(130,Math.min(264,(width-36)*42/100));bodyBottom=height-68;
        var photos=draft.photos();if(selected!=null&&photos.stream().noneMatch(p->p.id().equals(selected)))selected=null;
        if(selected==null&&!photos.isEmpty()){selected=photos.get(0).id();loadAnnotation();}
        pathField=addDrawableChild(new TextFieldWidget(textRenderer,12,43,Math.max(80,width-128),22,Text.literal("本机图片文件的绝对路径")));pathField.setMaxLength(2048);pathField.setText(path);pathField.setChangedListener(s->path=s);pathField.active=!busy;
        var importButton=addDrawableChild(new StudioTheme.Button(width-108,43,96,22,"导入 PNG / JPEG",StudioTheme.Kind.NORMAL,this::importImage));importButton.active=!busy&&photos.size()<4;
        int slotWidth=(width-30)/4;
        for(int i=0;i<4;i++){
            String id=i<photos.size()?photos.get(i).id():null;String label=id==null?"图片 "+(i+1)+" · 空":"图片 "+(i+1)+(id.equals(selected)?" · 当前":"");
            var b=addDrawableChild(new StudioTheme.Button(12+i*(slotWidth+2),74,slotWidth,23,label,id!=null&&id.equals(selected)?StudioTheme.Kind.SELECTED:StudioTheme.Kind.NORMAL,()->{if(saveAnnotation())select(id);}));b.active=!busy&&id!=null;
        }
        rowButton("参考方式："+modeLabel(draft.mode()),()->true,()->choice("参考图的设计用途",ReferenceImageDraft.MODES,draft.mode(),v->{draft.mode(v);message("参考方式已更改；旧准备和确认失效。");},StudioReferenceScreen::modeLabel));
        if(selected!=null){
            rowButton("用途："+purposeLabel(purpose),()->true,()->choice("图片用途",ReferenceImageDraft.PURPOSES,purpose,v->{purpose=v;saveAnnotation();},StudioReferenceScreen::purposeLabel));
            rowButton("视向："+viewLabel(view),()->true,()->choice("图片视向",ReferenceImageDraft.VIEWS,view,v->{view=v;saveAnnotation();},StudioReferenceScreen::viewLabel));
            captionField=row(new StudioEditBoxWidget(textRenderer,12,bodyTop+cursor,sideWidth,60,Text.literal("可见细节、希望保留或改造的部分"),Text.literal("图片说明（最多 500 字）")),()->true);captionField.setMaxLength(500);captionField.setText(caption);captionField.setChangeListener(s->{caption=s;saveAnnotation();});cursor+=66;
            rowButton("尺度："+dimensionLabel(scaleDimension)+"（米）",()->true,()->choice("已知尺度锚点（非估计）",ReferenceImageDraft.DIMENSIONS,scaleDimension,v->{scaleDimension=v;saveAnnotation();},StudioReferenceScreen::dimensionLabel));
            scaleField=row(new TextFieldWidget(textRenderer,12,bodyTop+cursor,sideWidth,22,Text.literal("米；留空表示未知")),()->true);scaleField.setMaxLength(24);scaleField.setText(meters);scaleField.setSuggestion("留空表示未知尺度");scaleField.setChangedListener(s->{meters=s;saveAnnotation();});cursor+=28;
            rowButton("顺时针旋转 90°",()->true,()->transform(photo().crop(),(photo().turns()+1)%4));
            rowButton("恢复完整原图裁剪",()->true,()->transform(null,photo().turns()));
            rowButton("向前排列",()->draft.photos().indexOf(photo())>0,()->{if(saveAnnotation()){draft.move(selected,-1);clearAndInit();}});
            rowButton("向后排列",()->draft.photos().indexOf(photo())<draft.photos().size()-1,()->{if(saveAnnotation()){draft.move(selected,1);clearAndInit();}});
            rowButton("移除当前图片（仅草稿）",()->true,()->{draft.remove(selected);selected=null;clearAndInit();message("已从本地草稿移除；不会删除原文件或已保存的任务图片。");});
        }
        rowButton("保存图片编辑到本机",()->!draft.photos().isEmpty(),this::confirmSave);
        rowButton("恢复本机已保存的图片编辑",this::targetEditable,this::confirmRestore);
        rowButton("删除本机已保存的图片草稿",()->true,this::confirmForget);
        rowButton("服务器准备草稿 · 归档与原操作",()->true,()->{if(saveAnnotation())client.setScreen(new StudioReferenceArchiveScreen(this));});
        rowButton("清空当前内存图片草稿",()->!draft.photos().isEmpty(),()->client.setScreen(new StudioInfoScreen(this,"清空当前内存草稿？","仅释放本次内存中的图片，不删除磁盘保存的图片草稿、源图、Bridge 准备记录或任务原图。未明确保存的编辑会在游戏退出时丢失。","确认清空内存",true,()->{draft.clear();selected=null;client.setScreen(this);message("内存图片草稿已清空；磁盘草稿、原文件和任务记录保留。");})));
        addDrawableChild(new StudioTheme.Button(12,height-34,96,23,pixelTarget==null?"返回创作页":"返回选区任务",StudioTheme.Kind.NORMAL,this::close));
        prepare=addDrawableChild(new StudioTheme.Button(width-180,height-34,168,23,pixelTarget==null?"免费检查 · 准备发送":"准备图片 · 返回改造页",StudioTheme.Kind.PRIMARY,this::prepare));
        var mode=addDrawableChild(new StudioTheme.Button(sideWidth+24,bodyTop,width-sideWidth-36,23,cropMode?"原图裁剪 · 拖选范围":"实际发送效果 · 点击裁剪",StudioTheme.Kind.NORMAL,()->{cropMode=!cropMode;dragging=false;clearAndInit();}));mode.active=selected!=null&&!busy;
        scroll=StudioLayout.clampScroll(scroll,cursor,Math.max(1,bodyBottom-bodyTop));layoutRows();refreshPreview();setInitialFocus(pathField);
    }
    private <T extends ClickableWidget> T row(T widget,BooleanSupplier enabled){addDrawableChild(widget);rows.add(new Row(widget,cursor,enabled));return widget;}
    private void rowButton(String label,BooleanSupplier enabled,Runnable action){row(new StudioTheme.Button(12,bodyTop+cursor,sideWidth,23,label,StudioTheme.Kind.NORMAL,()->{if(!busy)action.run();}),enabled);cursor+=29;}
    private void layoutRows(){for(var r:rows){var w=r.widget();w.setY(bodyTop+r.offset()-scroll);w.visible=w.getY()>=bodyTop&&w.getY()+w.getHeight()<=bodyBottom;w.active=!busy&&r.enabled().getAsBoolean();}}
    private void choice(String title,List<String> values,String current,java.util.function.Consumer<String> callback,java.util.function.Function<String,String> label){
        if(!saveAnnotation())return;client.setScreen(new StudioChoiceScreen(this,title,values.stream().map(v->new StudioChoiceScreen.Choice(v,label.apply(v),v)).toList(),current,callback));
    }
    private void importImage(){
        if(busy||!saveAnnotation())return;busy=true;long revision=draft.revision();String exact=path;message("后台读取并规范化图片；不调用模型。");clearAndInit();
        ReferenceImageIO.work(()->{var source=ReferenceImageIO.read(exact);return draft.add(source,revision);}).whenComplete((id,error)->client.execute(()->{
            busy=false;if(error!=null)error(error);else{selected=id;loadAnnotation();path="";cropMode=false;message("已导入本地像素；路径、文件名与 EXIF 不会上传。请补充用途、视向和已知尺度。");}
            if(client.currentScreen==this)clearAndInit();
        }));
    }
    private void transform(ReferenceImageNormalizer.Crop crop,int turns){
        if(busy||!saveAnnotation())return;var photo=photo();long revision=draft.revision();busy=true;message("正在后台更新裁剪 / 旋转…");clearAndInit();
        ReferenceImageIO.work(()->{var output=photo.source().transform(crop,turns);draft.transform(photo.id(),crop,turns,output,revision);return output;}).whenComplete((result,error)->client.execute(()->{
            busy=false;if(error!=null)error(error);else message("图片已更新；旧准备和确认不再适用。切换到“实际发送效果”检查。");if(client.currentScreen==this)clearAndInit();
        }));
    }
    private void refreshPreview(){
        var p=photo();var next=p==null?null:cropMode?p.source().full:p.output();if(next==shown&&(texture!=null||previewPending))return;
        dropTexture();int ticket=++previewTicket;shown=next;previewPending=shown!=null;if(shown==null)return;
        var pixels=shown;
        ReferenceImageIO.work(()->NativeImage.read(new ByteArrayInputStream(pixels.png()))).whenComplete((image,error)->client.execute(()->{
            if(ticket!=previewTicket||client.currentScreen!=this){if(image!=null)image.close();return;}previewPending=false;if(error!=null){error(error);return;}
            var registered=new NativeImageBackedTexture(image);try{texture=client.getTextureManager().registerDynamicTexture("voxel-reference",registered);}catch(Throwable e){registered.close();error(e);}
        }));
    }
    private void dropTexture(){if(texture!=null&&client!=null){client.getTextureManager().destroyTexture(texture);texture=null;}}
    private void prepare(){
        if(busy||!saveAnnotation())return;
        if(pixelTarget!=null){prepareJointPixels();return;}
        final ReferenceImageDraft.Snapshot snapshot;final JsonObject generation;
        try{snapshot=draft.snapshot();generation=StudioScreen.referenceGenerationRequest(snapshot.ownerId());}catch(Exception e){error(e);return;}
        String world=StudioScreen.referenceWorldScope();busy=true;message("免费检查所选模型、档位与完整预算；尚未上传模型或创建生成任务。");clearAndInit();
        CompletableFuture<JsonObject> ready=generation.has("assemblyDesignReview")&&generation.get("assemblyDesignReview").getAsString().equals("native")?StudioNativeEvidence.ready():CompletableFuture.completedFuture(new JsonObject());
        ready.thenCompose(ignored->StudioClient.BRIDGE.request("POST","/v1/preflight",generation)).whenComplete((policy,error)->client.execute(()->{
            busy=false;if(error!=null){error(error);if(client.currentScreen==this)clearAndInit();return;}
            if(client.currentScreen!=this||!draft.current(snapshot)||!StudioScreen.referenceGenerationCurrent(generation,world)){message("界面、世界或请求已变化，未继续准备。请重新检查。");return;}
            try{
                String detail=StudioAssembly.confirmation(generation,policy)+"\n\n参考图："+snapshot.photos().size()+" 张；识图分析和纠错也占上述总预算，不额外增加。此按钮仅同意上述预算并在本机准备图片，不调用模型；模型调用还需独立 SEND 确认。";
                client.setScreen(new StudioInfoScreen(this,"确认预算 · 免费准备参考图",detail,"确认预算并准备",false,()->{
                    client.setScreen(this);if(!draft.current(snapshot)||!StudioScreen.referenceGenerationCurrent(generation,world)){error(new IllegalStateException("图片/提示词/模型/世界已变化，未准备"));return;}
                    var exact=generation.deepCopy();exact.addProperty("assemblyConfirmed",true);preparePixels(snapshot,exact,policy,world);
                }));
            }catch(Exception e){error(e);clearAndInit();}
        }));
    }
    private void prepareJointPixels(){
        final ReferenceImageDraft.Snapshot exact;try{if(!targetEditable())throw new IllegalStateException("原选区已改变；请返回任务重新读取");exact=draft.snapshot();}catch(Exception e){error(e);return;}
        busy=true;message("本机准备规范化图片并逐像素核验；模型调用 0。");clearAndInit();long ticket=pixelPage.begin();var page=pixelPage.publication();
        StudioClient.BRIDGE.prepareReferencePixels(exact,()->page.getAsBoolean()&&pixelTarget.editable().getAsBoolean()).whenComplete((pixels,failure)->client.execute(()->{
            busy=false;boolean current=pixelPage.finish(ticket)&&client.currentScreen==this&&draft.current(exact)&&targetEditable();
            if(!current){message("图片或原选区页面改变；原图片记录保留，未沿用旧准备或发送。");if(client.currentScreen==this)clearAndInit();return;}
            if(failure!=null){error(failure);clearAndInit();return;}
            try{pixelTarget.receive().accept(exact,pixels);}catch(Exception e){error(e);clearAndInit();}
        }));
    }
    private void preparePixels(ReferenceImageDraft.Snapshot snapshot,JsonObject generation,JsonObject policy,String world){
        busy=true;message("正在本机准备并逐像素核对实际发送图片；零模型调用。");clearAndInit();
        StudioClient.BRIDGE.prepareReference(snapshot,generation,policy).whenComplete((prepared,error)->client.execute(()->{
            busy=false;if(error!=null){error(error);if(client.currentScreen==this)clearAndInit();return;}
            if(client.currentScreen!=this||!draft.current(snapshot)||!StudioScreen.referenceGenerationCurrent(generation,world)){message("旧准备已保留，但当前编辑已改变；未确认或发送模型。");return;}
            client.setScreen(new StudioReferenceConfirmationScreen(this,draft,snapshot,generation,world,prepared));
        }));
    }
    private void confirmSave(){
        if(busy||!saveAnnotation())return;final ReferenceImageDraft.Snapshot exact;
        try{exact=draft.snapshot();}catch(Exception e){error(e);return;}
        client.setScreen(new StudioInfoScreen(this,"保存私人图片草稿到本机？","保存最多四张原始 PNG/JPEG 的副本及裁剪、旋转、排序、标注。原图副本可能含 EXIF，只存在本机；上传仍只使用规范化像素。\n\n保存会替换此前保存的这一份图片草稿，不保存模型、预算、准备或发送授权，也不会创建任务。不要把数据目录随模组分享。\n\n位置："+localStore.file(),"明确保存本机副本",false,()->{
            client.setScreen(this);if(busy||!draft.current(exact)){error(new IllegalStateException("图片已变化，请重新确认保存"));return;}
            busy=true;message("后台保存原图副本与准确编辑；不会上传或调用模型。");clearAndInit();
            localStore.save(draft,exact).whenComplete((saved,error)->client.execute(()->{busy=false;if(error!=null)error(error);else message("已保存 "+saved.images()+" 张图片的本机编辑；退出后可显式恢复。磁盘保存不包含模型授权。");if(client.currentScreen==this)clearAndInit();}));
        }));
    }
    private void confirmRestore(){
        if(busy||!saveAnnotation())return;long revision=draft.revision();
        client.setScreen(new StudioInfoScreen(this,"恢复本机图片编辑？","恢复将替换当前内存图片及编辑，不读取原文件路径、不上传、不调用模型。\n\n恢复的是新图片草稿，仍需重新选择提示词、模型和预算，重新准备并独立确认发送；不是续发旧任务。正在运行或提交回执未知的任务必须保持原身份，不能在此重发。","恢复为新图片草稿",false,()->{
            client.setScreen(this);if(busy||!targetEditable()||draft.revision()!=revision){error(new IllegalStateException("图片或任务状态变化；未恢复旧草稿"));return;}
            busy=true;message("后台读取并校验原图、编辑与实际输出像素…");clearAndInit();
            localStore.load().whenComplete((saved,error)->client.execute(()->{busy=false;
                if(error!=null)error(error);else try{if(!targetEditable())throw new IllegalStateException("原任务状态变化，未恢复或重发");draft.restore(saved.mode(),saved.photos(),revision);selected=null;message("已恢复准确图片编辑为新草稿；原发送确认失效，零模型调用。");}catch(Exception invalid){error(invalid);}
                if(client.currentScreen==this)clearAndInit();
            }));
        }));
    }
    private void confirmForget(){
        if(busy)return;client.setScreen(new StudioInfoScreen(this,"删除这一份本机图片草稿？","仅删除以下明确保存的图片副本及编辑，不可撤销。当前内存编辑、你选择的源文件、服务器准备记录、已发送任务原图和模型证据全部保留。损坏或身份不符的文件不会删除。\n\n"+localStore.file(),"明确删除保存副本",true,()->{
            client.setScreen(this);if(busy)return;busy=true;message("检查并删除明确保存的单个本机草稿文件；不调用模型。");clearAndInit();
            localStore.forget().whenComplete((removed,error)->client.execute(()->{busy=false;if(error!=null)error(error);else message(removed?"已删除本机保存副本，不可撤销；当前内存、源图与任务证据保留。":"没有已保存的本机图片草稿；未删除任何文件。");if(client.currentScreen==this)clearAndInit();}));
        }));
    }
    @Override public void tick(){pathField.tick();if(captionField!=null)captionField.tick();if(scaleField!=null)scaleField.tick();layoutRows();prepare.active=!busy&&targetEditable()&&!draft.photos().isEmpty();}
    @Override public void render(DrawContext d,int mx,int my,float delta){
        d.fill(0,0,width,height,StudioTheme.BG);d.drawText(textRenderer,title,12,12,StudioTheme.ACCENT,false);d.drawText(textRenderer,StudioTheme.fit(textRenderer,"1–4 张图 · 只读取明确选择的本机文件 · 点击保存后可跨游戏恢复",width-24),12,28,StudioTheme.MUTED,false);
        StudioTheme.panel(d,8,bodyTop-4,sideWidth+8,Math.max(1,bodyBottom-bodyTop+8));StudioTheme.panel(d,sideWidth+20,bodyTop-4,width-sideWidth-28,Math.max(1,bodyBottom-bodyTop+8));
        int areaX=sideWidth+28,areaY=bodyTop+30,areaW=Math.max(1,width-areaX-16),areaH=Math.max(1,bodyBottom-areaY-18);
        imageWidth=imageHeight=0;
        if(shown!=null){double fit=Math.min((double)areaW/shown.width(),(double)areaH/shown.height());imageWidth=Math.max(1,(int)(shown.width()*fit));imageHeight=Math.max(1,(int)(shown.height()*fit));imageX=areaX+(areaW-imageWidth)/2;imageY=areaY+(areaH-imageHeight)/2;
            d.fill(imageX,imageY,imageX+imageWidth,imageY+imageHeight,0xff35434c);
            if(texture!=null)d.drawTexture(texture,imageX,imageY,0,0,imageWidth,imageHeight,imageWidth,imageHeight);
            var p=photo();if(cropMode&&p!=null){
                if(dragging)cropBorder(d,Math.min(dragX0,dragX1),Math.min(dragY0,dragY1),Math.max(dragX0,dragX1),Math.max(dragY0,dragY1));
                else if(p.crop()!=null){var crop=p.crop();var size=p.source().dimensions;cropBorder(d,(double)crop.x()/size.width(),(double)crop.y()/size.height(),(double)(crop.x()+crop.width())/size.width(),(double)(crop.y()+crop.height())/size.height());}
            }
            d.drawText(textRenderer,StudioTheme.fit(textRenderer,cropMode?"原图坐标裁剪；旋转只影响输出":shown.width()+"×"+shown.height()+" · 实际规范化像素",areaW),areaX,bodyBottom-12,StudioTheme.MUTED,false);
        }else d.drawText(textRenderer,StudioTheme.fit(textRenderer,"导入图片后显示预览",areaW),areaX,areaY+12,StudioTheme.MUTED,false);
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,status,width-24),12,height-57,statusColor,false);super.render(d,mx,my,delta);
    }
    private void cropBorder(DrawContext d,double x0,double y0,double x1,double y1){int x=imageX+(int)(x0*imageWidth),y=imageY+(int)(y0*imageHeight);StudioTheme.border(d,x,y,Math.max(1,(int)((x1-x0)*imageWidth)),Math.max(1,(int)((y1-y0)*imageHeight)),StudioTheme.ACCENT);}
    private double fractionX(double mouse){return Math.max(0,Math.min(1,(mouse-imageX)/imageWidth));}
    private double fractionY(double mouse){return Math.max(0,Math.min(1,(mouse-imageY)/imageHeight));}
    @Override public boolean mouseClicked(double x,double y,int button){if(!busy&&cropMode&&button==0&&imageWidth>0&&imageHeight>0&&x>=imageX&&x<imageX+imageWidth&&y>=imageY&&y<imageY+imageHeight){dragging=true;dragX0=dragX1=fractionX(x);dragY0=dragY1=fractionY(y);return true;}return super.mouseClicked(x,y,button);}
    @Override public boolean mouseDragged(double x,double y,int button,double dx,double dy){if(dragging&&button==0){dragX1=fractionX(x);dragY1=fractionY(y);return true;}return super.mouseDragged(x,y,button,dx,dy);}
    @Override public boolean mouseReleased(double x,double y,int button){if(dragging&&button==0){dragging=false;dragX1=fractionX(x);dragY1=fractionY(y);if(Math.abs(dragX0-dragX1)*imageWidth>=2&&Math.abs(dragY0-dragY1)*imageHeight>=2)transform(ReferenceImageDraft.crop(photo().source().dimensions,dragX0,dragY0,dragX1,dragY1),photo().turns());return true;}return super.mouseReleased(x,y,button);}
    @Override public boolean mouseScrolled(double x,double y,double amount){if(x<sideWidth+20&&y>=bodyTop&&y<=bodyBottom){scroll=StudioLayout.clampScroll(scroll-(int)(amount*29),cursor,Math.max(1,bodyBottom-bodyTop));layoutRows();return true;}return super.mouseScrolled(x,y,amount);}
    @Override public void removed(){pixelPage.leave();previewTicket++;previewPending=false;dragging=false;dropTexture();captionField=null;scaleField=null;}
    @Override public void close(){saveAnnotation();client.setScreen(parent);}
    @Override public boolean shouldPause(){return false;}
    static String modeLabel(String v){return switch(v){case "reconstruct"->"尽量还原";case "multi-view"->"多视图统一还原";default->"提取设计语言";};}
    static String purposeLabel(String v){return switch(v){case "interior"->"室内";case "plan"->"平面 / 图纸";case "style"->"风格";default->"外观";};}
    static String viewLabel(String v){return switch(v){case "front"->"正面";case "side"->"侧面";case "rear"->"背面";case "aerial"->"鸟瞰";case "section"->"剖面";default->"未知";};}
    static String dimensionLabel(String v){return switch(v){case "width"->"宽度";case "bay"->"开间";default->"高度";};}
}
