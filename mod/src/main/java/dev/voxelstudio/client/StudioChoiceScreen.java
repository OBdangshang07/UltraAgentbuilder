package dev.voxelstudio.client;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.TextFieldWidget;
import net.minecraft.text.Text;
import java.util.*;
import java.util.function.Consumer;
import java.util.function.Supplier;

/** Searchable, explicit selection. Opening or filtering this screen never submits a job. */
final class StudioChoiceScreen extends Screen {
    record Choice(String id,String label,String detail) {}
    private final Screen parent; private List<Choice> choices; private final Supplier<List<Choice>> choicesProvider;private final String selected; private final Consumer<String> choose;
    private String filter="";private int page;private TextFieldWidget search;
    private List<Choice> filtered=List.of();private int x,w,rows;
    StudioChoiceScreen(Screen parent,String title,List<Choice> choices,String selected,Consumer<String> choose) {this(parent,title,()->choices,selected,choose);}
    StudioChoiceScreen(Screen parent,String title,Supplier<List<Choice>> choices,String selected,Consumer<String> choose) {super(Text.literal(title));this.parent=parent;this.choicesProvider=choices;this.choices=choices.get();this.selected=selected;this.choose=choose;}
    @Override protected void init() {
        w=Math.min(460,width-32);x=(width-w)/2;rows=Math.max(1,(height-130)/33);
        search=new TextFieldWidget(textRenderer,x+10,47,w-20,20,Text.literal("搜索名称"));search.setMaxLength(120);search.setText(filter);search.setSuggestion(filter.isEmpty()?"输入名称搜索…":null);search.setChangedListener(s->{filter=s;search.setSuggestion(s.isEmpty()?"输入名称搜索…":null);page=0;rebuildRows();});addDrawableChild(search);
        rebuildRows();setInitialFocus(search);
    }
    private void rebuildRows() {
        for(var e:List.copyOf(children()))if(e!=search)remove(e);
        filtered=choices.stream().filter(c->(c.label()+" "+c.detail()).toLowerCase(Locale.ROOT).contains(filter.toLowerCase(Locale.ROOT))).toList();
        page=Math.max(0,Math.min(page,Math.max(0,(filtered.size()-1)/rows)));
        for(int i=page*rows;i<Math.min(filtered.size(),(page+1)*rows);i++) {
            Choice c=filtered.get(i);
            var b=new StudioTheme.Button(x+10,76+(i-page*rows)*33,w-20,29,(c.id.equals(selected)?"✓ ":"")+c.label, c.id.equals(selected)?StudioTheme.Kind.SELECTED:StudioTheme.Kind.NORMAL,()->{choose.accept(c.id);client.setScreen(parent);});
            b.setTooltip(net.minecraft.client.gui.tooltip.Tooltip.of(Text.literal(c.label+"\n"+c.detail)));addDrawableChild(b);
        }
        int bottom=height-39;
        var prev=addDrawableChild(new StudioTheme.Button(x+10,bottom,60,22,"上一页",StudioTheme.Kind.NORMAL,()->{page--;rebuildRows();}));prev.active=page>0;
        var next=addDrawableChild(new StudioTheme.Button(x+76,bottom,60,22,"下一页",StudioTheme.Kind.NORMAL,()->{page++;rebuildRows();}));next.active=(page+1)*rows<filtered.size();
        addDrawableChild(new StudioTheme.Button(x+w-82,bottom,72,22,"返回",StudioTheme.Kind.NORMAL,this::close));
    }
    @Override public void tick(){search.tick();var next=choicesProvider.get();if(!next.equals(choices)){choices=next;rebuildRows();}}
    @Override public void render(DrawContext d,int mx,int my,float delta) {
        d.fill(0,0,width,height,StudioTheme.BG);StudioTheme.panel(d,x,14,w,height-28);
        d.drawText(textRenderer,title,x+10,25,StudioTheme.TEXT,false);
        if(filtered.isEmpty())d.drawText(textRenderer,"没有匹配项，试试其他关键词",x+10,86,StudioTheme.MUTED,false);
        d.drawText(textRenderer,(page+1)+" / "+Math.max(1,(filtered.size()+rows-1)/rows),x+145,height-32,StudioTheme.MUTED,false);
        super.render(d,mx,my,delta);
    }
    @Override public boolean mouseScrolled(double x,double y,double amount){page+=amount>0?-1:1;rebuildRows();return true;}
    @Override public void close(){client.setScreen(parent);}
    @Override public boolean shouldPause(){return false;}
    void auditSelection(){
        if(!net.fabricmc.loader.api.FabricLoader.getInstance().isDevelopmentEnvironment()||!Boolean.getBoolean("voxelstudio.uitest"))throw new IllegalStateException("Development only");
        search.setText("test-model-27");if(filtered.size()!=1||!filtered.get(0).id.equals("test-model-27"))throw new IllegalStateException("Model search did not filter by id");
        for(var child:children())if(child instanceof StudioTheme.Button b&&b.getMessage().getString().contains("test-model-27")){b.onPress();break;}
        search.setText("");
    }
}
