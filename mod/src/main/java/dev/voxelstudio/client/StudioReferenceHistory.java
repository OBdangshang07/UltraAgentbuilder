package dev.voxelstudio.client;

import com.google.gson.*;
import java.util.Set;
import java.util.UUID;

/** Read-only ORIGINAL task identity, not a new-image SEND or text repair. */
final class StudioReferenceHistory {
    static boolean reference(JsonObject job){return job.has("referenceGeneration");}
    static boolean terminal(JsonObject job){return reference(job)&&job.has("state")&&Set.of("preview-ready","failed","cancelled","interrupted").contains(job.get("state").getAsString());}
    static String details(JsonObject job){
        if(!reference(job))return "";
        try{
            var reference=job.getAsJsonObject("referenceGeneration");var input=reference.getAsJsonObject("input");
            if(reference.get("version").getAsInt()!=1||input.get("version").getAsInt()!=1||!"JobReferenceInput".equals(ReferencePreparationReceipt.text(input,"format")))throw new IllegalArgumentException("Unsupported reference identity");
            String owner=ReferencePreparationReceipt.text(input,"ownerId"),preparation=ReferencePreparationReceipt.text(reference,"preparationHash"),binding=ReferencePreparationReceipt.text(input,"bindingHash");
            if(!UUID.fromString(owner).toString().equals(owner)||!preparation.matches("[a-f0-9]{64}")||!binding.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Invalid original reference identity");
            return "\n\n参考图原任务（只读）\n原准备 hash："+preparation+"\n原图片绑定 hash："+binding+"\n图像分析、纠错与建筑制作共用原确认预算。关闭页面或恢复本机草稿不会重发这个任务；结果未知时只查询原身份。\n此页显示原引用，不声称展示原图片或已验证识图质量。失败不会转成不带原图的文字修订。";
        }catch(Exception e){return "\n\n参考图原任务引用无效；原记录保留。未重发，也不提供纯文字替代修订。";}
    }
    private StudioReferenceHistory(){}
}
