package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import java.nio.file.*;
import static org.junit.jupiter.api.Assertions.*;

class StudioRepresentativeEvidenceTest {
    private static JsonArray fixtures()throws Exception{return JsonParser.parseString(Files.readString(Path.of("build/test-fixtures/camera-evidence-preflight.json"))).getAsJsonArray();}
    @Test void allNewNodeBudgetsMatchPlayerConsentWithoutAddingCalls()throws Exception{
        var fixtures=fixtures();assertEquals(5,fixtures.size());
        for(var item:fixtures){
            var f=item.getAsJsonObject();var r=f.getAsJsonObject("request");var p=f.getAsJsonObject("policy");
            assertTrue(StudioRepresentativeEvidence.verify(r,p.getAsJsonObject("assembly")));
            String text=StudioAssembly.confirmation(r,p);assertTrue(text.contains("代表选层 v1"));assertTrue(text.contains("0 次新增模型调用"));
            assertTrue(text.contains("不同楼层冒充前后对照"));assertTrue(text.contains("不是当前内饰功能"));
            assertEquals(r.get("assemblyCalls"),p.get("maximumCalls"));assertFalse(r.has("assemblyConfirmed"));
        }
    }
    @Test void newUiRequestOptsInOnlyWhenStagedIsSelected()throws Exception{
        for(var item:fixtures()){
            var r=item.getAsJsonObject().getAsJsonObject("request").deepCopy();r.remove("assemblyEvidence");
            StudioRepresentativeEvidence.configure(r);assertEquals("representative-v1",r.get("assemblyEvidence").getAsString());
            r.addProperty("assemblyPrototypes","verified");StudioRepresentativeEvidence.configure(r);assertFalse(r.has("assemblyEvidence"));
            r.addProperty("assemblyPrototypes","staged");r.addProperty("assemblyQuality","v3");
            assertThrows(IllegalArgumentException.class,()->StudioRepresentativeEvidence.configure(r));
        }
    }
    @Test void legacyConsentCannotAcquireNewCameraPolicyAndMalformedPolicyIsRejected()throws Exception{
        for(var item:fixtures()){
            var f=item.getAsJsonObject();var r=f.getAsJsonObject("request").deepCopy();var p=f.getAsJsonObject("policy").deepCopy();var a=p.getAsJsonObject("assembly");
            for(String key:new String[]{"version","mode","floorBasis","comparisonCameras","missingRepresentative","canAuthorizePlacement"}){
                var changed=p.deepCopy();changed.getAsJsonObject("assembly").getAsJsonObject("cameraEvidence").remove(key);
                assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,changed));
            }
            var world=p.deepCopy();world.getAsJsonObject("assembly").getAsJsonObject("cameraEvidence").addProperty("canAuthorizePlacement",true);
            assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,world));
            var adaptive=p.deepCopy();adaptive.getAsJsonObject("assembly").getAsJsonObject("cameraEvidence").addProperty("comparisonCameras","moving");
            assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,adaptive));
            r.remove("assemblyEvidence");assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));
            a.remove("cameraEvidence");assertFalse(StudioAssembly.confirmation(r,p).contains("代表选层 v1"));
            r.addProperty("assemblyEvidence","representative-v1");assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));
        }
    }
}
