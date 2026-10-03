package dev.voxelstudio.client;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ReferenceImageNormalizerTest {
    private static byte[] image(int width,int height,String format)throws Exception{
        BufferedImage image=new BufferedImage(width,height,format.equals("jpeg")?BufferedImage.TYPE_INT_RGB:BufferedImage.TYPE_INT_ARGB);
        image.setRGB(0,0,0xffff0000);image.setRGB(width-1,0,0xff00ff00);image.setRGB(0,height-1,0xff0000ff);image.setRGB(width-1,height-1,0xffffffff);
        try(var out=new ByteArrayOutputStream()){assertTrue(ImageIO.write(image,format,out));return out.toByteArray();}finally{image.flush();}
    }
    @Test void pngAndJpegBecomeDecodedPngWithoutGlobalDiskCacheChanges()throws Exception{
        boolean before=ImageIO.getUseCache();
        for(String format:new String[]{"png","jpeg"}){
            var result=ReferenceImageNormalizer.normalize(image(7,5,format),null,0);
            assertEquals(7,result.width());assertEquals(5,result.height());
            BufferedImage decoded=ImageIO.read(new ByteArrayInputStream(result.png()));assertNotNull(decoded);assertEquals(7,decoded.getWidth());decoded.flush();
        }
        assertEquals(before,ImageIO.getUseCache());
    }
    @Test void exactQuarterTurnsPreserveTheExpectedCornerPixels()throws Exception{
        byte[] source=image(3,2,"png");int[][] expected={{0xffff0000,0xff00ff00,0xff0000ff,0xffffffff},{0xff0000ff,0xffff0000,0xffffffff,0xff00ff00},{0xffffffff,0xff0000ff,0xff00ff00,0xffff0000},{0xff00ff00,0xffffffff,0xffff0000,0xff0000ff}};
        for(int turn=0;turn<4;turn++){
            var result=ReferenceImageNormalizer.normalize(source,null,turn);BufferedImage decoded=ImageIO.read(new ByteArrayInputStream(result.png()));
            assertEquals(turn%2==0?3:2,result.width());assertEquals(turn%2==0?2:3,result.height());
            assertArrayEquals(expected[turn],new int[]{decoded.getRGB(0,0),decoded.getRGB(decoded.getWidth()-1,0),decoded.getRGB(0,decoded.getHeight()-1),decoded.getRGB(decoded.getWidth()-1,decoded.getHeight()-1)});decoded.flush();
        }
    }
    @Test void cropAndDownsampleAreBoundedAndExplicit()throws Exception{
        var crop=new ReferenceImageNormalizer.Crop(0,0,2,2);assertEquals(2,ReferenceImageNormalizer.normalize(image(7,5,"png"),crop,0).width());
        var scaled=ReferenceImageNormalizer.normalize(image(4096,2048,"png"),null,0);assertEquals(2048,scaled.width());assertEquals(1024,scaled.height());
        assertThrows(IllegalArgumentException.class,()->ReferenceImageNormalizer.normalize(image(7,5,"png"),new ReferenceImageNormalizer.Crop(6,0,2,1),0));
        assertThrows(IllegalArgumentException.class,()->ReferenceImageNormalizer.normalize(image(2,2,"png"),null,4));
        assertThrows(IllegalArgumentException.class,()->new ReferenceImageNormalizer.Crop(-1,0,1,1));
    }
    @Test void jpegCommentsDoNotSurviveNormalization()throws Exception{
        byte[] original=image(8,8,"jpeg"),secret="EXIF GPS private file C:/secret.png".getBytes(StandardCharsets.US_ASCII);
        var bytes=new ByteArrayOutputStream();bytes.write(original,0,2);bytes.write(new byte[]{(byte)255,(byte)254,0,(byte)(secret.length+2)});bytes.write(secret);bytes.write(original,2,original.length-2);
        var result=ReferenceImageNormalizer.normalize(bytes.toByteArray(),null,0);
        assertFalse(new String(result.png(),StandardCharsets.ISO_8859_1).contains("private file"));
        int at=8;byte[] normalized=result.png();while(at+12<=normalized.length){String type=new String(normalized,at+4,4,StandardCharsets.US_ASCII);assertTrue(Arrays.asList("IHDR","IDAT","IEND").contains(type));int n=java.nio.ByteBuffer.wrap(normalized,at,4).getInt();at+=n+12;}
        assertEquals(normalized.length,at);
    }
    @Test void corruptUnsupportedAndOversizedInputsAreRejected()throws Exception{
        assertThrows(IOException.class,()->ReferenceImageNormalizer.normalize("GIF89a123456789".getBytes(StandardCharsets.US_ASCII),null,0));
        assertThrows(IOException.class,()->ReferenceImageNormalizer.normalize(new byte[ReferenceImageNormalizer.MAX_SOURCE_BYTES+1],null,0));
        byte[] broken=image(2,2,"png");assertThrows(IOException.class,()->ReferenceImageNormalizer.normalize(Arrays.copyOf(broken,18),null,0));
        byte[] bomb=image(1,1,"png");java.nio.ByteBuffer.wrap(bomb,16,4).putInt(9000);assertThrows(IOException.class,()->ReferenceImageNormalizer.normalize(bomb,null,0));
        assertThrows(IOException.class,()->ReferenceImageNormalizer.normalize(image(4097,4097,"png"),null,0));
    }
    @Test void normalizedBytesDoNotAliasTheSourceOrReturnedArray()throws Exception{
        byte[] source=image(2,2,"png"),before=source.clone();var result=ReferenceImageNormalizer.normalize(source,null,0);assertArrayEquals(before,source);
        byte[] output=result.png();output[0]=0;assertNotEquals(0,result.png()[0]);
    }
    @Test void actualJavaPngAndJpegOutputsPassTheNodeReferencePixelProtocol()throws Exception{
        String script="import {normalizeReferencePng} from './bridge/reference-pixels.mjs'; import {REFERENCE_LIMITS as l} from './contracts/reference-attachments.mjs'; let input=''; for await(const c of process.stdin)input+=c; const r=normalizeReferencePng(Buffer.from(input,'base64')); console.log(JSON.stringify({width:r.width,height:r.height,sourceBytes:l.sourceBytes,sourcePixels:l.sourcePixels,sourceDimension:l.sourceDimension,dimension:l.dimension,bytesPerImage:l.bytesPerImage}));";
        for(String format:new String[]{"png","jpeg"}){
            var normalized=ReferenceImageNormalizer.normalize(image(7,5,format),null,1);
            Process node=new ProcessBuilder("node","--input-type=module","-e",script).directory(java.nio.file.Path.of("..").toFile()).redirectErrorStream(true).start();
            try(var input=node.getOutputStream()){input.write(java.util.Base64.getEncoder().encode(normalized.png()));}
            String output=new String(node.getInputStream().readAllBytes(),StandardCharsets.UTF_8);assertEquals(0,node.waitFor(),output);
            var result=com.google.gson.JsonParser.parseString(output).getAsJsonObject();
            assertEquals(normalized.width(),result.get("width").getAsInt());assertEquals(normalized.height(),result.get("height").getAsInt());
            assertEquals(ReferenceImageNormalizer.MAX_SOURCE_BYTES,result.get("sourceBytes").getAsInt());assertEquals(ReferenceImageNormalizer.MAX_SOURCE_PIXELS,result.get("sourcePixels").getAsLong());
            assertEquals(ReferenceImageNormalizer.MAX_SOURCE_DIMENSION,result.get("sourceDimension").getAsInt());assertEquals(ReferenceImageNormalizer.MAX_OUTPUT_DIMENSION,result.get("dimension").getAsInt());assertEquals(ReferenceImageNormalizer.MAX_OUTPUT_BYTES,result.get("bytesPerImage").getAsInt());
        }
    }
}
