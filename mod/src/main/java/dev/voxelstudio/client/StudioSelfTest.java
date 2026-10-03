package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.*;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.block.*;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.util.ScreenshotRecorder;
import net.minecraft.util.math.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/** Explicit opt-in DEVELOPMENT fixture only. Never active in a distributed Fabric JAR. */
final class StudioSelfTest {
    private static int stage, ticks;
    private static boolean inFlight;
    private static boolean launching;
    private static Placement placement;
    private static Map<BlockPos,BlockState> before;
    private static Map<BlockPos,BlockState> reviewBefore;
    private static BlockPos edited;
    private static long oldClientRevision;
    private static BlockState transientBefore;
    private static IsolatedRandomTickGuard randomTicks;
    private static BlockPos unloadedProbeAnchor;
    private static boolean unloadedProbePassed,clientProbePositioned;
    private static Vec3d originalPlayerPosition;
    private static float originalPlayerYaw,originalPlayerPitch;
    private static IsolatedTestWindow testWindow;
    private static Path progressFile;
    private static int checkpointStage=-1;
    private static boolean checkpointInFlight;
    private static final JsonObject report = new JsonObject();
    static boolean enabled(){return FabricLoader.getInstance().isDevelopmentEnvironment()&&Boolean.getBoolean("voxelstudio.selftest");}
    static void tick(MinecraftClient c) {
        if (!enabled())return;
        // Automated tests render to their own framebuffer. They must not steal
        // desktop typing or accept a second, manual placement during assertions.
        try {
            if(testWindow==null)testWindow=new IsolatedTestWindow(System.getProperty("voxelstudio.testWindowHideMode","transition"));
            long handle=c.getWindow().getHandle();
            testWindow.maintain(()->org.lwjgl.glfw.GLFW.glfwGetWindowAttrib(handle,org.lwjgl.glfw.GLFW.GLFW_VISIBLE)==org.lwjgl.glfw.GLFW.GLFW_TRUE,()->org.lwjgl.glfw.GLFW.glfwHideWindow(handle));
            checkpoint(c,false);
        }catch(Exception e){if(stage!=99)fail(c,e);return;}
        if(inFlight || stage == 99)return;
        c.options.pauseOnLostFocus=false;
        if (c.player == null || c.getServer() == null) {
            if(freshSandbox()&&c.currentScreen instanceof net.minecraft.client.gui.screen.AccessibilityOnboardingScreen){c.options.onboardAccessibility=false;c.options.write();c.setScreen(new net.minecraft.client.gui.screen.TitleScreen());ticks=0;return;}
            if (!launching && c.getOverlay()==null && c.currentScreen instanceof net.minecraft.client.gui.screen.TitleScreen && ++ticks>40) {
                if(freshSandbox()){
                    try{if(StudioRealAssetSandbox.enabled())StudioRealAssetSandbox.create(c);else StudioFlowSandbox.create(c);launching=true;ticks=0;report.addProperty("newWorldCreated",true);report.addProperty("worldsCopied",false);report.addProperty("formalWorldOpened",false);report.addProperty("worldName",StudioRealAssetSandbox.enabled()?StudioRealAssetSandbox.approved().worldName():System.getProperty("voxelstudio.flowFreshWorld"));}catch(Exception e){fail(c,e);}return;
                }
                Path dir=FabricLoader.getInstance().getGameDir().toAbsolutePath().normalize();
                if (!dir.toString().replace('\\','/').endsWith("/voxel/mod/run") || !Files.isDirectory(dir.resolve("saves/新的世界"))) { fail(c,new IllegalStateException("Isolated fixture world is missing")); return; }
                launching=true;ticks=0;c.createIntegratedServerLoader().start(c.currentScreen,"新的世界");
            }
            return;
        }
        // Exact test-instance boundary, independent of any source/AI-generated data.
        Path world = c.getServer().getSavePath(net.minecraft.util.WorldSavePath.ROOT).toAbsolutePath().normalize();
        Path permitted = FabricLoader.getInstance().getGameDir().resolve("saves").toAbsolutePath().normalize();
        if(freshSandbox()){try{verifyFreshWorld(c);}catch(Exception e){fail(c,e);return;}}
        else if (!world.startsWith(permitted) || !permitted.toString().replace('\\','/').endsWith("/voxel/mod/run/saves")) { fail(c,new IllegalStateException("Not the isolated development test world")); return; }
        if (++ticks < 80) return;
        var projection=StudioClient.PROJECTION;
        try {
            if (stage==0) {
                // Validate synchronously, before an async callback can swallow
                // an invalid test parameter and leave inFlight set forever.
                var testAnchor=fixtureAnchor();
                inFlight=true;
                report.addProperty("isolatedHiddenTestWindow",!testWindow.mode().equals("visible"));
                report.addProperty("isolatedVisibleTestWindow",testWindow.mode().equals("visible"));
                report.addProperty("initialScreen",c.currentScreen==null?"none":c.currentScreen.getClass().getSimpleName());
                // The world-scroll contract deliberately rejects input while a UI is open.
                // Enter gameplay explicitly in this isolated development harness.
                c.setScreen(null);
                boolean irisRequested=Boolean.getBoolean("voxelstudio.iristest");
                if(irisRequested){
                    var api=Class.forName("net.irisshaders.iris.api.v0.IrisApi");var instance=api.getMethod("getInstance").invoke(null);
                    if(!(boolean)api.getMethod("isShaderPackInUse").invoke(instance))throw new IllegalStateException("Requested Iris shaderpack is not active in this isolated placement world");
                }
                report.addProperty("irisShaderPackActive",irisRequested);
                String fixture=System.getProperty("voxelstudio.testFixture");CompletableFuture<Asset> loaded;
                if(StudioFlowSelfTest.enabled()){
                    loaded=StudioFlowSelfTest.load(c);report.addProperty("fixtureProviderFlow",true);report.addProperty("noRealGenerationSubmitted",true);
                }else if(fixture!=null){
                    if(!fixture.matches("[a-z0-9-]{1,64}"))throw new IllegalArgumentException("Unsafe isolated fixture name");
                    Path dir=FabricLoader.getInstance().getGameDir().resolve("../build/test-fixtures/"+fixture).normalize();
                    byte[] manifestBytes=Files.readAllBytes(dir.resolve("manifest.json")),cellBytes=Files.readAllBytes(dir.resolve("cells.bin"));
                    var manifest=JsonParser.parseString(new String(manifestBytes,java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
                    String revision="isolated-native-fixture";
                    if(StudioRealAssetSandbox.enabled()){
                        var approval=StudioRealAssetSandbox.approved();StudioRealAssetAuthorization.verifyFixture(approval,approval.game().getParent().getParent(),manifestBytes,cellBytes);
                        revision=approval.jobId();report.addProperty("realAssetPlacementFixture",true);report.addProperty("originalJobId",revision);
                    }
                    loaded=CompletableFuture.completedFuture(new Asset(revision,manifest,cellBytes));
                    report.addProperty("fixture",fixture);report.addProperty("noGenerationSubmitted",true);
                    if(manifest.has("scene"))report.add("sceneCompiler",manifest.getAsJsonObject("scene").get("compiler"));
                }else loaded=StudioClient.BRIDGE.load(System.getProperty("voxelstudio.testJob"));
                loaded.whenComplete((a,e)->c.execute(()->{
                    if(e!=null){fail(c,e);return;}
                    if(StudioFlowSelfTest.enabled())report.add("playerFlow",StudioFlowSelfTest.evidence());
                    if(a.navigationAcknowledgementRequired&&!navigationAcknowledged()){fail(c,new IllegalStateException("This fixture requires explicit -PstudioTestNavigationAcknowledged; quality is not waived"));return;}
                    recoverFixtureLights(c,a).whenComplete((recovery,error)->c.execute(()->{
                    try {
                    inFlight=false;if(error!=null){fail(c,error);return;}if(recovery!=null)report.add("explicitFixtureLightRecovery",recovery);
                    report.addProperty("fixtureNavigationAcknowledged",navigationAcknowledged());report.addProperty("version",StudioRuntimeVersion.loaded());report.addProperty("sceneDesign",a.sceneDesign);report.addProperty("assetHeight",a.height);report.addProperty("assetVolume",a.volume());
                    report.addProperty("assetHash",a.hash);
                    projection.load(a);projection.coordinates(testAnchor);projection.rotation=1;projection.mirror=true;projection.renderer.rebuild(projection.placement());projection.locked=true;projection.show();stage=1;ticks=0;
                    } catch(Exception callbackError){fail(c,callbackError);}
                    }));
                }));
            } else if(stage==1 && !projection.renderer.building) {
                if(projection.renderer.error!=null)throw new IllegalStateException(projection.renderer.error);
                // A real client scan must not mistake the vanilla fallback
                // EmptyChunk's void air for available space. Preview only: no
                // server check, generation or world write at the remote anchor.
                if(unloadedProbeAnchor==null){
                    unloadedProbeAnchor=projection.anchor;projection.coordinates(unloadedProbeAnchor.add(4096,0,4096));ticks=0;return;
                }
                if(!unloadedProbePassed){
                    if(!projection.checked()){if(ticks>600)throw new IllegalStateException("Unloaded-region scan did not finish");return;}
                    if(projection.unknown<=0||projection.canPlace())throw new IllegalStateException("Unloaded client region was treated as placeable air");
                    BlockPos remote=projection.anchor;projection.ground();
                    if(!projection.anchor.equals(remote)||!projection.status.contains("区块未加载"))throw new IllegalStateException("Ground snapping used an unloaded client chunk");
                    report.addProperty("unloadedClientRegionCannotConfirm",true);report.addProperty("unloadedClientCells",projection.unknown);report.addProperty("unloadedClientGroundSnapRejected",true);
                    unloadedProbePassed=true;projection.coordinates(unloadedProbeAnchor);ticks=0;return;
                }
                report.addProperty("initialMeshFaces",projection.renderer.faceCount);report.addProperty("initialMeshBuildMillis",projection.renderer.buildMillis);
                var savedAnchor=projection.anchor;
                projection.coordinates(new BlockPos(savedAnchor.getX(),c.world.getTopY()-projection.asset.height+1,savedAnchor.getZ()));
                if(projection.canPlace()||!projection.placementBlockReason().contains("高度"))throw new IllegalStateException("Out-of-world height was not blocked");
                projection.coordinates(savedAnchor);report.addProperty("heightPlacementGuard",true);
                placement=new Placement(projection.asset,projection.anchor,1,true,projection.transformRevision,true);
                inFlight=true;
                c.getServer().execute(()->{
                    try {
                        var w=c.getServer().getPlayerManager().getPlayer(c.player.getUuid()).getServerWorld();
                        // Exact placement/undo tests must not race vanilla copper
                        // oxidation. This guard is acquired ONLY after the dev
                        // world boundary checks above, and restored on all exits.
                        Path game=FabricLoader.getInstance().getGameDir().toAbsolutePath().normalize();
                        String worldId=c.getServer().getSavePath(net.minecraft.util.WorldSavePath.ROOT).toAbsolutePath().normalize().toString();
                        randomTicks=IsolatedRandomTickGuard.open(game.resolve("selftest-random-ticks.json"),worldId,
                            ()->w.getGameRules().getInt(net.minecraft.world.GameRules.RANDOM_TICK_SPEED),
                            value->w.getGameRules().get(net.minecraft.world.GameRules.RANDOM_TICK_SPEED).set(value,c.getServer()));
                        report.addProperty("randomTicksSuspendedForExactAssertions",true);
                        report.addProperty("originalRandomTickSpeed",randomTicks.original);
                        report.addProperty("recoveredPriorTestRandomTickRule",randomTicks.recovered);
                        for(int i=0;i<placement.asset().volume();i++)if(!w.isChunkLoaded(placement.world(i)))throw new IllegalStateException("Test chunk not loaded");
                        int clear=-1,keep=-1;
                        for(int i=0;i<placement.asset().volume();i++){if(clear<0&&placement.asset().cell(i)==1)clear=i;if(keep<0&&placement.asset().cell(i)==0)keep=i;}
                        if(clear<0||keep<0)throw new IllegalStateException("Fixture masks missing");
                        w.setBlockState(placement.world(clear),Blocks.STONE.getDefaultState(),Block.NOTIFY_LISTENERS|Block.FORCE_STATE);
                        w.setBlockState(placement.world(keep),Blocks.GOLD_BLOCK.getDefaultState(),Block.NOTIFY_LISTENERS|Block.FORCE_STATE);
                        before=new HashMap<>();int matchingSolids=0,changedSolids=0;
                        for(int i=0;i<placement.asset().volume();i++){
                            BlockState prior=w.getBlockState(placement.world(i));before.put(placement.world(i),prior);
                            if(placement.asset().cell(i)>=2){if(prior.equals(placement.state(i)))matchingSolids++;else changedSolids++;}
                        }
                        report.addProperty("alreadyMatchingSetCellsBefore",matchingSolids);report.addProperty("intendedChangedSetCells",changedSolids);
                        report.addProperty("fixtureAnchor",placement.anchor().toShortString());
                        c.execute(()->{stage=2;ticks=0;inFlight=false;});
                    }catch(Exception e){c.execute(()->fail(c,e));}
                });
            } else if(stage==2) {
                // Preview transitions must leave every real cell untouched.
                projection.move(1,0,0);projection.move(-1,0,0);
                var originalAnchor=projection.anchor;var originalAsset=projection.asset;
                long originalTime=c.world.getTimeOfDay();
                projection.slice(0);
                if(projection.canPlace()||!projection.placementBlockReason().contains("剖切"))throw new IllegalStateException("Cutaway allowed confirmation");
                projection.singleLayer(2);if(projection.canPlace()||!projection.renderer.singleLayer||projection.renderer.cutLayer!=2)throw new IllegalStateException("Single layer allowed confirmation");
                projection.shiftLayer(1);if(projection.renderer.cutLayer!=3)throw new IllegalStateException("Layer step failed");
                projection.move(3,2,-1);projection.rotate();projection.mirror();projection.undoDraft();projection.undoDraft();projection.undoDraft();
                if(!projection.anchor.equals(originalAnchor)||projection.rotation!=placement.rotation()||projection.mirror!=placement.mirror())throw new IllegalStateException("Draft undo failed");
                projection.redoDraft();projection.undoDraft();
                boolean previousLocked=projection.locked;projection.locked=false;double oldDistance=projection.followDistance;if(!projection.scrollNudge(1,false)||projection.followDistance!=oldDistance+1)throw new IllegalStateException("Follow scroll did not change distance; screen="+(c.currentScreen==null?"none":c.currentScreen.getClass().getSimpleName())+", visible="+projection.visible+", busy="+projection.busy+", restoring="+projection.restoring+", before="+oldDistance+", after="+projection.followDistance);projection.coordinates(originalAnchor);projection.locked=previousLocked;
                projection.visible=false;if(projection.scrollNudge(1,false))throw new IllegalStateException("Hidden projection consumed hotbar scrolling");projection.show();
                report.addProperty("facingScrollAndHotbarIsolation",true);
                var previousAxis=projection.moveAxis;projection.moveAxis=ProjectionTools.Axis.Y;
                projection.scrollNudge(1,false);if(Math.abs(projection.anchor.getY()-originalAnchor.getY())!=1)throw new IllegalStateException("Axis scroll did not move exactly one block");projection.undoDraft();projection.moveAxis=previousAxis;
                report.addProperty("singleLayerConfirmationRejected",true);report.addProperty("draftUndoRedoAndScroll",true);
                projection.slice(-1);projection.night();projection.night();projection.ground();projection.coordinates(originalAnchor);
                if(projection.asset!=originalAsset||c.world.getTimeOfDay()!=originalTime)throw new IllegalStateException("Visual controls changed authoritative data or world time");
                report.addProperty("cutawayConfirmationRejected",true);report.addProperty("visualControlsPreserveAssetAndTime",true);
                inFlight=true;
                c.getServer().execute(()->{
                    try {
                        var player=c.getServer().getPlayerManager().getPlayer(c.player.getUuid());var w=player.getServerWorld();
                        for(var e:before.entrySet())if(!w.getBlockState(e.getKey()).equals(e.getValue()))throw new IllegalStateException("Projection changed real world");
                        report.addProperty("projectionIsolation",true);
                        Path reviewDir=FabricLoader.getInstance().getGameDir().resolve("../build/test-fixtures/highrise-review").normalize();
                        Asset reviewAsset=new Asset("review-fixture",JsonParser.parseString(Files.readString(reviewDir.resolve("manifest.json"))).getAsJsonObject(),Files.readAllBytes(reviewDir.resolve("cells.bin")));
                        Placement reviewPlacement=new Placement(reviewAsset,placement.anchor(),placement.rotation(),placement.mirror(),placement.transformRevision(),placement.replace());
                        PlacementService.check(c.getServer(),player.getUuid(),w.getRegistryKey().getValue(),reviewPlacement).whenComplete((check,error)->{
                            if(error!=null){c.execute(()->fail(c,error));return;}
                            PlacementService.startChecked(c.getServer(),player.getUuid(),w.getRegistryKey().getValue(),reviewPlacement,check.token(),false,rejected->{
                                if(!rejected.finished()||rejected.changed()!=0||!rejected.message().contains("通行未验证")){c.execute(()->fail(c,new IllegalStateException("Unacknowledged reviewed asset was not rejected")));return;}
                                for(var e:before.entrySet())if(!w.getBlockState(e.getKey()).equals(e.getValue())){c.execute(()->fail(c,new IllegalStateException("Unacknowledged review changed world")));return;}
                                report.addProperty("unacknowledgedNavigationRejected",true);
                                // Acknowledgement is not permission to use another asset/transform/check token.
                                PlacementService.startChecked(c.getServer(),player.getUuid(),w.getRegistryKey().getValue(),placement,check.token(),true,mismatch->{
                                    if(mismatch.changed()!=0||!mismatch.message().contains("expired")){c.execute(()->fail(c,new IllegalStateException("Acknowledgement bypassed frozen asset check")));return;}
                                    report.addProperty("navigationAcknowledgementCannotBypassAssetCheck",true);
                                    startFixture(c,placement,r->{if(r.finished())c.execute(()->{report.addProperty("placementMessage",r.message());report.addProperty("placed",r.changed());report.addProperty("placementSkipped",r.conflicts());inFlight=false;stage=3;ticks=0;});});
                                });
                            });
                        });
                    }catch(Exception e){c.execute(()->fail(c,e));}
                });
            } else if(stage==3) {
                inFlight=true;
                c.getServer().execute(()->{
                    try {
                        var player=c.getServer().getPlayerManager().getPlayer(c.player.getUuid());var w=player.getServerWorld();int sets=0,clears=0,keeps=0;
                        for(int i=0;i<placement.asset().volume();i++){
                            BlockPos pos=placement.world(i);int cell=placement.asset().cell(i);
                            BlockState expected=cell==0?before.get(pos):placement.state(i);
                            if(!w.getBlockState(pos).equals(expected))throw new IllegalStateException("Placed block mismatch: "+pos+"; expected="+expected+"; actual="+w.getBlockState(pos));
                            if(cell==0)keeps++;else if(cell==1)clears++;else{sets++;if(edited==null && !expected.equals(before.get(pos)) && !before.get(pos).isOf(Blocks.DIAMOND_BLOCK) && !expected.isOf(Blocks.DIAMOND_BLOCK))edited=pos;}
                        }
                        report.addProperty("exactSetCells",sets);report.addProperty("exactClearCells",clears);report.addProperty("exactKeepCells",keeps);
                        if(edited==null)throw new IllegalStateException("Fixture has no actually changed solid for undo-conflict test");
                        w.setBlockState(edited,Blocks.DIAMOND_BLOCK.getDefaultState(),Block.NOTIFY_LISTENERS|Block.FORCE_STATE);
                        PlacementService.undo(c.getServer(),player.getUuid(),r->{if(r.finished())c.execute(()->{report.addProperty("undoMessage",r.message());report.addProperty("undoRestored",r.changed());report.addProperty("undoConflicts",r.conflicts());inFlight=false;stage=4;ticks=0;});});
                    }catch(Exception e){c.execute(()->fail(c,e));}
                });
            } else if(stage==4) {
                inFlight=true;
                c.getServer().execute(()->{
                    try {
                        var w=c.getServer().getPlayerManager().getPlayer(c.player.getUuid()).getServerWorld();
                        for(var e:before.entrySet()){
                            BlockState expected=e.getKey().equals(edited)?Blocks.DIAMOND_BLOCK.getDefaultState():e.getValue();
                            if(!w.getBlockState(e.getKey()).equals(expected))throw new IllegalStateException("Undo mismatch: "+e.getKey());
                        }
                        if(report.get("undoConflicts").getAsInt()!=1)throw new IllegalStateException("Expected exactly one preserved edit conflict");
                        report.addProperty("conflictAwareUndo",true);report.addProperty("assetHash",placement.asset().hash);report.addProperty("rotation",placement.rotation());report.addProperty("mirror",placement.mirror());
                        c.execute(()->{stage=5;ticks=0;inFlight=false;});
                    }catch(Exception e){c.execute(()->fail(c,e));}
                });
            } else if(stage==5) {
                inFlight=true;
                c.getServer().execute(()->{
                    try {
                        var player=c.getServer().getPlayerManager().getPlayer(c.player.getUuid());var w=player.getServerWorld();
                        startFixture(c,placement,r->{
                            if(!r.finished() && r.changed()>0)PlacementService.cancel(c.getServer());
                            if(r.finished())c.execute(()->{report.addProperty("cancelledPlacementCount",r.changed());report.addProperty("cancelledPlacementMessage",r.message());stage=6;ticks=0;inFlight=false;});
                        });
                    }catch(Exception e){c.execute(()->fail(c,e));}
                });
            } else if(stage==6) {
                inFlight=true;
                c.getServer().execute(()->{
                    try {
                        int count=report.get("cancelledPlacementCount").getAsInt();
                        if(count<=0 || count>=placement.asset().setCount+1)throw new IllegalStateException("Cancellation did not stop partial placement");
                        var player=c.getServer().getPlayerManager().getPlayer(c.player.getUuid());
                        PlacementService.undo(c.getServer(),player.getUuid(),r->{if(r.finished())c.execute(()->{report.addProperty("cancelUndoRestored",r.changed());report.addProperty("cancelUndoConflicts",r.conflicts());stage=7;ticks=0;inFlight=false;});});
                    }catch(Exception e){c.execute(()->fail(c,e));}
                });
            } else if(stage==7) {
                inFlight=true;
                c.getServer().execute(()->{
                    try {
                        var w=c.getServer().getPlayerManager().getPlayer(c.player.getUuid()).getServerWorld();
                        for(var e:before.entrySet()){
                            BlockState expected=e.getKey().equals(edited)?Blocks.DIAMOND_BLOCK.getDefaultState():e.getValue();
                            if(!w.getBlockState(e.getKey()).equals(expected))throw new IllegalStateException("Partial placement undo mismatch: "+e.getKey());
                        }
                        report.addProperty("cancelAndUndo",true);c.execute(()->{projection.show();oldClientRevision=projection.transformRevision;stage=8;ticks=0;inFlight=false;});
                    }catch(Exception e){c.execute(()->fail(c,e));}
                });
            } else if(stage==8){
                // The packet-invalidation assertion needs a subscribed client
                // chunk. Move only this explicit isolated test's player, then
                // wait for the actual diamond block from the server, not the
                // misleading ClientWorld.isChunkLoaded() convenience method.
                if(!clientProbePositioned){
                    clientProbePositioned=true;originalPlayerPosition=c.player.getPos();originalPlayerYaw=c.player.getYaw();originalPlayerPitch=c.player.getPitch();
                    report.addProperty("clientProbeOriginallyReceived",ClientChunkAvailability.loaded(c.world,edited));
                    report.addProperty("clientProbeLegacyLoadedQuery",c.world.isChunkLoaded(edited));
                    inFlight=true;var server=c.getServer();var id=c.player.getUuid();
                    server.execute(()->{try{var player=server.getPlayerManager().getPlayer(id);var w=player.getServerWorld();
                        double y=Math.max(w.getBottomY()+2,Math.min(w.getTopY()-3,edited.getY()+4));
                        player.teleport(w,edited.getX()+.5,y,edited.getZ()+.5,player.getYaw(),player.getPitch());
                        c.execute(()->{ticks=0;inFlight=false;});
                    }catch(Exception e){c.execute(()->fail(c,e));}});return;
                }
                if(!ClientChunkAvailability.loaded(c.world,edited)||!c.world.getBlockState(edited).isOf(Blocks.DIAMOND_BLOCK)){
                    if(ticks>400)throw new IllegalStateException("Client invalidation probe did not receive its server chunk/block");return;
                }
                oldClientRevision=projection.transformRevision;
                report.addProperty("clientInvalidationProbe",edited.toShortString());
                report.addProperty("clientInvalidationPlayerPosition",c.player.getPos().toString());
                report.addProperty("clientInvalidationChunkLoadedBefore",ClientChunkAvailability.loaded(c.world,edited));
                report.addProperty("clientInvalidationBlockBefore",c.world.getBlockState(edited).toString());
                report.addProperty("clientInvalidationRevisionBefore",oldClientRevision);
                inFlight=true;var server=c.getServer();var playerId=c.player.getUuid();var dimension=c.world.getRegistryKey().getValue();
                PlacementService.check(server,playerId,dimension,placement).whenComplete((check,error)->{
                    if(error!=null){c.execute(()->fail(c,error));return;}
                    var w=server.getPlayerManager().getPlayer(playerId).getServerWorld();transientBefore=w.getBlockState(edited);w.setBlockState(edited,Blocks.EMERALD_BLOCK.getDefaultState(),Block.NOTIFY_LISTENERS|Block.FORCE_STATE);
                    PlacementService.startChecked(server,playerId,dimension,placement,check.token(),navigationAcknowledged(),result->{
                        if(!result.finished()||result.changed()!=0||!result.message().contains("expired")){c.execute(()->fail(c,new IllegalStateException("Stale confirmation was not rejected")));return;}
                        if(!w.getBlockState(edited).isOf(Blocks.EMERALD_BLOCK)){c.execute(()->fail(c,new IllegalStateException("Rejected confirmation changed the edited block")));return;}
                        report.addProperty("staleConfirmationRejected",true);c.execute(()->{stage=9;ticks=0;inFlight=false;});
                    });
                });
            } else if(stage==9){
                if(!ClientChunkAvailability.loaded(c.world,edited)||!c.world.getBlockState(edited).isOf(Blocks.EMERALD_BLOCK)){
                    if(ticks>400)throw new IllegalStateException("Client did not receive the region probe update");return;
                }
                report.addProperty("clientInvalidationChunkLoadedAfter",ClientChunkAvailability.loaded(c.world,edited));
                report.addProperty("clientInvalidationBlockAfter",c.world.getBlockState(edited).toString());
                report.addProperty("clientInvalidationRevisionAfter",projection.transformRevision);
                if(projection.transformRevision<=oldClientRevision)throw new IllegalStateException("Client region change did not invalidate the scan");report.addProperty("clientRegionInvalidation",true);
                inFlight=true;var server=c.getServer();var playerId=c.player.getUuid();var dimension=c.world.getRegistryKey().getValue();
                server.execute(()->server.getPlayerManager().getPlayer(playerId).getServerWorld().setBlockState(edited,transientBefore,Block.NOTIFY_LISTENERS|Block.FORCE_STATE));
                PlacementService.check(server,playerId,dimension,placement).whenComplete((check,error)->{
                    if(error!=null){c.execute(()->fail(c,error));return;}var w=server.getPlayerManager().getPlayer(playerId).getServerWorld();
                    WorldChangeTracker.chunk(w,placement.anchor().getX()>>4,placement.anchor().getZ()>>4);
                    PlacementService.startChecked(server,playerId,dimension,placement,check.token(),navigationAcknowledged(),result->{
                        if(!result.finished()||result.changed()!=0||!result.message().contains("expired")){c.execute(()->fail(c,new IllegalStateException("Chunk invalidation was not rejected")));return;}
                        report.addProperty("chunkInvalidationRejected",true);c.execute(()->{stage=10;ticks=0;inFlight=false;});
                    });
                });
            } else if(stage==10){
                Path fixture=FabricLoader.getInstance().getGameDir().resolve("../build/test-fixtures/navigation-review").normalize();Asset reviewed=new Asset("acknowledged-review-fixture",JsonParser.parseString(Files.readString(fixture.resolve("manifest.json"))).getAsJsonObject(),Files.readAllBytes(fixture.resolve("cells.bin")));
                var reviewedPlacement=new Placement(reviewed,placement.anchor(),0,false,0,true);inFlight=true;var server=c.getServer();var playerId=c.player.getUuid();var dimension=c.world.getRegistryKey().getValue();
                server.execute(()->{var w=server.getPlayerManager().getPlayer(playerId).getServerWorld();reviewBefore=new HashMap<>();for(int i=0;i<reviewed.volume();i++)reviewBefore.put(reviewedPlacement.world(i),w.getBlockState(reviewedPlacement.world(i)));
                    PlacementService.check(server,playerId,dimension,reviewedPlacement).whenComplete((check,error)->{if(error!=null){c.execute(()->fail(c,error));return;}PlacementService.startChecked(server,playerId,dimension,reviewedPlacement,check.token(),true,r->{if(r.finished())c.execute(()->{if(r.changed()<=0||!r.message().equals("Placement finished")){fail(c,new IllegalStateException("Acknowledged review did not place"));return;}report.addProperty("explicitlyAcknowledgedNavigationPlaced",true);stage=11;ticks=0;inFlight=false;});});});
                });
            } else if(stage==11){
                inFlight=true;var server=c.getServer();var playerId=c.player.getUuid();PlacementService.undo(server,playerId,r->{if(r.finished()){var w=server.getPlayerManager().getPlayer(playerId).getServerWorld();for(var e:reviewBefore.entrySet())if(!w.getBlockState(e.getKey()).equals(e.getValue())){c.execute(()->fail(c,new IllegalStateException("Acknowledged review undo mismatch")));return;}report.addProperty("acknowledgedNavigationUndoRestored",true);c.execute(()->{stage=12;ticks=0;inFlight=false;});}});
            } else if(stage==12){
                inFlight=true;SpecialBlockWorldTest.run(c,placement.anchor()).whenComplete((e,error)->c.execute(()->{if(error!=null){fail(c,error);return;}if(projection.renderer.completedDraws==0){fail(c,new IllegalStateException("No real projection mesh was drawn"));return;}for(var entry:e.entrySet())report.add(entry.getKey(),entry.getValue());report.addProperty("result","passed");finish(c);}));
            }
        }catch(Exception e){fail(c,e);}
    }
    private static boolean navigationAcknowledged(){return Boolean.getBoolean("voxelstudio.testNavigationAcknowledged");}
    private static boolean freshSandbox(){return StudioRealAssetSandbox.enabled()||StudioFlowSandbox.enabled();}
    private static void verifyFreshWorld(MinecraftClient c)throws Exception{if(StudioRealAssetSandbox.enabled())StudioRealAssetSandbox.verifyWorld(c);else StudioFlowSandbox.verifyWorld(c);}
    private static void checkpoint(MinecraftClient c,boolean force)throws Exception {
        if(!force&&checkpointStage==stage&&checkpointInFlight==inFlight)return;
        Path game=FabricLoader.getInstance().getGameDir().toAbsolutePath().normalize();
        if(StudioRealAssetSandbox.enabled())StudioRealAssetSandbox.approved();
        else if(StudioFlowSandbox.enabled())StudioFlowSandbox.root();
        else if(!game.toString().replace('\\','/').endsWith("/voxel/mod/run"))throw new IllegalStateException("Checkpoint requires isolated test directory");
        if(progressFile==null){
            String run=System.getProperty("voxelstudio.testRunId",UUID.randomUUID().toString().replace("-",""));
            if(!run.matches("[a-f0-9]{32}"))throw new IllegalArgumentException("Invalid isolated test run ID");
            Files.createDirectories(game.resolve("selftest-runs"));progressFile=game.resolve("selftest-runs/"+run+".progress.json");
            Files.writeString(progressFile,"{}",StandardOpenOption.CREATE_NEW);report.addProperty("testRunId",run);
            report.addProperty("openGlVendor",org.lwjgl.opengl.GL11.glGetString(org.lwjgl.opengl.GL11.GL_VENDOR));
            report.addProperty("openGlRenderer",org.lwjgl.opengl.GL11.glGetString(org.lwjgl.opengl.GL11.GL_RENDERER));
            report.addProperty("openGlVersion",org.lwjgl.opengl.GL11.glGetString(org.lwjgl.opengl.GL11.GL_VERSION));
        }
        report.addProperty("testWindowHideMode",testWindow==null?"uninitialized":testWindow.mode());
        report.addProperty("testWindowHideRequests",testWindow==null?0:testWindow.hideRequests());
        report.addProperty("realProjectionMeshDraws",StudioClient.PROJECTION.renderer.completedDraws);
        JsonObject snapshot=new JsonObject();snapshot.addProperty("stage",stage);snapshot.addProperty("inFlight",inFlight);snapshot.addProperty("observedAt",java.time.Instant.now().toString());
        snapshot.addProperty("terminalReceipt",false);snapshot.addProperty("worldSaveDurability","not-guaranteed-by-progress");snapshot.add("partialEvidence",report.deepCopy());
        var publication=SelfTestProgressWriter.publish(progressFile,new GsonBuilder().setPrettyPrinting().create().toJson(snapshot));
        report.addProperty("progressLatestUpdated",publication.latestUpdated());
        report.addProperty("progressEvidenceFile",publication.evidenceFile().toString());
        int retries=report.has("progressPublishRetries")?report.get("progressPublishRetries").getAsInt():0;
        report.addProperty("progressPublishRetries",retries+publication.attempts()-1);
        if(!publication.latestUpdated()) {
            if(!report.has("progressPublishWarnings"))report.add("progressPublishWarnings",new JsonArray());
            var warning=new JsonObject();warning.addProperty("stage",stage);warning.addProperty("inFlight",inFlight);
            warning.addProperty("error",publication.warning());warning.addProperty("preservedSnapshot",publication.evidenceFile().toString());
            report.getAsJsonArray("progressPublishWarnings").add(warning);
        }
        System.out.println("VOXEL_SELFTEST_PROGRESS stage="+stage+" inFlight="+inFlight+" draws="+StudioClient.PROJECTION.renderer.completedDraws+" hideRequests="+(testWindow==null?0:testWindow.hideRequests())+" latestUpdated="+publication.latestUpdated()+" path="+publication.evidenceFile());
        checkpointStage=stage;checkpointInFlight=inFlight;
    }
    private static BlockPos fixtureAnchor(){
        return fixtureAnchor(System.getProperty("voxelstudio.testAnchor","32,-60,32"));
    }
    static BlockPos fixtureAnchor(String value){
        if(!value.matches("-?\\d{1,3},-?\\d{1,3},-?\\d{1,3}"))throw new IllegalArgumentException("Invalid isolated fixture anchor");
        String[] xyz=value.split(",");int x=Integer.parseInt(xyz[0]),y=Integer.parseInt(xyz[1]),z=Integer.parseInt(xyz[2]);
        if(Math.abs(x)>128||Math.abs(z)>128||y< -64||y>319)throw new IllegalArgumentException("Isolated fixture anchor outside test region");
        return new BlockPos(x,y,z);
    }
    /** Explicit recovery of this test's own failed LIGHT->AIR undo only. Never a production repair path. */
    private static CompletableFuture<JsonObject> recoverFixtureLights(MinecraftClient c,Asset asset){
        String id=System.getProperty("voxelstudio.testRecoverLightJournal");if(id==null)return CompletableFuture.completedFuture(null);
        var result=new CompletableFuture<JsonObject>();
        try{
            Path game=FabricLoader.getInstance().getGameDir().toAbsolutePath().normalize(),saved=c.getServer().getSavePath(net.minecraft.util.WorldSavePath.ROOT).toAbsolutePath().normalize();
            if(!FabricLoader.getInstance().isDevelopmentEnvironment()||!Boolean.getBoolean("voxelstudio.selftest")||!id.matches("[a-f0-9-]{36}")||!game.toString().replace('\\','/').endsWith("/voxel/mod/run")||!saved.equals(game.resolve("saves/新的世界")))throw new IllegalStateException("Explicit isolated recovery only");
            Path journal=saved.resolve("voxel-studio-journals").resolve(id);var metadata=JsonParser.parseString(Files.readString(journal.resolve("metadata.json"))).getAsJsonObject();
            if(!metadata.get("assetHash").getAsString().equals(asset.hash)||!metadata.get("revision").getAsString().equals("isolated-native-fixture")||metadata.get("rotation").getAsInt()!=1||!metadata.get("mirror").getAsBoolean()||metadata.get("anchor").getAsLong()!=new BlockPos(32,-60,32).asLong())throw new IllegalStateException("Recovery receipt does not belong to this fixture");
            var p=new Placement(asset,new BlockPos(32,-60,32),1,true,0,true);var expected=new HashMap<BlockPos,BlockState>();for(int i=0;i<asset.volume();i++)if(p.state(i).isOf(Blocks.LIGHT))expected.put(p.world(i),p.state(i));
            var positions=new HashSet<BlockPos>();try(var files=Files.list(journal)){for(Path file:files.filter(f->f.getFileName().toString().matches("[0-9]+\\.applied\\.json")).toList())for(var v:JsonParser.parseString(Files.readString(file)).getAsJsonArray()){
                var entry=v.getAsJsonObject();String after=entry.get("after").getAsString();if(!after.startsWith("minecraft:light["))continue;
                BlockPos point=BlockPos.fromLong(entry.get("pos").getAsLong());var state=net.minecraft.command.argument.BlockArgumentParser.block(net.minecraft.registry.Registries.BLOCK.getReadOnlyWrapper(),after,false).blockState();
                if(!entry.get("before").getAsString().equals("minecraft:air")||!state.equals(expected.get(point))||!state.getFluidState().isEmpty()||!positions.add(point))throw new IllegalStateException("Recovery is not a unique unchanged fixture light-to-air receipt");
            }}
            c.getServer().execute(()->{try{var world=c.getServer().getPlayerManager().getPlayer(c.player.getUuid()).getServerWorld();int restored=0,skipped=0;
                for(var point:positions){if(!world.isChunkLoaded(point)||!world.getBlockState(point).equals(expected.get(point))){skipped++;continue;}if(world.setBlockState(point,Blocks.AIR.getDefaultState(),Block.NOTIFY_LISTENERS|Block.FORCE_STATE|Block.SKIP_DROPS))restored++;}
                var value=new JsonObject();value.addProperty("journalId",id);value.addProperty("restoredOwnUnchangedLights",restored);value.addProperty("skippedModifiedOrUnavailable",skipped);value.addProperty("journalUnchanged",true);result.complete(value);
            }catch(Exception error){result.completeExceptionally(error);}});
        }catch(Exception e){result.completeExceptionally(e);}return result;
    }
    private static void startFixture(MinecraftClient c,Placement p,java.util.function.Consumer<PlacementService.Result> callback){
        Path game=FabricLoader.getInstance().getGameDir().toAbsolutePath().normalize();
        if(!FabricLoader.getInstance().isDevelopmentEnvironment()||!Boolean.getBoolean("voxelstudio.selftest")||!game.toString().replace('\\','/').endsWith("/voxel/mod/run")&&!freshSandbox())throw new IllegalStateException("Explicit isolated development fixture required");
        if(freshSandbox())try{verifyFreshWorld(c);}catch(Exception e){throw new IllegalStateException("Fresh placement fixture boundary rejected",e);}
        var server=c.getServer();var player=c.player.getUuid();var dimension=c.world.getRegistryKey().getValue();
        PlacementService.check(server,player,dimension,p).whenComplete((check,error)->{
            if(error!=null){c.execute(()->fail(c,error));return;}
            PlacementService.startChecked(server,player,dimension,p,check.token(),navigationAcknowledged(),callback);
        });
    }
    private static void fail(MinecraftClient c,Throwable e){while(e.getCause()!=null)e=e.getCause();report.addProperty("result","failed");report.addProperty("failedStage",stage);report.addProperty("error",e.toString());finish(c);}
    private static void finish(MinecraftClient c){
        stage=99;inFlight=false;StudioClient.PROJECTION.status="Self-test: "+report.get("result").getAsString();
        try{checkpoint(c,true);}catch(Exception e){report.addProperty("result","failed");report.addProperty("checkpointError",e.toString());}
        var restored=new CompletableFuture<Void>();
        if(randomTicks==null)restored.complete(null);
        else if(c.getServer()==null){report.addProperty("result","failed");report.addProperty("randomTickRestoreError","Server unavailable; recovery marker retained");restored.complete(null);}
        else c.getServer().execute(()->{
            try{randomTicks.close();report.addProperty("randomTickSpeedRestored",true);}
            catch(Exception e){report.addProperty("result","failed");report.addProperty("randomTickRestoreError",e.toString());}
            if(originalPlayerPosition!=null)try{
                var player=c.getServer().getPlayerManager().getPlayer(c.player.getUuid());
                player.teleport(player.getServerWorld(),originalPlayerPosition.x,originalPlayerPosition.y,originalPlayerPosition.z,originalPlayerYaw,originalPlayerPitch);
                report.addProperty("testPlayerPositionRestored",true);
            }catch(Exception e){report.addProperty("result","failed");report.addProperty("testPlayerRestoreError",e.toString());}
            restored.complete(null);
        });
        restored.thenRunAsync(()->{
            String text=new GsonBuilder().setPrettyPrinting().create().toJson(report);
            try{Path dir=FabricLoader.getInstance().getGameDir();Files.createDirectories(dir.resolve("selftest-runs"));Files.writeString(dir.resolve("selftest-runs/"+System.currentTimeMillis()+".json"),text);Files.writeString(dir.resolve("studio-selftest-result.json"),text);}catch(Exception e){System.err.println("Failed to save self-test evidence: "+e);}
            System.out.println("VOXEL_STUDIO_SELFTEST "+text);
        }).thenRun(()->c.execute(c::scheduleStop));
    }
}
