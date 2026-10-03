package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ReferenceJobHistoryReceiptTest {
    static JsonObject fixture()throws Exception{return ReferencePreparationReceiptTest.fixtures().getAsJsonArray("cases").get(0).getAsJsonObject();}
    static void rehash(JsonObject object,String field){object.remove(field);object.addProperty(field,ContextReceipt.jsonHash(object));}
    @Test void actualWorkerHistoriesBindAllTiersAndReadOnlyOriginalPicturesWithoutAnyModelCalls()throws Exception {
        var fixtures=ReferencePreparationReceiptTest.fixtures();assertEquals(0,fixtures.get("modelCalls").getAsInt());
        for(var item:fixtures.getAsJsonArray("cases")){var c=item.getAsJsonObject();var verified=ReferenceJobHistoryReceipt.verify(c.getAsJsonObject("historyJob"),c.getAsJsonObject("history"));assertEquals(c.get("history"),verified);
            assertEquals("pending",verified.getAsJsonObject("analysis").get("status").getAsString());
            for(int i=0;i<2;i++){var r=verified.getAsJsonObject("manifest").getAsJsonArray("references").get(i).getAsJsonObject();var png=Base64.getDecoder().decode(c.getAsJsonArray("historyImages").get(i).getAsString());var picture=ReferenceJobHistoryReceipt.pixels(r,png);assertEquals(3,picture.width());assertEquals(2,picture.height());assertArrayEquals(png,picture.png());}
            String details=ReferenceJobHistoryReceipt.details(verified);assertTrue(details.contains("不调用模型"));assertTrue(details.contains(c.getAsJsonObject("generation").get("prompt").getAsString()));assertFalse(details.contains("尚未调用模型"));
            verified.addProperty("state","external change");assertEquals("queued",c.getAsJsonObject("history").get("state").getAsString());
        }
    }
    @Test void rehashedDifferentTaskPicturesBudgetSendOrAuthorityCannotReplaceTheOriginal()throws Exception {
        var c=fixture();var original=c.getAsJsonObject("historyJob");
        for(String field:List.of("jobId","requestHash","state","worldWrites","additionalModelCalls","canAuthorizePlacement")){
            var h=c.getAsJsonObject("history").deepCopy();if(field.equals("canAuthorizePlacement"))h.addProperty(field,true);else if(List.of("worldWrites","additionalModelCalls").contains(field))h.addProperty(field,1);else h.addProperty(field,field.equals("state")?"made-up":"c".repeat(64));rehash(h,"historyHash");assertThrows(IllegalStateException.class,()->ReferenceJobHistoryReceipt.verify(original,h),field);
        }
        var h=c.getAsJsonObject("history").deepCopy();h.getAsJsonObject("manifest").getAsJsonArray("references").get(0).getAsJsonObject().getAsJsonObject("annotation").addProperty("caption","changed");rehash(h.getAsJsonObject("manifest"),"setHash");rehash(h,"historyHash");assertThrows(IllegalStateException.class,()->ReferenceJobHistoryReceipt.verify(original,h));
        var badSend=c.getAsJsonObject("history").deepCopy();badSend.getAsJsonObject("sendConfirmation").addProperty("accepted",false);rehash(badSend,"historyHash");assertThrows(IllegalStateException.class,()->ReferenceJobHistoryReceipt.verify(original,badSend));
    }
    @Test void changedImageBytesAndClaimsOfAcceptedBriefWithoutOriginalAuditAreRejected()throws Exception {
        var c=fixture();var record=c.getAsJsonObject("history").getAsJsonObject("manifest").getAsJsonArray("references").get(0).getAsJsonObject();assertThrows(IllegalStateException.class,()->ReferenceJobHistoryReceipt.pixels(record,ReferenceImageDraftTest.png(3,2)));
        var h=c.getAsJsonObject("history").deepCopy();h.add("analysis",JsonParser.parseString("{\"status\":\"accepted\",\"reason\":\"not an original receipt\"}"));rehash(h,"historyHash");assertThrows(IllegalStateException.class,()->ReferenceJobHistoryReceipt.verify(c.getAsJsonObject("historyJob"),h));
    }
    @Test void originalAcceptedBriefFromSyntheticProductionPipelineIsReadableButNeverQualityOrPlacementAuthority()throws Exception {
        var root=ReferencePreparationReceiptTest.fixtures();assertEquals(0,root.get("modelCalls").getAsInt());assertEquals(6,root.get("syntheticAssemblyCalls").getAsInt());
        var c=fixture();var h=ReferenceJobHistoryReceipt.verify(c.getAsJsonObject("historyJob"),c.getAsJsonObject("acceptedHistory"));
        var analysis=h.getAsJsonObject("analysis");assertEquals("accepted",analysis.get("status").getAsString());
        assertEquals(6,analysis.getAsJsonObject("audit").get("auditedStages").getAsInt());
        assertTrue(analysis.getAsJsonObject("audit").get("originalBriefReceiptVerified").getAsBoolean());
        assertFalse(analysis.getAsJsonObject("audit").get("realImageUnderstandingVerified").getAsBoolean());
        String detail=ReferenceJobHistoryReceipt.details(h);assertTrue(detail.contains("已与原模型回答及后续简报身份核对"));assertTrue(detail.contains("不是指令"));assertTrue(detail.contains("Free fixture, not image understanding"));
        assertEquals("queued",c.getAsJsonObject("history").get("state").getAsString());
        for(var ref:h.getAsJsonObject("manifest").getAsJsonArray("references"))assertFalse(ref.getAsJsonObject().has("sourcePath"));
    }
    @Test void rehashedAcceptedBriefWithDifferentBindingBudgetOrFalseAuditIsRejected()throws Exception {
        var c=fixture();var original=c.getAsJsonObject("historyJob");
        for(String mutation:List.of("binding","stage","geometry","understanding","originalReceipt","downstream","auditedStages")){
            var h=c.getAsJsonObject("acceptedHistory").deepCopy();var a=h.getAsJsonObject("analysis");var e=a.getAsJsonObject("evidence");var audit=a.getAsJsonObject("audit");
            switch(mutation){
                case "binding"->{e.addProperty("referenceBindingHash","c".repeat(64));audit.addProperty("referenceBindingHash","c".repeat(64));}
                case "stage"->e.addProperty("stage",27);
                case "geometry"->e.addProperty("geometryVerified",true);
                case "understanding"->audit.addProperty("realImageUnderstandingVerified",true);
                case "originalReceipt"->audit.addProperty("originalBriefReceiptVerified",false);
                case "downstream"->audit.addProperty("downstreamBriefIdentityVerified",false);
                case "auditedStages"->audit.addProperty("auditedStages",27);
            }
            rehash(e,"analysisHash");audit.add("analysisHash",e.get("analysisHash"));rehash(h,"historyHash");
            assertThrows(IllegalStateException.class,()->ReferenceJobHistoryReceipt.verify(original,h),mutation);
        }
    }
}
