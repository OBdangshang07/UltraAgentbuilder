package dev.voxelstudio.client;

import com.google.gson.*;
import java.io.IOException;
import java.util.*;

/** Local, bounded photo draft. Never contains generation or world authority.
 * No filename/path/EXIF is part of the model upload. Explicit local saves may
 * retain original source bytes; they never restore preparation/SEND authority. */
final class ReferenceImageDraft {
    static final int MAX_IMAGES=4,MAX_SET_BYTES=25165824;
    static final long MAX_SET_PIXELS=12582912;
    static final List<String> MODES=List.of("reconstruct","inspire","multi-view"),
        PURPOSES=List.of("exterior","interior","plan","style"),VIEWS=List.of("front","side","rear","aerial","section","unknown"),
        DIMENSIONS=List.of("height","width","bay");
    static final class Source {
        private final byte[] original;
        final ReferenceImageNormalizer.Dimensions dimensions;
        final ReferenceImageNormalizer.Result full;
        Source(byte[] bytes)throws IOException {
            original=bytes.clone();dimensions=ReferenceImageNormalizer.inspect(original);
            full=ReferenceImageNormalizer.normalize(original,null,0);
        }
        ReferenceImageNormalizer.Result transform(ReferenceImageNormalizer.Crop crop,int turns)throws IOException {
            return crop==null&&turns==0?full:ReferenceImageNormalizer.normalize(original,crop,turns);
        }
        byte[] originalBytes(){return original.clone();}
    }
    record Photo(String id,Source source,ReferenceImageNormalizer.Crop crop,int turns,ReferenceImageNormalizer.Result output,JsonObject annotation) {
        Photo {annotation=annotation.deepCopy();}
        @Override public JsonObject annotation(){return annotation.deepCopy();}
    }
    record Snapshot(String ownerId,long revision,String mode,List<Photo> photos) {
        Snapshot {photos=List.copyOf(photos);quotas(photos);if(photos.isEmpty())throw new IllegalStateException("请先导入至少一张参考图");}
        JsonObject upload(){
            var out=new JsonObject();out.addProperty("format","UserReferenceUpload");out.addProperty("version",1);out.addProperty("mode",mode);
            var images=new JsonArray();for(var photo:photos){var item=new JsonObject();item.addProperty("png",Base64.getEncoder().encodeToString(photo.output().png()));item.add("annotation",photo.annotation());images.add(item);}out.add("references",images);return out;
        }
    }
    private String ownerId=UUID.randomUUID().toString();
    private final List<Photo> photos=new ArrayList<>();
    private long revision;
    private String mode="inspire";
    synchronized String ownerId(){return ownerId;}
    synchronized long revision(){return revision;}
    synchronized String mode(){return mode;}
    synchronized List<Photo> photos(){return List.copyOf(photos);}
    synchronized Snapshot snapshot(){return new Snapshot(ownerId,revision,mode,photos);}
    synchronized boolean current(Snapshot exact){return exact!=null&&ownerId.equals(exact.ownerId())&&revision==exact.revision();}
    synchronized void mode(String value){if(!MODES.contains(value))throw new IllegalArgumentException("未知参考方式");if(!mode.equals(value)){mode=value;revision++;}}
    synchronized Photo photo(String id){return photos.stream().filter(p->p.id().equals(id)).findFirst().orElseThrow(()->new IllegalStateException("参考图已移除"));}
    synchronized String add(Source source,long expectedRevision){
        expected(expectedRevision);if(photos.size()>=MAX_IMAGES)throw new IllegalStateException("最多导入四张参考图");
        var annotation=annotation("exterior","unknown","",null,null);String id=UUID.randomUUID().toString();
        var next=new ArrayList<>(photos);next.add(new Photo(id,source,null,0,source.full,annotation));quotas(next);photos.clear();photos.addAll(next);revision++;return id;
    }
    synchronized void transform(String id,ReferenceImageNormalizer.Crop crop,int turns,ReferenceImageNormalizer.Result result,long expectedRevision){
        expected(expectedRevision);var old=photo(id);var next=new ArrayList<>(photos);int index=photos.indexOf(old);
        next.set(index,new Photo(id,old.source(),crop,turns,result,old.annotation()));quotas(next);photos.clear();photos.addAll(next);revision++;
    }
    synchronized void annotate(String id,JsonObject annotation){
        var old=photo(id);validateAnnotation(annotation);if(old.annotation().equals(annotation))return;
        photos.set(photos.indexOf(old),new Photo(id,old.source(),old.crop(),old.turns(),old.output(),annotation));revision++;
    }
    synchronized void remove(String id){photos.remove(photo(id));revision++;}
    synchronized void move(String id,int direction){int at=photos.indexOf(photo(id)),to=Math.max(0,Math.min(photos.size()-1,at+direction));if(at!=to){Collections.swap(photos,at,to);revision++;}}
    synchronized void clear(){if(!photos.isEmpty()){photos.clear();revision++;}}
    synchronized void restore(String restoredMode,List<Photo> restored,long expectedRevision){
        expected(expectedRevision);if(!MODES.contains(restoredMode)||restored.isEmpty())throw new IllegalArgumentException("无效的本机图片草稿");quotas(restored);
        // Restoring pictures is a NEW draft, not recovery/resubmission of an old
        // model task. Every old prepared confirmation becomes invalid.
        ownerId=UUID.randomUUID().toString();mode=restoredMode;photos.clear();photos.addAll(restored);revision++;
    }
    @FunctionalInterface interface Publication {void run()throws Exception;}
    synchronized void publishIfCurrent(Snapshot exact,Publication publication)throws Exception {
        if(!current(exact))throw new IllegalStateException("图片草稿已改变；旧保存未覆盖磁盘草稿");publication.run();
    }
    private void expected(long value){if(value!=revision)throw new IllegalStateException("图片草稿已改变；丢弃旧后台结果，不覆盖新编辑");}
    private static void quotas(List<Photo> photos){
        if(photos.size()>MAX_IMAGES)throw new IllegalArgumentException("参考图数量超限");long pixels=0,bytes=0;
        for(var p:photos){pixels+=(long)p.output().width()*p.output().height();bytes+=p.output().byteSize();}
        if(pixels>MAX_SET_PIXELS||bytes>MAX_SET_BYTES)throw new IllegalArgumentException("图片组超限；请裁剪或移除图片后重试（总计 ≤12.6 百万像素 / 24 MiB）");
    }
    static JsonObject annotation(String purpose,String view,String caption,String dimension,String meters){
        var out=new JsonObject();out.addProperty("purpose",purpose);out.addProperty("view",view);out.addProperty("caption",caption);
        if(meters!=null&&!meters.isBlank()){
            double number;try{number=Double.parseDouble(meters.trim());}catch(NumberFormatException e){throw new IllegalArgumentException("已知尺度必须是米制数字");}
            if(!Double.isFinite(number)||number<=0||number>4096)throw new IllegalArgumentException("已知尺度应大于 0 且不超过 4096 米");
            var scale=new JsonObject();scale.addProperty("dimension",dimension);scale.addProperty("meters",number);out.add("scale",scale);
        }
        validateAnnotation(out);return out;
    }
    static void validateAnnotation(JsonObject a){
        if(a==null||!a.keySet().containsAll(Set.of("purpose","view","caption"))||!Set.of("purpose","view","caption","scale").containsAll(a.keySet())
            ||!PURPOSES.contains(a.get("purpose").getAsString())||!VIEWS.contains(a.get("view").getAsString())
            ||!a.get("caption").isJsonPrimitive()||!a.get("caption").getAsJsonPrimitive().isString()||a.get("caption").getAsString().length()>500
            ||a.get("caption").getAsString().matches("(?s).*[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f].*"))throw new IllegalArgumentException("参考图标注无效");
        if(a.has("scale")){var s=a.getAsJsonObject("scale");double n=s.get("meters").getAsDouble();if(!s.keySet().equals(Set.of("dimension","meters"))||!DIMENSIONS.contains(s.get("dimension").getAsString())||!Double.isFinite(n)||n<=0||n>4096)throw new IllegalArgumentException("参考图尺度无效");}
    }
    /** Crop drag coordinates are fractions of the full unrotated source, not
     * the downsampled preview or currently rotated output. */
    static ReferenceImageNormalizer.Crop crop(ReferenceImageNormalizer.Dimensions size,double x0,double y0,double x1,double y1){
        for(double n:new double[]{x0,y0,x1,y1})if(!Double.isFinite(n))throw new IllegalArgumentException("无效裁剪坐标");
        int x=Math.min(size.width()-1,(int)Math.floor(Math.max(0,Math.min(1,Math.min(x0,x1)))*size.width()));
        int y=Math.min(size.height()-1,(int)Math.floor(Math.max(0,Math.min(1,Math.min(y0,y1)))*size.height()));
        int right=Math.max(x+1,(int)Math.ceil(Math.max(0,Math.min(1,Math.max(x0,x1)))*size.width()));
        int bottom=Math.max(y+1,(int)Math.ceil(Math.max(0,Math.min(1,Math.max(y0,y1)))*size.height()));
        return new ReferenceImageNormalizer.Crop(x,y,Math.min(size.width(),right)-x,Math.min(size.height(),bottom)-y);
    }
}
