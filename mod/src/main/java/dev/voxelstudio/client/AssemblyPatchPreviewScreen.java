package dev.voxelstudio.client;

import dev.voxelstudio.selection.WorldPatchPreview;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.text.Text;
import java.util.*;

/** View controls and a separate explicit final-confirmation route. Filter,
 * preview visibility and hotkeys can never dispatch a world write. */
final class AssemblyPatchPreviewScreen extends Screen {
    private final Screen parent;
    private final AssemblyPatchPreviewController tool=StudioClient.ASSEMBLY_PREVIEW;
    private String error="";
    private PreviewPageBinding<AssemblyPatchCheckedCandidate> binding;
    private record Row(ClickableWidget widget,int y,boolean previewAction){}
    private final List<Row> rows=new ArrayList<>();
    private int x,w,cursor,scroll,bottom;
    AssemblyPatchPreviewScreen(Screen parent){super(Text.literal("完整整组差异 · 原位置预览"));this.parent=parent;}
    @Override protected void init(){
        if(binding!=null)binding.leave();
        var shown=tool.candidate();binding=new PreviewPageBinding<>(shown);
        w=Math.min(520,width-24);x=(width-w)/2;cursor=0;bottom=height-62;rows.clear();
        if(shown!=null&&tool.preview()==shown.preview()){
            for(var mode:WorldPatchPreview.Mode.values()){var selected=mode;control(switch(mode){case CHANGES->"显示差异 · 绿新增 / 红删除 / 黄替换";case BEFORE->"显示改动格原状态 · 仅叠加改动格";case AFTER->"显示改动格目标状态 · 原世界仍可见，红框为删除";},()->change(()->{var f=tool.filter();tool.filter(new WorldPatchPreview.Filter(selected,f.minY(),f.maxY(),f.categories()));}));}
            for(var category:WorldPatchPreview.Difference.values()){var selected=category;control("显隐 "+switch(category){case ADDED->"新增";case REMOVED->"删除";case REPLACED->"替换";},()->change(()->{var f=tool.filter();var set=EnumSet.noneOf(WorldPatchPreview.Difference.class);set.addAll(f.categories());if(!set.remove(selected))set.add(selected);tool.filter(new WorldPatchPreview.Filter(f.mode(),f.minY(),f.maxY(),set));}));}
            control("切低一层",()->layer(-1));control("切高一层",()->layer(1));
            control("恢复全部显示 · 补丁范围不变",()->change(()->tool.filter(tool.preview().all(WorldPatchPreview.Mode.CHANGES))));
            control(tool.visible?"隐藏预览":"显示预览",()->{tool.visible=!tool.visible;clearAndInit();});
            previewButton("准备完整整组应用 · 一次审核和 BEFORE，独立最终确认",value->client.setScreen(new AssemblyPatchPlacementScreen(this,value)));
        }
        button("整组事务进度 / 保护撤销",()->client.setScreen(new AssemblyPatchOperationScreen(this)));button("丢弃差异预览 · 不修改世界",()->{tool.clear();clearAndInit();});button("返回游戏看投影",()->client.setScreen(null));
        addDrawableChild(new StudioTheme.Button(x,height-32,w,22,"返回原页面",StudioTheme.Kind.NORMAL,this::close));layout();
    }
    private boolean snapshotCurrent(){var value=tool.candidate();return value!=null&&tool.preview()==value.preview()&&StudioClient.SELECTION.matchesAssembly(value.preview().binding());}
    private void previewButton(String label,java.util.function.Consumer<AssemblyPatchCheckedCandidate> action){
        var displayed=binding;
        addButton(label,()->{if(!displayed.dispatch(tool.candidate(),snapshotCurrent(),action)){error="原候选或快照已失效；返回重新加载，没有写入";layout();}},true);
    }
    private void control(String label,Runnable action){previewButton(label,value->action.run());}
    private void button(String label,Runnable action){addButton(label,action,false);}
    private void addButton(String label,Runnable action,boolean dependent){var widget=addDrawableChild(new StudioTheme.Button(x,0,w,22,label,StudioTheme.Kind.NORMAL,action));rows.add(new Row(widget,cursor,dependent));cursor+=28;}
    private void layout(){scroll=Math.max(0,Math.min(scroll,Math.max(0,cursor-(bottom-72))));boolean current=binding!=null&&binding.current(tool.candidate(),snapshotCurrent());for(var row:rows){int y=72+row.y-scroll;row.widget.setY(y);row.widget.visible=y>=72&&y+22<=bottom;row.widget.active=row.widget.visible&&(!row.previewAction||current);}}
    void reveal(ClickableWidget widget){for(var row:rows)if(row.widget==widget){scroll=row.y;layout();return;}}
    @Override public boolean mouseScrolled(double mx,double my,double amount){if(my>=72&&my<bottom){scroll-=(int)(amount*28);layout();return true;}return super.mouseScrolled(mx,my,amount);}
    private void change(Runnable operation){try{operation.run();error="";}catch(Exception e){error=e.getMessage();}}
    private void layer(int step){change(()->{var f=tool.filter();int y=f.minY()+step;tool.filter(new WorldPatchPreview.Filter(f.mode(),y,y+1,f.categories()));});}
    @Override public void render(DrawContext draw,int mouseX,int mouseY,float delta){
        renderBackground(draw);draw.drawCenteredTextWithShadow(textRenderer,title,width/2,18,StudioTheme.TEXT);draw.drawCenteredTextWithShadow(textRenderer,"显示过滤不是应用范围；原位置不可移动或旋转，应用需独立确认",width/2,38,StudioTheme.MUTED);
        String status=tool.preview()==null?tool.message:tool.filter().mode()+" · Y ["+tool.filter().minY()+", "+tool.filter().maxY()+") · 完整整组 "+tool.preview().totalWrites()+" 格 · 原世界未隐藏";
        draw.drawCenteredTextWithShadow(textRenderer,status,width/2,54,StudioTheme.ACCENT);super.render(draw,mouseX,mouseY,delta);if(!error.isEmpty())draw.drawCenteredTextWithShadow(textRenderer,error,width/2,height-54,0xff7777);
    }
    @Override public boolean shouldPause(){return false;}
    @Override public void tick(){layout();}
    @Override public void removed(){if(binding!=null)binding.leave();}
    @Override public void close(){client.setScreen(parent);}
}
