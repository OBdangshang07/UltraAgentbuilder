package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.selection.*;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.block.Blocks;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.TitleScreen;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.client.gui.widget.TextFieldWidget;
import net.minecraft.client.gui.widget.EditBoxWidget;
import net.minecraft.client.util.ScreenshotRecorder;
import net.minecraft.registry.RegistryKeys;
import net.minecraft.resource.DataConfiguration;
import net.minecraft.util.WorldSavePath;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.*;
import net.minecraft.world.gen.*;
import net.minecraft.world.level.LevelInfo;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/** Opt-in development test. Creates only a NEW flat world in its independently
 * verified development workspace, never copies or opens any existing world. */
final class SelectionSelfTest {
    private static int stage,ticks,progressTicks;private static boolean pending;private static Path output;private static String worldName;private static long started;
    private static final JsonObject report=new JsonObject();private static SelectionReadService.Capture baseline;private static WorldSelection original;
    private static SelectionRegion.Point firstPoint,secondPoint;private static SelectionRegion clickedRegion,draggedRegion;
    private static dev.voxelstudio.WorldChangeTracker.Watch uiWatch;
    private static int lastMutationRestart=-1,fixtureOffset,fixtureChanges;
    private static SelectionReadService.Capture entropyCapture;
    private static SelectionReadService.Capture beforeUnload;private static long unloadStarted;private static boolean unloadQuery;
    private static dev.voxelstudio.WorldChangeTracker.Watch unloadWatch;private static long unloadObservedRevision=-1;private static int unloadStableChecks;
    private static Screen closedTaskParent;
    private static boolean analysisFixtures;private static int analysisIndex;
    private static final String[] ANALYSIS_STATES={"completed","completed-rejected","failed","unknown"};
    static boolean enabled(){return FabricLoader.getInstance().isDevelopmentEnvironment()&&System.getProperty("voxelstudio.selectionTestRoot")!=null;}
    static BridgeClient bridge()throws Exception{
        Path test=root();var marker=JsonParser.parseString(Files.readString(test.resolve("offline-context-provider.json"))).getAsJsonObject();
        var connection=JsonParser.parseString(Files.readString(test.resolve("data/connection.json"))).getAsJsonObject();
        if(!marker.get("allProvidersReplaced").getAsBoolean()||marker.get("modelCallsAllowed").getAsInt()!=0||marker.get("pid").getAsLong()!=connection.get("pid").getAsLong())throw new IllegalStateException("Isolated context provider binding rejected");return new BridgeClient(test);
    }
    private static Path root()throws Exception{
        Path game=FabricLoader.getInstance().getGameDir().toRealPath(),development=game.getParent().getParent(),base=development.resolve("build").toRealPath();
        if(!development.getFileName().toString().matches("p3-selection-development-[a-f0-9]{32}")||!game.equals(development.resolve("mod/run").toRealPath()))throw new IllegalStateException("Not the independent selection development game");
        var copy=JsonParser.parseString(Files.readString(development.resolve("development-workspace.json"))).getAsJsonObject();
        if(!copy.get("developmentOnly").getAsBoolean()||!copy.get("result").getAsString().equals("passed"))throw new IllegalStateException("Missing development source-copy receipt");
        Path root=Path.of(System.getProperty("voxelstudio.selectionTestRoot")).toRealPath();
        if(!root.getParent().equals(base)||!root.getFileName().toString().matches("selection-game-[a-f0-9]{32}"))throw new IllegalStateException("Unsafe selection test output");
        var auth=JsonParser.parseString(Files.readString(root.resolve("authorization.json"))).getAsJsonObject();
        if(!auth.get("newWorldOnly").getAsBoolean()||!auth.get("visibleWindowAuthorized").getAsBoolean()||auth.get("modelCalls").getAsInt()!=0)throw new IllegalStateException("Invalid selection test authorization");
        analysisFixtures=Boolean.getBoolean("voxelstudio.selectionAnalysisFixtures");
        if(analysisFixtures&&(!auth.has("analysisFixtures")||!auth.get("analysisFixtures").getAsBoolean()||auth.get("fixtureAdapterCallsAllowed").getAsInt()!=4))throw new IllegalStateException("Analysis fixture scope mismatch");
        worldName=auth.get("worldName").getAsString();if(!worldName.matches("selection-fixture-[a-f0-9]{32}"))throw new IllegalStateException("Unsafe fixture world name");return root;
    }
    static void tick(MinecraftClient c){
        if(!enabled()||stage==99)return;
        try{
            if(output==null){output=root();started=System.nanoTime();var id=new JsonObject();id.addProperty("pid",ProcessHandle.current().pid());id.addProperty("startedAt",ProcessHandle.current().info().startInstant().orElseThrow().toEpochMilli());Files.writeString(output.resolve("process.json"),id.toString(),StandardOpenOption.CREATE_NEW);}
            if(++progressTicks%20==0){var p=new JsonObject();p.addProperty("stage",stage);p.addProperty("pending",pending);p.addProperty("screen",c.currentScreen==null?"none":c.currentScreen.getClass().getSimpleName());p.addProperty("worldLoaded",c.world!=null);p.addProperty("seconds",(System.nanoTime()-started)/1e9);p.addProperty("selectionStatus",StudioClient.SELECTION.statusText());Files.writeString(output.resolve("progress.json"),p.toString());}
            if(System.nanoTime()-started>600_000_000_000L)throw new IllegalStateException("Free isolated selection test exceeded 10 minutes");
            if(pending)return;
            c.options.pauseOnLostFocus=false;
            long window=c.getWindow().getHandle();if(org.lwjgl.glfw.GLFW.glfwGetWindowAttrib(window,org.lwjgl.glfw.GLFW.GLFW_VISIBLE)!=org.lwjgl.glfw.GLFW.GLFW_TRUE)throw new IllegalStateException("Selection test requires authorized visible window");
            if(stage==0){
                if(c.currentScreen instanceof net.minecraft.client.gui.screen.AccessibilityOnboardingScreen){c.options.onboardAccessibility=false;c.options.write();c.setScreen(new TitleScreen());report.addProperty("knownFirstLaunchAccessibilityHandled",true);ticks=0;return;}
                if(!(c.currentScreen instanceof TitleScreen)||c.getOverlay()!=null||++ticks<40)return;
                Path world=FabricLoader.getInstance().getGameDir().resolve("saves").resolve(worldName);if(Files.exists(world))throw new IllegalStateException("Refusing to open an existing world");
                c.options.getViewDistance().setValue(4);c.getTutorialManager().setStep(net.minecraft.client.tutorial.TutorialStep.NONE);var rules=new GameRules();rules.get(GameRules.RANDOM_TICK_SPEED).set(0,null);rules.get(GameRules.DO_MOB_SPAWNING).set(false,null);rules.get(GameRules.DO_DAYLIGHT_CYCLE).set(false,null);
                var info=new LevelInfo(worldName,GameMode.CREATIVE,false,Difficulty.PEACEFUL,true,rules,DataConfiguration.SAFE_MODE);
                c.createIntegratedServerLoader().createAndStart(worldName,info,new GeneratorOptions(3393,false,false),registries->registries.get(RegistryKeys.WORLD_PRESET).getOrThrow(WorldPresets.FLAT).createDimensionsRegistryHolder());
                stage=1;ticks=0;return;
            }
            if(c.player==null||c.getServer()==null)return;
            Path actual=c.getServer().getSavePath(WorldSavePath.ROOT).toRealPath(),allowed=FabricLoader.getInstance().getGameDir().resolve("saves").resolve(worldName).toRealPath();
            if(!actual.equals(allowed))throw new IllegalStateException("Test entered a non-fixture world");
            var tool=StudioClient.SELECTION;
            if(stage==1){
                if(++ticks<160||!tool.ready())return;
                if(Boolean.getBoolean("voxelstudio.iristest")){
                    var api=Class.forName("net.irisshaders.iris.api.v0.IrisApi");var instance=api.getMethod("getInstance").invoke(null);
                    if(!(boolean)api.getMethod("isShaderPackInUse").invoke(instance))throw new IllegalStateException("Iris test shaderpack is not active");
                    report.addProperty("irisShaderPackActive",true);
                }else report.addProperty("irisShaderPackActive",false);
                tool.mutate(()->{tool.draft.region(region(-16,-64,-16,16,-48,16));tool.draft.target(SelectionDraft.Target.EDIT,-1);tool.draft.region(region(-4,-64,-4,4,-56,4));tool.draft.target(SelectionDraft.Target.PROTECTED,-1);tool.draft.region(region(-2,-64,-2,0,-62,0));tool.draft.target(SelectionDraft.Target.CONTEXT,-1);});
                original=tool.draft.selection();c.player.getAbilities().flying=true;c.player.sendAbilitiesUpdate();c.player.refreshPositionAndAngles(-24,-46,-30,-35,30);c.setScreen(new SelectionScreen(new TitleScreen()));
                pending=true;c.getServer().execute(()->{try{uiWatch=dev.voxelstudio.WorldChangeTracker.watch(c.getServer().getPlayerManager().getPlayer(c.player.getUuid()).getServerWorld(),region(-20,-64,-20,20,-44,20));c.execute(()->{pending=false;stage=100;ticks=0;});}catch(Exception e){c.execute(()->fail(c,e));}});return;
            }
            if(stage==100){
                if(++ticks<20)return;
                var before=tool.draft.selection();var outer=region(-20,-64,-20,20,-44,20);
                numeric(c,outer);if(!outer.equals(tool.draft.context())||!before.edit().equals(tool.draft.edit())||!before.protectedRegions().equals(tool.draft.protectedRegions()))throw new IllegalStateException("Numeric outer edit moved another scope");
                press(c,"保护区");press(c,"新增保护区");var protectedExtra=region(2,-64,2,3,-63,3);numeric(c,protectedExtra);
                if(tool.draft.protectedRegions().size()!=2||!tool.draft.protectedRegions().get(1).equals(protectedExtra))throw new IllegalStateException("Protection UI did not append the requested region");
                press(c,"清除当前范围");if(!before.protectedRegions().equals(tool.draft.protectedRegions()))throw new IllegalStateException("Protection clear removed another region");
                press(c,"内层改造");long revision=tool.draft.revision();numeric(c,region(50,-64,50,52,-62,52));
                if(tool.draft.revision()!=revision||!before.edit().equals(tool.draft.edit()))throw new IllegalStateException("Invalid numeric inner region mutated the draft");
                press(c,"隐藏边框");if(tool.visible)throw new IllegalStateException("Hide button did not hide selection");press(c,"显示边框");if(!tool.visible)throw new IllegalStateException("Show button did not restore selection");
                report.addProperty("numericScreenInputAndButtonDispatchVerified",true);report.addProperty("numericScopeIsolationVerified",true);report.addProperty("invalidNumericInputAtomic",true);report.addProperty("protectionAppendAndClearVerified",true);report.addProperty("visibilityButtonsVerified",true);
                press(c,"在世界里两点选择");stage=101;ticks=0;return;
            }
            if(stage==101){
                if(++ticks<20)return;var screen=(SelectionWorldScreen)c.currentScreen;var points=mousePoints(c);
                firstPoint=tool.point(points[0],points[1]);secondPoint=tool.point(points[2],points[3]);clickedRegion=SelectionRegion.corners(firstPoint,secondPoint);
                var outer=tool.draft.context();var protection=tool.draft.protectedRegions();long revision=tool.draft.revision();
                if(!screen.mouseClicked(points[0],points[1],0)||!screen.mouseReleased(points[0],points[1],0))throw new IllegalStateException("First-point mouse event leaked");
                if(!firstPoint.equals(tool.draft.first())||tool.draft.revision()!=revision+1)throw new IllegalStateException("Left mouse did not select first point");
                if(!screen.mouseClicked(points[2],points[3],1)||!screen.mouseReleased(points[2],points[3],1))throw new IllegalStateException("Second-point mouse event leaked");
                if(tool.draft.first()!=null||!clickedRegion.equals(tool.draft.edit())||!outer.equals(tool.draft.context())||!protection.equals(tool.draft.protectedRegions()))throw new IllegalStateException("Two-point screen event selected incorrect or enlarged scope");
                screen.mouseScrolled(points[0],points[1],4);if(!clickedRegion.equals(tool.draft.edit()))throw new IllegalStateException("World-screen scroll changed scope");
                report.addProperty("leftRightMousePointsVerified",true);report.add("mouseSelectedRegion",clickedRegion.json());report.addProperty("worldScreenScrollConsumed",true);
                // Only modifier lookup is substituted. The click/drag/release,
                // normal UI and real camera/raycast paths are not replaced.
                c.setScreen(new SelectionWorldScreen(new SelectionScreen(new TitleScreen())){@Override protected boolean boundaryDragRequested(){return true;}});
                stage=102;ticks=0;return;
            }
            if(stage==102){
                if(++ticks<20)return;var screen=(SelectionWorldScreen)c.currentScreen;var move=dragCoordinates(c,clickedRegion);
                var outer=tool.draft.context();var protection=tool.draft.protectedRegions();
                if(!screen.mouseClicked(move[0],move[1],0)||!screen.mouseDragged(move[2],move[3],0,move[2]-move[0],move[3]-move[1])||!screen.mouseReleased(move[2],move[3],0))throw new IllegalStateException("Drag events leaked");
                if(!draggedRegion.equals(tool.draft.edit())||!outer.equals(tool.draft.context())||!protection.equals(tool.draft.protectedRegions()))throw new IllegalStateException("Boundary drag selected incorrect or enlarged scope");
                long revision=tool.draft.revision();screen.mouseDragged(move[0],move[1],0,0,0);if(revision!=tool.draft.revision())throw new IllegalStateException("Released drag remained active");
                report.addProperty("screenBoundaryDragAndReleaseVerified",true);report.add("mouseDraggedRegion",draggedRegion.json());report.addProperty("physicalModifierInputVerified",false);report.addProperty("syntheticInGameScreenEvents",true);
                c.setScreen(new SelectionWorldScreen(new SelectionScreen(new TitleScreen())));stage=103;ticks=0;return;
            }
            if(stage==103){if(++ticks<20)return;screenshot(c,"selection-interaction.png");
                if(uiWatch==null||uiWatch.revision()!=0)throw new IllegalStateException("World changed during supposedly read-only mouse/panel interactions");uiWatch.close();uiWatch=null;report.addProperty("uiWorldChangeWatchRevision",0);
                tool.mutate(()->{tool.draft.target(SelectionDraft.Target.CONTEXT,-1);tool.draft.clear();tool.draft.region(original.context());tool.draft.target(SelectionDraft.Target.EDIT,-1);tool.draft.region(original.edit());for(var r:original.protectedRegions()){tool.draft.target(SelectionDraft.Target.PROTECTED,-1);tool.draft.region(r);}tool.draft.target(SelectionDraft.Target.CONTEXT,-1);});
                original=tool.draft.selection();c.player.refreshPositionAndAngles(-32,-40,-40,-35,23);c.setScreen(new SelectionWorldScreen(new SelectionScreen(new TitleScreen())));
                if(WorldPatchPreviewSelfTest.enabled()){
                    pending=true;var server=c.getServer();var user=c.player.getUuid();server.execute(()->{try{var world=server.getPlayerManager().getPlayer(user).getServerWorld();world.setBlockState(new BlockPos(-1,-57,-3),Blocks.GLASS.getDefaultState());world.setBlockState(new BlockPos(1,-57,-3),Blocks.STONE.getDefaultState());c.execute(()->{pending=false;report.addProperty("patchPreparationFixtureWorldChanges",2);stage=2;ticks=0;});}catch(Exception e){c.execute(()->fail(c,e));}});return;
                }
                stage=2;ticks=0;return;
            }
            if(stage==2){if(++ticks<20)return;screenshot(c,"selection-world.png");c.setScreen(new SelectionScreen(new TitleScreen()));stage=3;ticks=0;return;}
            if(stage==3){if(++ticks<20)return;screenshot(c,"selection-panel.png");press(c,"读取环境");stage=4;return;}
            if(stage==4){
                if(!ready(tool))return;pending=true;
                tool.checkedCapture().thenCompose(cap->{baseline=cap;return audit(c,cap,false);}).whenComplete((facts,error)->c.execute(()->{pending=false;if(error!=null){fail(c,error);return;}try{report.add("baseline",facts);Files.writeString(output.resolve("baseline-capture.json"),baseline.payload(),StandardOpenOption.CREATE_NEW);press(c,"本地保存快照");stage=110;}catch(Exception e){fail(c,e);}}));return;
            }
            if(stage==110){if(tool.contextBusy())return;var saved=tool.savedContext();if(saved==null)throw new IllegalStateException("Real save button did not persist current capture: "+tool.message);
                Files.writeString(output.resolve("baseline-context-receipt.json"),saved.toString(),StandardOpenOption.CREATE_NEW);report.addProperty("localSnapshotSaveButtonVerified",true);report.addProperty("rawPayloadDigestAndWorldBindingVerified",true);press(c,"核验已保存快照");stage=111;ticks=0;return;}
            if(stage==111){if(tool.contextBusy())return;if(!(c.currentScreen instanceof StudioInfoScreen info))throw new IllegalStateException("Verified summary button did not open details: "+tool.message);
                if(++ticks<20)return;screenshot(c,"selection-summary.png");info.close();report.addProperty("summaryReadBackAndPanelVerified",true);
                if(WorldPatchPreviewSelfTest.enabled()){stage=200;ticks=0;return;}
                StudioScreen.prepareOfflineContextTask();press(c,"准备 AI 环境分析任务");stage=112;ticks=0;return;}
            if(stage==200){
                if(!WorldPatchPreviewSelfTest.tick(c,output,baseline,report))return;
                // P4 stale-selection test invalidates the old capture. Read and
                // save a NEW one before continuing the existing P3 chain.
                pending=true;var server=c.getServer();var user=c.player.getUuid();server.execute(()->{try{
                    var world=server.getPlayerManager().getPlayer(user).getServerWorld();
                    if(!world.getBlockState(new BlockPos(-1,-57,-3)).isOf(Blocks.GLASS)||!world.getBlockState(new BlockPos(1,-57,-3)).isOf(Blocks.STONE))throw new IllegalStateException("Patch fixture original world changed unexpectedly");
                    // Restore only the two explicitly prepared test cells before
                    // the independent high-entropy test, never apply the patch.
                    world.setBlockState(new BlockPos(-1,-57,-3),Blocks.AIR.getDefaultState());world.setBlockState(new BlockPos(1,-57,-3),Blocks.AIR.getDefaultState());
                    c.execute(()->{pending=false;report.addProperty("patchCleanupFixtureWorldChanges",2);press(c,"读取环境");stage=201;});
                }catch(Exception e){c.execute(()->fail(c,e));}});return;
            }
            if(stage==201){if(!ready(tool))return;pending=true;tool.checkedCapture().whenComplete((cap,error)->c.execute(()->{pending=false;if(error!=null){fail(c,error);return;}baseline=cap;press(c,"本地保存快照");stage=202;}));return;}
            if(stage==202){if(tool.contextBusy())return;if(tool.savedContext()==null)throw new IllegalStateException("Post-preview fresh context not saved");StudioScreen.prepareOfflineContextTask();press(c,"准备 AI 环境分析任务");stage=112;ticks=0;return;}
            if(stage==112){
                if(!(c.currentScreen instanceof ContextTaskScreen screen))throw new IllegalStateException("Task button did not open the native preparation screen");
                var field=screen.children().stream().filter(v->v instanceof EditBoxWidget).map(v->(EditBoxWidget)v).findFirst().orElseThrow();field.setText("");
                if(!screen.mouseClicked(field.getX()+8,field.getY()+8,0))throw new IllegalStateException("Task text did not focus");screen.mouseReleased(field.getX()+8,field.getY()+8,0);
                String text="  分析入口与周围环境，明确未知。  ";for(char ch:text.toCharArray())if(!screen.charTyped(ch,0))throw new IllegalStateException("Chinese task character event was rejected");
                if(!field.getText().equals(text))throw new IllegalStateException("Task prompt was rewritten or dropped");
                report.addProperty("contextTaskSyntheticChineseTextInputVerified",true);report.addProperty("physicalContextImeInputVerified",false);
                stage=118;ticks=0;return;
            }
            if(stage==118){
                // Capture an actually rendered frame AFTER typing, not the
                // framebuffer from the previous default-prompt screen frame.
                if(++ticks<20)return;screenshot(c,"context-task-input.png");press(c,"准备精确任务与隐私披露");stage=113;ticks=0;return;
            }
            if(stage==113){
                if(tool.contextBusy())return;if(!(c.currentScreen instanceof StudioInfoScreen info))throw new IllegalStateException("Task disclosure did not open after exact fences: "+tool.message);
                var prepared=tool.preparedTask();if(prepared==null||prepared.get("modelSent").getAsBoolean()||prepared.get("sendingImplemented").getAsBoolean()||prepared.get("canAuthorizePlacement").getAsBoolean())throw new IllegalStateException("Task preparation claimed send/world authority");
                var intent=prepared.getAsJsonObject("request").getAsJsonObject("intent");if(!intent.get("prompt").getAsString().equals("  分析入口与周围环境，明确未知。  ")||!intent.get("model").getAsString().equals("offline-context-fixture")||!intent.get("effort").getAsString().equals("max"))throw new IllegalStateException("Task preparation did not bind exact UI text/model/effort");
                var request=prepared.getAsJsonObject("request");if(prepared.get("version").getAsInt()!=2||request.get("version").getAsInt()!=2||intent.get("version").getAsInt()!=2
                    ||!ContextReceipt.jsonHash(request.get("protocol")).equals(request.get("protocolHash").getAsString()))throw new IllegalStateException("Native task did not bind the v2 analysis rules/protocol");
                if(++ticks<20)return;Files.writeString(output.resolve("context-task-prepared.json"),prepared.toString(),StandardOpenOption.CREATE_NEW);report.addProperty("contextTaskExactDisclosureButtonVerified",true);
                screenshot(c,"context-task-disclosure.png");info.auditScrollTo("只读分析规则原文：");stage=119;ticks=0;return;
            }
            if(stage==119){
                if(!(c.currentScreen instanceof StudioInfoScreen))throw new IllegalStateException("Protocol review panel closed unexpectedly");
                if(++ticks<20)return;screenshot(c,"context-task-protocol.png");report.addProperty("contextTaskV2ProtocolBoundAndReviewed",true);
                press(c,"确认内容 · 不调用");stage=114;ticks=0;return;
            }
            if(stage==114){
                if(tool.contextBusy())return;if(!(c.currentScreen instanceof StudioInfoScreen info))throw new IllegalStateException("Task confirmation did not open: "+tool.message);
                var confirmed=tool.confirmedTask();if(confirmed==null||!confirmed.get("state").getAsString().equals("confirmed-not-sent")||confirmed.get("modelSent").getAsBoolean()||confirmed.get("canAuthorizePlacement").getAsBoolean())throw new IllegalStateException("Task confirmation is missing or claims authority");
                if(++ticks<20)return;Files.writeString(output.resolve("context-task-consent.json"),confirmed.toString(),StandardOpenOption.CREATE_NEW);screenshot(c,"context-task-confirmed.png");report.addProperty("contextTaskExplicitConsentButtonVerified",true);
                if(analysisFixtures){press(c,"进入一次发送审核");stage=120;ticks=0;return;}
                info.close();if(!(c.currentScreen instanceof ContextTaskScreen taskScreen))throw new IllegalStateException("Task confirmation returned to wrong parent");taskScreen.close();
                press(c,"准备 AI 环境分析任务");press(c,"准备精确任务与隐私披露");stage=115;ticks=0;return;
            }
            if(stage==115){
                if(tool.contextBusy())return;if(!(c.currentScreen instanceof StudioInfoScreen info))throw new IllegalStateException("Second exact task preparation failed: "+tool.message);
                press(c,"确认内容 · 不调用");info.close();closedTaskParent=c.currentScreen;stage=116;ticks=0;return;
            }
            if(stage==116){
                if(tool.contextBusy())return;if(c.currentScreen!=closedTaskParent||!(closedTaskParent instanceof ContextTaskScreen screen))throw new IllegalStateException("Late task consent reopened a dismissed panel");
                if(tool.confirmedTask()==null)throw new IllegalStateException("Closed-screen task confirmation was not safely retained");report.addProperty("contextTaskLateConsentDoesNotReopenUi",true);screen.close();
                press(c,"准备 AI 环境分析任务");var taskScreen=(ContextTaskScreen)c.currentScreen;press(c,"准备精确任务与隐私披露");taskScreen.close();closedTaskParent=c.currentScreen;stage=117;ticks=0;return;
            }
            if(stage==117){
                if(tool.contextBusy())return;if(c.currentScreen!=closedTaskParent||!(closedTaskParent instanceof SelectionScreen))throw new IllegalStateException("Late task disclosure reopened a dismissed panel");
                if(tool.preparedTask()==null||tool.confirmedTask()!=null)throw new IllegalStateException("New task retained old confirmation or was not prepared");report.addProperty("contextTaskLateDisclosureDoesNotReopenUi",true);stage=5;return;
            }
            if(stage==120){
                if(!(c.currentScreen instanceof ContextAnalysisSendScreen screen))throw new IllegalStateException("Missing separate send review");if(!active(c,"发送一次"))return;
                var counts=JsonParser.parseString(Files.readString(output.resolve("analysis-fixture-progress.json"))).getAsJsonObject();if(counts.get("fixtureCalls").getAsInt()!=0)throw new IllegalStateException("Preparation/capabilities sent a fixture early");
                screen.close();closedTaskParent=c.currentScreen;tool.openAnalysisSend(closedTaskParent);report.addProperty("analysisNoSendBeforeExplicitConfirmation",true);stage=121;ticks=0;return;
            }
            if(stage==121){
                if(!(c.currentScreen instanceof ContextAnalysisSendScreen))throw new IllegalStateException("Missing live send confirmation");if(!active(c,"发送一次"))return;
                screenshot(c,"analysis-send-confirmation-"+ANALYSIS_STATES[analysisIndex]+".png");press(c,"发送一次");
                if(active(c,"发送一次"))throw new IllegalStateException("Send button remained available after one attempt");
                var button=c.currentScreen.children().stream().filter(v->v instanceof ClickableWidget w&&w.getMessage().getString().startsWith("发送一次")).map(v->(ClickableWidget)v).findFirst().orElseThrow();
                c.currentScreen.mouseClicked(button.getX()+8,button.getY()+8,0);c.currentScreen.mouseReleased(button.getX()+8,button.getY()+8,0);report.addProperty("analysisDuplicateClickSuppressed",true);stage=122;ticks=0;return;
            }
            if(stage==122){
                if(!(c.currentScreen instanceof ContextAnalysisResultScreen screen))return;var status=screen.statusForAudit();if(status==null||status.get("state").getAsString().equals("running"))return;
                String expected=ANALYSIS_STATES[analysisIndex];if(!status.get("state").getAsString().equals(expected))throw new IllegalStateException("Unexpected analysis state "+status);
                if(++ticks<20)return;Files.writeString(output.resolve("analysis-"+expected+"-status.json"),status.toString(),StandardOpenOption.CREATE_NEW);screenshot(c,"analysis-"+expected+".png");
                if(analysisIndex==0){press(c,"查询原回执");screen.close();closedTaskParent=c.currentScreen;stage=123;ticks=0;return;}
                if(expected.equals("unknown")){press(c,"观察原 turn");stage=127;ticks=0;return;}
                nextAnalysis(c);return;
            }
            if(stage==123){
                if(++ticks<20)return;if(c.currentScreen!=closedTaskParent)throw new IllegalStateException("Late GET reopened its closed result UI");report.addProperty("analysisLateQueryDoesNotReopenUi",true);
                ((ContextTaskScreen)c.currentScreen).close();press(c,"原选区分析历史");stage=124;ticks=0;return;
            }
            if(stage==124){
                if(!(c.currentScreen instanceof ContextAnalysisHistoryScreen))throw new IllegalStateException("Missing local original history");if(!active(c,"offline-context-fixture"))return;
                screenshot(c,"analysis-history.png");press(c,"offline-context-fixture");stage=125;ticks=0;return;
            }
            if(stage==125){
                if(!(c.currentScreen instanceof ContextAnalysisResultScreen screen))throw new IllegalStateException("History result panel missing");var status=screen.statusForAudit();if(status==null)return;
                if(!status.get("state").getAsString().equals("completed"))throw new IllegalStateException("Original history result differs");if(++ticks<20)return;
                report.addProperty("analysisOriginalHistoryQueryVerified",true);screen.close();((ContextAnalysisHistoryScreen)c.currentScreen).close();startNextAnalysis(c);return;
            }
            if(stage==128){if(tool.contextBusy())return;if(!(c.currentScreen instanceof StudioInfoScreen))throw new IllegalStateException("Fixture exact disclosure missing");press(c,"确认内容 · 不调用");stage=129;return;}
            if(stage==129){if(tool.contextBusy())return;if(!(c.currentScreen instanceof StudioInfoScreen))throw new IllegalStateException("Fixture content consent missing");press(c,"进入一次发送审核");stage=121;return;}
            if(stage==127){
                if(!(c.currentScreen instanceof ContextAnalysisObservationScreen))throw new IllegalStateException("Unknown turn observation lacks separate confirmation");
                var counts=JsonParser.parseString(Files.readString(output.resolve("analysis-fixture-progress.json"))).getAsJsonObject();if(counts.get("fixtureObservations").getAsInt()!=0)throw new IllegalStateException("Unknown task automatically observed");
                if(++ticks<20)return;screenshot(c,"analysis-observation-confirmation.png");press(c,"确认观察原 turn");stage=130;ticks=0;return;
            }
            if(stage==130){
                if(!(c.currentScreen instanceof ContextAnalysisResultScreen screen))return;var status=screen.statusForAudit();if(status==null||status.get("state").getAsString().equals("running"))return;
                if(!status.get("state").getAsString().equals("completed"))throw new IllegalStateException("Original fixture observation not completed");if(++ticks<20)return;
                Files.writeString(output.resolve("analysis-observed-status.json"),status.toString(),StandardOpenOption.CREATE_NEW);screenshot(c,"analysis-observed.png");report.addProperty("analysisSeparateOriginalObservationVerified",true);report.addProperty("analysisCompletedRejectedFailedUnknownRendered",true);
                // Return to the original selection panel and run the unchanged
                // late-consent/disclosure, environment and dimension fences.
                c.setScreen(new SelectionScreen(new TitleScreen()));press(c,"准备 AI 环境分析任务");press(c,"准备精确任务与隐私披露");stage=115;ticks=0;return;
            }
            if(stage==5){
                pending=true;var server=c.getServer();var user=c.player.getUuid();var changed=new CompletableFuture<Void>();
                server.execute(()->{try{
                    var world=server.getPlayerManager().getPlayer(user).getServerWorld();var position=new BlockPos(15,-49,15);var before=world.getBlockState(position);if(!before.isAir())throw new IllegalStateException("Change probe must be air outside inner region");
                    world.setBlockState(position,Blocks.STONE.getDefaultState(),2);world.setBlockState(position,before,2);changed.complete(null);
                }catch(Exception e){changed.completeExceptionally(e);}});
                changed.thenCompose(v->tool.checkedCapture().handle((cap,error)->{if(error==null)throw new CompletionException(new IllegalStateException("Restored-but-changed context reused stale capture"));return true;})).whenComplete((v,error)->c.execute(()->{pending=false;if(error!=null){fail(c,error);return;}try{
                    if(tool.savedContext()!=null||tool.preparedTask()!=null||tool.confirmedTask()!=null)throw new IllegalStateException("World change retained an approved local context/task");report.addProperty("savedContextClearedOnEnvironmentChange",true);report.addProperty("contextTaskClearedOnEnvironmentChange",true);
                    report.addProperty("outsideInnerContextChangeRejectsOldCapture",true);report.addProperty("controlledFixtureWorldChanges",2);
                    tool.mutate(()->{tool.draft.target(SelectionDraft.Target.CONTEXT,-1);tool.draft.region(region(-64,-64,-64,64,0,64));});SelectionPerformanceProbe.start();tool.read();stage=6;
                }catch(Exception e){fail(c,e);}}));return;
            }
            if(stage==6){
                if(!ready(tool))return;pending=true;
                tool.checkedCapture().thenCompose(cap->persisted(cap,"million").thenApply(saved->cap)).whenComplete((cap,error)->c.execute(()->{pending=false;if(error!=null){fail(c,error);return;}try{
                    var status=tool.readStatus();var p=status.scan();var metrics=new JsonObject();metrics.addProperty("cells",cap.selection().context().cells());metrics.addProperty("reads",p.reads());metrics.addProperty("steps",p.steps());metrics.addProperty("maxReadStepMillis",p.maxStepNanos()/1e6);metrics.addProperty("restarts",p.restarts());metrics.addProperty("wholeClientFramePerformanceVerified",false);report.add("millionCellScan",metrics);
                    metrics.add("readStepTimings",new Gson().toJsonTree(cap.scanTimings()));
                    metrics.add("observedRuntimePerformance",SelectionPerformanceProbe.stop());
                    Files.writeString(output.resolve("million-capture.json"),cap.payload(),StandardOpenOption.CREATE_NEW);
                    tool.mutate(()->{tool.draft.target(SelectionDraft.Target.EDIT,-1);tool.draft.clear();tool.draft.target(SelectionDraft.Target.PROTECTED,0);tool.draft.clear();tool.draft.target(SelectionDraft.Target.CONTEXT,-1);tool.draft.region(region(4096,-64,4096,4112,-48,4112));tool.draft.target(SelectionDraft.Target.EDIT,-1);tool.draft.region(region(4096,-64,4096,4100,-60,4100));});tool.read();stage=7;
                }catch(Exception e){fail(c,e);}}));return;
            }
            if(stage==7){
                if(!ready(tool))return;pending=true;
                tool.checkedCapture().thenCompose(cap->{try{Files.writeString(output.resolve("unknown-capture.json"),cap.payload(),StandardOpenOption.CREATE_NEW);}catch(Exception e){throw new CompletionException(e);}return audit(c,cap,true);}).whenComplete((facts,error)->c.execute(()->{pending=false;if(error!=null){fail(c,error);return;}report.add("unknown",facts);
                    tool.mutate(()->{tool.draft.target(SelectionDraft.Target.EDIT,-1);tool.draft.clear();tool.draft.target(SelectionDraft.Target.CONTEXT,-1);tool.draft.region(region(-64,-64,-64,64,0,64));tool.draft.target(SelectionDraft.Target.EDIT,-1);tool.draft.region(original.edit());});tool.read();stage=8;
                }));return;
            }
            if(stage==8){var status=tool.readStatus();if(status==null||status.scan()==null||status.scan().reads()==0)return;if(status.state()!=SelectionReadService.State.READING)throw new IllegalStateException("Cancellation probe finished before cancellation");press(c,"取消读取");report.addProperty("readAndCancelButtonsVerified",true);stage=9;ticks=0;return;}
            if(stage==9){if(++ticks<10)return;
                pending=true;tool.checkedCapture().handle((cap,error)->{if(error==null)throw new CompletionException(new IllegalStateException("Cancelled capture remains available"));return true;}).thenCompose(v->SelectionReadService.idle(c.getServer(),c.player.getUuid())).whenComplete((v,error)->c.execute(()->{pending=false;if(error!=null){fail(c,error);return;}try{
                    if(!v)throw new IllegalStateException("Cancelled server read was retained");
                    report.addProperty("cancelledCaptureCannotPublish",true);tool.read();lastMutationRestart=-1;stage=10;
                }catch(Exception e){fail(c,e);}}));
                return;
            }
            if(stage==10){
                var s=tool.readStatus();if(s==null||s.scan()==null)return;
                if(s.state()==SelectionReadService.State.UNSTABLE){
                    if(s.scan().restarts()!=2||fixtureChanges!=3)throw new IllegalStateException("Continuous changes did not respect two-restart bound");
                    pending=true;tool.checkedCapture().handle((cap,error)->{if(error==null)throw new CompletionException(new IllegalStateException("Unstable capture became publishable"));return true;}).thenCompose(v->SelectionReadService.idle(c.getServer(),c.player.getUuid())).whenComplete((idle,error)->c.execute(()->{pending=false;if(error!=null||!Boolean.TRUE.equals(idle)){fail(c,error==null?new IllegalStateException("Unstable task retained server state"):error);return;}
                        report.addProperty("continuousChangeStopsAfterTwoRestarts",true);report.addProperty("unstableCaptureCannotPublish",true);stage=11;fixtureOffset=0;
                    }));return;
                }
                if(s.state()!=SelectionReadService.State.READING)throw new IllegalStateException("Continuous-change probe did not remain reading: "+s.state());
                if(s.scan().reads()==0||s.scan().restarts()==lastMutationRestart)return;
                lastMutationRestart=s.scan().restarts();pending=true;final int change=fixtureChanges;
                c.getServer().execute(()->{try{var p=c.getServer().getPlayerManager().getPlayer(c.player.getUuid());var pos=new BlockPos(63,-1,63);var block=change%2==0?Blocks.STONE.getDefaultState():Blocks.AIR.getDefaultState();if(!p.getServerWorld().setBlockState(pos,block,2))throw new IllegalStateException("Controlled context mutation did not change the block");c.execute(()->{fixtureChanges++;pending=false;});}catch(Exception e){c.execute(()->fail(c,e));}});return;
            }
            if(stage==11){
                if(fixtureOffset==65536){
                    tool.mutate(()->{tool.draft.target(SelectionDraft.Target.CONTEXT,-1);tool.draft.clear();tool.draft.region(region(-16,-60,-16,16,4,16));tool.draft.target(SelectionDraft.Target.EDIT,-1);tool.draft.region(region(-4,-60,-4,4,-52,4));});stage=12;ticks=0;return;
                }
                pending=true;final int begin=fixtureOffset,end=Math.min(65536,begin+1024);
                c.getServer().execute(()->{try{var p=c.getServer().getPlayerManager().getPlayer(c.player.getUuid());var world=p.getServerWorld();int changed=0;var states=List.of(Blocks.STONE.getDefaultState(),Blocks.ANDESITE.getDefaultState(),Blocks.POLISHED_ANDESITE.getDefaultState(),Blocks.QUARTZ_BLOCK.getDefaultState(),Blocks.WHITE_CONCRETE.getDefaultState(),Blocks.GLASS.getDefaultState());
                    // Test-fixture writer, NOT SelectionReadService. Bounded
                    // world changes only inside this freshly created save.
                    for(int i=begin;i<end;i++){int x=i%32-16,z=i/32%32-16,y=i/1024-60;var chunk=world.getChunkManager().getWorldChunk(Math.floorDiv(x,16),Math.floorDiv(z,16));if(chunk==null)throw new IllegalStateException("Fixture would load an unknown chunk");if(world.setBlockState(new BlockPos(x,y,z),states.get(Math.floorMod(x+y*3+z*7,6)),18))changed++;}
                    final int count=changed;c.execute(()->{fixtureOffset=end;fixtureChanges+=count;pending=false;});
                }catch(Exception e){c.execute(()->fail(c,e));}});return;
            }
            if(stage==12){if(++ticks<40)return;SelectionPerformanceProbe.start();tool.read();stage=13;return;}
            if(stage==13){
                if(!ready(tool))return;pending=true;tool.checkedCapture().thenCompose(cap->{entropyCapture=cap;return audit(c,cap,false).thenCompose(facts->persisted(cap,"high-entropy").thenApply(saved->facts));}).whenComplete((facts,error)->c.execute(()->{pending=false;if(error!=null){fail(c,error);return;}try{
                    if(facts.get("exactCellsAudited").getAsInt()!=65536)throw new IllegalStateException("High-entropy region was not fully audited");
                    var capture=JsonParser.parseString(entropyCapture.payload()).getAsJsonObject().getAsJsonObject("capture");int runs=0;for(var chunk:capture.getAsJsonArray("chunks"))runs+=chunk.getAsJsonObject().getAsJsonArray("runs").size();if(runs<60000)throw new IllegalStateException("High-entropy fixture was accidentally uniform");
                    var metrics=new JsonObject();metrics.addProperty("cells",65536);metrics.addProperty("runs",runs);metrics.addProperty("payloadBytes",entropyCapture.payload().getBytes(java.nio.charset.StandardCharsets.UTF_8).length);metrics.add("audit",facts);metrics.add("readStepTimings",new Gson().toJsonTree(entropyCapture.scanTimings()));metrics.add("observedRuntimePerformance",SelectionPerformanceProbe.stop());report.add("highEntropyScan",metrics);
                    Files.writeString(output.resolve("high-entropy-capture.json"),entropyCapture.payload(),StandardOpenOption.CREATE_NEW);stage=14;
                }catch(Exception e){fail(c,e);}}));return;
            }
            if(stage==14){
                pending=true;var server=c.getServer();final var user=c.player.getUuid();
                server.execute(()->{try{var p=server.getPlayerManager().getPlayer(user);var world=server.getWorld(World.NETHER);if(world==null)throw new IllegalStateException("Fixture Nether unavailable");p.teleport(world,0,100,0,0,0);c.execute(()->{pending=false;stage=15;ticks=0;});}catch(Exception e){c.execute(()->fail(c,e));}});return;
            }
            if(stage==15){
                if(c.world==null||!c.world.getRegistryKey().equals(World.NETHER)||!tool.ready()||++ticks<20)return;
                if(tool.draft.context()!=null||tool.draft.edit()!=null||!tool.draft.world().dimension().equals("minecraft:the_nether"))throw new IllegalStateException("Dimension transition retained old selection");
                pending=true;var old=entropyCapture;var server=c.getServer();final var user=c.player.getUuid();
                SelectionReadService.checkedCapture(server,user,old.id(),old.selection().revision()).handle((cap,error)->{if(error==null)throw new CompletionException(new IllegalStateException("Old-dimensional capture was accepted"));return true;}).thenCompose(v->SelectionReadService.idle(server,user)).whenComplete((idle,error)->c.execute(()->{pending=false;if(error!=null||!Boolean.TRUE.equals(idle)){fail(c,error==null?new IllegalStateException("Old dimensional task retained"):error);return;}try{
                    report.addProperty("actualDimensionTransitionClearsSelection",true);report.addProperty("oldDimensionCaptureCannotPublish",true);
                    tool.mutate(()->{tool.draft.region(region(0,96,0,16,112,16));tool.draft.target(SelectionDraft.Target.EDIT,-1);tool.draft.region(region(0,96,0,4,100,4));});tool.read();stage=16;
                }catch(Exception e){fail(c,e);}}));return;
            }
            if(stage==16){
                if(!ready(tool))return;pending=true;tool.checkedCapture().thenCompose(cap->{beforeUnload=cap;return audit(c,cap,false);}).whenComplete((facts,error)->c.execute(()->{pending=false;if(error!=null){fail(c,error);return;}
                    if(facts.get("knownChunks").getAsInt()!=1||facts.get("exactCellsAudited").getAsInt()!=4096){fail(c,new IllegalStateException("Unload source was not actually loaded"));return;}report.add("beforeRealUnload",facts);stage=17;
                }));return;
            }
            if(stage==17){
                pending=true;var server=c.getServer();final var user=c.player.getUuid();
                server.execute(()->{try{var p=server.getPlayerManager().getPlayer(user);if(!p.getServerWorld().getRegistryKey().equals(World.NETHER))throw new IllegalStateException("Unload probe changed dimension");unloadWatch=dev.voxelstudio.WorldChangeTracker.watch(p.getServerWorld(),beforeUnload.selection().context());p.teleport(p.getServerWorld(),1024,100,1024,0,0);c.execute(()->{pending=false;unloadStarted=System.nanoTime();stage=18;ticks=0;});}catch(Exception e){c.execute(()->fail(c,e));}});return;
            }
            if(stage==18){
                if(System.nanoTime()-unloadStarted>120_000_000_000L)throw new IllegalStateException("Real fixture chunk unload not observed within two minutes; no repeated task");
                if(++ticks%20!=0||unloadQuery)return;unloadQuery=true;var server=c.getServer();final var user=c.player.getUuid();
                server.execute(()->{try{var p=server.getPlayerManager().getPlayer(user);boolean gone=p.getServerWorld().getChunkManager().getWorldChunk(0,0)==null;c.execute(()->{unloadQuery=false;if(!gone)return;
                    pending=true;SelectionReadService.checkedCapture(server,user,beforeUnload.id(),beforeUnload.selection().revision()).handle((cap,error)->{if(error==null)throw new CompletionException(new IllegalStateException("Actually unloaded source still publishes its old capture"));return true;}).whenComplete((v,error)->c.execute(()->{pending=false;if(error!=null){fail(c,error);return;}
                        report.addProperty("realLoadedChunkUnloadObserved",true);report.addProperty("unloadedOldCaptureCannotPublish",true);report.addProperty("realUnloadSeconds",(System.nanoTime()-unloadStarted)/1e9);stage=180;ticks=0;
                    }));
                });}catch(Exception e){c.execute(()->fail(c,e));}});return;
            }
            if(stage==180){
                // Keep the EARLY old-capture rejection above. A new unknown
                // capture must begin only after the actual unload event drains,
                // otherwise a later event correctly invalidates this new read.
                if(System.nanoTime()-unloadStarted>120_000_000_000L)throw new IllegalStateException("Unload event/coverage did not settle; no repeated scan");
                if(++ticks%20!=0||unloadQuery)return;unloadQuery=true;var server=c.getServer();final var user=c.player.getUuid();
                server.execute(()->{try{var world=server.getPlayerManager().getPlayer(user).getServerWorld();boolean gone=world.getChunkManager().getWorldChunk(0,0)==null;long revision=unloadWatch.revision();
                    c.execute(()->{unloadQuery=false;if(!gone||revision<=0){unloadStableChecks=0;unloadObservedRevision=revision;return;}
                        unloadStableChecks=revision==unloadObservedRevision?unloadStableChecks+1:1;unloadObservedRevision=revision;if(unloadStableChecks<3)return;
                        report.addProperty("actualUnloadEventDrainedBeforeReread",true);report.addProperty("unloadEventRevision",revision);report.addProperty("stableUnloadedCoverageChecks",unloadStableChecks);
                        unloadWatch.close();unloadWatch=null;tool.read();stage=19;
                    });}catch(Exception e){c.execute(()->fail(c,e));}});return;
            }
            if(stage==19){
                if(!ready(tool))return;pending=true;tool.checkedCapture().thenCompose(cap->{try{Files.writeString(output.resolve("unloaded-capture.json"),cap.payload(),StandardOpenOption.CREATE_NEW);}catch(Exception e){throw new CompletionException(e);}return audit(c,cap,true);}).whenComplete((facts,error)->c.execute(()->{pending=false;if(error!=null){fail(c,error);return;}
                    report.add("afterRealUnload",facts);report.addProperty("unloadedRereadDoesNotReloadChunk",true);try{finish(c);}catch(Exception e){fail(c,e);}
                }));return;
            }
        }catch(Exception e){fail(c,e);}
    }
    private static boolean ready(SelectionController tool){var s=tool.readStatus();if(s==null)throw new IllegalStateException("No selection read");if(EnumSet.of(SelectionReadService.State.FAILED,SelectionReadService.State.STALE,SelectionReadService.State.UNSTABLE,SelectionReadService.State.CANCELLED).contains(s.state()))throw new IllegalStateException(s.reason());return s.state()==SelectionReadService.State.READY;}
    private static CompletableFuture<JsonObject> persisted(SelectionReadService.Capture capture,String name){
        return StudioClient.BRIDGE.saveContext(capture).thenCompose(saved->StudioClient.BRIDGE.readContext(capture).thenApply(readBack->{
            if(!saved.equals(readBack))throw new IllegalStateException("Context read-back differs from upload receipt");
            try{Files.writeString(output.resolve(name+"-context-receipt.json"),saved.toString(),StandardOpenOption.CREATE_NEW);}catch(Exception e){throw new CompletionException(e);}return saved;
        }));
    }
    private static void finish(MinecraftClient c)throws Exception{
        report.addProperty("controlledFixtureWorldChanges",2+fixtureChanges);report.addProperty("highEntropyFixtureWrites",fixtureChanges-3);report.addProperty("result","passed");report.addProperty("version",StudioRuntimeVersion.loaded());report.addProperty("newWorldCreated",true);report.addProperty("worldsCopied",false);report.addProperty("formalWorldOpened",false);report.addProperty("scannerWorldWrites",0);report.addProperty("modelCalls",0);report.addProperty("visibleWindow",true);report.addProperty("canAuthorizePlacement",false);report.addProperty("seconds",(System.nanoTime()-started)/1e9);
        Files.writeString(output.resolve("report.json"),new GsonBuilder().setPrettyPrinting().create().toJson(report),StandardOpenOption.CREATE_NEW);stage=99;c.scheduleStop();
    }
    private static void reveal(Screen screen,ClickableWidget widget){
        screen.mouseScrolled(20,80,1000);for(int i=0;i<100&&!widget.visible;i++)screen.mouseScrolled(20,80,-1);
        if(!widget.visible||!widget.active)throw new IllegalStateException("UI control cannot be reached by scrolling: "+widget.getMessage().getString());
    }
    private static void press(MinecraftClient c,String prefix){
        var screen=c.currentScreen;if(!(screen instanceof SelectionScreen||screen instanceof ContextTaskScreen||screen instanceof StudioInfoScreen||screen instanceof ContextAnalysisSendScreen||screen instanceof ContextAnalysisResultScreen||screen instanceof ContextAnalysisObservationScreen||screen instanceof ContextAnalysisHistoryScreen))throw new IllegalStateException("Expected a real selection/task/details panel");
        var widget=screen.children().stream().filter(x->x instanceof ClickableWidget w&&w.getMessage().getString().startsWith(prefix)).map(x->(ClickableWidget)x).findFirst().orElseThrow(()->new IllegalStateException("Missing UI button: "+prefix));
        if(screen instanceof SelectionScreen)reveal(screen,widget);else if(!widget.visible||!widget.active)throw new IllegalStateException("Task/details control is disabled");double x=widget.getX()+widget.getWidth()/2.0,y=widget.getY()+widget.getHeight()/2.0;
        if(!screen.mouseClicked(x,y,0))throw new IllegalStateException("Button event was not handled: "+prefix);screen.mouseReleased(x,y,0);
    }
    private static boolean active(MinecraftClient c,String prefix){return c.currentScreen.children().stream().anyMatch(v->v instanceof ClickableWidget w&&w.getMessage().getString().startsWith(prefix)&&w.active&&w.visible);}
    private static void nextAnalysis(MinecraftClient c){((ContextAnalysisResultScreen)c.currentScreen).close();((ContextTaskScreen)c.currentScreen).close();startNextAnalysis(c);}
    private static void startNextAnalysis(MinecraftClient c){
        analysisIndex++;press(c,"准备 AI 环境分析任务");var screen=(ContextTaskScreen)c.currentScreen;var field=screen.children().stream().filter(v->v instanceof EditBoxWidget).map(v->(EditBoxWidget)v).findFirst().orElseThrow();field.setText("");
        screen.mouseClicked(field.getX()+8,field.getY()+8,0);screen.mouseReleased(field.getX()+8,field.getY()+8,0);
        for(char ch:("免费游戏分析夹具 ["+ANALYSIS_STATES[analysisIndex]+"]，明确未知，不修改世界。").toCharArray())if(!screen.charTyped(ch,0))throw new IllegalStateException("Fixture native task text rejected");
        press(c,"准备精确任务与隐私披露");stage=128;ticks=0;
    }
    private static void numeric(MinecraftClient c,SelectionRegion r){
        var screen=(SelectionScreen)c.currentScreen;var fields=screen.children().stream().filter(x->x instanceof TextFieldWidget).map(x->(TextFieldWidget)x).toList();
        if(fields.size()!=6)throw new IllegalStateException("Six numeric fields missing");
        for(int i=0;i<6;i++){var field=fields.get(i);reveal(screen,field);field.setText("");
            if(!screen.mouseClicked(field.getX()+6,field.getY()+8,0))throw new IllegalStateException("Coordinate field did not focus");screen.mouseReleased(field.getX()+6,field.getY()+8,0);
            String value=Integer.toString((i<3?r.min():r.max()).axis(i%3));for(char ch:value.toCharArray())if(!screen.charTyped(ch,0))throw new IllegalStateException("Numeric character event not accepted");
            if(!field.getText().equals(value))throw new IllegalStateException("Numeric input was not preserved");
        }
        press(c,"应用六个坐标");
    }
    private static double[] mousePoints(MinecraftClient c){
        var tool=StudioClient.SELECTION;int width=c.getWindow().getScaledWidth(),height=c.getWindow().getScaledHeight();var candidates=new ArrayList<double[]>();
        for(int y=height-46;y>=70;y-=4)for(int x=20;x<width-20;x+=4){try{var p=tool.point(x,y);
            if(Math.abs(p.x())>8||Math.abs(p.z())>8||!tool.draft.context().contains(SelectionRegion.corners(p,p)))continue;
            for(var previous:candidates){var q=tool.point(previous[0],previous[1]);if(Math.abs(q.x()-p.x())>=2&&Math.abs(q.z()-p.z())>=2&&Math.abs(q.x()-p.x())<=6&&Math.abs(q.z()-p.z())<=6)return new double[]{previous[0],previous[1],x,y};}
            if(candidates.size()<64)candidates.add(new double[]{x,y});
        }catch(IllegalStateException ignored){}}
        throw new IllegalStateException("No two real ground raycast points inside context");
    }
    private static double[] dragCoordinates(MinecraftClient c,SelectionRegion r){
        var tool=StudioClient.SELECTION;int width=c.getWindow().getScaledWidth(),height=c.getWindow().getScaledHeight();
        for(int y=70;y<height-44;y+=2)for(int x=20;x<width-20;x+=2){var ray=tool.ray(x,y);var face=SelectionGizmo.hit(r,ray,256);if(face==null)continue;var initial=SelectionGizmo.axisCoordinate(ray,face.axis(),face.point());if(initial==null)continue;
            for(int dy=-24;dy<=24;dy+=4)for(int dx=-24;dx<=24;dx+=4){if(x+dx<20||x+dx>=width-20||y+dy<70||y+dy>=height-44)continue;var value=SelectionGizmo.axisCoordinate(tool.ray(x+dx,y+dy),face.axis(),face.point());if(value==null)continue;
                try{int moved=SelectionGizmo.movedFace(r,face,initial,value);if(Math.abs(moved-(face.maximum()?r.max():r.min()).axis(face.axis()))>4)continue;var next=r.face(face.axis(),face.maximum(),moved);if(next.equals(r)||!tool.draft.context().contains(next)||next.cells()>SelectionLimits.editCells())continue;draggedRegion=next;return new double[]{x,y,x+dx,y+dy};}catch(IllegalArgumentException ignored){}
            }
        }
        throw new IllegalStateException("No visible unambiguous bounded drag face");
    }
    private static SelectionRegion region(int x,int y,int z,int xx,int yy,int zz){return new SelectionRegion(new SelectionRegion.Point(x,y,z),new SelectionRegion.Point(xx,yy,zz));}
    private static void screenshot(MinecraftClient c,String name)throws Exception{try(var image=ScreenshotRecorder.takeScreenshot(c.getFramebuffer())){image.writeTo(output.resolve(name));}}
    private static CompletableFuture<JsonObject> audit(MinecraftClient c,SelectionReadService.Capture cap,boolean unknown){
        var result=new CompletableFuture<JsonObject>();var server=c.getServer();var user=c.player.getUuid();
        // Test-only independent audit; it is NOT a production tick benchmark.
        server.execute(()->{try{
            var world=server.getPlayerManager().getPlayer(user).getServerWorld();var capture=JsonParser.parseString(cap.payload()).getAsJsonObject().getAsJsonObject("capture");int known=0,unavailable=0,cells=0;
            var expected=cap.selection().chunks();var chunks=capture.getAsJsonArray("chunks");if(chunks.size()!=expected.size())throw new IllegalStateException("Chunk coverage mismatch");
            for(int i=0;i<expected.size();i++){var e=expected.get(i);var chunk=chunks.get(i).getAsJsonObject();var live=world.getChunkManager().getWorldChunk(e.x(),e.z());
                if(chunk.get("coverage").getAsString().equals("unknown")){if(live!=null||!chunk.getAsJsonArray("palette").isEmpty()||!chunk.getAsJsonArray("runs").isEmpty())throw new IllegalStateException("Unknown chunk was loaded or fabricated");unavailable++;continue;}
                if(unknown||live==null)throw new IllegalStateException("Remote probe unexpectedly became loaded");known++;int offset=0;var r=e.region();int width=r.max().x()-r.min().x(),length=r.max().z()-r.min().z();
                for(var item:chunk.getAsJsonArray("runs")){var run=item.getAsJsonArray();var p=chunk.getAsJsonArray("palette").get(run.get(0).getAsInt()).getAsJsonObject();for(int n=0;n<run.get(1).getAsInt();n++){var pos=new BlockPos(r.min().x()+offset%width,r.min().y()+offset/(width*length),r.min().z()+offset/width%length);var fact=BlockStateFacts.read(live.getBlockState(pos));if(!fact.state().equals(p.get("state").getAsString())||fact.blockEntity()!=p.get("blockEntity").getAsBoolean())throw new IllegalStateException("Captured block fact differs from world");offset++;cells++;}}
                if(offset!=r.cells())throw new IllegalStateException("RLE omitted cells");
            }
            if(unknown&&unavailable!=expected.size()||!unknown&&known==0)throw new IllegalStateException("No required audit coverage");var facts=new JsonObject();facts.addProperty("knownChunks",known);facts.addProperty("unknownChunks",unavailable);facts.addProperty("exactCellsAudited",cells);facts.addProperty("canAuthorizePlacement",false);result.complete(facts);
        }catch(Exception e){result.completeExceptionally(e);}});return result;
    }
    private static void fail(MinecraftClient c,Throwable error){int failedStage=stage;stage=99;pending=false;if(uiWatch!=null){uiWatch.close();uiWatch=null;}if(unloadWatch!=null){unloadWatch.close();unloadWatch=null;}System.err.println("VOXEL_SELECTION_TEST FAILED "+error);if(output!=null)try{var failure=new JsonObject();failure.addProperty("stage",failedStage);failure.addProperty("error",error.toString());failure.addProperty("selectionStatus",StudioClient.SELECTION.statusText());var read=StudioClient.SELECTION.readStatus();if(read!=null){failure.addProperty("readState",read.state().name());failure.addProperty("readReason",read.reason());}Files.writeString(output.resolve("failure.json"),failure.toString(),StandardOpenOption.CREATE_NEW);}catch(Exception ignored){}StudioClient.SELECTION.cancel();c.scheduleStop();}
}
