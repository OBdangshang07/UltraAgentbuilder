package dev.voxelstudio.selection;

import com.google.gson.*;
import com.sun.jna.platform.win32.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

/** Native disk log tests ONLY: no live server, model calls, placement or save
 * durability claims. All destructive fault injection is in this test's E TEMP. */
final class WorldPatchJournalTest {
    @TempDir Path temp;
    private record Fixture(SelectionReadService.Capture capture,WorldPatchCompiler.Compiled compiled,WorldPatchPreview preview,byte[] response){}
    private SelectionRegion.Point point(JsonArray a){return new SelectionRegion.Point(a.get(0).getAsInt(),a.get(1).getAsInt(),a.get(2).getAsInt());}
    private SelectionRegion region(JsonObject v){return new SelectionRegion(point(v.getAsJsonArray("min")),point(v.getAsJsonArray("max")));}
    private byte[] bytes(JsonElement v){return v.toString().getBytes(StandardCharsets.UTF_8);}
    private Fixture fixture(boolean large)throws Exception{
        var f=JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/"+(large?"world-patch-journal.json":"world-patch-safety.json")))).getAsJsonObject();
        if(!large)f=f.getAsJsonArray("valid").get(2).getAsJsonObject();
        var s=f.getAsJsonObject("selection");var w=s.getAsJsonObject("world");var protect=new ArrayList<SelectionRegion>();for(var r:s.getAsJsonArray("protected"))protect.add(region(r.getAsJsonObject()));
        var selection=new WorldSelection(new WorldSelection.WorldIdentity(w.get("worldId").getAsString(),w.get("dimension").getAsString(),w.get("minY").getAsInt(),w.get("maxY").getAsInt()),s.get("revision").getAsLong(),region(s.getAsJsonObject("context")),region(s.getAsJsonObject("edit")),protect);
        var baseline=SelectionBaseline.fromSealedCapture(selection,f.getAsJsonObject("capture"));var compiled=WorldPatchCompiler.compile(baseline,f.getAsJsonObject("raw"),()->false);
        var v=f.getAsJsonObject("preview");var binding=new WorldPatchPreview.Binding(selection,baseline.contextRevision,baseline.snapshotHash,baseline.selectionHash,compiled.patchHash(),v.get("previewHash").getAsString());
        var payload=new JsonObject();payload.add("selection",s);payload.add("capture",f.get("capture"));
        return new Fixture(new SelectionReadService.Capture(UUID.randomUUID().toString(),selection,baseline.contextRevision,payload.toString(),null,false),compiled,WorldPatchPreview.parse(bytes(v),binding),bytes(f.get("raw")));
    }
    private WorldPatchJournal.Plan plan(Fixture f){return WorldPatchJournal.prepare(f.capture,f.compiled,f.preview,f.response,UUID.randomUUID());}
    private WorldPatchJournal.Live live(boolean large)throws Exception{return WorldPatchJournal.create(temp,plan(fixture(large)));}
    private void complete(WorldPatchJournal.Live l)throws Exception{
        int count=l.plan().compiled().writes().size();for(int cursor=0;cursor<count;cursor+=WorldPatchJournal.BATCH){var i=l.intent(WorldPatchJournal.BATCH);l.applied(i,i.writes(),WorldPatchJournal.ReceiptState.COMPLETE);}l.finish(WorldPatchJournal.Outcome.COMPLETED);
    }
    private JsonObject read(Path p)throws Exception{return JsonParser.parseString(Files.readString(p)).getAsJsonObject();}
    private void rewriteEvent(Path file,java.util.function.Consumer<JsonObject> change)throws Exception{
        var envelope=read(file);var value=envelope.getAsJsonObject("value");change.accept(value);envelope.addProperty("sha256",SelectionBaseline.hash(value));Files.write(file,bytes(envelope));
    }
    private void rehashMember(WorldPatchJournal.Live l,String name,JsonObject replacement)throws Exception{
        var file=l.directory().resolve(name);var data=bytes(replacement);Files.write(file,data);var plan=read(l.directory().resolve("plan.json"));
        for(var row:plan.getAsJsonArray("files")){var member=row.getAsJsonObject();if(member.get("path").getAsString().equals(name)){member.addProperty("bytes",data.length);member.addProperty("sha256",dev.voxelstudio.Asset.sha(data));}}
        plan.remove("planHash");plan.addProperty("planHash",SelectionBaseline.hash(plan));Files.write(l.directory().resolve("plan.json"),bytes(plan));
    }
    @Test void thousandChangesAreTwoFixedOrderedBatchesAndSealedReadOnlyFacts()throws Exception{
        var l=live(true);assertEquals(1000,l.plan().compiled().writes().size());assertFalse(l.plan().canAuthorizePlacement());assertThrows(IOException.class,()->l.intent(1));
        var a=l.intent(512);assertEquals(512,a.writes().size());assertEquals(0,a.offset());l.applied(a,a.writes(),WorldPatchJournal.ReceiptState.COMPLETE);
        var b=l.intent(512);assertEquals(488,b.writes().size());assertEquals(512,b.offset());l.applied(b,b.writes(),WorldPatchJournal.ReceiptState.COMPLETE);assertThrows(IOException.class,()->l.intent(512));l.finish(WorldPatchJournal.Outcome.COMPLETED);
        var review=WorldPatchJournal.inspect(l.directory());assertFalse(review.needsReview(),review.issue());assertEquals(1000,review.confirmed().size());assertEquals(2,review.intentBatches());assertEquals(WorldPatchJournal.Outcome.COMPLETED,review.outcome());assertFalse(review.canAuthorizePlacement());assertFalse(review.worldDurabilityVerified());assertThrows(UnsupportedOperationException.class,()->review.confirmed().clear());assertThrows(IOException.class,()->l.intent(512));
    }
    @Test void cancellationSealsOnlyKnownPrefixAndCannotContinue()throws Exception{
        var l=live(false);var i=l.intent(512);l.applied(i,i.writes().subList(0,1),WorldPatchJournal.ReceiptState.CANCELLED);assertThrows(IOException.class,()->l.intent(512));assertThrows(IOException.class,()->l.finish(WorldPatchJournal.Outcome.COMPLETED));l.finish(WorldPatchJournal.Outcome.CANCELLED);
        var review=WorldPatchJournal.inspect(l.directory());assertFalse(review.needsReview(),review.issue());assertEquals(1,review.confirmed().size());assertEquals(WorldPatchJournal.Outcome.CANCELLED,review.outcome());
    }
    @Test void conflictCanSealAnEmptyPrefixWithoutGuessingAnyWrite()throws Exception{
        var l=live(false);var i=l.intent(512);l.applied(i,List.of(),WorldPatchJournal.ReceiptState.CONFLICT);l.finish(WorldPatchJournal.Outcome.CONFLICT);var r=WorldPatchJournal.inspect(l.directory());assertFalse(r.needsReview(),r.issue());assertTrue(r.confirmed().isEmpty());
    }
    @Test void finalCancellationBeforeFirstWriteHasNoIntent()throws Exception{
        var l=live(false);l.finish(WorldPatchJournal.Outcome.CANCELLED);var r=WorldPatchJournal.inspect(l.directory());assertFalse(r.needsReview(),r.issue());assertEquals(0,r.intentBatches());assertTrue(r.confirmed().isEmpty());
    }
    @Test void missingReceiptCannotFinishOrResumeAndRequiresReview()throws Exception{
        var l=live(false);l.intent(512);assertThrows(IOException.class,()->l.intent(512));assertThrows(IOException.class,()->l.finish(WorldPatchJournal.Outcome.CANCELLED));var r=WorldPatchJournal.inspect(l.directory());assertTrue(r.needsReview());assertEquals(1,r.missingReceipts());assertTrue(r.confirmed().isEmpty());assertNull(r.outcome());
    }
    @Test void confirmedBatchesWithoutOutcomeAreNotCalledCompleted()throws Exception{
        var l=live(false);var i=l.intent(512);l.applied(i,i.writes(),WorldPatchJournal.ReceiptState.COMPLETE);var r=WorldPatchJournal.inspect(l.directory());assertTrue(r.needsReview());assertEquals(2,r.confirmed().size());assertNull(r.outcome());
    }
    @Test void exactOriginalTokenAndOrderedPrefixAreRequired()throws Exception{
        var a=live(false);var b=live(false);var i=a.intent(512);var j=b.intent(512);
        assertThrows(IOException.class,()->a.applied(j,j.writes(),WorldPatchJournal.ReceiptState.COMPLETE));assertThrows(IOException.class,()->a.applied(i,List.of(i.writes().get(1)),WorldPatchJournal.ReceiptState.CONFLICT));
        assertThrows(IOException.class,()->a.applied(i,i.writes().subList(0,1),WorldPatchJournal.ReceiptState.COMPLETE));assertThrows(IOException.class,()->a.applied(i,i.writes(),WorldPatchJournal.ReceiptState.CANCELLED));a.applied(i,i.writes(),WorldPatchJournal.ReceiptState.COMPLETE);assertThrows(IOException.class,()->a.applied(i,i.writes(),WorldPatchJournal.ReceiptState.COMPLETE));a.finish(WorldPatchJournal.Outcome.COMPLETED);
    }
    @Test void ambiguityNeverClosesThePendingIntent()throws Exception{
        var l=live(false);var i=l.intent(512);l.ambiguous(i,"Injected uncertain world acknowledgement");assertThrows(IOException.class,()->l.applied(i,i.writes(),WorldPatchJournal.ReceiptState.COMPLETE));assertThrows(IOException.class,()->l.intent(512));var r=WorldPatchJournal.inspect(l.directory());assertTrue(r.needsReview());assertEquals(1,r.missingReceipts());assertNotNull(r.issue());assertTrue(r.confirmed().isEmpty());
    }
    @Test void failedAmbiguityMarkerAlsoPermanentlyStopsDispatch()throws Exception{
        var l=live(false);var i=l.intent(512);Files.writeString(l.directory().resolve("ambiguous.json"),"partial");assertThrows(IOException.class,()->l.ambiguous(i,"uncertain"));assertThrows(IOException.class,()->l.intent(512));assertThrows(IOException.class,()->l.applied(i,i.writes(),WorldPatchJournal.ReceiptState.COMPLETE));assertEquals("partial",Files.readString(l.directory().resolve("ambiguous.json")));assertTrue(WorldPatchJournal.inspect(l.directory()).needsReview());
    }
    @Test void preexistingPartialPublicationIsPreservedAndNotRetried()throws Exception{
        var l=live(false);var file=l.directory().resolve("000001.intent.json");Files.writeString(file,"partial");assertThrows(IOException.class,()->l.intent(512));assertThrows(IOException.class,()->l.intent(512));assertEquals("partial",Files.readString(file));assertTrue(WorldPatchJournal.inspect(l.directory()).needsReview());
    }
    @Test void receiptPublicationFailureKeepsOriginalIntentUnresolved()throws Exception{
        var l=live(false);var i=l.intent(512);var file=l.directory().resolve("000001.applied.json");Files.writeString(file,"partial");assertThrows(IOException.class,()->l.applied(i,i.writes(),WorldPatchJournal.ReceiptState.COMPLETE));assertThrows(IOException.class,()->l.finish(WorldPatchJournal.Outcome.CANCELLED));assertEquals("partial",Files.readString(file));assertTrue(WorldPatchJournal.inspect(l.directory()).needsReview());
    }
    @Test void nativePreparedSourcesAndResponseBytesAreImmutable()throws Exception{
        var f=fixture(false);var p=plan(f);var original=f.response.clone();Arrays.fill(f.response,(byte)'!');f.compiled.json().getAsJsonArray("writes").remove(0);var l=WorldPatchJournal.create(temp,p);assertArrayEquals(original,Files.readAllBytes(l.directory().resolve("response.json")));complete(l);assertFalse(WorldPatchJournal.inspect(l.directory()).needsReview());assertThrows(IOException.class,()->WorldPatchJournal.create(temp,p));
    }
    @Test void noncanonicalCaptureIdentityIsRejectedBeforePublishing()throws Exception{
        var f=fixture(false);for(String id:List.of("not-a-uuid",UUID.randomUUID().toString().toUpperCase(Locale.ROOT),"1-1-1-1-1")){var c=new SelectionReadService.Capture(id,f.capture.selection(),f.capture.contextRevision(),f.capture.payload(),null,false);assertThrows(RuntimeException.class,()->WorldPatchJournal.prepare(c,f.compiled,f.preview,f.response,UUID.randomUUID()));}
    }
    @Test void changedOrRehashedSourceDoesNotBecomeALiveOriginal()throws Exception{
        var l=live(false);var source=read(l.directory().resolve("source.json"));source.getAsJsonObject("capture").getAsJsonObject("fence").addProperty("start",10);source.getAsJsonObject("capture").getAsJsonObject("fence").addProperty("end",10);rehashMember(l,"source.json",source);assertThrows(IOException.class,()->l.intent(512));assertTrue(WorldPatchJournal.inspect(l.directory()).needsReview());
    }
    @Test void rehashedDownloadedPatchCannotSubstituteNativeWrites()throws Exception{
        var l=live(false);var patch=read(l.directory().resolve("patch.json"));patch.getAsJsonArray("writes").get(0).getAsJsonObject().addProperty("after","minecraft:gold_block");patch.remove("patchHash");patch.addProperty("patchHash",SelectionBaseline.hash(patch));rehashMember(l,"patch.json",patch);assertTrue(WorldPatchJournal.inspect(l.directory()).needsReview());assertThrows(IOException.class,()->l.intent(512));
    }
    @Test void substitutedResponseCannotBeRehashedIntoTheOriginalProposal()throws Exception{
        var l=live(false);var response=read(l.directory().resolve("response.json"));response.getAsJsonArray("operations").get(0).getAsJsonObject().addProperty("before","minecraft:air");rehashMember(l,"response.json",response);assertTrue(WorldPatchJournal.inspect(l.directory()).needsReview());
    }
    @Test void rehashedIntentReorderingIsRejectedBeforeRecordingReceipts()throws Exception{
        var l=live(false);var i=l.intent(512);rewriteEvent(l.directory().resolve("000001.intent.json"),v->{var a=v.getAsJsonArray("writes");var first=a.get(0);a.set(0,a.get(1));a.set(1,first);});assertThrows(IOException.class,()->l.applied(i,i.writes(),WorldPatchJournal.ReceiptState.COMPLETE));assertTrue(WorldPatchJournal.inspect(l.directory()).needsReview());
    }
    @Test void rehashedReceiptOffsetAndOutcomeDoNotOverrideOriginalOrder()throws Exception{
        for(int kind=0;kind<3;kind++){var l=live(false);complete(l);final int k=kind;var file=l.directory().resolve(kind==2?"outcome.json":"000001.applied.json");rewriteEvent(file,v->{if(k==0)v.addProperty("offset",1);if(k==1)v.getAsJsonArray("writes").get(0).getAsJsonObject().addProperty("after","minecraft:gold_block");if(k==2)v.addProperty("confirmedWrites",1);});assertTrue(WorldPatchJournal.inspect(l.directory()).needsReview());}
    }
    @Test void orphanReceiptUnknownMemberAndGappedIntentArePreserved()throws Exception{
        for(String extra:List.of("000001.applied.json","000002.intent.json","unknown.tmp")){var l=live(false);Files.writeString(l.directory().resolve(extra),"{}");assertTrue(WorldPatchJournal.inspect(l.directory()).needsReview());assertTrue(Files.exists(l.directory().resolve(extra)));}
    }
    @Test void authorityFlagsCannotBeRehashedIntoAcceptedAuditFacts()throws Exception{
        for(String flag:List.of("canAuthorizePlacement","serverBaselineVerified","worldDurabilityVerified","crashAtomicPublication")){var l=live(false);var value=read(l.directory().resolve("plan.json"));value.addProperty(flag,true);value.remove("planHash");value.addProperty("planHash",SelectionBaseline.hash(value));Files.write(l.directory().resolve("plan.json"),bytes(value));var r=WorldPatchJournal.inspect(l.directory());assertTrue(r.needsReview());assertFalse(r.canAuthorizePlacement());assertFalse(r.worldDurabilityVerified());}
    }
    @Test void hardLinksAreRejectedByActualWindowsFileHandle()throws Exception{
        var l=live(false);var alias=temp.resolve("source-hardlink.json");Files.createLink(alias,l.directory().resolve("source.json"));assertThrows(IOException.class,()->WorldPatchJournalFiles.read(l.directory().resolve("source.json"),SelectionLimits.snapshotBytes()));assertThrows(IOException.class,()->l.intent(512));assertTrue(WorldPatchJournal.inspect(l.directory()).needsReview());assertTrue(Files.exists(alias));
    }
    @Test void pathRedirectsCannotBecomeJournalRootsOrMembers()throws Exception{
        var actual=Files.createDirectory(temp.resolve("actual"));var junction=temp.resolve("redirected");
        if(System.getProperty("os.name").startsWith("Windows")){
            var result=new ProcessBuilder("cmd.exe","/d","/c","mklink","/J",junction.toString(),actual.toString()).redirectErrorStream(true).start();var output=new String(result.getInputStream().readAllBytes(),StandardCharsets.UTF_8);assertEquals(0,result.waitFor(),output);
        }else Files.createSymbolicLink(junction,actual);
        try{assertThrows(IOException.class,()->WorldPatchJournalFiles.directory(junction));assertThrows(IOException.class,()->WorldPatchJournal.create(junction,plan(fixture(false))));}
        finally{Files.delete(junction);}assertTrue(Files.isDirectory(actual));
    }
    @Test void emptyOversizedNonFileAndNonAbsolutePathsFailClosed()throws Exception{
        var empty=temp.resolve("empty.json");Files.write(empty,new byte[0]);assertThrows(IOException.class,()->WorldPatchJournalFiles.read(empty,16));var huge=temp.resolve("huge.json");Files.writeString(huge,"12345");assertThrows(IOException.class,()->WorldPatchJournalFiles.read(huge,4));assertThrows(IOException.class,()->WorldPatchJournalFiles.read(temp,16));assertThrows(IOException.class,()->WorldPatchJournalFiles.directory(Path.of("relative")));assertThrows(IOException.class,()->WorldPatchJournalFiles.publish(temp.resolve("over.json"),new byte[2],1));assertFalse(Files.exists(temp.resolve("over.json")));
    }
    @Test void concurrentWindowsWriterIsNotSharedOrSilentlyRead()throws Exception{
        var file=temp.resolve("writer.json");Files.writeString(file,"safe");
        if(System.getProperty("os.name").startsWith("Windows")){
            var handle=Kernel32.INSTANCE.CreateFile(file.toString(),WinNT.GENERIC_WRITE,WinNT.FILE_SHARE_READ|WinNT.FILE_SHARE_WRITE,null,WinNT.OPEN_EXISTING,0,null);assertNotEquals(WinBase.INVALID_HANDLE_VALUE,handle);
            try{assertThrows(IOException.class,()->WorldPatchJournalFiles.read(file,16));}finally{assertTrue(Kernel32.INSTANCE.CloseHandle(handle));}
        }else assertArrayEquals("safe".getBytes(StandardCharsets.UTF_8),WorldPatchJournalFiles.read(file,16));
        assertArrayEquals("safe".getBytes(StandardCharsets.UTF_8),WorldPatchJournalFiles.read(file,16));
    }
    private static final class Clock implements java.util.function.LongSupplier {
        long time;public long getAsLong(){return time+=10;}
    }
    private static final class Queue implements java.util.concurrent.Executor {
        final ArrayDeque<Runnable> waiting=new ArrayDeque<>();boolean worker;
        public void execute(Runnable task){waiting.add(task);}
        void pump(){while(!waiting.isEmpty()){worker=true;try{waiting.remove().run();}finally{worker=false;}}}
    }
    private static final class Memory implements WorldPatchExecution.Source {
        final WorldPatchJournal.Plan plan;final Queue queue;final Clock clock;
        final Map<SelectionRegion.Point,SelectionScan.BlockFact> changed=new HashMap<>();final Map<String,Object> chunks=new HashMap<>();
        long revision;int sets,reads;boolean host=true,unloaded,replaced,deny,throwAfter,silent,extraChange;String dimension;
        Memory(WorldPatchJournal.Plan p,Queue q,Clock c){plan=p;queue=q;clock=c;revision=p.binding().contextRevision();dimension=p.binding().selection().world().dimension();}
        private void server(){assertFalse(queue.worker,"World access on disk worker");}
        public void beginStep(){server();}
        public WorldPatchExecution.Frame frame(){server();var s=plan.binding().selection();return new WorldPatchExecution.Frame(s.world().worldId(),dimension,s.revision(),revision,host);}
        public Object loadedChunk(int x,int z){server();if(unloaded)return null;return replaced?new Object():chunks.computeIfAbsent(x+","+z,k->new Object());}
        public SelectionScan.BlockFact read(SelectionRegion.Point p){server();reads++;return changed.getOrDefault(p,plan.compiled().baseline().at(p));}
        public boolean set(WorldPatchCompiler.Write write){
            server();sets++;assertTrue(plan.binding().selection().edit().contains(write.position()));assertFalse(plan.binding().selection().protectedAt(write.position()));
            assertEquals(write.before(),read(write.position()).state(),"Fake source cannot silently skip BEFORE");if(deny)return false;
            changed.put(write.position(),new SelectionScan.BlockFact(write.after(),false));revision++;if(extraChange)revision++;if(throwAfter)throw new IllegalStateException("after-mutation-exception");return !silent;
        }
    }
    private record Running(WorldPatchJournal.Live live,Queue queue,Clock clock,Memory memory,WorldPatchExecution engine){}
    private Running running(boolean large,int max)throws Exception{
        var l=live(large);var q=new Queue();var c=new Clock();var m=new Memory(l.plan(),q,c);return new Running(l,q,c,m,new WorldPatchExecution(new WorldPatchExecution.Disk(l,q),m,max,2_000_000,c));
    }
    private boolean terminal(WorldPatchExecution.State s){return Set.of(WorldPatchExecution.State.COMPLETED,WorldPatchExecution.State.CANCELLED,WorldPatchExecution.State.CONFLICT,WorldPatchExecution.State.REVIEW_REQUIRED).contains(s);}
    private void run(Running r){for(int i=0;i<3000&&!terminal(r.engine.progress().state());i++){r.engine.step();r.queue.pump();}assertTrue(terminal(r.engine.progress().state()),r.engine.progress().toString());}
    private void startApplying(Running r){r.engine.step();assertEquals(WorldPatchExecution.State.WAIT_INTENT,r.engine.progress().state());assertEquals(0,r.memory.sets);r.queue.pump();r.engine.step();assertEquals(WorldPatchExecution.State.APPLYING,r.engine.progress().state());assertEquals(0,r.memory.sets);}
    @Test void boundedEngineCompletesBothBatchesWithoutTickDiskIoOrSkipping()throws Exception{
        var r=running(true,16);run(r);assertEquals(WorldPatchExecution.State.COMPLETED,r.engine.progress().state());assertEquals(1000,r.memory.sets);assertEquals(1000,r.engine.confirmedPrefix().size());assertTrue(r.engine.progress().steps()>=63);assertEquals(16,r.engine.progress().maximumWritesPerStep());assertFalse(r.engine.progress().canAuthorizePlacement());assertFalse(r.engine.progress().worldDurabilityVerified());
        var log=WorldPatchJournal.inspect(r.live.directory());assertFalse(log.needsReview(),log.issue());assertEquals(r.engine.confirmedPrefix(),log.confirmed());
    }
    @Test void cancelledWhileIntentIsPendingWaitsThenRecordsZeroWrites()throws Exception{
        var r=running(false,1);r.engine.step();r.engine.cancel();r.engine.step();assertEquals(0,r.memory.sets);assertEquals(WorldPatchExecution.State.WAIT_INTENT,r.engine.progress().state());r.queue.pump();run(r);assertEquals(WorldPatchExecution.State.CANCELLED,r.engine.progress().state());assertEquals(0,r.memory.sets);var log=WorldPatchJournal.inspect(r.live.directory());assertFalse(log.needsReview(),log.issue());assertEquals(1,log.intentBatches());assertTrue(log.confirmed().isEmpty());
    }
    @Test void playerEditBetweenTicksIsPreservedAndStopsTheNextWrite()throws Exception{
        var r=running(true,1);startApplying(r);r.engine.step();assertEquals(1,r.memory.sets);var next=r.live.plan().compiled().writes().get(1).position();r.memory.changed.put(next,new SelectionScan.BlockFact("minecraft:gold_block",false));r.memory.revision++;run(r);
        assertEquals(WorldPatchExecution.State.CONFLICT,r.engine.progress().state());assertEquals(1,r.memory.sets);assertEquals("minecraft:gold_block",r.memory.read(next).state());var log=WorldPatchJournal.inspect(r.live.directory());assertFalse(log.needsReview(),log.issue());assertEquals(1,log.confirmed().size());
    }
    @Test void changedNeighborWithoutRevisionNotificationIsStillRejected()throws Exception{
        var r=running(false,1);startApplying(r);var p=r.live.plan().compiled().writes().get(0).position();var neighbor=new SelectionRegion.Point(p.x(),p.y()-1,p.z());r.memory.changed.put(neighbor,new SelectionScan.BlockFact("minecraft:gold_block",false));run(r);assertEquals(WorldPatchExecution.State.CONFLICT,r.engine.progress().state());assertEquals(0,r.memory.sets);
    }
    @Test void dimensionPermissionAndUnloadedChunkFailBeforeMutating()throws Exception{
        for(int kind=0;kind<3;kind++){var r=running(false,1);startApplying(r);if(kind==0)r.memory.dimension="minecraft:the_nether";if(kind==1)r.memory.host=false;if(kind==2)r.memory.unloaded=true;run(r);assertEquals(WorldPatchExecution.State.CONFLICT,r.engine.progress().state());assertEquals(0,r.memory.sets);assertFalse(WorldPatchJournal.inspect(r.live.directory()).needsReview());}
    }
    @Test void reloadedChunkCannotAdoptReplacementIdentityEvenWithEqualStates()throws Exception{
        var r=running(true,1);startApplying(r);r.engine.step();r.memory.replaced=true;run(r);assertEquals(WorldPatchExecution.State.CONFLICT,r.engine.progress().state());assertEquals(1,r.memory.sets);
    }
    @Test void definiteSetDenialClosesConflictButUncertainEffectsNeverClosePrefix()throws Exception{
        var denied=running(false,1);denied.memory.deny=true;run(denied);assertEquals(WorldPatchExecution.State.CONFLICT,denied.engine.progress().state());assertTrue(WorldPatchJournal.inspect(denied.live.directory()).confirmed().isEmpty());assertFalse(WorldPatchJournal.inspect(denied.live.directory()).needsReview());
        for(int kind=0;kind<3;kind++){var r=running(false,1);if(kind==0)r.memory.throwAfter=true;if(kind==1)r.memory.silent=true;if(kind==2)r.memory.extraChange=true;run(r);assertEquals(WorldPatchExecution.State.REVIEW_REQUIRED,r.engine.progress().state());assertEquals(1,r.memory.sets);var log=WorldPatchJournal.inspect(r.live.directory());assertTrue(log.needsReview());assertEquals(1,log.missingReceipts());assertTrue(log.confirmed().isEmpty());assertEquals("minecraft:glass",r.memory.read(r.live.plan().compiled().writes().get(0).position()).state());}
    }
    @Test void failedReceiptDoesNotDispatchAnotherBatchOrPretendCompletion()throws Exception{
        var r=running(true,128);startApplying(r);while(r.engine.progress().state()==WorldPatchExecution.State.APPLYING)r.engine.step();assertEquals(512,r.memory.sets);assertEquals(WorldPatchExecution.State.WAIT_RECEIPT,r.engine.progress().state());Files.writeString(r.live.directory().resolve("000001.applied.json"),"partial");r.queue.pump();run(r);assertEquals(WorldPatchExecution.State.REVIEW_REQUIRED,r.engine.progress().state());assertEquals(512,r.memory.sets);assertFalse(Files.exists(r.live.directory().resolve("000002.intent.json")));assertTrue(WorldPatchJournal.inspect(r.live.directory()).needsReview());
    }
    @Test void lostDiskAcknowledgementTimesOutWithoutRetryingItsOriginalWork()throws Exception{
        var r=running(false,1);r.engine.step();assertEquals(1,r.queue.waiting.size());r.clock.time+=WorldPatchExecution.WAIT_TIMEOUT_NANOS;r.engine.step();assertEquals(WorldPatchExecution.State.REVIEW_REQUIRED,r.engine.progress().state());assertEquals(0,r.memory.sets);assertEquals(1,r.queue.waiting.size());r.queue.pump();r.engine.step();assertEquals(0,r.memory.sets);var log=WorldPatchJournal.inspect(r.live.directory());assertEquals(1,log.missingReceipts());assertTrue(log.needsReview());
    }
    @Test void saturatedDiskWorkerDoesNotGrantAnyWorldDispatch()throws Exception{
        var l=live(false);var q=new Queue();var c=new Clock();var m=new Memory(l.plan(),q,c);var disk=new WorldPatchExecution.Disk(l,task->{throw new RejectedExecutionException("full");});var engine=new WorldPatchExecution(disk,m,1,2_000_000,c);engine.step();engine.step();assertEquals(WorldPatchExecution.State.REVIEW_REQUIRED,engine.progress().state());assertEquals(0,m.sets);assertFalse(Files.exists(l.directory().resolve("000001.intent.json")));
    }
    @Test void diskOwnerSubstitutionIsRejectedBeforeWorldDispatch()throws Exception{
        var r=running(false,1);var other=live(false);var foreign=other.intent(512);var log=new WorldPatchExecution.Log(){
            public WorldPatchJournal.Plan plan(){return r.live.plan();}public CompletableFuture<WorldPatchJournal.Intent> intent(){return CompletableFuture.completedFuture(foreign);}
            public CompletableFuture<Void> applied(WorldPatchJournal.Intent i,List<WorldPatchCompiler.Write> p,WorldPatchJournal.ReceiptState s){fail("No substituted receipt");return null;}
            public CompletableFuture<Void> finish(WorldPatchJournal.Outcome o){fail("No substituted finish");return null;}
            public CompletableFuture<Void> ambiguous(WorldPatchJournal.Intent i,String reason){fail("No substituted ambiguity");return null;}
        };var e=new WorldPatchExecution(log,r.memory,1,2_000_000,r.clock);e.step();e.step();assertEquals(WorldPatchExecution.State.REVIEW_REQUIRED,e.progress().state());assertEquals(0,r.memory.sets);
    }
    private record Undoing(Running apply,WorldPatchUndoJournal.Live live,WorldPatchUndoExecution engine){}
    private Undoing undo(Running r)throws Exception{var l=WorldPatchUndoJournal.create(temp,r.engine.undoOrigin());return new Undoing(r,l,new WorldPatchUndoExecution(new WorldPatchUndoExecution.Disk(l,r.queue),r.memory,16,2_000_000,r.clock));}
    private void runUndo(Undoing r){for(int i=0;i<3000&&!Set.of(WorldPatchUndoExecution.State.COMPLETED,WorldPatchUndoExecution.State.CANCELLED,WorldPatchUndoExecution.State.CONFLICT,WorldPatchUndoExecution.State.REVIEW_REQUIRED).contains(r.engine.progress().state());i++){r.engine.step();r.apply.queue.pump();}assertTrue(Set.of(WorldPatchUndoExecution.State.COMPLETED,WorldPatchUndoExecution.State.CANCELLED,WorldPatchUndoExecution.State.CONFLICT,WorldPatchUndoExecution.State.REVIEW_REQUIRED).contains(r.engine.progress().state()),r.engine.progress().toString());}
    private void startUndo(Undoing r){r.engine.step();assertEquals(WorldPatchUndoExecution.State.WAIT_INTENT,r.engine.progress().state());r.apply.queue.pump();r.engine.step();assertEquals(WorldPatchUndoExecution.State.APPLYING,r.engine.progress().state());}
    @Test void protectedUndoRestoresAllThousandOriginalStatesInReverseOrder()throws Exception{
        var r=running(true,16);run(r);var undo=undo(r);assertFalse(undo.live.plan().canAuthorizePlacement());assertEquals(r.live.plan().compiled().writes().get(999).position(),undo.live.plan().writes().get(0).position());runUndo(undo);assertEquals(WorldPatchUndoExecution.State.COMPLETED,undo.engine.progress().state());assertEquals(1000,undo.engine.progress().restored());assertEquals(0,undo.engine.progress().preserved());assertEquals(16,undo.engine.progress().maximumEntriesPerStep());
        var report=WorldPatchUndoJournal.inspect(undo.live.directory());assertFalse(report.needsReview(),report.issue());assertEquals(1000,report.evaluated().size());assertFalse(report.canAuthorizePlacement());assertFalse(report.worldDurabilityVerified());for(var w:r.live.plan().compiled().writes())assertEquals(w.before(),r.memory.read(w.position()).state());assertThrows(IllegalStateException.class,()->undo(r));assertFalse(r.engine.undoOrigin().canAuthorizePlacement());
    }
    @Test void undoPreservesLaterPlayerTargetAndUnsafeNeighborsButRestoresOthers()throws Exception{
        var r=running(true,16);run(r);var edited=r.live.plan().compiled().writes().get(0).position();r.memory.changed.put(edited,new SelectionScan.BlockFact("minecraft:gold_block",false));r.memory.revision++;var undo=undo(r);runUndo(undo);assertEquals(WorldPatchUndoExecution.State.COMPLETED,undo.engine.progress().state());assertEquals("minecraft:gold_block",r.memory.read(edited).state());assertTrue(undo.engine.progress().restored()>900);assertTrue(undo.engine.progress().preserved()>0);
        var report=WorldPatchUndoJournal.inspect(undo.live.directory());assertFalse(report.needsReview(),report.issue());assertTrue(report.evaluated().stream().anyMatch(e->e.write().position().equals(edited)&&e.disposition()==WorldPatchUndoJournal.Disposition.PRESERVED_TARGET));assertEquals(undo.engine.progress().restored(),report.evaluated().stream().filter(e->e.disposition()==WorldPatchUndoJournal.Disposition.RESTORED).count());
    }
    @Test void undoProtectsLaterExternalNeighborWithoutWritingOutsideTheOriginalSelection()throws Exception{
        var r=running(true,16);run(r);var neighbor=new SelectionRegion.Point(-6,-5,-5);r.memory.changed.put(neighbor,new SelectionScan.BlockFact("minecraft:gold_block",false));r.memory.revision++;var undo=undo(r);runUndo(undo);assertEquals(WorldPatchUndoExecution.State.COMPLETED,undo.engine.progress().state());assertEquals("minecraft:gold_block",r.memory.read(neighbor).state());assertEquals(1,undo.engine.progress().preserved());assertEquals(999,undo.engine.progress().restored());assertFalse(WorldPatchUndoJournal.inspect(undo.live.directory()).needsReview());
    }
    @Test void partialApplyUndoIncludesOnlyTheOriginalConfirmedPrefix()throws Exception{
        var r=running(false,1);startApplying(r);r.engine.step();r.engine.cancel();run(r);assertEquals(WorldPatchExecution.State.CANCELLED,r.engine.progress().state());assertEquals(1,r.engine.confirmedPrefix().size());var undo=undo(r);runUndo(undo);assertEquals(WorldPatchUndoExecution.State.COMPLETED,undo.engine.progress().state());assertEquals(1,undo.engine.progress().restored());assertEquals("minecraft:stone",r.memory.read(new SelectionRegion.Point(1,0,0)).state());assertEquals("minecraft:stone",r.memory.read(new SelectionRegion.Point(0,0,0)).state());
    }
    @Test void uncertainOrUnsealedApplyCannotMintUndoOrigin()throws Exception{
        var pending=running(false,1);startApplying(pending);assertThrows(IllegalStateException.class,pending.engine::undoOrigin);var uncertain=running(false,1);uncertain.memory.throwAfter=true;run(uncertain);assertThrows(IllegalStateException.class,uncertain.engine::undoOrigin);assertFalse(WorldPatchJournal.inspect(uncertain.live.directory()).canAuthorizePlacement());
    }
    @Test void originalArchiveChangeRejectsUndoAndConsumesTheAttemptWithoutReplacement()throws Exception{
        var r=running(false,1);run(r);var origin=r.engine.undoOrigin();Files.writeString(r.live.directory().resolve("response.json"),"changed");assertThrows(IOException.class,()->WorldPatchUndoJournal.create(temp,origin));assertThrows(IllegalStateException.class,()->WorldPatchUndoJournal.create(temp,origin));assertEquals(2,r.memory.sets);
    }
    @Test void cancelledUndoWhileIntentPendingPreservesAllAndSealsKnownZeroPrefix()throws Exception{
        var r=running(false,1);run(r);var undo=undo(r);undo.engine.step();undo.engine.cancel();assertEquals(2,r.memory.sets);runUndo(undo);assertEquals(WorldPatchUndoExecution.State.CANCELLED,undo.engine.progress().state());assertEquals(0,undo.engine.progress().evaluated());var report=WorldPatchUndoJournal.inspect(undo.live.directory());assertFalse(report.needsReview(),report.issue());assertTrue(report.evaluated().isEmpty());
    }
    @Test void playerChangeAfterUndoConfirmationStopsWithoutOverwritingIt()throws Exception{
        var r=running(true,16);run(r);var undo=undo(r);startUndo(undo);undo.engine.step();assertEquals(16,undo.engine.progress().restored());var p=undo.live.plan().writes().get(16).position();r.memory.changed.put(p,new SelectionScan.BlockFact("minecraft:gold_block",false));r.memory.revision++;runUndo(undo);assertEquals(WorldPatchUndoExecution.State.CONFLICT,undo.engine.progress().state());assertEquals(16,undo.engine.progress().restored());assertEquals("minecraft:gold_block",r.memory.read(p).state());assertFalse(WorldPatchUndoJournal.inspect(undo.live.directory()).needsReview());
    }
    @Test void undoPostMutationExceptionRemainsUnresolvedAndCannotReplay()throws Exception{
        var r=running(false,1);run(r);var undo=undo(r);r.memory.throwAfter=true;runUndo(undo);assertEquals(WorldPatchUndoExecution.State.REVIEW_REQUIRED,undo.engine.progress().state());var report=WorldPatchUndoJournal.inspect(undo.live.directory());assertTrue(report.needsReview());assertEquals(1,report.missingReceipts());assertTrue(report.evaluated().isEmpty());assertThrows(IllegalStateException.class,()->undo(r));
    }
    @Test void missingUndoAcknowledgementTimesOutWithoutRepeatingTheIntent()throws Exception{
        var r=running(false,1);run(r);var undo=undo(r);undo.engine.step();r.clock.time+=WorldPatchExecution.WAIT_TIMEOUT_NANOS;undo.engine.step();assertEquals(WorldPatchUndoExecution.State.REVIEW_REQUIRED,undo.engine.progress().state());assertEquals(1,r.queue.waiting.size());r.queue.pump();assertEquals(2,r.memory.sets);assertEquals(1,WorldPatchUndoJournal.inspect(undo.live.directory()).missingReceipts());
    }
    @Test void mismatchedUndoOwnerAndNonPrefixReceiptsAreRejected()throws Exception{
        var a=running(false,1);run(a);var b=running(false,1);run(b);var u=undo(a);var v=undo(b);var i=u.live.intent();var j=v.live.intent();var rows=i.writes().stream().map(w->new WorldPatchUndoJournal.Entry(w,WorldPatchUndoJournal.Disposition.RESTORED)).toList();assertThrows(IOException.class,()->u.live.evaluated(j,rows,WorldPatchJournal.ReceiptState.COMPLETE));assertThrows(IOException.class,()->u.live.evaluated(i,List.of(rows.get(1)),WorldPatchJournal.ReceiptState.CONFLICT));assertThrows(IOException.class,()->u.live.evaluated(i,rows.subList(0,1),WorldPatchJournal.ReceiptState.COMPLETE));u.live.evaluated(i,rows,WorldPatchJournal.ReceiptState.COMPLETE);u.live.finish(WorldPatchJournal.Outcome.COMPLETED);assertFalse(WorldPatchUndoJournal.inspect(u.live.directory()).needsReview());
    }
    @Test void undoRehashedReceiptAndOutcomeCannotFakeRestoredCountsOrCoordinates()throws Exception{
        for(int kind=0;kind<3;kind++){var r=running(false,1);run(r);var u=undo(r);runUndo(u);final int k=kind;rewriteEvent(u.live.directory().resolve(kind==2?"outcome.json":"000001.evaluated.json"),v->{if(k==0)v.getAsJsonArray("entries").get(0).getAsJsonObject().getAsJsonObject("write").addProperty("after","minecraft:gold_block");if(k==1)v.getAsJsonArray("entries").get(0).getAsJsonObject().addProperty("disposition","FORCED");if(k==2)v.addProperty("restored",0);});assertTrue(WorldPatchUndoJournal.inspect(u.live.directory()).needsReview());}
    }
    @Test void undoPartialPublicationIsPreservedAndStopsWorldDispatch()throws Exception{
        var r=running(false,1);run(r);var u=undo(r);Files.writeString(u.live.directory().resolve("000001.intent.json"),"partial");runUndo(u);assertEquals(WorldPatchUndoExecution.State.REVIEW_REQUIRED,u.engine.progress().state());assertEquals(2,r.memory.sets);assertEquals("partial",Files.readString(u.live.directory().resolve("000001.intent.json")));assertTrue(WorldPatchUndoJournal.inspect(u.live.directory()).needsReview());
    }
    @Test void undoMissingParentAndHardLinkedOwnPlanNeverBecomeRecoveryAuthority()throws Exception{
        var r=running(false,1);run(r);var u=undo(r);var alias=temp.resolve("undo-plan-hardlink.json");Files.createLink(alias,u.live.directory().resolve("plan.json"));runUndo(u);assertEquals(WorldPatchUndoExecution.State.REVIEW_REQUIRED,u.engine.progress().state());assertEquals(2,r.memory.sets);var review=WorldPatchUndoJournal.inspect(u.live.directory());assertTrue(review.needsReview());assertFalse(review.canAuthorizePlacement());assertFalse(review.worldDurabilityVerified());
        var s=running(false,1);run(s);var other=undo(s);Files.move(s.live.directory(),temp.resolve("moved-original-test-archive"));assertTrue(WorldPatchUndoJournal.inspect(other.live.directory()).needsReview());assertThrows(IOException.class,other.live::intent);
    }
    @Test void changedPriorApplyReceiptIsDetectedBeforeAnotherBatchEvenAfterRehashing()throws Exception{
        var r=running(true,128);startApplying(r);while(r.engine.progress().state()==WorldPatchExecution.State.APPLYING)r.engine.step();r.queue.pump();r.engine.step();assertEquals(WorldPatchExecution.State.READY,r.engine.progress().state());assertEquals(512,r.memory.sets);rewriteEvent(r.live.directory().resolve("000001.applied.json"),v->v.getAsJsonArray("writes").get(0).getAsJsonObject().addProperty("after","minecraft:gold_block"));run(r);assertEquals(WorldPatchExecution.State.REVIEW_REQUIRED,r.engine.progress().state());assertEquals(512,r.memory.sets);assertFalse(Files.exists(r.live.directory().resolve("000002.intent.json")));
    }
    @Test void changedPriorUndoReceiptIsDetectedBeforeAnotherBatchEvenAfterRehashing()throws Exception{
        var r=running(true,128);run(r);var u=undo(r);startUndo(u);while(u.engine.progress().state()==WorldPatchUndoExecution.State.APPLYING)u.engine.step();r.queue.pump();u.engine.step();assertEquals(WorldPatchUndoExecution.State.READY,u.engine.progress().state());assertEquals(512,u.engine.progress().restored());rewriteEvent(u.live.directory().resolve("000001.evaluated.json"),v->v.getAsJsonArray("entries").get(0).getAsJsonObject().addProperty("disposition","PRESERVED_TARGET"));runUndo(u);assertEquals(WorldPatchUndoExecution.State.REVIEW_REQUIRED,u.engine.progress().state());assertEquals(512,u.engine.progress().restored());assertFalse(Files.exists(u.live.directory().resolve("000002.intent.json")));
    }
    @Test void unexpectedApplyMemberStopsBeforeCreatingAnyWorldWriteIntent()throws Exception{
        var r=running(false,1);Files.writeString(r.live.directory().resolve("unknown.tmp"),"injected");run(r);assertEquals(WorldPatchExecution.State.REVIEW_REQUIRED,r.engine.progress().state());assertEquals(0,r.memory.sets);assertFalse(Files.exists(r.live.directory().resolve("000001.intent.json")));
    }
}
