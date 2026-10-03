package dev.voxelstudio.client;

import com.google.gson.*;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.TextFieldWidget;
import net.minecraft.text.Text;

final class StudioDiagnosticsScreen extends Screen {
    private final Screen parent;private final Runnable refresh;private TextFieldWidget path;private String entered="",report="正在检查配套文件…",status="只读诊断，不提交生成";private boolean requested,saving;private int x,w;
    private final String agent;
    StudioDiagnosticsScreen(Screen parent,Runnable refresh){this(parent,refresh,"codex");}
    StudioDiagnosticsScreen(Screen parent,Runnable refresh,String agent){super(Text.literal("连接诊断 / Agent 路径"));this.parent=parent;this.refresh=refresh;this.agent=agent;}
    StudioDiagnosticsScreen auditFixture(){if(!net.fabricmc.loader.api.FabricLoader.getInstance().isDevelopmentEnvironment()||!Boolean.getBoolean("voxelstudio.uitest"))throw new IllegalStateException("Development UI fixture only");requested=true;status="测试数据：配套完整，尚未进行账户检测";entered="D:/Test Instance/codex.exe";report="本页为无网络的 UI 测试数据，不代表账户能力。";return this;}
    @Override protected void init(){
        x=16;w=width-32;path=addDrawableChild(new TextFieldWidget(textRenderer,x,74,w,22,Text.literal("所选 Agent 入口文件完整路径")));path.setMaxLength(2048);path.setText(entered);path.setChangedListener(s->entered=s);
        addDrawableChild(new StudioTheme.Button(x,104,w,23,"保存路径并重新检测（留空恢复自动发现）",StudioTheme.Kind.PRIMARY,this::save));
        addDrawableChild(new StudioTheme.Button(x,134,w,23,"查看完整诊断 / 复制",StudioTheme.Kind.NORMAL,()->client.setScreen(new StudioInfoScreen(this,"配套与连接诊断",report+"\n"+status))));
        addDrawableChild(new StudioTheme.Button(x,height-35,w,23,"返回",StudioTheme.Kind.NORMAL,this::close));
        if(!requested){requested=true;StudioClient.BRIDGE.localDiagnostics().whenComplete((local,e)->client.execute(()->{
            report=e==null?local:StudioMessages.error(e);
            StudioClient.BRIDGE.request("GET","/v1/diagnostics",null).whenComplete((r,error)->client.execute(()->{if(error!=null){status=StudioMessages.error(error)+"；确认版本配套后重试";return;}report+="\nBridge 检测：\n"+r;status="配套已响应；账户和模型请返回创作页检测";if(entered.isBlank()&&r.has(agent+"Path")){entered=r.get(agent+"Path").getAsString();path.setText(entered);}}));
        }));}
    }
    private void save(){if(saving)return;saving=true;status="正在保存路径…";JsonObject input=new JsonObject();input.addProperty(agent+"Path",entered.trim());
        StudioClient.BRIDGE.request("POST","/v1/config/"+agent+"-path",input).whenComplete((r,e)->client.execute(()->{saving=false;if(e!=null){status=StudioMessages.error(e);return;}StudioClient.BRIDGE.reconnect();status="路径已保存，旧配置备份保留";refresh.run();client.setScreen(parent);}));
    }
    @Override public void tick(){path.tick();path.active=!saving;}
    @Override public void render(DrawContext d,int mx,int my,float delta){d.fill(0,0,width,height,StudioTheme.BG);d.drawText(textRenderer,title,x,16,StudioTheme.ACCENT,false);d.drawText(textRenderer,agent.equals("deepseek")?"填写 @deepseek-ai/dsh/lib/bin.js 绝对路径":agent.equals("claude")?"填写 claude.exe 的绝对路径":"填写 codex.exe / codex.js 的绝对路径",x,42,StudioTheme.TEXT,false);d.drawText(textRenderer,"缺少配套时请完整安装；不会代替你登录",x,57,StudioTheme.MUTED,false);int y=169;for(var line:textRenderer.wrapLines(Text.literal(status),w)){if(y>=height-45)break;d.drawText(textRenderer,line,x,y,StudioTheme.MUTED,false);y+=12;}super.render(d,mx,my,delta);}
    @Override public void close(){client.setScreen(parent);}
    @Override public boolean shouldPause(){return false;}
}
