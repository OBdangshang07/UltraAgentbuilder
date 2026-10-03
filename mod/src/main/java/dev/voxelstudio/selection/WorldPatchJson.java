package dev.voxelstudio.selection;

import com.google.gson.*;
import com.google.gson.stream.*;
import java.io.*;
import java.nio.*;
import java.nio.charset.*;
import java.util.*;
import java.util.function.BooleanSupplier;

/** Bounded strict worker parser. No duplicate fields, lossy UTF-8, floating
 * coordinates, executable content or caller-selectable parsing policy. */
final class WorldPatchJson {
    static void cancelled(BooleanSupplier cancelled){if(cancelled.getAsBoolean()||Thread.currentThread().isInterrupted())throw new java.util.concurrent.CancellationException("Patch audit cancelled");}
    static JsonObject parse(byte[] bytes,BooleanSupplier cancelled){
        Objects.requireNonNull(bytes);Objects.requireNonNull(cancelled);cancelled(cancelled);
        if(bytes.length==0||bytes.length>SelectionLimits.snapshotBytes())throw new IllegalArgumentException("Patch byte quota exceeded");
        final String value;try{value=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();}
        catch(CharacterCodingException error){throw new IllegalArgumentException("Patch UTF-8 is incomplete",error);}
        try(var reader=new JsonReader(new StringReader(value))){reader.setLenient(false);var parsed=read(reader,0,new int[]{0},cancelled);
            if(reader.peek()!=JsonToken.END_DOCUMENT||!parsed.isJsonObject())throw new IllegalArgumentException("One complete patch object required");return parsed.getAsJsonObject();
        }catch(IOException error){throw new IllegalArgumentException("Patch JSON is incomplete",error);}
    }
    private static JsonElement read(JsonReader reader,int depth,int[] count,BooleanSupplier cancelled)throws IOException{
        if(depth>32||++count[0]>2_000_000)throw new IllegalArgumentException("Patch JSON quota exceeded");if((count[0]&1023)==0)cancelled(cancelled);
        return switch(reader.peek()){
            case BEGIN_OBJECT->{reader.beginObject();var o=new JsonObject();while(reader.hasNext()){String k=reader.nextName();if(o.has(k))throw new IllegalArgumentException("Duplicate patch field");o.add(k,read(reader,depth+1,count,cancelled));}reader.endObject();yield o;}
            case BEGIN_ARRAY->{reader.beginArray();var a=new JsonArray();while(reader.hasNext())a.add(read(reader,depth+1,count,cancelled));reader.endArray();yield a;}
            case STRING->new JsonPrimitive(reader.nextString());case NUMBER->new JsonPrimitive(new java.math.BigDecimal(reader.nextString()));
            case BOOLEAN->new JsonPrimitive(reader.nextBoolean());case NULL->{reader.nextNull();yield JsonNull.INSTANCE;}
            default->throw new IllegalArgumentException("Invalid patch JSON token");
        };
    }
    static void keys(JsonObject o,String... fields){if(o==null||!o.keySet().equals(Set.of(fields)))throw new IllegalArgumentException("Unknown/missing patch fields");}
    static String text(JsonElement e){if(e==null||!e.isJsonPrimitive()||!e.getAsJsonPrimitive().isString())throw new IllegalArgumentException("Patch string required");return e.getAsString();}
    static long integer(JsonElement e,long min,long max){
        if(e==null||!e.isJsonPrimitive()||!e.getAsJsonPrimitive().isNumber())throw new IllegalArgumentException("Patch integer required");
        try{long value=e.getAsBigDecimal().longValueExact();if(value<min||value>max)throw new IllegalArgumentException("Patch integer out of range");return value;}catch(ArithmeticException error){throw new IllegalArgumentException("Patch integer cannot be truncated",error);}
    }
    static SelectionRegion.Point point(JsonElement e){if(e==null||!e.isJsonArray()||e.getAsJsonArray().size()!=3)throw new IllegalArgumentException("Patch coordinate requires three axes");var a=e.getAsJsonArray();return new SelectionRegion.Point((int)integer(a.get(0),-30000000,30000000),(int)integer(a.get(1),-2048,2048),(int)integer(a.get(2),-30000000,30000000));}
    private WorldPatchJson(){}
}
