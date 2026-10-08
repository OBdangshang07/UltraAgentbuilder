package dev.voxelstudio.client;

import com.google.gson.*;
import java.util.*;
import static dev.voxelstudio.client.ReferencePreparationReceipt.*;

/** Pixel-only storage is neither ordinary generation consent nor joint SEND.
 * Verify the independently retained local edits and then every decoded pixel. */
final class ReferencePixelPreparationReceipt {
    static JsonObject request(ReferenceImageDraft.Snapshot snapshot){
        var value=new JsonObject();value.addProperty("format","ReferencePixelPreparationRequest");value.addProperty("version",1);value.add("upload",snapshot.upload());return value;
    }
    static void capabilities(JsonObject c){
        keys(c,"format","version","pixelPreparationImplemented","modelDiscovery","modelCalls","worldWrites","generationAuthorityTransferred","canAuthorizePlacement","limits");
        if(!text(c,"format").equals("ReferencePixelPreparationCapabilities")||number(c,"version")!=1||!flag(c,"pixelPreparationImplemented")
            ||flag(c,"modelDiscovery")||number(c,"modelCalls")!=0||number(c,"worldWrites")!=0||flag(c,"generationAuthorityTransferred")||flag(c,"canAuthorizePlacement"))throw new IllegalStateException("纯图片接口不能授予模型或世界权限");
        var l=c.getAsJsonObject("limits");keys(l,"inputBytes","maximumImages","lanes");if(number(l,"inputBytes")!=33554432+65536||number(l,"maximumImages")!=4||number(l,"lanes")!=1)throw new IllegalStateException("纯图片接口配额不符");
    }
    static JsonObject verify(ReferenceImageDraft.Snapshot snapshot,JsonObject manifest){
        keys(manifest,"format","version","ownerId","mode","references","pixels","bytes","metadataRemoved","untrustedData","worldCaptured","canAuthorizePlacement","setHash");
        if(!text(manifest,"format").equals("UserReferenceSet")||number(manifest,"version")!=1||!text(manifest,"ownerId").equals(snapshot.ownerId())||!text(manifest,"mode").equals(snapshot.mode())
            ||!flag(manifest,"metadataRemoved")||!flag(manifest,"untrustedData")||flag(manifest,"worldCaptured")||flag(manifest,"canAuthorizePlacement"))throw new IllegalStateException("不是当前只读图片组");
        hash(manifest,"setHash");var records=manifest.getAsJsonArray("references");if(records.size()!=snapshot.photos().size())throw new IllegalStateException("图片数量改变");
        long pixels=0,bytes=0;
        for(int i=0;i<records.size();i++){
            var r=records.get(i).getAsJsonObject();keys(r,"id","file","sha256","width","height","bytes","annotation");hash(r,"id");digest(r,"sha256");
            var photo=snapshot.photos().get(i);same(r.get("annotation"),photo.annotation());
            if(!text(r,"file").equals("image-"+i+".png")||number(r,"width")!=photo.output().width()||number(r,"height")!=photo.output().height()
                ||number(r,"bytes")<45||number(r,"bytes")>ReferenceImageNormalizer.MAX_OUTPUT_BYTES)throw new IllegalStateException("图片顺序、大小或编辑改变");
            pixels+=number(r,"width")*number(r,"height");bytes+=number(r,"bytes");
        }
        if(pixels>ReferenceImageDraft.MAX_SET_PIXELS||bytes>ReferenceImageDraft.MAX_SET_BYTES||pixels!=number(manifest,"pixels")||bytes!=number(manifest,"bytes"))throw new IllegalStateException("图片组总量不符");
        return manifest.deepCopy();
    }
    private ReferencePixelPreparationReceipt(){}
}
