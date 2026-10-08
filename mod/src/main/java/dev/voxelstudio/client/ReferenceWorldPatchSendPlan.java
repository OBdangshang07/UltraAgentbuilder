package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import java.util.List;
import static dev.voxelstudio.client.WorldPatchTaskReceipt.*;

/** Immutable UI handoff, not a submission, call reservation or placement grant.
 * Original joint pictures and capability cannot be replaced by a later page. */
record ReferenceWorldPatchSendPlan(JsonObject prepared,JsonObject frozen,JsonObject manifest,JsonObject capability) {
    ReferenceWorldPatchSendPlan {
        prepared=prepared.deepCopy();frozen=frozen.deepCopy();manifest=manifest.deepCopy();capability=capability.deepCopy();
        ReferenceWorldPatchTaskReceipt.verifyFrozen(prepared,ReferenceWorldPatchTaskReceipt.confirmation(prepared),frozen);
        var task=prepared.getAsJsonObject("task");var intent=task.getAsJsonObject("request").getAsJsonObject("intent");var disclosure=task.getAsJsonObject("disclosure");
        ReferenceWorldPatchTaskReceipt.verifyManifest(intent,manifest);ReferenceWorldPatchTaskReceipt.verifyCapability(intent,capability);
        same(disclosure.get("references"),manifest.get("references"));same(disclosure.get("referenceMode"),manifest.get("mode"));
        same(disclosure.get("imagePixels"),manifest.get("pixels"));same(disclosure.get("imageBytes"),manifest.get("bytes"));
        same(disclosure.get("imageCapability"),capability);same(frozen.get("referenceSetHash"),manifest.get("setHash"));
        same(frozen.get("runtimeHash"),capability.get("runtimeHash"));
        if(!text(frozen,"imageCapabilityHash").equals(ContextReceipt.jsonHash(capability)))throw new IllegalStateException("联合发送审核不能更换原图像能力");
    }
    @Override public JsonObject prepared(){return prepared.deepCopy();}
    @Override public JsonObject frozen(){return frozen.deepCopy();}
    @Override public JsonObject manifest(){return manifest.deepCopy();}
    @Override public JsonObject capability(){return capability.deepCopy();}
    JsonObject recipient(){return frozen.getAsJsonObject("recipient").deepCopy();}
    String runtimeFor(JsonObject current){
        // A GET advertisement is not new consent. Any changed effort list,
        // model, runtime or image capability requires preparing new content.
        same(capability,current);return text(frozen,"runtimeHash");
    }
    String details(){
        var out=new StringBuilder("独立联合发送审核。当前开发协议最多调用原模型 1 次，不自动重试；不是 Lite/Pro/Max/Ultra 完整设计流程。普通启动仍关闭该开发协议。\n\n")
            .append("模型：").append(recipient()).append("\n图片模式：").append(text(manifest,"mode"))
            .append("\n原图片组：").append(text(manifest,"setHash"));
        int n=0;for(var item:manifest.getAsJsonArray("references")){var image=item.getAsJsonObject();out.append("\n图片 ").append(++n).append("：").append(number(image,"width")).append("×").append(number(image,"height"))
            .append(" · ").append(image.get("annotation")).append("\nSHA256：").append(text(image,"sha256"));}
        out.append("\n\n这次会发送已审核的原图、标注、提示词、逐格 W、外层六邻接面及摘要。图片不会自动截图、读取外部 URL 或扩大 W−P。原路径、元数据、NBT、容器物品和桌面不会发送。\n\n")
            .append("先持久保存原引用，再保留并核验同一服务器快照，冻结准确图片，再独立发送一次。费用或结果未知不代表未调用，禁止重发。关闭、缩放或重开页面不会生成替代任务。\n\n")
            .append("生成后只查询原任务。原候选须重新核验原快照才能预览；世界写入仍需独立 BEFORE 和最终确认。\n\n")
            .append("原内容身份：").append(text(frozen,"capsuleId")).append("\n原输入：").append(text(frozen,"promptSha256"));
        var disclosure=prepared.getAsJsonObject("task").getAsJsonObject("disclosure");
        for(var k:List.of("context","edit","protected"))out.append("\n").append(k).append("：").append(disclosure.get(k));
        return out.toString();
    }
}
