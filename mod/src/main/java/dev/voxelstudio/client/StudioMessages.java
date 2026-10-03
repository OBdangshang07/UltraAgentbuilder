package dev.voxelstudio.client;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

final class StudioMessages {
    /** Presentation only. Static feedback never changes placement authority. */
    static String constructionFeedback(JsonObject owner) {
        if(owner==null||!owner.has("constructionFeedback")||!owner.get("constructionFeedback").isJsonObject())return "";
        var feedback=owner.getAsJsonObject("constructionFeedback");
        var out=new StringBuilder("\n\n构造静态检查（不调用模型）：");
        out.append(field(feedback,"issueCount","未知")).append(" 条问题记录；共享模板可能涉及多个使用位置。");
        if(!"true".equals(field(feedback,"checksComplete","false")))out.append("\n检查未完整执行，未列出的部分不能视为通过。");
        var issues=feedback.get("issues");int shown=0;
        if(issues!=null&&issues.isJsonArray())for(var element:issues.getAsJsonArray()){
            if(shown>=6)break;if(!element.isJsonObject())continue;var issue=element.getAsJsonObject();shown++;
            String kind=switch(field(issue,"code","")){
                case "component-bounds"->"构件越出场地";case "module-local-bounds","module-emitted-bounds"->"模块内部越界";
                case "room-zone-invalid"->"房间与宿主楼层不匹配";case "reservation-bounds"->"保留区域越界";
                case "coordinate-unresolved","reservation-unresolved"->"坐标依赖无法解析";default->"设计数据错误";
            };
            out.append("\n").append(shown).append(". ").append(kind).append(" · ").append(field(issue,"component",field(issue,"reservation","源数据")));
            if(issue.has("module"))out.append(" / ").append(field(issue,"module","?")).append(" / ").append(field(issue,"node","?"));
            if(issue.has("origin"))out.append("\n   位置 ").append(vector(issue.get("origin"))).append("；尺寸 ").append(vector(issue.get("size")));
            if(issue.has("bounds"))out.append("；边界 ").append(vector(issue.get("bounds")));
            if(issue.has("frame")&&issue.get("frame").isJsonObject()){
                var frame=issue.getAsJsonObject("frame");out.append("\n   宿主原点 ").append(vector(frame.get("parentOrigin"))).append(" + 锚点增量 ").append(vector(frame.get("anchorDelta"))).append(" + 局部偏移 ").append(vector(frame.get("offset")));
            }
            if(issue.has("message"))out.append("\n   ").append(field(issue,"message",""));
        }
        if("true".equals(field(feedback,"truncated","false"))||issues!=null&&issues.isJsonArray()&&issues.getAsJsonArray().size()>shown)out.append("\n此处仅显示部分记录；修订输入保留本次检查返回的完整记录。");
        return out.append("\n这些检查未证明可建造、可通行或设计精致；未自动移动、缩放或删除构件。").toString();
    }
    private static String field(JsonObject object,String key,String fallback){
        var value=object.get(key);if(value==null||!value.isJsonPrimitive())return fallback;
        String result=value.getAsString().replaceAll("[\\p{Cntrl}]"," ");return result.length()>240?result.substring(0,240)+"…":result;
    }
    private static String vector(JsonElement element){
        if(element==null||!element.isJsonArray()||element.getAsJsonArray().size()!=3)return "[未知]";
        var a=element.getAsJsonArray();for(var v:a)if(!v.isJsonPrimitive()||!v.getAsJsonPrimitive().isNumber())return "[未知]";
        String result=a.toString();return result.length()>80?"[未知]":result;
    }
    static String state(String value) {
        return switch(value) {
            case "queued"->"等待处理";case "recovering"->"自动恢复原任务 · 不重复已完成调用";case "generating"->"正在生成建筑";case "validating"->"校验与有限修复";
            case "compiling"->"正在本地编译与验证 · 不调用 AI";case "preview-ready"->"建筑已就绪";case "failed"->"生成失败";
            case "cancelled"->"已取消生成";case "interrupted"->"连接中断，未重复提交";default->value;
        };
    }
    static String effort(String value) {
        return switch(value) {case "none","off"->"不启用";case "minimal"->"最低";case "low"->"低";case "medium"->"中";case "high"->"高";case "xhigh"->"超高";case "max"->"最高";case "ultra"->"极高";case "default"->"模型默认";default->value;};
    }
    static String operation(String message) {
        if(message==null)return "未知状态";
        return switch(message) {
            case "Placement started; waiting for durable journal"->"建造准备中，正在保存撤销日志";
            case "Building"->"正在分批建造";
            case "Placement finished"->"建造完成";
            case "Undoing"->"正在撤销";
            case "Undo finished; subsequent edits preserved"->"撤销完成，已保留后续修改";
            case "Cancelled; completed batches remain undoable"->"已停止，完成的部分仍可撤销";
            case "Only the single-player creative host can build/undo"->"只有单人创造世界的主持人可建造或撤销";
            case "No placement journal", "No undoable placement in this dimension"->"当前维度没有可撤销的建造记录";
            default->message.startsWith("Stopped safely: ")?"操作已停止："+message.substring(16):message;
        };
    }
    static String error(Throwable e) {while(e.getCause()!=null)e=e.getCause();return String.valueOf(e.getMessage());}
    static String errorSummary(String details) {
        if(details.contains("[DSH:"))return details;
        if(details.contains("receipt unknown"))return "调用回执未知，已保存预算与进度；为避免重复计费没有重发";
        if(details.contains("Recovery ")||details.contains("recovery "))return "自动恢复校验未通过，原始证据保留；未重置预算或重新生成";
        if(details.contains("Assembly model-call budget")||details.contains("insufficient budget")||details.contains("remaining package call budget"))return "本次确认的制作额度不足；进度和调用账本保留，没有追加调用";
        if(details.contains("Assembly skeleton failed"))return "整体骨架在预算内纠正后仍未通过；尚未制作完整建筑，请查看阶段详情";
        if(details.contains("Required package "))return "必需组件在预算内纠正后仍未通过；已完成部分保留，半成品不会发布";
        if(details.contains("Stale/invalid")||details.contains("identity mismatch"))return "响应与当前建筑版本不一致；已停止，原稿保留";
        if(details.contains("Codex app-server disconnected")||details.contains("Bridge restarted"))return "连接中断，已保存的阶段和调用额度保留；未知结果不会自动重发";
        if(details.contains("Review contract remains invalid"))return "建筑已拼装，但复核响应仍不合格；保存稿保留，尚未发布成品";
        if(details.contains("max-tokens"))return "DeepSeek 输出达到预算，建筑未完整返回；请查看输出预算或两阶段生成选项";
        if(details.contains("请求高度")||details.contains("实际建筑高度")||details.contains("两阶段模式"))return details;
        if(details.contains("Passage needs valid"))return "通道高度/站立坐标不正确；需要地板上方至少 2 格净空";
        if(details.contains("Passage obstructed"))return "通道被遮挡或未明确清空；建筑尚未通过校验";
        if(details.contains("Passage missing floor"))return "通道缺少实体地板；建筑尚未通过校验";
        if(details.contains("disconnected"))return "地板或声明通道未通过连通检查；查看详情，旧失败可先在历史页本地重检";
        if(details.contains("Ownership conflict"))return "构件发生未声明的覆盖；详情会指出构件 ID 与坐标，原版保留";
        if(details.contains("Reserved space"))return "核心筒、通道或保留空间被其他构件占用；未自动挖掉它们";
        if(details.contains("approved scope")||details.contains("approved region")||details.contains("Protected component"))return "精修改动超过确认范围，已拒绝新版；原版未改变";
        if(details.contains("insufficient staircase"))return "楼梯预留空间不足；未缩放建筑或破坏立面";
        if(details.contains("outside scene or invalid size"))return "坐标或模块尺寸越界；查看详情中的宿主、偏移和边界，建筑未被裁剪";
        if(details.contains("roomZone"))return "房间范围、楼板高程或层高不匹配；查看详情，未自动改布局";
        if(details.contains("Selected model unavailable"))return "所选模型不在当前 Codex 目录中，请重新检测或检查 CLI 版本";
        if(details.contains("内置配套")||details.contains("Builtin"))return "内置配套准备失败，原文件保留；点击详情检查路径或校验错误";
        if(details.contains("Missing companion"))return "缺少运行配套，请使用包含内置配套的正式分发 JAR";
        if(details.contains("login")||details.contains("credential")||details.contains("authentication")||details.contains("not authenticated"))return "请先在所选 Agent 中登录或配置凭据";
        if(details.toLowerCase().contains("timed out")||details.toLowerCase().contains("timeout"))return "本机服务响应超时，可重连后查看任务状态";
        if(details.contains("CLI not found")||details.contains("not installed")||details.contains("ENOENT"))return "未找到所选 Agent；仍可加载不调用 AI 的示例";
        return "操作未完成，点击“详情”查看原因";
    }
}
