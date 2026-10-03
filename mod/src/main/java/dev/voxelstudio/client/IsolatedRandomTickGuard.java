package dev.voxelstudio.client;

import com.google.gson.*;
import java.io.IOException;
import java.nio.file.*;
import java.util.function.IntConsumer;
import java.util.function.IntSupplier;

/** Development-test fixture control, never used by production placement.
 * The caller must verify the isolated world before acquiring this guard. */
final class IsolatedRandomTickGuard implements AutoCloseable {
    private final Path marker;
    private final IntSupplier read;
    private final IntConsumer set;
    final int original;
    final boolean recovered;
    private boolean closed;
    private IsolatedRandomTickGuard(Path marker,IntSupplier read,IntConsumer set,int original,boolean recovered){
        this.marker=marker;this.read=read;this.set=set;this.original=original;this.recovered=recovered;
    }
    static IsolatedRandomTickGuard open(Path marker,String world,IntSupplier read,IntConsumer set)throws IOException {
        boolean recovered=Files.exists(marker);
        if(recovered){
            JsonObject old=JsonParser.parseString(Files.readString(marker)).getAsJsonObject();
            if(old.size()!=3||old.get("version").getAsInt()!=1||!world.equals(old.get("world").getAsString()))throw new IOException("Random-tick fixture marker scope mismatch");
            long saved=old.get("original").getAsLong();
            if(saved<0||saved>Integer.MAX_VALUE)throw new IOException("Invalid original random-tick rule");
            int current=read.getAsInt();
            if(current!=0&&current!=(int)saved)throw new IOException("Random-tick rule changed outside fixture; preserved");
            set.accept((int)saved);
            if(read.getAsInt()!=(int)saved)throw new IOException("Cannot restore previous fixture rule");
            Files.delete(marker);
        }
        int original=read.getAsInt();if(original<0)throw new IOException("Invalid random-tick rule");
        JsonObject saved=new JsonObject();saved.addProperty("version",1);saved.addProperty("world",world);saved.addProperty("original",original);
        Files.writeString(marker,saved.toString(),StandardOpenOption.CREATE_NEW);
        set.accept(0);if(read.getAsInt()!=0)throw new IOException("Cannot suspend fixture random ticks");
        return new IsolatedRandomTickGuard(marker,read,set,original,recovered);
    }
    @Override public void close()throws IOException {
        if(closed)return;
        int current=read.getAsInt();
        if(current!=0&&current!=original)throw new IOException("Random-tick rule changed outside fixture; preserved");
        set.accept(original);
        if(read.getAsInt()!=original)throw new IOException("Cannot restore fixture random ticks");
        Files.delete(marker);closed=true;
    }
}
