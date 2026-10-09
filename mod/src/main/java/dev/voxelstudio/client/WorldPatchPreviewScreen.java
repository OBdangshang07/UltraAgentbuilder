package dev.voxelstudio.client;

import dev.voxelstudio.selection.WorldPatchPreview;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.text.Text;
import java.util.*;

/** View controls and a separate explicit final-confirmation route. Filter,
 * preview visibility and hotkeys can never dispatch a world write. */
final class WorldPatchPreviewScreen extends Screen {
    private final Screen parent;
    private final WorldPatchPreviewController tool=StudioClient.PATCH_PREVIEW;
    private String error="";
    private PreviewPageBinding<WorldPatchPreview> viewBinding;
    private PreviewPageBinding<WorldPatchCheckedCandidate> candidateBinding;
    private record Row(ClickableWidget widget,int y,boolean previewAction,boolean candidateAction){}
    private final List<Row> rows=new ArrayList<>();
    private int x,w,cursor,scroll,bottom;
    WorldPatchPreviewScreen(Screen parent){super(Text.literal("改造差异 · 实验只读预览"));this.parent=parent;}
    @Override protected void init(){
        if(viewBinding!=null)viewBinding.leave();if(candidateBinding!=null)candidateBinding.leave();
        var shown=tool.preview();var candidate=tool.candidate();viewBinding=new PreviewPageBinding<>(shown);candidateBinding=new PreviewPageBinding<>(candidate);
        w=Math.min(520,width-24);x=(width-w)/2;cursor=0;bottom=height-62;rows.clear();
        if(shown!=null){
            for(var mode:WorldPatchPreview.Mode.values()){var selected=mode;control(switch(mode){case CHANGES->"显示差异 · 绿新增 / 红删除 / 黄替换";case BEFORE->"显示改动格原状态 · 仅叠加改动格";case AFTER->"显示改动格目标状态 · 原世界仍可见，红框为删除";},()->change(()->{var f=tool.filter();tool.filter(new WorldPatchPreview.Filter(selected,f.minY(),f.maxY(),f.categories()));}));}
            for(var category:WorldPatchPreview.Difference.values()){var selected=category;control("显隐 "+switch(category){case ADDED->"新增";case REMOVED->"删除";case REPLACED->"替换";},()->change(()->{var f=tool.filter();var set=EnumSet.noneOf(WorldPatchPreview.Difference.class);set.addAll(f.categories());if(!set.remove(selected))set.add(selected);tool.filter(new WorldPatchPreview.Filter(f.mode(),f.minY(),f.maxY(),set));}));}
            control("切低一层",()->layer(-1));control("切高一层",()->layer(1));
            control("恢复全部显示 · 补丁范围不变",()->change(()->tool.filter(tool.preview().all(WorldPatchPreview.Mode.CHANGES))));
            control(tool.visible?"隐藏预览":"显示预览",()->{tool.visible=!tool.visible;clearAndInit();});
            previewButton("校验当前服务器 BEFORE · 只读取、不建造",value->client.setScreen(new WorldPatchBeforeScreen(this,value)));
            if(candidate!=null&&candidate.preview()==shown){candidateButton("独立核验补丁规则 · 不调用模型、不建造",value->client.setScreen(new WorldPatchAuditScreen(this,value)));candidateButton("准备原位应用 · 先校验，再独立最终确认",value->client.setScreen(new WorldPatchPlacementScreen(this,value)));}
        }
        button("丢弃差异预览 · 不修改世界",()->{tool.clear();clearAndInit();});button("返回游戏看投影",()->client.setScreen(null));
        addDrawableChild(new StudioTheme.Button(x,height-32,w,22,"返回选区",StudioTheme.Kind.NORMAL,this::close));layout();
    }
    private boolean snapshotCurrent(){var value=tool.preview();return value!=null&&StudioClient.SELECTION.matchesPreview(value.binding());}
    private boolean candidateCurrent(){var value=tool.candidate();return value!=null&&value.preview()==tool.preview();}
    private void rejected(){error="原预览、候选或快照已失效；返回重新加载，没有写入";layout();}
    private void previewButton(String label,java.util.function.Consumer<WorldPatchPreview> action){var displayed=viewBinding;addButton(label,()->{if(!displayed.dispatch(tool.preview(),snapshotCurrent(),action))rejected();},true,false);}
    private void candidateButton(String label,java.util.function.Consumer<WorldPatchCheckedCandidate> action){
        var displayed=viewBinding;var checked=candidateBinding;
        addButton(label,()->{if(!displayed.current(tool.preview(),snapshotCurrent())||!checked.dispatch(tool.candidate(),candidateCurrent(),action))rejected();},true,true);
    }
    private void control(String label,Runnable action){previewButton(label,value->action.run());}
    private void button(String label,Runnable action){addButton(label,action,false,false);}
    private void addButton(String label,Runnable action,boolean preview,boolean candidate){var widget=addDrawableChild(new StudioTheme.Button(x,0,w,22,label,StudioTheme.Kind.NORMAL,action));rows.add(new Row(widget,cursor,preview,candidate));cursor+=28;}
    private void layout(){scroll=Math.max(0,Math.min(scroll,Math.max(0,cursor-(bottom-72))));boolean current=viewBinding!=null&&viewBinding.current(tool.preview(),snapshotCurrent()),checked=candidateBinding!=null&&candidateBinding.current(tool.candidate(),candidateCurrent());for(var row:rows){int y=72+row.y-scroll;row.widget.setY(y);row.widget.visible=y>=72&&y+22<=bottom;row.widget.active=row.widget.visible&&(!row.previewAction||current)&&(!row.candidateAction||checked);}}
    void reveal(ClickableWidget widget){for(var row:rows)if(row.widget==widget){scroll=row.y;layout();return;}}
    @Override public boolean mouseScrolled(double mx,double my,double amount){if(my>=72&&my<bottom){scroll-=(int)(amount*28);layout();return true;}return super.mouseScrolled(mx,my,amount);}
    private void change(Runnable operation){try{operation.run();error="";}catch(Exception e){error=e.getMessage();}}
    private void layer(int step){change(()->{var f=tool.filter();int y=f.minY()+step;tool.filter(new WorldPatchPreview.Filter(f.mode(),y,y+1,f.categories()));});}
    @Override public void render(DrawContext draw,int mouseX,int mouseY,float delta){
        renderBackground(draw);draw.drawCenteredTextWithShadow(textRenderer,title,width/2,18,StudioTheme.TEXT);draw.drawCenteredTextWithShadow(textRenderer,"显示过滤不是应用范围；原位置不可移动或旋转，应用需独立确认",width/2,38,StudioTheme.MUTED);
        String status=tool.preview()==null?tool.message:tool.filter().mode()+" · Y ["+tool.filter().minY()+", "+tool.filter().maxY()+") · 原补丁 "+tool.preview().totalWrites()+" 格 · 原世界未隐藏";
        draw.drawCenteredTextWithShadow(textRenderer,status,width/2,54,StudioTheme.ACCENT);super.render(draw,mouseX,mouseY,delta);if(!error.isEmpty())draw.drawCenteredTextWithShadow(textRenderer,error,width/2,height-54,0xff7777);
    }
    @Override public boolean shouldPause(){return false;}
    @Override public void tick(){layout();}
    @Override public void removed(){if(viewBinding!=null)viewBinding.leave();if(candidateBinding!=null)candidateBinding.leave();}
    @Override public void close(){client.setScreen(parent);}
}
