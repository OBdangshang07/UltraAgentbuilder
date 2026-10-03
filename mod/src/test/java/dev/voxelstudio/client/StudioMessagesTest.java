package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class StudioMessagesTest {
 @Test void assemblyFailuresExplainPreservedProgressWithoutPromisingFreeRetries(){
  assertTrue(StudioMessages.errorSummary("Required package facade failed").contains("半成品不会发布"));
  assertTrue(StudioMessages.errorSummary("Codex app-server disconnected").contains("不会自动重发"));
  assertTrue(StudioMessages.errorSummary("Assembly skeleton failed").contains("整体骨架"));
  assertTrue(StudioMessages.errorSummary("Assembly model-call budget exhausted").contains("没有追加调用"));
  assertTrue(StudioMessages.errorSummary("Stale/invalid draft source hash").contains("版本不一致"));
 }
 @Test void providerFailureIsNotHiddenByGenericTimeoutOrContextSummary(){
  for(String code:new String[]{"TIMEOUT","TRANSPORT","AUTH","RATE_LIMIT","CONTEXT_WINDOW_EXCEEDED","UNKNOWN"}){
   String detail="DeepSeek 生成未完成 [DSH:"+code+"]：原稿保留；没有自动重试。";
   assertEquals(detail,StudioMessages.errorSummary(detail));
  }
 }
 @Test void oldOrMissingFeedbackStillWorks(){
  assertEquals("",StudioMessages.constructionFeedback(null));assertEquals("",StudioMessages.constructionFeedback(new JsonObject()));
  assertEquals("",StudioMessages.constructionFeedback(JsonParser.parseString("{\"constructionFeedback\":null}").getAsJsonObject()));
 }
 @Test void exactFrameAndModuleContextAreVisibleWithoutClaimingARepair(){
  var owner=JsonParser.parseString("""
   {"constructionFeedback":{"issueCount":1,"checksComplete":true,"issues":[
     {"code":"component-bounds","component":"podiumSouthLobby","origin":[10,0,98],"size":[52,9,4],"bounds":[64,240,64],
      "frame":{"parentOrigin":[4,0,48],"anchorDelta":[0,0,0],"offset":[6,0,50]}}
   ]}}
   """).getAsJsonObject();
  String text=StudioMessages.constructionFeedback(owner);
  for(String part:new String[]{"podiumSouthLobby","[10,0,98]","[4,0,48]","[6,0,50]","未证明可建造","未自动移动"})assertTrue(text.contains(part),part);
 }
 @Test void incompleteAndTruncatedReportsNeverLookLikeACompleteSuccess(){
  var owner=JsonParser.parseString("{\"constructionFeedback\":{\"issueCount\":0,\"checksComplete\":false,\"truncated\":true,\"issues\":[]}}").getAsJsonObject();
  String text=StudioMessages.constructionFeedback(owner);assertTrue(text.contains("检查未完整执行"));assertTrue(text.contains("部分记录"));assertTrue(text.contains("未证明可建造"));
 }
 @Test void oversizedAndMalformedIssueFieldsAreBoundedAndDoNotCrashTheErrorPanel(){
  var owner=new JsonObject();var report=new JsonObject();owner.add("constructionFeedback",report);report.addProperty("issueCount",99);report.addProperty("checksComplete",true);
  var issues=new com.google.gson.JsonArray();report.add("issues",issues);
  for(int i=0;i<20;i++){var item=new JsonObject();item.addProperty("component","x".repeat(10000));item.add("origin",JsonParser.parseString("[1,{},3]"));issues.add(item);}
  String text=StudioMessages.constructionFeedback(owner);assertTrue(text.length()<3000);assertTrue(text.contains("[未知]"));assertTrue(text.contains("部分记录"));
 }
}
