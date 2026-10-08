package dev.voxelstudio.client;

import com.google.gson.*;
import com.mojang.blaze3d.systems.RenderSystem;
import dev.voxelstudio.Placement;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.tooltip.Tooltip;
import net.minecraft.client.gui.widget.*;
import net.minecraft.text.*;
import net.minecraft.util.math.*;
import org.joml.Matrix4f;
import org.lwjgl.glfw.GLFW;
import java.util.*;
import java.util.function.*;

/** Native workspace: scrollable tools, persistent preview, explicit world confirmation. */
public final class StudioScreen extends Screen {
    enum Tab { CREATE("创作"), PLACE("定位"), HISTORY("历史"); final String label;Tab(String label){this.label=label;} }
    private record Notice(String summary,String details,int color) {}
    private record Row(ClickableWidget widget,int y) {}
    private record Label(OrderedText text,int y,int color) {}
    private record Binding(StudioTheme.Button button,Supplier<String> label,BooleanSupplier enabled,Supplier<String> hint) {}
    private static String description="河边的现代小屋，有可进入的室内、玻璃窗，晚上亮灯",activeJob,selectedModel,selectedEffort="default";
    private static Notice notice=new Notice("先体验示例，或连接本机 Agent 开始创作","示例不调用 AI。自然语言生成使用你选择的模型和账户额度。",StudioTheme.MUTED);
    private static JsonArray models=new JsonArray(),history=new JsonArray();
    private static String selectedAgent="codex",manualClaudeModel="";
    private static final Map<String,String> rememberedModels=new HashMap<>();
    private static final AgentCatalog localAgents=new AgentCatalog();
    private static boolean localScanActive,localScanPending,userSelectedAgent;
    private static int localScanTicks;
    private static String localScanMessage="进入世界后自动检测本机 Agent";
    private static int repairBudget=0;
    private static long outputBudget=0;
    private static String generationMode="single";
    private static int checkpointCalls=2;
    private static String qualityTier="lite";
    private static int assemblyCalls=StudioAssembly.tier("lite").maximumCalls();
    private static boolean assemblyImageReview=false;
    private static int assemblyQualityVersion=1;
    private static String assemblyPrototypeMode="off";
    private static boolean assemblyProviderRecovery=false;
    private static boolean assemblyCompletionReserve=false;
    private static ReferenceImageDraft referenceDraft=new ReferenceImageDraft();
    private static JsonObject designSources;
    private static String designRevision,selectedComponent;
    private static int selectedInstance=-1;
    private static boolean sharedModuleRevision;
    private static dev.voxelstudio.Asset compareOriginal,compareRevised;
    private static boolean preflighting;
    private static boolean agentReady;
    private static boolean discovering,discoveryAttempted,polling,submitting,loading,historyLoading,cancelling;
    private static int polls,loadTicket;
    private static final StudioStateStore STATE=new StudioStateStore(StudioClient.BRIDGE.dataDirectory().resolve("client-state"));
    private static JsonObject taskIdentity;
    private static String pendingKey;
    private static String pendingPreview;
    private static int recoveryTicks;
    private static boolean recovering,recoveryAttempted;
    private static boolean checkingPlacement;
    private Tab tab=Tab.CREATE;
    private StudioLayout layout;
    private final List<Row> rows=new ArrayList<>();private final List<Label> labels=new ArrayList<>();
    private final List<ClickableWidget> fixed=new ArrayList<>();private final List<Binding> bindings=new ArrayList<>();
    private EditBoxWidget prompt;private TextFieldWidget[] coordinates;
    private int cursor,contentHeight,scroll,step=1,previewDrag=-1;
    private boolean coordinatesDirty,scrollDrag;
    private BlockPos shownAnchor;
    private String[] coordinateDraft;
    private float yaw=-35,pitch=24,zoom=1,panX,panY;

