package dev.voxelstudio;

import com.google.gson.*;
import net.minecraft.block.*;
import net.minecraft.command.argument.BlockArgumentParser;
import net.minecraft.registry.Registries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.WorldSavePath;
import net.minecraft.util.math.BlockPos;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** Integrated-server-only executor. Disk I/O is off thread; each batch has durable write-ahead intent. */
public final class PlacementService {
    private static final ExecutorService IO = Executors.newSingleThreadExecutor(r -> { Thread t = new Thread(r, "voxel-journal"); t.setDaemon(true); return t; });
    private static final Map<MinecraftServer, Task> TASKS = new HashMap<>();
    private static final Map<MinecraftServer, Check> CHECKS=new HashMap<>();
    private static final Map<MinecraftServer, Audit> AUDITS=new HashMap<>();
    public static boolean busy(MinecraftServer server){if(!server.isOnThread())throw new IllegalStateException("Building busy state requires server thread");return TASKS.containsKey(server)||CHECKS.containsKey(server)||AUDITS.containsKey(server);}
    public record AuditResult(int matchesBefore,int matchesAfter,int conflicts,int unavailable) {}
    private static final class Audit {ServerWorld world;UUID player;List<JournalRecovery.Entry> entries;int cursor,before,after,conflicts,unknown;CompletableFuture<AuditResult> result=new CompletableFuture<>();}
    public record CheckedPlacement(String token,int adds,int replaces,int clears,int skips) {}
    private static final class Check {
        UUID player;ServerWorld world;Placement placement;WorldChangeTracker.Watch watch;long epoch,expires;
        int cursor,adds,replaces,clears,skips;int[] before;String token=UUID.randomUUID().toString();
        CompletableFuture<CheckedPlacement> result=new CompletableFuture<>();
    }
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    public record Result(String message, boolean finished, int changed, int conflicts) {}
    private record Entry(long pos, String before, String after) {}
    private static class Task {
        ServerWorld world; UUID player; Placement placement; Consumer<Result> callback; Path dir;
        int cursor, changed, conflicts, batch; boolean cancel, undo; List<Entry> undoEntries;
        CompletableFuture<Void> disk; List<Entry> pending; boolean awaitingCommit, undoMarkerPending;
        int pendingCursor; List<Entry> pendingApplied; final Map<String,BlockState> stateCache = new HashMap<>();
        int[] confirmedBefore;
        BitSet grouped=new BitSet();Map<Integer,Integer> pendingGroupSizes=new HashMap<>();
        Map<Long,Integer> undoIndex=new HashMap<>();
    }
    public static CompletableFuture<CheckedPlacement> check(MinecraftServer server,UUID playerId,net.minecraft.util.Identifier dimension,Placement placement){
        var result=new CompletableFuture<CheckedPlacement>();server.execute(()->{try{
            dev.voxelstudio.selection.WorldOperationExclusion.require(server,dev.voxelstudio.selection.WorldOperationExclusion.Kind.NEW_BUILDING);
            placement.asset().requireBuildable();
            var player=authorize(server,playerId);if(TASKS.containsKey(server))throw new IllegalStateException("Another world operation is running");
            var world=player.getServerWorld();if(!world.getRegistryKey().getValue().equals(dimension))throw new IllegalStateException("Dimension changed after confirmation");
            if(!Asset.fitsHeight(placement.anchor().getY(),placement.asset().height,world.getBottomY(),world.getTopY()))throw new IllegalStateException("Building exceeds dimension height");
            discardCheck(server,"Region check superseded");Check c=new Check();c.player=playerId;c.world=world;c.placement=placement;c.before=new int[placement.asset().volume()];c.watch=WorldChangeTracker.watch(world,placement);c.epoch=c.watch.revision();c.expires=System.nanoTime()+60_000_000_000L;c.result=result;CHECKS.put(server,c);
        }catch(Exception e){result.completeExceptionally(e);}});return result;
    }
    private static void discardCheck(MinecraftServer server,String reason){Check old=CHECKS.remove(server);if(old!=null){old.watch.close();old.result.completeExceptionally(new IllegalStateException(reason));}}
    private static void tickCheck(MinecraftServer server){
        Check c=CHECKS.get(server);if(c==null)return;
        try{
            var p=authorize(server,c.player);if(p.getServerWorld()!=c.world||c.watch.revision()!=c.epoch||System.nanoTime()>c.expires)throw new IllegalStateException("World changed or region check expired; check again");
            if(c.result.isDone())return;long deadline=System.nanoTime()+2_000_000;
            while(c.cursor<c.placement.asset().volume()&&System.nanoTime()<deadline){
                int i=c.cursor++;if(c.placement.asset().cell(i)==0)continue;BlockPos pos=c.placement.world(i);
                if(!safe(c.world,pos,c.placement.state(i)))throw new IllegalStateException("Unsafe or unloaded target; check again");
                BlockState before=c.world.getBlockState(pos),after=c.placement.state(i);c.before[i]=Block.getRawIdFromState(before);
                SpecialBlocks.requireSupport(c.placement,i,c.world);
                if(SpecialBlocks.door(before)||SpecialBlocks.door(after))for(int part:SpecialBlocks.group(c.placement,i,n->c.world.getBlockState(c.placement.world(n)))){
                    BlockPos pairPos=c.placement.world(part);BlockState old=c.world.getBlockState(pairPos);
                    if(!safe(c.world,pairPos)||!c.placement.replace()&&!old.isAir()&&!old.equals(c.placement.state(part)))throw new IllegalStateException("门的两格必须能一起放置；存在阻挡，请换位置或明确选择覆盖");
                }
                if(before.equals(after)||(!c.placement.replace()&&!before.isAir()))c.skips++;else if(after.isAir())c.clears++;else if(before.isAir())c.adds++;else c.replaces++;
            }
            if(c.cursor==c.placement.asset().volume())c.result.complete(new CheckedPlacement(c.token,c.adds,c.replaces,c.clears,c.skips));
        }catch(Exception e){discardCheck(server,e.getMessage());}
    }
    public static void startChecked(MinecraftServer server,UUID playerId,net.minecraft.util.Identifier dimension,Placement placement,String token,Consumer<Result> callback){
        startChecked(server,playerId,dimension,placement,token,false,callback);
    }
    public static void startChecked(MinecraftServer server,UUID playerId,net.minecraft.util.Identifier dimension,Placement placement,String token,boolean navigationAcknowledged,Consumer<Result> callback){
        server.execute(()->{
            try{dev.voxelstudio.selection.WorldOperationExclusion.require(server,dev.voxelstudio.selection.WorldOperationExclusion.Kind.NEW_BUILDING);placement.asset().requireBuildable();NavigationReview.requireAcknowledged(placement.asset().navigationAcknowledgementRequired,navigationAcknowledged);}catch(IllegalStateException e){callback.accept(new Result(e.getMessage(),true,0,0));return;}
            Check c=CHECKS.get(server);
            if(c==null||!c.result.isDone()||c.result.isCompletedExceptionally()||!c.token.equals(token)||!c.player.equals(playerId)||!c.placement.equals(placement)||!c.world.getRegistryKey().getValue().equals(dimension)||c.watch.revision()!=c.epoch||System.nanoTime()>c.expires){callback.accept(new Result("Confirmation expired; check the current world again",true,0,0));return;}
            CHECKS.remove(server);c.watch.close();startInternal(server,playerId,dimension,placement,c.before,callback);
        });
    }
    /** Explicit development fixture path; production UI must present the authoritative check first. */
    public static void start(MinecraftServer server, UUID playerId, net.minecraft.util.Identifier dimension, Placement placement, Consumer<Result> callback) {
        if(!net.fabricmc.loader.api.FabricLoader.getInstance().isDevelopmentEnvironment()||!Boolean.getBoolean("voxelstudio.selftest"))throw new IllegalStateException("Use checked placement and explicit confirmation");
        check(server,playerId,dimension,placement).whenComplete((c,e)->{if(e!=null)callback.accept(new Result(rootMessage(e),true,0,0));else startChecked(server,playerId,dimension,placement,c.token(),callback);});
    }
    private static void startInternal(MinecraftServer server, UUID playerId, net.minecraft.util.Identifier dimension, Placement placement,int[] confirmedBefore, Consumer<Result> callback) {
        server.execute(() -> {
            try {
                dev.voxelstudio.selection.WorldOperationExclusion.require(server,dev.voxelstudio.selection.WorldOperationExclusion.Kind.NEW_BUILDING);
                placement.asset().requireBuildable();
                ServerPlayerEntity player = authorize(server, playerId);
                if (TASKS.containsKey(server)) throw new IllegalStateException("Another world operation is running");
                ServerWorld world = player.getServerWorld();
                if (!world.getRegistryKey().getValue().equals(dimension)) throw new IllegalStateException("Dimension changed after confirmation");
                if (!Asset.fitsHeight(placement.anchor().getY(),placement.asset().height,world.getBottomY(),world.getTopY())) throw new IllegalStateException("Building exceeds dimension height");
                Task t = new Task(); t.world = world; t.player = playerId; t.placement = placement; t.callback = callback;
                t.confirmedBefore=confirmedBefore;
                t.dir = root(server).resolve(UUID.randomUUID().toString());
                JsonObject meta = new JsonObject(); meta.addProperty("player", playerId.toString()); meta.addProperty("dimension", world.getRegistryKey().getValue().toString()); meta.addProperty("assetHash", placement.asset().hash); meta.addProperty("revision", placement.asset().revision); meta.addProperty("transformRevision", placement.transformRevision()); meta.addProperty("anchor", placement.anchor().asLong()); meta.addProperty("rotation", placement.rotation()); meta.addProperty("mirror", placement.mirror());
                meta.addProperty("navigationUnverifiedAcknowledged",placement.asset().navigationAcknowledgementRequired);
                t.disk = CompletableFuture.runAsync(() -> write(t.dir.resolve("metadata.json"), GSON.toJson(meta)), IO);
                TASKS.put(server, t); callback.accept(new Result("Placement started; waiting for durable journal", false, 0, 0));
            } catch (Exception e) { callback.accept(new Result(e.getMessage(), true, 0, 0)); }
        });
    }
    private static ServerPlayerEntity authorize(MinecraftServer server, UUID id) {
        if (server.isDedicated()) throw new IllegalStateException("Direct placement currently requires an integrated server");
        ServerPlayerEntity p = server.getPlayerManager().getPlayer(id);
        if (p == null || !p.isCreative() || !server.isHost(p.getGameProfile())) throw new IllegalStateException("Only the single-player creative host can build/undo");
        return p;
    }
    private static Path root(MinecraftServer s) { return s.getSavePath(WorldSavePath.ROOT).resolve("voxel-studio-journals"); }
    public static void cancel(MinecraftServer s) { s.execute(() -> { Task t = TASKS.get(s); if (t != null) t.cancel = true; }); }
    public static void undo(MinecraftServer server, UUID playerId, Consumer<Result> callback) {
        undo(server,playerId,null,callback);
    }
    public static void undo(MinecraftServer server, UUID playerId,String selectedJournal, Consumer<Result> callback) {
        server.execute(() -> {
            try {
                dev.voxelstudio.selection.WorldOperationExclusion.require(server,dev.voxelstudio.selection.WorldOperationExclusion.Kind.NEW_BUILDING);
                ServerPlayerEntity player = authorize(server, playerId);
                if (TASKS.containsKey(server)) throw new IllegalStateException("Cancel/finish the current operation before undo");
                Task t = new Task(); t.undo = true; t.player = playerId; t.world = player.getServerWorld(); t.callback = callback;
                t.disk = CompletableFuture.runAsync(() -> {
                    try {
                        if (!Files.exists(root(server))) throw new IllegalStateException("No placement journal");
                        List<Path> dirs;
                        try (var stream = Files.list(root(server))) { dirs = stream.filter(Files::isDirectory).sorted(Comparator.comparingLong((Path p) -> p.toFile().lastModified()).reversed()).toList(); }
                        for (Path dir : dirs) {
                            if(selectedJournal!=null&&!dir.getFileName().toString().equals(selectedJournal))continue;
                            Path metaFile = dir.resolve("metadata.json");
                            if (!Files.exists(metaFile) || Files.exists(dir.resolve("undone.json"))) continue;
                            JsonObject meta = JsonParser.parseString(Files.readString(metaFile)).getAsJsonObject();
                            if (!meta.get("player").getAsString().equals(playerId.toString()) || !meta.get("dimension").getAsString().equals(t.world.getRegistryKey().getValue().toString())) continue;
                            JournalRecovery.Review review=JournalRecovery.inspect(dir);
                            if(review.needsReview())throw new IllegalStateException("Journal needs manual recovery review: "+review.id()+" (missing receipts: "+review.missingReceipts()+"; issue: "+(review.issue()==null?"unconfirmed writes":review.issue())+")");
                            List<Entry> entries = new ArrayList<>();for(var e:review.entries())entries.add(new Entry(e.pos(),e.before(),e.after()));Collections.reverse(entries);
                            t.dir = dir; t.undoEntries = entries;for(int i=0;i<entries.size();i++)t.undoIndex.put(entries.get(i).pos,i); return;
                        }
                        throw new IllegalStateException("No undoable placement in this dimension");
                    } catch (Exception e) { throw new CompletionException(e); }
                }, IO);
                TASKS.put(server, t);
            } catch (Exception e) { callback.accept(new Result(e.getMessage(), true, 0, 0)); }
        });
    }
    public static void tick(MinecraftServer server) {
        tickCheck(server);
        tickAudit(server);
        Task t = TASKS.get(server); if (t == null) return;
        try {
            authorize(server, t.player);
            if (server.getPlayerManager().getPlayer(t.player).getServerWorld() != t.world) t.cancel = true;
            if (t.disk != null) { if (!t.disk.isDone()) return; t.disk.join(); t.disk = null; }
            if (t.undoMarkerPending) { finish(server, t, "Undo finished; subsequent edits preserved"); return; }
            if (t.awaitingCommit) { t.awaitingCommit = false; t.pending = null; t.batch++; }
            if (t.cancel && t.pending == null) { finish(server, t, "Cancelled; completed batches remain undoable"); return; }
            if (t.undo) { tickUndo(server, t); return; }
            if (t.pending != null) {
                long deadline=System.nanoTime()+2_000_000;
                while (!t.cancel && t.pendingCursor<t.pending.size() && System.nanoTime()<deadline) {
                    int count=t.pendingGroupSizes.getOrDefault(t.pendingCursor,1),start=t.pendingCursor;t.pendingCursor+=count;boolean valid=true;
                    for(int j=start;j<start+count;j++){Entry e=t.pending.get(j);BlockPos p=BlockPos.fromLong(e.pos);if(!safe(t.world,p)||!t.world.getBlockState(p).equals(cachedState(t,e.before)))valid=false;
                        BlockState next=cachedState(t,e.after);if(SpecialBlocks.door(next)&&SpecialBlocks.offset(next)==1&&!t.world.getBlockState(p.down()).isSideSolidFullSquare(t.world,p.down(),net.minecraft.util.math.Direction.UP))valid=false;
                    }
                    if(!valid){t.conflicts+=count;continue;}
                    // No cancellation/yield between connected door halves; receipt covers the whole server-thread edit.
                    for(int j=start;j<start+count;j++){Entry e=t.pending.get(j);BlockPos p=BlockPos.fromLong(e.pos);BlockState after=cachedState(t,e.after);if(t.world.setBlockState(p,after,Block.NOTIFY_LISTENERS|Block.FORCE_STATE|Block.SKIP_DROPS)){t.pendingApplied.add(e);t.changed++;}else if(count>1&&t.world.getBlockState(p).equals(after))t.pendingApplied.add(e);}
                }
                if(!t.cancel && t.pendingCursor<t.pending.size())return;
                List<Entry> applied=List.copyOf(t.pendingApplied);
                Path file = t.dir.resolve(String.format("%06d.applied.json", t.batch));
                t.disk = CompletableFuture.runAsync(() -> write(file, GSON.toJson(applied)), IO); t.awaitingCommit = true;
                t.callback.accept(new Result("Building", false, t.changed, t.conflicts)); return;
            }
            List<Entry> batch = new ArrayList<>();t.pendingGroupSizes.clear(); long end = System.nanoTime() + 2_000_000;
            Asset a = t.placement.asset();
            while (t.cursor < a.volume() && batch.size() < JournalRecovery.MAX_BATCH_ENTRIES && System.nanoTime() < end) {
                int i = t.cursor++; if (a.cell(i) == 0) continue;
                BlockPos p = t.placement.world(i);
                if (!safe(t.world, p,t.placement.state(i))) { t.conflicts++; continue; }
                BlockState before = t.world.getBlockState(p), after = t.placement.state(i);
                if(t.grouped.get(i))continue;
                if(SpecialBlocks.door(before)||SpecialBlocks.door(after)){
                    List<Integer> group;try{group=SpecialBlocks.group(t.placement,i,n->t.world.getBlockState(t.placement.world(n)));}catch(IllegalStateException e){t.conflicts++;continue;}
                    // Decide BEFORE marking group members consumed. Revisit the
                    // same first cell after flushing this batch; no half-door
                    // writes and no 513-entry journals that cannot be undone.
                    if(!atomicGroupFitsBatch(batch.size(),group.size())){t.cursor=i;break;}
                    boolean valid=true;for(int part:group){t.grouped.set(part);BlockPos pos=t.placement.world(part);BlockState old=t.world.getBlockState(pos);if(!safe(t.world,pos)||Block.getRawIdFromState(old)!=t.confirmedBefore[part]||!t.placement.replace()&&!old.isAir()&&!old.equals(t.placement.state(part)))valid=false;}
                    if(!valid){t.conflicts+=group.size();continue;}int start=batch.size();
                    for(int part:group){BlockPos pos=t.placement.world(part);BlockState old=t.world.getBlockState(pos),next=t.placement.state(part);batch.add(new Entry(pos.asLong(),BlockArgumentParser.stringifyBlockState(old),BlockArgumentParser.stringifyBlockState(next)));}
                    t.pendingGroupSizes.put(start,group.size());continue;
                }
                if(Block.getRawIdFromState(before)!=t.confirmedBefore[i]){t.conflicts++;continue;}
                if (before.equals(after)) continue;
                if (!t.placement.replace() && !before.isAir()) { t.conflicts++; continue; }
                batch.add(new Entry(p.asLong(), BlockArgumentParser.stringifyBlockState(before), BlockArgumentParser.stringifyBlockState(after)));
            }
            if (!batch.isEmpty()) {
                t.pending = batch; t.pendingCursor=0; t.pendingApplied=new ArrayList<>(); Path file = t.dir.resolve(String.format("%06d.intent.json", t.batch));
                t.disk = CompletableFuture.runAsync(() -> write(file, GSON.toJson(batch)), IO);
            } else if (t.cursor >= a.volume()) finish(server, t, "Placement finished");
        } catch (Exception e) { finish(server, t, "Stopped safely: " + rootMessage(e)); }
    }
    static boolean atomicGroupFitsBatch(int currentSize,int groupSize){
        if(currentSize<0||currentSize>JournalRecovery.MAX_BATCH_ENTRIES||groupSize<1||groupSize>JournalRecovery.MAX_BATCH_ENTRIES)throw new IllegalArgumentException("Invalid atomic placement batch size");
        return groupSize<=JournalRecovery.MAX_BATCH_ENTRIES-currentSize;
    }
    private static void tickUndo(MinecraftServer server, Task t) throws Exception {
        long end = System.nanoTime() + 2_000_000;
        while (t.cursor < t.undoEntries.size() && System.nanoTime() < end) {
            int first=t.cursor++;if(t.grouped.get(first))continue;
            Entry e = t.undoEntries.get(first); BlockPos p = BlockPos.fromLong(e.pos);
            if(SpecialBlocks.door(cachedState(t,e.before))||SpecialBlocks.door(cachedState(t,e.after))){
                var group=new ArrayList<Integer>();var seen=new HashSet<Integer>();group.add(first);seen.add(first);boolean valid=true;
                for(int at=0;at<group.size();at++){Entry part=t.undoEntries.get(group.get(at));for(BlockState state:List.of(cachedState(t,part.before),cachedState(t,part.after)))if(SpecialBlocks.door(state)){
                    Integer partner=t.undoIndex.get(BlockPos.fromLong(part.pos).up(SpecialBlocks.offset(state)).asLong());if(partner==null){valid=false;continue;}if(seen.add(partner))group.add(partner);
                }}
                for(int index:group){t.grouped.set(index);Entry part=t.undoEntries.get(index);BlockPos pos=BlockPos.fromLong(part.pos);BlockState current=t.world.getBlockState(pos);if(!safe(t.world,pos)||!current.equals(cachedState(t,part.after))&&!current.equals(cachedState(t,part.before)))valid=false;}
                if(!valid){t.conflicts+=group.size();continue;}
                for(int index:group){Entry part=t.undoEntries.get(index);BlockPos pos=BlockPos.fromLong(part.pos);if(t.world.setBlockState(pos,cachedState(t,part.before),Block.NOTIFY_LISTENERS|Block.FORCE_STATE|Block.SKIP_DROPS))t.changed++;}continue;
            }
            if (!t.world.isChunkLoaded(p) || !t.world.getWorldBorder().contains(p) || t.world.isOutOfHeightLimit(p)) { t.conflicts++; continue; }
            BlockState before = cachedState(t,e.before), after = cachedState(t,e.after), current = t.world.getBlockState(p);
            if (current.equals(before)) continue; // Also makes a restarted undo idempotent.
            if (!safe(t.world, p,after) || !current.equals(after)) { t.conflicts++; continue; }
            if (t.world.setBlockState(p, before, Block.NOTIFY_LISTENERS | Block.FORCE_STATE | Block.SKIP_DROPS)) t.changed++;
        }
        if (t.cursor >= t.undoEntries.size()) {
            t.undoMarkerPending = true;
            t.disk = CompletableFuture.runAsync(() -> write(t.dir.resolve("undone.json"), "{}"), IO);
        } else t.callback.accept(new Result("Undoing", false, t.changed, t.conflicts));
    }
    public static CompletableFuture<List<JournalRecovery.Review>> journals(MinecraftServer server,UUID playerId){
        var result=new CompletableFuture<List<JournalRecovery.Review>>();server.execute(()->{try{
            var player=authorize(server,playerId);Path directory=root(server);String dimension=player.getServerWorld().getRegistryKey().getValue().toString();
            CompletableFuture.supplyAsync(()->{try{return JournalRecovery.list(directory,playerId.toString(),dimension);}catch(Exception e){throw new CompletionException(e);}},IO).whenComplete((r,e)->{if(e!=null)result.completeExceptionally(e);else result.complete(r);});
        }catch(Exception e){result.completeExceptionally(e);}});return result;
    }
    public static CompletableFuture<AuditResult> audit(MinecraftServer server,UUID playerId,JournalRecovery.Review review){
        var result=new CompletableFuture<AuditResult>();server.execute(()->{try{
            dev.voxelstudio.selection.WorldOperationExclusion.require(server,dev.voxelstudio.selection.WorldOperationExclusion.Kind.NEW_BUILDING);
            var player=authorize(server,playerId);if(AUDITS.containsKey(server)||TASKS.containsKey(server))throw new IllegalStateException("Another world operation or audit is running");
            if(!review.metadata().has("player")||!playerId.toString().equals(review.metadata().get("player").getAsString())||!player.getServerWorld().getRegistryKey().getValue().toString().equals(review.metadata().get("dimension").getAsString()))throw new IllegalStateException("Journal ownership/dimension mismatch");
            Audit a=new Audit();a.world=player.getServerWorld();a.player=playerId;a.entries=review.entries();a.result=result;AUDITS.put(server,a);
        }catch(Exception e){result.completeExceptionally(e);}});return result;
    }
    private static void tickAudit(MinecraftServer server){
        Audit a=AUDITS.get(server);if(a==null)return;try{
            var player=authorize(server,a.player);if(player.getServerWorld()!=a.world)throw new IllegalStateException("World changed during journal audit");
            long deadline=System.nanoTime()+2_000_000;while(a.cursor<a.entries.size()&&System.nanoTime()<deadline){
                var e=a.entries.get(a.cursor++);BlockPos p=BlockPos.fromLong(e.pos());if(!a.world.isChunkLoaded(p)||a.world.isOutOfHeightLimit(p)||!a.world.getWorldBorder().contains(p)){a.unknown++;continue;}
                String current=BlockArgumentParser.stringifyBlockState(a.world.getBlockState(p));if(current.equals(e.before()))a.before++;else if(current.equals(e.after())&&safe(a.world,p,state(e.after())))a.after++;else a.conflicts++;
            }
            if(a.cursor==a.entries.size()){AUDITS.remove(server);a.result.complete(new AuditResult(a.before,a.after,a.conflicts,a.unknown));}
        }catch(Exception e){AUDITS.remove(server);a.result.completeExceptionally(e);}
    }
    private static boolean safe(ServerWorld world, BlockPos p) {
        return safe(world,p,null);
    }
    // Light is an approved generated block but has vanilla hardness -1. Only an
    // exact dry state match can be a harmless placement no-op or an owned undo
    // receipt. This never permits overwriting bedrock, another light level, wet
    // light, or any later player edit. Normal world replacement stays unchanged.
    static boolean matchesApprovedLight(BlockState current,BlockState expected) {
        return expected!=null&&current.equals(expected)&&current.isOf(Blocks.LIGHT)&&current.getFluidState().isEmpty();
    }
    private static boolean safe(ServerWorld world, BlockPos p,BlockState expectedLight) {
        if (!world.isChunkLoaded(p) || !world.getWorldBorder().contains(p) || world.isOutOfHeightLimit(p)) return false;
        BlockState old = world.getBlockState(p);
        return !old.hasBlockEntity() && !(old.getBlock() instanceof FallingBlock) && old.getFluidState().isEmpty() && (old.getHardness(world, p) >= 0||matchesApprovedLight(old,expectedLight));
    }
    private static BlockState state(String s) throws Exception { return BlockArgumentParser.block(Registries.BLOCK.getReadOnlyWrapper(), s, false).blockState(); }
    private static BlockState cachedState(Task t,String s) throws Exception { BlockState state=t.stateCache.get(s);if(state==null){state=state(s);t.stateCache.put(s,state);}return state; }
    private static void write(Path file, String text) {
        try {
            Files.createDirectories(file.getParent()); Path temp = file.resolveSibling(file.getFileName() + ".tmp");
            byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
            try (var ch = FileChannel.open(temp, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE)) { var buf = java.nio.ByteBuffer.wrap(bytes); while (buf.hasRemaining()) ch.write(buf); ch.force(true); }
            Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (Exception e) { throw new CompletionException(e); }
    }
    private static void finish(MinecraftServer server, Task t, String message) {
        TASKS.remove(server);
        if(t.dir==null){t.callback.accept(new Result(message,true,t.changed,t.conflicts));return;}
        JsonObject outcome=new JsonObject();outcome.addProperty("schemaVersion",1);outcome.addProperty("operation",t.undo?"undo":"placement");outcome.addProperty("message",message);outcome.addProperty("changed",t.changed);outcome.addProperty("conflicts",t.conflicts);outcome.addProperty("worldSaveDurability","not-guaranteed-by-journal");
        CompletableFuture.runAsync(()->write(t.dir.resolve("operation.json"),GSON.toJson(outcome)),IO).whenComplete((v,e)->server.execute(()->t.callback.accept(new Result(e==null?message:message+"; journal outcome save failed; review required",true,t.changed,t.conflicts))));
    }
    private static String rootMessage(Throwable t) { while (t.getCause() != null) t = t.getCause(); return String.valueOf(t.getMessage()); }
    public static void stopping(MinecraftServer server) {
        discardCheck(server,"Server stopped; check again after restart");
        Audit audit=AUDITS.remove(server);if(audit!=null)audit.result.completeExceptionally(new IllegalStateException("Server stopped during audit"));
        Task t = TASKS.remove(server); if (t == null) return;
        t.cancel = true;
        // No more world writes occur on shutdown. Preserve an exact receipt for the
        // applied prefix, even when a 512-cell batch spans several server ticks.
        CompletableFuture<Void> flush = t.disk == null ? CompletableFuture.completedFuture(null) : t.disk;
        if (!t.undo && t.pending != null && !t.awaitingCommit) {
            List<Entry> applied = List.copyOf(t.pendingApplied);
            Path file = t.dir.resolve(String.format("%06d.applied.json", t.batch));
            flush = flush.thenRunAsync(() -> write(file, GSON.toJson(applied)), IO);
        }
        try { flush.get(5, TimeUnit.SECONDS); }
        catch (Exception e) {
            org.slf4j.LoggerFactory.getLogger("voxel_studio").error("Journal shutdown flush failed; incomplete batches require manual review: {}", t.dir, e);
        }
    }
}
