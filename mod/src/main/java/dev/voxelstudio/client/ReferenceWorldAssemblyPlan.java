package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import static dev.voxelstudio.client.WorldPatchTaskReceipt.*;

/** Immutable full-budget handoff; construction does not claim or SEND. */
record ReferenceWorldAssemblyPlan(JsonObject reference,JsonObject manifest,JsonObject capability) {
    ReferenceWorldAssemblyPlan {
        reference=ReferenceWorldAssemblyReceipt.verifyReference(reference.deepCopy());manifest=manifest.deepCopy();capability=capability.deepCopy();
        var p=reference.getAsJsonObject("prepared");var g=reference.getAsJsonObject("request").getAsJsonObject("generation");
        ReferenceWorldAssemblyReceipt.images(p,manifest);ReferenceWorldAssemblyReceipt.capability(capability,g);same(p.getAsJsonObject("selected").get("capability"),capability);
    }
    @Override public JsonObject reference(){return reference.deepCopy();}
    @Override public JsonObject manifest(){return manifest.deepCopy();}
    @Override public JsonObject capability(){return capability.deepCopy();}
    JsonObject prepared(){return reference.getAsJsonObject("prepared").deepCopy();}
    JsonObject generation(){return reference.getAsJsonObject("request").getAsJsonObject("generation").deepCopy();}
    String details(){
        var p=prepared();return "参考图＋原选区 · 完整 "+text(p,"tier")+" 制作\n\n模型："+p.get("selected")+"\n最多 "+number(p,"maximumCalls")+" 次底层调用，共用同一预算（含识图、制作、纠错、恢复和复核）。未知请求只观察原任务，不重复计费。\n\n提示词：\n"+text(generation(),"prompt")
            +"\n\n参考方式："+text(manifest,"mode")+"\n准确原图和标注："+p.get("imageAnnotations")+"\n原图片组："+text(p,"referenceSetHash")
            +"\n原 C/W/保护区："+reference.get("selection")+"\n原快照："+text(p,"snapshotHash")+"\n原准备："+text(p,"preparationHash")
            +"\n\n将发送批准图片、标注、提示词、W 逐格方块、已捕获的六邻接面和环境摘要。不发送原文件路径、EXIF、NBT、容器物品、HUD、聊天、账号或桌面。\n\n先持久保存原 SEND，再核验同一服务器快照。关闭面板不取消已发出的任务；网络结果未知、重启或原 runtime 改变都不能重发。原位预览与最终整组放置仍须独立核验、fresh BEFORE 和一次明确世界确认；本确认不授权世界写入。";
    }
}
