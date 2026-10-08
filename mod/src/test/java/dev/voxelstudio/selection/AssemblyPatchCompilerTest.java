package dev.voxelstudio.selection;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import java.util.concurrent.CancellationException;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

/** Whole original production Lite and 224m Ultra, independently rebuilt.
 * Offline data safety only, not native rendering, physics or a write gateway. */
final class AssemblyPatchCompilerTest {
    @Test void completeLiteAndUnshrunkSevenPartUltraRebuildAgainstOneOriginalBaseline()throws Exception{
        for(var f:AssemblyPatchFixtures.headers()){
            var original=AssemblyPatchFixtures.baseline(f);var input=AssemblyPatchFixtures.input(f);var result=AssemblyPatchCompiler.compile(original,input,()->false);
            assertSame(original,result.baseline());assertSame(input,result.original());assertEquals(input.binding(),result.binding());
            assertEquals(input.binding().totalWrites(),result.writes().size());assertTrue(result.completeSetRebuilt());assertFalse(result.canAuthorizePlacement());assertFalse(result.physicsVerified());
            var writes=new HashMap<SelectionRegion.Point,WorldPatchCompiler.Write>();var expectedRoles=new HashMap<SelectionRegion.Point,Set<String>>();
            for(var write:result.writes())assertNull(writes.put(write.position(),write));
            for(int index=0;index<input.parts().size();index++){
                var patch=AssemblyPatchFixtures.part(f,index).getAsJsonObject("patch");
                assertEquals(input.binding().partHashes().get(index),patch.get("patchHash").getAsString());
                for(var value:patch.getAsJsonArray("writes")){
                    var row=value.getAsJsonObject();var p=AssemblyPatchFixtures.point(row.getAsJsonArray("position"));var write=writes.remove(p);assertNotNull(write);
                    assertEquals(row.get("before").getAsString(),write.before());assertEquals(row.get("after").getAsString(),write.after());assertEquals(row.get("action").getAsString(),write.action());assertEquals(row.get("difference").getAsString(),write.difference());
                    assertEquals(original.at(p).state(),write.before());assertEquals(write.after(),input.parts().get(index).preview().at(p).after());
                }
                for(var value:patch.getAsJsonArray("guards")){
                    var guard=value.getAsJsonObject();var p=AssemblyPatchFixtures.point(guard.getAsJsonArray("position"));var roles=expectedRoles.computeIfAbsent(p,key->new TreeSet<>());
                    guard.getAsJsonArray("roles").forEach(v->roles.add(v.getAsString()));assertEquals(original.at(p).state(),guard.get("before").getAsString());assertEquals(original.at(p).blockEntity(),guard.get("blockEntity").getAsBoolean());
                }
            }
            assertTrue(writes.isEmpty());assertEquals(expectedRoles.size(),result.guards().size());
            for(var guard:result.guards()){assertEquals(expectedRoles.remove(guard.position()),new TreeSet<>(guard.roles()));assertEquals(original.at(guard.position()).state(),guard.before());assertEquals(original.at(guard.position()).blockEntity(),guard.blockEntity());}
            assertTrue(expectedRoles.isEmpty());assertThrows(UnsupportedOperationException.class,()->result.writes().clear());assertThrows(UnsupportedOperationException.class,()->result.guards().clear());
            var display=AssemblyPatchPreview.from(input);assertEquals(result.writes().size(),display.totalWrites());
            for(var write:result.writes()){assertEquals(write.before(),display.at(write.position()).before());assertEquals(write.after(),display.at(write.position()).after());}
            if(f.get("tier").getAsString().equals("ultra")){assertEquals(7,input.parts().size());assertEquals(54406,result.writes().size());assertEquals(224,original.selection.edit().max().y()-original.selection.edit().min().y());}
        }
    }
    @Test void rehashedDownloadedWritesGuardsAndAuthorityNeverReplaceOriginalProposal()throws Exception{
        var f=AssemblyPatchFixtures.header("lite");var original=AssemblyPatchFixtures.baseline(f);
        for(int kind=0;kind<5;kind++){
            var envelope=AssemblyPatchFixtures.part(f,0);var patch=envelope.getAsJsonObject("patch");
            switch(kind){
                case 0->patch.getAsJsonArray("writes").get(0).getAsJsonObject().addProperty("after","minecraft:diamond_block");
                case 1->patch.getAsJsonArray("guards").remove(0);
                case 2->patch.addProperty("serverBaselineVerified",true);
                case 3->patch.addProperty("physicsVerified",true);
                case 4->patch.addProperty("canAuthorizePlacement",true);
            }
            var changed=AssemblyPatchFixtures.changedLite(f,envelope);
            assertThrows(IllegalArgumentException.class,()->AssemblyPatchCompiler.compile(original,changed,()->false),"rehashed mutation "+kind);
        }
    }
    @Test void originalProposalMustHaveSameBeforeScopeAndStillSupportedStaticStates()throws Exception{
        var f=AssemblyPatchFixtures.header("lite");var original=AssemblyPatchFixtures.baseline(f);
        for(String state:List.of("minecraft:water[level=0]","minecraft:oak_door[facing=north,half=lower,hinge=left,open=false,powered=false]","minecraft:oak_trapdoor[facing=north,half=bottom,open=false,powered=false,waterlogged=false]","minecraft:sand")){
            var input=AssemblyPatchFixtures.input(f);var part=input.parts().get(0);var proposal=WorldPatchJson.parse(part.proposal(),()->false);
            proposal.getAsJsonArray("operations").get(0).getAsJsonObject().addProperty("after",state);
            var changed=new AssemblyPatchInput(input.binding(),List.of(new AssemblyPatchInput.Part(0,AssemblyPatchFixtures.bytes(proposal),part.patch(),part.preview())));
            assertThrows(IllegalArgumentException.class,()->AssemblyPatchCompiler.compile(original,changed,()->false),state);
        }
    }
    @Test void differentServerBaselineRevisionCannotBeRefreshedToAcceptDownloadedParts()throws Exception{
        var f=AssemblyPatchFixtures.header("lite");var input=AssemblyPatchFixtures.input(f);var capture=JsonParser.parseString(f.get("payload").getAsString()).getAsJsonObject().getAsJsonObject("capture");
        capture.getAsJsonObject("fence").addProperty("start",input.binding().contextRevision()+1);capture.getAsJsonObject("fence").addProperty("end",input.binding().contextRevision()+1);
        var replacement=SelectionBaseline.fromSealedCapture(input.binding().selection(),capture);
        assertThrows(IllegalArgumentException.class,()->AssemblyPatchCompiler.compile(replacement,input,()->false));
    }
    @Test void cancellationBeforeAndDuringReconstructionNeverReturnsPartialCompiledSet()throws Exception{
        var f=AssemblyPatchFixtures.header("lite");var original=AssemblyPatchFixtures.baseline(f);var input=AssemblyPatchFixtures.input(f);
        assertThrows(CancellationException.class,()->AssemblyPatchCompiler.compile(original,input,()->true));
        var checks=new AtomicInteger();assertThrows(CancellationException.class,()->AssemblyPatchCompiler.compile(original,input,()->checks.incrementAndGet()>5));
        assertFalse(input.canAuthorizePlacement());assertEquals(input.binding().totalWrites(),input.parts().get(0).preview().totalWrites());
    }
}
