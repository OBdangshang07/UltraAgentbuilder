package dev.voxelstudio.client;

import com.google.gson.*;
import com.google.gson.stream.JsonWriter;
import java.io.*;
import dev.voxelstudio.selection.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.function.BooleanSupplier;
import static dev.voxelstudio.client.WorldPatchTaskReceipt.*;

/** Original FINAL download integrity, never a current server certificate.
 * This is a whole-set identity, deliberately NOT WorldPatchCheckedCandidate:
 * a transport part cannot acquire the legacy single-patch placement path. */
final class ReferenceWorldAssemblyCandidateReceipt {
    static final int METADATA_BYTES=2*1024*1024+65536,PART_BYTES=40*1024*1024;
    static final long DOWNLOAD_BYTES=100L*1024*1024,PATCH_BYTES=64L*1024*1024;
    static final class Metadata {
        private final JsonObject reference,status,candidate,patchSet;
        private Metadata(JsonObject r,JsonObject s,JsonObject c,JsonObject p){reference=r.deepCopy();status=s.deepCopy();candidate=c.deepCopy();patchSet=p.deepCopy();}
        JsonObject reference(){return reference.deepCopy();}JsonObject status(){return status.deepCopy();}
        JsonObject candidate(){return candidate.deepCopy();}JsonObject patchSet(){return patchSet.deepCopy();}
        String candidateHash(){return text(candidate,"candidateHash");}int partCount(){return (int)number(candidate,"partCount");}
        boolean canAuthorizePlacement(){return false;}
    }
    static final class Part {
        private final Metadata metadata;private final int index;private final byte[] patch,proposal;private final WorldPatchPreview preview;
        private Part(Metadata m,int i,JsonObject p,WorldPatchPreview v){metadata=m;index=i;patch=wire(p,16*1024*1024);proposal=wire(p.get("proposal"),16*1024*1024);preview=v;}
        int index(){return index;}JsonObject patch(){return WorldPatchCandidateReceipt.strictJson(new String(patch,StandardCharsets.UTF_8),()->false).getAsJsonObject();}WorldPatchPreview preview(){return preview;}
        byte[] originalProposal(){return proposal.clone();}
        byte[] originalPatch(){return patch.clone();}
        boolean partIsApplyScope(){return false;}boolean canAuthorizePlacement(){return false;}
    }
    static final class Whole {
        private final Metadata metadata;private final List<Part> parts;private final Map<SelectionRegion.Point,WorldPatchPreview.Row> rows;
        private Whole(Metadata m,List<Part> p,Map<SelectionRegion.Point,WorldPatchPreview.Row> r){metadata=m;parts=List.copyOf(p);rows=Map.copyOf(r);}
        Metadata metadata(){return metadata;}List<Part> parts(){return parts;}
        int totalWrites(){return rows.size();}WorldPatchPreview.Row at(SelectionRegion.Point p){return rows.get(p);}
        boolean movable(){return false;}boolean completeSetVerified(){return true;}
        boolean currentWorldVerified(){return false;}boolean canAuthorizePlacement(){return false;}
        /** Read-only server transport from this exact verified complete owner.
         * No per-part legacy candidate or placement confirmation is created. */
        AssemblyPatchInput worldInput(BooleanSupplier cancelled){
            allowed(cancelled);var r=metadata.reference;var c=metadata.candidate;
            var p=r.getAsJsonObject("prepared");var set=metadata.patchSet;
            var selection=WorldPatchJobReceipt.selection(r.getAsJsonObject("selection"));
            var hashes=new ArrayList<String>();set.getAsJsonArray("partHashes").forEach(v->hashes.add(v.getAsString()));
            var previews=new ArrayList<String>();c.getAsJsonArray("previewHashes").forEach(v->previews.add(v.getAsString()));
            var binding=new AssemblyPatchBinding(text(p,"contextId"),selection,number(r,"contextRevision"),
                    text(c,"snapshotHash"),text(c,"selectionHash"),text(c,"worldContextHash"),text(c,"jobId"),
                    text(c,"preparationHash"),text(r,"requestHash"),text(c,"runtimeHash"),text(c,"referenceSetHash"),
                    text(p,"recordHash"),text(c,"referenceBindingHash"),text(c,"sourceHash"),text(c,"currentNativeEvidenceHash"),
                    text(c,"assetHash"),text(c,"cellsHash"),text(c,"candidateHash"),text(c,"patchSetHash"),
                    selection.edit().min(),hashes,previews,totalWrites());
            var transported=new ArrayList<AssemblyPatchInput.Part>();
            for(var part:parts){allowed(cancelled);transported.add(new AssemblyPatchInput.Part(part.index,part.proposal,part.patch,part.preview));}
            allowed(cancelled);return new AssemblyPatchInput(binding,transported);
        }
    }
    private static void allowed(BooleanSupplier cancelled){Objects.requireNonNull(cancelled);if(cancelled.getAsBoolean()||Thread.currentThread().isInterrupted())throw new java.util.concurrent.CancellationException("原整组候选读取取消；不采用部分成果");}
    /** Stream UTF-8 without materializing an extra giant UTF-16 String. Parts
     * retain immutable original bytes, not duplicated Gson object trees. */
    private static final class Wire extends OutputStream {
        private final long maximum;private final byte[] stored;private final java.security.MessageDigest digest;private long count;
        Wire(long maximum,byte[] stored){this.maximum=maximum;this.stored=stored;try{digest=java.security.MessageDigest.getInstance("SHA-256");}catch(java.security.NoSuchAlgorithmException error){throw new IllegalStateException(error);}}
        private int account(int bytes){long offset=count;count+=bytes;if(count>maximum||stored!=null&&count>stored.length)throw new IllegalStateException("原整组候选下载超额；不裁切");return (int)offset;}
        @Override public void write(int value){int offset=account(1);digest.update((byte)value);if(stored!=null)stored[offset]=(byte)value;}
        @Override public void write(byte[] value,int offset,int length){int target=account(length);digest.update(value,offset,length);if(stored!=null)System.arraycopy(value,offset,stored,target,length);}
        String sha256(){return HexFormat.of().formatHex(digest.digest());}
    }
    private static Wire serialize(JsonElement value,long maximum,boolean retain){
        // Counting/hashing does not allocate a copy of the entire file. When
        // retention is required allocate once at the exact verified size,
        // never a growing buffer plus a final toByteArray duplicate.
        var out=new Wire(maximum,retain?new byte[(int)serialize(value,maximum,false).count]:null);try(var writer=new JsonWriter(new OutputStreamWriter(out,StandardCharsets.UTF_8))){writer.setSerializeNulls(true);writer.setHtmlSafe(false);com.google.gson.internal.Streams.write(value,writer);}
        catch(IOException error){throw new IllegalStateException("原整组字节序列化失败",error);}
        if(out.stored!=null&&out.count!=out.stored.length)throw new IllegalStateException("原分片序列化字节在读取期间改变");return out;
    }
    private static byte[] wire(JsonElement value,int maximum){return serialize(value,maximum,true).stored;}
    private static byte[] wire(JsonElement value){return wire(value,PART_BYTES);}
    static long transmittedBytes(JsonElement value){return serialize(value,PART_BYTES,false).count;}
    private static void bounded(JsonObject value,int maximum,BooleanSupplier cancelled){allowed(cancelled);serialize(value,maximum,false);allowed(cancelled);}
    private static void kind(JsonObject value,String format){if(!text(value,"format").equals(format)||number(value,"version")!=2||!text(value,"purpose").equals(ReferenceWorldAssemblyReceipt.PURPOSE))throw new IllegalStateException("原整组协议改变");}
    private static void yes(JsonObject value,String... fields){for(var k:fields)if(!flag(value,k))throw new IllegalStateException("原整组证据不完整");}
    private static void zero(JsonObject value,String... fields){for(var k:fields)if(number(value,k)!=0)throw new IllegalStateException("读取整组候选不能调用模型或写入世界");}
    private static void hash(JsonObject value,String field){digest(value,field);var content=new JsonObject();for(var entry:value.entrySet())if(!entry.getKey().equals(field))content.add(entry.getKey(),entry.getValue());
        if(!ContextReceipt.jsonHash(content).equals(text(value,field)))throw new IllegalStateException("原整组内容hash改变");}
    static Metadata metadata(JsonObject original,JsonObject finalStatus,JsonObject envelope,BooleanSupplier cancelled){
        bounded(envelope,METADATA_BYTES,cancelled);var r=ReferenceWorldAssemblyReceipt.verifyReference(original.deepCopy());
        var s=ReferenceWorldAssemblyReceipt.status(r,finalStatus.deepCopy());
        if(!text(s,"state").equals("preview-ready"))throw new IllegalStateException("没有原完成候选；不能下载替代稿");
        keys(envelope,"candidate","patchSet","originalCompleteSetReverified","additionalModelCalls","worldWrites","canAuthorizePlacement");
        yes(envelope,"originalCompleteSetReverified");no(envelope,"canAuthorizePlacement");zero(envelope,"additionalModelCalls","worldWrites");
        var c=envelope.getAsJsonObject("candidate");
        keys(c,"format","version","purpose","jobId","preparationHash","archiveHash","runtimeHash","referenceBindingHash","referenceSetHash","worldContextHash","snapshotHash","selectionHash","sourceHash","assetHash","cellsHash","origin","branch","recordsHash","summaryHash","reservedCalls","maximumCalls","tier","patchSetHash","partCount","operationCount","previewHashes","currentNativeEvidenceHash","files","proofFiles","coordinateSpace","movable","omittedCells","completeSetVerified","partialPublicationAllowed","originalScopeAndNativeCellsVerified","finalReviewAccepted","realImageUnderstandingVerified","providerReceiptAuditVerified","worldRendered","serverBaselineVerified","physicsVerified","canAuthorizePlacement","crashAtomicPublication","additionalModelCalls","worldWrites","candidateHash");
        kind(c,"ReferenceWorldAssemblyCandidate");hash(c,"candidateHash");JsonObject pinned=s.getAsJsonObject("candidate"),p=r.getAsJsonObject("prepared");
        for(var k:List.of("candidateHash","patchSetHash","partCount","operationCount"))same(c.get(k),pinned.get(k));same(c.get("jobId"),r.get("id"));
        for(var k:List.of("preparationHash","runtimeHash","referenceBindingHash","referenceSetHash","worldContextHash","snapshotHash","selectionHash","origin","maximumCalls","tier"))same(c.get(k),p.get(k));
        for(var k:List.of("archiveHash","sourceHash","assetHash","cellsHash","recordsHash","summaryHash","currentNativeEvidenceHash"))digest(c,k);
        if(!text(c,"branch").matches("assembly-run-[A-Za-z0-9_-]{6,32}")||!text(c,"coordinateSpace").equals("original-world-absolute")||!text(c,"omittedCells").equals("keep"))throw new IllegalStateException("原资产坐标或来源分支改变");
        yes(c,"completeSetVerified","originalScopeAndNativeCellsVerified");
        no(c,"movable","partialPublicationAllowed","realImageUnderstandingVerified","providerReceiptAuditVerified","worldRendered","serverBaselineVerified","physicsVerified","canAuthorizePlacement","crashAtomicPublication");
        flag(c,"finalReviewAccepted");zero(c,"additionalModelCalls","worldWrites");
        if(number(c,"reservedCalls")<1||number(c,"reservedCalls")>number(p,"maximumCalls"))throw new IllegalStateException("原整组调用计数改变");
        if(!s.get("reservedCalls").isJsonNull())same(c.get("reservedCalls"),s.get("reservedCalls"));
        int count=(int)number(c,"partCount");long operations=number(c,"operationCount");
        if(count<1||count>32||operations<1||operations>SelectionLimits.editCells()||count!=(operations+8191)/8192)throw new IllegalStateException("原整组分片数或操作数量不完整");
        var previews=c.getAsJsonArray("previewHashes");if(previews.size()!=count)throw new IllegalStateException("原整组预览遗漏");for(var v:previews)if(!v.isJsonPrimitive()||!v.getAsJsonPrimitive().isString()||!v.getAsString().matches("[a-f0-9]{64}"))throw new IllegalStateException("原预览hash无效");
        var set=envelope.getAsJsonObject("patchSet");keys(set,"format","version","worldContextHash","snapshotHash","selectionHash","assetHash","cellsHash","origin","coordinateTransform","omittedCells","operationCount","partCount","partHashes","fullAssetProcessed","partialPublicationAllowed","serverBaselineVerified","physicsVerified","canAuthorizePlacement","worldWrites","patchSetHash");
        if(!text(set,"format").equals("AssemblyWorldPatchSet")||number(set,"version")!=2||!text(set,"coordinateTransform").equals("translate-only-original-W-min")||!text(set,"omittedCells").equals("keep"))throw new IllegalStateException("原整组不能旋转、缩放或移动");hash(set,"patchSetHash");
        for(var k:List.of("worldContextHash","snapshotHash","selectionHash","assetHash","cellsHash","origin","operationCount","partCount","patchSetHash"))same(set.get(k),c.get(k));
        yes(set,"fullAssetProcessed");no(set,"partialPublicationAllowed","serverBaselineVerified","physicsVerified","canAuthorizePlacement");zero(set,"worldWrites");
        var hashes=set.getAsJsonArray("partHashes");if(hashes.size()!=count)throw new IllegalStateException("原整组patch hash遗漏");var unique=new HashSet<String>();for(var v:hashes)if(!v.isJsonPrimitive()||!v.getAsJsonPrimitive().isString()||!v.getAsString().matches("[a-f0-9]{64}")||!unique.add(v.getAsString()))throw new IllegalStateException("原整组patch hash重复或无效");
        var names=new HashSet<String>(Set.of("records.json","patch-set.json"));for(int i=0;i<count;i++){names.add(name("part",i));names.add(name("preview",i));}
        pins(c.getAsJsonArray("files"),names,96L*1024*1024,false,cancelled);pins(c.getAsJsonArray("proofFiles"),null,512L*1024*1024,true,cancelled);
        file(c,"patch-set.json",set);allowed(cancelled);return new Metadata(r,s,c,set);
    }
    private static String name(String type,int index){return type+"-"+String.format(Locale.ROOT,"%03d",index)+".json";}
    private static void pins(JsonArray pins,Set<String> expected,long maximum,boolean proofs,BooleanSupplier cancelled){
        if(pins==null||pins.isEmpty()||pins.size()>(proofs?4096:66))throw new IllegalStateException("原整组文件清单超额或缺失");var names=new HashSet<String>();long total=0;
        for(var v:pins){allowed(cancelled);var pin=v.getAsJsonObject();keys(pin,"path","bytes","sha256");String path=text(pin,"path");
            if(path.length()>2048||path.startsWith("/")||path.contains("\\")||path.contains(":")||Arrays.stream(path.split("/",-1)).anyMatch(segment->segment.isEmpty()||segment.equals(".")||segment.equals("..")||!segment.matches("[A-Za-z0-9._-]+"))||!names.add(path))throw new IllegalStateException("原整组文件清单路径不安全或重复");
            digest(pin,"sha256");long size=number(pin,"bytes"),limit=proofs?64L*1024*1024:path.equals("records.json")?2L*1024*1024:16L*1024*1024;
            if(size<1||size>limit||(total+=size)>maximum)throw new IllegalStateException("原整组文件清单字节超额");
        }
        if(expected!=null&&!names.equals(expected))throw new IllegalStateException("原整组文件清单遗漏或增加分片");
    }
    private static void file(JsonObject candidate,String path,JsonElement value){
        JsonObject pin=null;for(var entry:candidate.getAsJsonArray("files"))if(text(entry.getAsJsonObject(),"path").equals(path))pin=entry.getAsJsonObject();
        var bytes=serialize(value,PART_BYTES,false);if(pin==null||number(pin,"bytes")!=bytes.count||!text(pin,"sha256").equals(bytes.sha256()))throw new IllegalStateException("原整组文件实际字节改变");
    }
    static Part part(Metadata metadata,int index,JsonObject envelope,BooleanSupplier cancelled){
        Objects.requireNonNull(metadata);bounded(envelope,PART_BYTES,cancelled);if(index<0||index>=metadata.partCount())throw new IllegalStateException("只读取原整组索引");
        keys(envelope,"format","version","purpose","preparationHash","candidateHash","patchSet","index","patch","preview","completeSetVerified","partIsApplyScope","canAuthorizePlacement","serverBaselineVerified","additionalModelCalls","worldWrites");kind(envelope,"ReferenceWorldAssemblyCandidatePart");
        same(envelope.get("preparationHash"),metadata.candidate.get("preparationHash"));same(envelope.get("candidateHash"),metadata.candidate.get("candidateHash"));same(envelope.get("patchSet"),metadata.patchSet);
        if(number(envelope,"index")!=index)throw new IllegalStateException("原整组分片次序改变");yes(envelope,"completeSetVerified");no(envelope,"partIsApplyScope","canAuthorizePlacement","serverBaselineVerified");zero(envelope,"additionalModelCalls","worldWrites");
        var patch=envelope.getAsJsonObject("patch");keys(patch,"format","version","policy","snapshotHash","selectionHash","world","selectionRevision","contextRevision","proposal","proposalHash","writes","guards","summary","canAuthorizePlacement","serverBaselineVerified","physicsVerified","patchHash");
        if(!text(patch,"format").equals("WorldPatch")||number(patch,"version")!=1||!text(patch,"policy").equals("static-proposal-data-v1"))throw new IllegalStateException("原分片patch协议改变");hash(patch,"patchHash");
        same(patch.get("patchHash"),metadata.patchSet.getAsJsonArray("partHashes").get(index));no(patch,"canAuthorizePlacement","serverBaselineVerified","physicsVerified");
        for(var k:List.of("snapshotHash","selectionHash"))same(patch.get(k),metadata.candidate.get(k));
        var selection=WorldPatchJobReceipt.selection(metadata.reference.getAsJsonObject("selection"));same(patch.get("world"),selection.world().json());
        if(number(patch,"selectionRevision")!=selection.revision()||number(patch,"contextRevision")!=number(metadata.reference,"contextRevision"))throw new IllegalStateException("原分片世界版本改变");
        var proposal=patch.getAsJsonObject("proposal");keys(proposal,"format","version","snapshotHash","selectionHash","operations");
        if(!text(proposal,"format").equals("WorldPatchProposal")||number(proposal,"version")!=1||!ContextReceipt.jsonHash(proposal).equals(text(patch,"proposalHash")))throw new IllegalStateException("原分片proposal改变");
        for(var k:List.of("snapshotHash","selectionHash"))same(proposal.get(k),metadata.candidate.get(k));
        var previewJson=envelope.getAsJsonObject("preview");String previewHash=metadata.candidate.getAsJsonArray("previewHashes").get(index).getAsString();
        var binding=new WorldPatchPreview.Binding(selection,number(metadata.reference,"contextRevision"),text(patch,"snapshotHash"),text(patch,"selectionHash"),text(patch,"patchHash"),previewHash);
        var preview=WorldPatchPreview.parse(wire(previewJson),binding,cancelled);JsonArray writes=patch.getAsJsonArray("writes"),operations=proposal.getAsJsonArray("operations");
        long remaining=number(metadata.candidate,"operationCount")-8192L*index;int expected=(int)Math.min(8192,remaining);
        if(writes.size()!=expected||operations.size()!=expected||preview.totalWrites()!=expected)throw new IllegalStateException("原整组分片真实操作遗漏");
        var seen=new HashSet<SelectionRegion.Point>();
        for(int i=0;i<expected;i++){if((i&1023)==0)allowed(cancelled);JsonObject w=writes.get(i).getAsJsonObject(),op=operations.get(i).getAsJsonObject();keys(w,"position","before","after","action","difference");String action=text(w,"action");
            if(!Set.of("set","clear").contains(action))throw new IllegalStateException("分片不能从KEEP获得写权限");keys(op,action.equals("set")?new String[]{"op","position","before","after"}:new String[]{"op","position","before"});
            same(w.get("position"),op.get("position"));same(w.get("before"),op.get("before"));if(!text(op,"op").equals(action)||action.equals("set")&&!w.get("after").equals(op.get("after"))||action.equals("clear")&&!text(w,"after").equals("minecraft:air"))throw new IllegalStateException("原写操作与proposal不一致");
            var xyz=w.getAsJsonArray("position");if(xyz==null||xyz.size()!=3)throw new IllegalStateException("原坐标必须三轴");int[] coords=new int[3];
            for(int axis=0;axis<3;axis++){var v=xyz.get(axis);if(!v.isJsonPrimitive()||!v.getAsJsonPrimitive().isNumber())throw new IllegalStateException("原坐标必须整数");coords[axis]=v.getAsBigDecimal().intValueExact();}
            var row=preview.at(new SelectionRegion.Point(coords[0],coords[1],coords[2]));if(row==null)throw new IllegalStateException("原分片预览缺少写操作");
            if(!seen.add(row.position())||!row.before().equals(text(w,"before"))||!row.after().equals(text(w,"after"))||!row.difference().name().toLowerCase(Locale.ROOT).equals(text(w,"difference")))throw new IllegalStateException("原分片差异不一致或重复");
        }
        file(metadata.candidate,name("part",index),patch);file(metadata.candidate,name("preview",index),previewJson);allowed(cancelled);return new Part(metadata,index,patch,preview);
    }
    static Whole whole(Metadata metadata,List<Part> ordered,BooleanSupplier cancelled){
        Objects.requireNonNull(metadata);Objects.requireNonNull(ordered);allowed(cancelled);if(ordered.size()!=metadata.partCount())throw new IllegalStateException("原整组分片未全部完成；不采用部分");
        var rows=new HashMap<SelectionRegion.Point,WorldPatchPreview.Row>();long bytes=4096;
        for(int i=0;i<ordered.size();i++){allowed(cancelled);var part=Objects.requireNonNull(ordered.get(i));if(part.metadata!=metadata||part.index!=i)throw new IllegalStateException("不同原组或分片次序不能拼接");
            bytes+=part.patch.length;if(bytes>PATCH_BYTES)throw new IllegalStateException("原整组patch字节超额");
            for(var section:part.preview.sections())for(var row:section.rows()){if((rows.size()&1023)==0)allowed(cancelled);if(rows.putIfAbsent(row.position(),row)!=null)throw new IllegalStateException("原整组分片跨片重复坐标");}
        }
        if(rows.size()!=number(metadata.candidate,"operationCount"))throw new IllegalStateException("原整组操作集合不完整");allowed(cancelled);return new Whole(metadata,ordered,rows);
    }
    private ReferenceWorldAssemblyCandidateReceipt(){}
}
