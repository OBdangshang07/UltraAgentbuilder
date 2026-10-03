package dev.voxelstudio.client;

import java.awt.AlphaComposite;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Arrays;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.MemoryCacheImageInputStream;

/** Pure byte-in/pixel-out importer. No filesystem reads, disk cache, UI or
 * network. Call off the game thread only after explicit user file selection.
 * EXIF orientation is deliberately not guessed: rotation is user-selected. */
final class ReferenceImageNormalizer {
    static final int MAX_SOURCE_BYTES=33554432, MAX_SOURCE_DIMENSION=8192;
    static final long MAX_SOURCE_PIXELS=16777216;
    static final int MAX_OUTPUT_DIMENSION=2048, MAX_OUTPUT_BYTES=12582912;
    private static final byte[] PNG={(byte)137,80,78,71,13,10,26,10};

    record Crop(int x,int y,int width,int height) {
        Crop { if(x<0||y<0||width<1||height<1)throw new IllegalArgumentException("Invalid reference crop"); }
    }
    record Result(byte[] png,int width,int height) {
        Result { png=png.clone(); }
        @Override public byte[] png(){return png.clone();}
        int byteSize(){return png.length;}
    }
    record Dimensions(int width,int height) {}
    /** Inspect dimensions before allocation; shares the exact source gates. */
    static Dimensions inspect(byte[] source)throws IOException {
        sourceType(source);
        try(var input=new MemoryCacheImageInputStream(new ByteArrayInputStream(source))) {
            var readers=ImageIO.getImageReaders(input);
            if(!readers.hasNext())throw new IOException("Invalid reference image");
            ImageReader reader=readers.next();
            try {reader.setInput(input,true,true);return dimensions(reader);}
            finally {reader.dispose();}
        }
    }
    private static void sourceType(byte[] source)throws IOException {
        if(source==null||source.length<8||source.length>MAX_SOURCE_BYTES)
            throw new IOException("Reference source byte quota/type rejected");
        boolean png=Arrays.equals(Arrays.copyOf(source,8),PNG);
        boolean jpeg=(source[0]&255)==255&&(source[1]&255)==216&&(source[2]&255)==255;
        if(!png&&!jpeg)throw new IOException("Only PNG/JPEG reference sources supported");
        if(png)checkStaticPng(source);
    }
    private static Dimensions dimensions(ImageReader reader)throws IOException {
        String format=reader.getFormatName();
        if(!format.equalsIgnoreCase("png")&&!format.equalsIgnoreCase("jpeg")&&!format.equalsIgnoreCase("jpg"))
            throw new IOException("Reference decoder format mismatch");
        int width=reader.getWidth(0),height=reader.getHeight(0);
        if(width<1||height<1||width>MAX_SOURCE_DIMENSION||height>MAX_SOURCE_DIMENSION||(long)width*height>MAX_SOURCE_PIXELS)
            throw new IOException("Reference source pixel quota exceeded");
        return new Dimensions(width,height);
    }
    static Result normalize(byte[] source,Crop crop,int quarterTurns)throws IOException {
        sourceType(source);
        if(quarterTurns<0||quarterTurns>3)throw new IllegalArgumentException("Explicit quarter-turn rotation required");
        BufferedImage decoded;
        // This stream cannot spill to java.io.tmpdir or change ImageIO globals.
        try(var input=new MemoryCacheImageInputStream(new ByteArrayInputStream(source))) {
            var readers=ImageIO.getImageReaders(input);
            if(!readers.hasNext())throw new IOException("Invalid reference image");
            ImageReader reader=readers.next();
            try {
                reader.setInput(input,true,true);
                var size=dimensions(reader);int width=size.width(),height=size.height();
                if(crop!=null&&((long)crop.x()+crop.width()>width||(long)crop.y()+crop.height()>height))
                    throw new IllegalArgumentException("Reference crop exceeds source image");
                decoded=reader.read(0);
                if(decoded==null||decoded.getWidth()!=width||decoded.getHeight()!=height)
                    throw new IOException("Reference decoded dimensions differ");
            } finally {reader.dispose();}
        }
        int x=crop==null?0:crop.x(),y=crop==null?0:crop.y();
        int width=crop==null?decoded.getWidth():crop.width(),height=crop==null?decoded.getHeight():crop.height();
        int rotatedWidth=quarterTurns%2==0?width:height,rotatedHeight=quarterTurns%2==0?height:width;
        // Crop/rotate directly into a bounded output; no second full-source copy.
        double scale=Math.min(1d,(double)MAX_OUTPUT_DIMENSION/Math.max(rotatedWidth,rotatedHeight));
        int outputWidth=Math.max(1,(int)Math.round(rotatedWidth*scale)),outputHeight=Math.max(1,(int)Math.round(rotatedHeight*scale));
        BufferedImage result=new BufferedImage(outputWidth,outputHeight,BufferedImage.TYPE_INT_ARGB);
        Graphics2D graphics=result.createGraphics();
        try {
            graphics.setComposite(AlphaComposite.Src);
            graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION,RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            graphics.scale((double)outputWidth/rotatedWidth,(double)outputHeight/rotatedHeight);
            switch(quarterTurns) {
                case 1 -> {graphics.translate(height,0);graphics.rotate(Math.PI/2);}
                case 2 -> {graphics.translate(width,height);graphics.rotate(Math.PI);}
                case 3 -> {graphics.translate(0,width);graphics.rotate(-Math.PI/2);}
                default -> { }
            }
            graphics.drawImage(decoded.getSubimage(x,y,width,height),0,0,null);
        } finally {graphics.dispose();decoded.flush();}
        byte[] bytes;
        try(var output=new ByteArrayOutputStream()) {
            if(!ImageIO.write(result,"png",output))throw new IOException("Reference PNG writer unavailable");
            bytes=output.toByteArray();
        } finally {result.flush();}
        if(bytes.length>MAX_OUTPUT_BYTES)throw new IOException("Normalized reference byte quota exceeded");
        return new Result(bytes,outputWidth,outputHeight);
    }
    private static void checkStaticPng(byte[] source)throws IOException {
        int at=8;boolean ended=false;
        while(at+12<=source.length){
            long count=Integer.toUnsignedLong(java.nio.ByteBuffer.wrap(source,at,4).getInt());
            if(count>source.length-at-12L)throw new IOException("Truncated reference source PNG");
            String type=new String(source,at+4,4,java.nio.charset.StandardCharsets.US_ASCII);
            if(type.equals("acTL")||type.equals("fcTL")||type.equals("fdAT"))throw new IOException("Animated PNG references are not supported");
            at+=(int)count+12;
            if(type.equals("IEND")){if(count!=0||at!=source.length)throw new IOException("Invalid reference source PNG end");ended=true;break;}
        }
        if(!ended)throw new IOException("Incomplete reference source PNG");
    }
}
