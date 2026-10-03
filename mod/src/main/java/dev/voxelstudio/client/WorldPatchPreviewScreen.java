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
    private record Row(ClickableWidget widget,int y){}
    private final List<Row> rows=new ArrayList<>();
    private int x,w,cursor,scroll,bottom;
    WorldPatchPreviewScreen(Screen parent){super(Text.literal("改造差异 · 实验只读预览"));this.parent=parent;}
    @Override protected void init(){
        w=Math.min(520,width-24);x=(width-w)/2;cursor=0;bottom=height-62;rows.clear();
        if(tool.preview()!=null){
            for(var mode:WorldPatchPreview.Mode.values()){var selected=mode;button(switch(mode){case CHANGES->"显示差异 · 绿新增 / 红删除 / 黄替换";case BEFORE->"显示改动格原状态 · 仅叠加改动格";case AFTER->"显示改动格目标状态 · 原世界仍可见，红框为删除";},()->change(()->{var f=tool.filter();tool.filter(new WorldPatchPreview.Filter(selected,f.minY(),f.maxY(),f.categories()));}));}
            for(var category:WorldPatchPreview.Difference.values()){var selected=category;button("显隐 "+switch(category){case ADDED->"新增";case REMOVED->"删除";case REPLACED->"替换";},()->change(()->{var f=tool.filter();var set=EnumSet.noneOf(WorldPatchPreview.Difference.class);set.addAll(f.categories());if(!set.remove(selected))set.add(selected);tool.filter(new WorldPatchPreview.Filter(f.mode(),f.minY(),f.maxY(),set));}));}
            button("切低一层",()->layer(-1));button("切高一层",()->layer(1));
            button("恢复全部显示 · 补丁范围不变",()->change(()->tool.filter(tool.preview().all(WorldPatchPreview.Mode.CHANGES))));
            button(tool.visible?"隐藏预览":"显示预览",()->{tool.visible=!tool.visible;clearAndInit();});
            button("校验当前服务器 BEFORE · 只读取、不建造",()->client.setScreen(new WorldPatchBeforeScreen(this,tool.preview())));
            if(tool.candidate()!=null){button("独立核验补丁规则 · 不调用模型、不建造",()->client.setScreen(new WorldPatchAuditScreen(this,tool.candidate())));button("准备原位应用 · 先校验，再独立最终确认",()->client.setScreen(new WorldPatchPlacementScreen(this,tool.candidate())));}
        }
        button("丢弃差异预览 · 不修改世界",()->{tool.clear();clearAndInit();});button("返回游戏看投影",()->client.setScreen(null));
        addDrawableChild(new StudioTheme.Button(x,height-32,w,22,"返回选区",StudioTheme.Kind.NORMAL,this::close));layout();
    }
    private void button(String label,Runnable action){var widget=addDrawableChild(new StudioTheme.Button(x,0,w,22,label,StudioTheme.Kind.NORMAL,action));rows.add(new Row(widget,cursor));cursor+=28;}
    private void layout(){scroll=Math.max(0,Math.min(scroll,Math.max(0,cursor-(bottom-72))));for(var row:rows){int y=72+row.y-scroll;row.widget.setY(y);row.widget.visible=row.widget.active=y>=72&&y+22<=bottom;}}
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
    @Override public void close(){client.setScreen(parent);}
}
