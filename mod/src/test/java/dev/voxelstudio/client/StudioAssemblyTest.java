package dev.voxelstudio.client;
import com.google.gson.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class StudioAssemblyTest {
    @Test void referenceProgressNamesAnalysisAndCorrectionWithoutCreatingNewBudget(){
        assertTrue(StudioAssembly.phase("reference-analysis").contains("识图分析"));
        assertTrue(StudioAssembly.phase("correct-reference-analysis").contains("原共享预算内"));
        var job=JsonParser.parseString("{\"preflight\":{\"maximumCalls\":26,\"assembly\":{}},\"stageName\":\"reference-analysis\",\"assemblyCallsReserved\":1}").getAsJsonObject();
        assertTrue(StudioAssembly.progress(job).contains("识图分析"));assertTrue(StudioAssembly.progress(job).contains("1/26"));
    }
    @Test void nodePrototypePoliciesMatchJavaConsentAndEveryStagedBudget()throws Exception{
        var fixtures=JsonParser.parseString(java.nio.file.Files.readString(java.nio.file.Path.of("build/test-fixtures/prototype-preflight.json"))).getAsJsonArray();
        assertEquals(6,fixtures.size());
        for(var fixture:fixtures){
            var f=fixture.getAsJsonObject();var r=f.getAsJsonObject("request");var p=f.getAsJsonObject("policy");int calls=r.get("assemblyCalls").getAsInt();String mode=r.get("assemblyPrototypes").getAsString();
            String text=StudioAssembly.confirmation(r,p);assertFalse(r.has("assemblyConfirmed"));assertFalse(r.has("maxOutputTokens"));assertTrue(text.contains("最多 "+calls+" 次"));
            if(mode.equals("staged")){
                int reserve=Math.min(10,calls-15);
                assertTrue(text.contains("制作任务上限："+(calls-11-reserve)));assertTrue(text.contains("3 次独立概念"));assertTrue(text.contains("4 次单角色原型"));assertTrue(text.contains("预留 "+reserve+" 次共享"));assertTrue(text.contains("包职责冻结后不会为重试删包"));
                var e=p.getAsJsonObject("assembly").getAsJsonObject("prototypes");
                assertTrue(text.contains("原型纠错 v4"));assertTrue(text.contains("2 次改稿 / 再复核预算"));assertTrue(text.contains("基础纠错和追加纠错均保留"));
                assertTrue(text.contains("分工校正 v1"));assertTrue(text.contains("当前复核接受后冻结制作范围"));assertTrue(text.contains("不增加模型预算或世界写入权限"));
                for(String key:java.util.List.of("version","mode","candidateCount","recoveryReserve","seedVisualGate","expandedVisualGate","expansionCalls","roleCorrections","designAllocation")){
                    var changed=p.deepCopy();changed.getAsJsonObject("assembly").getAsJsonObject("prototypes").remove(key);assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,changed));
                }
                for(String key:java.util.List.of("version","mode","reservedTailCorrections")){
                    var changed=p.deepCopy();changed.getAsJsonObject("assembly").getAsJsonObject("prototypes").getAsJsonObject("roleCorrections").remove(key);assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,changed));
                }
                var old=p.deepCopy();old.getAsJsonObject("assembly").getAsJsonObject("prototypes").addProperty("version",2);assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,old));
                var v3=p.deepCopy();v3.getAsJsonObject("assembly").getAsJsonObject("prototypes").addProperty("version",3);assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,v3));
                var legacyMode=p.deepCopy();legacyMode.getAsJsonObject("assembly").getAsJsonObject("prototypes").getAsJsonObject("roleCorrections").addProperty("mode","tail-funded");assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,legacyMode));
                var noTail=p.deepCopy();noTail.getAsJsonObject("assembly").getAsJsonObject("prototypes").getAsJsonObject("roleCorrections").addProperty("reservedTailCorrections",0);assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,noTail));
                e.addProperty("mode","verified");assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));e.addProperty("mode","staged");
                var changed=p.deepCopy();changed.getAsJsonObject("assembly").addProperty("maxPackages",16);assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,changed));
            }else{assertTrue(text.contains("制作任务上限：16"));assertFalse(text.contains("分阶段原型（实验）"));}
            r.addProperty("assemblyPrototypes",mode.equals("staged")?"verified":"staged");assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));
        }
    }
    @Test void allocationConsentRejectsLegacyPolicyAndUnboundedAuthority()throws Exception{
        var fixtures=JsonParser.parseString(java.nio.file.Files.readString(java.nio.file.Path.of("build/test-fixtures/prototype-preflight.json"))).getAsJsonArray();
        for(var fixture:fixtures){
            var f=fixture.getAsJsonObject();var r=f.getAsJsonObject("request");if(!"staged".equals(r.get("assemblyPrototypes").getAsString()))continue;
            var p=f.getAsJsonObject("policy");
            var old=p.deepCopy();old.getAsJsonObject("assembly").getAsJsonObject("prototypes").addProperty("version",4);
            assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,old));
            for(String key:java.util.List.of("version","mode")){
                var changed=p.deepCopy();changed.getAsJsonObject("assembly").getAsJsonObject("prototypes").getAsJsonObject("designAllocation").remove(key);
                assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,changed));
            }
            var unknown=p.deepCopy();unknown.getAsJsonObject("assembly").getAsJsonObject("prototypes").getAsJsonObject("designAllocation").addProperty("mode","unbounded");
            assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,unknown));
            var world=p.deepCopy();world.getAsJsonObject("assembly").getAsJsonObject("prototypes").getAsJsonObject("designAllocation").addProperty("worldAuthority",true);
            assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,world));
        }
    }
    @Test void stagedSelectionIsExplicitUltraOnlyAndNeverRaisesTheCallBudget(){
        for(int calls=22;calls<=26;calls++){
            var r=object("{\"model\":\"offline-vision\"}");StudioAssembly.configure(r,"ultra",calls);r.addProperty("assemblyQuality","v4");r.addProperty("assemblyDesignReview","native");
            StudioAssembly.configurePrototypes(r,"staged");assertEquals("staged",r.get("assemblyPrototypes").getAsString());assertEquals(calls,r.get("assemblyCalls").getAsInt());assertFalse(r.has("assemblyConfirmed"));
            StudioAssembly.configurePrototypes(r,"off");assertFalse(r.has("assemblyPrototypes"));
        }
        for(int calls:new int[]{0,5,21,27})assertThrows(IllegalArgumentException.class,()->StudioAssembly.stagedPackageLimit(calls));
        for(String tier:new String[]{"lite","pro","max"}){
            var r=object("{\"model\":\"offline-vision\"}");StudioAssembly.configure(r,tier,StudioAssembly.tier(tier).maximumCalls());r.addProperty("assemblyQuality","v4");r.addProperty("assemblyDesignReview","native");
            assertThrows(IllegalArgumentException.class,()->StudioAssembly.configurePrototypes(r,"staged"));assertFalse(r.has("assemblyPrototypes"));
        }
    }
    @Test void stagedProgressNamesEveryNewPhaseAndNeverCertifiesQualityByRoleCount(){
        for(String phase:new String[]{"concept-candidate","correct-concept-candidate","assembly-blueprint","correct-assembly-blueprint","prototype-role","correct-prototype-role"})assertNotEquals("待开始",StudioAssembly.phase(phase));
        var job=object("{\"preflight\":{\"maximumCalls\":26,\"assembly\":{\"id\":\"ultra\",\"prototypes\":{\"mode\":\"staged\"}}},\"assemblyCallsReserved\":19,\"assemblySummary\":{\"decomposition\":{\"requiredRoleStagesAccepted\":4}}}");
        String text=StudioAssembly.details(job);assertTrue(text.contains("4 / 4"));assertTrue(text.contains("不是完整内饰 / 核心筒设计质量认证"));assertTrue(text.contains("未完成组件的中间稿不可建造"));
    }
    @Test void verifiedPrototypesRequireExplicitMatchingConsentAcrossAllTiersWithoutAddingCalls(){
        for(var t:StudioAssembly.tiers()){
            var r=object("{\"model\":\"offline-vision\"}");StudioAssembly.configure(r,t.id(),t.maximumCalls());
            assertThrows(IllegalArgumentException.class,()->StudioAssembly.configurePrototypes(r,true));
            r.addProperty("assemblyQuality","v4");r.addProperty("assemblyDesignReview","native");StudioAssembly.configurePrototypes(r,true);
            var p=policy(t,t.maximumCalls());var a=p.getAsJsonObject("assembly");a.addProperty("maxPackages",Math.min(t.maxPackages(),t.maximumCalls()-5));a.addProperty("visualReview",true);a.getAsJsonObject("designReview").addProperty("mode","native");
            var q=object("{\"version\":4,\"prototypeReview\":true,\"coordinatedRefinement\":true,\"newBuildingOnly\":true,\"renderedConcepts\":true,\"pairedRevisionReview\":true,\"structuredFindings\":true,\"strategy\":{}}");q.addProperty("maximumConceptCorrections",t.maximumPlanCorrections());
            var strategy=q.getAsJsonObject("strategy");strategy.addProperty("alternatives",t.id().equals("lite")?1:t.id().equals("ultra")?3:2);strategy.addProperty("nativeViews",t.id().equals("lite")?4:t.id().equals("pro")?6:8);a.add("quality",q);
            assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));
            var e=object("{\"version\":1,\"mode\":\"verified\",\"newBuildingOnly\":true,\"seedVisualGate\":true,\"expandedVisualGate\":true,\"expansionCalls\":0}");a.add("prototypes",e);
            String text=StudioAssembly.confirmation(r,p);assertTrue(text.contains("展开本身 0 次模型调用"));assertTrue(text.contains("种子不是最终成品"));assertTrue(text.contains("不是世界写入授权"));assertEquals(t.maximumCalls(),r.get("assemblyCalls").getAsInt());
            e.addProperty("expansionCalls",1);assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));e.addProperty("expansionCalls",0);
            e.addProperty("seedVisualGate",false);assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));e.addProperty("seedVisualGate",true);
            e.addProperty("expandedVisualGate",false);assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));e.addProperty("expandedVisualGate",true);
            StudioAssembly.configurePrototypes(r,false);assertFalse(r.has("assemblyPrototypes"));assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));a.remove("prototypes");assertFalse(StudioAssembly.confirmation(r,p).contains("真实原型："));
        }
    }
    @Test void allFourTiersMatchV3AndV4CandidateCorrectionsAndExplicitComparisonAuthority(){
        for(var t:StudioAssembly.tiers())for(int version:new int[]{3,4}){
            int calls=t.maximumCalls();var r=object("{\"model\":\"offline-vision\"}");StudioAssembly.configure(r,t.id(),calls);r.addProperty("assemblyQuality","v"+version);r.addProperty("assemblyDesignReview","native");
            var p=policy(t,calls);var a=p.getAsJsonObject("assembly");a.addProperty("maxPackages",Math.min(t.maxPackages(),calls-5));a.addProperty("visualReview",true);a.getAsJsonObject("designReview").addProperty("mode","native");
            var q=object("{\"prototypeReview\":true,\"coordinatedRefinement\":true,\"newBuildingOnly\":true,\"renderedConcepts\":true,\"strategy\":{}}");q.addProperty("version",version);q.addProperty("maximumConceptCorrections",t.maximumPlanCorrections());
            var strategy=q.getAsJsonObject("strategy");strategy.addProperty("alternatives",t.id().equals("lite")?1:t.id().equals("ultra")?3:2);strategy.addProperty("nativeViews",t.id().equals("lite")?4:t.id().equals("pro")?6:8);
            if(version==4){q.addProperty("pairedRevisionReview",true);q.addProperty("structuredFindings",true);}a.add("quality",q);
            String text=StudioAssembly.confirmation(r,p);assertTrue(text.contains("最多 "+t.maximumPlanCorrections()+" 次候选几何纠正"));assertTrue(text.contains("不是额外额度"));
            if(version==4){assertTrue(text.contains("固定相机的前后原生图对照"));assertTrue(text.contains("不把概念草稿当成品"));q.remove("pairedRevisionReview");assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));q.addProperty("pairedRevisionReview",true);}
            else{q.addProperty("structuredFindings",true);assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));q.remove("structuredFindings");}
            q.addProperty("maximumConceptCorrections",t.maximumPlanCorrections()+1);assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));
        }
    }
    @Test void renderedConceptsRequireExplicitV3NativeBudgetAndMatchingCandidateStrategy(){
        var t=StudioAssembly.tier("lite");var r=object("{\"model\":\"offline-vision\"}");StudioAssembly.configure(r,t.id(),7);var p=policy(t,7);var a=p.getAsJsonObject("assembly");
        r.addProperty("assemblyQuality","v3");r.addProperty("assemblyDesignReview","native");a.addProperty("maxPackages",2);a.addProperty("visualReview",true);a.getAsJsonObject("designReview").addProperty("mode","native");
        var q=object("{\"version\":3,\"prototypeReview\":true,\"coordinatedRefinement\":true,\"newBuildingOnly\":true,\"renderedConcepts\":true,\"maximumConceptCorrections\":1,\"strategy\":{\"alternatives\":1,\"nativeViews\":4}}");a.add("quality",q);
        String text=StudioAssembly.confirmation(r,p);assertTrue(text.contains("自动选案"));assertTrue(text.contains("最多 7 次"));assertTrue(text.contains("不是额外额度"));assertTrue(text.contains("制作任务上限：2"));
        q.getAsJsonObject("strategy").addProperty("alternatives",3);assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));q.getAsJsonObject("strategy").addProperty("alternatives",1);
        r.addProperty("assemblyQuality","v2");assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));r.addProperty("assemblyQuality","v3");
        r.addProperty("assemblyDesignReview","text");assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));r.addProperty("assemblyDesignReview","native");
        q.remove("renderedConcepts");assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));assertTrue(StudioAssembly.phase("select-concept").contains("自动选案"));
    }
    private JsonObject object(String value){return JsonParser.parseString(value).getAsJsonObject();}
    private JsonObject policy(StudioAssembly.Tier t,int calls){
        var p=object("{\"minimumHeight\":224,\"maxOutputTokens\":null,\"warnings\":[]}");p.addProperty("maximumCalls",calls);
        var a=new JsonObject();a.addProperty("id",t.id());a.addProperty("maximumCalls",calls);a.addProperty("maxPackages",Math.min(t.maxPackages(),calls-3));a.addProperty("reviewRounds",t.reviewRounds());a.addProperty("maximumPlanCorrections",t.maximumPlanCorrections());a.addProperty("maximumComponentCorrections",t.maximumComponentCorrections());a.addProperty("visualReview",false);a.addProperty("intermediateAssetsPlaceable",false);a.addProperty("maximumFormatCorrections",1);
        var d=object("{\"version\":2,\"mode\":\"text\",\"budgetedExtensions\":true,\"budgetedCorrections\":true,\"candidateCorrections\":true}");d.addProperty("maximumRevisions",java.util.List.of("max","ultra").contains(t.id())?2:1);a.add("designReview",d);a.add("recovery",object("{\"version\":1,\"mode\":\"safe\",\"unknownOutcomeRetries\":0}"));a.add("componentCorrection",object("{\"version\":1,\"budgetedExtensions\":true}"));p.add("assembly",a);return p;
    }
    @Test void sharedContractAndRequestsPreserveSizeAndDoNotAuthorizeCalls(){
        assertEquals(4,StudioAssembly.tiers().size());
        for(var t:StudioAssembly.tiers()){
            var r=object("{\"sample\":false,\"prompt\":\"224米写字楼\",\"assemblyConfirmed\":true}");StudioAssembly.configure(r,t.id(),t.maximumCalls());
            assertFalse(r.has("sample"));assertFalse(r.has("assemblyConfirmed"));assertFalse(r.has("maxOutputTokens"));assertEquals("224米写字楼",r.get("prompt").getAsString());assertEquals("scene",r.get("generationMode").getAsString());assertEquals("components",r.get("sceneWorkflow").getAsString());assertEquals(0,r.get("maxRepairs").getAsInt());
        }
        assertThrows(IllegalArgumentException.class,()->StudioAssembly.configure(new JsonObject(),"lite",4));assertThrows(IllegalArgumentException.class,()->StudioAssembly.configure(new JsonObject(),"lite",26));
        for(String value:new String[]{"{\"sample\":true}","{\"baseJobId\":\"old\"}","{\"checkpointCalls\":2}"})assertThrows(IllegalArgumentException.class,()->StudioAssembly.configure(object(value),"lite",4));
    }
    @Test void confirmationUsesTotalCallsNotRoundsAndRejectsStaleRuntime(){
        for(var t:StudioAssembly.tiers()){
            var r=object("{\"model\":\"offline\"}");StudioAssembly.configure(r,t.id(),5);var p=policy(t,5);String text=StudioAssembly.confirmation(r,p);
            assertTrue(text.contains("最多 5 次"));assertTrue(text.contains("制作任务上限：2"));assertTrue(text.contains("不设固定上限"));assertTrue(text.contains("返回或关闭不调用模型"));assertTrue(text.contains("没有图像复核"));
            assertTrue(text.contains("最多 1 次预算内格式纠正"));assertTrue(text.contains("可能计费"));
            p.getAsJsonObject("assembly").addProperty("reviewRounds",99);assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));
        }
    }
    @Test void ledgerReportsUnknownCallsAndUnreviewedFinalChangesHonestly(){
        var job=object("{\"stageName\":\"refine-component\",\"assemblyCallsReserved\":5,\"generations\":[{},{}],\"assemblySummary\":{\"stopReason\":\"review-budget\",\"reviewRounds\":1,\"finalTextReviewCurrent\":false,\"finalTextReviewAccepted\":false,\"unresolvedReviewIssues\":[{\"criterion\":\"立面\",\"evidence\":\"过平\",\"change\":\"调整窗深\"}]}}");job.add("preflight",policy(StudioAssembly.tier("lite"),8));
        assertTrue(StudioAssembly.job(job));assertTrue(StudioAssembly.progress(job).contains("5/8"));String text=StudioAssembly.details(job);assertTrue(text.contains("回执：2"));assertTrue(text.contains("未计费"));assertTrue(text.contains("尚未再次文本复核"));assertTrue(text.contains("调整窗深"));assertTrue(text.contains("不代表审美最优"));assertEquals("",StudioAssembly.details(new JsonObject()));
    }
    @Test void optionalRefinementStopsAreNotReportedAsBudgetExhaustionOrReviewAcceptance(){
        for(String reason:new String[]{"refinement-cycle-previous-preserved","candidate-no-progress-previous-preserved","candidate-regressed-previous-preserved"}){
            var job=object("{\"assemblySummary\":{\"stopReason\":\""+reason+"\",\"reviewRounds\":3,\"finalTextReviewCurrent\":true,\"finalTextReviewAccepted\":false,\"unresolvedReviewIssues\":[{\"criterion\":\"通行\",\"evidence\":\"半格楼梯未模拟\",\"change\":\"检查预览\"}]}}");
            job.add("preflight",policy(StudioAssembly.tier("ultra"),26));String text=StudioAssembly.details(job);
            assertTrue(text.contains("完整建筑及待确认问题"));assertTrue(text.contains("文本意见未全部复核通过"));assertTrue(text.contains("半格楼梯未模拟"));
            assertFalse(text.contains("预算已到上限"));assertFalse(text.contains("尚未再次文本复核"));assertTrue(text.contains("通行警告与世界建造仍需单独确认"));
        }
    }
    @Test void imageModeRequiresMatchingPreflightAndClearlyDisclosesSimplifiedAssetViews(){
        var t=StudioAssembly.tier("ultra");var r=object("{\"model\":\"offline-vision\"}");StudioAssembly.configure(r,t.id(),26);r.addProperty("assemblyDesignReview","images");var p=policy(t,26);
        assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));
        p.getAsJsonObject("assembly").getAsJsonObject("designReview").addProperty("mode","images");p.getAsJsonObject("assembly").addProperty("visualReview",true);
        String text=StudioAssembly.confirmation(r,p);assertTrue(text.contains("四张专用几何图"));assertTrue(text.contains("不是游戏材质截图"));assertTrue(text.contains("不额外加预算"));
        assertEquals("冻结前整体 / 代表原型复核",StudioAssembly.phase("concept-review"));
    }
    @Test void oldFourCallRequestsRemainReadableButCannotAcquireNewReviewAuthority(){
        var t=StudioAssembly.tier("lite");var r=object("{\"model\":\"offline\",\"qualityTier\":\"lite\",\"assemblyCalls\":4}");var p=policy(t,4);
        assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));p.getAsJsonObject("assembly").remove("designReview");p.getAsJsonObject("assembly").remove("recovery");p.getAsJsonObject("assembly").remove("componentCorrection");p.getAsJsonObject("assembly").addProperty("maxPackages",2);
        assertTrue(StudioAssembly.confirmation(r,p).contains("旧版总纲"));
    }
    @Test void budgetedConceptExtensionsAreDisclosedAndRequireMatchingRuntime(){
        var t=StudioAssembly.tier("ultra");var r=object("{\"model\":\"offline\"}");StudioAssembly.configure(r,t.id(),26);var p=policy(t,26);
        String text=StudioAssembly.confirmation(r,p);assertTrue(text.contains("保留当前全部制作包、复核和纠错余量"));assertTrue(text.contains("不保证一定有余量"));assertFalse(text.contains("整体改稿最多 2 次"));
        var d=p.getAsJsonObject("assembly").getAsJsonObject("designReview");d.remove("budgetedExtensions");assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));
        d.addProperty("budgetedExtensions",true);d.addProperty("version",1);assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));
        r.remove("assemblyRecovery");p.getAsJsonObject("assembly").remove("recovery");assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));
        d.remove("budgetedExtensions");d.remove("budgetedCorrections");d.remove("candidateCorrections");p.getAsJsonObject("assembly").remove("componentCorrection");assertTrue(StudioAssembly.confirmation(r,p).contains("整体改稿最多 2 次"));
    }
    @Test void componentBudgetExtensionsAreExplicitAndCannotBeSilentlyAdded(){
        var t=StudioAssembly.tier("ultra");var r=object("{\"model\":\"offline\"}");StudioAssembly.configure(r,t.id(),26);var p=policy(t,26);
        String text=StudioAssembly.confirmation(r,p);assertTrue(text.contains("必需组件基础纠错 2 次"));assertTrue(text.contains("共享余量不是每包额度保证"));assertTrue(text.contains("候选重复则停止"));
        var a=p.getAsJsonObject("assembly");var c=a.remove("componentCorrection");assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));
        a.add("componentCorrection",c);c.getAsJsonObject().addProperty("budgetedExtensions",false);assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));
        c.getAsJsonObject().addProperty("budgetedExtensions",true);c.getAsJsonObject().addProperty("version",2);assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));
    }
    @Test void designCorrectionExtensionsMustPreserveNextConceptReviewAndBeConfirmed(){
        var t=StudioAssembly.tier("ultra");var r=object("{\"model\":\"offline\"}");StudioAssembly.configure(r,t.id(),26);var p=policy(t,26);
        assertTrue(StudioAssembly.confirmation(r,p).contains("下一次整体复核、最终复核及纠错余量"));
        p.getAsJsonObject("assembly").getAsJsonObject("designReview").remove("budgetedCorrections");assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));
    }
    @Test void candidateCorrectionDoesNotApproveRejectedGeometryAndRequiresMatchingRuntime(){
        var t=StudioAssembly.tier("ultra");var r=object("{\"model\":\"offline\"}");StudioAssembly.configure(r,t.id(),26);var p=policy(t,26);
        assertTrue(StudioAssembly.confirmation(r,p).contains("不是批准失败稿"));
        p.getAsJsonObject("assembly").getAsJsonObject("designReview").remove("candidateCorrections");assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));
    }
    @Test void nativeQualityConsentCannotBeAddedByRuntimeAndDisclosesAssetOnlyCapture(){
        var t=StudioAssembly.tier("ultra");var r=object("{\"model\":\"offline-vision\"}");StudioAssembly.configure(r,t.id(),26);var p=policy(t,26);
        var q=object("{\"version\":2,\"prototypeReview\":true,\"coordinatedRefinement\":true,\"newBuildingOnly\":true}");p.getAsJsonObject("assembly").add("quality",q);
        assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));
        r.addProperty("assemblyQuality","v2");r.addProperty("assemblyDesignReview","native");p.getAsJsonObject("assembly").getAsJsonObject("designReview").addProperty("mode","native");p.getAsJsonObject("assembly").addProperty("visualReview",true);
        String text=StudioAssembly.confirmation(r,p);assertTrue(text.contains("4–8 张"));assertTrue(text.contains("不会读取世界"));assertTrue(text.contains("保留全局接口"));assertTrue(text.contains("最多 26 次"));assertTrue(text.contains("不额外加预算"));
        q.addProperty("newBuildingOnly",false);assertThrows(IllegalArgumentException.class,()->StudioAssembly.confirmation(r,p));
    }
}