    public StudioScreen(){super(Text.literal(dev.voxelstudio.StudioBrand.NAME));}
    static JsonObject contextRecipient(){
        if(!agentReady||selectedModel==null)throw new IllegalStateException("先在创作页选择已就绪的 Agent 与确切模型；不会自动替换");
        var value=new JsonObject();value.addProperty("agent",selectedAgent);value.addProperty("model",selectedModel);value.addProperty("effort",selectedEffort);return value;
    }
    /** Only a launcher whose three providers were replaced by no-call fixtures
     * can enter the selection self-test. Never discovers a real account here. */
    static void prepareOfflineContextTask(){
        if(!SelectionSelfTest.enabled()||!idle())throw new IllegalStateException("Isolated offline selection fixture required");
        discoveryAttempted=true;recoveryAttempted=true;agentReady=true;selectedAgent="codex";selectedModel="offline-context-fixture";selectedEffort="max";
        models=JsonParser.parseString("[{\"id\":\"offline-context-fixture\",\"name\":\"Offline context fixture (no model calls)\",\"efforts\":[\"max\"],\"supportsImages\":false}]").getAsJsonArray();
    }
    private static ProjectionController projection(){return StudioClient.PROJECTION;}
    static void prepareOfflinePatchTransaction(){
        if(!WorldPatchTransactionSelfTest.enabled()||!WorldPatchTransactionSelfTest.delayedSendEnabled()||!idle())throw new IllegalStateException("Isolated delayed mock SEND fixture required");
        discoveryAttempted=true;recoveryAttempted=true;agentReady=true;selectedAgent="codex";selectedModel="offline-context-fixture";selectedEffort="max";
        models=JsonParser.parseString("[{\"id\":\"offline-context-fixture\",\"name\":\"Offline delayed patch fixture (no model calls)\",\"efforts\":[\"max\"],\"supportsImages\":false}]").getAsJsonArray();
    }
    private static boolean taskBusy(){return preflighting||submitting||loading||recovering||checkingPlacement||projection().restoring||pendingKey!=null||activeJob!=null;}
    private static boolean idle(){return !taskBusy()&&!projection().busy;}
    static String referenceWorldScope(){return projection().key();}
    static boolean referenceDraftEditable(){return idle();}
    /** Exact selected settings. Opening reference UI never changes generation
     * mode/model/tier or quietly turns on image/repair permissions. */
    static JsonObject referenceGenerationRequest(String owner){
        return referenceGenerationRequest(owner,description);
    }
    private static JsonObject referenceGenerationRequest(String owner,String prompt){
        if(!idle()||!agentReady||!supportsVisualReview()||prompt.isBlank()||!generationMode.equals("components"))
            throw new IllegalStateException("先选择已连接、明确支持图片的 Codex 模型、组件化生成与建筑提示词；不会自动替换设置");
        if(!owner.matches("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))throw new IllegalArgumentException("无效图片草稿身份");
        var req=new JsonObject();req.addProperty("key",owner);req.addProperty("agent",selectedAgent);req.addProperty("model",modelLabel());req.addProperty("prompt",prompt);
        if(!selectedEffort.equals("default"))req.addProperty("effort",selectedEffort);
        var world=MinecraftClient.getInstance().world;if(world!=null)req.addProperty("worldHeight",world.getHeight());configureAssembly(req);return req;
    }
    static boolean referenceGenerationCurrent(JsonObject exact,String world){
        try{return StudioGenerationConsent.matches(exact,referenceGenerationRequest(exact.get("key").getAsString()),world,projection().key(),idle());}catch(Exception e){return false;}
    }
    /** The independent full SEND screen is the only invocation confirmation.
     * This request declaration does not reuse ordinary image/budget consent. */
    static JsonObject referenceAssemblyGenerationRequest(String owner,String prompt){
        var request=referenceGenerationRequest(owner,prompt);request.addProperty("assemblyConfirmed",true);
        ReferenceWorldAssemblyReceipt.generation(request);return request;
    }
    static boolean referenceAssemblyGenerationCurrent(JsonObject exact,String world){
        try{return StudioGenerationConsent.matches(exact,referenceAssemblyGenerationRequest(exact.get("key").getAsString(),exact.get("prompt").getAsString()),world,projection().key(),idle());}catch(Exception error){return false;}
    }
    static String referenceAssemblyTierSummary(){return qualityTier+" · 完整共享预算 ≤"+StudioAssembly.tier(qualityTier).maximumCalls()+" 次（当前选择 "+assemblyCalls+"）";}
    static void chooseReferenceAssemblyTier(Screen parent,Runnable changed){
        if(!idle())throw new IllegalStateException("先等待原任务或事务结束；不改变运行任务");
        MinecraftClient.getInstance().setScreen(new StudioChoiceScreen(parent,"完整联合 · 明确选择四档与预算",StudioAssembly.tiers().stream().map(t->new StudioChoiceScreen.Choice(t.id(),t.id()+" · ≤"+t.maximumCalls()+" 次共享调用",t.description()+"；识图、候选、制作、纠错与复核同预算。非 Ultra 关闭已选择的 Ultra 专属分阶段原型，不沿用旧确认。")).toList(),qualityTier,v->{selectAssemblyTier(v);changed.run();}));
    }
    private static void selectAssemblyTier(String value){
        qualityTier=value;assemblyCalls=StudioAssembly.tier(value).maximumCalls();if(!value.equals("ultra"))assemblyCompletionReserve=false;
        if(!value.equals("ultra")&&assemblyPrototypeMode.equals("staged")){assemblyPrototypeMode="off";tell("已关闭 Ultra 分阶段原型","其他档位不会自动改用旧原型协议；如需旧版请重新明确选择。没有调用模型。",StudioTheme.MUTED);}
    }
    private static void configureAssembly(JsonObject req){
        StudioAssembly.configure(req,qualityTier,assemblyCalls);
        if(assemblyQualityVersion>=2)req.addProperty("assemblyQuality","v"+assemblyQualityVersion);
        if(assemblyQualityVersion>=3&&(!assemblyImageReview||assemblyCalls<7))throw new IllegalArgumentException("质量 v3 / v4 需要原生图像比较且至少预留 7 次调用；未提交");
        if(assemblyImageReview){if(!supportsVisualReview())throw new IllegalArgumentException("所选模型没有声明图片能力；请选择图像模型，或切换质量旧版 / v2 的文本复核；未提交");req.addProperty("assemblyDesignReview",assemblyQualityVersion>=2?"native":"images");}
        StudioAssembly.configurePrototypes(req,assemblyQualityVersion==4?assemblyPrototypeMode:"off");
        StudioCompletionReserve.configure(req,assemblyCompletionReserve);
        StudioRepresentativeEvidence.configure(req);
        StudioProviderRecovery.configure(req,assemblyProviderRecovery,efforts());
    }
    /** Only prepares test selections; the fixture presses the real generate and budget buttons. */
    static void prepareOfflineFlow(boolean extendedCorrections,boolean nativeEvidence){
        prepareOfflineFlow(extendedCorrections,nativeEvidence,nativeEvidence?2:1);
    }
    static void prepareOfflineFlow(boolean extendedCorrections,boolean nativeEvidence,int qualityVersion){
        prepareOfflineFlow(extendedCorrections,nativeEvidence,qualityVersion,false);
    }
    static void prepareOfflineFlow(boolean extendedCorrections,boolean nativeEvidence,int qualityVersion,boolean prototypes){
        prepareOfflineFlow(extendedCorrections,nativeEvidence,qualityVersion,prototypes?"verified":"off");
    }
    static void prepareOfflineFlow(boolean extendedCorrections,boolean nativeEvidence,int qualityVersion,String prototypes){
        prepareOfflineFlow(extendedCorrections,nativeEvidence,qualityVersion,prototypes,false);
    }
    static void prepareOfflineFlow(boolean extendedCorrections,boolean nativeEvidence,int qualityVersion,String prototypes,boolean explicitEffort){
        if(!StudioFlowSelfTest.enabled()||!idle()||projection().asset!=null)throw new IllegalStateException("Fresh isolated flow fixture required");
        if(!List.of(1,2,4).contains(qualityVersion)||qualityVersion>=2&&!nativeEvidence||qualityVersion==4&&!extendedCorrections)throw new IllegalArgumentException("Invalid isolated quality/renderer/budget fixture");
        if(!List.of("off","verified","staged").contains(prototypes)||!prototypes.equals("off")&&qualityVersion!=4||prototypes.equals("staged")&&!extendedCorrections)throw new IllegalArgumentException("Prototype flow fixture requires explicit matching v4 / Ultra");
        discoveryAttempted=true;recoveryAttempted=true;agentReady=true;selectedAgent="codex";selectedModel="offline-player-fixture";selectedEffort="default";
        models=JsonParser.parseString("[{\"id\":\"offline-player-fixture\",\"name\":\"Offline test provider (no account)\",\"efforts\":[\"default\"],\"supportsImages\":true}]").getAsJsonArray();
        if(explicitEffort){selectedEffort="max";models.get(0).getAsJsonObject().add("efforts",JsonParser.parseString("[\"max\"]"));}
        description="离线工程链路测试，不是 AI 设计：32×224×32 格边界，实际高度 224 米的办公塔楼，保留楼梯和通路";
        generationMode="components";qualityTier=extendedCorrections?"ultra":"lite";assemblyCalls=extendedCorrections?26:8;repairBudget=0;assemblyImageReview=true;assemblyQualityVersion=qualityVersion;assemblyPrototypeMode=prototypes;assemblyProviderRecovery=false;assemblyCompletionReserve=false;
    }
    static JsonObject offlineFlowState(){
        if(!StudioFlowSelfTest.enabled())throw new IllegalStateException("Explicit isolated flow fixture required");
        var state=new JsonObject();state.addProperty("activeJob",activeJob);state.addProperty("loading",loading);state.addProperty("busy",taskBusy());state.addProperty("error",notice.color==StudioTheme.ERROR?notice.details:null);
        state.addProperty("providerRecoverySelected",assemblyProviderRecovery);state.addProperty("effort",selectedEffort);
        state.addProperty("providerRecoveryWait",notice.summary.contains("容量恢复等待 ·")?notice.summary:"");
        if(taskIdentity!=null)state.add("identity",taskIdentity.deepCopy());return state;
    }
    private static void tell(String summary,String detail,int color){notice=new Notice(summary,detail,color);}
    private static void fail(Throwable e){String detail=StudioMessages.error(e);tell(StudioMessages.errorSummary(detail),detail,StudioTheme.ERROR);}
    private static void onClient(Runnable action){MinecraftClient.getInstance().execute(action);}

    @Override protected void init(){
        if(coordinates!=null&&coordinatesDirty)coordinateDraft=Arrays.stream(coordinates).map(TextFieldWidget::getText).toArray(String[]::new);
        layout=StudioLayout.of(width,height);rows.clear();labels.clear();fixed.clear();bindings.clear();cursor=0;prompt=null;coordinates=null;
        var side=layout.sidebar();int tabWidth=(side.width()-12)/3;
        for(Tab choice:Tab.values())fixedButton(side.x()+6+choice.ordinal()*tabWidth,side.y()+6,tabWidth-2,22,()->choice.label,choice==tab?StudioTheme.Kind.SELECTED:StudioTheme.Kind.NORMAL,()->true,()->"切换到"+choice.label+"，不会提交任务",()->switchTab(choice));
        fixedButton(width-61,10,53,23,()->"返回游戏",StudioTheme.Kind.NORMAL,()->true,()->"关闭面板；已显示的世界投影继续保留",this::close);
        switch(tab){case CREATE->createTools();case PLACE->placementTools();case HISTORY->historyTools();}
        contentHeight=cursor+4;scroll=StudioLayout.clampScroll(scroll,contentHeight,layout.content().height());
        createPreviewControls();createBottomActions();
        fixedButton(width-58,height-29,47,20,()->"详情",StudioTheme.Kind.NORMAL,()->true,()->"查看完整状态与操作说明",()->client.setScreen(new StudioInfoScreen(this,"工作室 · 状态详情",notice.details+"\n\n世界投影\n"+projection().status+"\n\n"+projection().placementBlockReason()+"\n\n"+(projection().renderer.error==null?"":projection().renderer.error+"\n\n")+helpText())));
        layoutRows();updateBindings();
        if(!discoveryAttempted&&!testMode())startLocalDiscovery(false);
        if(!recoveryAttempted&&!Boolean.getBoolean("voxelstudio.uitest")){recoveryAttempted=true;recoverTask();}
    }
    private void switchTab(Tab next){tab=next;scroll=0;setFocused(null);clearAndInit();if(next==Tab.HISTORY)refreshHistory();}
    private StudioTheme.Button fixedButton(int x,int y,int w,int h,Supplier<String> label,StudioTheme.Kind kind,BooleanSupplier enabled,Supplier<String> hint,Runnable action){
        var b=addDrawableChild(new StudioTheme.Button(x,y,w,h,label.get(),kind,action));fixed.add(b);bindings.add(new Binding(b,label,enabled,hint));return b;
    }
    private <T extends ClickableWidget> T row(T widget,int y){addDrawableChild(widget);rows.add(new Row(widget,y));return widget;}
    private void sideButton(Supplier<String> label,StudioTheme.Kind kind,BooleanSupplier enabled,Supplier<String> hint,Runnable action){
        var c=layout.content();var b=row(new StudioTheme.Button(c.x(),c.y()+cursor,c.width(),22,label.get(),kind,action),cursor);bindings.add(new Binding(b,label,enabled,hint));cursor+=28;
    }
    private void pair(String a,String b,BooleanSupplier enabled,Runnable first,Runnable second){
        var c=layout.content();int w=(c.width()-6)/2;
        for(int i=0;i<2;i++){String label=i==0?a:b;Runnable action=i==0?first:second;var button=row(new StudioTheme.Button(c.x()+i*(w+6),c.y()+cursor,w,22,label,StudioTheme.Kind.NORMAL,action),cursor);bindings.add(new Binding(button,()->label,enabled,()->label));}cursor+=28;
    }
    private void section(String text){if(cursor>0)cursor+=8;line(text,StudioTheme.ACCENT);cursor+=3;}
    private void line(String text,int color){labels.add(new Label(Text.literal(text).asOrderedText(),cursor,color));cursor+=13;}
    private void paragraph(String text,int color){for(var line:textRenderer.wrapLines(Text.literal(text),layout.content().width())){labels.add(new Label(line,cursor,color));cursor+=12;}cursor+=4;}

    private void createTools(){
        sideButton(()->"环境选区 · 外层 / 内层 / 保护区",StudioTheme.Kind.NORMAL,()->!projection().busy,()->"只读世界范围，不调用模型、不修改世界；B 可直接打开",()->client.setScreen(new SelectionScreen(this)));
        sideButton(()->localScanMessage,StudioTheme.Kind.NORMAL,()->!taskBusy(),()->"自动检查 Codex / Claude Code / DeepSeek Harness；不安装、不登录、不生成。\n"+StudioClient.BRIDGE.preparationStatus(),this::chooseAgent);
        section("01  描述你的建筑");
        paragraph("只需描述建筑；体素结构和材料规则由工作室补全。",StudioTheme.MUTED);
        var c=layout.content();
        prompt=row(new StudioEditBoxWidget(textRenderer,c.x(),c.y()+cursor,c.width(),72,Text.literal("例如：三层中式酒楼，有庭院和夜景灯光"),Text.literal("建筑描述，多行输入")),cursor);
        prompt.setMaxLength(4000);prompt.setText(description);prompt.setChangeListener(s->description=s);cursor+=78;
        paragraph("Enter 换行 · Ctrl+Enter 生成\n可写尺寸、风格、室内和灯光需求。",StudioTheme.MUTED);
        sideButton(()->"参考图片 · 导入 / 裁剪 / 标注",StudioTheme.Kind.NORMAL,StudioScreen::idle,()->"本机 PNG/JPEG，最多四图；编辑和准备不调用模型。生成须先明确选择组件化及支持图片的 Codex 模型，再独立 SEND 确认。",()->client.setScreen(new StudioReferenceScreen(this,referenceDraft)));
        sideButton(()->projection().asset!=null&&projection().asset.sceneDesign?"局部精修当前构件 · 1 次":"修改当前建筑",StudioTheme.Kind.NORMAL,()->idle()&&projection().asset!=null&&model()!=null&&!description.isBlank(),()->"设计层资产须先选构件并确认修改范围；原版本保留，不自动精修",()->{if(projection().asset.sceneDesign)sceneRefinement(false);else generate(false,true);});
        sideButton(()->selectedComponent==null?"选择 / 定位设计构件":"当前构件："+selectedComponent,StudioTheme.Kind.NORMAL,()->idle()&&projection().asset!=null&&projection().asset.sceneDesign,()->"按源构件 ID 定位其实际几何范围；只读，不调用模型、不改变世界",this::chooseDesignComponent);
        sideButton(()->"原版 / 新版切换",StudioTheme.Kind.NORMAL,()->idle()&&compareOriginal!=null&&compareRevised!=null&&projection().asset!=null&&(projection().asset.hash.equals(compareOriginal.hash)||projection().asset.hash.equals(compareRevised.hash)),()->"保持面板相机，对比这次修订前后；切换后世界建造确认失效，须重新检查",StudioScreen::toggleComparison);
        sideButton(()->"看图精修 · 4 视角 / 1 次调用",StudioTheme.Kind.NORMAL,()->idle()&&projection().asset!=null&&supportsVisualReview()&&!description.isBlank(),()->"仅支持已声明图片能力的 Codex 模型；资产专用四视图，不含世界和桌面。再次确认后调用 1 次，0 自动修复。",this::visualReview);
        section("02  本机制作 Agent");
        sideButton(()->"制作来源："+(!userSelectedAgent&&!agentReady?"请选择":agentName()),StudioTheme.Kind.NORMAL,()->!taskBusy()&&!discovering,()->"选择 Codex、Claude Code 或 DeepSeek Harness；不会提交生成",this::chooseAgent);
        sideButton(()->localScanActive?"正在自动检测全部 Agent…":"重新检测全部 Agent",StudioTheme.Kind.NORMAL,()->!localScanPending&&!localScanActive&&!taskBusy(),()->"按已知安装目录和 PATH 检查；一个慢来源不会阻塞其他检测结果",()->startLocalDiscovery(true));
        sideButton(()->"连接诊断 / 手动 Agent 路径",StudioTheme.Kind.NORMAL,()->!taskBusy()&&!discovering,()->"检查内置配套或指定 CLI 路径；自动检测找不到时使用",()->client.setScreen(new StudioDiagnosticsScreen(this,StudioScreen::refreshAgent,selectedAgent)));
        sideButton(()->discovering?"正在检测 "+agentName()+"…":!agentReady?"连接 "+agentName()+" / 重试":agentName()+" 已连接 · 重新检测",StudioTheme.Kind.NORMAL,()->!discovering&&!taskBusy(),()->"仅检测登录与可用模型，不发起生成",()->{userSelectedAgent=true;StudioClient.BRIDGE.reconnect();refreshAgent();});
        if(selectedAgent.equals("claude")){
            paragraph("Claude Code 实验接入：CLI 没有公开账户模型列表，请填写你已知可用的模型 ID/别名。尚未验证真实 Claude 生成，不自动回退模型。",StudioTheme.WARN);
            var manual=row(new TextFieldWidget(textRenderer,c.x(),c.y()+cursor,c.width(),22,Text.literal("Claude 模型 ID 或 CLI 别名")),cursor);manual.setMaxLength(200);manual.setText(manualClaudeModel);manual.setChangedListener(s->manualClaudeModel=s.trim());cursor+=28;
        }else sideButton(()->"模型："+modelLabel(),StudioTheme.Kind.NORMAL,()->!models.isEmpty()&&!taskBusy(),()->"打开可搜索的真实模型列表",this::chooseModel);
        sideButton(()->"推理："+StudioMessages.effort(selectedEffort),StudioTheme.Kind.NORMAL,()->!models.isEmpty()&&!taskBusy(),()->"选择该模型实际支持的推理级别",this::chooseEffort);
        if(selectedAgent.equals("deepseek")){
            paragraph("模型来自 Harness 本机配置目录，不代表账号实时授权。独立无工具运行；不加载个人插件、不自动重试。",StudioTheme.MUTED);
            sideButton(()->outputBudget==0?"输出预算：跟随 Harness / 模型":"每阶段输出预算："+outputBudget+" tokens",StudioTheme.Kind.NORMAL,StudioScreen::idle,()->"模组不设固定 token 上限；可跟随本机模型配置或手填预算。服务端仍有自身限制；不自动重试。",this::chooseOutputBudget);
        }
        sideButton(()->generationMode.equals("components")?"生成方式：组件化 · "+qualityTier:generationMode.equals("checkpoints")?"生成方式：设计检查点（最多 "+checkpointCalls+" 次）":generationMode.equals("scene")?"生成方式：实验设计层（1 次）":generationMode.equals("layered")?"生成方式：外壳 → 内饰（2 次）":"生成方式：完整建筑（1 次）",StudioTheme.Kind.NORMAL,StudioScreen::idle,()->"组件化有四档制作深度，先设计总纲再分工拼装；检查点与旧单次入口仍保留。",this::chooseGenerationMode);
        if(generationMode.equals("components")){
            sideButton(()->"制作精度："+qualityTier,StudioTheme.Kind.NORMAL,StudioScreen::idle,()->"档位控制拆分深度与复核轮数，不缩小建筑，不保证每次质量达标",this::chooseQualityTier);
            sideButton(()->"组件化总预算：最多 "+assemblyCalls+" 次",StudioTheme.Kind.NORMAL,StudioScreen::idle,()->"总纲、组件、纠错、复核与精修都计入；可主动降低，生成前必须确认",this::chooseAssemblyCalls);
            sideButton(()->assemblyProviderRecovery?"容量恢复：开启 · 原预算内":"容量恢复：关闭（默认）",StudioTheme.Kind.NORMAL,()->idle()&&(assemblyProviderRecovery||canSelectProviderRecovery()),()->"仅 Codex 和明确已声明推理强度可选。最多两次等待 10 / 30 秒，失败不退预算；不换模型、不删功能、未知不重发。生成前单独列入费用确认。",()->{assemblyProviderRecovery=!assemblyProviderRecovery;tell(assemblyProviderRecovery?"本次制作设置已开启有限容量恢复":"容量恢复已关闭",assemblyProviderRecovery?StudioProviderRecovery.WARNING:"下一次预检将使用零提供方重试；没有改动原任务或调用模型。",StudioTheme.WARN);});
            sideButton(()->assemblyQualityVersion==4?"质量 v4：前后对照 + 分项复核":assemblyQualityVersion==3?"质量 v3：实景候选 + 自动选案":assemblyQualityVersion==2?"质量 v2：代表原型 + 协调精修":"质量流程：稳定旧版",StudioTheme.Kind.NORMAL,()->idle(),()->"点击切换：旧版 / v2 / v3 / v4。v4 增加同角度修改前后对照、入口与顶部近景，并逐项追踪设计问题；至少 7 次，需支持图片的模型。",this::cycleAssemblyQuality);
            sideButton(()->assemblyImageReview?(assemblyQualityVersion>=2?"整体复核：原生材质 / 内饰切层":"整体复核：四视角几何图")+(supportsVisualReview()?"":"（需要支持图片的模型）"):"整体复核：仅文本",StudioTheme.Kind.NORMAL,()->idle()&&assemblyQualityVersion<3&&(assemblyImageReview||supportsVisualReview()),()->"v3 / v4 使用原生图像比较；v2 可选择文本。原生图只含建筑资产，不含世界、玩家、界面和桌面；生成前确认。",()->assemblyImageReview=!assemblyImageReview);
            if(assemblyQualityVersion==4)sideButton(()->"原型流程："+switch(assemblyPrototypeMode){case "verified"->"旧版整组制作 / 展开";case "staged"->"分阶段 · Ultra 实验";default->"关闭 · 保留原流程";},StudioTheme.Kind.NORMAL,StudioScreen::idle,()->"明确选择关闭 / 旧版 / Ultra 分阶段。新流程分别生成概念、蓝图和四角色原型，预算至少 22 次；不会改变旧任务或自动授权调用。",this::choosePrototypeWorkflow);
            if(assemblyQualityVersion==4&&assemblyPrototypeMode.equals("staged"))sideButton(()->assemblyCompletionReserve?"收尾预留：开启 · 含一次改稿纠错":"收尾预留：关闭 · 保留旧策略",StudioTheme.Kind.NORMAL,StudioScreen::idle,()->StudioCompletionReserve.WARNING,this::toggleCompletionReserve);
            paragraph((assemblyPrototypeMode.equals("staged")?"3 次独立概念 + 差量蓝图 + 4 次角色原型；"+StudioAssembly.stagedBudgetSummary(assemblyCalls)+"。":"最多 "+assemblyPackageLimit()+" 个制作任务 / "+StudioAssembly.tier(qualityTier).reviewRounds()+" 轮最终复核；候选、选案和整体改稿也占预算。")+"图像反馈不等于审美认证，中间稿不可建造。",StudioTheme.WARN);
        }
        if(generationMode.equals("checkpoints")){
            sideButton(()->"检查点总预算：最多 "+checkpointCalls+" 次",StudioTheme.Kind.NORMAL,StudioScreen::idle,()->"包含布局、细化和预算内纠错；每次均可能计费，生成前再次确认",this::chooseCheckpointCalls);
            paragraph("实验检查点：中间稿不可建造。至少 2 次调用；纠错消耗总预算，不会无限重试。",StudioTheme.WARN);
        }
        paragraph("1 格≈1 米；最高 384 格，总体积仍有限制。实验设计层可重复楼层/窗组并显式保留核心筒；不承诺所有生成均成功。",StudioTheme.MUTED);
        if(!generationMode.equals("checkpoints")&&!generationMode.equals("components"))sideButton(()->"额外自动修复预算："+repairBudget+" 次",StudioTheme.Kind.NORMAL,()->idle()&&generationMode.equals("single"),()->"原有单次模式的额外调用；其他模式不增加额外修复调用。",()->repairBudget=(repairBudget+1)%3);
        paragraph("生成使用所选账户额度。未连接时仍可使用示例；不会自动替换模型或重复提交中断任务。",StudioTheme.MUTED);
        sideButton(()->cancelling?"正在取消…":"取消生成",StudioTheme.Kind.DANGER,()->activeJob!=null&&!cancelling,()->"停止当前生成，保留之前已经完成的建筑",StudioScreen::cancelGeneration);
        sideButton(()->recovering?"正在查找原任务…":"查询 / 恢复中断任务",StudioTheme.Kind.NORMAL,()->!recovering&&!submitting&&!loading,()->"只按保存的身份查询；绝不重新提交生成",StudioScreen::recoverTask);
        sideButton(()->"归档未确认任务",StudioTheme.Kind.DANGER,()->pendingKey!=null&&activeJob==null&&!submitting&&!recovering,()->"归档不代表任务取消；原任务可能仍运行，新生成可能再次计费",()->client.setScreen(new StudioInfoScreen(this,"归档状态未知的任务？","无法确定原任务是否已生成。归档不会取消它；再次生成可能重复计费。建议先查询原任务或检查历史。原身份会保留在本机归档中。","确认归档",true,()->{if(taskIdentity!=null){recovering=true;STATE.archiveTask(taskIdentity).whenComplete((v,e)->onClient(()->{recovering=false;if(e!=null){fail(e);return;}pendingKey=null;taskIdentity=null;tell("任务身份已归档，未取消原任务","新生成会创建新任务，请确认原任务状态。",StudioTheme.WARN);}));}client.setScreen(this);})));
        section("03  预览后再建造");
        sideButton(()->"取消建筑下载 / 草稿恢复",StudioTheme.Kind.NORMAL,()->loading||projection().restoring,()->"停止下载，保留已完成历史版本",()->{StudioClient.BRIDGE.cancelLoad();loadTicket++;loading=false;projection().restoring=false;projection().coordinates(projection().anchor);tell("下载已停止，历史版本仍保留","不会取消已有的完成版本。",StudioTheme.MUTED);});
        paragraph("右侧拖动旋转，右键拖动平移。进入世界投影后可以自由绕行，确认前不会写入任何方块。",StudioTheme.MUTED);
    }
    private void placementTools(){
        var p=projection();BooleanSupplier editable=()->p.asset!=null&&!p.busy&&!loading;
        section("01  世界投影");
        sideButton(()->p.visible?"隐藏投影":"显示世界投影",StudioTheme.Kind.NORMAL,editable,()->"只切换客户端可视化，不会修改世界",()->{if(p.visible)p.visible=false;else p.enterWorld();});
        sideButton(()->p.locked?"已锁定 · 切换为跟随":"视线跟随 · 锁定位置",StudioTheme.Kind.NORMAL,editable,()->"跟随时滚轮推远/拉近；锁定后滚轮沿面朝主轴微调",p::toggleLock);
        sideButton(()->"重新选址（视线跟随）",StudioTheme.Kind.NORMAL,editable,()->"返回游戏，重新在面朝方向定位；不会建造",()->{p.beginPosition();close();});
        sideButton(()->"吸附准星表面并锁定",StudioTheme.Kind.NORMAL,editable,()->"以准星命中的表面作为建筑底部中心；G 为游戏内快捷键",p::snapToSurface);
        pair("旋转 90°","X 轴镜像",editable,p::rotate,p::mirror);
        sideButton(()->"撤回定位（不撤销方块）",StudioTheme.Kind.NORMAL,p::canUndoDraft,()->"仅撤回投影的坐标/旋转/镜像，最多 32 步",()->{p.undoDraft();syncCoordinates();});
        sideButton(()->"重做定位",StudioTheme.Kind.NORMAL,p::canRedoDraft,()->"只重做投影定位；不会重做世界建造",()->{p.redoDraft();syncCoordinates();});
        sideButton(()->"锁定时滚轮："+p.axisLabel(),StudioTheme.Kind.NORMAL,editable,()->"切换面朝主轴 / X / Y / Z；Ctrl ×8，H 隐藏后恢复物品栏滚轮",p::cycleAxis);
        sideButton(()->"贴到中心列最高表面",StudioTheme.Kind.NORMAL,editable,()->"只调整投影高度；不挖地、不填平坡地",p::ground);
        section("02  精确定位");
        var c=layout.content();int cw=(c.width()-8)/3;coordinates=new TextFieldWidget[3];int[] values={p.anchor.getX(),p.anchor.getY(),p.anchor.getZ()};
        for(int i=0;i<3;i++){
            var field=row(new TextFieldWidget(textRenderer,c.x()+i*(cw+4),c.y()+cursor+14,cw,20,Text.literal(new String[]{"X 坐标","Y 坐标","Z 坐标"}[i])),cursor+14);
            field.setMaxLength(11);field.setTextPredicate(s->s.matches("-?\\d{0,10}"));field.setText(coordinateDraft==null?Integer.toString(values[i]):coordinateDraft[i]);field.setChangedListener(s->{coordinatesDirty=true;});coordinates[i]=field;
        }
        cursor+=41;shownAnchor=p.anchor;coordinatesDirty=coordinateDraft!=null;
        sideButton(()->coordinatesDirty?"应用坐标 · 尚未应用":"应用 X / Y / Z 坐标",StudioTheme.Kind.NORMAL,editable,()->"三项必须是整数；应用后会锁定投影并重新检查位置",this::applyCoordinates);
        sideButton(()->"移动步长："+step+" 格",StudioTheme.Kind.NORMAL,editable,()->"在 1 格精调和 8 格粗调之间切换；按住 Ctrl 也可粗调",()->step=step==1?8:1);
        pair("−X","+X",editable,()->move(-1,0,0),()->move(1,0,0));pair("−Y","+Y",editable,()->move(0,-1,0),()->move(0,1,0));pair("−Z","+Z",editable,()->move(0,0,-1),()->move(0,0,1));
        section("03  显示与覆盖");
        sideButton(()->p.renderer.night?"夜景近似 · 切换白天":"白天预览 · 查看夜景近似",StudioTheme.Kind.NORMAL,editable,()->"仅近似区分发光与普通材质，不模拟光照传播或光影包泛光",p::night);
        sideButton(()->"显示："+p.layerLabel(),StudioTheme.Kind.NORMAL,editable,()->"点击切换完整 / 以下层 / 单层；过滤显示时不能建造",p::cycleLayerMode);
        pair("上一层","下一层",editable,()->p.shiftLayer(1),()->p.shiftLayer(-1));
        sideButton(()->"恢复完整建筑显示",StudioTheme.Kind.NORMAL,editable,()->"恢复全部楼层，不修改世界",()->p.slice(-1));
        paragraph("夜景仅为亮度近似，真实灯光以建造后为准。剖切只影响观察，确认前需恢复完整建筑。",StudioTheme.MUTED);
        var opacity=row(new SliderWidget(c.x(),c.y()+cursor,c.width(),22,Text.empty(),(p.opacity-.15)/.7){
            @Override protected void updateMessage(){setMessage(Text.literal("投影透明度 "+Math.round((.15+value*.7)*100)+"%"));}
            @Override protected void applyValue(){p.opacity=(float)(.15+value*.7);}
        },cursor);opacity.setMessage(Text.literal("投影透明度 "+Math.round(p.opacity*100)+"%"));cursor+=28;
        sideButton(()->p.replace?"覆盖策略：覆盖与挖空":"覆盖策略：仅填空气",StudioTheme.Kind.NORMAL,editable,()->"仅填空气不会挖地形；覆盖与挖空会修改已有方块，仍跳过受保护对象",()->{p.replace=!p.replace;p.coordinates(p.anchor);});
        paragraph("仅填空气：保留已有建筑和地形。\n覆盖与挖空：按建筑掩码修改地形，保留区始终不变。",StudioTheme.WARN);
        sideButton(()->"恢复上次投影草稿",StudioTheme.Kind.NORMAL,()->!p.busy&&!loading,()->"只恢复匹配当前世界、维度和建筑哈希的草稿",()->p.restore(StudioClient.BRIDGE));
        paragraph("橙色轮廓表示覆盖/挖空，紫色表示不可用。所有世界写入仍需二次确认。",StudioTheme.MUTED);
    }
    private void historyTools(){
        section("建筑版本与失败稿");
        sideButton(()->"导入原生资产包",StudioTheme.Kind.NORMAL,StudioScreen::idle,()->"导入经过哈希校验的 manifest/cells，不调用 AI、不直接建造",()->client.setScreen(new StudioImportScreen(this)));
        sideButton(()->"导出可分享原生资产包",StudioTheme.Kind.NORMAL,()->projection().asset!=null&&!loading,()->"只导出建筑数据，不包含账户、提示词或私人任务日志",()->StudioClient.BRIDGE.request("POST","/v1/jobs/"+projection().asset.revision+"/bundle",null).whenComplete((r,e)->onClient(()->{if(e!=null){fail(e);return;}client.setScreen(new StudioInfoScreen(this,"已导出原生资产包",r.get("directory").getAsString()+"\n\n可分享该目录；只包含 manifest.json、cells.bin 和可选 spec.json。不会附带输入提示词、账户或令牌。接收方仍需使用完整模组配套。"));})));
        paragraph("点选版本加载预览，不会写入世界。新修订不会覆盖原版。",StudioTheme.MUTED);
        if(historyLoading)paragraph("正在读取本机历史…",StudioTheme.MUTED);
        else if(history.isEmpty())paragraph("还没有已完成的建筑。先到创作页生成，或加载一个示例。",StudioTheme.MUTED);
        for(var entry:history){
            JsonObject job=entry.getAsJsonObject();String id=job.get("id").getAsString();var m=job.getAsJsonObject("manifest");
            if(StudioReferenceHistory.reference(job)){
                sideButton(()->"查看原图片 / 识图简报",StudioTheme.Kind.NORMAL,()->true,()->"准确读取原任务自己的图片和简报；不恢复授权、不调用模型或放置",()->client.setScreen(new StudioReferenceHistoryScreen(this,job)));
                sideButton(()->"参考图原任务 · 只读详情",StudioTheme.Kind.NORMAL,()->true,()->"查看原图片任务绑定与调用预算；不重发、不把图片失败转成文字生成",()->client.setScreen(new StudioInfoScreen(this,"参考图原任务记录","任务 "+id+"\n状态："+StudioMessages.state(string(job,"state",""))+StudioReferenceHistory.details(job)+stagedDetails(job))));
            }
            if("failed".equals(string(job,"state",""))||(stagedJob(job)||StudioReferenceHistory.reference(job))&&Set.of("cancelled","interrupted").contains(string(job,"state",""))){
                String cause=string(job,"error","未知错误");
                sideButton(()->StudioMessages.state(string(job,"state","failed"))+" · "+string(job,"model","本地校验"),StudioTheme.Kind.NORMAL,()->true,()->cause,()->client.setScreen(new StudioInfoScreen(this,"未完成任务详情",cause+stagedDetails(job)+StudioMessages.constructionFeedback(job)+"\n任务 "+id+"\n旧版本仍保留；世界未改动。")));
                if(job.has("diagnosticPreview"))sideButton(()->"查看失败稿 · 只读诊断",StudioTheme.Kind.NORMAL,StudioScreen::idle,()->"查看原始冲突几何与切片，不调用 AI；不可投影、建造或导出，不替换当前建筑",()->client.setScreen(new StudioFailedDesignScreen(this,id,cause)));
                if(failedRepairCandidate(job))sideButton(()->"修订失败稿 · 确认后调用 1 次",StudioTheme.Kind.NORMAL,()->idle()&&model()!=null,()->"使用创作页当前所选模型；先核对原稿和预算，不自动调用。全文新分支，不能当作局部精修",()->repairFailedScene(id));
                if(!stagedJob(job)&&!StudioReferenceHistory.reference(job))sideButton(()->"仅本地重新校验（不调用 AI）",StudioTheme.Kind.NORMAL,StudioScreen::idle,()->"用新版规则重检已有输出；可校正通道声明，不改建筑几何、不调用模型，原失败记录保留",()->{JsonObject req=new JsonObject();req.addProperty("key",UUID.randomUUID().toString());req.addProperty("revalidateJobId",id);submitRequest(req,true);});
                paragraph(StudioMessages.errorSummary(cause),StudioTheme.WARN);continue;
            }
            String name=m!=null?m.get("id").getAsString():id;String time=string(job,"createdAt","").replace('T',' ');if(time.length()>16)time=time.substring(0,16);
            String detail=time+" · "+(job.has("failedRepair")?"失败稿修订分支 · 需完整复查":job.has("baseJobId")?"修订":"原版")+"\n"+(m==null?"":m.get("setCount").getAsString()+" 方块")+"\n版本 "+id;
            sideButton(()->(projection().asset!=null&&id.equals(projection().asset.revision)?"当前 · ":"")+name,StudioTheme.Kind.NORMAL,StudioScreen::idle,()->detail,()->loadAsset(id));
            if(stagedJob(job))sideButton(()->"制作账本 / 复核结果",StudioTheme.Kind.NORMAL,()->true,()->"查看真实预留与阶段结果，不调用模型",()->client.setScreen(new StudioInfoScreen(this,"制作账本",stagedDetails(job))));
            paragraph(time+" · "+(m==null?"":m.get("setCount").getAsString()+" 方块"),StudioTheme.MUTED);
        }
        sideButton(()->"恢复世界投影草稿",StudioTheme.Kind.NORMAL,StudioScreen::idle,()->"恢复上次的世界位置，不自动建造",()->projection().restore(StudioClient.BRIDGE));
        sideButton(()->"查看当前修订差异",StudioTheme.Kind.NORMAL,()->projection().asset!=null&&!loading,()->"核对增删替换与空气掩码变化；查看发生改动的分区",()->{String id=projection().asset.revision;StudioClient.BRIDGE.request("GET","/v1/jobs/"+id+"/diff",null).whenComplete((diff,e)->onClient(()->{if(e!=null){fail(e);return;}if(projection().asset==null||!id.equals(projection().asset.revision))return;client.setScreen(new StudioInfoScreen(this,"建筑修订差异",new GsonBuilder().setPrettyPrinting().create().toJson(diff)+"\n\nadded=新增；removed=移除实体；replaced=材质替换；maskChanged=保留/挖空语义变化；chunks=发生改动的16格分区。尺寸变化时须完整复查。"));}));});
        sideButton(()->"世界操作 / 恢复中心",StudioTheme.Kind.NORMAL,()->client.getServer()!=null&&!projection().busy,()->"只读检查放置日志，不会猜测恢复不完整批次",()->client.setScreen(new StudioRecoveryScreen(this)));
    }
    private void createBottomActions(){
        var s=layout.sidebar();int x=s.x()+9,y=s.bottom()-31,w=(s.width()-24)/2;
        if(tab==Tab.CREATE){
            fixedButton(x,y,w,23,()->submitting?"提交中…":"生成建筑",StudioTheme.Kind.PRIMARY,()->idle()&&model()!=null&&!description.isBlank(),()->model()==null?"请先连接所选 Agent 并选择模型；也可点示例体验":taskBusy()?"请等待或取消当前生成":"模型："+modelLabel()+"\n推理："+selectedEffort+"\n生成会使用该账户额度；Ctrl+Enter",()->generate(false,false));
            fixedButton(x+w+6,y,w,23,()->"加载示例",StudioTheme.Kind.NORMAL,StudioScreen::idle,()->"无需 AI，无账户用量；只加载一个可预览的小屋",()->generate(true,false));
        }else if(tab==Tab.PLACE){
            fixedButton(x,y,w,23,()->"建造确认",StudioTheme.Kind.PRIMARY,()->projection().canPlace()&&!taskBusy(),()->projection().placementBlockReason(),StudioScreen::confirmPlacement);
            fixedButton(x+w+6,y,w,23,()->projection().busy?"停止操作":"撤销上次",StudioTheme.Kind.DANGER,()->projection().busy||(client.getServer()!=null&&client.player!=null&&client.player.isCreative()&&!taskBusy()),()->projection().busy?"停止后续批次，已完成部分仍可撤销":"只撤销本工具的直接修改，并保留后续编辑",()->{if(projection().busy)projection().cancelPlacement();else confirmUndo();});
        }else{
            fixedButton(x,y,w,23,()->"导出 .schem",StudioTheme.Kind.PRIMARY,()->projection().asset!=null&&!loading,()->"导出当前完成版本，经过严格复核",this::exportAsset);
            fixedButton(x+w+6,y,w,23,()->historyLoading?"读取中…":"刷新列表",StudioTheme.Kind.NORMAL,()->!historyLoading,()->"读取所有已完成版本，不调用 AI",this::refreshHistory);
        }
    }
    private void createPreviewControls(){
        var r=layout.preview();int half=(r.width()-22)/2;
        fixedButton(r.x()+8,r.y()+7,half,20,()->projection().materials?"MC 材质":"建筑形体",StudioTheme.Kind.NORMAL,()->projection().asset!=null,()->"切换真实方块材质 / 形体；不会改变导出内容",()->projection().materials=!projection().materials);
        fixedButton(r.x()+14+half,r.y()+7,half,20,()->"重置视角",StudioTheme.Kind.NORMAL,()->true,()->"恢复相机旋转、缩放和平移",this::resetCamera);
        fixedButton(r.x()+8,r.bottom()-29,r.width()-16,22,()->projection().busy?"正在修改世界…":projection().visible?"返回当前世界投影":"进入世界投影",StudioTheme.Kind.PRIMARY,()->projection().asset!=null&&!projection().busy&&!loading&&!projection().restoring,()->"跟随时滚轮推远/拉近，K 锁定；H 退出投影并恢复物品栏滚轮",()->{projection().enterWorld();close();});
    }
    private void updateBindings(){for(var b:bindings){b.button.setMessage(Text.literal(b.label.get()));b.button.active=b.enabled.getAsBoolean();b.button.setTooltip(Tooltip.of(Text.literal(b.hint.get())));}if(coordinates!=null)for(var f:coordinates)f.active=projection().asset!=null&&!projection().busy;}
    private void layoutRows(){var c=layout.content();for(var r:rows){r.widget.setY(c.y()+r.y-scroll);r.widget.visible=r.widget.getY()+r.widget.getHeight()>c.y()&&r.widget.getY()<c.bottom();}}
    private void scroll(int amount){scroll=StudioLayout.clampScroll(scroll+amount,contentHeight,layout.content().height());layoutRows();}
    @Override public void tick(){if(prompt!=null)prompt.tick();for(var r:rows)if(r.widget instanceof TextFieldWidget field)field.tick();if(coordinates!=null&&!coordinatesDirty&&!projection().anchor.equals(shownAnchor))syncCoordinates();updateBindings();}
    private void syncCoordinates(){coordinateDraft=null;if(coordinates==null)return;var p=projection().anchor;int[] values={p.getX(),p.getY(),p.getZ()};for(int i=0;i<3;i++)coordinates[i].setText(Integer.toString(values[i]));coordinatesDirty=false;shownAnchor=p;}
    private void applyCoordinates(){try{projection().coordinates(new BlockPos(StudioLayout.coordinate(coordinates[0].getText()),StudioLayout.coordinate(coordinates[1].getText()),StudioLayout.coordinate(coordinates[2].getText())));coordinatesDirty=false;syncCoordinates();tell("坐标已应用，投影已锁定",projection().anchor.toShortString(),StudioTheme.ACCENT);}catch(Exception e){tell("坐标无效，请输入三个整数",e.getMessage(),StudioTheme.ERROR);}}
    private void move(int x,int y,int z){int amount=hasControlDown()?8:step;projection().move(x*amount,y*amount,z*amount);syncCoordinates();}
    private void resetCamera(){yaw=-35;pitch=24;zoom=1;panX=panY=0;}

    private static String string(JsonObject o,String key,String fallback){return o.has(key)&&!o.get(key).isJsonNull()?o.get(key).getAsString():fallback;}
    private static String agentName(){return switch(selectedAgent){case "claude"->"Claude Code";case "deepseek"->"DeepSeek";default->"Codex";};}
    private static boolean testMode(){return Boolean.getBoolean("voxelstudio.uitest")||Boolean.getBoolean("voxelstudio.selftest")||Boolean.getBoolean("voxelstudio.projectiontest")||SelectionSelfTest.enabled();}
    private static void startLocalDiscovery(boolean refresh){
        if(localScanPending)return;discoveryAttempted=true;localScanActive=true;localScanTicks=0;localScanMessage="正在检测本机 Agent…";pollLocalDiscovery(refresh);
    }
    private static void pollLocalDiscovery(boolean refresh){
        if(localScanPending)return;localScanPending=true;
        StudioClient.BRIDGE.request("GET","/v1/agents/discovery"+(refresh?"?refresh=1":""),null).whenComplete((r,e)->onClient(()->{
            localScanPending=false;if(e!=null){localScanActive=false;localScanMessage="自动检测未完成 · 点此选择来源";fail(e);if(net.fabricmc.loader.api.FabricLoader.getInstance().isDevelopmentEnvironment()&&Boolean.getBoolean("voxelstudio.onboardingtest"))System.err.println("VOXEL_STUDIO_ONBOARDING_STARTUP "+notice.details);return;}
            localAgents.accept(r.getAsJsonArray("agents"));localScanActive=!r.get("complete").getAsBoolean();int count=localAgents.available();
            localScanMessage=localScanActive?"检测中 · "+count+" 个来源可用":"本机 Agent："+count+" 个可用 · 点击选择";
            if(!localScanActive){
                if(!userSelectedAgent){String single=localAgents.onlyAvailable();if(single!=null){selectAgent(single,false);return;}
                    tell(count==0?"未找到可用 Agent；仍可加载示例":"检测到多个可用 Agent，请选择制作来源","检测只读，不提交生成。点击顶部本机 Agent 查看状态；需登录或配置凭据时请在对应 CLI 中操作。",StudioTheme.MUTED);
                }else if(localAgents.status(selectedAgent).available()&&!taskBusy())refreshAgent();
                else if(!localAgents.status(selectedAgent).available()){agentReady=false;models=new JsonArray();}
            }
        }));
    }
    private static void selectAgent(String id,boolean explicit){
        if(selectedModel!=null)rememberedModels.put(selectedAgent,selectedModel);userSelectedAgent|=explicit;selectedAgent=id;models=new JsonArray();selectedModel=rememberedModels.get(id);selectedEffort="default";agentReady=false;assemblyProviderRecovery=false;
        if(MinecraftClient.getInstance().currentScreen instanceof StudioScreen screen)screen.clearAndInit();refreshAgent();
    }
    private void chooseAgent(){
        Supplier<List<StudioChoiceScreen.Choice>> choices=()->List.of(new StudioChoiceScreen.Choice("codex","Codex · "+localAgents.label("codex"),"需要本机 Codex CLI；使用你自己的账户，检测不生成"),new StudioChoiceScreen.Choice("claude","Claude Code · "+localAgents.label("claude"),"实验接入，手填模型 ID；真实生成尚未验收"),new StudioChoiceScreen.Choice("deepseek","DeepSeek Harness · "+localAgents.label("deepseek"),"0.1.5-rc.1 · 本机配置目录，不代表实时授权"));
        client.setScreen(new StudioChoiceScreen(this,"本机 Agent · 检测状态",choices,userSelectedAgent||agentReady?selectedAgent:null,id->selectAgent(id,true)));
    }
    private static JsonObject model(){if(selectedAgent.equals("claude")){if(!agentReady||manualClaudeModel.isBlank())return null;JsonObject m=new JsonObject();m.addProperty("id",manualClaudeModel);return m;}for(var m:models)if(string(m.getAsJsonObject(),"id","").equals(selectedModel))return m.getAsJsonObject();return null;}
    private static String modelLabel(){return model()==null?(models.isEmpty()?"未连接":"请选择模型"):string(model(),"id","未知模型");}
    private static boolean supportsVisualReview(){return selectedAgent.equals("codex")&&model()!=null&&model().has("supportsImages")&&model().get("supportsImages").getAsBoolean();}
    private void chooseDesignComponent(){
        var asset=projection().asset;if(!idle()||asset==null||!asset.sceneDesign)return;String world=projection().key();preflighting=true;
        StudioClient.BRIDGE.request("GET","/v1/jobs/"+asset.revision+"/design-sources",null).whenComplete((data,error)->onClient(()->{
            preflighting=false;if(error!=null){fail(error);return;}if(projection().asset!=asset||!world.equals(projection().key())||client.currentScreen!=this)return;
            designSources=data;designRevision=asset.revision;var choices=new ArrayList<StudioChoiceScreen.Choice>();
            for(var entry:data.getAsJsonObject("componentBounds").entrySet()){String id=entry.getKey();int instances=entry.getValue().getAsJsonArray().size();choices.add(new StudioChoiceScreen.Choice(id,id,"实际几何范围 · "+instances+" 个重复实例；选择只定位，不调用 AI"));}
            client.setScreen(new StudioChoiceScreen(this,"定位设计构件 · 不调用 AI",choices,selectedComponent,id->{selectedComponent=id;selectedInstance=-1;sharedModuleRevision=false;chooseInstanceScope();}));
        }));
    }
    private void chooseInstanceScope(){
        var bounds=designSources.getAsJsonObject("componentBounds").getAsJsonArray(selectedComponent);var choices=new ArrayList<StudioChoiceScreen.Choice>();
        choices.add(new StudioChoiceScreen.Choice("component","整个构件 · "+bounds.size()+" 个实例","不更改共享模块定义；其他构件默认受保护"));
        if(bounds.size()>1)for(int i=0;i<bounds.size();i++)choices.add(new StudioChoiceScreen.Choice("instance-"+i,"仅第 "+(i+1)+" 个实例",bounds.get(i)+" · 独立精修，不联动其他楼层/同类构件"));
        if(designSources.has("componentModules")&&designSources.getAsJsonObject("componentModules").has(selectedComponent))choices.add(new StudioChoiceScreen.Choice("shared","共享模块 · 全部同类实例","明确允许修改模块定义；确认前列出所有消费者和影响范围"));
        client.setScreen(new StudioChoiceScreen(this,"选择定位 / 精修范围 · 不调用 AI",choices,"component",value->{
            selectedInstance=value.startsWith("instance-")?Integer.parseInt(value.substring(9)):-1;sharedModuleRevision=value.equals("shared");
            tell("已定位："+selectedComponent+(selectedInstance>=0?" · 第 "+(selectedInstance+1)+" 个":sharedModuleRevision?" · 全部同类":" · 整个构件"),"橙色范围是实际编译几何。精修仍需单独确认调用；选择范围不修改世界。",StudioTheme.ACCENT);
        }));
    }
    private static LinkedHashSet<String> designScopeIds(){
        var ids=new LinkedHashSet<String>();ids.add(selectedComponent);
        if(sharedModuleRevision&&designSources.has("componentModules")&&designSources.has("moduleConsumers")){
            var module=designSources.getAsJsonObject("componentModules").get(selectedComponent);
            if(module!=null)for(var id:designSources.getAsJsonObject("moduleConsumers").getAsJsonArray(module.getAsString()))ids.add(id.getAsString());
        }
        return ids;
    }
    private static LinkedHashSet<String> designDependents(Set<String> selected){
        var result=new LinkedHashSet<>(selected);boolean added=true;
        while(added){added=false;for(var entry:designSources.getAsJsonObject("dependencies").entrySet())if(!result.contains(entry.getKey()))for(var ref:entry.getValue().getAsJsonArray())if(result.contains(ref.getAsString())){result.add(entry.getKey());added=true;break;}}
        return result;
    }
    private JsonObject designRevisionScope(boolean includeDependents){
        var selected=designScopeIds();if(includeDependents)selected=designDependents(selected);
        var scope=new JsonObject();var ids=new JsonArray();var regions=new JsonArray();var bounds=designSources.getAsJsonObject("componentBounds");
        for(String id:selected){ids.add(id);var boxes=bounds.getAsJsonArray(id);if(id.equals(selectedComponent)&&selectedInstance>=0)regions.add(boxes.get(selectedInstance).deepCopy());else for(var box:boxes)regions.add(box.deepCopy());}
        scope.add("components",ids);scope.add("regions",regions);scope.addProperty("shared",sharedModuleRevision?"all":"instance");
        if(selectedInstance>=0){var instances=new JsonArray();var selection=new JsonObject();selection.addProperty("component",selectedComponent);selection.addProperty("index",selectedInstance);instances.add(selection);scope.add("instances",instances);}
        var protectedIds=new JsonArray();for(String id:bounds.keySet())if(!selected.contains(id))protectedIds.add(id);scope.add("protectedComponents",protectedIds);return scope;
    }
    private void sceneRefinement(boolean visual){
        var asset=projection().asset;if(!idle()||asset==null||!asset.sceneDesign||model()==null||description.isBlank()||visual&&!supportsVisualReview())return;
        if(designSources==null||!asset.revision.equals(designRevision)||selectedComponent==null||!designSources.getAsJsonObject("componentBounds").has(selectedComponent)){tell("先选择要精修的设计构件","修改范围须先明确；尚未调用模型。",StudioTheme.WARN);chooseDesignComponent();return;}
        var selected=designScopeIds();var related=designDependents(selected);related.removeAll(selected);
        if(!related.isEmpty())client.setScreen(new StudioChoiceScreen(this,"依赖范围 · 是否一并解锁",List.of(new StudioChoiceScreen.Choice("limited","仅已选范围","依赖构件保持保护；若结果需要联动它们，将拒绝该修订"),new StudioChoiceScreen.Choice("dependents","包含依赖构件",String.join(", ",related)+" · 下一步仍需确认全部范围和模型调用")),"limited",value->confirmSceneRefinement(visual,value.equals("dependents"))));
        else confirmSceneRefinement(visual,false);
    }
    private void confirmSceneRefinement(boolean visual,boolean includeDependents){
        var asset=projection().asset;if(asset==null||designSources==null||!asset.revision.equals(designRevision))return;
        final String selected=selectedComponent,world=projection().key();var scope=designRevisionScope(includeDependents);var regions=scope.getAsJsonArray("regions");
        var request=new JsonObject();request.addProperty("key",UUID.randomUUID().toString());request.addProperty("agent",selectedAgent);request.addProperty("model",modelLabel());request.addProperty("effort",selectedEffort);request.addProperty("generationMode","scene");request.addProperty("maxRepairs",0);request.addProperty("prompt",description);request.addProperty("baseJobId",asset.revision);request.addProperty("baseHash",asset.hash);request.add("sceneScope",scope);if(selectedAgent.equals("deepseek")&&outputBudget>0)request.addProperty("maxOutputTokens",outputBudget);
        String scopeText=selectedInstance>=0?"仅第 "+(selectedInstance+1)+" 个重复实例；必要时创建私有模块，不改其他楼层。":sharedModuleRevision?"允许修改共享模块及全部同类消费者。":"整个构件；不允许修改共享模块定义。";
        Runnable confirm=()->client.setScreen(new StudioInfoScreen(this,"确认局部精修 · 1 次模型调用","模型："+request.get("model").getAsString()+"\n构件："+selected+"\n"+scopeText+"\n已解锁："+scope.get("components")+"\n实际范围 "+regions.size()+" 处；其他构件和未选实例受保护。\n依赖范围："+(includeDependents?"已明确包含依赖构件":"不扩大")+"。重叠实例不能单独拆改。\n\n"+(visual?"发送当前资产四视角，绝不抓取世界/桌面。":"仅文本反馈；此步骤不会宣称模型看过图像。")+"\n\n修改要求："+description+"\n\n最多调用 1 次，0 自动修复。编译/范围校验在本地完成。超范围的结果会被拒绝，原版保留。输出预算跟随来源，或使用你已选自定义预算。","确认精修（1 次）",false,()->{client.setScreen(this);if(!idle()||projection().asset!=asset||!world.equals(projection().key())){fail(new IllegalStateException("建筑或世界已变化，精修未提交"));return;}submitRequest(request,false);}));
        if(visual)client.setScreen(new StudioVisualCaptureScreen(this,asset,images->{request.add("reviewImages",images);confirm.run();},StudioScreen::fail));else confirm.run();
    }
    private static void toggleComparison(){
        if(!idle()||compareOriginal==null||compareRevised==null||projection().asset==null)return;
        var next=projection().asset.hash.equals(compareRevised.hash)?compareOriginal:compareRevised;projection().loadComparison(next);designSources=null;designRevision=null;selectedComponent=null;
        tell(next==compareOriginal?"正在查看原版":"正在查看新版","保持面板相机；当前版本哈希 "+next.hash+"\n预览切换不是建造许可；需重新定位确认。",StudioTheme.ACCENT);
    }
    private void visualReview(){
        if(!idle()||!supportsVisualReview()||projection().asset==null)return;
        if(projection().asset.sceneDesign){sceneRefinement(true);return;}
        var asset=projection().asset;String scope=projection().key();JsonObject req=new JsonObject();req.addProperty("key",UUID.randomUUID().toString());req.addProperty("agent","codex");req.addProperty("model",modelLabel());req.addProperty("prompt",description);req.addProperty("baseJobId",asset.revision);req.addProperty("baseHash",asset.hash);req.addProperty("maxRepairs",0);req.addProperty("generationMode","single");if(!selectedEffort.equals("default"))req.addProperty("effort",selectedEffort);
        client.setScreen(new StudioVisualCaptureScreen(this,asset,images->{
            req.add("reviewImages",images);client.setScreen(visualConfirmation(this,req.get("model").getAsString(),()->{client.setScreen(this);if(!idle()||projection().asset!=asset||!scope.equals(projection().key())){fail(new IllegalStateException("建筑或世界已变化，未提交精修"));return;}submitRequest(req,false);}));
        },StudioScreen::fail));
    }
    private static StudioInfoScreen visualConfirmation(Screen parent,String model,Runnable action){return new StudioInfoScreen(parent,"确认看图精修 · 会使用模型额度","模型："+model+"\n最多调用：1 次；自动修复：0\n\n发送当前建筑的 4 张专用视图和原始建筑数据，不包含游戏世界、界面、玩家或桌面。模型将根据描述改进建筑比例、材质和细节，原版本保留。\n\n这不是自动完成的免费步骤。关闭此页不会调用模型。","确认精修（1 次）",false,action);}
    private static boolean stagedJob(JsonObject job){return StudioCheckpoints.job(job)||StudioAssembly.job(job);}
    private static String stagedDetails(JsonObject job){return StudioCheckpoints.details(job)+StudioAssembly.details(job);}
    private static boolean failedRepairCandidate(JsonObject job){return "failed".equals(string(job,"state",""))&&job.has("preflight")&&job.get("preflight").isJsonObject()&&"scene".equals(string(job.getAsJsonObject("preflight"),"mode",""))&&!stagedJob(job)&&!StudioReferenceHistory.reference(job)&&!job.has("baseJobId")&&!job.has("revalidatedFrom");}
    private void repairFailedScene(String id){
        if(!idle()||model()==null)return;
        var request=new JsonObject();request.addProperty("key",UUID.randomUUID().toString());request.addProperty("agent",selectedAgent);request.addProperty("model",modelLabel());request.addProperty("effort",selectedEffort);request.addProperty("generationMode","scene");request.addProperty("maxRepairs",0);request.addProperty("repairJobId",id);
        request.addProperty("prompt","修正这份失败设计的编译问题，保留原始建筑任务、空间功能和设计意图；不通过缩小建筑、删除内饰或楼梯来绕过错误。");
        if(selectedAgent.equals("deepseek")&&outputBudget>0)request.addProperty("maxOutputTokens",outputBudget);if(client.world!=null)request.addProperty("worldHeight",client.world.getHeight());
        preflighting=true;String scope=projection().key();var originalAsset=projection().asset;Screen parent=this;
        tell("正在核对失败稿和预算…","只读取原稿、哈希和原始要求，尚未调用模型。",StudioTheme.MUTED);
        StudioClient.BRIDGE.request("GET","/v1/jobs/"+id+"/repair-context",null).thenCompose(context->{
            request.addProperty("repairSourceHash",context.get("sourceHash").getAsString());
            return StudioClient.BRIDGE.request("POST","/v1/preflight",request).thenApply(policy->{var pair=new JsonObject();pair.add("context",context);pair.add("policy",policy);return pair;});
        }).whenComplete((pair,error)->onClient(()->{
            preflighting=false;if(error!=null){fail(error);return;}if(client.currentScreen!=parent||!scope.equals(projection().key())||projection().asset!=originalAsset){tell("界面或建筑已变化，未提交修订","没有调用模型；请重新核对失败稿。",StudioTheme.MUTED);return;}
            client.setScreen(failedRepairConfirmation(parent,request,pair.getAsJsonObject("context"),pair.getAsJsonObject("policy"),()->{
                client.setScreen(parent);if(!idle()||!scope.equals(projection().key())||projection().asset!=originalAsset){fail(new IllegalStateException("世界、任务或建筑已变化，未提交修订"));return;}
                request.addProperty("repairConfirmed",true);submitRequest(request,false);
            }));
        }));
    }
    private static StudioInfoScreen failedRepairConfirmation(Screen parent,JsonObject request,JsonObject context,JsonObject policy,Runnable action){
        String budget=policy.get("maxOutputTokens").isJsonNull()?"跟随所选 Agent / 模型配置；模组不固定 token 上限":policy.get("maxOutputTokens").getAsString()+" 输出 tokens";
        var bounds=policy.getAsJsonObject("maximumBounds");String size=bounds.get("width").getAsString()+" × "+bounds.get("height").getAsString()+" × "+bounds.get("length").getAsString()+" 格（X×Y×Z）";
        String height=policy.get("minimumHeight").isJsonNull()?"未指定数字高度，保留原始功能要求":policy.get("minimumHeight").getAsString()+" 格";
        String details="模型："+request.get("model").getAsString()+"\n最多调用：1 次；自动修复/重试：0\n输出预算："+budget+"\n\n全文修订的新分支，不保证只改错误位置。\n成功后手动加载；当前建筑、投影和世界保留。\n\n原边界要求："+size+"\n实际高度下限："+height+"\n\n原始要求：\n"+context.get("originalPrompt").getAsString()+"\n\n原错误：\n"+context.get("error").getAsString()+StudioMessages.constructionFeedback(context)+"\n\n原失败任务："+context.get("jobId").getAsString()+"\n原稿哈希："+context.get("sourceHash").getAsString()+"\n\n将发送原始要求、完整失败稿、错误文字和可用的构造检查记录。此入口没有发送预览图片。\n\n不是受保护区域局部精修，结果须完整复查；原稿与失败记录保留。\n确认会使用账户额度；返回或关闭不调用模型。";
        return new StudioInfoScreen(parent,"确认修订失败稿 · 使用模型额度",details,"确认修订（1 次）",false,action);
    }
    JsonObject auditFailedRepairUi(boolean showFeedback){
        auditUi(Tab.HISTORY);var original=projection().asset;var savedTask=taskIdentity;
        var job=JsonParser.parseString("{\"state\":\"failed\",\"preflight\":{\"mode\":\"scene\"}}").getAsJsonObject();if(!failedRepairCandidate(job))throw new IllegalStateException("New failed draft not offered");job.addProperty("baseJobId","approved-base");if(failedRepairCandidate(job))throw new IllegalStateException("Scoped failure offered full-draft repair");
        var request=new JsonObject();request.addProperty("model","deepseek-flash · 离线 UI 测试");var context=new JsonObject();context.addProperty("jobId","failed-fixture");context.addProperty("sourceHash","a".repeat(64));context.addProperty("originalPrompt","高224米的原创CBD办公楼；保持核心筒与全部办公层通行。");context.addProperty("error","core_doors_tower / module core_doors / node door_a: door component size must be [1,2,1]");
        context.add("constructionFeedback",JsonParser.parseString("""
            {"issueCount":2,"checksComplete":true,"truncated":false,"issues":[
              {"code":"component-bounds","component":"podiumSouthLobby","origin":[10,0,98],"size":[52,9,4],"bounds":[64,240,64],"frame":{"parentOrigin":[4,0,48],"anchorDelta":[0,0,0],"offset":[6,0,50]}},
              {"code":"module-local-bounds","component":"readingDesks","module":"carrel","node":"screen","origin":[0,2,0],"size":[3,2,1],"bounds":[3,3,2]}
            ]}
            """));
        var policy=JsonParser.parseString("{\"maxOutputTokens\":null,\"maximumBounds\":{\"width\":64,\"height\":240,\"length\":64},\"minimumHeight\":224}").getAsJsonObject();
        var confirmation=failedRepairConfirmation(this,request,context,policy,()->{throw new IllegalStateException("Repair fixture must not call a model");});
        client.setScreen(confirmation);confirmation.keyPressed(GLFW.GLFW_KEY_ENTER,0,0);if(client.currentScreen!=this)throw new IllegalStateException("Repair Enter did not return safely");client.setScreen(confirmation);
        if(showFeedback)confirmation.auditScrollTo("构造静态检查");
        for(var child:confirmation.children())if(child instanceof net.minecraft.client.gui.widget.ClickableWidget w&&(w.getX()<0||w.getY()<0||w.getX()+w.getWidth()>confirmation.width||w.getY()+w.getHeight()>confirmation.height))throw new IllegalStateException("Repair confirmation outside viewport");
        try{taskIdentity=new JsonObject();taskIdentity.addProperty("repairJobId","failed-fixture");completePreviewReady("repaired-fixture");if(projection().asset!=original)throw new IllegalStateException("Repair completion replaced original projection");}finally{taskIdentity=savedTask;}
        var result=new JsonObject();result.addProperty("tab",showFeedback?"failed-repair-feedback":"failed-repair-confirmation");result.addProperty("defaultEnterReturnsWithoutCalling",true);result.addProperty("scopedFailureNotEligible",true);result.addProperty("completionPreservesProjection",true);result.addProperty("noGenerationSubmitted",true);return result;
    }
    JsonObject auditVisualReview(){
        auditUi(Tab.CREATE);var savedModels=models;String savedAgent=selectedAgent,savedModel=selectedModel;
        try{models=JsonParser.parseString("[{\"id\":\"vision-fixture\",\"supportsImages\":true},{\"id\":\"text-fixture\"}]").getAsJsonArray();selectedAgent="codex";selectedModel="vision-fixture";if(!supportsVisualReview())throw new IllegalStateException("Vision capability not accepted");selectedAgent="deepseek";if(supportsVisualReview())throw new IllegalStateException("Unsupported provider accepted");selectedAgent="codex";selectedModel="text-fixture";if(supportsVisualReview())throw new IllegalStateException("Unknown image capability accepted");}finally{models=savedModels;selectedAgent=savedAgent;selectedModel=savedModel;}
        var confirmation=visualConfirmation(this,"vision-fixture · 隔离测试",()->{throw new IllegalStateException("Visual refinement must not submit on default Enter");});client.setScreen(confirmation);confirmation.keyPressed(GLFW.GLFW_KEY_ENTER,0,0);if(client.currentScreen!=this)throw new IllegalStateException("Visual confirmation must return by default");client.setScreen(confirmation);
        for(var child:confirmation.children())if(child instanceof net.minecraft.client.gui.widget.ClickableWidget w&&(w.getX()<0||w.getY()<0||w.getX()+w.getWidth()>confirmation.width||w.getY()+w.getHeight()>confirmation.height))throw new IllegalStateException("Visual confirmation outside viewport");
        var report=new JsonObject();report.addProperty("tab","visual-refinement");report.addProperty("capabilityGated",true);report.addProperty("defaultEnterReturnsWithoutCalling",true);report.addProperty("noGenerationSubmitted",true);return report;
    }
    private static void defaultEffort(){String preferred=model()==null?"default":string(model(),"defaultEffort","default");selectedEffort=efforts().contains(preferred)?preferred:efforts().get(0);}
    private static boolean canSelectProviderRecovery(){return agentReady&&model()!=null&&StudioProviderRecovery.canSelect(selectedAgent,selectedModel,selectedEffort,efforts());}
    private static List<String> efforts(){var m=model();if(m==null||!m.has("efforts"))return List.of("default");List<String> result=new ArrayList<>();for(var e:m.getAsJsonArray("efforts"))result.add(e.isJsonObject()?e.getAsJsonObject().get("reasoningEffort").getAsString():e.getAsString());return result.isEmpty()?List.of("default"):result;}
    private void cycleAssemblyQuality(){
        if(!idle())return;
        assemblyQualityVersion=assemblyQualityVersion%4+1;
        if(assemblyQualityVersion!=4)assemblyCompletionReserve=false;
        if(assemblyQualityVersion>=3){assemblyImageReview=true;assemblyCalls=Math.max(7,assemblyCalls);}
        if(assemblyQualityVersion!=4&&!assemblyPrototypeMode.equals("off")){
            assemblyPrototypeMode="off";
            tell("已关闭原型流程","原型只支持 v4；切回 v4 后须重新明确选择。没有提交任务或调用模型。",StudioTheme.MUTED);
        }
        // Labels alone cannot add/remove the v4-only prototype row. Rebuild
        // the normal sidebar, retaining its prompt, settings and clamped scroll.
        clearAndInit();
    }
    private void toggleCompletionReserve(){
        if(!idle()||!generationMode.equals("components")||!qualityTier.equals("ultra")||assemblyQualityVersion!=4||!assemblyPrototypeMode.equals("staged"))return;
        assemblyCompletionReserve=!assemblyCompletionReserve;
        tell(assemblyCompletionReserve?"新任务收尾预留已开启":"新任务恢复旧收尾策略",assemblyCompletionReserve?StudioCompletionReserve.WARNING:"仅改变下一次新任务的预检设置；旧任务不变，没有调用模型或修改世界。",StudioTheme.WARN);
    }
    private void chooseModel(){List<StudioChoiceScreen.Choice> choices=new ArrayList<>();for(var entry:models){var m=entry.getAsJsonObject();String id=m.get("id").getAsString();choices.add(new StudioChoiceScreen.Choice(id,id,string(m,"name",id)));}client.setScreen(new StudioChoiceScreen(this,"选择制作模型",choices,selectedModel,id->{selectedModel=id;defaultEffort();}));}
    private void chooseEffort(){var choices=efforts().stream().map(e->new StudioChoiceScreen.Choice(e,StudioMessages.effort(e)+" · "+e,"所选模型支持的推理选项；不是生成质量或速度保证")).toList();client.setScreen(new StudioChoiceScreen(this,"选择推理级别",choices,selectedEffort,e->selectedEffort=e));}
    private void chooseOutputBudget(){var m=model();String configured=m!=null&&m.has("configuredOutputBudget")&&!m.get("configuredOutputBudget").isJsonNull()?m.get("configuredOutputBudget").getAsString():"由 Harness 决定";client.setScreen(new StudioOutputBudgetScreen(this,outputBudget,configured,v->outputBudget=v));}
    private void chooseGenerationMode(){client.setScreen(new StudioChoiceScreen(this,"生成方式与调用次数",List.of(new StudioChoiceScreen.Choice("components","组件化制作 · lite / pro / max / ultra","整体设计 → 分组件拼装 → 文本复核；调用总上限单独确认"),new StudioChoiceScreen.Choice("single","原有完整建筑 · 1 次","保留兼容入口；自动修复预算另计"),new StudioChoiceScreen.Choice("scene","实验设计层 · 1 次 + 本地编译","通用体块/立面/模块/楼梯；0 自动修复，质量待真实评审"),new StudioChoiceScreen.Choice("checkpoints","实验设计检查点 · 最多 2–4 次","布局 → 编译反馈 → 细化；纠错包含在总预算内，只有新设计可用"),new StudioChoiceScreen.Choice("layered","原有外壳 → 内饰 · 最多 2 次","任一阶段失败即停止，完整合并校验后才可预览")),generationMode,v->{generationMode=v;if(!v.equals("single"))repairBudget=0;if(!v.equals("components")){assemblyProviderRecovery=false;assemblyCompletionReserve=false;}}));}
    private static int assemblyPackageLimit(){return assemblyPrototypeMode.equals("staged")?StudioAssembly.stagedPackageLimit(assemblyCalls):Math.min(StudioAssembly.tier(qualityTier).maxPackages(),assemblyCalls-(assemblyQualityVersion>=3?5:3));}
    private void choosePrototypeWorkflow(){
        List<StudioChoiceScreen.Choice> choices=new ArrayList<>();
        choices.add(new StudioChoiceScreen.Choice("off","关闭 · 保留原流程","不增加原型阶段；已有任务的协议不变"));
        if(supportsVisualReview()){
            choices.add(new StudioChoiceScreen.Choice("verified","旧版原型 · 整组制作 / 看图 / 展开","旧版 verified v1 协议；仍保留整栋深化和最终复核"));
            if(qualityTier.equals("ultra"))choices.add(new StudioChoiceScreen.Choice("staged","分阶段原型 · Ultra 实验","3 次独立概念、差量蓝图、4 次角色原型；新任务使用代表选层 v1，以首次实际展开几何固定比较楼层，无代表时披露；不是质量或通行认证。选择后预算至少 22 次，生成前明确确认。例如 "+StudioAssembly.stagedBudgetSummary(StudioAssembly.tier(qualityTier).maximumCalls())+"；以所选预算为准"));
        }
        client.setScreen(new StudioChoiceScreen(this,"v4 · 原型流程（明确选择）",choices,assemblyPrototypeMode,v->{assemblyPrototypeMode=v;if(v.equals("staged"))assemblyCalls=Math.max(22,assemblyCalls);else assemblyCompletionReserve=false;}));
    }
    private void chooseQualityTier(){client.setScreen(new StudioChoiceScreen(this,"组件化 · 制作精度",StudioAssembly.tiers().stream().map(t->new StudioChoiceScreen.Choice(t.id(),t.id()+" · "+t.maxPackages()+" 任务 / "+t.reviewRounds()+" 轮 / ≤"+t.maximumCalls()+" 次",t.description())).toList(),qualityTier,StudioScreen::selectAssemblyTier));}
    private void chooseAssemblyCalls(){List<StudioChoiceScreen.Choice> choices=new ArrayList<>();var t=StudioAssembly.tier(qualityTier);int overhead=assemblyQualityVersion>=3?5:3;boolean staged=assemblyPrototypeMode.equals("staged");for(int n=staged?22:overhead+2;n<=t.maximumCalls();n++)choices.add(new StudioChoiceScreen.Choice(Integer.toString(n),"最多 "+n+" 次底层调用"+(n==t.maximumCalls()?" · 档位默认":""),staged?StudioAssembly.stagedBudgetSummary(n):"最多 "+Math.min(t.maxPackages(),n-overhead)+" 个制作任务；所有阶段均在总预算内"));client.setScreen(new StudioChoiceScreen(this,qualityTier+" · 调用总上限",choices,Integer.toString(assemblyCalls),v->assemblyCalls=Integer.parseInt(v)));}
    private void chooseCheckpointCalls(){client.setScreen(new StudioChoiceScreen(this,"检查点 · 底层调用总上限",List.of(new StudioChoiceScreen.Choice("2","最多 2 次 · 布局 + 细化","不留纠错次数；布局失败立即停止"),new StudioChoiceScreen.Choice("3","最多 3 次 · 含 1 次纠错","纠错消耗同一总预算，仍须完成细化"),new StudioChoiceScreen.Choice("4","最多 4 次 · 含 2 次纠错","最多 4 次底层模型调用，每次可能计费；不是成功次数")),Integer.toString(checkpointCalls),v->checkpointCalls=Integer.parseInt(v)));}
    private static void refreshAgent(){
        if(discovering)return;discovering=true;String requestedAgent=selectedAgent;tell("正在检测 "+agentName()+" 和可用模型…","仅检查安装与登录状态，不调用模型生成。",StudioTheme.MUTED);
        StudioClient.BRIDGE.request("GET","/v1/agents/"+requestedAgent,null).thenCompose(r->{JsonObject a=null;for(var value:r.getAsJsonArray("agents"))if(requestedAgent.equals(string(value.getAsJsonObject(),"id","")))a=value.getAsJsonObject();if(a==null||!a.get("available").getAsBoolean())throw new IllegalStateException(a==null?"此配套未支持所选 Agent，请完整升级":string(a,"error",string(a,"state","Agent 不可用")));return StudioClient.BRIDGE.request("GET","/v1/agents/"+requestedAgent+"/models",null);}).whenComplete((r,e)->onClient(()->{
            discovering=false;if(!requestedAgent.equals(selectedAgent)){refreshAgent();return;}if(e!=null){agentReady=false;models=new JsonArray();fail(e);return;}agentReady=true;models=r.getAsJsonArray("models");
            if(requestedAgent.equals("claude")){selectedEffort="default";tell("Claude Code 已连接；请手动填写可用模型","实验接入，不虚构账户模型列表；真实 Claude 生成尚未验收。",StudioTheme.WARN);return;}
            if(selectedModel==null&&!models.isEmpty()){JsonObject preferred=models.get(0).getAsJsonObject();for(var m:models)if(m.getAsJsonObject().has("default")&&m.getAsJsonObject().get("default").getAsBoolean()){preferred=m.getAsJsonObject();break;}selectedModel=preferred.get("id").getAsString();defaultEffort();}
            if(model()==null&&!models.isEmpty()){tell("原模型已不可用，请重新选择模型","不会自动替换你之前选择的模型或提交新任务。",StudioTheme.WARN);return;}
            if(!efforts().contains(selectedEffort))defaultEffort();
            tell(models.isEmpty()?"Agent 没有返回模型":agentName()+" 已连接，选择模型后即可生成",requestedAgent.equals("deepseek")?"Harness 本机配置目录，不代表账号实时授权；生成才会访问模型服务。":"模型列表来自本机 Codex CLI。生成使用所选模型的账户额度。",models.isEmpty()?StudioTheme.WARN:StudioTheme.ACCENT);
        }));
    }
    private static JsonObject generationRequest(String key,boolean revise){
        var req=new JsonObject();req.addProperty("key",key);req.addProperty("sample",false);
        req.addProperty("agent",selectedAgent);req.addProperty("model",modelLabel());req.addProperty("maxRepairs",repairBudget);req.addProperty("generationMode",generationMode);if(selectedAgent.equals("deepseek")&&outputBudget>0)req.addProperty("maxOutputTokens",outputBudget);if(!selectedEffort.equals("default"))req.addProperty("effort",selectedEffort);req.addProperty("prompt",description);var world=MinecraftClient.getInstance().world;if(world!=null)req.addProperty("worldHeight",world.getHeight());
        if(revise){var a=projection().asset;if(a==null)throw new IllegalStateException("原修订资产已变化，请重新预检");req.addProperty("baseJobId",a.revision);req.addProperty("baseHash",a.hash);}
        if(generationMode.equals("checkpoints"))StudioCheckpoints.configure(req,checkpointCalls);
        if(generationMode.equals("components"))configureAssembly(req);return req;
    }
    private static boolean generationCurrent(JsonObject request,String scope){
        try{return agentReady&&model()!=null&&!description.isBlank()&&StudioGenerationConsent.matches(request,generationRequest(request.get("key").getAsString(),request.has("baseJobId")),scope,projection().key(),idle());}catch(Exception invalid){return false;}
    }
    private static void generate(boolean sample,boolean revise){
        if(!idle())return;if(!sample&&(model()==null||description.isBlank()))return;
        if(revise&&Set.of("checkpoints","components").contains(generationMode)){fail(new IllegalArgumentException("检查点 / 组件化只用于新设计；修改现有建筑请使用原有修订或局部精修入口"));return;}
        if(sample){var req=new JsonObject();req.addProperty("key",UUID.randomUUID().toString());req.addProperty("sample",true);submitRequest(req,true);return;}
        final JsonObject req;try{req=generationRequest(UUID.randomUUID().toString(),revise);}catch(IllegalArgumentException|IllegalStateException invalid){fail(invalid);return;}
        preflighting=true;var c=MinecraftClient.getInstance();Screen parent=c.currentScreen;String scope=projection().key();
        tell("正在本地预检尺寸和调用预算…","尚未调用模型，也没有创建生成任务。",StudioTheme.MUTED);
        ("native".equals(string(req,"assemblyDesignReview",""))?StudioNativeEvidence.ready():java.util.concurrent.CompletableFuture.completedFuture(new JsonObject())).thenCompose(ready->StudioClient.BRIDGE.request("POST","/v1/preflight",req)).whenComplete((policy,error)->onClient(()->{
            preflighting=false;if(error!=null){fail(error);return;}if(c.currentScreen!=parent||!generationCurrent(req,scope)){tell("界面、世界或制作设置已变化，未提交生成","再次点击生成后重新检查；没有调用模型。",StudioTheme.MUTED);return;}
            if("components".equals(string(req,"sceneWorkflow",""))){
                try{c.setScreen(assemblyConfirmation(parent,req,policy,()->{if(!generationCurrent(req,scope)){fail(new IllegalStateException("世界、模型、推理或制作设置变化，请重新预检"));c.setScreen(parent);return;}c.setScreen(parent);req.addProperty("assemblyConfirmed",true);submitRequest(req,false);}));}catch(Exception invalid){fail(invalid);}return;
            }
            if("checkpoints".equals(string(req,"sceneWorkflow",""))){
                try{c.setScreen(checkpointConfirmation(parent,req,policy,()->{if(!generationCurrent(req,scope)){fail(new IllegalStateException("世界或制作设置变化，请重新预检"));c.setScreen(parent);return;}c.setScreen(parent);req.addProperty("checkpointConfirmed",true);submitRequest(req,false);}));}catch(Exception invalid){fail(invalid);}return;
            }
            String height=policy.get("minimumHeight").isJsonNull()?"未识别到明确数字高度，以描述为准":policy.get("minimumHeight").getAsInt()+" 格起，保持 1∶1，不自动缩小";
            String budget=policy.get("maxOutputTokens").isJsonNull()?"跟随 Harness / 所选 Agent 与模型配置；模组不指定 token 上限，不估算费用":policy.get("maxOutputTokens").getAsString()+" tokens / 每次"+(policy.get("totalOutputTokenLimit").isJsonNull()?"":"；最多 "+policy.get("totalOutputTokenLimit").getAsString()+" 输出 tokens")+"（非费用估算，服务端验证是否支持）";
            String detail="模型："+req.get("model").getAsString()+"\n方式："+(policy.get("mode").getAsString().equals("scene")?"实验设计层：一次设计 + 本地编译（不计模型调用）":policy.get("mode").getAsString().equals("layered")?"外壳 → 内饰与楼梯":"单次完整建筑")+"\n最多调用："+policy.get("maximumCalls").getAsInt()+" 次（含允许的编译修复）\n预算："+budget+"\n目标高度："+height+"\n\n最高 384 格；总体积 ≤8,388,608 格、实体 ≤1,000,000 格。放置还需满足当前维度的顶/底高度。\n\n"+policy.get("warnings").toString()+"\n\n确认会使用所选账户额度。失败不自动续写；原建筑和世界保留。";
            c.setScreen(new StudioInfoScreen(parent,"确认生成预算",detail,"确认并生成",false,()->{if(!generationCurrent(req,scope)){fail(new IllegalStateException("世界或制作设置变化，请重新预检"));c.setScreen(parent);return;}c.setScreen(parent);submitRequest(req,false);}));
        }));
    }
    private static StudioInfoScreen checkpointConfirmation(Screen parent,JsonObject request,JsonObject policy,Runnable action){return new StudioInfoScreen(parent,"确认检查点总预算",StudioCheckpoints.confirmation(request,policy),"确认 · 最多 "+request.get("checkpointCalls").getAsInt()+" 次",false,action);}
    private static StudioInfoScreen assemblyConfirmation(Screen parent,JsonObject request,JsonObject policy,Runnable action){return new StudioInfoScreen(parent,"确认组件化预算 · "+request.get("qualityTier").getAsString(),StudioAssembly.confirmation(request,policy),"确认 · 最多 "+request.get("assemblyCalls").getAsInt()+" 次",false,action);}
    static void importBundle(String directory){if(!idle())return;JsonObject req=new JsonObject();req.addProperty("key",UUID.randomUUID().toString());req.addProperty("importDirectory",directory);submitRequest(req,true);}
    private static void submitRequest(JsonObject req,boolean sample){
        submitting=true;pendingPreview=null;pendingKey=req.get("key").getAsString();taskIdentity=new JsonObject();taskIdentity.addProperty("key",pendingKey);taskIdentity.addProperty("state","submitting");taskIdentity.addProperty("sample",sample);taskIdentity.addProperty("worldScope",projection().key());
        taskIdentity.addProperty("agent",selectedAgent);
        if(req.has("model"))taskIdentity.add("model",req.get("model"));if(req.has("baseJobId"))taskIdentity.add("baseJobId",req.get("baseJobId"));
        if(req.has("repairJobId"))taskIdentity.add("repairJobId",req.get("repairJobId"));
        try{taskIdentity.addProperty("requestHash",dev.voxelstudio.Asset.sha(dev.voxelstudio.Asset.canonical(req).getBytes(java.nio.charset.StandardCharsets.UTF_8)));}catch(Exception e){submitting=false;pendingKey=null;fail(e);return;}
        tell("正在保存任务身份并提交…","先保存幂等身份，再发出唯一一次请求。连接失败时只查询原任务，不自动重发。",StudioTheme.WARN);
        STATE.task(taskIdentity).thenCompose(v->StudioClient.BRIDGE.request("POST","/v1/jobs",req)).whenComplete((r,e)->onClient(()->{submitting=false;if(e!=null){tell("提交回执暂未确认，正在自动查询原任务",StudioMessages.error(e)+"\n只查原身份，不会自动重发生成。",StudioTheme.WARN);return;}activeJob=r.get("id").getAsString();taskIdentity.addProperty("jobId",activeJob);saveTaskState("submitted");tell("任务已提交，可返回游戏等待","任务 "+activeJob+"\n不会因关闭面板重复提交。",StudioTheme.WARN);}));
    }
    private static void saveTaskState(String state){if(taskIdentity==null)return;taskIdentity.addProperty("state",state);STATE.task(taskIdentity).whenComplete((v,e)->{if(e!=null)onClient(()->fail(e));});}
    static void submitReference(JsonObject prepared,String world){
        var generation=prepared.getAsJsonObject("generation");if(!referenceGenerationCurrent(generation,world)){fail(new IllegalStateException("参考图原请求/世界已变化；未发送"));return;}
        final JsonObject envelope=ReferencePreparationReceipt.send(prepared);
        submitting=true;pendingPreview=null;pendingKey=ReferencePreparationReceipt.text(prepared,"ownerId");taskIdentity=new JsonObject();
        taskIdentity.addProperty("key",pendingKey);taskIdentity.addProperty("state","submitting");taskIdentity.addProperty("sample",false);taskIdentity.addProperty("worldScope",world);taskIdentity.addProperty("agent","codex");
        taskIdentity.add("model",prepared.get("model"));taskIdentity.addProperty("requestHash",ContextReceipt.jsonHash(envelope));taskIdentity.add("referencePreparationHash",prepared.get("preparationHash"));
        taskIdentity.add("referenceSetHash",prepared.get("referenceSetHash"));taskIdentity.addProperty("referencePolicyHash",ContextReceipt.jsonHash(prepared.get("policy")));
        tell("正在保存原图片任务身份，再执行唯一 SEND…","图片、模型、原请求和预算已准确确认；不写入世界。连接回执未知时只查原 key。",StudioTheme.WARN);
        var original=taskIdentity.deepCopy();
        STATE.task(original).thenCompose(ignored->StudioClient.BRIDGE.request("POST","/v1/reference-generation-jobs",envelope)).whenComplete((job,error)->onClient(()->{
            submitting=false;if(error!=null){tell("参考图 SEND 回执暂未确认，查询原任务",StudioMessages.error(error)+"\n原身份保留，不重发模型调用。",StudioTheme.WARN);return;}
            try{ReferencePreparationReceipt.verifyOriginalJob(original,job);activeJob=job.get("id").getAsString();taskIdentity.addProperty("jobId",activeJob);saveTaskState("submitted");referenceDraft=new ReferenceImageDraft();
                tell("参考图任务已提交，可返回游戏等待","任务 "+activeJob+"\n关闭图片页或工作室不影响原任务；完成只加载投影。",StudioTheme.WARN);
            }catch(Exception invalid){fail(invalid);}
        }));
    }
    private static void recoverTask(){
        if(recovering||submitting||loading)return;recovering=true;
        STATE.task().whenComplete((saved,error)->onClient(()->{
            if(error!=null){recovering=false;tell("任务身份文件无法读取；未重新提交",StudioMessages.error(error)+"\n请保留原文件并检查备份。",StudioTheme.ERROR);pendingKey="unreadable";return;}
            if(saved==null||!StudioTaskRecovery.querySavedState(string(saved,"state",""))){recovering=false;if(activeJob==null)pendingKey=null;return;}
            taskIdentity=saved;pendingKey=string(saved,"key","");if(!pendingKey.matches("[\\w-]{1,128}")){recovering=false;fail(new IllegalStateException("Invalid saved task key; original preserved"));return;}
            // Exact lookup remains bounded even with years of large assembly job history.
            String lookupKey=pendingKey;
            StudioClient.BRIDGE.lookupOriginalTask(lookupKey).whenComplete((result,e)->onClient(()->{
                recovering=false;if(e!=null){fail(e);return;}
                if(!lookupKey.equals(pendingKey))return;
                var job=result.job();
                if(result.pendingReferenceSubmission()){tell("原参考图 SEND 已持久保存，尚未发布生成任务",(result.error()==null?"本机正在恢复原提交；稍后继续查询。":result.error())+"\n只查询原 key，不重新发送、替换图片或新建模型任务。",StudioTheme.WARN);return;}
                if(job!=null&&taskIdentity.has("referencePreparationHash")){try{ReferencePreparationReceipt.verifyOriginalJob(taskIdentity,job);}catch(Exception invalid){fail(invalid);return;}}
                if(job!=null){activeJob=job.get("id").getAsString();taskIdentity.addProperty("jobId",activeJob);saveTaskState("recovered-query");tell("已找回原任务，正在查询状态","没有重新提交生成。",StudioTheme.ACCENT);return;}
                tell("未找到原任务，未自动重发","任务身份已保留。可重连后再次查询，或明确归档；新生成可能重复计费。",StudioTheme.WARN);
            }));
        }));
    }
    private static void cancelGeneration(){
        if(activeJob==null||cancelling)return;cancelling=true;String id=activeJob;
        tell("正在请求取消…","已完成的版本保留；只有 Bridge 返回终态才确认取消完成。",StudioTheme.WARN);
        StudioClient.BRIDGE.request("POST","/v1/jobs/"+id+"/cancel",null).whenComplete((r,e)->onClient(()->{cancelling=false;if(!id.equals(activeJob))return;if(e!=null)tell("暂时无法确认取消，请查询原任务",StudioMessages.error(e),StudioTheme.ERROR);else tell("已请求取消，等待任务结束","已完成的历史版本会保留。",StudioTheme.WARN);}));
    }
    public static void backgroundTick(){
        if(!testMode()){
            if(!recoveryAttempted&&MinecraftClient.getInstance().player!=null){recoveryAttempted=true;recoverTask();}
            if(!discoveryAttempted&&MinecraftClient.getInstance().player!=null)startLocalDiscovery(false);
            else if(localScanActive&&!localScanPending&&++localScanTicks%20==0)pollLocalDiscovery(false);
        }
        if(++recoveryTicks%100==0&&!submitting&&!preflighting&&!recovering&&!loading&&activeJob==null){
            if(pendingKey!=null&&pendingKey.matches("[\\w-]{1,128}"))recoverTask();
            else if(pendingPreview!=null&&!projection().busy)completePreviewReady(pendingPreview);
        }
        if(activeJob==null||polling||++polls%20!=0)return;polling=true;String id=activeJob;
        StudioClient.BRIDGE.request("GET","/v1/jobs/"+id,null).whenComplete((r,e)->onClient(()->{
            polling=false;if(!id.equals(activeJob))return;if(e!=null){fail(e);return;}
            StudioNativeEvidence.observe(r);
            String state=r.get("state").getAsString();String stage=StudioAssembly.job(r)?StudioAssembly.progress(r):StudioCheckpoints.job(r)?StudioCheckpoints.progress(r):r.has("stage")&&r.has("stageCount")&&r.get("stageCount").getAsInt()==2?" · 阶段 "+r.get("stage").getAsString()+"/2（"+(r.get("stage").getAsInt()==1?"外壳":"内饰与楼梯")+"）":"";tell(StudioMessages.state(state)+stage,"任务 "+id+"\n"+StudioMessages.state(state)+stage+stagedDetails(r)+(r.has("attempt")&&!stagedJob(r)?"\n编译修复尝试："+r.get("attempt").getAsString():""),StudioTheme.WARN);
            if(state.equals("preview-ready")){saveTaskState("awaiting-preview");activeJob=null;pendingKey=null;pendingPreview=id;completePreviewReady(id);}else if(Set.of("failed","cancelled","interrupted").contains(state)){saveTaskState(state);activeJob=null;pendingKey=null;String error=string(r,"error",StudioMessages.state(state));tell(state.equals("failed")?"生成未通过："+StudioMessages.errorSummary(error):StudioMessages.state(state),"任务 "+id+"\n模型 "+string(r,"model","本地校验")+"\n"+error+stagedDetails(r)+StudioMessages.constructionFeedback(r)+"\n原建筑仍保留；没有修改世界，失败后不会继续调用模型。",state.equals("failed")?StudioTheme.ERROR:StudioTheme.MUTED);}
        }));
    }
    private static void completePreviewReady(String id){
        if(taskIdentity!=null&&taskIdentity.has("repairJobId")){
            pendingPreview=null;saveTaskState("preview-ready");
            tell("失败稿修订分支已生成，请到历史页复查","任务 "+id+"\n这是完整新稿，不保证局部变化。当前建筑和投影未替换，世界未改动。",StudioTheme.ACCENT);
            if(MinecraftClient.getInstance().currentScreen instanceof StudioScreen s&&s.tab==Tab.HISTORY)s.refreshHistory();
        }else if(taskIdentity!=null&&taskIdentity.has("worldScope")&&!taskIdentity.get("worldScope").getAsString().equals(projection().key())){
            tell("建筑已完成，等待返回原世界加载投影","没有修改当前世界；返回原世界后自动加载，也可从历史页手动选择。",StudioTheme.WARN);
        }else if(!loading&&!projection().busy&&!projection().restoring)loadAsset(id);
    }
    private static void loadAsset(String id){
        if(projection().busy)return;loading=true;int ticket=++loadTicket;String loadScope=projection().key();tell("正在加载已验证的建筑…","仅加载预览，不写入世界。",StudioTheme.WARN);
        StudioClient.BRIDGE.load(id).whenComplete((a,e)->onClient(()->{if(ticket!=loadTicket)return;loading=false;if(e!=null){
            Throwable cause=e;while(cause.getCause()!=null)cause=cause.getCause();
            if(id.equals(pendingPreview)&&cause instanceof java.io.IOException)tell("建筑已完成，连接恢复后自动加载投影",StudioMessages.error(e)+"\n只重新读取同一资产，不重新生成。",StudioTheme.WARN);
            else{if(id.equals(pendingPreview)){pendingPreview=null;saveTaskState("preview-load-failed");}fail(e);}return;
        }if(projection().busy||!loadScope.equals(projection().key())){tell("世界或操作状态变化，未替换当前建筑","返回原世界后可继续自动加载，也可在历史页选择。",StudioTheme.WARN);return;}
            boolean comparison=taskIdentity!=null&&taskIdentity.has("baseJobId")&&projection().asset!=null&&taskIdentity.get("baseJobId").getAsString().equals(projection().asset.revision);
            if(comparison){compareOriginal=projection().asset;compareRevised=a;projection().loadComparison(a);}else projection().load(a);
            if(id.equals(pendingPreview)){pendingPreview=null;saveTaskState("preview-ready");}
            designSources=null;designRevision=null;selectedComponent=null;
            tell((a.navigationAcknowledgementRequired?"建筑可预览 · 通行未验证 · ":"建筑已就绪 · ")+a.setCount+" 方块"+(a.validationNotes.isEmpty()?"":" · 有校验提示，请查看详情"),a.id+"\n尺寸 "+a.width+" × "+a.height+" × "+a.length+"\n版本 "+a.revision+"\n哈希 "+a.hash+"\n"+a.validationNotes+(a.sceneDesign?"\n实验设计层 · 设计提示：\n"+a.designDiagnostics:""),a.validationNotes.isEmpty()&&!a.navigationAcknowledgementRequired?StudioTheme.ACCENT:StudioTheme.WARN);
            if(MinecraftClient.getInstance().currentScreen instanceof StudioScreen s){s.syncCoordinates();if(s.tab==Tab.HISTORY)s.refreshHistory();}
        }));
    }
    private void refreshHistory(){
        if(historyLoading)return;historyLoading=true;
        StudioClient.BRIDGE.request("GET","/v1/jobs",null).whenComplete((r,e)->onClient(()->{historyLoading=false;if(e!=null){fail(e);return;}history=new JsonArray();for(var j:r.getAsJsonArray("jobs")){var job=j.getAsJsonObject();String state=job.get("state").getAsString();if(Set.of("preview-ready","failed").contains(state)||StudioReferenceHistory.terminal(job)||stagedJob(job)&&Set.of("cancelled","interrupted").contains(state))history.add(j);}var c=MinecraftClient.getInstance();if(c.currentScreen instanceof StudioScreen s&&s.tab==Tab.HISTORY)s.clearAndInit();}));
    }
    private void exportAsset(){
        var a=projection().asset;if(a==null)return;
        StudioClient.BRIDGE.request("POST","/v1/jobs/"+a.revision+"/export",null).whenComplete((r,e)->onClient(()->{if(e!=null){fail(e);return;}String file=r.get("file").getAsString();tell("已导出 .schem，详情中可复制路径",file+"\n\n外部 Schematic 中 keep 和 clear 都表示空气；粘贴时请核对导入器的空气策略。",StudioTheme.ACCENT);if(client.player!=null)client.player.sendMessage(Text.literal("已导出："+file),false);}));
    }
    public static void confirmPlacement(){
        if(StudioClient.PATCH_PREVIEW.preview()!=null){projection().status="当前为只读改造差异；先丢弃差异预览或明确切换建筑投影";return;}
        var c=MinecraftClient.getInstance();var p=projection();if(!p.canPlace()||taskBusy()){p.status=p.placementBlockReason();return;}
        Placement frozen=p.placement();String scope=p.key();Screen parent=c.currentScreen;
        checkingPlacement=true;tell("服务端正在复核实际放置区域…","只读检查，尚未写入世界。",StudioTheme.WARN);p.status="服务端正在复核实际放置区域…";
        dev.voxelstudio.PlacementService.check(c.getServer(),c.player.getUuid(),c.world.getRegistryKey().getValue(),frozen).whenComplete((check,error)->onClient(()->{
            checkingPlacement=false;if(error!=null){fail(error);p.status=StudioMessages.error(error);return;}
            if(c.currentScreen!=parent||!p.key().equals(scope)||p.transformRevision!=frozen.transformRevision()){p.status="界面、世界或投影变化，请重新确认";return;}
            String details="建筑："+frozen.asset().id+"\n尺寸："+frozen.width()+" × "+frozen.asset().height+" × "+frozen.length()+"\n锚点："+frozen.anchor().toShortString()+"\n方向："+frozen.rotation()*90+"°"+(frozen.mirror()?" · X 轴镜像":"")+"\n维度："+c.world.getRegistryKey().getValue()+"\n\n"+(frozen.replace()?"覆盖与挖空：会修改已有方块并清理室内。":"仅填空气：已有建筑和地形会保留。")+"\n服务端复核：新增 "+check.adds()+"，覆盖 "+check.replaces()+"，挖空 "+check.clears()+"，保留/不变 "+check.skips()+"。\n\n区域变化或检查超时后，此确认自动失效。确认后才会写入世界；请先备份。可停止后续批次、撤销直接修改，后续编辑会保留。\n\n版本："+frozen.asset().revision+"\n哈希："+frozen.asset().hash;
            if(!frozen.asset().validationNotes.isEmpty())details="建筑校验提示（请先核对预览）\n"+frozen.asset().validationNotes+"\n\n"+details;
            boolean review=frozen.asset().navigationAcknowledgementRequired;
            if(review)details="通行未验证\n可预览不代表楼梯和室内可走通；可能存在堵门、缺地板或断开的楼层。下方勾选仅同意本次当前资产与位置的风险，不修复建筑。\n\n"+details;
            c.setScreen(new StudioInfoScreen(parent,review?"确认建造 · 通行未验证":"确认建造 · 将修改世界",details,"确认建造",true,review,()->{c.setScreen(null);p.place(frozen,scope,check.token(),review);}));
        }));
    }
    private void confirmUndo(){client.setScreen(new StudioInfoScreen(this,"撤销上次建造？","只恢复仍与本工具写入结果一致的方块。\n\n玩家后续修改的方块会保留，并计为冲突。\n\n崩溃后缺少完成回执的批次需要人工核对，不会自动猜测。","确认撤销",true,()->{client.setScreen(this);projection().undo();}));}

    @Override public void render(DrawContext d,int mx,int my,float delta){
        d.fill(0,0,width,height,StudioTheme.BG);d.fill(8,11,11,32,StudioTheme.ACCENT);
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,dev.voxelstudio.StudioBrand.NAME,Math.max(0,width-90)),17,11,StudioTheme.TEXT,false);
        d.drawText(textRenderer,discovering?"正在检测本机 Agent…":!agentReady?"本机生成 · 先预览，再建造":agentName()+" 已连接 · 本机生成",17,25,StudioTheme.MUTED,false);
        var s=layout.sidebar();StudioTheme.panel(d,s.x(),s.y(),s.width(),s.height());renderSidebar(d,mx,my,delta);renderPreview(d,mx,my,delta);
        String context=tab==Tab.CREATE?modelLabel()+" · "+StudioMessages.effort(selectedEffort):tab==Tab.PLACE?(projection().replace?"覆盖与挖空 · 请先备份":"仅填空气 · 保留地形"):"仅导出当前选中的版本";
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,context,s.width()-18),s.x()+9,s.bottom()-42,tab==Tab.PLACE&&projection().replace?StudioTheme.WARN:StudioTheme.MUTED,false);
        for(var widget:fixed)widget.render(d,mx,my,delta);
        int limit=width-83;d.drawText(textRenderer,StudioTheme.fit(textRenderer,notice.summary,limit),12,height-30,notice.color,false);
        String secondary=notice.color==StudioTheme.ERROR?(projection().asset==null?"没有新的可用建筑；点击详情查看具体原因":"当前预览仍是原建筑："+projection().asset.id+"；不是本次失败结果"):tab==Tab.PLACE?projection().placementBlockReason():taskBusy()?"后台任务进行中 · 可关闭面板继续游戏":projection().status;
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,secondary,limit),12,height-17,StudioTheme.MUTED,false);
    }
    private void renderSidebar(DrawContext d,int mx,int my,float delta){
        var c=layout.content();d.enableScissor(c.x()-1,c.y(),c.right()+1,c.bottom());
        for(var line:labels){int y=c.y()+line.y-scroll;if(y>=c.y()&&y+9<=c.bottom())d.drawText(textRenderer,line.text,c.x(),y,line.color,false);}
        if(coordinates!=null)for(int i=0;i<3;i++)d.drawText(textRenderer,new String[]{"X","Y","Z"}[i],coordinates[i].getX(),coordinates[i].getY()-12,StudioTheme.MUTED,false);
        boolean inside=c.contains(mx,my);for(var r:rows)r.widget.render(d,inside?mx:-1000,inside?my:-1000,delta);d.disableScissor();
        int max=StudioLayout.maxScroll(contentHeight,c.height());if(max>0){int bar=Math.max(12,c.height()*c.height()/contentHeight);int y=c.y()+(c.height()-bar)*scroll/max;d.fill(c.right()+4,c.y(),c.right()+6,c.bottom(),StudioTheme.BORDER);d.fill(c.right()+4,y,c.right()+6,y+bar,StudioTheme.ACCENT);}
    }
    private void renderPreview(DrawContext d,int mx,int my,float delta){
        var r=layout.preview();var v=layout.viewport();var p=projection();StudioTheme.panel(d,r.x(),r.y(),r.width(),r.height());d.fill(v.x(),v.y(),v.right(),v.bottom(),0xff0c1822);
        d.enableScissor(v.x(),v.y(),v.right(),v.bottom());
        for(int x=v.x()+v.width()/2%20;x<v.right();x+=20)d.fill(x,v.y(),x+1,v.bottom(),0xff172733);
        for(int y=v.y()+v.height()/2%20;y<v.bottom();y+=20)d.fill(v.x(),y,v.right(),y+1,0xff172733);
        if(p.asset!=null){
            d.draw();float size=Math.max(Math.max(p.placement().width(),p.placement().length()),p.asset.height);float scale=Math.min(v.width(),v.height())*.68f/size*zoom;
            Matrix4f matrix=new Matrix4f(RenderSystem.getModelViewMatrix()).translate(v.x()+v.width()/2f+panX,v.y()+v.height()/2f+panY,150).scale(scale,-scale,scale).rotateX((float)Math.toRadians(pitch)).rotateY((float)Math.toRadians(yaw)).translate(-p.placement().width()/2f,-p.asset.height/2f,-p.placement().length()/2f);
            p.renderer.draw(matrix,RenderSystem.getProjectionMatrix(),.95f,p.materials,new Vec3d(0,200,-200));RenderSystem.disableDepthTest();
            drawDesignBounds(d,matrix);
            if(p.renderer.building)d.drawText(textRenderer,"正在准备方块网格…",v.x()+7,v.y()+7,StudioTheme.WARN,false);
            if(p.asset.navigationAcknowledgementRequired&&!p.renderer.building)d.drawText(textRenderer,"通行未验证 · 建造前须确认",v.x()+7,v.y()+7,StudioTheme.WARN,false);
            if(p.renderer.error!=null){d.fill(v.x()+4,v.y()+4,v.right()-4,v.y()+31,0xed3f202a);d.drawText(textRenderer,"预览加载失败",v.x()+8,v.y()+8,StudioTheme.ERROR,false);d.drawText(textRenderer,"请打开状态详情",v.x()+8,v.y()+20,StudioTheme.MUTED,false);}
        }else{
            String title=loading?"正在加载建筑…":"建筑将在这里出现";d.drawText(textRenderer,title,v.x()+(v.width()-textRenderer.getWidth(title))/2,v.y()+v.height()/2-13,StudioTheme.TEXT,false);
            String hint="生成或加载示例后预览";d.drawText(textRenderer,hint,v.x()+(v.width()-textRenderer.getWidth(hint))/2,v.y()+v.height()/2+3,StudioTheme.MUTED,false);
        }
        d.disableScissor();String summary=p.asset==null?"预览不会修改世界":p.placement().width()+" × "+p.asset.height+" × "+p.placement().length()+" · "+String.format(Locale.ROOT,"%,d",p.asset.setCount)+" 方块";
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,summary,r.width()-16),r.x()+8,v.bottom()+6,StudioTheme.TEXT,false);
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,"拖动旋转 · 右键平移 · 滚轮缩放",r.width()-16),r.x()+8,v.bottom()+19,StudioTheme.MUTED,false);
    }
    private void drawDesignBounds(DrawContext d,Matrix4f matrix){
        var p=projection();if(p.asset==null||designSources==null||!p.asset.revision.equals(designRevision)||selectedComponent==null)return;
        var regions=designRevisionScope(false).getAsJsonArray("regions");if(regions==null)return;
        for(var element:regions){var region=element.getAsJsonObject();var o=region.getAsJsonArray("origin");var s=region.getAsJsonArray("size");float minX=Float.POSITIVE_INFINITY,minY=minX,maxX=Float.NEGATIVE_INFINITY,maxY=maxX;
            for(int corner=0;corner<8;corner++){int x=o.get(0).getAsInt()+((corner&1)==0?0:s.get(0).getAsInt()-1),y=o.get(1).getAsInt()+((corner&2)==0?0:s.get(1).getAsInt()-1),z=o.get(2).getAsInt()+((corner&4)==0?0:s.get(2).getAsInt()-1);var local=p.placement().local(p.asset.index(x,y,z));var point=matrix.transformPosition(new org.joml.Vector3f(local.getX()+.5f,local.getY()+.5f,local.getZ()+.5f));minX=Math.min(minX,point.x);maxX=Math.max(maxX,point.x);minY=Math.min(minY,point.y);maxY=Math.max(maxY,point.y);}
            int x=(int)minX-2,y=(int)minY-2,w=Math.max(4,(int)(maxX-minX)+4),h=Math.max(4,(int)(maxY-minY)+4);d.fill(x,y,x+w,y+1,StudioTheme.WARN);d.fill(x,y+h-1,x+w,y+h,StudioTheme.WARN);d.fill(x,y,x+1,y+h,StudioTheme.WARN);d.fill(x+w-1,y,x+w,y+h,StudioTheme.WARN);
        }
        d.drawText(textRenderer,StudioTheme.fit(textRenderer,"构件范围："+selectedComponent+(selectedInstance>=0?" #"+(selectedInstance+1):sharedModuleRevision?" · 同类全部":""),layout.viewport().width()-14),layout.viewport().x()+7,layout.viewport().bottom()-15,StudioTheme.WARN,false);
    }
    @Override public boolean mouseClicked(double mx,double my,int button){
        var c=layout.content();if(button==0&&mx>=c.right()+2&&mx<c.right()+9&&my>=c.y()&&my<c.bottom()&&contentHeight>c.height()){scrollDrag=true;scrollAt(my);return true;}
        for(var w:fixed)if(w.mouseClicked(mx,my,button)){setFocused(w);setDragging(true);return true;}
        if(c.contains(mx,my))for(var r:rows)if(r.widget.mouseClicked(mx,my,button)){setFocused(r.widget);setDragging(true);return true;}
        setFocused(null);if(layout.viewport().contains(mx,my)&&(button==0||button==1)){previewDrag=button;return true;}return false;
    }
    private void scrollAt(double y){var c=layout.content();scroll=StudioLayout.clampScroll((int)((y-c.y())/c.height()*contentHeight-c.height()/2.0),contentHeight,c.height());layoutRows();}
    @Override public boolean mouseDragged(double mx,double my,int button,double dx,double dy){
        if(scrollDrag){scrollAt(my);return true;}if(previewDrag==0){yaw+=(float)dx;pitch=MathHelper.clamp(pitch+(float)dy,-85,85);return true;}
        if(previewDrag==1){panX=MathHelper.clamp(panX+(float)dx,-layout.viewport().width(),layout.viewport().width());panY=MathHelper.clamp(panY+(float)dy,-layout.viewport().height(),layout.viewport().height());return true;}
        return super.mouseDragged(mx,my,button,dx,dy);
    }
    @Override public boolean mouseReleased(double x,double y,int button){previewDrag=-1;scrollDrag=false;return super.mouseReleased(x,y,button);}
    @Override public boolean mouseScrolled(double mx,double my,double amount){
        if(layout.viewport().contains(mx,my)){zoom=MathHelper.clamp(zoom*(float)Math.pow(1.12,amount),.25f,5);return true;}
        if(layout.sidebar().contains(mx,my)){if(prompt!=null&&prompt.visible&&prompt.isMouseOver(mx,my)&&prompt.getContentsHeight()>prompt.getHeight()-8&&prompt.mouseScrolled(mx,my,amount))return true;scroll(-(int)(amount*26));return true;}return false;
    }
    @Override public boolean keyPressed(int key,int scan,int mods){
        boolean editing=getFocused() instanceof TextFieldWidget||getFocused() instanceof EditBoxWidget;
        if(key==GLFW.GLFW_KEY_ENTER&&hasControlDown()&&tab==Tab.CREATE){generate(false,false);return true;}
        if(!editing){if(key==GLFW.GLFW_KEY_T){projection().materials=!projection().materials;return true;}if(key==GLFW.GLFW_KEY_O){projection().opacity=projection().opacity>=.8f?.2f:projection().opacity+.15f;return true;}if(key==GLFW.GLFW_KEY_PAGE_DOWN||key==GLFW.GLFW_KEY_PAGE_UP){scroll((key==GLFW.GLFW_KEY_PAGE_DOWN?1:-1)*Math.max(30,layout.content().height()-18));return true;}}
        return super.keyPressed(key,scan,mods);
    }
    private static String helpText(){return "面板：Enter 换行；Ctrl+Enter 生成；滚轮滚动设置或缩放预览；右键拖动预览平移；T 切换材质；O 切换透明度。\n世界：滚轮沿视线推远/拉近；K 或 Enter 锁定后，滚轮沿面朝主轴微调；G 吸附准星表面；方向键移动 X/Z；PageUp/Down 升降；Ctrl 粗调；R 旋转；M 镜像；H 隐藏并恢复物品栏滚轮；锁定后 Enter 打开建造确认；V 返回面板。\n世界按键可在 Minecraft 控制设置中重新绑定。";}
    @Override public boolean shouldPause(){return false;}

    // Package-private assertions used only by the explicitly enabled development harness.
    JsonObject auditSceneUi(int variant)throws Exception{
        if(!net.fabricmc.loader.api.FabricLoader.getInstance().isDevelopmentEnvironment()||!Boolean.getBoolean("voxelstudio.uitest"))throw new IllegalStateException("Development only");
        var root=net.fabricmc.loader.api.FabricLoader.getInstance().getGameDir().resolve("../build/test-fixtures/"+(variant>=4?"scene-instance-study":"scene-courtyard")).normalize();
        var asset=new dev.voxelstudio.Asset("scene-ui-fixture",JsonParser.parseString(java.nio.file.Files.readString(root.resolve("manifest.json"))).getAsJsonObject(),java.nio.file.Files.readAllBytes(root.resolve("cells.bin")));projection().load(asset);
        designSources=JsonParser.parseString(java.nio.file.Files.readString(root.resolve("design-sources.json"))).getAsJsonObject();designRevision=asset.revision;selectedComponent=variant>=4?"desks":"pergola";selectedInstance=variant==4||variant==5?1:-1;sharedModuleRevision=variant==6||variant==7;generationMode="scene";repairBudget=0;
        var result=auditUi(Tab.CREATE);result.addProperty("tab",variant==0?"scene-component":variant==1?"scene-mode":variant>=8?"scene-instance-picker":variant>=6?"scene-shared-module":variant>=4?"scene-single-instance":"scene-scope-confirmation");result.addProperty("noGenerationSubmitted",true);
        if(variant==1)chooseGenerationMode();
        if(variant>=8){chooseInstanceScope();return result;}
        if(variant>=4){var chosen=designRevisionScope(false);if(sharedModuleRevision){if(!chosen.get("shared").getAsString().equals("all")||chosen.getAsJsonArray("components").size()!=2||chosen.getAsJsonArray("regions").size()!=6)throw new IllegalStateException("Shared scope missing consumers");result.addProperty("allConsumersExplicit",true);}else{if(chosen.getAsJsonArray("instances").get(0).getAsJsonObject().get("index").getAsInt()!=1||chosen.getAsJsonArray("regions").size()!=1||chosen.getAsJsonArray("protectedComponents").size()!=1)throw new IllegalStateException("Single instance scope widened");result.addProperty("onlySelectedInstance",true);}}
        if(variant>=2){var savedModels=models;var savedAgent=selectedAgent;var savedModel=selectedModel;boolean savedReady=agentReady;try{models=JsonParser.parseString("[{\"id\":\"offline-scene-fixture\"}]").getAsJsonArray();selectedAgent="deepseek";selectedModel="offline-scene-fixture";agentReady=true;sceneRefinement(false);}finally{models=savedModels;selectedAgent=savedAgent;selectedModel=savedModel;agentReady=savedReady;}var confirmation=client.currentScreen;if(!(confirmation instanceof StudioInfoScreen))throw new IllegalStateException("Missing scope confirmation");confirmation.keyPressed(GLFW.GLFW_KEY_ENTER,0,0);if(client.currentScreen!=this)throw new IllegalStateException("Default scope Enter must return without generation");client.setScreen(confirmation);result.addProperty("defaultEnterDoesNotCallModel",true);}
        return result;
    }
    static JsonObject auditAutomaticDiscovery(){
        if(!net.fabricmc.loader.api.FabricLoader.getInstance().isDevelopmentEnvironment()||!Boolean.getBoolean("voxelstudio.onboardingtest"))throw new IllegalStateException("Development only");
        var r=new JsonObject();r.addProperty("complete",discoveryAttempted&&!localScanActive&&!localScanPending);r.addProperty("available",localAgents.available());r.addProperty("multipleRequiresChoice",localAgents.available()>1&&!userSelectedAgent&&!agentReady);r.addProperty("preparation",StudioClient.BRIDGE.preparationStatus());
        var agents=new JsonArray();for(String id:AgentCatalog.IDS){var a=new JsonObject();a.addProperty("id",id);a.addProperty("state",localAgents.status(id).state());a.addProperty("available",localAgents.status(id).available());agents.add(a);}r.add("agents",agents);return r;
    }
    void auditAutomaticChooser(){auditAutomaticDiscovery();chooseAgent();}
    JsonObject auditClaudeUi(){
        if(!net.fabricmc.loader.api.FabricLoader.getInstance().isDevelopmentEnvironment()||!Boolean.getBoolean("voxelstudio.uitest"))throw new IllegalStateException("Development UI test only");
        selectedAgent="claude";userSelectedAgent=true;agentReady=false;models=new JsonArray();manualClaudeModel="fixture-model-not-for-generation";selectedEffort="default";tell("Claude Code · 仅 UI 测试数据","不进行真实生成",StudioTheme.MUTED);
        JsonObject result=auditUi(Tab.CREATE);scroll=210;layoutRows();result.addProperty("tab","claude-create");result.addProperty("fixtureOnly",true);return result;
    }
    JsonObject auditDeepseekUi(){
        if(!net.fabricmc.loader.api.FabricLoader.getInstance().isDevelopmentEnvironment()||!Boolean.getBoolean("voxelstudio.uitest"))throw new IllegalStateException("Development UI test only");
        selectedAgent="deepseek";userSelectedAgent=true;agentReady=false;models=new JsonArray();selectedModel=null;selectedEffort="off";tell("DeepSeek Harness · 仅 UI 测试数据","不会提交生成",StudioTheme.MUTED);
        var result=auditUi(Tab.CREATE);scroll=190;layoutRows();result.addProperty("tab","deepseek-create");result.addProperty("fixtureOnly",true);return result;
    }
    JsonObject auditDiscoveryUi(boolean missing,boolean chooser){
        if(!net.fabricmc.loader.api.FabricLoader.getInstance().isDevelopmentEnvironment()||!Boolean.getBoolean("voxelstudio.uitest"))throw new IllegalStateException("Development only");
        selectedAgent="codex";selectedModel=null;models=new JsonArray();agentReady=false;userSelectedAgent=false;
        localAgents.accept(JsonParser.parseString(missing?"[{\"id\":\"codex\",\"available\":false,\"state\":\"not-found\"},{\"id\":\"claude\",\"available\":false,\"state\":\"login-required\"},{\"id\":\"deepseek\",\"available\":false,\"state\":\"credential-required\"}]":"[{\"id\":\"codex\",\"available\":true,\"state\":\"ready\"},{\"id\":\"claude\",\"available\":false,\"state\":\"timeout\"},{\"id\":\"deepseek\",\"available\":true,\"state\":\"configured\"}]").getAsJsonArray());
        localScanMessage="本机 Agent："+localAgents.available()+" 个可用 · 点击选择";
        tell("自动检测 · 仅 UI 测试状态","此页面不读取真实账户、不提交生成",StudioTheme.MUTED);
        var result=auditUi(Tab.CREATE);scroll=0;layoutRows();if(chooser)chooseAgent();result.addProperty("tab",chooser?"agent-discovery-list":missing?"agent-discovery-empty":"agent-discovery-multiple");result.addProperty("fixtureOnly",true);return result;
    }
    JsonObject auditUi(Tab requested){
        if(!net.fabricmc.loader.api.FabricLoader.getInstance().isDevelopmentEnvironment()||!Boolean.getBoolean("voxelstudio.uitest"))throw new IllegalStateException("Development UI test only");
        switchTab(requested);for(var widget:fixed)if(widget.getX()<0||widget.getY()<0||widget.getX()+widget.getWidth()>width||widget.getY()+widget.getHeight()>height)throw new IllegalStateException("Fixed UI control outside viewport: "+widget.getMessage().getString());
        float oldZoom=zoom,oldYaw=yaw;var content=layout.content();mouseScrolled(content.x()+1,content.y()+1,-1);
        if(oldZoom!=zoom)throw new IllegalStateException("Sidebar scroll changed preview zoom");
        mouseDragged(layout.viewport().x()+1,layout.viewport().y()+1,0,12,8);
        if(oldYaw!=yaw)throw new IllegalStateException("Unanchored drag rotated preview");
        scroll=0;layoutRows();
        if(requested==Tab.CREATE){
            String saved=description;String test="第一行：中式酒楼\n第二行：庭院与夜景";prompt.setText("");
            setFocused(prompt);prompt.setFocused(true);
            for(char ch:test.toCharArray())if(ch=='\n')prompt.keyPressed(GLFW.GLFW_KEY_ENTER,0,0);else if(!charTyped(ch,0))throw new IllegalStateException("Chinese character event was not accepted");
            if(!prompt.getText().equals(test))throw new IllegalStateException("Multiline Chinese input events lost");
            prompt.charTyped('\0',0);if(!prompt.getText().equals(test))throw new IllegalStateException("IME probe polluted text");
            setFocused(null);prompt.setFocused(false);if(prompt.charTyped('错',0)||!prompt.getText().equals(test))throw new IllegalStateException("Unfocused field accepted input");
            switchTab(Tab.PLACE);switchTab(Tab.CREATE);if(!prompt.getText().equals(test))throw new IllegalStateException("Multiline description lost on tab change");prompt.setText(saved);
        }
        if(requested==Tab.PLACE){coordinates[0].setText("-123");switchTab(Tab.CREATE);switchTab(Tab.PLACE);if(!coordinates[0].getText().equals("-123"))throw new IllegalStateException("Pending coordinate lost on tab change");syncCoordinates();}
        JsonObject result=new JsonObject();result.addProperty("width",width);result.addProperty("height",height);result.addProperty("tab",requested.name());result.addProperty("fixedControlsInBounds",true);result.addProperty("scrollAndDragIsolated",true);result.addProperty("draftPreserved",true);if(requested==Tab.CREATE)result.addProperty("chineseInputEvents",true);return result;
    }
    JsonObject auditFailureUi(boolean picker){
        var result=auditUi(Tab.CREATE);selectedAgent="codex";selectedModel="gpt-6-astra";agentReady=true;userSelectedAgent=true;
        models=JsonParser.parseString("[{\"id\":\"gpt-6-astra\",\"name\":\"GPT-6-Astra\",\"efforts\":[\"low\",\"medium\",\"high\",\"xhigh\",\"max\",\"ultra\"]}]").getAsJsonArray();
        fail(new IllegalStateException("Passage obstructed or not explicitly cleared: passage[1] at [9,2,14]"));
        if(picker)chooseModel();result.addProperty("tab",picker?"astra-model-picker":"generation-failure");result.addProperty("fixtureOnly",true);return result;
    }
    JsonObject auditGenerationOptions(boolean mode,boolean failure){
        var result=auditDeepseekUi();
        if(failure){fail(new IllegalStateException("DeepSeek 达到 Harness / 模型配置或服务端的单次输出上限，建筑数据未完整返回（max-tokens）。模组未设置 token 上限；没有自动重试。"));scroll=430;layoutRows();}
        else if(mode)chooseGenerationMode();else chooseOutputBudget();
        if(activeJob!=null||pendingKey!=null||submitting||preflighting)throw new IllegalStateException("Options inspection submitted a generation");
        result.addProperty("tab",failure?"deepseek-truncated":mode?"generation-mode":"output-budget");result.addProperty("noGenerationSubmitted",true);return result;
    }
    JsonObject auditAssembly(int variant){
        var result=auditDeepseekUi();String savedMode=generationMode,savedTier=qualityTier;int savedCalls=assemblyCalls;
        try{
            generationMode="components";qualityTier=variant>=3&&variant<=6?StudioAssembly.tiers().get(variant-3).id():"ultra";var t=StudioAssembly.tier(qualityTier);assemblyCalls=t.maximumCalls();
            var request=JsonParser.parseString("{\"model\":\"deepseek-flash · 离线界面测试\",\"sample\":false}").getAsJsonObject();StudioAssembly.configure(request,qualityTier,assemblyCalls);
            var policy=JsonParser.parseString("{\"mode\":\"scene\",\"minimumHeight\":224,\"maxOutputTokens\":null,\"warnings\":[]}").getAsJsonObject();policy.addProperty("maximumCalls",assemblyCalls);
            var a=new JsonObject();a.addProperty("id",qualityTier);a.addProperty("maximumCalls",assemblyCalls);a.addProperty("maxPackages",t.maxPackages());a.addProperty("reviewRounds",t.reviewRounds());a.addProperty("visualReview",false);a.addProperty("intermediateAssetsPlaceable",false);policy.add("assembly",a);
            var job=JsonParser.parseString("{\"state\":\"interrupted\",\"assemblyCallsReserved\":3,\"generations\":[{},{}],\"assemblyStages\":[{\"index\":1,\"phase\":\"plan\",\"state\":\"accepted\"},{\"index\":2,\"phase\":\"component\",\"task\":\"facade\",\"state\":\"accepted\"},{\"index\":3,\"phase\":\"component\",\"task\":\"interior\",\"state\":\"interrupted\",\"error\":\"回执未知，不重发；原完整建筑保留\"}]}").getAsJsonObject();job.add("preflight",policy);
            if(failedRepairCandidate(job)||!stagedJob(job))throw new IllegalStateException("Assembly offered unsafe recovery");
            if(variant==0)chooseGenerationMode();else if(variant==1)chooseQualityTier();else if(variant==2)chooseAssemblyCalls();
            else if(variant<=6){var confirmation=assemblyConfirmation(this,request,policy,()->{throw new IllegalStateException("Default Enter must not call assembly models");});client.setScreen(confirmation);confirmation.keyPressed(GLFW.GLFW_KEY_ENTER,0,0);if(client.currentScreen!=this||request.has("assemblyConfirmed"))throw new IllegalStateException("Assembly Enter authorized generation");client.setScreen(confirmation);result.addProperty("defaultEnterReturnsWithoutCalling",true);}
            else client.setScreen(new StudioInfoScreen(this,"组件化中断 · 调用账本",StudioAssembly.details(job)));
            for(var child:client.currentScreen.children())if(child instanceof ClickableWidget w&&(w.getX()<0||w.getY()<0||w.getX()+w.getWidth()>client.currentScreen.width||w.getY()+w.getHeight()>client.currentScreen.height))throw new IllegalStateException("Assembly controls outside viewport");
            result.addProperty("tab",variant==0?"assembly-mode":variant==1?"assembly-tiers":variant==2?"assembly-budget":variant<=6?"assembly-confirm-"+qualityTier:"assembly-ledger");result.addProperty("noGenerationSubmitted",true);result.addProperty("intermediateRecoveryNotOffered",true);return result;
        }finally{generationMode=savedMode;qualityTier=savedTier;assemblyCalls=savedCalls;}
    }
    JsonObject auditCheckpoints(int variant){
        var result=auditDeepseekUi();String savedMode=generationMode;int savedCalls=checkpointCalls;
        try{
            generationMode="checkpoints";checkpointCalls=4;
            var request=JsonParser.parseString("{\"model\":\"deepseek-flash · 离线界面测试\",\"sample\":false}").getAsJsonObject();StudioCheckpoints.configure(request,checkpointCalls);
            var policy=JsonParser.parseString("{\"mode\":\"scene\",\"checkpoints\":{},\"maximumCalls\":4,\"minimumHeight\":224,\"maxOutputTokens\":null,\"warnings\":[\"64×240×64 格边界；完整高度；中间稿不可建造。\"]}").getAsJsonObject();
            var job=JsonParser.parseString("{\"state\":\"failed\",\"stage\":3,\"stageName\":\"correct-layout\",\"checkpointCallsReserved\":3,\"generations\":[{},{},{}],\"checkpointStages\":[{\"index\":1,\"phase\":\"layout\",\"state\":\"rejected\",\"error\":\"代表层房间范围与宿主不符\"},{\"index\":2,\"phase\":\"correct-layout\",\"state\":\"rejected\",\"error\":\"核心空间覆盖冲突\"},{\"index\":3,\"phase\":\"correct-layout\",\"state\":\"rejected\",\"error\":\"预算不足以完成布局和细化；停止\"}]}").getAsJsonObject();job.add("preflight",policy);
            if(failedRepairCandidate(job))throw new IllegalStateException("Checkpoint incorrectly offered single-draft repair");
            if(variant==0)chooseCheckpointCalls();
            else if(variant==1){
                var confirmation=checkpointConfirmation(this,request,policy,()->{throw new IllegalStateException("Checkpoint default Enter must not call model");});client.setScreen(confirmation);confirmation.keyPressed(GLFW.GLFW_KEY_ENTER,0,0);if(client.currentScreen!=this||request.has("checkpointConfirmed"))throw new IllegalStateException("Checkpoint Enter authorized generation");client.setScreen(confirmation);
            }else client.setScreen(new StudioInfoScreen(this,"检查点失败 · 预算与反馈",StudioCheckpoints.details(job)));
            for(var child:client.currentScreen.children())if(child instanceof ClickableWidget w&&(w.getX()<0||w.getY()<0||w.getX()+w.getWidth()>client.currentScreen.width||w.getY()+w.getHeight()>client.currentScreen.height))throw new IllegalStateException("Checkpoint controls outside viewport");
            result.addProperty("tab",variant==0?"checkpoint-budget":variant==1?"checkpoint-confirm":"checkpoint-failure");result.addProperty("noGenerationSubmitted",true);result.addProperty("checkpointRepairNotOffered",true);if(variant==1)result.addProperty("defaultEnterReturnsWithoutCalling",true);return result;
        }finally{generationMode=savedMode;checkpointCalls=savedCalls;}
    }
}
