package dev.voxelstudio.client;

import com.google.gson.*;
import net.fabricmc.loader.api.FabricLoader;
import dev.voxelstudio.Asset;
import dev.voxelstudio.NativeEvidenceRequest;
import dev.voxelstudio.selection.SelectionReadService;
import dev.voxelstudio.selection.SelectionLimits;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.file.*;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.*;

/** Independent bounded lanes: discovery/downloads must never queue ahead of cancel. */
public final class BridgeClient implements AutoCloseable {
    private record Connection(String base, String token, long pid, long epoch) {}
    private final Path root, data;
    private final boolean builtin;
    private volatile Path runtime;
    private volatile String expectedVersion, preparation="配套尚未启动";
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final ExecutorService connector=pool("connect",1), control=pool("control",2), discovery=pool("discovery",2), downloads=pool("download",1),contexts=pool("context",1,2),references=pool("reference",1,2);
    private final AtomicLong epoch=new AtomicLong(), loadEpoch=new AtomicLong();
    private volatile Connection connection;
    private volatile Process owned;
    private volatile boolean closed;
    private CompletableFuture<Connection> connecting;
    private CompletableFuture<?> loading;
    public BridgeClient(){this(defaultRoot(),true);}
    private static Path defaultRoot(){var loader=FabricLoader.getInstance();return loader.getGameDir().resolve(loader.isDevelopmentEnvironment()&&Boolean.getBoolean("voxelstudio.onboardingtest")?"onboarding-runtime-"+System.currentTimeMillis():"voxel-studio");}
    BridgeClient(Path root){this(root,false);}
    BridgeClient(Path root,boolean builtin){this.root=root.toAbsolutePath().normalize();data=this.root.resolve("data");this.builtin=builtin;runtime=this.root;}
    public Path dataDirectory(){return data;}
    public String preparationStatus(){return preparation;}
    public CompletableFuture<String> localDiagnostics(){return submit(connector,()->{
        StringBuilder text=new StringBuilder(builtin&&BuiltinCompanion.bundled()?"安装方式：单 JAR 内置配套\n":"安装方式：外置开发配套\n").append(preparation).append("\n数据目录：").append(data).append("\n运行目录：").append(runtime).append("\n");
        for(String file:List.of("runtime/node.exe","bridge/server.mjs","contracts/building-spec.schema.mjs","prompts/building-v1.md",".agents/skills/voxel-studio/SKILL.md"))text.append(Files.isRegularFile(runtime.resolve(file))?"存在  ":builtin&&BuiltinCompanion.bundled()?"内置待准备  ":"缺失  ").append(file).append('\n');
        return text.append("\n未读取账户、令牌或私人任务。诊断不会调用模型生成。\n").toString();
    });}
    private static ExecutorService pool(String name,int threads){return pool(name,threads,32);}
    private static ExecutorService pool(String name,int threads,int capacity){return new ThreadPoolExecutor(threads,threads,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(capacity),r->{Thread t=new Thread(r,"voxel-"+name);t.setDaemon(true);return t;},new ThreadPoolExecutor.AbortPolicy());}
    private static <T> CompletableFuture<T> submit(ExecutorService pool,Callable<T> action){
        var result=new CompletableFuture<T>();
        var task=new FutureTask<Void>(()->{try{result.complete(action.call());}catch(Throwable e){result.completeExceptionally(e);}return null;});
        result.whenComplete((r,e)->{if(result.isCancelled())task.cancel(true);});
        try{pool.execute(task);}catch(RejectedExecutionException e){result.completeExceptionally(new IllegalStateException("Bridge request queue full or closed",e));}return result;
    }
    private void current(Connection c){if(closed||c.epoch!=epoch.get())throw new CancellationException("Connection changed; stale response discarded");}
    private synchronized CompletableFuture<Connection> connect(){
        if(closed)return CompletableFuture.failedFuture(new IllegalStateException("Bridge client closed"));
        if(connection!=null)return CompletableFuture.completedFuture(connection);
        if(connecting!=null&&!connecting.isDone())return connecting;
        long ticket=epoch.get();connecting=submit(connector,()->{Connection c=establish(ticket);synchronized(this){current(c);connection=c;}return c;});return connecting;
    }
    public CompletableFuture<JsonObject> request(String method,String route,JsonObject input){
        boolean productionPatch=route!=null&&route.matches("/v2/world-patch/(capabilities|jobs/[a-f0-9]{64}(/(send|observe-original|recheck-response)|/(preview|candidate)\\?candidateHash=[a-f0-9]{64})?)");
        if(route==null||(!route.startsWith("/v1/")&&!productionPatch)||route.contains("#"))return CompletableFuture.failedFuture(new IllegalArgumentException("Invalid Bridge route"));
        String body=input==null?"{}":route.startsWith("/v1/world-contexts/")?ContextReceipt.canonicalJson(input):input.toString();return connect().thenCompose(c->json(c,method,route,body));
    }
    record ReferencePreparation(JsonObject preparation,List<ReferenceImageNormalizer.Result> images) {
        ReferencePreparation {preparation=preparation.deepCopy();images=List.copyOf(images);}
        @Override public JsonObject preparation(){return preparation.deepCopy();}
    }
    record ReferencePixels(JsonObject manifest,List<ReferenceImageNormalizer.Result> images) {
        ReferencePixels {manifest=manifest.deepCopy();images=List.copyOf(images);}
        @Override public JsonObject manifest(){return manifest.deepCopy();}
    }
    private JsonObject pixelJson(Connection c,String route,String body,int maximum)throws Exception {
        current(c);var b=builder(c,route,60);if(body!=null)b.header("Content-Type","application/json; charset=utf-8").POST(HttpRequest.BodyPublishers.ofString(body));
        var response=send(c,b.build(),maximum);if(response.statusCode()!=200)throw new IllegalStateException("纯图片准备不可读取，HTTP "+response.statusCode()+"；未发送模型");
        String text=java.nio.charset.StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
            .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT).decode(ByteBuffer.wrap(response.body())).toString();
        var value=WorldPatchCandidateReceipt.strictJson(text,()->Thread.currentThread().isInterrupted()).getAsJsonObject();current(c);return value;
    }
    /** One bounded background lane. No discovery, ordinary preparation,
     * confirmation, SEND, replacement image or automatic retry is used. */
    CompletableFuture<ReferencePixels> prepareReferencePixels(ReferenceImageDraft.Snapshot draft,BooleanSupplier live){
        return connect().thenCompose(c->submit(references,()->{
            WorldPatchSend.allowed(live);ReferencePixelPreparationReceipt.capabilities(pixelJson(c,"/v1/reference-pixels/capabilities",null,4096));
            String body=ReferencePixelPreparationReceipt.request(draft).toString();if(body.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>33554432+65536)throw new IllegalStateException("纯图片传输组超限");
            WorldPatchSend.allowed(live);String prefix="/v1/reference-drafts/"+draft.ownerId();
            var manifest=ReferencePixelPreparationReceipt.verify(draft,pixelJson(c,prefix+"/pixels",body,65536));
            String set=prefix+"/sets/"+ReferencePreparationReceipt.text(manifest,"setHash");var images=new ArrayList<ReferenceImageNormalizer.Result>();
            for(int i=0;i<draft.photos().size();i++){
                WorldPatchSend.allowed(live);current(c);var record=manifest.getAsJsonArray("references").get(i).getAsJsonObject();
                var response=send(c,builder(c,set+"/images/"+ReferencePreparationReceipt.text(record,"id"),60).build(),ReferenceImageNormalizer.MAX_OUTPUT_BYTES);
                if(response.statusCode()!=200)throw new IllegalStateException("原规范化图片读取失败；不换图或发送模型");
                images.add(ReferencePreparationReceipt.pixels(draft.photos().get(i),record,response.body()));
            }
            WorldPatchSend.allowed(live);ReferencePreparationReceipt.same(manifest,ReferencePixelPreparationReceipt.verify(draft,pixelJson(c,set,null,65536)));
            current(c);WorldPatchSend.allowed(live);return new ReferencePixels(manifest,images);
        }));
    }
    /** Pixels/base64/JSON/HTTP/verification stay off the rendering thread and
     * cannot queue ahead of cancellation, normal discovery or world reads. */
    CompletableFuture<ReferencePreparation> prepareReference(ReferenceImageDraft.Snapshot draft,JsonObject generation,JsonObject ordinaryPolicy){
        var exact=generation.deepCopy();var policy=ordinaryPolicy.deepCopy();
        return connect().thenCompose(c->submit(references,()->{
            current(c);var input=new JsonObject();input.addProperty("format","ReferenceGenerationPreparationRequest");input.addProperty("version",2);input.add("generation",exact);input.add("upload",draft.upload());
            String body=input.toString();if(body.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>33554432+65536)throw new IllegalStateException("参考图传输组超限");return body;
        }).thenCompose(body->json(c,"POST","/v1/reference-drafts/"+draft.ownerId()+"/prepare",body)).thenCompose(response->submit(references,()->{
            current(c);var prepared=ReferencePreparationReceipt.verify(draft,exact,policy,response);var images=new ArrayList<ReferenceImageNormalizer.Result>();
            for(int i=0;i<draft.photos().size();i++){
                var record=prepared.getAsJsonArray("references").get(i).getAsJsonObject();String route="/v1/reference-drafts/"+draft.ownerId()+"/preparations/"+ReferencePreparationReceipt.text(prepared,"preparationHash")+"/images/"+ReferencePreparationReceipt.text(record,"id");
                var actual=send(c,builder(c,route,60).build(),ReferenceImageNormalizer.MAX_OUTPUT_BYTES);if(actual.statusCode()!=200)throw new IllegalStateException("原准备图片读取失败；未发送模型");
                images.add(ReferencePreparationReceipt.pixels(draft.photos().get(i),record,actual.body()));
            }
            return new ReferencePreparation(prepared,images);
        })));
    }
    CompletableFuture<JsonObject> confirmReference(JsonObject preparation){
        var p=preparation.deepCopy();return request("POST","/v1/reference-drafts/"+ReferencePreparationReceipt.text(p,"ownerId")+"/preparations/"+ReferencePreparationReceipt.text(p,"preparationHash")+"/confirm",ReferencePreparationReceipt.freeConfirmation(p))
            .thenApply(receipt->ReferencePreparationReceipt.verifyFreeConfirmation(p,receipt));
    }
    CompletableFuture<Boolean> referenceSendingEnabled(){return request("GET","/v1/reference-generation-jobs/capabilities",null).thenApply(ReferencePreparationReceipt::sendingEnabled);}
    /** Only read exact archive history on the bounded reference lane. No
     * historical accepted flag is ever converted to a POST by these readers. */
    private CompletableFuture<JsonObject> readReferenceArchive(String route,UnaryOperator<JsonObject> verify){
        return connect().thenCompose(c->referenceArchiveExchange(c,"GET",route,null,verify,()->{}));
    }
    private CompletableFuture<JsonObject> referenceArchiveExchange(Connection c,String method,String route,String body,UnaryOperator<JsonObject> verify,Runnable before){
        return submit(references,()->{
            current(c);before.run();var builder=builder(c,route,60);
            if(method.equals("POST"))builder.header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(body));
            else if(!method.equals("GET"))throw new IllegalArgumentException("Unsupported archive method");
            var response=send(c,builder.build(),131072);
            String reply=java.nio.charset.StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(response.body())).toString();
            var result=WorldPatchCandidateReceipt.strictJson(reply,()->Thread.currentThread().isInterrupted()).getAsJsonObject();
            if(response.statusCode()!=200)throw new IllegalStateException(result.has("error")?ReferencePreparationReceipt.text(result,"error"):"原草稿记录无法读取，HTTP "+response.statusCode());
            var checked=verify.apply(result);current(c);return checked;
        });
    }
    CompletableFuture<JsonObject> referenceArchiveCapabilities(){return readReferenceArchive("/v1/reference-archives/capabilities",ReferenceArchiveReceipt::capabilities);}
    CompletableFuture<ReferenceImageRestoreReceipt.Loaded> readReferenceImagesForNewDraft(JsonObject selectedSnapshot,String selectedPreparation){
        final JsonObject s;
        try{s=ReferenceImageRestoreReceipt.selectedSnapshot(selectedSnapshot.deepCopy(),selectedPreparation);}
        catch(Exception e){return CompletableFuture.failedFuture(e);}
        return readReferenceArchive("/v1/reference-image-restore/capabilities",ReferenceImageRestoreReceipt::capabilities)
            .thenCompose(ignored->connect()).thenCompose(c->submit(references,()->{
                current(c);String owner=ReferencePreparationReceipt.text(s,"ownerId");
                // Both snapshots must be the separately selected ORIGINAL
                // scope. GET never creates/continues storage or model work.
                var before=readReferenceRestoreSnapshot(c,owner);ReferencePreparationReceipt.same(before,s);
                String prefix="/v1/reference-drafts/"+owner+"/preparations/"+selectedPreparation;
                var raw=send(c,builder(c,prefix+"/record",60).build(),ReferenceImageRestoreReceipt.RECORD_BYTES);
                if(raw.statusCode()!=200)throw new IllegalStateException("原图片准备文件不可读取；未替换、恢复或发送");
                var p=ReferenceImageRestoreReceipt.record(s,selectedPreparation,raw.body());var photos=new ArrayList<ReferenceImageDraft.Photo>();
                for(int i=0;i<p.getAsJsonArray("references").size();i++){
                    current(c);var r=p.getAsJsonArray("references").get(i).getAsJsonObject();
                    var image=send(c,builder(c,prefix+"/images/"+ReferencePreparationReceipt.text(r,"id"),60).build(),ReferenceImageNormalizer.MAX_OUTPUT_BYTES);
                    if(image.statusCode()!=200)throw new IllegalStateException("准确原图片读取失败；不改用其他准备版本");
                    photos.add(ReferenceImageRestoreReceipt.photo(s,p,i,image.body()));
                }
                var after=readReferenceRestoreSnapshot(c,owner);ReferencePreparationReceipt.same(after,s);current(c);
                return new ReferenceImageRestoreReceipt.Loaded(p,photos);
            }));
    }
    private JsonObject readReferenceRestoreSnapshot(Connection c,String owner)throws Exception {
        current(c);var response=send(c,builder(c,"/v1/reference-drafts/"+owner+"/archive",60).build(),131072);
        if(response.statusCode()!=200)throw new IllegalStateException("原准备范围已不可核验；保留当前编辑");
        var utf8=java.nio.charset.StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT);
        var snapshot=WorldPatchCandidateReceipt.strictJson(utf8.decode(ByteBuffer.wrap(response.body())).toString(),()->Thread.currentThread().isInterrupted()).getAsJsonObject();
        current(c);return ReferenceArchiveReceipt.snapshot(owner,snapshot);
    }
    CompletableFuture<JsonObject> referenceDraftArchives(){return readReferenceArchive("/v1/reference-drafts",ReferenceArchiveReceipt::listing);}
    CompletableFuture<JsonObject> referenceArchiveSnapshot(String selectedOwner){
        try{ReferenceArchiveReceipt.owner(selectedOwner);}catch(Exception e){return CompletableFuture.failedFuture(e);}
        return readReferenceArchive("/v1/reference-drafts/"+selectedOwner+"/archive",value->ReferenceArchiveReceipt.snapshot(selectedOwner,value));
    }
    CompletableFuture<JsonObject> referenceArchiveRecord(String selectedOwner,String selectedAction,String selectedSnapshotHash){
        try{ReferenceArchiveReceipt.owner(selectedOwner);ReferenceArchiveReceipt.owner(selectedAction);
            if(selectedSnapshotHash==null||!selectedSnapshotHash.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("必须使用原归档清单 hash；不会查询替代记录");
        }catch(Exception e){return CompletableFuture.failedFuture(e);}
        return readReferenceArchive("/v1/reference-drafts/"+selectedOwner+"/archive/"+selectedAction+"/record",value->ReferenceArchiveReceipt.record(selectedOwner,selectedAction,selectedSnapshotHash,value));
    }
    CompletableFuture<JsonObject> referenceArchiveMaintenanceSnapshot(JsonObject originalRecord,String purpose){
        final JsonObject original;final String owner,action;
        try{
            owner=ReferencePreparationReceipt.text(originalRecord,"ownerId");action=ReferencePreparationReceipt.text(originalRecord,"actionId");
            original=ReferenceArchiveReceipt.record(owner,action,ReferencePreparationReceipt.text(originalRecord.getAsJsonObject("originalIntent").getAsJsonObject("snapshot"),"snapshotHash"),originalRecord);
            if(!Set.of("restore","purge").contains(purpose)||!original.get("maintenance").isJsonNull()||!ReferencePreparationReceipt.text(original.getAsJsonObject("status"),"state").equals("archived"))
                throw new IllegalStateException("已有维护操作或归档未完成；只查询原操作，不开始替代操作");
        }catch(Exception e){return CompletableFuture.failedFuture(e);}
        return readReferenceArchive("/v1/reference-drafts/"+owner+"/archive/"+action+"/"+purpose,value->ReferenceArchiveReceipt.maintenanceSnapshot(
            original.getAsJsonObject("originalIntent").getAsJsonObject("snapshot"),original.getAsJsonObject("originalIntent").getAsJsonObject("confirmation"),purpose,value));
    }
    CompletableFuture<List<JsonObject>> referenceArchiveActions(){return submit(references,()->new ReferenceArchiveActions(data).list());}
    private static void archiveActionAllowed(BooleanSupplier live){if(live==null||!live.getAsBoolean())throw new CancellationException("确认界面已变化；原操作保留，不发送替代操作");}
    private static String archiveActionRoute(JsonObject r){
        String prefix="/v1/reference-drafts/"+ReferencePreparationReceipt.text(r,"ownerId")+"/archive";
        return ReferencePreparationReceipt.text(r,"purpose").equals("archive")?prefix:prefix+"/"+ReferencePreparationReceipt.text(r,"archiveActionId")+"/"+ReferencePreparationReceipt.text(r,"purpose");
    }
    CompletableFuture<JsonObject> readReferenceArchiveAction(JsonObject input){
        final JsonObject r;try{r=ReferenceArchiveReceipt.verifyActionReference(input.deepCopy());}catch(Exception e){return CompletableFuture.failedFuture(e);}
        String action=ReferencePreparationReceipt.text(r,"actionId");
        if(ReferencePreparationReceipt.text(r,"purpose").equals("archive"))return referenceArchiveRecord(ReferencePreparationReceipt.text(r,"ownerId"),action,
            ReferencePreparationReceipt.text(r.getAsJsonObject("snapshot"),"snapshotHash")).thenApply(record->record.getAsJsonObject("status").deepCopy());
        return readReferenceArchive(archiveActionRoute(r)+"/"+action,value->ReferenceArchiveReceipt.actionResult(r,value));
    }
    /** Explicit player confirmation only. Remember BEFORE exchange; a second
     * start or restart only queries the original, even after a lost reply. */
    CompletableFuture<JsonObject> startReferenceArchiveAction(JsonObject input,BooleanSupplier live){return referenceArchiveAction(input,live,false);}
    /** A separate user button may continue the SAME original storage action.
     * It can never create a new action ID, call a model or authorize a world. */
    CompletableFuture<JsonObject> continueReferenceArchiveAction(JsonObject input,BooleanSupplier live){return referenceArchiveAction(input,live,true);}
    private CompletableFuture<JsonObject> referenceArchiveAction(JsonObject input,BooleanSupplier live,boolean explicitContinuation){
        final JsonObject r;final String body;
        try{archiveActionAllowed(live);r=ReferenceArchiveReceipt.verifyActionReference(input.deepCopy());body=ContextReceipt.canonicalJson(r.getAsJsonObject("confirmation"));
            if(body.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>4096)throw new IllegalArgumentException("原操作确认超限；未发送");
        }catch(Exception e){return CompletableFuture.failedFuture(e);}
        return referenceArchiveCapabilities().thenCompose(cap->{
            archiveActionAllowed(live);if(ReferencePreparationReceipt.number(cap,"version")!=3)throw new IllegalStateException("此配套缺少准确原操作记录能力；不开始操作");
            return connect();
        }).thenCompose(c->submit(references,()->{
            current(c);archiveActionAllowed(live);var originals=new ReferenceArchiveActions(data);
            if(explicitContinuation){originals.remember(r);return true;}return originals.claim(r);
        }).thenCompose(first->first?referenceArchiveExchange(c,"POST",archiveActionRoute(r),body,value->ReferenceArchiveReceipt.actionResult(r,value),()->archiveActionAllowed(live)):
            readReferenceArchiveAction(r)));
    }
    record ReferenceHistory(JsonObject history,List<ReferenceImageNormalizer.Result> images){
        ReferenceHistory{history=history.deepCopy();images=List.copyOf(images);}
        @Override public JsonObject history(){return history.deepCopy();}
    }
    CompletableFuture<ReferenceHistory> readReferenceHistory(JsonObject originalJob){
        var original=originalJob.deepCopy();final String id;
        try{id=ReferencePreparationReceipt.text(original,"id");if(!id.matches("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")||!StudioReferenceHistory.reference(original))throw new IllegalArgumentException("明确的原图片任务身份才可读取历史");}
        catch(Exception e){return CompletableFuture.failedFuture(e);}
        return connect().thenCompose(c->submit(references,()->{
            current(c);String prefix="/v1/reference-generation-jobs/"+id;var response=send(c,builder(c,prefix+"/history",60).build(),1048576);if(response.statusCode()!=200)throw new IllegalStateException("原图片历史读取失败；不会重发任务");
            var history=ReferenceJobHistoryReceipt.verify(original,JsonParser.parseString(new String(response.body(),java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject());var images=new ArrayList<ReferenceImageNormalizer.Result>();
            for(var image:history.getAsJsonObject("manifest").getAsJsonArray("references")){current(c);var record=image.getAsJsonObject();var actual=send(c,builder(c,prefix+"/images/"+ReferencePreparationReceipt.text(record,"id"),60).build(),ReferenceImageNormalizer.MAX_OUTPUT_BYTES);if(actual.statusCode()!=200)throw new IllegalStateException("原任务图片读取失败；不换图或重发");images.add(ReferenceJobHistoryReceipt.pixels(record,actual.body()));}
            current(c);return new ReferenceHistory(history,images);
        }));
    }
    /** The reader already serialized immutable raw JSON off the server tick.
     * Encode/hash/upload/parse only on a separate context lane, not rendering. */
    public CompletableFuture<JsonObject> saveContext(SelectionReadService.Capture capture){return context(capture,true);}
    public CompletableFuture<JsonObject> readContext(SelectionReadService.Capture capture){return context(capture,false);}
    public CompletableFuture<JsonObject> prepareContextTask(SelectionReadService.Capture capture,JsonObject intent){
        var exact=intent.deepCopy();return readContext(capture).thenCompose(saved->request("POST","/v1/world-contexts/"+capture.id()+"/task-disclosure",exact)
            .thenApply(prepared->ContextTaskReceipt.verify(capture,saved,exact,prepared)));
    }
    public CompletableFuture<JsonObject> confirmContextTask(SelectionReadService.Capture capture,JsonObject prepared){
        var exact=prepared.deepCopy();return readContext(capture).thenCompose(saved->{
            ContextTaskReceipt.verify(capture,saved,exact.getAsJsonObject("request").getAsJsonObject("intent"),exact);
            var input=new JsonObject();input.addProperty("confirmed",true);var disclosure=exact.getAsJsonObject("disclosure");
            input.add("disclosureHash",disclosure.get("disclosureHash"));input.add("task",disclosure.get("recipient"));
            return request("POST","/v1/world-contexts/"+capture.id()+"/confirm-disclosure",input).thenApply(response->ContextTaskReceipt.verifyConsent(exact,response));
        });
    }
    /** Pure GET of an exact original receipt; never resubmits generation. */
    public CompletableFuture<JsonObject> readContextAnalysis(JsonObject reference){
        final JsonObject exact;try{exact=reference.deepCopy();ContextAnalysisReceipt.verifyReference(exact);}catch(Exception e){return CompletableFuture.failedFuture(e);}
        return request("GET","/v1/context-analysis/"+exact.get("requestHash").getAsString(),null).thenApply(status->ContextAnalysisReceipt.verify(exact,status));
    }
    public CompletableFuture<Boolean> contextAnalysisEnabled(){return request("GET","/v1/context-analysis/capabilities",null).thenApply(value->{
        if(!value.keySet().equals(Set.of("format","version","requestVersion","enabled","maximumCalls","automaticRetries","canAuthorizePlacement"))
            ||!value.get("format").isJsonPrimitive()||!value.get("format").getAsJsonPrimitive().isString()||!value.get("format").getAsString().equals("WorldContextAnalysisCapabilities")||!exactNumber(value,"version",1)
            ||!exactNumber(value,"requestVersion",2)||!exactNumber(value,"maximumCalls",1)||!exactNumber(value,"automaticRetries",0)
            ||!value.get("enabled").isJsonPrimitive()||!value.get("enabled").getAsJsonPrimitive().isBoolean()
            ||!value.get("canAuthorizePlacement").isJsonPrimitive()||!value.get("canAuthorizePlacement").getAsJsonPrimitive().isBoolean()||value.get("canAuthorizePlacement").getAsBoolean())throw new IllegalStateException("Unsupported read-only analysis capability");
        return value.get("enabled").getAsBoolean();
    });}
    private static boolean exactNumber(JsonObject value,String field,int expected){var part=value.get(field);return part!=null&&part.isJsonPrimitive()&&part.getAsJsonPrimitive().isNumber()&&part.getAsString().equals(Integer.toString(expected));}
    public CompletableFuture<List<JsonObject>> contextAnalysisHistory(){return submit(contexts,()->new ContextAnalysisReferences(data).list());}
    /** Explicit send only. A durable original reference is committed BEFORE
     * the final environment checks and POST. Later attempts only GET. */
    public CompletableFuture<JsonObject> sendContextAnalysis(Supplier<CompletableFuture<SelectionReadService.Capture>> current,
            JsonObject prepared,JsonObject consent,BooleanSupplier live){
        final JsonObject exact,approval,reference,input;
        try{
            ContextAnalysisSend.allowed(live);exact=prepared.deepCopy();approval=consent.deepCopy();reference=ContextAnalysisReceipt.reference(exact);ContextTaskReceipt.verifyConsent(exact,approval);
            input=new JsonObject();input.add("contextId",reference.get("contextId"));input.add("consentId",approval.get("id"));input.add("requestHash",reference.get("requestHash"));
            input.add("disclosureHash",approval.get("disclosureHash"));input.add("intent",exact.getAsJsonObject("request").get("intent").deepCopy());input.addProperty("explicitSend",true);
        }catch(Exception error){return CompletableFuture.failedFuture(error);}
        Supplier<CompletableFuture<Void>> recheck=()->ContextPublication.checked(current,capture->readContext(capture).thenApply(saved->{
            ContextTaskReceipt.verify(capture,saved,exact.getAsJsonObject("request").getAsJsonObject("intent"),exact);ContextTaskReceipt.verifyConsent(exact,approval);return saved;
        })).thenApply(ignored->null);
        return contextAnalysisEnabled().thenCompose(enabled->{
            if(!enabled)throw new IllegalStateException("此配套尚未开放只读分析发送；模型调用 0");
            ContextAnalysisSend.allowed(live);return recheck.get();
        }).thenCompose(ignored->connect()).thenCompose(c->ContextAnalysisSend.once(live,
            ()->submit(contexts,()->{current(c);ContextAnalysisSend.allowed(live);return new ContextAnalysisReferences(data).claim(reference);}),recheck,
            ()->json(c,"POST","/v1/world-contexts/"+reference.get("contextId").getAsString()+"/send-analysis",ContextReceipt.canonicalJson(input),()->{
                ContextAnalysisSend.allowed(live);ContextTaskReceipt.verifyConsent(exact,approval);
            }).thenApply(status->ContextAnalysisReceipt.verify(reference,status)),()->readContextAnalysis(reference)));
    }
    /** Only after a separate player confirmation; no new generation call. */
    public CompletableFuture<JsonObject> observeContextAnalysis(JsonObject reference,BooleanSupplier live){
        final JsonObject exact;try{exact=ContextAnalysisReceipt.verifyReference(reference.deepCopy());ContextAnalysisSend.allowed(live);}catch(Exception e){return CompletableFuture.failedFuture(e);}
        return readContextAnalysis(exact).thenCompose(status->{
            if(!status.get("state").getAsString().equals("unknown")||!status.get("canObserveOriginal").getAsBoolean())throw new IllegalStateException("没有可观察的原 turn；不生成替代任务");
            var input=new JsonObject();input.addProperty("confirmed",true);return connect().thenCompose(c->json(c,"POST","/v1/context-analysis/"+exact.get("requestHash").getAsString()+"/observe-original",input.toString(),()->ContextAnalysisSend.allowed(live)))
                .thenApply(value->ContextAnalysisReceipt.verify(exact,value));
        });
    }
    private CompletableFuture<JsonObject> context(SelectionReadService.Capture capture,boolean save){
        if(capture==null||capture.canAuthorizePlacement()||!capture.id().matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"))return CompletableFuture.failedFuture(new IllegalArgumentException("Invalid read-only context identity"));
        return connect().thenCompose(c->submit(contexts,()->{
            current(c);byte[] bytes=capture.payload().getBytes(java.nio.charset.StandardCharsets.UTF_8);if(bytes.length>SelectionLimits.snapshotBytes())throw new IllegalStateException("Context payload byte quota exceeded");
            var b=builder(c,"/v1/world-contexts/"+capture.id()+"/"+(save?"capture":"record"),60);if(save)b.header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofByteArray(bytes));
            var r=send(c,b.build(),2*1024*1024);var result=JsonParser.parseString(new String(r.body(),java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
            if(r.statusCode()>=400)throw new IllegalStateException(result.has("error")?result.get("error").getAsString():"Context HTTP "+r.statusCode());return ContextReceipt.verify(capture,bytes,result);
        }));
    }
    CompletableFuture<JsonObject> preparePatchTask(SelectionReadService.Capture capture,JsonObject intent){
        var exact=intent.deepCopy();return readContext(capture).thenCompose(saved->request("POST","/v1/world-contexts/"+capture.id()+"/patch-task-disclosure",exact)
            .thenApply(value->WorldPatchTaskReceipt.verify(capture,saved,exact,value)));
    }
    CompletableFuture<JsonObject> freezePatchTask(SelectionReadService.Capture capture,JsonObject prepared){
        var exact=prepared.deepCopy();var intent=exact.getAsJsonObject("task").getAsJsonObject("request").getAsJsonObject("intent");
        return readContext(capture).thenCompose(saved->{WorldPatchTaskReceipt.verify(capture,saved,intent,exact);var approval=WorldPatchTaskReceipt.confirmation(exact);
            var input=new JsonObject();input.add("intent",intent);input.add("confirmation",approval);
            return request("POST","/v1/world-contexts/"+capture.id()+"/patch-freeze-task",input).thenApply(value->WorldPatchTaskReceipt.verifyFrozen(exact,approval,value));
        });
    }
    CompletableFuture<String> patchRuntime(){return request("GET","/v2/world-patch/capabilities",null).thenApply(WorldPatchJobReceipt::sendingCapabilitiesRuntime);}
    CompletableFuture<List<JsonObject>> patchHistory(){return submit(contexts,()->new WorldPatchReferences(data).list());}
    CompletableFuture<JsonObject> readPatchJob(JsonObject reference){
        final JsonObject exact;try{exact=WorldPatchJobReceipt.verifyReference(reference.deepCopy());}catch(Exception e){return CompletableFuture.failedFuture(e);}
        return request("GET","/v2/world-patch/jobs/"+WorldPatchTaskReceipt.text(exact,"capsuleId"),null).thenApply(v->WorldPatchJobReceipt.verify(exact,v));
    }
    /** Only this independent player SEND may reserve one original model call.
     * Commit the local claim first; later attempts query, never send again. */
    CompletableFuture<WorldPatchSubmission> sendPatch(Supplier<CompletableFuture<SelectionReadService.Capture>> capture,JsonObject prepared,JsonObject frozen,String runtimeHash,BooleanSupplier live,
            BiFunction<SelectionReadService.Capture,JsonObject,CompletableFuture<SelectionReadService.PatchRetention>> retain){
        final JsonObject exact,original;
        try{WorldPatchSend.allowed(live);exact=prepared.deepCopy();original=WorldPatchTaskReceipt.verifyFrozen(exact,WorldPatchTaskReceipt.confirmation(exact),frozen.deepCopy());}
        catch(Exception e){return CompletableFuture.failedFuture(e);}
        return patchRuntime().thenCompose(currentRuntime->{
            WorldPatchSend.allowed(live);if(currentRuntime==null||!currentRuntime.equals(runtimeHash))throw new IllegalStateException("本机改造能力或 runtime 已改变；不会发送");
            return ContextPublication.checked(capture,cap->readContext(cap).thenApply(saved->{WorldPatchTaskReceipt.verify(cap,saved,exact.getAsJsonObject("task").getAsJsonObject("request").getAsJsonObject("intent"),exact);return WorldPatchJobReceipt.reference(cap,exact,original,runtimeHash);}));
        }).thenCompose(reference->{
            Supplier<CompletableFuture<Void>> recheck=()->ContextPublication.checked(capture,cap->readContext(cap).thenApply(saved->{WorldPatchTaskReceipt.verify(cap,saved,exact.getAsJsonObject("task").getAsJsonObject("request").getAsJsonObject("intent"),exact);return saved;})).thenApply(ignored->null);
            return connect().thenCompose(c->WorldPatchSend.once(live,
                ()->submit(contexts,()->{current(c);WorldPatchSend.allowed(live);return new WorldPatchReferences(data).claim(reference);}),recheck,
                ()->capture.get().thenCompose(cap->{WorldPatchSend.allowed(live);return retain.apply(cap,reference.deepCopy());}).thenCompose(retention->{
                    if(retention==null||retention.canAuthorizePlacement())throw new IllegalStateException("缺少原服务器只读 SEND 保留");
                    return retention.checkedBeforeDispatch().thenCompose(ignored->json(c,"POST","/v2/world-patch/jobs/"+WorldPatchTaskReceipt.text(reference,"capsuleId")+"/send",ContextReceipt.canonicalJson(reference.get("send")),()->{
                        WorldPatchSend.allowed(live);if(System.currentTimeMillis()>=WorldPatchTaskReceipt.number(original,"recordExpiresAt"))throw new IllegalStateException("原快照过期；不会发送");
                        retention.markDispatchAttempted();
                    })).thenApply(v->WorldPatchJobReceipt.verify(reference,v)).whenComplete((value,error)->retention.releaseIfNotDispatched());
                }),()->readPatchJob(reference))).thenApply(status->new WorldPatchSubmission(reference,status));
        });
    }
    CompletableFuture<JsonObject> recoverPatch(JsonObject reference,boolean observe,BooleanSupplier live){
        var exact=WorldPatchJobReceipt.verifyReference(reference.deepCopy());WorldPatchSend.allowed(live);
        return readPatchJob(exact).thenCompose(status->{
            if(observe&&!WorldPatchTaskReceipt.flag(status,"canObserveOriginal")||!observe&&!Set.of("response-retained","completed-checked").contains(WorldPatchTaskReceipt.text(status,"state")))throw new IllegalStateException("没有可恢复的原 turn/完整原响应，不生成替代任务");
            var input=new JsonObject();input.addProperty("confirmed",true);return connect().thenCompose(c->json(c,"POST","/v2/world-patch/jobs/"+WorldPatchTaskReceipt.text(exact,"capsuleId")+(observe?"/observe-original":"/recheck-response"),input.toString(),()->WorldPatchSend.allowed(live))).thenApply(v->WorldPatchJobReceipt.verify(exact,v));
        });
    }
    /** Independent joint lifecycle. Strict decoding and bounded contexts lane;
     * no legacy routes, fallback model, implicit retry or new-world baseline. */
    private CompletableFuture<JsonObject> referencePatchExchange(Connection c,String method,String route,JsonObject input,int maximum,
            UnaryOperator<JsonObject> verify,Runnable before){
        final String body=input==null?null:ContextReceipt.canonicalJson(input);
        if(body!=null&&body.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>32768)return CompletableFuture.failedFuture(new IllegalArgumentException("联合请求超额；未发送"));
        return submit(contexts,()->{
            current(c);before.run();var b=builder(c,route,60);
            if(method.equals("POST"))b.header("Content-Type","application/json; charset=utf-8").POST(HttpRequest.BodyPublishers.ofString(body));
            else if(!method.equals("GET")||body!=null)throw new IllegalArgumentException("联合查询只能无正文 GET");
            var response=send(c,b.build(),maximum);
            String json=java.nio.charset.StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT).decode(ByteBuffer.wrap(response.body())).toString();
            var value=WorldPatchCandidateReceipt.strictJson(json,()->Thread.currentThread().isInterrupted()).getAsJsonObject();
            if(!Set.of(200,202).contains(response.statusCode()))throw new IllegalStateException("联合原操作不可读取，HTTP "+response.statusCode()+"；保留原记录，不补发");
            var checked=verify.apply(value);current(c);return checked.deepCopy();
        });
    }
    CompletableFuture<String> referencePatchRuntime(){
        return connect().thenCompose(c->referencePatchExchange(c,"GET","/v1/reference-world-patch/capabilities",null,16384,
            v->{ReferenceWorldPatchJobReceipt.capabilitiesRuntime(v);return v;},()->{})).thenApply(ReferenceWorldPatchJobReceipt::capabilitiesRuntime);
    }
    CompletableFuture<JsonObject> referencePatchModel(JsonObject selected){
        var exact=selected.deepCopy();return referencePatchRuntime().thenCompose(runtime->{
            if(runtime==null)throw new IllegalStateException("配套尚未开启联合开发协议；未发送模型");
            return connect().thenCompose(c->referencePatchExchange(c,"GET","/v1/agents/codex/models",null,131072,
                models->ReferenceWorldPatchTaskReceipt.advertisedCapability(exact,models,runtime),()->{}));
        });
    }
    CompletableFuture<List<JsonObject>> referencePatchHistory(){return submit(contexts,()->new ReferenceWorldPatchReferences(data).list());}
    CompletableFuture<JsonObject> readReferencePatchJob(JsonObject input){
        final JsonObject r;try{r=ReferenceWorldPatchJobReceipt.verifyReference(input.deepCopy());}catch(Exception e){return CompletableFuture.failedFuture(e);}
        return connect().thenCompose(c->referencePatchExchange(c,"GET","/v1/reference-world-patch/jobs/"+WorldPatchTaskReceipt.text(r,"capsuleId"),null,
            ReferenceWorldPatchJobReceipt.MAX_STATUS_BYTES,v->ReferenceWorldPatchJobReceipt.verify(r,v),()->{}));
    }
    CompletableFuture<JsonObject> prepareReferencePatchTask(SelectionReadService.Capture capture,JsonObject intent,JsonObject manifest,JsonObject capability,BooleanSupplier live){
        var i=intent.deepCopy();var m=manifest.deepCopy();var a=capability.deepCopy();
        var input=new JsonObject();input.add("intent",i);
        return readContext(capture).thenCompose(saved->connect().thenCompose(c->referencePatchExchange(c,"POST",
            "/v1/reference-world-patch/contexts/"+capture.id()+"/disclosure",input,ReferenceWorldPatchTaskReceipt.MAX_BYTES,
            v->ReferenceWorldPatchTaskReceipt.verify(capture,saved,i,m,a,v),()->WorldPatchSend.allowed(live))));
    }
    CompletableFuture<JsonObject> freezeReferencePatchTask(SelectionReadService.Capture capture,JsonObject prepared,JsonObject manifest,JsonObject capability,BooleanSupplier live){
        var p=prepared.deepCopy();var m=manifest.deepCopy();var a=capability.deepCopy();var i=p.getAsJsonObject("task").getAsJsonObject("request").getAsJsonObject("intent").deepCopy();
        return readContext(capture).thenCompose(saved->{
            ReferenceWorldPatchTaskReceipt.verify(capture,saved,i,m,a,p);var approval=ReferenceWorldPatchTaskReceipt.confirmation(p);
            var input=new JsonObject();input.add("intent",i);input.add("confirmation",approval);
            return connect().thenCompose(c->referencePatchExchange(c,"POST","/v1/reference-world-patch/contexts/"+capture.id()+"/freeze",input,16384,
                v->ReferenceWorldPatchTaskReceipt.verifyFrozen(p,approval,v),()->WorldPatchSend.allowed(live)));
        });
    }
    /** Only queries the original provider turn after a separate confirmation.
     * There is deliberately no joint recheck-response route or SEND fallback. */
    CompletableFuture<JsonObject> observeReferencePatch(JsonObject input,BooleanSupplier live){
        final JsonObject r;try{WorldPatchSend.allowed(live);r=ReferenceWorldPatchJobReceipt.verifyReference(input.deepCopy());}catch(Exception e){return CompletableFuture.failedFuture(e);}
        return readReferencePatchJob(r).thenCompose(status->{
            if(!WorldPatchTaskReceipt.text(status,"state").equals("unknown")||!WorldPatchTaskReceipt.flag(status,"canObserveOriginal"))
                throw new IllegalStateException("没有可观察的联合原 turn；不创建替代任务");
            var approval=new JsonObject();approval.addProperty("confirmed",true);
            return connect().thenCompose(c->referencePatchExchange(c,"POST","/v1/reference-world-patch/jobs/"+WorldPatchTaskReceipt.text(r,"capsuleId")+"/observe-original",approval,
                ReferenceWorldPatchJobReceipt.MAX_STATUS_BYTES,v->ReferenceWorldPatchJobReceipt.verify(r,v),()->WorldPatchSend.allowed(live)));
        });
    }
    private static JsonObject referencePatchImages(JsonObject r,JsonObject manifest,JsonObject status){
        WorldPatchTaskReceipt.keys(status,"format","version","capsuleId","transportHash","imageHashes","state","modelSent","canAuthorizePlacement");
        if(!WorldPatchTaskReceipt.text(status,"format").equals("ReferenceWorldPatchImageFreezeStatus")||WorldPatchTaskReceipt.number(status,"version")!=1
            ||!WorldPatchTaskReceipt.text(status,"state").equals("images-frozen-not-sent"))throw new IllegalStateException("联合原图冻结协议改变");
        WorldPatchTaskReceipt.no(status,"modelSent","canAuthorizePlacement");WorldPatchTaskReceipt.digest(status,"transportHash");
        WorldPatchTaskReceipt.same(status.get("capsuleId"),r.get("capsuleId"));var expected=new JsonArray();
        for(var image:manifest.getAsJsonArray("references"))expected.add(image.getAsJsonObject().get("sha256"));
        WorldPatchTaskReceipt.same(status.get("imageHashes"),expected);return status;
    }
    /** Persist joint claim BEFORE any dispatch. Images are frozen with zero
     * calls and their original order/hashes checked. The same retained server
     * Capture is fenced before image transfer and again before the sole SEND. */
    CompletableFuture<ReferenceWorldPatchSubmission> sendReferencePatch(Supplier<CompletableFuture<SelectionReadService.Capture>> capture,
            JsonObject prepared,JsonObject frozen,JsonObject manifest,JsonObject capability,String runtimeHash,BooleanSupplier live,
            BiFunction<SelectionReadService.Capture,JsonObject,CompletableFuture<SelectionReadService.PatchRetention>> retain){
        final JsonObject p,original,m,a;
        try{WorldPatchSend.allowed(live);p=prepared.deepCopy();m=manifest.deepCopy();a=capability.deepCopy();
            original=ReferenceWorldPatchTaskReceipt.verifyFrozen(p,ReferenceWorldPatchTaskReceipt.confirmation(p),frozen.deepCopy());
        }catch(Exception e){return CompletableFuture.failedFuture(e);}
        var i=p.getAsJsonObject("task").getAsJsonObject("request").getAsJsonObject("intent");
        return referencePatchRuntime().thenCompose(currentRuntime->{
            WorldPatchSend.allowed(live);if(currentRuntime==null||!currentRuntime.equals(runtimeHash))throw new IllegalStateException("联合 runtime/能力已改变；不发送");
            return ContextPublication.checked(capture,cap->readContext(cap).thenApply(saved->{
                ReferenceWorldPatchTaskReceipt.verify(cap,saved,i,m,a,p);return ReferenceWorldPatchJobReceipt.reference(cap,p,original,runtimeHash);
            }));
        }).thenCompose(r->{
            Supplier<CompletableFuture<Void>> recheck=()->ContextPublication.checked(capture,cap->readContext(cap).thenApply(saved->{
                ReferenceWorldPatchTaskReceipt.verify(cap,saved,i,m,a,p);return saved;
            })).thenApply(ignored->null);
            Runnable gate=()->{WorldPatchSend.allowed(live);if(System.currentTimeMillis()>=WorldPatchTaskReceipt.number(original,"recordExpiresAt"))throw new IllegalStateException("联合原快照过期；不发送");};
            return connect().thenCompose(c->WorldPatchSend.once(live,
                ()->submit(contexts,()->{current(c);WorldPatchSend.allowed(live);return new ReferenceWorldPatchReferences(data).claim(r);}),recheck,
                ()->capture.get().thenCompose(cap->{WorldPatchSend.allowed(live);return retain.apply(cap,r.deepCopy());}).thenCompose(retention->{
                    if(retention==null||retention.canAuthorizePlacement())throw new IllegalStateException("缺少联合原服务器只读保留");
                    return retention.checkedBeforeDispatch().thenCompose(ignored->referencePatchExchange(c,"POST",
                        "/v1/reference-world-patch/tasks/"+WorldPatchTaskReceipt.text(r,"capsuleId")+"/images",r.getAsJsonObject("send"),16384,
                        v->referencePatchImages(r,m,v),gate))
                        .thenCompose(images->retention.checkedBeforeDispatch()).thenCompose(ignored->referencePatchExchange(c,"POST",
                            "/v1/reference-world-patch/jobs/"+WorldPatchTaskReceipt.text(r,"capsuleId")+"/send",r.getAsJsonObject("send"),ReferenceWorldPatchJobReceipt.MAX_STATUS_BYTES,
                            v->ReferenceWorldPatchJobReceipt.verify(r,v),()->{gate.run();retention.markDispatchAttempted();}))
                        .whenComplete((value,error)->retention.releaseIfNotDispatched());
                }),()->readReferencePatchJob(r))).thenApply(status->new ReferenceWorldPatchSubmission(r,status));
        });
    }
    /** Bounded independent read lane. Never calls SEND, resumes a turn or
     * refreshes a world baseline, even if the transfer/parse fails. */
    CompletableFuture<WorldPatchCandidateReceipt.Download> loadPatchPreview(WorldPatchCandidateReceipt.Reference reference,BooleanSupplier cancelled){
        if(reference==null||cancelled==null)return CompletableFuture.failedFuture(new IllegalArgumentException("缺少独立核验的原改造候选"));
        return connect().thenCompose(c->submit(contexts,()->{
            current(c);if(cancelled.getAsBoolean())throw new CancellationException("改造预览已失效");
            String route="/v2/world-patch/jobs/"+reference.capsuleId()+"/preview?candidateHash="+reference.candidateHash();
            var response=send(c,builder(c,route,60).build(),WorldPatchCandidateReceipt.MAX_BYTES);
            if(response.statusCode()!=200)throw new IllegalStateException("原候选预览不可读取，HTTP "+response.statusCode()+"；不会重发生成");
            return WorldPatchCandidateReceipt.parse(response.body(),reference,cancelled);
        }));
    }
    /** Explicit candidate read for static server audit; GET only. No fallback
     * to preview-only data, SEND, repair, rebase or original-turn observation. */
    CompletableFuture<WorldPatchCandidateReceipt.AuditableDownload> loadPatchCandidate(WorldPatchCandidateReceipt.Reference reference,BooleanSupplier cancelled){
        if(reference==null||cancelled==null)return CompletableFuture.failedFuture(new IllegalArgumentException("缺少独立核验的原候选"));
        return connect().thenCompose(c->submit(contexts,()->{
            current(c);if(cancelled.getAsBoolean())throw new CancellationException("原候选加载已失效");
            String route="/v2/world-patch/jobs/"+reference.capsuleId()+"/candidate?candidateHash="+reference.candidateHash();
            var response=send(c,builder(c,route,60).build(),WorldPatchCandidateReceipt.MAX_CANDIDATE_BYTES);
            current(c);
            if(response.statusCode()!=200)throw new IllegalStateException("原候选不可读取，HTTP "+response.statusCode()+"；不会重发或替换模型");
            return WorldPatchCandidateReceipt.parseCandidate(response.body(),reference,cancelled);
        }));
    }
    /** Independent joint GET-only lane. Never promote a legacy text reference,
     * send a model request, rebase the original world or fall back on error. */
    CompletableFuture<ReferenceWorldPatchCandidateReceipt.Download> loadReferencePatchPreview(ReferenceWorldPatchCandidateReceipt.Reference reference,BooleanSupplier cancelled){
        if(reference==null||cancelled==null)return CompletableFuture.failedFuture(new IllegalArgumentException("缺少独立联合候选引用"));
        return connect().thenCompose(c->submit(contexts,()->{
            current(c);if(cancelled.getAsBoolean())throw new CancellationException("联合预览加载已失效");
            String route="/v1/reference-world-patch/jobs/"+reference.capsuleId()+"/preview?candidateHash="+reference.candidateHash();
            var response=send(c,builder(c,route,60).build(),ReferenceWorldPatchCandidateReceipt.MAX_BYTES);current(c);
            if(response.statusCode()!=200)throw new IllegalStateException("联合原预览不可读取，HTTP "+response.statusCode()+"；不会重发生成");
            return ReferenceWorldPatchCandidateReceipt.parse(response.body(),reference,cancelled);
        }));
    }
    CompletableFuture<ReferenceWorldPatchCandidateReceipt.AuditableDownload> loadReferencePatchCandidate(ReferenceWorldPatchCandidateReceipt.Reference reference,BooleanSupplier cancelled){
        if(reference==null||cancelled==null)return CompletableFuture.failedFuture(new IllegalArgumentException("缺少独立联合候选引用"));
        return connect().thenCompose(c->submit(contexts,()->{
            current(c);if(cancelled.getAsBoolean())throw new CancellationException("联合候选加载已失效");
            String route="/v1/reference-world-patch/jobs/"+reference.capsuleId()+"/candidate?candidateHash="+reference.candidateHash();
            var response=send(c,builder(c,route,60).build(),ReferenceWorldPatchCandidateReceipt.MAX_CANDIDATE_BYTES);current(c);
            if(response.statusCode()!=200)throw new IllegalStateException("联合原候选不可读取，HTTP "+response.statusCode()+"；不会重发或替换模型");
            return ReferenceWorldPatchCandidateReceipt.parseCandidate(response.body(),reference,cancelled);
        }));
    }
    /** Query one stable identity, without downloading the entire generation history or resubmitting. */
    public CompletableFuture<JsonObject> lookupTask(String key){
        return lookupOriginalTask(key).thenApply(value->{if(value.pendingReferenceSubmission())throw new IllegalStateException("原参考图 SEND 已保存但未发布；只查询原任务，不重新发送");return value.job();});
    }
    record TaskLookup(JsonObject job,boolean pendingReferenceSubmission,String error) {
        TaskLookup {if(job!=null)job=job.deepCopy();}
        @Override public JsonObject job(){return job==null?null:job.deepCopy();}
    }
    CompletableFuture<TaskLookup> lookupOriginalTask(String key){
        if(key==null||!key.matches("[\\w-]{1,128}"))return CompletableFuture.failedFuture(new IllegalArgumentException("Invalid saved task key; original preserved"));
        return request("GET","/v1/jobs/by-key?key="+key,null).thenApply(r->{
            boolean pending=r.has("pendingReferenceSubmission")&&ReferencePreparationReceipt.flag(r,"pendingReferenceSubmission");
            String error=r.has("error")&&!r.get("error").isJsonNull()?ReferencePreparationReceipt.text(r,"error"):null;
            var value=r.get("job");if(value==null||value.isJsonNull())return new TaskLookup(null,pending,error);
            if(pending)throw new IllegalStateException("原任务查询身份矛盾；不会重发");
            var job=value.getAsJsonObject();
            if(!job.has("key")||!key.equals(job.get("key").getAsString())||!job.has("id")||!job.get("id").getAsString().matches("[0-9a-f-]{36}"))throw new IllegalStateException("Recovered task identity mismatch; no resubmission");
            return new TaskLookup(job,false,error);
        });
    }
    private CompletableFuture<JsonObject> json(Connection c,String method,String route,String body){
        return json(c,method,route,body,()->{});
    }
    private CompletableFuture<JsonObject> json(Connection c,String method,String route,String body,Runnable beforeExchange){
        boolean reference=route.startsWith("/v1/reference-"),slow=route.startsWith("/v1/agents")||route.endsWith("/export"),patch=route.startsWith("/v1/world-patch/")||route.startsWith("/v1/world-contexts/")&&route.contains("/patch-"),context=patch||route.startsWith("/v1/context-analysis/")||route.startsWith("/v1/world-contexts/")&&(route.endsWith("/record")||route.endsWith("/disclosure")||route.endsWith("/confirm-disclosure")||route.endsWith("/task-disclosure"));
        return submit(reference?references:context?contexts:slow?discovery:control,()->{
            current(c);beforeExchange.run();HttpRequest.Builder b=builder(c,route,reference||context?60:slow?30:10);
            if(method.equals("POST"))b.header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(body));else if(!method.equals("GET"))throw new IllegalArgumentException("Unsupported HTTP method");
            var r=send(c,b.build(),route.endsWith("/patch-task-disclosure")?WorldPatchTaskReceipt.MAX_BYTES:4*1024*1024);String reply=java.nio.charset.StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).decode(ByteBuffer.wrap(r.body())).toString();JsonObject result=(patch?WorldPatchCandidateReceipt.strictJson(reply,()->Thread.currentThread().isInterrupted()):JsonParser.parseString(reply)).getAsJsonObject();
            if(r.statusCode()>=400)throw new IllegalStateException(result.has("error")?result.get("error").getAsString():"HTTP "+r.statusCode());return result;
        });
    }
    private HttpRequest.Builder builder(Connection c,String route,int seconds){return HttpRequest.newBuilder(URI.create(c.base+route)).timeout(Duration.ofSeconds(seconds)).header("Authorization","Bearer "+c.token);}
    private HttpResponse<byte[]> send(Connection c,HttpRequest request,int limit)throws Exception{
        try{var r=exchange(request,limit);current(c);if(r.statusCode()==401){invalidate(c);throw new IllegalStateException("Bridge authentication expired; reconnect and query the existing task");}return r;}
        catch(java.io.IOException e){invalidate(c);throw e;}
    }
    private HttpResponse<byte[]> exchange(HttpRequest request,int limit)throws Exception{
        var transfer=http.sendAsync(request,info->new LimitedBody(limit));
        try{return transfer.get(request.timeout().orElse(Duration.ofSeconds(10)).toMillis(),TimeUnit.MILLISECONDS);}
        catch(InterruptedException e){transfer.cancel(true);Thread.currentThread().interrupt();throw e;}
        catch(TimeoutException e){transfer.cancel(true);throw new java.net.http.HttpTimeoutException("Bridge transfer timed out; task was not resubmitted");}
        catch(ExecutionException e){Throwable cause=e.getCause();if(cause instanceof Exception x)throw x;throw e;}
    }
    private synchronized void invalidate(Connection c){if(connection==c){connection=null;epoch.incrementAndGet();}}
    private Connection establish(long ticket)throws Exception{
        if(builtin){var prepared=BuiltinCompanion.prepare(root,s->preparation=s);runtime=prepared.directory();expectedVersion=prepared.version();}
        if(builtin)BuiltinCompanion.directory(data);else Files.createDirectories(data);Path file=data.resolve("connection.json");
        if(Files.exists(file)){
            Connection c=readConnection(file,ticket);
            try{var r=exchange(builder(c,"/v1/health",2).build(),65536);if(r.statusCode()==200){validateHealth(r.body());return c;}
                if(ProcessHandle.of(c.pid).map(ProcessHandle::isAlive).orElse(false))throw new IllegalStateException("Existing Bridge rejected authentication; close/restart that instance before reconnecting");
            }catch(java.io.IOException e){if(ProcessHandle.of(c.pid).map(ProcessHandle::isAlive).orElse(false))throw new IllegalStateException("Existing Bridge is unresponsive; task state is unknown",e);}
        }
        Path node=runtime.resolve("runtime/node.exe"),server=runtime.resolve("bridge/server.mjs");
        if(!Files.isRegularFile(node)||!Files.isRegularFile(server))throw new IllegalStateException("Missing companion. Install voxel-studio folder beside mods (not inside mods).");
        if(closed||ticket!=epoch.get())throw new CancellationException("Connection superseded");
        preparation="正在启动本机服务…";
        Process started=new ProcessBuilder(node.toString(),server.toString(),"--data-dir",data.toString(),"--parent-pid",Long.toString(ProcessHandle.current().pid())).directory(runtime.toFile()).redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.appendTo(data.resolve("bridge.log").toFile())).start();owned=started;
        for(int i=0;i<100;i++){
            if(closed||ticket!=epoch.get()){started.destroy();throw new CancellationException("Connection superseded");}
            if(!started.isAlive())throw new IllegalStateException("Bridge exited; inspect voxel-studio/data/bridge.log");
            if(Files.exists(file))try{Connection c=readConnection(file,ticket);if(c.pid==started.pid()){var r=exchange(builder(c,"/v1/health",2).build(),65536);if(r.statusCode()!=200)throw new IllegalStateException("New Bridge health check failed");validateHealth(r.body());return c;}}
                catch(java.nio.file.NoSuchFileException|JsonParseException ignored){}
            Thread.sleep(100);
        }throw new IllegalStateException("Bridge startup timed out");
    }
    private void validateHealth(byte[] bytes){var h=JsonParser.parseString(new String(bytes,java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();if(h.get("protocol").getAsInt()!=1)throw new IllegalStateException("Unsupported Bridge protocol");if(expectedVersion!=null&&(!h.has("version")||!expectedVersion.equals(h.get("version").getAsString())))throw new IllegalStateException("旧版本 Bridge 仍在运行，请先退出旧游戏/配套后重试；未终止其他进程或修改旧数据");preparation="本机服务已就绪";}
    private static Connection readConnection(Path file,long epoch)throws Exception{
        var c=JsonParser.parseString(Files.readString(file)).getAsJsonObject();int port=c.get("port").getAsInt();String token=c.get("token").getAsString();
        if(c.get("protocol").getAsInt()!=1||port<1||port>65535||!token.matches("[0-9a-f]{64}"))throw new IllegalStateException("Invalid Bridge connection / protocol mismatch");
        return new Connection("http://127.0.0.1:"+port,token,c.get("pid").getAsLong(),epoch);
    }
    public synchronized CompletableFuture<Asset> load(String job){
        return load(job,false);
    }
    public synchronized CompletableFuture<Asset> loadDiagnostic(String job){
        return load(job,true);
    }
    /** Separate render-only download: never cancels or replaces a player's projection. */
    public CompletableFuture<Asset> loadEvidence(String job,NativeEvidenceRequest request){
        try{return loadEvidence(NativeEvidenceTarget.legacy(job,request.hash()),request);}catch(Exception e){return CompletableFuture.failedFuture(e);}
    }
    /** Typed full-task transport, never a legacy job alias, SEND or world read. */
    CompletableFuture<NativeEvidenceRequest> readEvidenceRequest(NativeEvidenceTarget target){
        return connect().thenCompose(c->submit(downloads,()->target.parseRequest(nativeJson(c,"GET",target.memberRoute("request"),null,1048576))));
    }
    CompletableFuture<Asset> loadEvidence(NativeEvidenceTarget target,NativeEvidenceRequest request){
        try{target.requireRequest(request);}catch(Exception e){return CompletableFuture.failedFuture(e);}
        return connect().thenCompose(c->submit(downloads,()->{
            var manifest=nativeJson(c,"GET",target.memberRoute("manifest"),null,1048576);
            if(!request.assetHash().equals(manifest.get("assetHash").getAsString())||!request.sourceHash().equals(manifest.getAsJsonObject("scene").get("sourceHash").getAsString())||!request.cellsHash().equals(manifest.get("cellsHash").getAsString()))throw new IllegalStateException("Render subject changed");
            var response=send(c,builder(c,target.memberRoute("cells"),60).build(),16777216);
            if(response.statusCode()!=200||!response.headers().firstValue("Content-Type").orElse("").equalsIgnoreCase("application/octet-stream"))throw new IllegalStateException("Evidence cells unavailable or wrong media type");
            Asset asset=new Asset(target.jobId(),manifest,response.body());
            if(!asset.diagnosticOnly||asset.width!=request.width()||asset.height!=request.height()||asset.length!=request.length())throw new IllegalStateException("Invalid render-only asset");current(c);return asset;
        }));
    }
    CompletableFuture<Boolean> nativeEvidenceWaiting(NativeEvidenceTarget target){
        return connect().thenCompose(c->submit(downloads,()->target.stillWaiting(nativeJson(c,"GET",target.jobRoute(),null,target.statusBytes()))));
    }
    CompletableFuture<JsonObject> uploadEvidence(NativeEvidenceTarget target,JsonObject upload){
        var exact=upload.deepCopy();
        if(!WorldPatchTaskReceipt.text(exact,"requestHash").equals(target.evidenceId())
            ||!WorldPatchTaskReceipt.text(exact,"renderer").equals(NativeEvidenceRequest.RENDERER))return CompletableFuture.failedFuture(new IllegalArgumentException("Wrong original native upload"));
        String body=exact.toString();if(body.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>12000000)return CompletableFuture.failedFuture(new IllegalArgumentException("Native upload quota exceeded"));
        return connect().thenCompose(c->submit(downloads,()->{
            if(!target.stillWaiting(nativeJson(c,"GET",target.jobRoute(),null,target.statusBytes())))return null;
            return target.verifyUploadReceipt(nativeJson(c,"POST",target.memberRoute("upload"),body,4096));
        }));
    }
    private JsonObject nativeJson(Connection c,String method,String route,String body,int maximum)throws Exception{
        current(c);var request=builder(c,route,60);if(method.equals("POST"))request.header("Content-Type","application/json; charset=utf-8").POST(HttpRequest.BodyPublishers.ofString(body));
        var response=send(c,request.build(),maximum);
        if(response.statusCode()!=200||!response.headers().firstValue("Content-Type").orElse("").toLowerCase(Locale.ROOT).matches("application/json(?:\\s*;.*)?"))throw new IllegalStateException("Original native transport unavailable, HTTP "+response.statusCode()+"; no fallback or model resend");
        String text=java.nio.charset.StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
            .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT).decode(ByteBuffer.wrap(response.body())).toString();
        var value=WorldPatchCandidateReceipt.strictJson(text,()->Thread.currentThread().isInterrupted()).getAsJsonObject();current(c);return value;
    }
    private synchronized CompletableFuture<Asset> load(String job,boolean diagnostic){
        if(!job.matches("[0-9a-f-]{36}"))return CompletableFuture.failedFuture(new IllegalArgumentException("Invalid job id"));cancelLoad();long ticket=loadEpoch.get();
        String route="/v1/jobs/"+job+"/"+(diagnostic?"diagnostic-":"");
        return connect().thenCompose(c->json(c,"GET",route+"manifest","{}").thenCompose(manifest->{synchronized(this){
            if(ticket!=loadEpoch.get())return CompletableFuture.failedFuture(new CancellationException("Asset load superseded"));
            CompletableFuture<Asset> result=submit(downloads,()->{current(c);var r=send(c,builder(c,route+"cells",60).build(),16777216);if(r.statusCode()!=200)throw new IllegalStateException("Invalid cell response: HTTP "+r.statusCode());if(ticket!=loadEpoch.get())throw new CancellationException("Asset load superseded");var asset=new Asset(job,manifest,r.body());if(asset.diagnosticOnly!=diagnostic)throw new IllegalStateException("Unexpected diagnostic asset flag");return asset;});loading=result;return result;
        }}));
    }
    public synchronized void cancelLoad(){loadEpoch.incrementAndGet();if(loading!=null)loading.cancel(true);loading=null;}
    public synchronized void reconnect(){epoch.incrementAndGet();connection=null;connecting=null;cancelLoad();}
    @Override public synchronized void close(){
        Connection c=connection;Process process=owned;closed=true;epoch.incrementAndGet();cancelLoad();control.shutdownNow();discovery.shutdownNow();downloads.shutdownNow();contexts.shutdownNow();references.shutdownNow();connector.shutdownNow();
        // Never block the render thread or shut down a Bridge owned by another instance.
        if(process!=null){Thread t=new Thread(()->{try{if(c!=null&&c.pid==process.pid())http.send(builder(c,"/v1/shutdown",2).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString("{}")).build(),HttpResponse.BodyHandlers.discarding());if(!process.waitFor(3,TimeUnit.SECONDS))process.destroy();}catch(Exception e){process.destroy();}},"voxel-bridge-close");t.setDaemon(true);t.start();}
    }
    static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]>{
        private final int limit;private final ByteArrayOutputStream bytes=new ByteArrayOutputStream();private final CompletableFuture<byte[]> body=new CompletableFuture<>();private Flow.Subscription subscription;
        LimitedBody(int limit){this.limit=limit;}public CompletionStage<byte[]> getBody(){return body;}public void onSubscribe(Flow.Subscription s){subscription=s;s.request(1);}
        public void onNext(List<ByteBuffer> buffers){for(var b:buffers){if(b.remaining()>limit-bytes.size()){subscription.cancel();body.completeExceptionally(new IllegalStateException("Bridge response quota exceeded"));return;}byte[] part=new byte[b.remaining()];b.get(part);bytes.writeBytes(part);}subscription.request(1);}
        public void onError(Throwable t){body.completeExceptionally(t);}public void onComplete(){body.complete(bytes.toByteArray());}
    }
}
