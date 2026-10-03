package dev.voxelstudio.client;

import com.google.gson.*;
import java.util.*;

/** Explicit new-task consent, not a migration or authority inferred from a job. */
final class StudioProviderRecovery {
    private static final Set<String> EFFORTS=Set.of("none","minimal","low","medium","high","xhigh","max","ultra");
    private static final JsonObject POLICY=JsonParser.parseString("{\"version\":1,\"mode\":\"bounded\",\"provider\":\"codex\",\"maximumRetries\":2,\"waitMs\":[10000,30000],\"unknownOutcomeRetries\":0,\"partialOutputRetries\":0,\"increaseCallLimit\":false,\"changeModel\":false,\"refundFailedCalls\":false,\"shrinkRequiredScope\":false}").getAsJsonObject();
    static final String WARNING="容量恢复（显式开启）：仅原 Codex 调用已关闭、原回执确认完全无输出的容量失败，才可在原预算且保留完整尾程时最多重试 2 次，依次等待 10 / 30 秒，可取消等待。原失败和每次恢复都可能计费并占总额度，不退款、不加额度、不换模型或推理强度、不删必需制作范围。未知、截断、部分或评论输出不重发；不会升级旧任务。";
    private static String text(JsonObject o,String k){var v=o.get(k);return v!=null&&v.isJsonPrimitive()&&v.getAsJsonPrimitive().isString()?v.getAsString():"";}
    private static boolean number(JsonElement value,int expected){try{return value!=null&&value.isJsonPrimitive()&&value.getAsJsonPrimitive().isNumber()&&value.getAsBigDecimal().compareTo(java.math.BigDecimal.valueOf(expected))==0;}catch(NumberFormatException e){return false;}}
    static boolean canSelect(String agent,String model,String effort,List<String> advertised){
        return "codex".equals(agent)&&model!=null&&model.matches("[A-Za-z0-9._:-]{1,128}")&&effort!=null&&EFFORTS.contains(effort)&&advertised!=null&&advertised.contains(effort);
    }
    private static boolean requested(JsonObject request){
        if(!request.has("assemblyProviderRecovery"))return false;
        String effort=text(request,"effort");
        if(!text(request,"assemblyProviderRecovery").equals("bounded")||
            !canSelect(text(request,"agent"),text(request,"model"),effort,List.of(effort))||
            !text(request,"generationMode").equals("scene")||!text(request,"sceneWorkflow").equals("components")||
            !text(request,"assemblyRecovery").equals("safe")||request.has("maxRepairs")&&!number(request.get("maxRepairs"),0)||
            List.of("sample","spec","patch","scenePatch","importDirectory","revalidateJobId","baseJobId","baseHash","sceneScope","reviewImages","repairJobId","checkpointCalls","checkpointConfirmed").stream().anyMatch(request::has))
            throw new IllegalArgumentException("容量恢复仅用于新 Codex 组件任务；须选择确切模型、已声明的推理强度与安全恢复，未提交");
        return true;
    }
    static void configure(JsonObject request,boolean enabled,List<String> advertised){
        if(!enabled){request.remove("assemblyProviderRecovery");return;}
        if(!canSelect(text(request,"agent"),text(request,"model"),text(request,"effort"),advertised))
            throw new IllegalArgumentException("先选择 Codex 模型实际声明的推理强度；不能跟随未绑定的默认强度或自动换模");
        var candidate=request.deepCopy();candidate.addProperty("assemblyProviderRecovery","bounded");requested(candidate);
        request.addProperty("assemblyProviderRecovery","bounded");
    }
    static boolean verify(JsonObject request,JsonObject assembly){
        boolean enabled=requested(request);
        var retries=assembly==null?null:assembly.get("providerRetries");
        if(!enabled){
            if(assembly!=null&&assembly.has("providerRecovery")||retries!=null&&!number(retries,0))
                throw new IllegalArgumentException("配套擅自增加未确认的容量恢复权限，未提交");
            return false;
        }
        var safe=JsonParser.parseString("{\"version\":1,\"mode\":\"safe\",\"unknownOutcomeRetries\":0}");
        if(assembly==null||!number(retries,2)||!POLICY.equals(assembly.get("providerRecovery"))||
            !text(assembly,"workflow").equals("components")||!safe.equals(assembly.get("recovery")))
            throw new IllegalArgumentException("容量恢复合同、次数、等待、费用或失败边界不一致；请完整升级，未提交");
        return true;
    }
    static String waitStatus(JsonObject job){
        if(List.of("preview-ready","failed","cancelled","interrupted").contains(text(job,"state")))return "";
        var r=job.get("recovery");if(r==null||!r.isJsonObject())return "";
        var recovery=r.getAsJsonObject();if(!text(recovery,"state").equals("provider-capacity-wait"))return "";
        if(!number(recovery.get("ordinal"),1)&&!number(recovery.get("ordinal"),2))return "容量恢复状态待核验";
        int ordinal=recovery.get("ordinal").getAsInt(),seconds=ordinal==1?10:30;
        if(!number(recovery.get("waitMs"),seconds*1000))return "容量恢复等待策略待核验";
        return "容量恢复等待 · 第 "+ordinal+"/2 次 · 等待 "+seconds+" 秒，可取消（不是剩余时间倒计时）";
    }
    static String details(JsonObject job){
        var p=job.getAsJsonObject("preflight");if(p==null||!p.has("assembly"))return "";
        var a=p.getAsJsonObject("assembly");if(!a.has("providerRecovery"))return "\n容量恢复：关闭；原提供方错误不自动重发。";
        var out=new StringBuilder("\n").append(WARNING);String wait=waitStatus(job);if(!wait.isEmpty())out.append("\n").append(wait);
        var s=job.get("assemblySummary");if(s!=null&&s.isJsonObject()){
            var r=s.getAsJsonObject().get("providerRecovery");if(r!=null&&r.isJsonObject()){
                var summary=r.getAsJsonObject();out.append("\n已预留的容量恢复调用：").append(summary.get("retriesReserved")).append("；原容量失败调用：").append(summary.get("failedCapacityCalls")).append("。这些仍计入全部原预留，失败不能改记成功。");
            }
        }
        return out.toString();
    }
    private StudioProviderRecovery(){}
}
