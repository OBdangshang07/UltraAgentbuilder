package dev.voxelstudio.client;

import dev.voxelstudio.selection.*;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.*;
import net.minecraft.text.Text;
import java.util.*;

/** Read-only selection/analysis panel. No placement or implicit send action. */
final class SelectionScreen extends Screen {
    private final Screen parent;private final SelectionController tool=StudioClient.SELECTION;
    private final List<Row> rows=new ArrayList<>();private final List<Label> labels=new ArrayList<>();
    private record Row(ClickableWidget widget,int y){}private record Label(String text,int y,int color){}
    private TextFieldWidget[] coordinates;private int x,w,bodyTop=52,bodyBottom,scroll,cursor;private boolean readyBefore;private SelectionDraft.Target targetBefore;private int indexBefore;
    SelectionScreen(Screen parent){super(Text.literal("环境选区 · 只读"));this.parent=parent;}
    @Override protected void init(){
        w=Math.min(600,width-24);x=(width-w)/2;bodyBottom=height-80;rows.clear();labels.clear();cursor=0;coordinates=null;
        readyBefore=tool.ready();targetBefore=readyBefore?tool.draft.target():null;indexBefore=readyBefore?tool.draft.protectionIndex():-1;
        if(!readyBefore){paragraph("仅支持单人创造模式房主。进入世界后重新检查；不会读取远程服务器。",StudioTheme.MUTED);button("检查当前世界",tool::retryIdentity);}
        else{
            paragraph("蓝色外层 C：环境只读；橙色内层 W：后续改造范围；红色区域：始终保护。",StudioTheme.MUTED);
            int part=(w-32)/3;
            for(int i=0;i<3;i++){var target=SelectionDraft.Target.values()[i];int index=target==SelectionDraft.Target.PROTECTED?tool.draft.protectionIndex():-1;var label=new String[]{"外层环境","内层改造","保护区"}[i];row(new StudioTheme.Button(x+12+i*(part+4),0,part,22,label,target==tool.draft.target()?StudioTheme.Kind.SELECTED:StudioTheme.Kind.NORMAL,()->{tool.target(target,index);clearAndInit();}),cursor);}cursor+=30;
            if(tool.draft.target()==SelectionDraft.Target.PROTECTED){
                button("新增保护区 · "+tool.draft.protectedRegions().size()+"/"+SelectionLimits.protectedRegions(),()->{tool.target(SelectionDraft.Target.PROTECTED,-1);clearAndInit();});
                for(int i=0;i<tool.draft.protectedRegions().size();i++){int selected=i;button("编辑保护区 "+(i+1),()->{tool.target(SelectionDraft.Target.PROTECTED,selected);clearAndInit();});}
            }
            button("在世界里两点选择 / 拖动边界",()->{StudioClient.PROJECTION.visible=false;client.setScreen(new SelectionWorldScreen(this));});
            paragraph("精确坐标：min 包含，max 不包含。鼠标两点会包含所选的两个方块。",StudioTheme.MUTED);
            coordinates=new TextFieldWidget[6];var current=tool.draft.current();
            for(int side=0;side<2;side++){paragraph(side==0?"最小边界 X / Y / Z":"最大边界 X / Y / Z（不包含）",StudioTheme.ACCENT);
                for(int axis=0;axis<3;axis++){var field=new TextFieldWidget(textRenderer,x+12+axis*(part+4),0,part,20,Text.literal((side==0?"min ":"max ")+new String[]{"X","Y","Z"}[axis]));field.setMaxLength(11);field.setTextPredicate(s->s.matches("-?\\d{0,10}"));field.setText(current==null?"":Integer.toString((side==0?current.min():current.max()).axis(axis)));coordinates[side*3+axis]=field;row(field,cursor);}cursor+=28;
            }
            button("应用六个坐标 · 不移动其他范围",()->{long before=tool.draft.revision();tool.mutate(()->{int[] v=Arrays.stream(coordinates).mapToInt(f->Integer.parseInt(f.getText())).toArray();tool.draft.region(new SelectionRegion(new SelectionRegion.Point(v[0],v[1],v[2]),new SelectionRegion.Point(v[3],v[4],v[5])));});if(tool.draft.revision()!=before)clearAndInit();});
            if(current!=null)paragraph("当前范围 "+current.cells()+" 格；"+current.min().json()+" → "+current.max().json(),StudioTheme.MUTED);
            button("清除当前范围",()->{tool.mutate(()->tool.draft.clear());clearAndInit();});
            button(tool.visible?"隐藏边框":"显示边框",()->{tool.visible=!tool.visible;clearAndInit();});
            paragraph("快照只保存方块状态和方块实体类型能力标记，不读取 NBT、容器、告示牌、书籍、实体或存档路径。未加载区块标为未知，不加载、不当作空气。",StudioTheme.MUTED);
            button("读取环境 · 零模型调用，零世界写入",tool::read);
            button("本地保存快照 + 后台环境摘要",tool::saveContext);
            button("核验已保存快照 / 查看环境摘要",()->tool.showSummary(this));
            button("准备 AI 环境分析任务 · 尚不发送",()->client.setScreen(new ContextTaskScreen(this)));
            button("审核已确认任务的一次发送 · 默认关闭",()->tool.openAnalysisSend(this));
            button("原选区分析历史 · 只查询，不重发",()->client.setScreen(new ContextAnalysisHistoryScreen(this)));
            button("准备 AI 原位改造 · 新逐格披露，不调用",()->client.setScreen(new WorldPatchTaskScreen(this)));
            button("原位改造的一次独立发送审核",()->tool.openPatchSend(this));
            button("原位改造历史 / 候选 · 只查询",()->client.setScreen(new WorldPatchHistoryScreen(this)));
            button("参考图＋场地 · 完整四档建筑任务",()->client.setScreen(new ReferenceWorldAssemblyTaskScreen(this)));
            button("完整联合历史 / 后台任务 · 不重发",()->client.setScreen(new ReferenceWorldAssemblyHistoryScreen(this)));
            button("旧参考图局部改造 · 一调用审核（独立协议）",()->tool.openReferencePatchSend(this));
            button("旧参考图局部改造历史 · 不升级确认",()->client.setScreen(new ReferenceWorldPatchHistoryScreen(this)));
            if(StudioClient.PATCH_PREVIEW.preview()!=null)button("原位差异预览 · 应用需独立最终确认",()->client.setScreen(new WorldPatchPreviewScreen(this)));
            button("原位事务进度 / 显式取消 · 不恢复写入",()->client.setScreen(new WorldPatchOperationScreen(this)));
            button("取消读取 / 丢弃快照",tool::cancel);
            paragraph("读取额度：外层 "+SelectionLimits.contextCells()+" 格、内层 "+SelectionLimits.editCells()+" 格；持续变化最多重采 2 次后停止。",StudioTheme.MUTED);
            paragraph("本地最多保存 8 份 / 128 MiB，24 小时到期；丢弃后只移除本项目持有的快照文件。保存不等于发送。后续发送须确认模型、具体任务和摘要范围；未生成改造方案，没有建造权限。",StudioTheme.WARN);
        }
        var back=addDrawableChild(new StudioTheme.Button(x+12,height-36,w-24,22,"返回工作室",StudioTheme.Kind.NORMAL,this::close));setInitialFocus(back);layout();
    }
    private void row(ClickableWidget widget,int y){addDrawableChild(widget);rows.add(new Row(widget,y));}
    private void button(String text,Runnable action){row(new StudioTheme.Button(x+12,0,w-24,22,text,StudioTheme.Kind.NORMAL,action),cursor);cursor+=29;}
    private void paragraph(String text,int color){for(var line:textRenderer.wrapLines(Text.literal(text),w-24)){var value=new StringBuilder();line.accept((index,style,point)->{value.appendCodePoint(point);return true;});labels.add(new Label(value.toString(),cursor,color));cursor+=12;}cursor+=6;}
    private void layout(){scroll=StudioLayout.clampScroll(scroll,cursor,Math.max(1,bodyBottom-bodyTop));for(var row:rows){row.widget.setY(bodyTop+row.y-scroll);row.widget.visible=row.widget.getY()>=bodyTop&&row.widget.getY()+row.widget.getHeight()<=bodyBottom;}}
    @Override public void tick(){if(readyBefore!=tool.ready()||tool.ready()&&(targetBefore!=tool.draft.target()||indexBefore!=tool.draft.protectionIndex()))clearAndInit();}
    @Override public void render(DrawContext d,int mx,int my,float delta){
        d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,12,w,height-24);d.drawText(textRenderer,title,x+12,24,StudioTheme.ACCENT,false);
        d.enableScissor(x+10,bodyTop,x+w-10,bodyBottom);for(var label:labels)d.drawText(textRenderer,label.text,x+12,bodyTop+label.y-scroll,label.color,false);d.disableScissor();
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,tool.statusText(),w-24),x+12,height-68,StudioTheme.WARN,false);
        if(cursor>bodyBottom-bodyTop)d.drawText(textRenderer,"滚轮查看全部设置；当前操作不会建造",x+12,height-54,StudioTheme.MUTED,false);
        super.render(d,mx,my,delta);
    }
    @Override public boolean mouseScrolled(double x,double y,double amount){scroll-=(int)(amount*28);layout();return true;}
    @Override public void close(){tool.endDrag();client.setScreen(parent);}
    @Override public boolean shouldPause(){return false;}
}
