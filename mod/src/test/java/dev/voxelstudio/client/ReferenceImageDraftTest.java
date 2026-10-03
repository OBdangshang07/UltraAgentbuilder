package dev.voxelstudio.client;

import com.google.gson.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.file.*;
import java.util.*;
import javax.imageio.ImageIO;
import static org.junit.jupiter.api.Assertions.*;

class ReferenceImageDraftTest {
    @TempDir Path temporary;
    static byte[] png(int width,int height)throws Exception {
        var image=new BufferedImage(width,height,BufferedImage.TYPE_INT_ARGB);image.setRGB(0,0,0xffe63322);image.setRGB(width-1,height-1,0xff3355dd);
        try(var out=new ByteArrayOutputStream()){ImageIO.write(image,"png",out);return out.toByteArray();}finally{image.flush();}
    }
    @Test void snapshotsAreImmutablePathlessAndAnyRealEditInvalidatesConfirmation()throws Exception {
        var draft=new ReferenceImageDraft();var source=new ReferenceImageDraft.Source(png(7,5));String id=draft.add(source,0);var snapshot=draft.snapshot();assertTrue(draft.current(snapshot));
        String upload=snapshot.upload().toString();assertFalse(upload.contains("source"));assertFalse(upload.contains("path"));assertFalse(upload.contains("filename"));assertFalse(upload.contains("EXIF"));
        var annotation=ReferenceImageDraft.annotation("exterior","front","保留窗墙比例，不上传文件路径","height","224");draft.annotate(id,annotation);assertFalse(draft.current(snapshot));assertEquals("",snapshot.photos().get(0).annotation().get("caption").getAsString());
        var newSnapshot=draft.snapshot();annotation.addProperty("caption","changed externally");assertTrue(draft.current(newSnapshot));assertFalse(draft.photo(id).annotation().get("caption").getAsString().contains("externally"));
        draft.mode("reconstruct");assertFalse(draft.current(newSnapshot));var before=draft.snapshot();draft.mode("reconstruct");assertTrue(draft.current(before));
    }
    @Test void staleImportsAndTransformsNeverOverwriteNewEdits()throws Exception {
        var draft=new ReferenceImageDraft();var source=new ReferenceImageDraft.Source(png(7,5));String id=draft.add(source,0);long previous=draft.revision();
        draft.annotate(id,ReferenceImageDraft.annotation("style","side","新版标注",null,null));
        assertThrows(IllegalStateException.class,()->draft.add(source,previous));assertThrows(IllegalStateException.class,()->draft.transform(id,null,0,source.full,previous));assertEquals(1,draft.photos().size());assertEquals("新版标注",draft.photo(id).annotation().get("caption").getAsString());
    }
    @Test void cropMapsFullSourceNotDownsampledOrRotatedOutput()throws Exception {
        var source=new ReferenceImageDraft.Source(png(4096,2048));assertEquals(2048,source.full.width());assertEquals(1024,source.full.height());
        var crop=ReferenceImageDraft.crop(source.dimensions,.75,.75,.25,.25);assertEquals(new ReferenceImageNormalizer.Crop(1024,512,2048,1024),crop);
        var output=source.transform(crop,1);assertEquals(1024,output.width());assertEquals(2048,output.height());
        var edge=ReferenceImageDraft.crop(source.dimensions,-20,-20,20,20);assertEquals(new ReferenceImageNormalizer.Crop(0,0,4096,2048),edge);
        var last=ReferenceImageDraft.crop(source.dimensions,1,1,1,1);assertEquals(new ReferenceImageNormalizer.Crop(4095,2047,1,1),last);
        assertThrows(IllegalArgumentException.class,()->ReferenceImageDraft.crop(source.dimensions,Double.NaN,0,1,1));
    }
    @Test void orderedFourImagesAndRemoveClearNeverDeleteOriginalFiles()throws Exception {
        var draft=new ReferenceImageDraft();var source=new ReferenceImageDraft.Source(png(3,2));var ids=new ArrayList<String>();for(int i=0;i<4;i++)ids.add(draft.add(source,draft.revision()));
        assertThrows(IllegalStateException.class,()->draft.add(source,draft.revision()));draft.move(ids.get(3),-1);assertEquals(ids.get(3),draft.photos().get(2).id());draft.remove(ids.get(0));assertEquals(3,draft.photos().size());draft.clear();assertTrue(draft.photos().isEmpty());assertThrows(IllegalStateException.class,draft::snapshot);
        Path file=temporary.resolve("原始 图片.png");Files.write(file,png(3,2));var read=ReferenceImageIO.read(file.toAbsolutePath().toString());assertEquals(3,read.dimensions.width());assertTrue(Files.exists(file));assertEquals(read.full.width(),ReferenceImageNormalizer.inspect(read.full.png()).width());
    }
    @Test void aggregateQuotasCannotBeBypassedByCompressibleImages()throws Exception {
        var draft=new ReferenceImageDraft();var source=new ReferenceImageDraft.Source(png(2048,2048));for(int i=0;i<3;i++)draft.add(source,draft.revision());
        assertThrows(IllegalArgumentException.class,()->draft.add(source,draft.revision()));assertEquals(3,draft.photos().size());
        var snapshot=draft.snapshot();assertEquals(12582912,snapshot.photos().stream().mapToLong(p->(long)p.output().width()*p.output().height()).sum());
    }
    @Test void annotationScaleAndSourceRestrictionsAreStrict()throws Exception {
        for(String value:new String[]{"NaN","Infinity","-1","0","4097","unknown"})assertThrows(IllegalArgumentException.class,()->ReferenceImageDraft.annotation("exterior","front","","height",value));
        assertThrows(IllegalArgumentException.class,()->ReferenceImageDraft.annotation("exterior","front","\u0000",null,null));assertThrows(IllegalArgumentException.class,()->ReferenceImageDraft.annotation("exterior","front","x".repeat(501),null,null));
        assertThrows(IllegalArgumentException.class,()->ReferenceImageIO.read("relative.png"));assertThrows(IllegalArgumentException.class,()->ReferenceImageIO.read("https://example.com/photo.png"));assertThrows(IllegalArgumentException.class,()->ReferenceImageIO.read("\\\\server\\share\\photo.png"));assertThrows(IllegalArgumentException.class,()->ReferenceImageIO.read(temporary.toAbsolutePath().toString()));
        Path wrong=temporary.resolve("not-a-png.png");Files.writeString(wrong,"not a picture");assertThrows(java.io.IOException.class,()->ReferenceImageIO.read(wrong.toString()));
    }
}
