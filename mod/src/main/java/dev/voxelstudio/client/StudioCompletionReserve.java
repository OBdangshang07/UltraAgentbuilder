package dev.voxelstudio.client;

import com.google.gson.*;
import java.util.List;

/** Explicit new-request scheduling only; never upgrades a restored job. */
final class StudioCompletionReserve {
    static final String MODE="design-correction-v1";
    static final String WARNING="收尾预留 v1（实验）：每次原型制作 / 纠错保留改稿、一次几何纠错、再次整体复核三次尾程调用，并保留全部深化包和最终复核；改稿纠错实际占用预留，不新增额度。过多前置失败可能更早停止，但不会删包、缩小功能或接受未通过方案。仅用于新任务；未知调用不重发，不增加世界写入权限。";
    private static final JsonElement POLICY=JsonParser.parseString("{\"version\":1,\"mode\":\"design-correction-v1\",\"designCorrections\":1,\"newTaskOnly\":true,\"increaseCallLimit\":false,\"shrinkRequiredScope\":false,\"canAuthorizePlacement\":false}");
    private static String value(JsonObject o,String key){
        var v=o==null?null:o.get(key);return v!=null&&v.isJsonPrimitive()&&v.getAsJsonPrimitive().isString()?v.getAsString():"";
    }
    private static boolean staged(JsonObject request){
        return value(request,"generationMode").equals("scene")&&value(request,"sceneWorkflow").equals("components")&&
            value(request,"qualityTier").equals("ultra")&&value(request,"assemblyPrototypes").equals("staged")&&
            value(request,"assemblyQuality").equals("v4")&&value(request,"assemblyDesignReview").equals("native")&&value(request,"assemblyRecovery").equals("safe");
    }
    private static void requireNewRequest(JsonObject request){
        for(String key:List.of("baseJobId","repairJobId","spec","scenePatch","patch","importDirectory","checkpointCalls","reviewImages"))
            if(request.has(key))throw new IllegalArgumentException("收尾预留不能升级已有任务或改变修改权限；未提交");
        if(request.has("sample")&&(!request.get("sample").isJsonPrimitive()||!request.get("sample").getAsJsonPrimitive().isBoolean()||request.get("sample").getAsBoolean()))
            throw new IllegalArgumentException("示例不能获得收尾调用权限");
    }
    static void configure(JsonObject request,boolean selected){
        if(!selected){request.remove("assemblyCompletionReserve");return;}
        if(!staged(request))throw new IllegalArgumentException("收尾预留仅支持明确选择的 Ultra 分阶段 v4 原生复核新任务；未提交");
        requireNewRequest(request);
        request.addProperty("assemblyCompletionReserve",MODE);
    }
    static boolean hasVerifiedPolicy(JsonObject assembly){return assembly!=null&&POLICY.equals(assembly.get("completionReserve"));}
    static boolean verify(JsonObject request,JsonObject assembly){
        if(!request.has("assemblyCompletionReserve")){
            if(assembly!=null&&assembly.has("completionReserve"))throw new IllegalArgumentException("配套增加了未选择的收尾预留策略");
            return false;
        }
        if(!MODE.equals(value(request,"assemblyCompletionReserve"))||!staged(request)||!hasVerifiedPolicy(assembly))
            throw new IllegalArgumentException("收尾预留请求 / 版本 / 调用或放置权限不一致，请完整升级；未提交");
        requireNewRequest(request);
        return true;
    }
    private StudioCompletionReserve(){}
}
