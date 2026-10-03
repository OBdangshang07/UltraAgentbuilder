package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.selection.*;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.TitleScreen;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.client.util.ScreenshotRecorder;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/** Explicit development-only fixture. Shares the already verified NEW world
 * gate with SelectionSelfTest. Never opens a world or calls a model itself. */
final class WorldPatchPreviewSelfTest {
    private static int stage,ticks;
    private static boolean pending;
    private static Throwable failure;
    private static dev.voxelstudio.WorldChangeTracker.Watch watch;
    private static WorldPatchPreview original;
    static boolean enabled(){return FabricLoader.getInstance().isDevelopmentEnvironment()&&Boolean.getBoolean("voxelstudio.patchPreviewFixtures")&&SelectionSelfTest.enabled();}
    static boolean tick(MinecraftClient c,Path output,SelectionReadService.Capture capture,JsonObject report)throws Exception{
        if(!enabled())return true;
        if(failure!=null)throw new IllegalStateException("Patch preview fixture failed",failure);
        if(pending)return false;
        var tool=StudioClient.PATCH_PREVIEW;
        if(stage==0){
            var auth=JsonParser.parseString(Files.readString(output.resolve("authorization.json"))).getAsJsonObject();if(!auth.get("patchPreviewFixtures").getAsBoolean())throw new IllegalStateException("Patch fixture not authorized");
            var file=output.resolve("patch-preview-fixture.json");if(!Files.exists(file,LinkOption.NOFOLLOW_LINKS))return false;
            if(Files.isSymbolicLink(file)||!Files.isRegularFile(file,LinkOption.NOFOLLOW_LINKS)||!file.toRealPath().equals(file)||Files.size(file)>SelectionLimits.snapshotBytes()+8192)throw new IllegalStateException("Unsafe patch fixture input");
            var saved=StudioClient.SELECTION.savedContext().getAsJsonObject("record");
            pending=true;var worker=Executors.newSingleThreadExecutor(r->{var t=new Thread(r,"voxel-patch-test-prepare");t.setDaemon(true);return t;});
            CompletableFuture.supplyAsync(()->{
                try{var v=JsonParser.parseString(Files.readString(file)).getAsJsonObject();if(!v.get("fixtureProposalOnly").getAsBoolean()||v.get("generatedByModel").getAsBoolean()||v.get("modelCalls").getAsInt()!=0||v.get("worldWrites").getAsInt()!=0)throw new IllegalStateException("Fixture claims model or placement");
                    var p=v.getAsJsonObject("preview");var binding=new WorldPatchPreview.Binding(capture.selection(),capture.contextRevision(),saved.get("snapshotHash").getAsString(),saved.get("selectionHash").getAsString(),v.get("patchHash").getAsString(),v.get("previewHash").getAsString());
                    return WorldPatchPreview.parse(p.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8),binding);
                }catch(Exception e){throw new CompletionException(e);}
            },worker).whenComplete((preview,error)->{worker.shutdown();c.execute(()->{
                pending=false;if(error!=null){failure=error;return;}original=preview;tool.showReadOnly(preview);
                c.player.refreshPositionAndAngles(-10,-52,-14,-35,22);c.setScreen(null);stage=1;ticks=0;
                var server=c.getServer();var user=c.player.getUuid();pending=true;server.execute(()->{try{watch=dev.voxelstudio.WorldChangeTracker.watch(server.getPlayerManager().getPlayer(user).getServerWorld(),capture.selection().context());c.execute(()->pending=false);}catch(Exception e){c.execute(()->{pending=false;failure=e;});}});
            });});return false;
        }
        if(stage>=1&&stage<=3){
            if(tool.preview()!=original)throw new IllegalStateException("Live valid preview was lost");
            if(StudioClient.PROJECTION.visible)throw new IllegalStateException("Building projection remained visible alongside patch");
            if(tool.renderer.error!=null)throw new IllegalStateException(tool.renderer.error);
            if(tool.renderer.building||tool.renderer.completedDraws<1||++ticks<30)return false;
            String name=switch(stage){case 1->"changes";case 2->"before";default->"after";};screenshot(c,output,"patch-"+name+".png");
            if(original.totalWrites()!=3||original.counts().values().stream().mapToInt(i->i).sum()!=3)throw new IllegalStateException("Original patch scope changed");
            report.addProperty("patchPreview"+name+"ActualMeshDraws",tool.renderer.completedDraws);
            StudioScreen.confirmPlacement();if(tool.preview()!=original||!StudioClient.PROJECTION.status.startsWith("当前为只读改造差异"))throw new IllegalStateException("Read-only patch leaked into building confirmation");report.addProperty("patchCannotOpenBuildingConfirmation",true);
            if(stage==3){if(tool.lastRemovedMarkers!=1||tool.lastVisibleMarkers!=3)throw new IllegalStateException("AFTER overlay lost explicit deletion marker");report.addProperty("patchAfterDeletionMarkerRetained",true);}
            if(stage<3){stage++;ticks=0;tool.filter(original.all(stage==2?WorldPatchPreview.Mode.BEFORE:WorldPatchPreview.Mode.AFTER));return false;}
            c.setScreen(new WorldPatchPreviewScreen(new SelectionScreen(new TitleScreen())));stage=4;ticks=0;return false;
        }
        if(stage==4){
            if(++ticks<20)return false;var screen=(WorldPatchPreviewScreen)c.currentScreen;screenshot(c,output,"patch-controls.png");
            press(screen,"显示差异");press(screen,"显隐 删除");if(tool.filter().categories().contains(WorldPatchPreview.Difference.REMOVED)||original.totalWrites()!=3)throw new IllegalStateException("Category filter changed scope");
            press(screen,"切高一层");if(tool.filter().maxY()-tool.filter().minY()!=1||original.totalWrites()!=3)throw new IllegalStateException("Layer control changed patch");
            press(screen,"恢复全部显示");press(screen,"隐藏预览");if(tool.visible)throw new IllegalStateException("Hide failed");press(screen,"显示预览");if(!tool.visible)throw new IllegalStateException("Restore failed");
            report.addProperty("patchDisplayControlsAndScopeIsolationVerified",true);screen.close();c.setScreen(null);stage=5;ticks=0;return false;
        }
        if(stage==5){
            if(tool.renderer.building||++ticks<30)return false;
            if(watch==null||watch.revision()!=0)throw new IllegalStateException("World changed while rendering/filtering read-only patch");watch.close();watch=null;report.addProperty("patchPreviewWorldChangeRevision",0);
            var draft=StudioClient.SELECTION.draft;draft.first(new SelectionRegion.Point(-3,-57,-3));tool.tick(c);if(tool.preview()!=null)throw new IllegalStateException("Incomplete selection retained stale patch");
            report.addProperty("patchIncompleteSelectionClearsWithoutCrash",true);
            draft.target(SelectionDraft.Target.EDIT,-1);draft.region(capture.selection().edit());draft.target(SelectionDraft.Target.CONTEXT,-1);
            tool.showReadOnly(original);tool.tick(c);if(tool.preview()!=null)throw new IllegalStateException("Old preview was adopted after revision changed");
            report.addProperty("patchOldRevisionCannotReappear",true);
            report.addProperty("patchFixtureProposalOnly",true);report.addProperty("patchPreviewModelCalls",0);report.addProperty("patchRendererWorldWrites",0);report.addProperty("patchCanAuthorizePlacement",false);report.addProperty("patchOriginalCoordinatesVerified",true);
            report.addProperty("patchPreviewHash",original.binding().previewHash());report.addProperty("patchPreviewDelivered",false);
            // Return to the normal, fresh read-only chain. The earlier original
            // snapshot is correctly invalid now; never silently rebase it.
            c.setScreen(new SelectionScreen(new TitleScreen()));stage=6;return true;
        }
        return stage==6;
    }
    private static void press(WorldPatchPreviewScreen screen,String prefix){
        var button=screen.children().stream().filter(v->v instanceof ClickableWidget w&&w.getMessage().getString().startsWith(prefix)).map(v->(ClickableWidget)v).findFirst().orElseThrow();
        screen.reveal(button);if(!button.visible||!button.active||!screen.mouseClicked(button.getX()+8,button.getY()+8,0))throw new IllegalStateException("Patch control unavailable: "+prefix);screen.mouseReleased(button.getX()+8,button.getY()+8,0);
    }
    private static void screenshot(MinecraftClient c,Path output,String name)throws Exception{try(var image=ScreenshotRecorder.takeScreenshot(c.getFramebuffer())){image.writeTo(output.resolve(name));}}
    private WorldPatchPreviewSelfTest(){}
}
