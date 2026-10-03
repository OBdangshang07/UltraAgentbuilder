package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.Asset;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.TitleScreen;
import net.minecraft.client.util.ScreenshotRecorder;
import java.nio.file.*;

/** Opt-in, development-only rendering fixture. No desktop automation, AI generation, or world writes. */
final class StudioUiSelfTest {
    private static int stage,index,ticks;
    private static double originalScale;
    private static final JsonArray evidence=new JsonArray();
    private static final String run=Long.toString(System.currentTimeMillis());
    private static Path directory;
    private static JsonObject current;
    private static Asset beforeDiagnostic;
    static void tick(MinecraftClient c){
        if(!FabricLoader.getInstance().isDevelopmentEnvironment()||!Boolean.getBoolean("voxelstudio.uitest")||stage==99)return;
        try{
            Path game=FabricLoader.getInstance().getGameDir().toAbsolutePath().normalize();
            if(!game.toString().replace('\\','/').endsWith("/voxel/mod/run"))throw new IllegalStateException("Not the isolated UI fixture directory");
            if(c.world!=null||c.getServer()!=null)throw new IllegalStateException("UI fixture must not enter a Minecraft world");
            if(stage==0){
                if(!(c.currentScreen instanceof TitleScreen)||c.getOverlay()!=null||++ticks<40)return;
                originalScale=c.getWindow().getScaleFactor();directory=game.resolve("ui-qa/"+run);Files.createDirectories(directory);
                Path fixture=game.resolve("../build/test-fixtures").normalize();
                if(System.getProperty("voxelstudio.uiAsset")!=null){Path supplied=Path.of(System.getProperty("voxelstudio.uiAsset")).toAbsolutePath().normalize();if(!supplied.startsWith(game.resolve("../../build").normalize()))throw new IllegalStateException("UI asset must be under isolated project build outputs");fixture=supplied;}
                var asset=new Asset("ui-fixture",JsonParser.parseString(Files.readString(fixture.resolve("manifest.json"))).getAsJsonObject(),Files.readAllBytes(fixture.resolve("cells.bin")));
                StudioClient.PROJECTION.load(asset);stage=1;ticks=0;
            }else if(stage==1){
                if(StudioClient.PROJECTION.renderer.building)return;
                if(StudioClient.PROJECTION.renderer.error!=null)throw new IllegalStateException(StudioClient.PROJECTION.renderer.error);
                int scale=index>=31?(index%2==1?3:2):index<9?new int[]{3,2,1}[index/3]:(index>=11&&index<13)||(index>=15&&index<17)||index==19||index==21||index==23||index==25||index==27||index==29?3:2;c.getWindow().setScaleFactor(scale);
                StudioScreen screen=new StudioScreen();c.setScreen(screen);
                if(index<9)current=screen.auditUi(StudioScreen.Tab.values()[index%3]);
                else if(index==9){
                    java.util.List<StudioChoiceScreen.Choice> choices=new java.util.ArrayList<>();for(int i=0;i<30;i++)choices.add(new StudioChoiceScreen.Choice("test-model-"+i,"test-model-"+i,"仅用于界面验证的测试选项，不会调用模型"));
                    var selected=new java.util.concurrent.atomic.AtomicReference<String>();
                    var chooser=new StudioChoiceScreen(screen,"选择制作模型 · UI 测试数据",choices,"test-model-2",selected::set);c.setScreen(chooser);chooser.auditSelection();
                    if(!"test-model-27".equals(selected.get()))throw new IllegalStateException("Selection returned wrong model id");c.setScreen(chooser);
                    current=new JsonObject();current.addProperty("tab","model-select");current.addProperty("searchAndSelectionPassed",true);
                }else if(index==10){
                    String text="确认将修改世界。\n\n覆盖策略：仅填空气，保留已有建筑和地形。\n\n建筑：界面测试样例\n尺寸：19 × 14 × 17\n锚点：-123, 64, 256\n方向：90°，X 轴镜像\n\n确认前请备份或使用创造测试世界。后续编辑会保留，已完成的部分可撤销。\n\n这是测试确认页，本次没有加载世界，也不会实际建造。";
                    var confirmation=new StudioInfoScreen(screen,"确认建造 · UI 测试",text,"确认建造",true,()->{throw new IllegalStateException("Confirmation must not be activated by default Enter");});
                    c.setScreen(confirmation);confirmation.keyPressed(org.lwjgl.glfw.GLFW.GLFW_KEY_ENTER,0,0);if(c.currentScreen!=screen)throw new IllegalStateException("Default confirmation focus was not the safe return action");c.setScreen(confirmation);
                    current=new JsonObject();current.addProperty("tab","confirmation");current.addProperty("defaultEnterReturnsWithoutWriting",true);
                }else if(index<15){
                    boolean diagnostics=index%2==1;
                    c.setScreen(diagnostics?new StudioDiagnosticsScreen(screen,()->{}).auditFixture():new StudioRecoveryScreen(screen).auditFixture());
                    for(var child:c.currentScreen.children())if(child instanceof net.minecraft.client.gui.widget.ClickableWidget widget&& (widget.getX()<0||widget.getY()<0||widget.getX()+widget.getWidth()>c.currentScreen.width||widget.getY()+widget.getHeight()>c.currentScreen.height))throw new IllegalStateException("Recovery/diagnostics control outside viewport");
                    current=new JsonObject();current.addProperty("tab",diagnostics?"diagnostics":"recovery");current.addProperty("fixedControlsInBounds",true);current.addProperty("fixtureOnly",true);
                }else if(index>=65){
                    current=screen.auditAssembly((index-65)/2);
                }else if(index>=59){
                    current=screen.auditCheckpoints((index-59)/2);
                }else if(index>=55){
                    current=screen.auditFailedRepairUi(index>=57);
                }else if(index>=51){
                    Path fixture=game.resolve("../build/test-fixtures/scene-diagnostic").normalize();
                    var diagnostic=new Asset("diagnostic-ui-fixture",JsonParser.parseString(Files.readString(fixture.resolve("manifest.json"))).getAsJsonObject(),Files.readAllBytes(fixture.resolve("cells.bin")));
                    beforeDiagnostic=StudioClient.PROJECTION.asset;
                    c.setScreen(new StudioFailedDesignScreen(screen,diagnostic,"Ownership fixture"));
                    if(StudioClient.PROJECTION.asset!=beforeDiagnostic)throw new IllegalStateException("Diagnostic replaced current building");
                    for(var child:c.currentScreen.children())if(child instanceof net.minecraft.client.gui.widget.ClickableWidget widget&&(widget.getX()<0||widget.getY()<0||widget.getX()+widget.getWidth()>c.currentScreen.width||widget.getY()+widget.getHeight()>c.currentScreen.height))throw new IllegalStateException("Diagnostic control outside viewport");
                    current=new JsonObject();current.addProperty("tab",index>=53?"failed-design-section":"failed-design-whole");current.addProperty("fixedControlsInBounds",true);current.addProperty("noGenerationSubmitted",true);
                }else if(index>=41){
                    current=screen.auditSceneUi(index-41);
                }else if(index>=39){
                    current=screen.auditVisualReview();
                }else if(index>=37){
                    var review=new StudioInfoScreen(screen,"确认建造 · 通行未验证","通行未验证\n建筑可预览，但可能存在入口堵塞、缺地板或断开的楼层。\n\n楼梯 stair_a2：单列台阶柱已按原几何解释；入口 [21,1,46] 为 KEEP，未明确清空。\n\n本页只是隔离界面测试，未加载世界；风险确认默认不勾选。","确认建造",true,true,()->{throw new IllegalStateException("Review fixture must never submit placement");});
                    c.setScreen(review);review.auditAcknowledgement();review.keyPressed(org.lwjgl.glfw.GLFW.GLFW_KEY_ENTER,0,0);if(c.currentScreen!=screen)throw new IllegalStateException("Review default Enter did not return safely");c.setScreen(review);
                    current=new JsonObject();current.addProperty("tab","navigation-review");current.addProperty("acknowledgementRequired",true);current.addProperty("defaultEnterReturnsWithoutWriting",true);current.addProperty("noGenerationSubmitted",true);
                }else if(index>=31){
                    current=screen.auditGenerationOptions(index>=33,index>=35);
                }else if(index>=27){
                    current=screen.auditFailureUi(index>=29);
                }else if(index>=21){
                    current=screen.auditDiscoveryUi(index>=23&&index<25,index>=25);
                    for(var child:c.currentScreen.children())if(child instanceof net.minecraft.client.gui.widget.ClickableWidget widget&&(widget.getX()<0||widget.getY()<0||widget.getX()+widget.getWidth()>c.currentScreen.width||widget.getY()+widget.getHeight()>c.currentScreen.height)&&index>=25)throw new IllegalStateException("Agent discovery chooser control outside viewport");
                }else if(index>=19){
                    current=screen.auditDeepseekUi();
                }else if(index%2==1){
                    current=screen.auditClaudeUi();
                }else{
                    c.setScreen(new StudioImportScreen(screen));
                    for(var child:c.currentScreen.children())if(child instanceof net.minecraft.client.gui.widget.ClickableWidget widget&&(widget.getX()<0||widget.getY()<0||widget.getX()+widget.getWidth()>c.currentScreen.width||widget.getY()+widget.getHeight()>c.currentScreen.height))throw new IllegalStateException("Import control outside viewport");
                    current=new JsonObject();current.addProperty("tab","import");current.addProperty("fixedControlsInBounds",true);current.addProperty("fixtureOnly",true);
                }
                current.addProperty("scale",scale);
                stage=2;ticks=0;
            }else if(stage==2&&++ticks>16){
                if(c.currentScreen instanceof StudioFailedDesignScreen diagnostic){
                    if(!diagnostic.readyForAudit()){if(ticks>2400)throw new IllegalStateException("Diagnostic mesh timeout");return;}
                    if(diagnostic.meshError()!=null)throw new IllegalStateException(diagnostic.meshError());
                    if(index>=53&&!current.has("conflictPointLocated")){diagnostic.auditNext();current.addProperty("conflictPointLocated",true);ticks=0;return;}
                    if(StudioClient.PROJECTION.asset!=beforeDiagnostic)throw new IllegalStateException("Diagnostic changed world projection");
                    current.addProperty("originalAssetPreserved",true);
                }
                String filename="ui-"+current.get("scale").getAsInt()+"-"+current.get("tab").getAsString().toLowerCase()+".png";
                // Capture only this mod's OpenGL render target, not the desktop or another app.
                try(var frame=ScreenshotRecorder.takeScreenshot(c.getFramebuffer())){frame.writeTo(directory.resolve(filename));}
                if(c.currentScreen instanceof StudioFailedDesignScreen diagnostic){diagnostic.close();if(StudioClient.PROJECTION.asset!=beforeDiagnostic)throw new IllegalStateException("Closing diagnostic lost original building");current.addProperty("returnPreservesOriginal",true);}
                current.addProperty("frame",filename);evidence.add(current);index++;stage=index<81?1:3;
            }else if(stage==3){
                JsonObject report=new JsonObject();report.addProperty("version",StudioRuntimeVersion.loaded());report.addProperty("result","passed");report.addProperty("noWorldLoaded",true);report.addProperty("noGenerationSubmitted",true);report.add("layouts",evidence);
                Files.writeString(directory.resolve("report.json"),new GsonBuilder().setPrettyPrinting().create().toJson(report));
                System.out.println("VOXEL_STUDIO_UI_TEST "+directory+" passed");stage=99;c.getWindow().setScaleFactor(originalScale);c.scheduleStop();
            }
        }catch(Exception e){stage=99;System.err.println("VOXEL_STUDIO_UI_TEST FAILED "+e);if(directory!=null)try{Files.writeString(directory.resolve("failure.txt"),e.toString());}catch(Exception ignored){}c.scheduleStop();}
    }
}
