package dev.voxelstudio.client;

import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Shared tier contract; all model calls still require explicit Bridge preflight and confirmation. */
final class StudioAssembly {
    record Tier(String id,int maxPackages,int reviewRounds,int maximumCalls,int maximumPlanCorrections,int maximumComponentCorrections,String description) {}
    private static final List<Tier> TIERS=load();
    private static List<Tier> load(){
        try(var stream=StudioAssembly.class.getResourceAsStream("/voxelstudio-bundle/contracts/quality-tiers.json")){
            if(stream==null)throw new IOException("Missing quality-tier contract; install the complete mod");
            var root=JsonParser.parseReader(new InputStreamReader(stream,StandardCharsets.UTF_8)).getAsJsonObject();
            if(root.get("version").getAsInt()!=1)throw new IOException("Unsupported quality-tier contract");
            List<Tier> result=new ArrayList<>();
            for(var item:root.getAsJsonArray("tiers")){var t=item.getAsJsonObject();result.add(new Tier(t.get("id").getAsString(),t.get("maxPackages").getAsInt(),t.get("reviewRounds").getAsInt(),t.get("maximumCalls").getAsInt(),t.get("maximumPlanCorrections").getAsInt(),t.get("maximumComponentCorrections").getAsInt(),t.get("description").getAsString()));}
            if(!result.stream().map(Tier::id).toList().equals(List.of("lite","pro","max","ultra")))throw new IOException("Invalid tier catalog");
            return List.copyOf(result);
        }catch(Exception e){throw new IllegalStateException("Cannot read bundled quality tiers",e);}
    }
    static List<Tier> tiers(){return TIERS;}
    static Tier tier(String id){return TIERS.stream().filter(t->t.id().equals(id)).findFirst().orElseThrow(()->new IllegalArgumentException("未知制作档位"));}
    static boolean job(JsonObject job){return job.has("preflight")&&job.get("preflight").isJsonObject()&&job.getAsJsonObject("preflight").has("assembly");}
    static void configure(JsonObject request,String id,int calls){
        var t=tier(id);if(calls<5||calls>t.maximumCalls())throw new IllegalArgumentException("设计优先组件流程至少 5 次调用：总纲、整体复核、两个制作包和最终复核");
        for(String key:List.of("baseJobId","repairJobId","checkpointCalls","checkpointConfirmed","spec","scenePatch","patch","importDirectory","reviewImages"))if(request.has(key))throw new IllegalArgumentException("组件化只用于单独确认的新设计");
        if(request.has("sample")&&request.get("sample").getAsBoolean())throw new IllegalArgumentException("示例不调用组件模型");
        request.remove("sample");request.addProperty("generationMode","scene");request.addProperty("sceneWorkflow","components");request.addProperty("qualityTier",id);request.addProperty("assemblyCalls",calls);request.addProperty("maxRepairs",0);request.addProperty("assemblyDesignReview","text");request.addProperty("assemblyRecovery","safe");request.remove("assemblyConfirmed");
    }
    private static String value(JsonObject o,String key,String fallback){var v=o.get(key);return v!=null&&v.isJsonPrimitive()?v.getAsString():fallback;}
    static void configurePrototypes(JsonObject request,boolean selected){
        configurePrototypes(request,selected?"verified":"off");
    }
    static int stagedPackageLimit(int calls){
        if(calls<22||calls>26)throw new IllegalArgumentException("分阶段原型仅支持 Ultra，需明确确认 22–26 次总预算；未提交");
        // Three candidates + selection + blueprint + four roles + seed and final
        // reviews = 11 mandatory calls. New v4 reserves correction + re-review
        // before EVERY role attempt, not just extended corrections.
        return calls-11-stagedRecoveryReserve(calls);
    }
    static int stagedRecoveryReserve(int calls){return Math.min(10,calls-15);}
    static String stagedBudgetSummary(int calls){
        if(calls<22||calls>26)return "需明确选择 Ultra 和 22–26 次总预算，当前 "+calls+" 次不适用";
        return calls+" 次总预算：最多 "+stagedPackageLimit(calls)+" 个制作任务，预留 "+stagedRecoveryReserve(calls)+" 次共享纠错 / 改稿 / 必要再复核，全部计入总预算";
    }
    static void configurePrototypes(JsonObject request,String mode){
        if("off".equals(mode)){request.remove("assemblyPrototypes");return;}
        if(!List.of("verified","staged").contains(mode))throw new IllegalArgumentException("未知原型流程；未提交");
        if(!"v4".equals(value(request,"assemblyQuality",""))||!"native".equals(value(request,"assemblyDesignReview",""))||!"safe".equals(value(request,"assemblyRecovery","")))throw new IllegalArgumentException("原型展开需要质量 v4、原生图像复核和安全恢复");
        if("staged".equals(mode)){
            if(!"ultra".equals(value(request,"qualityTier","")))throw new IllegalArgumentException("分阶段原型目前仅支持明确选择的 Ultra；未提交");
            stagedPackageLimit(request.get("assemblyCalls").getAsInt());
        }
        request.addProperty("assemblyPrototypes",mode);
    }
    static String phase(String phase){return switch(phase){
        case "reference-analysis"->"识图分析 · 提取建筑设计简报";
        case "correct-reference-analysis"->"修正识图分析响应（原共享预算内）";
        case "concept-candidate"->"制作独立概念候选";case "correct-concept-candidate"->"修正独立概念候选";case "assembly-blueprint"->"结构与职责蓝图（差量）";case "correct-blueprint","correct-assembly-blueprint"->"修正结构与职责蓝图";case "prototype-role"->"制作单角色原型 / 展开预检";case "correct-prototype-role"->"修正本角色原型 / 展开预检";case "concepts"->"制作轻量设计候选";case "correct-concepts"->"修正设计候选";case "select-concept"->"原生图片比较 / 自动选案";case "plan"->"整体设计与空间骨架";case "concept-review"->"冻结前整体 / 代表原型复核";case "correct-concept-review"->"修正整体复核响应";case "revise-design"->"整体协调改稿（尚未冻结）";case "correct-design"->"修正整体改稿错误";case "repair-plan"->"修正总纲结构契约";case "correct-plan"->"修正总纲几何";case "component"->"制作组件";case "correct-component"->"修正组件";case "review"->"最终设计与工程复核";case "correct-review"->"修正复核响应";case "refine-component"->"定向精修组件";case "refine-coordinated"->"批准制作包内协调精修";default->"待开始";
    };}
    static String progress(JsonObject job){return job(job)?" · "+phase(value(job,"stageName",""))+" · 已预留 "+value(job,"assemblyCallsReserved","0")+"/"+value(job.getAsJsonObject("preflight"),"maximumCalls","?"):"";}
    static String details(JsonObject job){
        if(!job(job))return "";
        var p=job.getAsJsonObject("preflight");var a=p.getAsJsonObject("assembly");int receipts=job.has("generations")&&job.get("generations").isJsonArray()?job.getAsJsonArray("generations").size():0;
        var out=new StringBuilder("\n\n组件化制作 · ").append(value(a,"id","未知")).append("\n确认上限：").append(value(p,"maximumCalls","?")).append(" 次底层模型调用\n已预留：").append(value(job,"assemblyCallsReserved","0")).append(" 次；调用回执：").append(receipts).append(" 次\n回执缺失不代表未执行或未计费；失败调用不退还预算；只有确定收到的可修复响应可在预算内纠正，未知结果不重发。");
        if(a.has("quality"))out.append("\n质量 v").append(value(a.getAsJsonObject("quality"),"version","?")).append("：代表原型与空间证据；跨包精修仅限已批准范围。");
        if(a.has("prototypes")){
            if("staged".equals(value(a.getAsJsonObject("prototypes"),"mode","")))out.append("\n分阶段原型（实验）：3 次独立概念 → 自动选案 → 差量蓝图 → 4 次单角色原型 → 种子看图复核 → 0 调用展开 → 全部深化包 → 整楼终审。纠错 / 改稿 / 再复核仍占同一预算。");
            else out.append("\n已选择真实原型制作：种子 → 所有实例几何预检 → 种子看图复核 → 显式展开 → 整栋制作；不是直接放置原型。");
        }
        if(job.has("nativeEvidence"))out.append("\n原生证据：").append(value(job.getAsJsonObject("nativeEvidence"),"state","unknown")).append(" · ").append(StudioNativeEvidence.status());
        if(job.has("assemblyStages"))for(var item:job.getAsJsonArray("assemblyStages")){
            var s=item.getAsJsonObject();String state=switch(value(s,"state","")){case "reserved"->"已预留 / 等待结果";case "checking"->"本地校验中";case "accepted"->"此阶段已采纳";case "rejected"->"候选被拒绝";case "failed"->"失败";case "interrupted"->"中断";case "cancelled"->"取消";default->"未知";};
            out.append("\n").append(value(s,"index","?")).append(". ").append(phase(value(s,"phase",""))).append(" ").append(value(s,"task","")).append("：").append(state);
            if(s.has("formatCorrectionOf"))out.append("（格式纠正，原调用 ").append(value(s,"formatCorrectionOf","?")).append("）");
            if(s.has("error")&&!s.get("error").isJsonNull())out.append("\n   ").append(value(s,"error",""));
        }
        if(job.has("assemblySummary")){
            var s=job.getAsJsonObject("assemblySummary");String stop=switch(value(s,"stopReason","")){case "text-review-accepted"->"文本复核接受，可提前结束";case "native-image-review-accepted"->"原生图像与文本复核接受，可提前结束";case "geometry-image-review-accepted"->"几何图与文本复核接受，可提前结束";case "candidate-rejected-previous-preserved"->"精修候选未通过，保留上一合格拼装稿";case "refinement-cycle-previous-preserved"->"精修重复回到已复核几何，停止循环并保留完整建筑及待确认问题";case "candidate-regressed-previous-preserved"->"精修外观退步，保留上一已复核完整建筑及待确认问题";case "candidate-no-progress-previous-preserved"->"精修未改变实际方块，保留已复核完整建筑及待确认问题";case "revision-budget"->"调用预算已用完";default->"复核轮数或调用预算已到上限";};
            if(s.has("conceptSelection"))out.append("\n原生图比较已选方案：").append(value(s.getAsJsonObject("conceptSelection"),"selected","未知")).append("；候选不是可放置成品。");
            if(s.has("decomposition"))out.append("\n分阶段角色已采纳：").append(value(s.getAsJsonObject("decomposition"),"requiredRoleStagesAccepted","0")).append(" / 4；职责、源存活及展开验证不是完整内饰 / 核心筒设计质量认证。");
            if(s.has("prototypeExpansion"))out.append("\n原型已通过种子看图复核并按明确参数展开（0 次新增模型调用）；此转换不代表展开后的整栋外观已通过。");
            out.append("\n\n结束原因：").append(stop).append("\n已完成文本复核：").append(value(s,"reviewRounds","0")).append(" 轮");
            if(!"true".equals(value(s,"finalTextReviewCurrent","false")))out.append("\n最终版本已作修改，尚未再次文本复核。");
            if(!"true".equals(value(s,"finalTextReviewAccepted","false")))out.append("\n文本意见未全部复核通过；请检查成品。");
            if(s.has("conceptReview")){var c=s.getAsJsonObject("conceptReview");out.append("\n冻结前整体方案：").append("accept".equals(value(c,"verdict",""))?"复核接受":"未接受").append("（").append("native".equals(value(c,"mode",""))?"原生材质与代表切层":"images".equals(value(c,"mode",""))?"几何四视图":"仅文本").append("）。此结论不代表后续成品已通过。");}
            boolean nativeReview=s.has("finalVisualReview")&&s.get("finalVisualReview").isJsonObject()&&List.of("native-asset","native-revision").contains(value(s.getAsJsonObject("finalVisualReview"),"kind",""));
            if(nativeReview){
                out.append("\n已发送原生方块材质与代表切层图；只含建筑资产，不含游戏世界。中性预览不模拟光影包或真实光照传播。");
                out.append("true".equals(value(s,"visualReviewAccepted","false"))?"\n当前版本原生图像复核接受；不保证审美或全楼通行。":"\n当前原生图像意见未全部通过，或修改后未再次看图。");
            }else if("true".equals(value(s,"visualReview","false"))){
                out.append("\n已发送四视角几何图进行复核；近似颜色 / 完整格占用，不是游戏材质截图。");
                out.append("true".equals(value(s,"visualReviewAccepted","false"))?"\n当前版本几何图复核接受，仍不保证设计质量。":"\n当前版本图像意见尚未全部通过，或修改后未再次看图。");
                out.append("\n室内图像、原版材质与特殊方块精确外形尚未视觉验收。");
            }
            if(s.has("unresolvedReviewIssues"))for(var issue:s.getAsJsonArray("unresolvedReviewIssues")){var i=issue.getAsJsonObject();out.append("\n待确认：").append(value(i,"criterion","")).append(" · ").append(value(i,"evidence","")).append(" → ").append(value(i,"change",""));}
        }
        boolean seen=job.has("assemblySummary")&&"true".equals(value(job.getAsJsonObject("assemblySummary"),"visualReview","false"));
        return out.append(seen?"\n\n图像反馈不是审美认证；":"\n\n没有最终图像审美复核；").append("保留最后技术合格版本，不代表审美最优。未完成组件的中间稿不可建造、导出或通过本地重检发布。通行警告与世界建造仍需单独确认。").toString();
    }
    static String confirmation(JsonObject request,JsonObject policy){
        var t=tier(request.get("qualityTier").getAsString());int calls=request.get("assemblyCalls").getAsInt();
        var a=policy.getAsJsonObject("assembly");
        // The experimental API contract is not selectable in this player UI
        // yet. Do not let a changed companion or restored request silently
        // grant capacity retries under the existing zero-retry consent text.
        var retries=a==null?null:a.get("providerRetries");
        if(request.has("assemblyProviderRecovery")||a!=null&&a.has("providerRecovery")||
            retries!=null&&(!retries.isJsonPrimitive()||!retries.getAsJsonPrimitive().isNumber()||retries.getAsDouble()!=0))
            throw new IllegalArgumentException("本版界面尚未支持明确确认容量恢复；未提交，请勿复用旧确认");
        boolean recovery="safe".equals(value(request,"assemblyRecovery",""));
        if(recovery){
            if(a==null||!a.has("recovery"))throw new IllegalArgumentException("配套不支持安全自动恢复，请完整升级");
            var r=a.getAsJsonObject("recovery");
            if(!"1".equals(value(r,"version",""))||!"safe".equals(value(r,"mode",""))||!"0".equals(value(r,"unknownOutcomeRetries","")))throw new IllegalArgumentException("自动恢复权限不一致");
        }else if(a!=null&&a.has("recovery"))throw new IllegalArgumentException("配套擅自增加自动恢复权限");
        if(recovery){
            if(!a.has("componentCorrection")||!a.get("componentCorrection").isJsonObject())throw new IllegalArgumentException("配套不支持预算内组件纠错，请完整升级");
            var c=a.getAsJsonObject("componentCorrection");
            if(!"1".equals(value(c,"version",""))||!"true".equals(value(c,"budgetedExtensions","")))throw new IllegalArgumentException("组件纠错预算策略不一致，请完整升级");
        }else if(a!=null&&a.has("componentCorrection"))throw new IllegalArgumentException("配套擅自增加未确认的组件纠错权限");
        String mode=value(request,"assemblyDesignReview","");boolean design=!mode.isEmpty(),nativeImages=mode.equals("native"),images=mode.equals("images")||nativeImages;int overhead=design?3:2;
        String qualityName=value(request,"assemblyQuality","");boolean quality=List.of("v2","v3","v4").contains(qualityName),concepts=List.of("v3","v4").contains(qualityName);
        if(!qualityName.isEmpty()&&!quality)throw new IllegalArgumentException("未知质量协议，未提交");
        boolean prototypes=request.has("assemblyPrototypes"),staged="staged".equals(value(request,"assemblyPrototypes",""));
        if(prototypes){
            if(!List.of("verified","staged").contains(value(request,"assemblyPrototypes",""))||!qualityName.equals("v4")||!nativeImages||!recovery||a==null||!a.has("prototypes")||!a.get("prototypes").isJsonObject())throw new IllegalArgumentException("原型展开选择 / 配套协议不一致");
            var e=a.getAsJsonObject("prototypes");
            if(!(staged?"5":"1").equals(value(e,"version",""))||!value(request,"assemblyPrototypes","").equals(value(e,"mode",""))||!"true".equals(value(e,"newBuildingOnly",""))||!"true".equals(value(e,"seedVisualGate",""))||!"true".equals(value(e,"expandedVisualGate",""))||!"0".equals(value(e,"expansionCalls","")))throw new IllegalArgumentException("原型展开权限 / 整楼实图复核 / 调用策略不一致，请完整升级");
            if(staged){
                stagedPackageLimit(calls);
                if(!"ultra".equals(t.id())||!"3".equals(value(e,"candidateCount",""))||!Integer.toString(stagedRecoveryReserve(calls)).equals(value(e,"recoveryReserve","")))throw new IllegalArgumentException("分阶段原型职责 / 预算策略不一致");
                if(!e.has("roleCorrections")||!e.get("roleCorrections").isJsonObject())throw new IllegalArgumentException("配套缺少新版原型纠错策略，请完整升级");
                var roleCorrections=e.getAsJsonObject("roleCorrections");
                if(roleCorrections.size()!=3||!"2".equals(value(roleCorrections,"version",""))||!"tail-funded-through-review".equals(value(roleCorrections,"mode",""))||!"2".equals(value(roleCorrections,"reservedTailCorrections","")))throw new IllegalArgumentException("每次原型制作及纠错必须保留完整尾程及两次改稿 / 再复核预算");
                if(!e.has("designAllocation")||!e.get("designAllocation").isJsonObject())throw new IllegalArgumentException("配套缺少概念阶段分工校正策略，请完整升级");
                var allocation=e.getAsJsonObject("designAllocation");
                if(allocation.size()!=2||!"1".equals(value(allocation,"version",""))||!"pre-freeze-purpose-regions".equals(value(allocation,"mode","")))throw new IllegalArgumentException("概念阶段分工校正权限不一致");
                stagedPackageLimit(calls);
            }else if(e.has("candidateCount")||e.has("recoveryReserve")||e.has("roleCorrections")||e.has("designAllocation"))throw new IllegalArgumentException("旧原型协议不能增加分阶段调用权限");
        }else if(a!=null&&a.has("prototypes"))throw new IllegalArgumentException("配套增加了未选择的原型展开权限");
        if(concepts){overhead=5;if(!nativeImages||!recovery)throw new IllegalArgumentException("质量 v3 / v4 需要原生候选比较与安全恢复");}
        if(quality){
            if(a==null||!a.has("quality"))throw new IllegalArgumentException("配套不支持所选质量版本");var q=a.getAsJsonObject("quality");
            if(!qualityName.substring(1).equals(value(q,"version",""))||!"true".equals(value(q,"prototypeReview",""))||!"true".equals(value(q,"coordinatedRefinement",""))||!"true".equals(value(q,"newBuildingOnly","")))throw new IllegalArgumentException("质量版本权限不一致");
            if(qualityName.equals("v4")&&(!"true".equals(value(q,"pairedRevisionReview",""))||!"true".equals(value(q,"structuredFindings",""))))throw new IllegalArgumentException("配套缺少修改前后对照 / 分项复核协议");
            if(!qualityName.equals("v4")&&(q.has("pairedRevisionReview")||q.has("structuredFindings")))throw new IllegalArgumentException("配套增加了未选择的 v4 复核权限");
            if(concepts){
                if(!"true".equals(value(q,"renderedConcepts",""))||!Integer.toString(t.maximumPlanCorrections()).equals(value(q,"maximumConceptCorrections",""))||!q.has("strategy"))throw new IllegalArgumentException("候选制作协议不一致");
                var strategy=q.getAsJsonObject("strategy");int alternatives=t.id().equals("lite")?1:t.id().equals("ultra")?3:2,views=t.id().equals("lite")?4:t.id().equals("pro")?6:8;
                if(!Integer.toString(alternatives).equals(value(strategy,"alternatives",""))||!Integer.toString(views).equals(value(strategy,"nativeViews","")))throw new IllegalArgumentException("候选数量 / 采图策略不一致");
            }else if(q.has("renderedConcepts")||q.has("maximumConceptCorrections"))throw new IllegalArgumentException("配套增加了未确认的候选调用权限");
        }else if(a!=null&&a.has("quality")||nativeImages)throw new IllegalArgumentException("配套增加了未确认的质量 / 图像权限");
        if(design){
            if(!List.of("text","images","native").contains(mode)||a==null||!a.has("designReview"))throw new IllegalArgumentException("整体设计复核协议不一致，请完整升级");
            var d=a.getAsJsonObject("designReview");int revisions=List.of("max","ultra").contains(t.id())?2:1;
            if(!(recovery?"2":"1").equals(value(d,"version",""))||!mode.equals(value(d,"mode",""))||!Integer.toString(revisions).equals(value(d,"maximumRevisions",""))||(recovery?!"true".equals(value(d,"budgetedExtensions",""))||!"true".equals(value(d,"budgetedCorrections",""))||!"true".equals(value(d,"candidateCorrections","")):d.has("budgetedExtensions")||d.has("budgetedCorrections")||d.has("candidateCorrections")))throw new IllegalArgumentException("整体设计复核模式 / 预算内改稿策略不一致，请完整升级");
        }else if(a!=null&&a.has("designReview"))throw new IllegalArgumentException("配套擅自增加了未确认的整体复核");
        if(a==null||!"1".equals(value(a,"maximumFormatCorrections","")))throw new IllegalArgumentException("格式纠正策略不一致，请完整升级模组与配套");
        if(!String.valueOf(t.maximumPlanCorrections()).equals(value(a,"maximumPlanCorrections",""))||!String.valueOf(t.maximumComponentCorrections()).equals(value(a,"maximumComponentCorrections","")))throw new IllegalArgumentException("总纲 / 组件纠正策略不一致，请完整升级");
        int packages=staged?stagedPackageLimit(calls):Math.min(t.maxPackages(),calls-overhead);
        if(calls<(concepts?7:design?5:4)||calls>t.maximumCalls()||a==null||!t.id().equals(value(a,"id",""))||policy.get("maximumCalls").getAsInt()!=calls||a.get("maximumCalls").getAsInt()!=calls||a.get("reviewRounds").getAsInt()!=t.reviewRounds()||a.get("maxPackages").getAsInt()!=packages||!Boolean.toString(images).equals(value(a,"visualReview",""))||!"false".equals(value(a,"intermediateAssetsPlaceable","")))throw new IllegalArgumentException("配套返回的档位 / 预算不一致，未提交；请完整升级");
        String reviewMode=nativeImages?"原生图像复核：按档位把 4–8 张本任务建筑专用的原生方块材质图发送给所选模型，包含外观、入口、代表楼层与剖面。不会读取世界、玩家、界面、桌面。使用当前客户端方块材质、中性光照；不模拟光影包或真实光照传播。关闭面板可继续采集。"
            : images
            ? "图像复核：把本任务编译资产的四张专用几何图发送给所选模型；不含世界、玩家、界面或桌面。近似颜色、玻璃不透明、半砖等按整格显示，不是游戏材质截图；不验证精确内饰。"
            : "仅文本复核：没有图像复核，不会宣称模型看过建筑。";
        return "档位："+t.id()+" · 最多 "+calls+" 次底层模型调用\n模型："+request.get("model").getAsString()+"\n制作任务上限："+packages+"；最终复核上限："+t.reviewRounds()+" 轮\n\n"+t.description()
            +(quality?"\n\n质量 "+qualityName+"：概念阶段核对代表立面、典型空间、入口和特殊层；最终可对复核明确涉及的多个制作包一起精修。只在这些包原批准范围/构件内协调，保留全局接口、保护空间和未选构件；不是对已有建筑或世界的写入授权。":"")
            +(staged?"\n分阶段原型（实验）：3 次独立概念 → 自动选案 → 差量蓝图 → 4 次单角色原型 → 种子看图复核 → 0 调用展开 → "+packages+" 个深化包上限 → 整楼终审。基础路径最多 "+(11+packages)+" 次，预留 "+stagedRecoveryReserve(calls)+" 次共享纠错 / 改稿及必要再复核；全部计入本次总预算，不是额外额度。合并调用批次不减少组件精度或必需职责；包职责冻结后不会为重试删包或缩小功能。":concepts?"\n先制作 1 / 2 / 2 / 3 个轻量几何候选（对应 lite / pro / max / ultra），再把 4–8 张明确标识候选的原生图送给模型自动选案，不要求玩家中途选择。候选制作、自动选案、最多 "+t.maximumPlanCorrections()+" 次候选几何纠正都占上述总预算；不是额外额度。无效或重复候选会排除并记录；保留完整内饰与核心筒的后续制作。":"")
            +(qualityName.equals("v4")?"\n修改后使用固定相机的前后原生图对照，分项核对上轮问题与设计取舍。可选精修被判为退步时保留上一完整已复核稿及原意见，不把概念草稿当成品，也不把未解决问题改记通过。":"")
            +(prototypes?"\n真实原型：先制作典型空间 / 立面 / 入口 / 特殊层样板；所有展开实例先完整几何预检，再以完整展开建筑的实际原生图复核，接受后才冻结制作范围。改稿仍绑定原种子及明确展开参数。展开本身 0 次模型调用；制作、纠错和看图复核仍在原总预算内。种子不是最终成品，此阶段不代表精修成品或通行已验证，不是世界写入授权。":"")
            +(staged?"\n原型纠错 v4：每次原型制作、基础纠错和追加纠错均保留全部后续原型、深化包、展开整楼复核、整楼终审及 2 次改稿 / 再复核预算；基础纠错 "+t.maximumComponentCorrections()+" 次，超出后仅使用本任务余量。不会升级旧任务、重置次数或重发未知调用。":"")
            +(staged?"\n分工校正 v1：概念接受前可明确调整包用途及增加 / 合并工作范围，核对全部原型展开格；保留原工作范围、组件归属、依赖、通行职责和保护空间。当前复核接受后冻结制作范围，后续组件不能再扩权；不增加模型预算或世界写入权限。":"")
            +"\n\n"+(design?"可见整体方案 → 整体复核 / 协调改稿 → 冻结权限 → 组件制作 → 最终复核。"+(recovery?"基础改稿按 "+(List.of("max","ultra").contains(t.id())?2:1)+" 轮规划；之后仅在原总预算足以保留当前全部制作包、复核和纠错余量时自动追加改稿，不保证一定有余量。":"整体改稿最多 "+(List.of("max","ultra").contains(t.id())?2:1)+" 次，必须在原预算内留足每个包与最终复核。")+"未接受的整体方案不会冒充成品。":"旧版总纲 → 分组件制作 → 校验拼装 → 文本复核 / 精修。")
            +"\n\n"+reviewMode+"\n编译合格不是设计质量合格；复核后再修改会使旧结论失效。更高档位不保证审美超越或每次成功。"
            +"\n\n总纲结构 / 几何纠正上限："+t.maximumPlanCorrections()+" 次；可选精修的几何纠正上限："+t.maximumComponentCorrections()+" 次；每轮概念 / 最终复核响应契约纠正最多 1 次。"
            +(design&&recovery?"\n整体改稿基础几何纠错 "+t.maximumComponentCorrections()+" 次；超出后仍须保留当前全部制作包、下一次整体复核、最终复核及纠错余量才可追加。":"\n每轮整体改稿纠正上限："+t.maximumComponentCorrections()+" 次。")
            +(design&&recovery?"\n结构合法的未通过改稿采用候选小补丁：保留未改部分，但完整合并稿仍按原要求重新校验并再次复核；不是批准失败稿。":"")
            +(recovery?"\n必需组件基础纠错 "+t.maximumComponentCorrections()+" 次；之后仅在剩余额度保留后续全部组件、最终复核及共享纠错余量时追加。共享余量不是每包额度保证；候选重复则停止，不放宽几何或权限。":"\n每个必需组件纠正上限："+t.maximumComponentCorrections()+" 次。")
            +"\n总纲、整体复核、改稿、组件、纠错、最终复核、精修均消耗上述总额度，均可能计费；不额外加预算，不要求花满。低预算可能无法完成，不会缩小建筑或删掉功能交差。"
            +"\n\n完整响应的 JSON 格式错误：全任务最多 1 次预算内格式纠正，另占一次调用且可能计费；保留原文。不补全截断内容，不绕过几何和权限校验。"
            +"\n\n输出 tokens："+(policy.get("maxOutputTokens").isJsonNull()?"跟随 Agent / 模型，不设固定上限":policy.get("maxOutputTokens").getAsString()+" / 每次")
            +(recovery?"\n\n安全自动恢复：配套重启后复用已保存的完整响应、重做校验，再继续原任务剩余阶段；不重复已派发调用，不重置预算，不更换模型。关闭面板不暂停任务；取消后不自动恢复。程序版本变化、回执未知或证据损坏时安全停止。":"")
            +"\n\n未完成中间稿不可建造。截断、结果未知、提供方错误或哈希不符后停止，不重发；越权候选不采纳。确认前返回或关闭不调用模型；原建筑和世界保留。";
    }
}
