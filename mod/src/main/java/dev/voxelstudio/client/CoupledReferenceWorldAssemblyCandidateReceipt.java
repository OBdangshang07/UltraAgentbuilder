package dev.voxelstudio.client;

import com.google.gson.*;
import dev.voxelstudio.selection.*;
import java.nio.*;
import java.nio.charset.*;
import java.util.*;
import java.util.function.BooleanSupplier;
import static dev.voxelstudio.client.WorldPatchTaskReceipt.*;

/** Exact-file new v1 transport only. No old Whole, single-patch candidate,
 * regenerated native asset, baseline attestation or world writer is created. */
final class CoupledReferenceWorldAssemblyCandidateReceipt {
    static final int METADATA_BYTES=AssemblyLimits.partEnvelopeBytes(),PART_BYTES=AssemblyLimits.partEnvelopeBytes();
    static final long DOWNLOAD_BYTES=AssemblyLimits.downloadBytes();
    private static final int CELLS_BYTES=Math.toIntExact(SelectionLimits.editCells()*2);
    static final class Budget {
        private long bytes;
        void add(int size){if(size<1||(bytes+=size)>DOWNLOAD_BYTES)throw new IllegalStateException("原完整下载字节超额；不采用部分成果");}
        long bytes(){return bytes;}
    }
    static final class Metadata {
        private final JsonObject candidate;private final CoupledAssemblyBinding binding;private final byte[] manifest,plan;
        private Metadata(JsonObject c,CoupledAssemblyBinding b,byte[] m,byte[] p){candidate=c.deepCopy();binding=b;manifest=m;plan=p;}
        int partCount(){return binding.partHashes().size();}String candidateHash(){return binding.candidateHash();}
        CoupledAssemblyBinding binding(){return binding;}JsonObject candidate(){return candidate.deepCopy();}
    }
    static final class Part {
        private final Metadata metadata;private final CoupledAssemblyInput.Part input;
        private Part(Metadata m,int index,byte[] part,byte[] preview){metadata=m;input=new CoupledAssemblyInput.Part(m.binding,index,part,preview);}
        boolean partIsApplyScope(){return false;}boolean canAuthorizePlacement(){return false;}
    }
    static final class Whole {
        private final CoupledAssemblyInput input;
        private Whole(CoupledAssemblyInput input){this.input=input;}
        CoupledAssemblyInput worldInput(){return input;}
        boolean completeSetTransport(){return true;}boolean currentWorldVerified(){return false;}boolean canAuthorizePlacement(){return false;}
    }
    private static void allowed(BooleanSupplier cancelled){Objects.requireNonNull(cancelled);if(cancelled.getAsBoolean()||Thread.currentThread().isInterrupted())throw new java.util.concurrent.CancellationException("原成组下载已取消；不采用部分成果");}
    private static void bounded(JsonObject value,int maximum,BooleanSupplier cancelled){
        allowed(cancelled);
        // Shared byte counting only, never the legacy receipt/consent parser.
        if(ReferenceWorldAssemblyCandidateReceipt.transmittedBytes(value)>maximum)throw new IllegalStateException("原完整回执超额");allowed(cancelled);
    }
    private static void kind(JsonObject value,String format){if(!text(value,"format").equals(format)||number(value,"version")!=1||!text(value,"purpose").equals(CoupledReferenceWorldAssemblyReceipt.PURPOSE))throw new IllegalStateException("新成组传输协议改变");}
    private static void hash(JsonObject value,String key){digest(value,key);var content=value.deepCopy();content.remove(key);if(!ContextReceipt.jsonHash(content).equals(text(value,key)))throw new IllegalStateException("原成组内容 hash 改变");}
    private static void yes(JsonObject value,String... keys){for(var key:keys)if(!flag(value,key))throw new IllegalStateException("原成组证据不完整");}
    private static void zero(JsonObject value,String... keys){for(var key:keys)if(number(value,key)!=0)throw new IllegalStateException("下载不能生成模型调用或世界写入");}
    private static void common(Metadata metadata,JsonObject value,String format){
        kind(value,format);same(value.get("preparationHash"),metadata.candidate.get("preparationHash"));same(value.get("candidateHash"),metadata.candidate.get("candidateHash"));
        yes(value,"completeSetVerified");no(value,"partIsApplyScope","canAuthorizePlacement","serverBaselineVerified");zero(value,"additionalModelCalls","worldWrites");
    }
    private static byte[] payload(JsonObject file,String path,int maximum,String encoding,BooleanSupplier cancelled){
        allowed(cancelled);keys(file,"path","bytes","sha256","encoding","data");digest(file,"sha256");
        long size=number(file,"bytes");if(!text(file,"path").equals(path)||!text(file,"encoding").equals(encoding)||size<1||size>maximum)throw new IllegalStateException("原文件身份/编码/配额改变");
        String data=text(file,"data");byte[] bytes;
        try{
            if(encoding.equals("utf8")){
                if(data.length()>maximum)throw new IllegalStateException("原 UTF-8 文件超额");
                var encoded=StandardCharsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).encode(CharBuffer.wrap(data));
                bytes=new byte[encoded.remaining()];encoded.get(bytes);
            }else{
                if(data.length()>((long)maximum+2)/3*4)throw new IllegalStateException("原二进制文件超额");bytes=Base64.getDecoder().decode(data);
                if(!Base64.getEncoder().encodeToString(bytes).equals(data))throw new IllegalStateException("原二进制编码不是准确 canonical base64");
            }
        }catch(CharacterCodingException|IllegalArgumentException error){throw new IllegalStateException("原文件编码无效；不替换原始字节",error);}
        if(bytes.length!=size||!ContextReceipt.sha256(bytes).equals(text(file,"sha256")))throw new IllegalStateException("原文件实际字节/hash 改变");allowed(cancelled);return bytes;
    }
    private static JsonObject json(byte[] bytes,BooleanSupplier cancelled){
        allowed(cancelled);try{
            String value=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
            return WorldPatchCandidateReceipt.strictJson(value,cancelled).getAsJsonObject();
        }catch(CharacterCodingException error){throw new IllegalStateException("原文件不是准确 UTF-8",error);}
    }
    private static String name(String kind,int index){return kind+"-"+String.format(Locale.ROOT,"%03d",index)+".json";}
    private static void pin(JsonObject candidate,String name,byte[] bytes){
        JsonObject found=null;for(var item:candidate.getAsJsonArray("files")){var p=item.getAsJsonObject();if(text(p,"path").equals(name)){if(found!=null)throw new IllegalStateException("原文件 pin 重复");found=p;}}
        if(found==null||number(found,"bytes")!=bytes.length||!text(found,"sha256").equals(ContextReceipt.sha256(bytes)))throw new IllegalStateException("原文件不在准确完整候选中");
    }
    private static void pins(JsonObject candidate,JsonObject generation,JsonObject prepared,int count,BooleanSupplier cancelled){
        var expected=new HashSet<String>(Set.of("records.json","native-manifest.json","cells.bin","coupling-plan.json","patch-set.json"));
        for(int i=0;i<count;i++){expected.add(name("part",i));expected.add(name("preview",i));}
        for(boolean proof:new boolean[]{false,true}){
            var values=candidate.getAsJsonArray(proof?"proofFiles":"files");if(values==null||values.isEmpty()||values.size()>(proof?4096:5+2*SelectionLimits.assemblyParts()))throw new IllegalStateException("原完整文件清单缺失/超额");
            var names=new HashSet<String>();long total=0;boolean capacity=generation.has("assemblyProviderRecovery")&&text(generation,"assemblyProviderRecovery").equals("bounded")&&number(prepared,"providerRetries")==2;
            for(var value:values){allowed(cancelled);var p=value.getAsJsonObject();keys(p,"path","bytes","sha256");String path=text(p,"path");digest(p,"sha256");
                if(path.length()>2048||path.startsWith("/")||path.contains("\\")||path.contains(":")||Arrays.stream(path.split("/",-1)).anyMatch(s->s.isEmpty()||s.equals(".")||s.equals("..")||!s.matches("[A-Za-z0-9._-]+"))||!names.add(path))throw new IllegalStateException("原文件清单路径无效/重复");
                long bytes=number(p,"bytes"),maximum=proof?64L*1024*1024:path.equals("records.json")?AssemblyLimits.recordsBytes():path.equals("cells.bin")?CELLS_BYTES:AssemblyLimits.partBytes();
                boolean empty=proof&&capacity&&bytes==0&&path.matches("codex-response-[-\\w]{1,96}/answer-1\\.txt")&&text(p,"sha256").equals(ContextReceipt.sha256(new byte[0]));
                if(bytes<1&&!empty||bytes>maximum||(total+=bytes)>(proof?512L*1024*1024:AssemblyLimits.candidateBytes()))throw new IllegalStateException("原文件清单总量或单项超额");
            }
            if(!proof&&!names.equals(expected)||proof&&!names.containsAll(Set.of("_owner.json","request.json","original-dispatch.json","original-execution-start.json")))throw new IllegalStateException("原注册归属或完整分片文件遗漏");
        }
    }
    static Metadata metadata(JsonObject original,JsonObject finalStatus,JsonObject envelope,BooleanSupplier cancelled){
        bounded(envelope,METADATA_BYTES,cancelled);var r=CoupledReferenceWorldAssemblyReceipt.verifyReference(original.deepCopy());
        var status=CoupledReferenceWorldAssemblyReceipt.status(r,finalStatus.deepCopy());if(!text(status,"state").equals("preview-ready"))throw new IllegalStateException("原成组任务尚未完成");
        keys(envelope,"format","version","purpose","preparationHash","candidateHash","completeSetVerified","partIsApplyScope","canAuthorizePlacement","serverBaselineVerified","additionalModelCalls","worldWrites","candidate","files");
        kind(envelope,"CoupledReferenceWorldAssemblyCandidateMetadata");yes(envelope,"completeSetVerified");no(envelope,"partIsApplyScope","canAuthorizePlacement","serverBaselineVerified");zero(envelope,"additionalModelCalls","worldWrites");
        var c=envelope.getAsJsonObject("candidate");var p=r.getAsJsonObject("prepared");bounded(c,AssemblyLimits.metadataBytes(),cancelled);
        keys(c,"format","version","purpose","jobId","preparationHash","requestHash","archiveHash","runtimeHash","referenceBindingHash","referenceSetHash","worldContextHash","snapshotHash","selectionHash","sourceHash","assetHash","cellsHash","couplingPlanHash","couplingPolicyHash","patchSetHash","origin","branch","recordsHash","summaryHash","reservedCalls","maximumCalls","tier","partCount","operationCount","pairCount","previewHashes","currentNativeEvidenceHash","files","proofFiles","coordinateSpace","movable","omittedCells","completeSetVerified","partialPublicationAllowed","originalScopeAndNativeCellsVerified","finalReviewAccepted","realImageUnderstandingVerified","providerReceiptAuditVerified","originalRegistryVerified","worldRendered","serverBaselineVerified","physicsVerified","canAuthorizePlacement","additionalModelCalls","worldWrites","candidateHash");
        kind(c,"CoupledReferenceWorldAssemblyCandidate");hash(c,"candidateHash");
        same(envelope.get("candidateHash"),c.get("candidateHash"));same(envelope.get("preparationHash"),c.get("preparationHash"));same(c.get("jobId"),r.get("id"));same(c.get("requestHash"),r.get("requestHash"));
        for(var k:List.of("candidateHash","patchSetHash","partCount","operationCount"))same(c.get(k),status.getAsJsonObject("candidate").get(k));
        for(var k:List.of("preparationHash","runtimeHash","referenceBindingHash","referenceSetHash","worldContextHash","snapshotHash","selectionHash","couplingPolicyHash","origin","maximumCalls","tier"))same(c.get(k),p.get(k));
        for(var k:List.of("archiveHash","sourceHash","assetHash","cellsHash","couplingPlanHash","recordsHash","summaryHash","currentNativeEvidenceHash"))digest(c,k);
        if(!text(c,"branch").matches("assembly-run-[A-Za-z0-9_-]{6,32}")||!text(c,"coordinateSpace").equals("original-world-absolute")||!text(c,"omittedCells").equals("keep"))throw new IllegalStateException("原成组坐标/分支改变");
        yes(c,"completeSetVerified","originalScopeAndNativeCellsVerified");flag(c,"finalReviewAccepted");
        no(c,"movable","partialPublicationAllowed","realImageUnderstandingVerified","providerReceiptAuditVerified","originalRegistryVerified","worldRendered","serverBaselineVerified","physicsVerified","canAuthorizePlacement");zero(c,"additionalModelCalls","worldWrites");
        int count=(int)number(c,"partCount");long operations=number(c,"operationCount"),calls=number(c,"reservedCalls");
        if(operations<1||operations>SelectionLimits.editCells()||count<1||count>SelectionLimits.assemblyParts()||count!=(operations+8191)/8192||number(c,"pairCount")>operations/2||calls<1||calls>number(p,"maximumCalls")||status.get("reservedCalls").isJsonNull())throw new IllegalStateException("原完整数量或调用不一致");same(c.get("reservedCalls"),status.get("reservedCalls"));
        var previews=c.getAsJsonArray("previewHashes");if(previews==null||previews.size()!=count)throw new IllegalStateException("原完整预览清单缺失");for(var value:previews)if(!value.isJsonPrimitive()||!value.getAsJsonPrimitive().isString()||!value.getAsString().matches("[a-f0-9]{64}"))throw new IllegalStateException("原预览 hash 无效");
        pins(c,r.getAsJsonObject("request").getAsJsonObject("generation"),p,count,cancelled);
        var files=envelope.getAsJsonArray("files");if(files==null||files.size()!=4)throw new IllegalStateException("准确原生/方案/整组/binding 文件缺失");
        String[] names={"native-manifest.json","coupling-plan.json","patch-set.json","binding.json"};var raw=new byte[4][];var values=new JsonObject[4];
        for(int i=0;i<4;i++){raw[i]=payload(files.get(i).getAsJsonObject(),names[i],AssemblyLimits.metadataBytes(),"utf8",cancelled);values[i]=json(raw[i],cancelled);if(i<3)pin(c,names[i],raw[i]);}
        var manifest=values[0];var plan=values[1];var set=values[2];hash(manifest,"assetHash");hash(plan,"planHash");hash(set,"patchSetHash");
        if(manifest.has("diagnosticOnly")&&flag(manifest,"diagnosticOnly"))throw new IllegalStateException("诊断资产不可导入/建造");
        for(var k:List.of("assetHash","cellsHash"))same(manifest.get(k),c.get(k));same(manifest.getAsJsonObject("scene").get("sourceHash"),c.get("sourceHash"));
        keys(plan,"format","version","policy","policyHash","snapshotHash","selectionHash","assetHash","cellsHash","analysisHash","origin","dimensions","operationCount","pairCount","pairs","scheduleHash","executionOrder","partScope","omittedCells","existingCoupledBeforeWritesAllowed","serverBaselineVerified","physicsVerified","canAuthorizePlacement","worldWrites","planHash");
        if(!text(plan,"format").equals("AssemblyCoupledPlan")||number(plan,"version")!=1||!text(plan,"policy").equals("whole-native-new-special-blocks-v1")||!text(plan,"executionOrder").equals("native-order-promote-matching-upper-after-lower")||!text(plan,"partScope").equals("transport-only-complete-plan-required")||!text(plan,"omittedCells").equals("keep"))throw new IllegalStateException("原成组方案协议改变");
        no(plan,"existingCoupledBeforeWritesAllowed","serverBaselineVerified","physicsVerified","canAuthorizePlacement");zero(plan,"worldWrites");
        for(var k:List.of("snapshotHash","selectionHash","assetHash","cellsHash","origin","operationCount","pairCount"))same(plan.get(k),c.get(k));same(plan.get("planHash"),c.get("couplingPlanHash"));same(plan.get("policyHash"),c.get("couplingPolicyHash"));same(plan.get("dimensions"),manifest.get("dimensions"));
        if(plan.getAsJsonArray("pairs").size()!=number(c,"pairCount"))throw new IllegalStateException("原成组配对列表缺失");digest(plan,"analysisHash");digest(plan,"scheduleHash");
        keys(set,"format","version","policy","planHash","snapshotHash","selectionHash","assetHash","cellsHash","operationCount","partCount","partHashes","fullAssetProcessed","partialPublicationAllowed","canAuthorizePlacement","serverBaselineVerified","physicsVerified","worldWrites","patchSetHash");
        if(!text(set,"format").equals("AssemblyCoupledPatchSet")||number(set,"version")!=1||!text(set,"policy").equals(text(plan,"policy")))throw new IllegalStateException("原完整 part-set 协议改变");
        yes(set,"fullAssetProcessed");no(set,"partialPublicationAllowed","canAuthorizePlacement","serverBaselineVerified","physicsVerified");zero(set,"worldWrites");
        for(var k:List.of("snapshotHash","selectionHash","assetHash","cellsHash","operationCount","partCount","patchSetHash"))same(set.get(k),c.get(k));same(set.get("planHash"),plan.get("planHash"));
        var binding=CoupledAssemblyBinding.parse(raw[3],cancelled);var b=binding.json();same(b.get("captureId"),p.get("contextId"));same(b.get("contextRecordHash"),p.get("recordHash"));same(b.get("contextRevision"),r.get("contextRevision"));same(b.get("selection"),r.get("selection"));same(b.get("totalWrites"),c.get("operationCount"));
        for(var k:List.of("jobId","worldContextHash","preparationHash","requestHash","runtimeHash","referenceSetHash","referenceBindingHash","sourceHash","currentNativeEvidenceHash","candidateHash","snapshotHash","selectionHash","assetHash","cellsHash","patchSetHash","couplingPlanHash","couplingPolicyHash","origin","previewHashes"))same(b.get(k),c.get(k));
        for(var k:List.of("analysisHash","scheduleHash"))same(b.get(k),plan.get(k));same(b.get("partHashes"),set.get("partHashes"));allowed(cancelled);return new Metadata(c,binding,raw[0],raw[1]);
    }
    static byte[] cells(Metadata metadata,JsonObject envelope,BooleanSupplier cancelled){
        bounded(envelope,PART_BYTES,cancelled);keys(envelope,"format","version","purpose","preparationHash","candidateHash","completeSetVerified","partIsApplyScope","canAuthorizePlacement","serverBaselineVerified","additionalModelCalls","worldWrites","file");common(metadata,envelope,"CoupledReferenceWorldAssemblyCandidateCells");
        byte[] bytes=payload(envelope.getAsJsonObject("file"),"cells.bin",CELLS_BYTES,"base64",cancelled);pin(metadata.candidate,"cells.bin",bytes);
        var manifest=json(metadata.manifest,cancelled);var dimensions=manifest.getAsJsonObject("dimensions");keys(dimensions,"width","height","length");
        long w=number(dimensions,"width"),h=number(dimensions,"height"),d=number(dimensions,"length");var edit=metadata.binding.selection().edit();
        if(w<1||w>256||h<1||h>384||d<1||d>256||w*h*d>SelectionLimits.editCells()||w*h*d*2!=bytes.length||w>edit.max().x()-edit.min().x()||h>edit.max().y()-edit.min().y()||d>edit.max().z()-edit.min().z()||!ContextReceipt.sha256(bytes).equals(metadata.binding.cellsHash()))throw new IllegalStateException("准确原生方块字节/体积改变");
        return bytes;
    }
    static Part part(Metadata metadata,int index,JsonObject envelope,BooleanSupplier cancelled){
        bounded(envelope,PART_BYTES,cancelled);keys(envelope,"format","version","purpose","preparationHash","candidateHash","completeSetVerified","partIsApplyScope","canAuthorizePlacement","serverBaselineVerified","additionalModelCalls","worldWrites","index","partCount","files");common(metadata,envelope,"CoupledReferenceWorldAssemblyCandidatePart");
        if(index<0||index>=metadata.partCount()||number(envelope,"index")!=index||number(envelope,"partCount")!=metadata.partCount())throw new IllegalStateException("原分片顺序/完整范围改变");
        var files=envelope.getAsJsonArray("files");if(files==null||files.size()!=2)throw new IllegalStateException("原分片/预览文件缺失");
        byte[] part=payload(files.get(0).getAsJsonObject(),name("part",index),AssemblyLimits.partBytes(),"utf8",cancelled),preview=payload(files.get(1).getAsJsonObject(),name("preview",index),AssemblyLimits.partBytes(),"utf8",cancelled);
        pin(metadata.candidate,name("part",index),part);pin(metadata.candidate,name("preview",index),preview);allowed(cancelled);return new Part(metadata,index,part,preview);
    }
    static Whole whole(Metadata metadata,byte[] cells,List<Part> parts,BooleanSupplier cancelled){
        Objects.requireNonNull(metadata);Objects.requireNonNull(cells);Objects.requireNonNull(parts);allowed(cancelled);
        byte[] owned=cells.clone();if(parts.size()!=metadata.partCount()||!ContextReceipt.sha256(owned).equals(metadata.binding.cellsHash()))throw new IllegalStateException("完整原生或分片未收齐");
        var values=new ArrayList<CoupledAssemblyInput.Part>();for(int i=0;i<parts.size();i++){allowed(cancelled);var part=Objects.requireNonNull(parts.get(i));if(part.metadata!=metadata||part.input.index()!=i)throw new IllegalStateException("不同原完整下载不能拼接");values.add(part.input);}
        var input=new CoupledAssemblyInput(metadata.binding,metadata.manifest,owned,metadata.plan,values);allowed(cancelled);return new Whole(input);
    }
    private CoupledReferenceWorldAssemblyCandidateReceipt(){}
}
