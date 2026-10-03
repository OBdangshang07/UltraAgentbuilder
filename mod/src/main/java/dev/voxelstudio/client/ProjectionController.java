package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.*;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.world.ClientWorld;
import net.minecraft.util.hit.*;
import net.minecraft.util.math.*;
import net.fabricmc.loader.api.FabricLoader;
import java.nio.file.*;
import java.util.concurrent.*;
import java.util.*;

public final class ProjectionController {
    public final ProjectionRenderer renderer = new ProjectionRenderer();
    public Asset asset;
    public BlockPos anchor = BlockPos.ORIGIN;
    public int rotation;
    public boolean mirror, visible, locked, busy, replace, materials = true;
    public float opacity = .5f;
    public long transformRevision;
    public String status = "尚未加载建筑，可以先体验示例", worldKey;
    public int conflicts, unknown, clears, adds,unsupportedBase;
    public final List<BlockPos> conflictPositions = new ArrayList<>(), unknownPositions = new ArrayList<>();
    private ClientWorld scope;
    private long scanRevision = -1;
    private int scanCursor;
    private long lastMove;
    private WorldChangeTracker.Watch watch;
    private long watchedRevision;
    public String persistenceError;
    public boolean restoring;
    public ProjectionTools.Axis moveAxis=ProjectionTools.Axis.LOOK;
    private double scrollRemainder;
    public double followDistance=12;
    private boolean positioned;
    public void enterWorld(){if(positioned)show();else beginPosition();}
    private final DraftHistory editHistory=new DraftHistory();
    private DraftHistory.Transform snapshot(){return new DraftHistory.Transform(anchor.getX(),anchor.getY(),anchor.getZ(),rotation,mirror);}
    public boolean canUndoDraft(){return asset!=null&&!busy&&!restoring&&editHistory.canUndo();}
    public boolean canRedoDraft(){return asset!=null&&!busy&&!restoring&&editHistory.canRedo();}
    public void undoDraft(){if(canUndoDraft())applyTransform(editHistory.undo(snapshot()));}
    public void redoDraft(){if(canRedoDraft())applyTransform(editHistory.redo(snapshot()));}
    private void applyTransform(DraftHistory.Transform t){boolean mesh=rotation!=t.rotation()||mirror!=t.mirror();anchor=new BlockPos(t.x(),t.y(),t.z());rotation=t.rotation();mirror=t.mirror();locked=true;changed(mesh);status="已恢复投影定位；没有撤销或写入世界方块";}
    public String axisLabel(){return moveAxis==ProjectionTools.Axis.LOOK?"视线主轴":moveAxis.name()+" 轴";}
    public void cycleAxis(){moveAxis=ProjectionTools.Axis.values()[(moveAxis.ordinal()+1)%4];scrollRemainder=0;}
    public boolean scrollNudge(double amount,boolean coarse){
        var c=MinecraftClient.getInstance();if(!visible||asset==null||busy||restoring||c.player==null||c.currentScreen!=null)return false;
        if(!Double.isFinite(amount))return true;scrollRemainder+=Math.max(-8,Math.min(8,amount));int steps=(int)scrollRemainder;scrollRemainder-=steps;
        if(steps!=0){if(!locked){followDistance=ProjectionTools.distance(followDistance,steps*(coarse?8:1));updateFollow();}else{var look=c.player.getRotationVec(1);var delta=ProjectionTools.nudge(moveAxis,look.x,look.y,look.z,steps*(coarse?8:1));move(delta.getX(),delta.getY(),delta.getZ());}}return true;
    }
    private void updateFollow(){var c=MinecraftClient.getInstance();if(c.player==null||asset==null)return;var p=placement();var next=ProjectionTools.facingAnchor(c.player.getEyePos(),c.player.getRotationVec(1),followDistance,p.width(),p.length());if(!next.equals(anchor)){anchor=next;changed(false);}}
    public void beginPosition(){if(asset==null||busy||restoring)return;positioned=true;show();locked=false;followDistance=Math.min(96,Math.max(8,Math.max(placement().width(),placement().length())));updateFollow();}
    public void snapToSurface(){var c=MinecraftClient.getInstance();if(asset==null||busy||restoring||c.player==null)return;var hit=c.player.raycast(96,1,false);if(hit instanceof BlockHitResult b&&hit.getType()==HitResult.Type.BLOCK){var at=b.getBlockPos().offset(b.getSide());coordinates(at.add(-placement().width()/2,0,-placement().length()/2));status="已吸附准星表面并锁定；滚轮沿面朝主轴微调";}else status="准星未命中表面，可继续用滚轮调整距离";}
    private final StudioStateStore drafts=new StudioStateStore(FabricLoader.getInstance().getConfigDir().resolve("voxel-studio"));
    private static final ScheduledExecutorService DRAFT_IO = Executors.newSingleThreadScheduledExecutor(r -> { Thread t = new Thread(r, "voxel-draft-io"); t.setDaemon(true); return t; });
    private final Map<String,ScheduledFuture<?>> draftSaves=new HashMap<>();
    private final Map<String,JsonObject> pendingDrafts=new HashMap<>();
    public Placement placement() { return new Placement(asset, anchor, rotation, mirror, transformRevision, replace); }
    public void load(Asset next) {
        load(next,false);
    }
    public void loadComparison(Asset next){load(next,true);}
    private void load(Asset next,boolean comparison) {
        StudioClient.PATCH_PREVIEW.clear();
        if (busy) return;
        asset = next; scope = MinecraftClient.getInstance().world; worldKey = key();editHistory.clear();scrollRemainder=0;
        visible=false;locked=false;positioned=false;if(!comparison){rotation=0;mirror=false;}moveAxis=ProjectionTools.Axis.LOOK;
        renderer.cutLayer=-1;renderer.singleLayer=false;
        if (scope != null && anchor.equals(BlockPos.ORIGIN)) anchor = MinecraftClient.getInstance().player.getBlockPos().add(3,0,3);
        changed(true); status = "已加载建筑：" + next.id;
    }
    public void show() { if (asset == null || busy) return; StudioClient.PATCH_PREVIEW.clear();scope = MinecraftClient.getInstance().world; worldKey = key(); visible = true; changed(false); }
    public void move(int x, int y, int z) { if (asset == null || busy) return;var before=snapshot();locked=true;positioned=true;try{anchor=new BlockPos(Math.addExact(anchor.getX(),x),Math.addExact(anchor.getY(),y),Math.addExact(anchor.getZ(),z));}catch(ArithmeticException e){status="坐标超出整数范围，未移动";return;}editHistory.remember(before,snapshot());changed(false); }
    public void coordinates(BlockPos p) { if (busy) return;var before=snapshot();locked=true;positioned=true;anchor=p;editHistory.remember(before,snapshot());changed(false); }
    public void rotate() { if (asset == null || busy) return;var before=snapshot();rotation=(rotation+1)%4;editHistory.remember(before,snapshot());changed(true); }
    public void mirror() { if (asset == null || busy) return;var before=snapshot();mirror=!mirror;editHistory.remember(before,snapshot());changed(true); }
    public void toggleLock() { if (busy||restoring||asset==null) return; locked = !locked;scrollRemainder=0;if(!locked){var c=MinecraftClient.getInstance();if(c.player!=null)followDistance=ProjectionTools.distance(c.player.getEyePos().distanceTo(Vec3d.of(anchor).add(placement().width()/2.0,0,placement().length()/2.0)),0);}changed(false); }
    public void slice(int layer){if(asset==null||busy)return;int cut=layer>=asset.height?-1:Math.max(-1,layer);if(renderer.cutLayer==cut&&!renderer.singleLayer)return;renderer.singleLayer=false;renderer.cutLayer=cut;renderer.rebuild(placement());status=cut<0?"已显示完整建筑":"剖切仅改变预览；恢复全部楼层后才能确认建造";}
    public void singleLayer(int layer){if(asset==null||busy)return;renderer.singleLayer=true;renderer.cutLayer=MathHelper.clamp(layer,0,asset.height-1);renderer.rebuild(placement());status="仅显示单层；恢复完整建筑后才能建造";}
    public void shiftLayer(int delta){if(asset==null||busy)return;int layer=MathHelper.clamp((renderer.cutLayer<0?0:renderer.cutLayer)+delta,0,asset.height-1);if(renderer.singleLayer)singleLayer(layer);else slice(layer);}
    public void cycleLayerMode(){if(asset==null||busy)return;if(renderer.cutLayer<0)slice(asset.height-1);else if(!renderer.singleLayer)singleLayer(renderer.cutLayer);else slice(-1);}
    public String layerLabel(){return renderer.cutLayer<0?"完整建筑":(renderer.singleLayer?"单层 ":"剖切 0–")+renderer.cutLayer+" · 世界 Y="+((long)anchor.getY()+renderer.cutLayer);}
    public void night(){if(asset==null||busy)return;renderer.night=!renderer.night;renderer.rebuild(placement());status="昼夜仅为材质亮度近似；不会改变世界时间或照明";}
    public void ground(){
        var c=MinecraftClient.getInstance();if(asset==null||busy||c.world==null)return;var p=placement();int x=anchor.getX()+p.width()/2,z=anchor.getZ()+p.length()/2;
        if(!ClientChunkAvailability.loaded(c.world,x>>4,z>>4)){status="中心列区块未加载，未贴地";return;}
        int y=c.world.getTopY(net.minecraft.world.Heightmap.Type.MOTION_BLOCKING_NO_LEAVES,x,z);if(y<c.world.getBottomY()||(long)y+asset.height>c.world.getTopY()){status="贴地后会超出世界高度，未移动";return;}
        coordinates(new BlockPos(anchor.getX(),y,anchor.getZ()));status="已对齐中心列最高表面；坡地边缘需自行微调，不会自动平整地形";
    }
    private void changed(boolean mesh) {
        transformRevision++; scanRevision = -1; conflictPositions.clear(); unknownPositions.clear(); lastMove = System.nanoTime(); status = "位置已更新，等待检查";
        if(watch!=null)watch.close();watch=asset!=null&&scope!=null?WorldChangeTracker.watch(scope,placement()):null;watchedRevision=watch==null?0:watch.revision();
        if (mesh && asset != null) renderer.rebuild(placement());
        saveDraft();
    }
    public void tick() {
        var c = MinecraftClient.getInstance();
        if (c.world != scope) { visible = false; locked = false; positioned=false; scope = c.world; worldKey=key();editHistory.clear();scrollRemainder=0;scanRevision = -1;transformRevision++;if(watch!=null){watch.close();watch=null;}status="已切换世界/维度；可显式恢复此处的投影草稿"; }
        if(watch!=null&&watch.revision()!=watchedRevision){watchedRevision=watch.revision();scanRevision=-1;transformRevision++;status="区域方块或区块发生变化，旧检查已失效";}
        if (!visible || asset == null || c.player == null) return;
        if (!locked && !busy && c.currentScreen == null) {
            updateFollow();
        }
        if (System.nanoTime() - lastMove < 180_000_000 || busy) return;
        if (scanRevision != transformRevision) { scanRevision = transformRevision; scanCursor = 0; conflicts = unknown = clears = adds = unsupportedBase = 0; conflictPositions.clear(); unknownPositions.clear(); }
        if (scanCursor >= asset.volume()) return;
        long end = System.nanoTime() + 1_000_000;
        Placement p = placement();
        while (scanCursor < asset.volume() && System.nanoTime() < end) {
            int i = scanCursor++; if (asset.cell(i) == 0) continue;
            BlockPos pos = p.world(i);
            if (c.world.isOutOfHeightLimit(pos) || !c.world.getWorldBorder().contains(pos) || !ClientChunkAvailability.loaded(c.world,pos)) { unknown++; if (unknownPositions.size()<256) unknownPositions.add(pos); continue; }
            var old = c.world.getBlockState(pos); var state = p.state(i);
            if(p.local(i).getY()==0&&!state.isAir()&&c.world.getBlockState(pos.down()).isAir())unsupportedBase++;
            if (old.equals(state)) continue;
            if (old.hasBlockEntity() || old.getBlock() instanceof net.minecraft.block.FallingBlock || !old.getFluidState().isEmpty() || old.getHardness(c.world,pos) < 0) { unknown++; if(unknownPositions.size()<256)unknownPositions.add(pos); }
            if (!old.isAir()) { if (state.isAir()) clears++; else conflicts++; if (conflictPositions.size()<256) conflictPositions.add(pos); } else if (!state.isAir()) adds++;
        }
        status = scanCursor < asset.volume() ? "正在检查放置区域…" : "区域检查：新增 " + adds + " · 覆盖 " + conflicts + " · 挖空 " + clears + " · 不可用 " + unknown+" · 底部悬空 "+unsupportedBase;
    }
    public boolean canPlace() {
        var c = MinecraftClient.getInstance();
        return asset != null && !asset.diagnosticOnly && heightBlockReason()==null && visible && locked && !busy && !restoring && renderer.cutLayer<0 && !renderer.building && renderer.error == null && c.getServer() != null && c.player != null && c.player.isCreative() && checked() && unknown == 0;
    }
    private String heightBlockReason(){var world=MinecraftClient.getInstance().world;if(asset==null||world==null)return null;
        if(dev.voxelstudio.Asset.fitsHeight(anchor.getY(),asset.height,world.getBottomY(),world.getTopY()))return null;
        int highest=world.getTopY()-asset.height;
        return highest<world.getBottomY()?"建筑高 "+asset.height+" 格，超过当前维度总高度；请更换维度，不会裁剪":"建筑超出世界高度；当前底部 Y="+anchor.getY()+"，可放置底部 Y 范围："+world.getBottomY()+".."+highest+"。请降低或升高投影。";
    }
    public boolean checked() { return asset!=null && scanRevision==transformRevision && scanCursor>=asset.volume()&&(watch==null||watch.revision()==watchedRevision); }
    public double checkProgress() { return asset==null||scanRevision!=transformRevision?0:Math.min(1,(double)scanCursor/asset.volume()); }
    public String placementBlockReason() {
        var c=MinecraftClient.getInstance();
        if(busy)return "正在修改世界，请等待完成或停止当前操作";
        if(asset==null)return "先生成建筑，或在创作页加载示例";
        if(asset.diagnosticOnly)return "失败诊断视图，不可建造；需修正设计并重新编译";
        String heightError=heightBlockReason();if(heightError!=null)return heightError;
        if(renderer.cutLayer>=0)return "当前处于剖切预览，请先显示全部楼层再确认建造";
        if(c.getServer()==null||c.player==null||!c.player.isCreative())return "直接建造仅限单人创造模式；多人世界仍可预览";
        if(renderer.error!=null)return "预览网格加载失败，请查看详情";
        if(renderer.building)return "正在准备建筑网格，请稍候";
        if(!visible)return "先显示世界投影，确定建造位置";
        if(!locked)return "滚轮推远/拉近，K 或 Enter 锁定后再检查建造";
        if(!checked())return "正在检查位置，完成后可确认";
        if(unknown>0)return "有 "+unknown+" 个不可用格：检查高度、区块或危险方块";
        return asset.navigationAcknowledgementRequired?"位置检查完成；通行未验证，建造前须明确确认风险":"位置检查完成；确认后才会修改世界";
    }
    public void place(Placement frozen, String dimension,String checkToken,boolean navigationAcknowledged) {
        if (!canPlace() || frozen.transformRevision() != transformRevision || !frozen.asset().hash.equals(asset.hash) || !key().equals(dimension)) { status = "确认已过期，请重新检查当前位置"; return; }
        var c = MinecraftClient.getInstance(); busy = true;
        PlacementService.startChecked(c.getServer(), c.player.getUuid(), c.world.getRegistryKey().getValue(), frozen,checkToken,navigationAcknowledged, r -> c.execute(() -> { busy = !r.finished(); status = StudioMessages.operation(r.message()) + " · 已改 " + r.changed() + " · 跳过 " + r.conflicts(); if (r.finished()&&r.changed()>0) visible = false; }));
    }
    public void undo() {
        var c = MinecraftClient.getInstance(); if (busy || c.getServer() == null || c.player == null) return; busy = true;
        PlacementService.undo(c.getServer(), c.player.getUuid(), r -> c.execute(() -> { busy = !r.finished(); status = StudioMessages.operation(r.message()) + " · 恢复 " + r.changed() + " · 冲突 " + r.conflicts(); }));
    }
    public void cancelPlacement() { var s = MinecraftClient.getInstance().getServer(); if (s != null) PlacementService.cancel(s); }
    public String key() {
        var c = MinecraftClient.getInstance(); if (c.world == null) return "none";
        String world = c.getServer() != null ? c.getServer().getSavePath(net.minecraft.util.WorldSavePath.ROOT).toAbsolutePath().normalize().toString() : c.getCurrentServerEntry() == null ? "unknown" : c.getCurrentServerEntry().address;
        return world + "|" + c.world.getRegistryKey().getValue();
    }
    private Path draftFile() { return FabricLoader.getInstance().getConfigDir().resolve("voxel-studio-draft.json"); }
    private void saveDraft() {
        if (asset == null||worldKey==null||worldKey.equals("none")||!worldKey.equals(key())||!asset.revision.matches("[0-9a-f-]{36}")) return;
        JsonObject d = new JsonObject(); d.addProperty("world", worldKey); d.addProperty("job", asset.revision); d.addProperty("hash", asset.hash); d.addProperty("x", anchor.getX()); d.addProperty("y", anchor.getY()); d.addProperty("z", anchor.getZ()); d.addProperty("rotation", rotation); d.addProperty("mirror", mirror);d.addProperty("replace",replace);d.addProperty("opacity",opacity);
        String savingScope=worldKey;
        pendingDrafts.put(savingScope,d);
        var previous=draftSaves.get(savingScope);if(previous!=null)previous.cancel(false);
        draftSaves.put(savingScope,DRAFT_IO.schedule(()->drafts.saveDraft(d).whenComplete((v,e)->MinecraftClient.getInstance().execute(()->{
            if(e!=null){persistenceError="草稿保存失败："+StudioMessages.error(e);status=persistenceError;}else {persistenceError=null;if(pendingDrafts.get(savingScope)==d){pendingDrafts.remove(savingScope);draftSaves.remove(savingScope);}}
        })),300,TimeUnit.MILLISECONDS));
    }
    public void close(){for(var save:draftSaves.values())save.cancel(false);for(var d:pendingDrafts.values())drafts.saveDraft(d);DRAFT_IO.shutdown();if(watch!=null)watch.close();renderer.close();}
    public void restore(BridgeClient bridge) {
        if (busy||restoring||key().equals("none")) return;
        restoring=true;String scopeKey=key();long ticket=transformRevision;status="正在读取当前世界草稿…";
        drafts.draft(scopeKey,draftFile()).whenComplete((d,readError)->MinecraftClient.getInstance().execute(()->{
            if(readError!=null){restoring=false;persistenceError=StudioMessages.error(readError);status=persistenceError;return;}
            if(!key().equals(scopeKey)||ticket!=transformRevision){restoring=false;status="世界或投影变化，已丢弃旧草稿读取结果";return;}
            bridge.load(d.get("job").getAsString()).whenComplete((a,e)->MinecraftClient.getInstance().execute(()->{
                restoring=false;if(e!=null){status=StudioMessages.error(e);return;}
                if(busy||!key().equals(scopeKey)||ticket!=transformRevision||!a.hash.equals(d.get("hash").getAsString())){status="草稿版本、位置或世界已变化，未恢复";return;}
                load(a);rotation=d.get("rotation").getAsInt();mirror=d.get("mirror").getAsBoolean();anchor=new BlockPos(d.get("x").getAsInt(),d.get("y").getAsInt(),d.get("z").getAsInt());replace=d.has("replace")&&d.get("replace").getAsBoolean();if(d.has("opacity"))opacity=MathHelper.clamp(d.get("opacity").getAsFloat(),.15f,.85f);
                locked=true;positioned=true;changed(true);show();status=d.has("legacy")?"旧草稿已显式恢复并另存；旧文件仍保留":"已恢复当前世界草稿；尚未建造";
            }));
        }));
    }
}
