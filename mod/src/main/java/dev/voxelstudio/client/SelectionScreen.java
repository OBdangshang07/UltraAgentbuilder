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
    private TextFieldWidget[] coordinates;private int x,w,bodyTop=81,bodyBottom,scroll,cursor;private boolean readyBefore;private SelectionDraft.Target targetBefore;private int indexBefore;
    private enum Page { RANGE("选区"), ANALYZE("分析"), BUILD("改造"), HISTORY("记录"), ADVANCED("高级"); final String label;Page(String label){this.label=label;} }
    private Page page=Page.RANGE;private boolean exactCoordinates;private String[] coordinateDraft;private long coordinateRevision=-1;
    private final EnumMap<Page,Integer> savedScroll=new EnumMap<>(Page.class);
    SelectionScreen(Screen parent){super(Text.literal("环境选区 · 只读"));this.parent=parent;}
    @Override protected void init(){
        if(coordinates!=null&&tool.ready()&&tool.draft.target()==targetBefore&&tool.draft.protectionIndex()==indexBefore&&tool.draft.revision()==coordinateRevision)coordinateDraft=Arrays.stream(coordinates).map(TextFieldWidget::getText).toArray(String[]::new);
        else if(!tool.ready()||tool.draft.target()!=targetBefore||tool.draft.protectionIndex()!=indexBefore||tool.draft.revision()!=coordinateRevision)coordinateDraft=null;
        w=Math.min(600,width-24);x=(width-w)/2;bodyBottom=height-80;rows.clear();labels.clear();cursor=0;coordinates=null;
        readyBefore=tool.ready();targetBefore=readyBefore?tool.draft.target():null;indexBefore=readyBefore?tool.draft.protectionIndex():-1;coordinateRevision=readyBefore?tool.draft.revision():-1;
        int navWidth=(w-24)/Page.values().length;
        for(var choice:Page.values())addDrawableChild(new StudioTheme.Button(x+12+choice.ordinal()*navWidth,45,navWidth-2,22,choice.label,choice==page?StudioTheme.Kind.SELECTED:StudioTheme.Kind.NORMAL,()->{savedScroll.put(page,scroll);page=choice;scroll=savedScroll.getOrDefault(page,0);clearAndInit();}));
        if(!readyBefore){paragraph("请进入单人创造模式世界，再检查当前世界。",StudioTheme.MUTED);button("检查当前世界",tool::retryIdentity);}
        else switch(page){case RANGE->rangeTools();case ANALYZE->analysisTools();case BUILD->buildTools();case HISTORY->historyTools();case ADVANCED->advancedTools();}
        var back=addDrawableChild(new StudioTheme.Button(x+12,height-36,w-24,22,"返回工作室",StudioTheme.Kind.NORMAL,this::close));setInitialFocus(back);layout();
    }
    private void rangeTools(){
        int part=(w-32)/3;
        for(int i=0;i<3;i++){var target=SelectionDraft.Target.values()[i];int index=target==SelectionDraft.Target.PROTECTED?tool.draft.protectionIndex():-1;var label=new String[]{"1 周围环境","2 改造范围","3 保护区域"}[i];row(new StudioTheme.Button(x+12+i*(part+4),0,part,22,label,target==tool.draft.target()?StudioTheme.Kind.SELECTED:StudioTheme.Kind.NORMAL,()->{tool.target(target,index);scroll=0;clearAndInit();}),cursor);}cursor+=30;
        paragraph(switch(tool.draft.target()){case CONTEXT->"先选周围环境（蓝色），让 AI 了解附近的建筑。";case EDIT->"再选要改造的小范围（橙色），放在周围环境内。";case PROTECTED->"可选：圈出必须保留的区域（红色）。";},StudioTheme.MUTED);
        primary("到游戏中框选范围",()->{StudioClient.PROJECTION.visible=false;client.setScreen(new SelectionWorldScreen(this));});
        if(tool.draft.target()==SelectionDraft.Target.PROTECTED){
            button("新增保护区 · "+tool.draft.protectedRegions().size()+"/"+SelectionLimits.protectedRegions(),()->{tool.target(SelectionDraft.Target.PROTECTED,-1);clearAndInit();});
            for(int i=0;i<tool.draft.protectedRegions().size();i++){int selected=i;button("编辑保护区 "+(i+1),()->{tool.target(SelectionDraft.Target.PROTECTED,selected);clearAndInit();});}
        }
        var current=tool.draft.current();
        if(current!=null)paragraph("当前范围："+current.cells()+" 格；"+current.min().json()+" → "+current.max().json(),StudioTheme.MUTED);
        button(exactCoordinates?"收起精确坐标 ▴":"精确坐标（可选）▾",()->{exactCoordinates=!exactCoordinates;clearAndInit();});
        if(exactCoordinates){
            paragraph("最小边界包含；最大边界不包含。框选两个方块时会包含两端。",StudioTheme.MUTED);
            coordinates=new TextFieldWidget[6];
            for(int side=0;side<2;side++){paragraph(side==0?"最小边界 X / Y / Z":"最大边界 X / Y / Z（不包含）",StudioTheme.ACCENT);
                for(int axis=0;axis<3;axis++){var field=new TextFieldWidget(textRenderer,x+12+axis*(part+4),0,part,20,Text.literal((side==0?"min ":"max ")+new String[]{"X","Y","Z"}[axis]));field.setMaxLength(11);field.setTextPredicate(s->s.matches("-?\\d{0,10}"));field.setText(coordinateDraft==null?(current==null?"":Integer.toString((side==0?current.min():current.max()).axis(axis))):coordinateDraft[side*3+axis]);coordinates[side*3+axis]=field;row(field,cursor);}cursor+=28;
            }
            button("应用六个坐标 · 不移动其他范围",()->{long before=tool.draft.revision();tool.mutate(()->{int[] v=Arrays.stream(coordinates).mapToInt(f->Integer.parseInt(f.getText())).toArray();tool.draft.region(new SelectionRegion(new SelectionRegion.Point(v[0],v[1],v[2]),new SelectionRegion.Point(v[3],v[4],v[5])));});if(tool.draft.revision()!=before){coordinateDraft=null;clearAndInit();}});
        }
        button(tool.visible?"隐藏选区边框":"显示选区边框",()->{tool.visible=!tool.visible;clearAndInit();});
        button("读取环境（免费）",tool::read);
        button("保存环境快照与摘要",tool::saveContext);
        paragraph("选好范围后，到分析页了解环境，或到改造页描述修改要求。读取和保存不会调用模型。",StudioTheme.MUTED);
    }
    private void analysisTools(){
        paragraph("先读取并保存环境，再准备 AI 分析。准备和查看摘要不调用模型；发送前会确认。",StudioTheme.MUTED);
        button("读取环境（免费）",tool::read);
        button("保存环境快照与摘要",tool::saveContext);
        button("查看已保存的环境摘要",()->tool.showSummary(this));
        primary("准备 AI 环境分析",()->client.setScreen(new ContextTaskScreen(this)));
        button("审核并发送已确认的分析任务",()->tool.openAnalysisSend(this));
    }
    private void buildTools(){
        paragraph("在选好的范围内改造，或结合参考图片制作整栋建筑。先准备任务，检查后再明确发送。",StudioTheme.MUTED);
        primary("改造选中的区域",()->client.setScreen(new WorldPatchTaskScreen(this)));
        button("参考图＋场地：制作建筑（实验）",()->client.setScreen(new CoupledReferenceWorldAssemblyTaskScreen(this)));
            if(StudioClient.PATCH_PREVIEW.preview()!=null)button("原位差异预览 · 应用需独立最终确认",()->client.setScreen(new WorldPatchPreviewScreen(this)));
            if(StudioClient.ASSEMBLY_PREVIEW.preview()!=null)button("完整整组差异 · 原位置，应用需独立确认",()->client.setScreen(new AssemblyPatchPreviewScreen(this)));
            if(StudioClient.COUPLED_PREVIEW.preview()!=null)button("新成组完整差异 · 原位置 / 独立最终确认",()->client.setScreen(new CoupledAssemblyPreviewScreen(this)));
        button("更多改造方式与操作记录",()->{savedScroll.put(page,scroll);page=Page.ADVANCED;scroll=0;clearAndInit();});
    }
    private void historyTools(){
        paragraph("查看已经创建的原任务、结果和操作记录。打开记录不会重新发送模型请求。",StudioTheme.MUTED);
        button("环境分析记录",()->client.setScreen(new ContextAnalysisHistoryScreen(this)));
        button("区域改造记录",()->client.setScreen(new WorldPatchHistoryScreen(this)));
            button("新成组完整任务历史 · 只查询原任务",()->client.setScreen(new CoupledReferenceWorldAssemblyHistoryScreen(this)));
            button("完整联合历史 / 后台任务 · 不重发",()->client.setScreen(new ReferenceWorldAssemblyHistoryScreen(this)));
        button("兼容局部改造记录",()->client.setScreen(new ReferenceWorldPatchHistoryScreen(this)));
    }
    private void advancedTools(){
        paragraph("已有任务的独立发送与兼容入口。每项保留原有确认要求，不会转换为另一种任务。",StudioTheme.WARN);
        button("完整联合建筑 · 兼容制作方式",()->client.setScreen(new ReferenceWorldAssemblyTaskScreen(this)));
        button("区域改造 · 独立发送审核",()->tool.openPatchSend(this));
        button("区域改造进度 / 取消与撤销",()->client.setScreen(new WorldPatchOperationScreen(this)));
        button("联合建筑进度 / 取消与撤销",()->client.setScreen(new AssemblyPatchOperationScreen(this)));
        button("成组建筑进度 / 取消与撤销",()->client.setScreen(new CoupledAssemblyOperationScreen(this)));
            button("旧参考图局部改造 · 一调用审核（独立协议）",()->tool.openReferencePatchSend(this));
            button("旧参考图局部改造历史 · 不升级确认",()->client.setScreen(new ReferenceWorldPatchHistoryScreen(this)));
        button("清除当前选区范围",()->{tool.mutate(()->tool.draft.clear());clearAndInit();});
        button("取消读取 / 丢弃快照",tool::cancel);
            paragraph("读取额度：外层 "+SelectionLimits.contextCells()+" 格、内层 "+SelectionLimits.editCells()+" 格；持续变化最多重采 2 次后停止。",StudioTheme.MUTED);
            paragraph("本地最多保存 8 份 / 128 MiB，24 小时到期；丢弃后只移除本项目持有的快照文件。保存不等于发送。后续发送须确认模型、具体任务和摘要范围；未生成改造方案，没有建造权限。",StudioTheme.WARN);
    }
    private void primary(String text,Runnable action){row(new StudioTheme.Button(x+12,0,w-24,24,text,StudioTheme.Kind.PRIMARY,action),cursor);cursor+=31;}
    private void row(ClickableWidget widget,int y){addDrawableChild(widget);rows.add(new Row(widget,y));}
    private void button(String text,Runnable action){row(new StudioTheme.Button(x+12,0,w-24,22,text,StudioTheme.Kind.NORMAL,action),cursor);cursor+=29;}
    private void paragraph(String text,int color){for(var line:textRenderer.wrapLines(Text.literal(text),w-24)){var value=new StringBuilder();line.accept((index,style,point)->{value.appendCodePoint(point);return true;});labels.add(new Label(value.toString(),cursor,color));cursor+=12;}cursor+=6;}
    private void layout(){scroll=StudioLayout.clampScroll(scroll,cursor,Math.max(1,bodyBottom-bodyTop));for(var row:rows){row.widget.setY(bodyTop+row.y-scroll);row.widget.visible=row.widget.getY()>=bodyTop&&row.widget.getY()+row.widget.getHeight()<=bodyBottom;}}
    @Override public void tick(){if(readyBefore!=tool.ready()||tool.ready()&&(targetBefore!=tool.draft.target()||indexBefore!=tool.draft.protectionIndex()))clearAndInit();}
    @Override public void render(DrawContext d,int mx,int my,float delta){
        d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,12,w,height-24);d.drawText(textRenderer,"环境选区 · "+page.label,x+12,24,StudioTheme.ACCENT,false);
        d.enableScissor(x+10,bodyTop,x+w-10,bodyBottom);for(var label:labels)d.drawText(textRenderer,label.text,x+12,bodyTop+label.y-scroll,label.color,false);d.disableScissor();
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,tool.statusText(),w-24),x+12,height-68,StudioTheme.WARN,false);
        if(cursor>bodyBottom-bodyTop)d.drawText(textRenderer,"滚轮查看本页内容 · 框选不会修改方块",x+12,height-54,StudioTheme.MUTED,false);
        super.render(d,mx,my,delta);
    }
    @Override public boolean mouseScrolled(double x,double y,double amount){scroll-=(int)(amount*28);layout();return true;}
    @Override public void close(){tool.endDrag();client.setScreen(parent);}
    @Override public boolean shouldPause(){return false;}
}
