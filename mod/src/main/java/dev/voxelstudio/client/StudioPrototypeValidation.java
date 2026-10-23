package dev.voxelstudio.client;

import com.google.gson.*;
import java.util.List;

/** Explicit new-task validation order, never a restored task or route waiver. */
final class StudioPrototypeValidation {
    static final String MODE="expanded-routes-v1";
    static final String WARNING="展开校验 v1（实验）：带明确配方的临时种子先检查实际方块、归属和工作范围；全部展开后，再与上一完整建筑比较已建立的入口、通道和楼梯。无配方仍检查完整通路，缺层、短配方或通路退化不通过。仅用于新任务；不升级旧任务、不自动修补方块，0 次新增模型调用，不增加预算或世界写入权限。";
    private static final JsonElement POLICY=JsonParser.parseString("{\"version\":1,\"mode\":\"expanded-routes-v1\",\"seed\":\"cells-and-owners\",\"expanded\":\"cells-owners-and-established-routes\",\"noRecipes\":\"cells-owners-and-established-routes\",\"canAuthorizePlacement\":false}");
    private static String value(JsonObject o,String key){
        var v=o==null?null:o.get(key);return v!=null&&v.isJsonPrimitive()&&v.getAsJsonPrimitive().isString()?v.getAsString():"";
    }
    private static boolean staged(JsonObject r){
        return value(r,"generationMode").equals("scene")&&value(r,"sceneWorkflow").equals("components")&&
            value(r,"qualityTier").equals("ultra")&&value(r,"assemblyPrototypes").equals("staged")&&
            value(r,"assemblyQuality").equals("v4")&&value(r,"assemblyDesignReview").equals("native")&&value(r,"assemblyRecovery").equals("safe");
    }
    private static void requireNewRequest(JsonObject r){
        for(String key:List.of("baseJobId","repairJobId","spec","scenePatch","patch","importDirectory","checkpointCalls","checkpointConfirmed","reviewImages"))
            if(r.has(key))throw new IllegalArgumentException("展开校验不能升级已有任务或改变修改权限；未提交");
        if(r.has("sample")&&(!r.get("sample").isJsonPrimitive()||!r.get("sample").getAsJsonPrimitive().isBoolean()||r.get("sample").getAsBoolean()))
            throw new IllegalArgumentException("示例不能获得新任务展开策略");
    }
    static void configure(JsonObject r,boolean selected){
        if(!selected){r.remove("assemblyPrototypeValidation");return;}
        if(!staged(r))throw new IllegalArgumentException("展开校验仅支持明确选择的 Ultra 分阶段 v4 原生复核新任务；未提交");
        requireNewRequest(r);r.addProperty("assemblyPrototypeValidation",MODE);
    }
    static boolean hasVerifiedPolicy(JsonObject assembly){
        var p=assembly==null?null:assembly.get("prototypes");
        return p!=null&&p.isJsonObject()&&new JsonPrimitive(6).equals(p.getAsJsonObject().get("version"))
            &&"staged".equals(value(p.getAsJsonObject(),"mode"))&&POLICY.equals(p.getAsJsonObject().get("validation"));
    }
    static boolean verify(JsonObject r,JsonObject assembly){
        var p=assembly==null?null:assembly.get("prototypes");
        if(!r.has("assemblyPrototypeValidation")){
            if(p!=null&&p.isJsonObject()&&(p.getAsJsonObject().has("validation")||new JsonPrimitive(6).equals(p.getAsJsonObject().get("version"))))
                throw new IllegalArgumentException("配套增加了未选择的展开校验策略");
            return false;
        }
        if(!MODE.equals(value(r,"assemblyPrototypeValidation"))||!staged(r)||!hasVerifiedPolicy(assembly))
            throw new IllegalArgumentException("展开校验请求 / 版本 / 通路或放置权限不一致，请完整升级；未提交");
        requireNewRequest(r);return true;
    }
    private StudioPrototypeValidation(){}
}
