package dev.voxelstudio;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Data-only render authorization. It never confers projection/placement rights. */
public record NativeEvidenceRequest(String hash,String assetHash,String sourceHash,String cellsHash,int width,int height,int length,List<View> views) {
    public static final String RENDERER="minecraft-1.20.1-block-models-v1";
    public record View(String id,String purpose,float yaw,float pitch,List<Integer> min,List<Integer> max) {}
    private static int integer(JsonElement e){if(!e.isJsonPrimitive()||!e.getAsJsonPrimitive().isNumber())throw new IllegalArgumentException("Expected integer");return e.getAsBigDecimal().intValueExact();}
    public static NativeEvidenceRequest parse(JsonObject input)throws Exception{
        var data=input.deepCopy();String digest=data.remove("requestHash").getAsString();
        if(!digest.matches("[a-f0-9]{64}")||!Asset.sha(Asset.canonical(data).getBytes(StandardCharsets.UTF_8)).equals(digest)||!"NativeEvidenceRequest".equals(data.get("format").getAsString())||integer(data.get("version"))!=1||!RENDERER.equals(data.get("renderer").getAsString())||data.get("canAuthorizePlacement").getAsBoolean())throw new IllegalArgumentException("Native request identity mismatch");
        for(String k:List.of("sourceHash","assetHash","cellsHash"))if(!data.get(k).getAsString().matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Invalid native subject hash");
        var dims=data.getAsJsonObject("dimensions");int w=integer(dims.get("width")),h=integer(dims.get("height")),l=integer(dims.get("length"));
        if(w<1||w>256||h<1||h>384||l<1||l>256||(long)w*h*l>8388608)throw new IllegalArgumentException("Native dimensions exceed quota");
        var items=data.getAsJsonArray("views");if(items.size()<4||items.size()>8)throw new IllegalArgumentException("Native view quota");
        List<View> views=new ArrayList<>();Set<String> ids=new HashSet<>();int[] extent={w,h,l};
        for(var item:items){var v=item.getAsJsonObject();String id=v.get("id").getAsString(),purpose=v.get("purpose").getAsString();float yaw=v.get("yaw").getAsFloat(),pitch=v.get("pitch").getAsFloat();
            if(!id.matches("[a-z][a-z0-9-]{0,31}")||!ids.add(id)||!List.of("exterior","entry","typical-floor","special-floor","section","facade-detail").contains(purpose)||integer(v.get("width"))!=512||integer(v.get("height"))!=512||!Float.isFinite(yaw)||Math.abs(yaw)>360||!Float.isFinite(pitch)||Math.abs(pitch)>90)throw new IllegalArgumentException("Invalid native camera");
            var a=v.getAsJsonArray("min");var b=v.getAsJsonArray("max");if(a.size()!=3||b.size()!=3)throw new IllegalArgumentException("Invalid native clip");
            List<Integer> min=new ArrayList<>(),max=new ArrayList<>();for(int i=0;i<3;i++){int lo=integer(a.get(i)),hi=integer(b.get(i));if(lo<0||hi<=lo||hi>extent[i])throw new IllegalArgumentException("Native clip outside asset");min.add(lo);max.add(hi);}
            views.add(new View(id,purpose,yaw,pitch,List.copyOf(min),List.copyOf(max)));
        }
        return new NativeEvidenceRequest(digest,data.get("assetHash").getAsString(),data.get("sourceHash").getAsString(),data.get("cellsHash").getAsString(),w,h,l,List.copyOf(views));
    }
}
