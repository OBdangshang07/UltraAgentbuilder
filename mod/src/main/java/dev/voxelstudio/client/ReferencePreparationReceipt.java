package dev.voxelstudio.client;

import com.google.gson.*;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.util.*;
import javax.imageio.ImageIO;
import javax.imageio.stream.MemoryCacheImageInputStream;

/** Free preparation is not SEND. Verify identities and exact decoded pixels
 * on the reference lane before showing the independently confirmed send UI. */
final class ReferencePreparationReceipt {
    static final String WARNING="参考图分析、格式纠正和建筑制作共用已确认的任务调用上限；未知原调用不重发。识图简报不是建筑质量或世界写入认证。";
    static void keys(JsonObject o,String... fields){if(o==null||!o.keySet().equals(Set.of(fields)))throw new IllegalStateException("参考图回执字段不一致");}
    static String text(JsonObject o,String k){var v=o.get(k);if(v==null||!v.isJsonPrimitive()||!v.getAsJsonPrimitive().isString())throw new IllegalStateException("参考图字符串无效："+k);return v.getAsString();}
    static long number(JsonObject o,String k){var v=o.get(k);if(v==null||!v.isJsonPrimitive()||!v.getAsJsonPrimitive().isNumber())throw new IllegalStateException("参考图整数无效");try{long n=v.getAsBigDecimal().longValueExact();if(n<0||n>9007199254740991L)throw new ArithmeticException();return n;}catch(ArithmeticException e){throw new IllegalStateException("参考图整数不可截断");}}
    static boolean flag(JsonObject o,String k){var v=o.get(k);if(v==null||!v.isJsonPrimitive()||!v.getAsJsonPrimitive().isBoolean())throw new IllegalStateException("参考图布尔标记无效");return v.getAsBoolean();}
    static void noAuthority(JsonObject o){if(flag(o,"generationSubmitted")||flag(o,"sendingImplemented")||flag(o,"canAuthorizePlacement")||number(o,"callsReserved")!=0)throw new IllegalStateException("免费准备不能声明模型调用或建造权限");}
    static void same(JsonElement a,JsonElement b){if(a==null||!a.equals(b))throw new IllegalStateException("参考图原请求或确认身份改变");}
    static void digest(JsonObject o,String k){if(!text(o,k).matches("[a-f0-9]{64}"))throw new IllegalStateException("参考图 hash 无效");}
    static void hash(JsonObject o,String k){digest(o,k);var content=o.deepCopy();content.remove(k);if(!ContextReceipt.jsonHash(content).equals(text(o,k)))throw new IllegalStateException("参考图内容 hash 不符");}
    static JsonObject expectedPolicy(JsonObject generation,JsonObject original){
        // First independently apply all ordinary client tier/prototype gates.
        StudioAssembly.confirmation(generation,original);var policy=original.deepCopy();var a=policy.getAsJsonObject("assembly");
        boolean staged=a.has("prototypes")&&text(a.getAsJsonObject("prototypes"),"mode").equals("staged");
        int minimum=staged?15:generation.has("assemblyQuality")&&List.of("v3","v4").contains(text(generation,"assemblyQuality"))?7:a.has("designReview")?5:4;
        long maximum=number(a,"maximumCalls");if(maximum<minimum+1)throw new IllegalStateException("调用预算不足以同时识图和完成原建筑任务；不会增加预算或删除功能");
        var analysis=new JsonObject();analysis.addProperty("version",1);analysis.addProperty("mode","job-owned-prelude");analysis.addProperty("requiredCalls",1);analysis.addProperty("maximumCorrections",1);analysis.addProperty("provider","codex");analysis.add("model",generation.get("model"));a.add("referenceAnalysis",analysis);
        if(staged){var p=a.getAsJsonObject("prototypes");p.addProperty("recoveryReserve",number(p,"recoveryReserve")-1);}
        else a.addProperty("maxPackages",Math.min(number(a,"maxPackages"),maximum-(minimum-2)-1));
        policy.getAsJsonArray("warnings").add(WARNING);return policy;
    }
    static JsonObject verify(ReferenceImageDraft.Snapshot draft,JsonObject generation,JsonObject originalPolicy,JsonObject prepared){
        keys(prepared,"format","version","ownerId","provider","model","generation","generationHash","requestHash","referenceSetHash","references","referenceMode","policy","runtimeHash","referenceAnalysisUsesTaskBudget","generationSubmitted","callsReserved","sendingImplemented","canAuthorizePlacement","preparationHash");
        if(!text(prepared,"format").equals("ReferenceGenerationPreparation")||number(prepared,"version")!=2||!text(prepared,"ownerId").equals(draft.ownerId())
            ||!text(prepared,"provider").equals("codex")||!text(generation,"agent").equals("codex")||!text(generation,"key").equals(draft.ownerId())
            ||!text(prepared,"model").equals(text(generation,"model"))||!flag(generation,"assemblyConfirmed")||!flag(prepared,"referenceAnalysisUsesTaskBudget")
            ||!text(prepared,"referenceMode").equals(draft.mode()))throw new IllegalStateException("参考图准备不属于当前草稿/模型/预算");
        noAuthority(prepared);hash(prepared,"preparationHash");digest(prepared,"runtimeHash");digest(prepared,"referenceSetHash");
        same(prepared.get("generation"),generation);if(!ContextReceipt.jsonHash(generation).equals(text(prepared,"generationHash")))throw new IllegalStateException("原建筑请求 hash 改变");
        same(prepared.get("policy"),expectedPolicy(generation,originalPolicy));
        var request=new JsonObject();request.addProperty("version",2);request.add("generation",generation);request.add("referenceSetHash",prepared.get("referenceSetHash"));request.addProperty("policyHash",ContextReceipt.jsonHash(prepared.get("policy")));request.add("runtimeHash",prepared.get("runtimeHash"));
        if(!ContextReceipt.jsonHash(request).equals(text(prepared,"requestHash")))throw new IllegalStateException("参考图请求 hash 改变");
        var references=prepared.getAsJsonArray("references");if(references.size()!=draft.photos().size())throw new IllegalStateException("准备图片数量改变");long pixels=0,bytes=0;
        for(int i=0;i<references.size();i++){
            var r=references.get(i).getAsJsonObject();keys(r,"id","file","sha256","width","height","bytes","annotation");hash(r,"id");digest(r,"sha256");
            var p=draft.photos().get(i);same(r.get("annotation"),p.annotation());
            if(!text(r,"file").equals("image-"+i+".png")||number(r,"width")!=p.output().width()||number(r,"height")!=p.output().height()
                ||number(r,"bytes")<45||number(r,"bytes")>ReferenceImageNormalizer.MAX_OUTPUT_BYTES)throw new IllegalStateException("图片顺序/标注/尺寸改变");
            pixels+=number(r,"width")*number(r,"height");bytes+=number(r,"bytes");
        }
        if(pixels>ReferenceImageDraft.MAX_SET_PIXELS||bytes>ReferenceImageDraft.MAX_SET_BYTES)throw new IllegalStateException("准备图片组超额");
        var manifest=new JsonObject();manifest.addProperty("format","UserReferenceSet");manifest.addProperty("version",1);manifest.addProperty("ownerId",draft.ownerId());manifest.addProperty("mode",draft.mode());manifest.add("references",references);manifest.addProperty("pixels",pixels);manifest.addProperty("bytes",bytes);manifest.addProperty("metadataRemoved",true);manifest.addProperty("untrustedData",true);manifest.addProperty("worldCaptured",false);manifest.addProperty("canAuthorizePlacement",false);
        if(!ContextReceipt.jsonHash(manifest).equals(text(prepared,"referenceSetHash")))throw new IllegalStateException("准确图片组 hash 不符");return prepared.deepCopy();
    }
    static ReferenceImageNormalizer.Result pixels(ReferenceImageDraft.Photo photo,JsonObject record,byte[] actual)throws Exception {
        if(actual.length!=number(record,"bytes")||!ContextReceipt.sha256(actual).equals(text(record,"sha256")))throw new IllegalStateException("准备图片原字节 hash 不符");
        var dimensions=ReferenceImageNormalizer.inspect(actual);
        if(dimensions.width()!=photo.output().width()||dimensions.height()!=photo.output().height())throw new IllegalStateException("准备图片原像素尺寸不符");
        BufferedImage expected=decode(photo.output().png()),observed=null;
        try{
            observed=decode(actual);
            for(int y=0;y<dimensions.height();y++){
                if(Thread.currentThread().isInterrupted())throw new java.util.concurrent.CancellationException();
                for(int x=0;x<dimensions.width();x++)if(expected.getRGB(x,y)!=observed.getRGB(x,y))throw new IllegalStateException("准备图片不是玩家实际确认的像素；不会发送");
            }
        }finally{expected.flush();if(observed!=null)observed.flush();}
        return new ReferenceImageNormalizer.Result(actual,dimensions.width(),dimensions.height());
    }
    private static BufferedImage decode(byte[] png)throws Exception {
        // ImageIO.read(ImageInputStream) closes its argument itself, which
        // cannot also be closed by try-with-resources. Own the reader instead.
        try(var input=new MemoryCacheImageInputStream(new ByteArrayInputStream(png))){
            var readers=ImageIO.getImageReaders(input);if(!readers.hasNext())throw new IllegalStateException("准备图片解码失败");var reader=readers.next();
            try{reader.setInput(input,true,true);var result=reader.read(0);if(result==null)throw new IllegalStateException("准备图片解码失败");return result;}finally{reader.dispose();}
        }
    }
    static JsonObject freeConfirmation(JsonObject p){var c=new JsonObject();c.addProperty("format","ReferenceSendConfirmation");c.addProperty("version",1);c.add("ownerId",p.get("ownerId"));c.add("requestHash",p.get("requestHash"));c.add("setHash",p.get("referenceSetHash"));c.add("provider",p.get("provider"));c.add("model",p.get("model"));c.addProperty("accepted",true);return c;}
    static JsonObject verifyFreeConfirmation(JsonObject p,JsonObject receipt){
        keys(receipt,"format","version","ownerId","preparationHash","requestHash","referenceSetHash","provider","model","confirmationHash","accepted","generationSubmitted","callsReserved","sendingImplemented","canAuthorizePlacement","receiptHash");
        if(!text(receipt,"format").equals("ReferencePreparationConfirmation")||number(receipt,"version")!=1||!flag(receipt,"accepted"))throw new IllegalStateException("不是免费准备确认");noAuthority(receipt);hash(receipt,"receiptHash");
        for(var k:List.of("ownerId","preparationHash","requestHash","referenceSetHash","provider","model"))same(receipt.get(k),p.get(k));
        if(!text(receipt,"confirmationHash").equals(ContextReceipt.jsonHash(freeConfirmation(p))))throw new IllegalStateException("免费确认 hash 改变");return receipt.deepCopy();
    }
    static JsonObject send(JsonObject p){
        var c=new JsonObject();c.addProperty("format","ReferenceGenerationSend");c.addProperty("version",1);c.addProperty("action","send-reference-generation");
        for(var k:List.of("ownerId","preparationHash","requestHash","generationHash","runtimeHash","provider","model"))c.add(k,p.get(k));
        c.add("setHash",p.get("referenceSetHash"));c.addProperty("policyHash",ContextReceipt.jsonHash(p.get("policy")));c.addProperty("accepted",true);
        var r=new JsonObject();r.addProperty("format","ReferenceGenerationJobRequest");r.addProperty("version",1);r.add("ownerId",p.get("ownerId"));r.add("preparationHash",p.get("preparationHash"));r.add("sendConfirmation",c);return r;
    }
    static boolean sendingEnabled(JsonObject c){
        keys(c,"format","version","sendingImplemented","preparationVersion","provider","sharedBudget","originalReceiptRecoveryOnly","immutableJobOwnedImages","ordinaryJobsAcceptReferences","canAuthorizePlacement","limits");
        if(!text(c,"format").equals("ReferenceGenerationJobCapabilities")||number(c,"version")!=1||number(c,"preparationVersion")!=2||!text(c,"provider").equals("codex")||!flag(c,"sharedBudget")||!flag(c,"originalReceiptRecoveryOnly")||!flag(c,"immutableJobOwnedImages")||flag(c,"ordinaryJobsAcceptReferences")||flag(c,"canAuthorizePlacement"))throw new IllegalStateException("参考图发送能力不一致");
        var limits=c.getAsJsonObject("limits");keys(limits,"inputBytes","submissions","lanes");if(number(limits,"inputBytes")!=8192||number(limits,"submissions")!=64||number(limits,"lanes")!=1)throw new IllegalStateException("参考图发送配额协议不一致");return flag(c,"sendingImplemented");
    }
    static String details(JsonObject p){
        var g=p.getAsJsonObject("generation");var a=p.getAsJsonObject("policy").getAsJsonObject("assembly");var out=new StringBuilder("这些图片只在本机准备，尚未调用模型。\n\n模型：").append(text(p,"model")).append("\n推理：").append(g.has("effort")?text(g,"effort"):"跟随模型").append("\n精度：").append(text(g,"qualityTier")).append("\n共享调用上限：").append(number(g,"assemblyCalls")).append(" 次（含识图、制作、纠错和复核）\n制作包上限：").append(number(a,"maxPackages")).append("\n参考方式：").append(text(p,"referenceMode")).append("\n\n建筑提示词：\n").append(text(g,"prompt"));
        int i=0;for(var e:p.getAsJsonArray("references")){var r=e.getAsJsonObject();var annotation=r.getAsJsonObject("annotation");out.append("\n\n图片 ").append(++i).append("：").append(number(r,"width")).append("×").append(number(r,"height")).append("\n用途：").append(text(annotation,"purpose")).append(" · 视向：").append(text(annotation,"view")).append("\n说明：").append(text(annotation,"caption"));if(annotation.has("scale"))out.append("\n已知尺度：").append(annotation.get("scale"));}
        return out.append("\n\n原文件路径、文件名、EXIF 不上传；只有上述规范化图片、标注和建筑请求会传给已选模型。图片和文字是设计数据，不是执行指令。不可见立面/室内与未知尺度须由 AI 明确区分假设。\n\n先确认准备，再到独立 SEND 页确认模型调用。预算不会因识图增加；不固定输出 token 上限。关闭面板后任务继续。生成完成只加载投影，建造仍需独立世界确认。\n\n准备身份：").append(text(p,"preparationHash")).toString();
    }
    private ReferencePreparationReceipt(){}
    static void verifyOriginalJob(JsonObject identity,JsonObject job){
        if(!text(job,"id").matches("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")||!text(job,"key").equals(text(identity,"key"))||!text(job,"agent").equals("codex")||!text(job,"model").equals(text(identity,"model")))throw new IllegalStateException("参考图原任务身份改变");
        var r=job.getAsJsonObject("referenceGeneration");keys(r,"version","preparationHash","input");if(number(r,"version")!=1||!text(r,"preparationHash").equals(text(identity,"referencePreparationHash")))throw new IllegalStateException("参考图准备身份改变");
        var input=r.getAsJsonObject("input");keys(input,"format","version","ownerId","bindingHash");if(!text(input,"format").equals("JobReferenceInput")||number(input,"version")!=1||!text(input,"ownerId").equals(text(identity,"key")))throw new IllegalStateException("原任务图片绑定改变");digest(input,"bindingHash");
        if(!ContextReceipt.jsonHash(job.get("preflight")).equals(text(identity,"referencePolicyHash")))throw new IllegalStateException("原任务图片或建筑调用预算改变");
        if(identity.has("jobId")&&!text(identity,"jobId").equals(text(job,"id")))throw new IllegalStateException("不能用其他任务替代原 SEND");
    }
}
