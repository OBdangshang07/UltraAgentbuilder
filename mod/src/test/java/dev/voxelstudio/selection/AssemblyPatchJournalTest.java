package dev.voxelstudio.selection;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.IOException;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Only synthetic production artifacts and owned temporary disk fault tests.
 * No game writes, physics, model/image quality or region-file durability. */
final class AssemblyPatchJournalTest {
    @TempDir Path temp;
    private record Fixture(JsonObject header,AssemblyPatchInput input,AssemblyPatchCompiler.Compiled compiled,AssemblyPatchPreview preview,SelectionReadService.Capture capture){}
    private Fixture fixture(String tier)throws Exception{
        var header=AssemblyPatchFixtures.header(tier);var input=AssemblyPatchFixtures.input(header);var baseline=AssemblyPatchFixtures.baseline(header);var compiled=AssemblyPatchCompiler.compile(baseline,input,()->false);
        var binding=input.binding();var capture=new SelectionReadService.Capture(binding.captureId(),binding.selection(),binding.contextRevision(),header.get("payload").getAsString(),null,false);
        return new Fixture(header,input,compiled,AssemblyPatchPreview.from(input),capture);
    }
    private AssemblyPatchJournal.Plan plan(Fixture f){return AssemblyPatchJournal.prepare(f.capture,f.compiled,f.preview,UUID.randomUUID());}
    @Test void wholeReadOnlyPlanCancellationPreservesOriginalInputAndCreatesNoJournal()throws Exception{
        var f=fixture("lite");var payload=f.capture.payload();var proposal=f.input.parts().get(0).proposal();
        var fullChecks=new java.util.concurrent.atomic.AtomicInteger();
        var p=AssemblyPatchJournal.prepare(f.capture,f.compiled,f.preview,UUID.randomUUID(),()->{fullChecks.incrementAndGet();return false;});
        assertTrue(fullChecks.get()>2,"Complete original plan must expose its actual cancellation checkpoints");
        for(int stop:new int[]{1,2,fullChecks.get()/2,fullChecks.get()}){
            var checks=new java.util.concurrent.atomic.AtomicInteger();
            assertThrows(java.util.concurrent.CancellationException.class,()->AssemblyPatchJournal.prepare(f.capture,f.compiled,f.preview,UUID.randomUUID(),()->checks.incrementAndGet()>=stop));
            assertEquals(payload,f.capture.payload());assertArrayEquals(proposal,f.input.parts().get(0).proposal());
            try(var files=Files.list(temp)){assertEquals(0,files.count());}
        }
        assertSame(f.compiled,p.compiled());assertFalse(p.canAuthorizePlacement());
    }
    private AssemblyPatchJournal.Live live()throws Exception{return AssemblyPatchJournal.create(temp,plan(fixture("lite")));}
    private byte[] bytes(JsonElement value){return value.toString().getBytes(StandardCharsets.UTF_8);}
    private JsonObject read(Path file)throws Exception{return JsonParser.parseString(Files.readString(file)).getAsJsonObject();}
    private void complete(AssemblyPatchJournal.Live live)throws Exception{
        for(int offset=0;offset<live.plan().binding().totalWrites();offset+=AssemblyPatchJournal.BATCH){var intent=live.intent(AssemblyPatchJournal.BATCH);assertEquals(offset,intent.offset());live.applied(intent,intent.writes(),AssemblyPatchJournal.ReceiptState.COMPLETE);}
        live.finish(AssemblyPatchJournal.Outcome.COMPLETED);
    }
    private void rewriteEvent(Path file,java.util.function.Consumer<JsonObject> change)throws Exception{
        var envelope=read(file);change.accept(envelope.getAsJsonObject("value"));envelope.addProperty("sha256",SelectionBaseline.hash(envelope.get("value")));Files.write(file,bytes(envelope));
    }
    private void rehashMember(AssemblyPatchJournal.Live live,String name,JsonObject changed)throws Exception{
        var raw=bytes(changed);Files.write(live.directory().resolve(name),raw);var plan=read(live.directory().resolve("plan.json"));
        for(var value:plan.getAsJsonArray("files")){var pin=value.getAsJsonObject();if(pin.get("path").getAsString().equals(name)){pin.addProperty("bytes",raw.length);pin.addProperty("sha256",dev.voxelstudio.Asset.sha(raw));}}
        plan.remove("planHash");plan.addProperty("planHash",SelectionBaseline.hash(plan));Files.write(live.directory().resolve("plan.json"),bytes(plan));
    }
    @Test void complete224MetreSevenPart54406WriteArchiveHasOnePlanAndExactOriginalInventory()throws Exception{
        var f=fixture("ultra");var p=plan(f);var live=AssemblyPatchJournal.create(temp,p);complete(live);var review=AssemblyPatchJournal.inspect(live.directory());
        assertFalse(review.needsReview(),review.issue());assertEquals(AssemblyPatchJournal.Outcome.COMPLETED,review.outcome());assertEquals(f.input.binding(),review.binding());assertEquals(7,review.binding().partHashes().size());assertEquals(54406,review.confirmed().size());assertEquals(107,review.intentBatches());
        assertEquals(f.compiled.writes(),review.confirmed());assertEquals(f.compiled.guards(),review.guards());assertFalse(review.canAuthorizePlacement());assertFalse(review.worldDurabilityVerified());assertFalse(p.canAuthorizePlacement());
        assertArrayEquals(f.capture.payload().getBytes(StandardCharsets.UTF_8),Files.readAllBytes(live.directory().resolve("source.json")));
        for(var part:f.input.parts())for(var kind:List.of("proposal","patch","preview")){
            var original=switch(kind){case "proposal"->part.proposal();case "patch"->part.patch();default->part.previewBytes();};
            assertArrayEquals(original,Files.readAllBytes(live.directory().resolve(String.format(Locale.ROOT,"part-%03d-%s.json",part.index(),kind))));
        }
        var archived=read(live.directory().resolve("plan.json"));assertEquals("AssemblyPatchTransactionPlan",archived.get("format").getAsString());assertEquals(2,archived.get("version").getAsInt());assertEquals(22,archived.getAsJsonArray("files").size());assertEquals(f.input.binding().json(),archived.get("binding"));
        assertThrows(UnsupportedOperationException.class,()->review.confirmed().clear());assertThrows(UnsupportedOperationException.class,()->review.guards().clear());
    }
    @Test void exactPrefixCancellationUsesOneWholePlanAndDoesNotCommitOtherParts()throws Exception{
        var live=live();var first=live.intent(512);live.applied(first,first.writes(),AssemblyPatchJournal.ReceiptState.COMPLETE);var next=live.intent(512);assertEquals(512,next.offset());
        live.applied(next,next.writes().subList(0,3),AssemblyPatchJournal.ReceiptState.CANCELLED);assertThrows(IOException.class,()->live.intent(512));live.finish(AssemblyPatchJournal.Outcome.CANCELLED);
        var review=AssemblyPatchJournal.inspect(live.directory());assertFalse(review.needsReview(),review.issue());assertEquals(515,review.confirmed().size());assertEquals(2,review.intentBatches());assertEquals(AssemblyPatchJournal.Outcome.CANCELLED,review.outcome());
    }
    @Test void foreignTokensReorderedPrefixesAndVariableBatchCannotCreateAcknowledgement()throws Exception{
        var live=live();var other=live();assertThrows(IOException.class,()->live.intent(511));var intent=live.intent(512);var foreign=other.intent(512);
        assertFalse(intent.belongs(other.plan()));assertThrows(IOException.class,()->live.applied(foreign,foreign.writes(),AssemblyPatchJournal.ReceiptState.COMPLETE));
        var swapped=new ArrayList<>(intent.writes());Collections.swap(swapped,0,1);assertThrows(IOException.class,()->live.applied(intent,swapped,AssemblyPatchJournal.ReceiptState.COMPLETE));
        assertThrows(IOException.class,()->live.applied(intent,intent.writes().subList(0,1),AssemblyPatchJournal.ReceiptState.COMPLETE));assertThrows(IOException.class,()->live.finish(AssemblyPatchJournal.Outcome.CANCELLED));
        live.applied(intent,intent.writes(),AssemblyPatchJournal.ReceiptState.COMPLETE);var tail=live.intent(512);live.applied(tail,tail.writes(),AssemblyPatchJournal.ReceiptState.COMPLETE);live.finish(AssemblyPatchJournal.Outcome.COMPLETED);assertFalse(AssemblyPatchJournal.inspect(live.directory()).needsReview());
    }
    @Test void unresolvedAndAmbiguousWholeIntentsNeverBecomeResumeOrUndoOrigins()throws Exception{
        var live=live();var intent=live.intent(512);var unresolved=AssemblyPatchJournal.inspect(live.directory());assertTrue(unresolved.needsReview());assertEquals(1,unresolved.missingReceipts());assertTrue(unresolved.confirmed().isEmpty());
        live.ambiguous(intent,"synthetic acknowledgement loss");assertThrows(IOException.class,()->live.applied(intent,intent.writes(),AssemblyPatchJournal.ReceiptState.COMPLETE));assertThrows(IOException.class,()->live.intent(512));assertTrue(AssemblyPatchJournal.inspect(live.directory()).needsReview());
        for(var c:AssemblyPatchJournal.Live.class.getDeclaredConstructors())assertTrue(Modifier.isPrivate(c.getModifiers()));for(var c:AssemblyPatchJournal.Intent.class.getDeclaredConstructors())assertTrue(Modifier.isPrivate(c.getModifiers()));
    }
    @Test void changedCaptureAndMissingOriginalPreviewCannotBeSynthesizedIntoPlan()throws Exception{
        var f=fixture("lite");var b=f.input.binding();var changed=new SelectionReadService.Capture(UUID.randomUUID().toString(),b.selection(),b.contextRevision(),f.capture.payload(),null,false);
        assertThrows(IllegalArgumentException.class,()->AssemblyPatchJournal.prepare(changed,f.compiled,f.preview,UUID.randomUUID()));
        var part=f.input.parts().get(0);var old=new AssemblyPatchInput(b,List.of(new AssemblyPatchInput.Part(0,part.proposal(),part.patch(),part.preview())));var rebuilt=AssemblyPatchCompiler.compile(f.compiled.baseline(),old,()->false);
        assertThrows(IllegalArgumentException.class,()->AssemblyPatchJournal.prepare(f.capture,rebuilt,AssemblyPatchPreview.from(old),UUID.randomUUID()));
    }
    @Test void inputMutationsDoNotChangeOriginalPlanOrPermitDuplicatePublication()throws Exception{
        var f=fixture("lite");var p=plan(f);var expected=f.input.parts().get(0).previewBytes();f.input.parts().get(0).previewBytes()[0]=0;f.input.parts().get(0).patch()[0]=0;f.input.parts().get(0).proposal()[0]=0;
        var live=AssemblyPatchJournal.create(temp,p);assertArrayEquals(expected,Files.readAllBytes(live.directory().resolve("part-000-preview.json")));complete(live);p.verifyArchive(live.directory());assertThrows(IOException.class,()->AssemblyPatchJournal.create(temp,p));
    }
    @Test void rehashedPatchAndPreviewMutationsAreRejectedByIndependentReconstruction()throws Exception{
        for(boolean preview:new boolean[]{false,true}){
            var live=live();var name=preview?"part-000-preview.json":"part-000-patch.json";var changed=read(live.directory().resolve(name));
            if(preview){changed.getAsJsonObject("summary").addProperty("writes",1);changed.remove("previewHash");changed.addProperty("previewHash",SelectionBaseline.hash(changed));}
            else{changed.getAsJsonArray("writes").get(0).getAsJsonObject().addProperty("after","minecraft:diamond_block");changed.remove("patchHash");changed.addProperty("patchHash",SelectionBaseline.hash(changed));}
            rehashMember(live,name,changed);assertTrue(AssemblyPatchJournal.inspect(live.directory()).needsReview());assertThrows(IOException.class,()->live.intent(512));
        }
    }
    @Test void rehashedReceiptOrderOffsetsOrCompletionCountsCannotReplaceOriginalWhole()throws Exception{
        for(int kind=0;kind<3;kind++){
            var live=live();complete(live);int k=kind;rewriteEvent(live.directory().resolve(kind==2?"outcome.json":"000001.applied.json"),value->{
                if(k==0)value.addProperty("offset",1);if(k==1)value.getAsJsonArray("writes").get(0).getAsJsonObject().addProperty("after","minecraft:diamond_block");if(k==2)value.addProperty("confirmedWrites",1);
            });assertTrue(AssemblyPatchJournal.inspect(live.directory()).needsReview());
        }
    }
    @Test void partialPublicationsUnknownMembersAndOrphanReceiptsArePreserved()throws Exception{
        for(var name:List.of("000001.intent.json","000001.applied.json","unknown.tmp")){
            var live=live();var file=live.directory().resolve(name);Files.writeString(file,"partial");assertThrows(IOException.class,()->live.intent(512));assertThrows(IOException.class,()->live.intent(512));assertEquals("partial",Files.readString(file));assertTrue(AssemblyPatchJournal.inspect(live.directory()).needsReview());
        }
        var live=live();var intent=live.intent(512);var file=live.directory().resolve("000001.applied.json");Files.writeString(file,"partial");assertThrows(IOException.class,()->live.applied(intent,intent.writes(),AssemblyPatchJournal.ReceiptState.COMPLETE));assertEquals("partial",Files.readString(file));assertTrue(AssemblyPatchJournal.inspect(live.directory()).needsReview());
    }
    @Test void v1AndAuthorityFlagsCannotBeRehashedIntoWholeLedger()throws Exception{
        for(var field:List.of("version","canAuthorizePlacement","serverBaselineVerified","worldDurabilityVerified","crashAtomicPublication")){
            var live=live();var plan=read(live.directory().resolve("plan.json"));if(field.equals("version"))plan.addProperty(field,1);else plan.addProperty(field,true);
            plan.remove("planHash");plan.addProperty("planHash",SelectionBaseline.hash(plan));Files.write(live.directory().resolve("plan.json"),bytes(plan));var review=AssemblyPatchJournal.inspect(live.directory());assertTrue(review.needsReview());assertFalse(review.canAuthorizePlacement());assertFalse(review.worldDurabilityVerified());
        }
    }
    @Test void wholeMemberHardlinksAreRejectedWithoutMutatingTheAlias()throws Exception{
        var live=live();var alias=temp.resolve("whole-member-alias.json");Files.createLink(alias,live.directory().resolve("part-000-preview.json"));assertThrows(IOException.class,()->live.intent(512));assertTrue(AssemblyPatchJournal.inspect(live.directory()).needsReview());assertTrue(Files.exists(alias));
    }
    @Test void strictWholeBindingRoundTripRejectsExtraFieldsMovabilityAndMissingParts()throws Exception{
        var binding=fixture("lite").input.binding();assertEquals(binding,AssemblyPatchBinding.parse(binding.json()));
        for(int kind=0;kind<4;kind++){var changed=binding.json();switch(kind){case 0->changed.addProperty("movable",true);case 1->changed.addProperty("extra",false);case 2->changed.getAsJsonArray("partHashes").remove(0);case 3->changed.addProperty("version",1);}
            assertThrows(IllegalArgumentException.class,()->AssemblyPatchBinding.parse(changed));}
    }
}
