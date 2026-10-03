package dev.voxelstudio.client;

import com.google.gson.*;

/** Checkpoint budgets count underlying calls, not successful drafts. No network or world access. */
final class StudioCheckpoints {
    static boolean job(JsonObject job){return job.has("preflight")&&job.get("preflight").isJsonObject()&&job.getAsJsonObject("preflight").has("checkpoints");}
    static void configure(JsonObject request,int calls){
        if(calls<2||calls>4)throw new IllegalArgumentException("检查点预算须为 2–4 次");
        if(request.has("baseJobId")||request.has("repairJobId"))throw new IllegalArgumentException("检查点只用于新设计");
        if(request.has("sample")&&request.get("sample").getAsBoolean())throw new IllegalArgumentException("示例不使用检查点");
        request.remove("sample");request.addProperty("generationMode","scene");request.addProperty("maxRepairs",0);
        request.addProperty("sceneWorkflow","checkpoints");request.addProperty("checkpointCalls",calls);request.remove("checkpointConfirmed");
    }
    static String phase(String name){return switch(name){case "layout"->"布局与代表模块";case "correct-layout"->"修正布局";case "detail"->"整楼细化";case "correct-detail"->"修正细化";default->"待开始";};}
    private static String value(JsonObject o,String name,String fallback){var v=o.get(name);return v!=null&&v.isJsonPrimitive()?v.getAsString():fallback;}
    static String progress(JsonObject job){return job(job)?" · "+phase(value(job,"stageName",""))+" · 调用 "+value(job,"stage","0")+"/"+value(job.getAsJsonObject("preflight"),"maximumCalls","?"):"";}
    static String details(JsonObject job){
        if(!job(job))return "";
        int receipts=job.has("generations")&&job.get("generations").isJsonArray()?job.getAsJsonArray("generations").size():0;
        StringBuilder out=new StringBuilder("\n\n设计检查点 · 预算与阶段\n确认上限：").append(value(job.getAsJsonObject("preflight"),"maximumCalls","未知")).append(" 次底层模型调用\n已预留：").append(value(job,"checkpointCallsReserved","0")).append(" 次；返回结果回执：").append(receipts).append(" 次\n未收到回执不代表没有执行或没有计费；预留不会因失败退回或重发。");
        if(job.has("checkpointStages")&&job.get("checkpointStages").isJsonArray())for(var item:job.getAsJsonArray("checkpointStages")){
            if(!item.isJsonObject())continue;var s=item.getAsJsonObject();String state=switch(value(s,"state","")){case "reserved"->"已预留 / 等待结果";case "checking"->"本地检查中";case "checked"->"此阶段检查通过";case "rejected"->"此阶段未通过";case "failed"->"失败";case "cancelled"->"已取消";case "interrupted"->"已中断";default->"未知";};
            out.append("\n").append(value(s,"index","?")).append(". ").append(phase(value(s,"phase",""))).append("：").append(state);
            if(s.has("error")&&!s.get("error").isJsonNull())out.append("\n   ").append(value(s,"error",""));
            if(s.has("navigationFeedback")&&s.get("navigationFeedback").isJsonObject()){
                var n=s.getAsJsonObject("navigationFeedback");
                out.append("\n   从声明起点可达通道 ").append(value(n,"reachablePassages","?")).append("/").append(value(n,"passages","?"));
                out.append("；局部双向楼梯 ").append(value(n,"localTwoWayStairs","?")).append("/").append(value(n,"stairsChecked","?"));
                if(!"true".equals(value(n,"checksComplete","false")))out.append("；检查不完整，剩余结果未知");
                out.append("。局部通过不等于整楼通行或消防认证。");
            }
        }
        return out.append("\n中间稿不可建造或通过本地重检发布；只有完成细化且最终编译通过，才提供最终预览。通行警告仍需单独复核，编译不等于审美达标。").toString();
    }
    static String confirmation(JsonObject request,JsonObject policy){
        int calls=request.get("checkpointCalls").getAsInt();
        if(!policy.has("checkpoints")||policy.get("maximumCalls").getAsInt()!=calls)throw new IllegalArgumentException("配套未返回一致的检查点预算；未提交生成，请完整升级");
        return "实验设计检查点 · 最多 "+calls+" 次模型调用\n模型："+request.get("model").getAsString()+"\n\n完整体量 / 核心空间 / 代表模块 → 本地检查 → 整楼细化。\n几何纠错会自动使用这份已确认的调用预算，不是免费本地检查。布局无法通过或预算不足就停止，不交付粗稿。\n\n每次输出预算："+(policy.get("maxOutputTokens").isJsonNull()?"跟随 Agent / 模型配置；不固定 token 上限":policy.get("maxOutputTokens").getAsString()+" tokens")+"\n实际高度下限："+(policy.get("minimumHeight").isJsonNull()?"未识别明确数值，以描述为准":policy.get("minimumHeight").getAsString()+" 格（1 格≈1 米）")+"\n\n中间稿不可建造。完成细化且最终编译通过才可预览，不保证设计精致或通行已验证。\n取消、提供方失败、无效编辑或中断后不重试；已发生的调用可能计费。\n\n"+policy.get("warnings")+"\n\n确认将使用所选账户额度。返回或关闭不调用模型；原建筑和世界保留。";
    }
}
