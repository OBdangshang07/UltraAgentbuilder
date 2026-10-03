package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.Asset;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import java.nio.file.*;
import java.util.concurrent.CompletableFuture;

/** Opt-in offline-provider UI -> Bridge -> automatic projection test. Never active in a release environment. */
final class StudioFlowSelfTest {
    private static CompletableFuture<Asset> pending;
    private static int stage;
    private static long started;
    private static String job;
    private static boolean extendedCorrections,irisRequested,providerRecoveryRequested;
    private static final JsonObject report=new JsonObject();
    static boolean enabled(){return FabricLoader.getInstance().isDevelopmentEnvironment()&&Boolean.getBoolean("voxelstudio.selftest")&&System.getProperty("voxelstudio.flowTestRoot")!=null;}
    private static Path root()throws Exception{
        Path game=FabricLoader.getInstance().getGameDir().toAbsolutePath().normalize();
        if(!enabled()||!game.toString().replace('\\','/').endsWith("/voxel/mod/run")&&!StudioFlowSandbox.enabled())throw new IllegalStateException("Explicit isolated development flow only");
        Path base=game.resolve("../../build").normalize().toRealPath(),dir=Path.of(System.getProperty("voxelstudio.flowTestRoot")).toRealPath();
        if(!dir.getParent().equals(base)||!dir.getFileName().toString().matches("player-flow-[0-9a-f]{32}"))throw new IllegalStateException("Unsafe flow fixture directory");
        if(StudioFlowSandbox.enabled()&&!StudioFlowSandbox.root().equals(dir))throw new IllegalStateException("Fresh flow output identity mismatch");
        var marker=JsonParser.parseString(Files.readString(dir.resolve("offline-provider.json"))).getAsJsonObject();
        var connection=JsonParser.parseString(Files.readString(dir.resolve("data/connection.json"))).getAsJsonObject();
        if(!marker.get("fixtureOnly").getAsBoolean()||!marker.get("allProvidersReplaced").getAsBoolean()||!"offline-player-fixture".equals(marker.get("model").getAsString())||marker.get("pid").getAsLong()!=connection.get("pid").getAsLong())throw new IllegalStateException("Offline provider identity mismatch");
        return dir;
    }
    static BridgeClient bridge(){
        if(WorldPatchTransactionSelfTest.enabled())try{return WorldPatchTransactionSelfTest.bridge();}catch(Exception e){throw new IllegalStateException("Cannot prepare isolated transaction Bridge",e);}
        if(SelectionSelfTest.enabled())try{return SelectionSelfTest.bridge();}catch(Exception e){throw new IllegalStateException("Cannot prepare isolated selection Bridge",e);}
        if(StudioEvidenceSelfTest.enabled())try{return new BridgeClient(StudioEvidenceSelfTest.root());}catch(Exception e){throw new IllegalStateException("Cannot prepare isolated evidence renderer",e);}
        if(!enabled())return new BridgeClient();
        try{return new BridgeClient(root());}catch(Exception e){throw new IllegalStateException("Cannot prepare isolated offline flow",e);}
    }
    static CompletableFuture<Asset> load(MinecraftClient c){
        if(!enabled()||pending!=null||c.world==null||c.getServer()==null)throw new IllegalStateException("Offline flow may run once in the isolated world");
        pending=new CompletableFuture<>();started=System.nanoTime();stage=1;
        try{
            var marker=JsonParser.parseString(Files.readString(root().resolve("offline-provider.json"))).getAsJsonObject();
            extendedCorrections=marker.has("extendedCorrections")&&marker.get("extendedCorrections").getAsBoolean();
            boolean nativeEvidence=marker.has("nativeEvidence")&&marker.get("nativeEvidence").getAsBoolean();
            int qualityVersion=marker.has("qualityVersion")?marker.get("qualityVersion").getAsInt():nativeEvidence?2:1;
            irisRequested=marker.has("iris")&&marker.get("iris").getAsBoolean();
            verifyIris();
            boolean prototypes=marker.has("prototypes")&&marker.get("prototypes").getAsBoolean();
            String prototypeMode=marker.has("prototypeMode")?marker.get("prototypeMode").getAsString():prototypes?"verified":"off";
            if(!prototypeMode.equals("off")&&!prototypes)throw new IllegalArgumentException("Explicit prototype marker required");
            providerRecoveryRequested=marker.has("providerRecovery")&&marker.get("providerRecovery").getAsBoolean();
            StudioScreen.prepareOfflineFlow(extendedCorrections,nativeEvidence,qualityVersion,prototypeMode,providerRecoveryRequested);c.setScreen(new StudioScreen());
            if(StudioScreen.offlineFlowState().get("providerRecoverySelected").getAsBoolean())throw new IllegalStateException("Recovery must remain off before the normal UI selection");
            report.addProperty("providerRecoveryDefaultOff",true);report.addProperty("providerRecoveryRequested",providerRecoveryRequested);
            if(providerRecoveryRequested){
                if(!StudioScreen.offlineFlowState().get("effort").getAsString().equals("max"))throw new IllegalStateException("Explicit advertised fixture effort missing");
                press(c.currentScreen,"容量恢复：关闭（默认）");
                if(!StudioScreen.offlineFlowState().get("providerRecoverySelected").getAsBoolean())throw new IllegalStateException("Normal recovery selection did not change");
                report.addProperty("normalProviderRecoveryButtonPressed",true);
            }
            press(c.currentScreen,"生成建筑");
            report.addProperty("nativeEvidence",nativeEvidence);
            report.addProperty("qualityVersion",qualityVersion);
            report.addProperty("prototypes",prototypes);
            report.addProperty("prototypeMode",prototypeMode);
            report.addProperty("normalGenerateButtonPressed",true);report.addProperty("realModelCalls",0);
        }catch(Exception e){pending.completeExceptionally(e);}
        return pending;
    }
    static void tick(MinecraftClient c){
        if(!enabled()||pending==null||pending.isDone())return;
        try{
            if(System.nanoTime()-started>600_000_000_000L)throw new IllegalStateException("Offline UI flow timed out");
            var state=StudioScreen.offlineFlowState();
            if(!state.get("providerRecoveryWait").getAsString().isEmpty())report.addProperty("boundedWaitVisibleInProgress",true);
            if(!state.get("error").isJsonNull())throw new IllegalStateException(state.get("error").getAsString());
            if(stage==1){
                if(!(c.currentScreen instanceof StudioInfoScreen)||!c.currentScreen.getTitle().getString().startsWith("确认组件化预算"))return;
                press(c.currentScreen,"确认 · 最多 "+(extendedCorrections?26:8)+" 次");report.addProperty("generationBudgetConfirmations",1);report.addProperty("extendedCorrections",extendedCorrections);stage=2;
            }else if(stage==2){
                if(state.get("activeJob").isJsonNull())return;job=state.get("activeJob").getAsString();
                if(!job.matches("[0-9a-f-]{36}"))throw new IllegalStateException("Invalid submitted job identity");
                report.addProperty("jobId",job);report.add("submittedIdentity",state.get("identity"));
                c.setScreen(null);Files.writeString(root().resolve("client-panel-closed.json"),"{\"closed\":true}",StandardOpenOption.CREATE_NEW);stage=3;
            }else if(stage==3){
                if(c.currentScreen!=null)throw new IllegalStateException("Flow required another modal while the panel was closed");
                var asset=StudioClient.PROJECTION.asset;if(asset==null)return;
                verifyIris();
                if(!asset.revision.equals(job)||asset.diagnosticOnly||asset.height!=224||state.get("busy").getAsBoolean())throw new IllegalStateException("Automatic preview identity/terminal-state mismatch");
                if(providerRecoveryRequested&&(!report.has("boundedWaitVisibleInProgress")||!report.get("boundedWaitVisibleInProgress").getAsBoolean()))throw new IllegalStateException("No truthful capacity wait observed in normal progress");
                report.addProperty("panelClosedDuringAssembly",true);report.addProperty("automaticFinalPreviewLoaded",true);report.addProperty("noIntermediateUserAction",true);report.addProperty("assetHash",asset.hash);
                Files.writeString(root().resolve("client-flow.json"),new GsonBuilder().setPrettyPrinting().create().toJson(report),StandardOpenOption.CREATE_NEW);
                stage=99;pending.complete(asset);
            }
        }catch(Exception e){stage=99;pending.completeExceptionally(e);}
    }
    private static void verifyIris()throws Exception{
        if(!irisRequested)return;
        var api=Class.forName("net.irisshaders.iris.api.v0.IrisApi");var instance=api.getMethod("getInstance").invoke(null);
        if(!(boolean)api.getMethod("isShaderPackInUse").invoke(instance))throw new IllegalStateException("Requested Iris shaderpack is not active in the isolated world");
        report.addProperty("irisShaderPackActive",true);
    }
    private static void press(Screen screen,String label){
        var buttons=screen.children().stream().filter(e->e instanceof ButtonWidget b&&b.getMessage().getString().equals(label)).map(e->(ButtonWidget)e).toList();
        if(buttons.size()!=1||!buttons.get(0).active)throw new IllegalStateException("Missing/disabled normal UI button: "+label);
        if(screen instanceof StudioScreen){
            var side=StudioLayout.of(screen.width,screen.height).content();
            for(int i=0;i<100&&!buttons.get(0).visible;i++)screen.mouseScrolled(side.x()+2,side.y()+2,-1);
        }
        if(!buttons.get(0).visible)throw new IllegalStateException("Normal UI button is not visible: "+label);
        buttons.get(0).onPress();
    }
    static JsonObject evidence(){return report.deepCopy();}
}
