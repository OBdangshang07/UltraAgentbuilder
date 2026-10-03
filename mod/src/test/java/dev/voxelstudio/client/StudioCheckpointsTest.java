package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class StudioCheckpointsTest {
    @Test void localStairsAreNotPresentedAsWholeBuildingCertification(){
        var job=JsonParser.parseString("""
        {"preflight":{"checkpoints":{},"maximumCalls":4},"checkpointStages":[{"index":1,"state":"checked","navigationFeedback":{"checksComplete":false,"passages":11,"reachablePassages":1,"stairsChecked":54,"localTwoWayStairs":53,"stairsSkipped":2}}]}
        """).getAsJsonObject();
        String text=StudioCheckpoints.details(job);assertTrue(text.contains("通道 1/11"));assertTrue(text.contains("楼梯 53/54"));assertTrue(text.contains("检查不完整"));assertTrue(text.contains("不等于整楼通行"));
    }
    private JsonObject object(String text){return JsonParser.parseString(text).getAsJsonObject();}
    @Test void requestIsExplicitAndUnconfirmed(){
        for(int n=2;n<=4;n++){
            var request=object("{\"sample\":false,\"generationMode\":\"checkpoints\",\"checkpointConfirmed\":true}");StudioCheckpoints.configure(request,n);
            assertFalse(request.has("sample"));assertFalse(request.has("checkpointConfirmed"));assertFalse(request.has("maxOutputTokens"));assertEquals("scene",request.get("generationMode").getAsString());assertEquals(n,request.get("checkpointCalls").getAsInt());assertEquals(0,request.get("maxRepairs").getAsInt());
        }
        assertThrows(IllegalArgumentException.class,()->StudioCheckpoints.configure(new JsonObject(),1));
        assertThrows(IllegalArgumentException.class,()->StudioCheckpoints.configure(new JsonObject(),5));
        assertThrows(IllegalArgumentException.class,()->StudioCheckpoints.configure(object("{\"sample\":true}"),2));
        assertThrows(IllegalArgumentException.class,()->StudioCheckpoints.configure(object("{\"baseJobId\":\"old\"}"),2));
    }
    @Test void confirmationRejectsStaleCompanionBudget(){
        JsonObject request=object("{\"model\":\"test\",\"checkpointCalls\":4}"),policy=object("{\"checkpoints\":{},\"maximumCalls\":4,\"minimumHeight\":224,\"maxOutputTokens\":null,\"warnings\":[]}");
        String text=StudioCheckpoints.confirmation(request,policy);assertTrue(text.contains("最多 4 次"));assertTrue(text.contains("纠错会自动使用"));assertTrue(text.contains("224 格"));assertTrue(text.contains("返回或关闭不调用模型"));
        policy.addProperty("maximumCalls",1);assertThrows(IllegalArgumentException.class,()->StudioCheckpoints.confirmation(request,policy));policy.remove("checkpoints");assertThrows(IllegalArgumentException.class,()->StudioCheckpoints.confirmation(request,policy));
    }
    @Test void reservedCallsAreNotReportedAsFreeOrSuccessful(){
        var job=object("{\"preflight\":{\"mode\":\"scene\",\"checkpoints\":{},\"maximumCalls\":4},\"stage\":2,\"stageName\":\"correct-layout\",\"checkpointCallsReserved\":2,\"generations\":[{}],\"checkpointStages\":[{\"index\":2,\"phase\":\"correct-layout\",\"state\":\"interrupted\"}]}");
        assertTrue(StudioCheckpoints.job(job));assertTrue(StudioCheckpoints.progress(job).contains("修正布局"));assertTrue(StudioCheckpoints.progress(job).contains("2/4"));
        String text=StudioCheckpoints.details(job);assertTrue(text.contains("已预留：2 次"));assertTrue(text.contains("回执：1 次"));assertTrue(text.contains("已中断"));assertTrue(text.contains("不代表没有执行或没有计费"));assertTrue(text.contains("中间稿不可建造"));
        assertFalse(StudioCheckpoints.job(new JsonObject()));assertEquals("",StudioCheckpoints.details(new JsonObject()));
    }
}
