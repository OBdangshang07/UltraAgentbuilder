package dev.voxelstudio.client;

import com.google.gson.*;
import com.mojang.blaze3d.systems.RenderSystem;
import dev.voxelstudio.*;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import net.minecraft.util.math.*;
import org.joml.Matrix4f;
import org.joml.Vector3f;

/** Independent, read-only analysis view: never installs its asset in the world projection. */
final class StudioFailedDesignScreen extends Screen {
    private final Screen parent;
    private final String job;
    private Asset asset;
    private ProjectionRenderer renderer;
    private JsonArray conflicts=new JsonArray();
    private String status="正在读取失败稿 · 不调用 AI";
    private boolean requested,disposed,materials=true;
    private int selected=-1,drag=-1;
    private float yaw=-35,pitch=24,zoom=1,panX,panY;
    private StudioTheme.Button next,whole,material;

    StudioFailedDesignScreen(Screen parent,String job,String cause){super(Text.literal("失败稿 · 只读诊断 · 不可建造"));this.parent=parent;this.job=job;}
    StudioFailedDesignScreen(Screen parent,Asset fixture,String cause){this(parent,fixture.revision,cause);requested=true;accept(fixture);}
    private void accept(Asset value){
        if(!value.diagnosticOnly)throw new IllegalArgumentException("Expected a diagnostic-only asset");
        asset=value;var diagnostics=JsonParser.parseString(value.designDiagnostics).getAsJsonArray();
        for(var element:diagnostics){var d=element.getAsJsonObject();if(d.has("severity")&&d.get("severity").getAsString().equals("blocked")&&d.has("point"))conflicts.add(d);}
        status="原始输出的顺序覆盖诊断图，不是修好的建筑";
    }
    @Override protected void init(){
        int gap=6,w=(width-32-3*gap)/4,y=height-32;
        addDrawableChild(new StudioTheme.Button(16,y,w,22,"返回",StudioTheme.Kind.NORMAL,this::close));
        next=addDrawableChild(new StudioTheme.Button(16+w+gap,y,w,22,"下一处冲突",StudioTheme.Kind.NORMAL,this::nextConflict));
        whole=addDrawableChild(new StudioTheme.Button(16+2*(w+gap),y,w,22,"查看全楼",StudioTheme.Kind.NORMAL,()->{selected=-1;resetView();rebuild();}));
        material=addDrawableChild(new StudioTheme.Button(16+3*(w+gap),y,w,22,"MC 材质",StudioTheme.Kind.NORMAL,()->{materials=!materials;material.setMessage(Text.literal(materials?"MC 材质":"建筑形体"));}));
        if(asset!=null&&renderer==null){renderer=new ProjectionRenderer();rebuild();}
        if(!requested){requested=true;StudioClient.BRIDGE.loadDiagnostic(job).whenComplete((value,error)->client.execute(()->{
            if(disposed)return;
            if(error!=null){status=StudioMessages.error(error);return;}
            try{accept(value);renderer=new ProjectionRenderer();rebuild();}catch(Exception e){status=StudioMessages.error(e);}
        }));}
        tick();
    }
    private void resetView(){yaw=-35;pitch=24;zoom=1;panX=panY=0;}
    private int pointY(){return selected<0?0:conflicts.get(selected).getAsJsonObject().getAsJsonArray("point").get(1).getAsInt();}
    private void rebuild(){if(renderer==null)return;renderer.minLayer=selected<0?0:Math.max(0,pointY()-2);renderer.cutLayer=selected<0?-1:Math.min(asset.height-1,pointY()+2);renderer.rebuild(new Placement(asset,BlockPos.ORIGIN,0,false,0,true));}
    private void nextConflict(){if(conflicts.isEmpty()||renderer==null||renderer.building)return;selected=(selected+1)%conflicts.size();resetView();rebuild();}
    @Override public void tick(){boolean ready=asset!=null&&renderer!=null&&!renderer.building;next.active=ready&&!conflicts.isEmpty();whole.active=ready;material.active=asset!=null;}
    boolean readyForAudit(){return renderer!=null&&!renderer.building;}
    String meshError(){return renderer==null?status:renderer.error;}
    void auditNext(){nextConflict();}
    @Override public void render(DrawContext d,int mx,int my,float delta){
        d.fill(0,0,width,height,StudioTheme.BG);
        d.drawText(textRenderer,title,16,12,StudioTheme.WARN,false);
        d.drawText(textRenderer,"不替换原建筑；不可投影、建造、导出或自动修复",16,26,StudioTheme.MUTED,false);
        int top=45,bottom=height-113,viewHeight=Math.max(1,bottom-top);
        d.fill(16,top,width-16,bottom,0xff0c1822);d.enableScissor(16,top,width-16,bottom);
        if(asset!=null&&renderer!=null){
            d.draw();float visibleHeight=selected<0?asset.height:renderer.cutLayer-renderer.minLayer+1;
            float size=Math.max(Math.max(asset.width,asset.length),visibleHeight),scale=Math.min(width-32,viewHeight)*.7f/size*zoom;
            float centerY=selected<0?asset.height/2f:(renderer.minLayer+renderer.cutLayer+1)/2f;
            Matrix4f matrix=new Matrix4f(RenderSystem.getModelViewMatrix()).translate(width/2f+panX,top+viewHeight/2f+panY,150).scale(scale,-scale,scale).rotateX((float)java.lang.Math.toRadians(pitch)).rotateY((float)java.lang.Math.toRadians(yaw)).translate(-asset.width/2f,-centerY,-asset.length/2f);
            renderer.draw(matrix,RenderSystem.getProjectionMatrix(),.95f,materials,new Vec3d(0,200,-200));RenderSystem.disableDepthTest();
            if(selected>=0){var point=conflicts.get(selected).getAsJsonObject().getAsJsonArray("point");var p=matrix.transformPosition(new Vector3f(point.get(0).getAsFloat()+.5f,point.get(1).getAsFloat()+.5f,point.get(2).getAsFloat()+.5f));int x=(int)p.x,y=(int)p.y;d.fill(x-6,y-1,x+7,y+2,StudioTheme.ERROR);d.fill(x-1,y-6,x+2,y+7,StudioTheme.ERROR);}
            if(renderer.building)d.drawText(textRenderer,"正在准备只读网格…",23,top+7,StudioTheme.WARN,false);
        }
        d.disableScissor();int row=bottom+5;
        String detail=status;
        if(selected>=0){var c=conflicts.get(selected).getAsJsonObject();detail="冲突 "+(selected+1)+"/"+conflicts.size()+" · "+c.get("from").getAsString()+" → "+c.get("to").getAsString()+" · "+c.get("count").getAsInt()+" 格\n首个点 "+c.get("point")+" · 切片 Y="+renderer.minLayer+".."+renderer.cutLayer+"；红十字只标首点，不代表全部范围";}
        else if(asset!=null)detail+="\n"+asset.width+" × "+asset.height+" × "+asset.length+" · "+conflicts.size()+" 组冲突";
        if(renderer!=null&&renderer.error!=null)detail="网格加载失败："+renderer.error;
        int maxRows=4;for(var line:textRenderer.wrapLines(Text.literal(detail),width-32)){if(maxRows--==0)break;d.drawText(textRenderer,line,16,row,StudioTheme.WARN,false);row+=10;}
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,"拖动旋转 · 右键平移 · 滚轮缩放 · Esc 返回",width-32),16,height-54,StudioTheme.MUTED,false);
        super.render(d,mx,my,delta);
    }
    private boolean inView(double x,double y){return x>=16&&x<width-16&&y>=45&&y<height-113;}
    @Override public boolean mouseClicked(double x,double y,int button){if(inView(x,y)&&(button==0||button==1)){drag=button;return true;}return super.mouseClicked(x,y,button);}
    @Override public boolean mouseDragged(double x,double y,int button,double dx,double dy){if(drag==0){yaw+=(float)dx;pitch=MathHelper.clamp(pitch+(float)dy,-85,85);return true;}if(drag==1){panX=MathHelper.clamp(panX+(float)dx,-width,width);panY=MathHelper.clamp(panY+(float)dy,-height,height);return true;}return super.mouseDragged(x,y,button,dx,dy);}
    @Override public boolean mouseReleased(double x,double y,int button){drag=-1;return super.mouseReleased(x,y,button);}
    @Override public boolean mouseScrolled(double x,double y,double amount){if(inView(x,y)){zoom=MathHelper.clamp(zoom*(float)java.lang.Math.pow(1.12,amount),.25f,5);return true;}return super.mouseScrolled(x,y,amount);}
    @Override public void close(){client.setScreen(parent);}
    @Override public void removed(){disposed=true;if(renderer!=null){renderer.close();renderer=null;}}
    @Override public boolean shouldPause(){return false;}
}
