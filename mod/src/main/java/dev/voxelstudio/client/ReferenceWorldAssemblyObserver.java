package dev.voxelstudio.client;

import com.google.gson.JsonObject;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.function.*;
import static dev.voxelstudio.client.WorldPatchTaskReceipt.*;

/** Client-tick observer of original references only. There is deliberately no
 * SEND, model discovery, replacement baseline, candidate import or world API.
 * Closing a screen does not retire this observer; client shutdown does. */
final class ReferenceWorldAssemblyObserver {
    record View(JsonObject reference,JsonObject status,String message,boolean reading) {
        View {reference=reference.deepCopy();status=status==null?null:status.deepCopy();}
        @Override public JsonObject reference(){return reference.deepCopy();}
        @Override public JsonObject status(){return status==null?null:status.deepCopy();}
    }
    private static final int MAXIMUM=8,INTERVAL=40,MAX_DELAY=200;
    private static final class Entry {
        final JsonObject reference;JsonObject status;String message="只查询原任务；尚无已核验回执，不代表没有调用";
        boolean needsRead=true;int failures;long next;
        Entry(JsonObject reference){this.reference=reference;}
    }
    private final Supplier<CompletableFuture<List<JsonObject>>> history;
    private final Function<JsonObject,CompletableFuture<JsonObject>> query;
    private final Consumer<Runnable> client;
    private final BiConsumer<JsonObject,JsonObject> evidence;
    private final Map<String,Entry> entries=new LinkedHashMap<>();
    private long ticks,epoch;private boolean initialized,historyReading,reading,closed;
    private String historyMessage="本地完整联合引用尚未读取";
    ReferenceWorldAssemblyObserver(Supplier<CompletableFuture<List<JsonObject>>> history,
            Function<JsonObject,CompletableFuture<JsonObject>> query,Consumer<Runnable> client,
            BiConsumer<JsonObject,JsonObject> evidence){
        this.history=Objects.requireNonNull(history);this.query=Objects.requireNonNull(query);
        this.client=Objects.requireNonNull(client);this.evidence=Objects.requireNonNull(evidence);
    }
    synchronized void watch(JsonObject input,JsonObject status){
        if(closed)return;
        var reference=ReferenceWorldAssemblyReceipt.verifyReference(input.deepCopy());
        var checked=status==null?null:ReferenceWorldAssemblyReceipt.status(reference,status.deepCopy());
        String id=text(reference,"id");var entry=entries.get(id);
        if(entry!=null&&!entry.reference.equals(reference))throw new IllegalStateException("原完整任务引用不能重新绑定");
        if(entry==null){if(entries.size()>=MAXIMUM)throw new IllegalStateException("完整联合观察额度已满；不驱逐原记录");entries.put(id,entry=new Entry(reference));}
        if(checked!=null)accept(entry,checked);
    }
    private void accept(Entry entry,JsonObject status){
        // A stale page must not roll an already accepted FINAL back to running.
        if(entry.status!=null&&text(entry.status,"state").equals("preview-ready")&&!entry.status.equals(status)){
            if(!text(status,"state").equals("preview-ready")||!entry.status.get("candidate").equals(status.get("candidate")))
                throw new IllegalStateException("原完整成品不能被迟到状态回退或替换");
        }
        entry.status=status.deepCopy();entry.failures=0;entry.next=ticks+INTERVAL;
        entry.needsRead=text(status,"format").equals("ReferenceWorldAssemblyRunnerStatus")&&text(status,"state").equals("running");
        entry.message="原回执已核验；关闭面板继续，未知只查询原任务，不重新生成";
        evidence.accept(entry.reference.deepCopy(),status.deepCopy());
    }
    synchronized View view(JsonObject input){
        var reference=ReferenceWorldAssemblyReceipt.verifyReference(input.deepCopy());var entry=entries.get(text(reference,"id"));
        if(entry==null||!entry.reference.equals(reference))throw new IllegalStateException("没有匹配的原完整观察引用");
        return new View(entry.reference,entry.status,entry.message,reading&&entry==active);
    }
    private Entry active;
    synchronized void refresh(JsonObject reference){watch(reference,null);if(closed)return;var entry=entries.get(text(reference,"id"));entry.needsRead=true;entry.next=ticks;}
    synchronized String historyMessage(){return historyMessage;}
    synchronized CompletableFuture<List<JsonObject>> reloadHistory(){
        if(closed)return CompletableFuture.failedFuture(new IllegalStateException("客户端观察已关闭"));
        if(historyReading)return CompletableFuture.failedFuture(new IllegalStateException("原完整引用正在读取，不开启替代读取"));
        initialized=true;historyReading=true;long ticket=epoch;var result=new CompletableFuture<List<JsonObject>>();
        try{history.get().whenComplete((values,error)->client.accept(()->{
            synchronized(this){
                if(closed||ticket!=epoch){result.completeExceptionally(new IllegalStateException("客户端观察已关闭，迟到历史不采用"));return;}
                historyReading=false;
                try{
                    if(error!=null)throw new IllegalStateException("原完整历史核验失败；文件保留，不修复或重发",error);
                    if(values==null||values.size()>MAXIMUM)throw new IllegalStateException("原完整历史超额或缺失");
                    var checked=new ArrayList<JsonObject>();var ids=new HashSet<String>();
                    for(var value:values){var r=ReferenceWorldAssemblyReceipt.verifyReference(value.deepCopy());String id=text(r,"id");
                        if(!ids.add(id)||entries.containsKey(id)&&!entries.get(id).reference.equals(r))throw new IllegalStateException("原历史身份重复或被替换");checked.add(r);}
                    if(entries.size()+checked.stream().filter(r->!entries.containsKey(text(r,"id"))).count()>MAXIMUM)throw new IllegalStateException("原观察额度已满；不驱逐记录");
                    for(var r:checked)watch(r,null);
                    historyMessage=checked.isEmpty()?"暂无本地原完整联合引用":"已核验原完整引用；重启后仅 GET 原任务，不接管执行或补发";
                    result.complete(checked.stream().map(JsonObject::deepCopy).toList());
                }catch(Exception rejected){historyMessage="原完整历史被拒绝；保留原文件，不修复、不生成";result.completeExceptionally(rejected);}
            }
        }));}catch(Exception error){historyReading=false;historyMessage="原完整历史读取失败；保留，不生成";result.completeExceptionally(error);}
        return result;
    }
    synchronized void tick(){
        if(closed)return;ticks++;
        if(!initialized)reloadHistory();
        if(reading)return;
        for(var entry:entries.values())if(entry.needsRead&&ticks>=entry.next){
            reading=true;active=entry;long ticket=epoch;
            try{query.apply(entry.reference.deepCopy()).whenComplete((status,error)->client.accept(()->complete(entry,ticket,status,error)));}
            catch(Exception error){complete(entry,ticket,null,error);}return;
        }
    }
    private synchronized void complete(Entry entry,long ticket,JsonObject status,Throwable error){
        if(closed||ticket!=epoch||active!=entry)return;reading=false;active=null;
        try{if(error!=null)throw new IllegalStateException("原 GET 回执未确认",error);accept(entry,ReferenceWorldAssemblyReceipt.status(entry.reference,status.deepCopy()));}
        catch(Exception rejected){entry.failures=Math.min(entry.failures+1,4);entry.next=ticks+Math.min(MAX_DELAY,INTERVAL*(1<<entry.failures));entry.needsRead=true;
            entry.message="原回执读取失败或身份不符；保留最后已核验状态，仅继续 GET 原任务，不重发或更换模型";}
    }
    synchronized void close(){closed=true;epoch++;reading=false;active=null;historyReading=false;}
}
