package dev.voxelstudio.client;

import com.google.gson.*;

/** New-request framing opt-in, not a quality certificate or world authority. */
final class StudioRepresentativeEvidence {
    static final String WARNING="代表选层 v1：从本任务首次完整展开稿保存的真实方块、归属及原型职责选择房间层；不按 office 等名称或建筑半高猜办公层。缺少房间证据时明确标记局限。后续改稿固定同层相机，不将不同楼层冒充前后对照；初始选层依据不是当前内饰功能、通行或审美认证。0 次新增模型调用，不增加世界写入权限。";
    private static String value(JsonObject o,String key){
        var v=o==null?null:o.get(key);return v!=null&&v.isJsonPrimitive()&&v.getAsJsonPrimitive().isString()?v.getAsString():"";
    }
    private static boolean staged(JsonObject r){return value(r,"qualityTier").equals("ultra")&&value(r,"assemblyPrototypes").equals("staged")&&value(r,"assemblyQuality").equals("v4")&&value(r,"assemblyDesignReview").equals("native")&&value(r,"assemblyRecovery").equals("safe");}
    static void configure(JsonObject request){
        if(!value(request,"assemblyPrototypes").equals("staged")){request.remove("assemblyEvidence");return;}
        if(!staged(request))throw new IllegalArgumentException("代表选层需要明确选择分阶段 v4 原生复核与安全恢复；未提交");
        request.addProperty("assemblyEvidence","representative-v1");
    }
    static boolean verify(JsonObject request,JsonObject assembly){
        if(!request.has("assemblyEvidence")){
            if(assembly!=null&&assembly.has("cameraEvidence"))throw new IllegalArgumentException("配套增加了未选择的代表选层政策");
            return false;
        }
        if(!value(request,"assemblyEvidence").equals("representative-v1")||!staged(request)||assembly==null||!assembly.has("cameraEvidence"))throw new IllegalArgumentException("代表选层请求 / 配套政策不一致，请完整升级");
        var expected=JsonParser.parseString("{\"version\":1,\"mode\":\"representative-v1\",\"floorBasis\":\"saved-staged-geometry\",\"comparisonCameras\":\"fixed-first-expanded\",\"missingRepresentative\":\"disclose\",\"canAuthorizePlacement\":false}");
        if(!expected.equals(assembly.get("cameraEvidence")))throw new IllegalArgumentException("代表选层版本、固定相机或权限发生变化，未提交");
        return true;
    }
    private StudioRepresentativeEvidence(){}
}
