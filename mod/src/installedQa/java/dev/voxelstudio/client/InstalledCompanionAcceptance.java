package dev.voxelstudio.client;

import com.google.gson.*;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.*;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.client.gui.widget.PressableWidget;
import net.minecraft.client.gui.widget.TextFieldWidget;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.CompletableFuture;

/** Test-only auxiliary MOD, not a production entrypoint. No world or model
 * task may be opened in this zero-call installation gate. The production
 * StudioClient uses its unmodified default built-in BridgeClient. */
public final class InstalledCompanionAcceptance implements ClientModInitializer {
    private final java.util.function.Consumer<MinecraftClient> afterInstallation;
    public InstalledCompanionAcceptance(){this(null);}
    InstalledCompanionAcceptance(java.util.function.Consumer<MinecraftClient> afterInstallation){this.afterInstallation=afterInstallation;}
    private Path output,game;private JsonObject authorization;private int stage,ticks;
    private long started;private boolean pending,done;
    private final JsonObject report=new JsonObject();
    @Override public void onInitializeClient(){
        try{
            var loader=FabricLoader.getInstance();
            if(loader.isDevelopmentEnvironment())throw new IllegalStateException("Installed gate must NOT run a development client");
            for(var key:System.getProperties().stringPropertyNames())
                if(key.startsWith("voxelstudio.")&&!key.equals("voxelstudio.installedQaRoot"))throw new IllegalStateException("Production self-test/Bridge overrides are forbidden");
            String explicit=System.getProperty("voxelstudio.installedQaRoot");
            if(explicit==null)throw new IllegalStateException("Explicit newly owned installed fixture required");
            output=Path.of(explicit).toAbsolutePath().normalize().toRealPath();game=loader.getGameDir().toAbsolutePath().normalize().toRealPath();
            if(!output.getFileName().toString().matches("installed-companion-game-[a-f0-9]{32}")||!game.equals(output.resolve("game")))throw new IllegalStateException("Unsafe installed fixture");
            authorization=read(output.resolve("authorization.json"));
            Path development=Path.of(authorization.get("developmentRoot").getAsString()).toAbsolutePath().normalize().toRealPath();
            if(!development.getFileName().toString().matches("p3-selection-development-[a-f0-9]{32}")||!output.getParent().equals(development.getParent()))throw new IllegalStateException("Installed output is not a newly owned development sibling");
            var copy=read(development.resolve("development-workspace.json"));
            if(!copy.get("result").getAsString().equals("passed")||!copy.get("developmentOnly").getAsBoolean()||copy.get("worldsCopied").getAsBoolean()||copy.get("accountDataCopied").getAsBoolean())throw new IllegalStateException("Unsafe development ownership receipt");
            if(!authorization.get("gameDirectory").getAsString().equals(game.toString())||!authorization.get("zeroGenerationCalls").getAsBoolean()
                ||!authorization.get("visibleWindowAuthorized").getAsBoolean()||authorization.get("formalWorldAuthorized").getAsBoolean())throw new IllegalStateException("Invalid bounded read-only authorization");
            Path jar=game.resolve("mods/UltraAgentbuilder-0.4.10-alpha.jar").toRealPath();
            String jarHash=hash(Files.readAllBytes(jar));
            if(!jarHash.equals(authorization.get("productionJarSha256").getAsString()))throw new IllegalStateException("Installed JAR does not match gate pin");
            var mod=loader.getModContainer("voxel_studio").orElseThrow();
            if(!mod.getOrigin().getPaths().equals(List.of(jar))||!mod.getMetadata().getVersion().getFriendlyString().equals("0.4.10-alpha"))throw new IllegalStateException("Not the installed production MOD");
            String classUrl=StudioClient.class.getResource("StudioClient.class").toString();
            if(!classUrl.startsWith("jar:"+jar.toUri().toURL()+"!/"))throw new IllegalStateException("Production class was shadowed by development classes");
            if(!BuiltinCompanion.bundled()||!StudioClient.BRIDGE.dataDirectory().equals(game.resolve("voxel-studio/data")))throw new IllegalStateException("Default built-in Bridge path was replaced");
            if(Files.exists(game.resolve("saves")))throw new IllegalStateException("No saves may preexist at installed startup");
            report.addProperty("productionJarSha256",jarHash);report.addProperty("productionClassUrl",classUrl);
            report.addProperty("developmentEnvironment",false);report.addProperty("defaultBuiltinBridge",true);
            var identity=new JsonObject();identity.addProperty("pid",ProcessHandle.current().pid());
            identity.addProperty("startedAt",ProcessHandle.current().info().startInstant().orElseThrow().toEpochMilli());write("process.json",identity);
            started=System.nanoTime();ClientTickEvents.END_CLIENT_TICK.register(this::tick);
        }catch(Throwable error){throw new IllegalStateException("Installed acceptance authorization rejected",error);}
    }
    private void tick(MinecraftClient c){if(done)return;try{
        if(c.world!=null||c.getServer()!=null)throw new IllegalStateException("Zero-call installed gate must not enter ANY world");
        if(++ticks%20==0){var progress=new JsonObject();progress.addProperty("stage",stage);progress.addProperty("pending",pending);progress.addProperty("seconds",(System.nanoTime()-started)/1e9);progress.addProperty("screen",c.currentScreen==null?"none":c.currentScreen.getClass().getSimpleName());Files.writeString(output.resolve("progress.json"),progress.toString());}
        if(System.nanoTime()-started>240_000_000_000L)throw new IllegalStateException("Installation observation timed out; retain fixture, do not replay");
        if(pending)return;c.options.pauseOnLostFocus=false;
        if(org.lwjgl.glfw.GLFW.glfwGetWindowAttrib(c.getWindow().getHandle(),org.lwjgl.glfw.GLFW.GLFW_VISIBLE)!=org.lwjgl.glfw.GLFW.GLFW_TRUE)throw new IllegalStateException("Visible fixture window required");
        if(stage==0){if(c.currentScreen instanceof AccessibilityOnboardingScreen){c.options.onboardAccessibility=false;c.options.write();c.setScreen(new TitleScreen());return;}
            if(!(c.currentScreen instanceof TitleScreen)||c.getOverlay()!=null||ticks<40)return;
            c.setScreen(new StudioScreen());stage=1;
            await(c,StudioClient.BRIDGE.request("GET","/v2/world-patch/capabilities",null),capabilities->{
                String runtime=WorldPatchJobReceipt.sendingCapabilitiesRuntime(capabilities);if(runtime==null)throw new IllegalStateException("Installed built-in SEND is disabled");
                report.addProperty("runtimeHash",runtime);report.addProperty("v2SendCapabilityEnabled",true);
                if(capabilities.get("canAuthorizePlacement").getAsBoolean())throw new IllegalStateException("Capabilities must not authorize world writes");
                stage=2;
            });return;
        }
        if(stage==2){await(c,StudioClient.BRIDGE.request("GET","/v1/agents/codex/models",null),models->{
                JsonObject selected=null;for(var value:models.getAsJsonArray("models")){var item=value.getAsJsonObject();if(item.get("id").getAsString().equals("gpt-6.1-sol"))selected=item;}
                if(selected==null)throw new IllegalStateException("Authorized exact model is absent; no substitution");
                boolean max=false;for(var effort:selected.getAsJsonArray("efforts"))max|=(effort.isJsonObject()?effort.getAsJsonObject().get("reasoningEffort").getAsString():effort.getAsString()).equals("max");
                if(!max)throw new IllegalStateException("Selected model does not advertise Max");
                report.addProperty("authorizedModelAvailable",true);stage=3;
            });return;
        }
        if(stage==3){if(!(c.currentScreen instanceof StudioScreen))throw new IllegalStateException("Lost normal workspace");if(!active(c,"本机 Agent"))return;press(c,"本机 Agent");stage=4;return;}
        if(stage==4){if(!(c.currentScreen instanceof StudioChoiceScreen))return;if(!active(c,"Codex ·"))return;press(c,"Codex ·");stage=5;return;}
        if(stage==5){if(!(c.currentScreen instanceof StudioScreen)||!active(c,"模型："))return;press(c,"模型：");stage=6;return;}
        if(stage==6){if(!(c.currentScreen instanceof StudioChoiceScreen))return;search(c,"gpt-6.1-sol");press(c,"gpt-6.1-sol");stage=7;return;}
        if(stage==7){if(!(c.currentScreen instanceof StudioScreen)||!active(c,"推理："))return;press(c,"推理：");stage=8;return;}
        if(stage==8){if(!(c.currentScreen instanceof StudioChoiceScreen))return;search(c,"max");press(c,"最高 · max");stage=9;return;}
        if(stage==9){var recipient=StudioScreen.contextRecipient();if(!recipient.get("agent").getAsString().equals("codex")||!recipient.get("model").getAsString().equals("gpt-6.1-sol")||!recipient.get("effort").getAsString().equals("max"))throw new IllegalStateException("Normal UI did not bind exact authorized recipient");
            report.add("recipient",recipient);report.addProperty("normalAgentModelEffortUi",true);
            var connection=read(StudioClient.BRIDGE.dataDirectory().resolve("connection.json"));long pid=connection.get("pid").getAsLong();
            var owned=ProcessHandle.of(pid).orElseThrow();if(!owned.isAlive()||owned.parent().orElseThrow().pid()!=ProcessHandle.current().pid())throw new IllegalStateException("Builtin process must be owned by THIS installed JVM");
            report.addProperty("bridgePid",pid);report.addProperty("bridgeParentPid",owned.parent().orElseThrow().pid());
            report.addProperty("bridgeStartedAt",owned.info().startInstant().orElseThrow().toEpochMilli());
            for(String folder:List.of("jobs","context-analysis","world-patch-design")){var p=StudioClient.BRIDGE.dataDirectory().resolve(folder);if(Files.exists(p))try(var files=Files.list(p)){if(files.findAny().isPresent())throw new IllegalStateException("Opening/selecting UI unexpectedly created a model task");}}
            if(Files.exists(game.resolve("saves")))try(var files=Files.list(game.resolve("saves"))){if(files.findAny().isPresent())throw new IllegalStateException("Read-only installation gate created a save");}
            report.addProperty("result","passed");report.addProperty("modelCalls",0);report.addProperty("worldWrites",0);report.addProperty("worldOpened",false);
            report.addProperty("freshInstallation",true);report.addProperty("realModelPlayerFlowVerified",false);
            try(var image=net.minecraft.client.util.ScreenshotRecorder.takeScreenshot(c.getFramebuffer())){image.writeTo(output.resolve("installed-model-selected.png"));}
            write(afterInstallation==null?"game-report.json":"installation-phase.json",report);done=true;
            if(afterInstallation==null)c.scheduleStop();else afterInstallation.accept(c);
        }
    }catch(Throwable error){fail(c,error);}}
    @FunctionalInterface private interface Result {void accept(JsonObject value)throws Exception;}
    private void await(MinecraftClient c,CompletableFuture<JsonObject> future,Result action){pending=true;future.whenComplete((value,error)->c.execute(()->{pending=false;if(done)return;if(error!=null){fail(c,error);return;}try{action.accept(value);}catch(Throwable e){fail(c,e);}}));}
    private void fail(MinecraftClient c,Throwable e){done=true;try{var failure=new JsonObject();failure.addProperty("result","failed");failure.addProperty("stage",stage);failure.addProperty("error",e.toString());write("failure.json",failure);}catch(Exception ignored){}e.printStackTrace();c.scheduleStop();}
    private void write(String name,JsonObject value)throws Exception{Files.writeString(output.resolve(name),new GsonBuilder().setPrettyPrinting().create().toJson(value),StandardOpenOption.CREATE_NEW);}
    private static JsonObject read(Path file)throws Exception{return JsonParser.parseString(Files.readString(file)).getAsJsonObject();}
    private static String hash(byte[] bytes)throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}
    private static List<ClickableWidget> buttons(MinecraftClient c,String prefix){if(c.currentScreen==null)return List.of();return c.currentScreen.children().stream().filter(e->e instanceof ClickableWidget b&&b.getMessage().getString().replaceFirst("^✓ ","").toLowerCase(Locale.ROOT).startsWith(prefix.toLowerCase(Locale.ROOT))).map(e->(ClickableWidget)e).toList();}
    private static boolean active(MinecraftClient c,String prefix){var found=buttons(c,prefix);return found.size()==1&&found.get(0).active;}
    private static void press(MinecraftClient c,String prefix){var found=buttons(c,prefix);if(found.size()!=1||!found.get(0).active)throw new IllegalStateException("Missing/ambiguous normal UI button: "+prefix);var b=found.get(0);if(b instanceof StudioTheme.Button)((PressableWidget)b).onPress();else throw new IllegalStateException("Not a normal production button");}
    private static void search(MinecraftClient c,String value){var fields=c.currentScreen.children().stream().filter(e->e instanceof TextFieldWidget).map(e->(TextFieldWidget)e).toList();if(fields.size()!=1)throw new IllegalStateException("Unique normal choice search required");fields.get(0).setText(value);}
}
