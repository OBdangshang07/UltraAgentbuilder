package dev.voxelstudio;

import com.google.gson.*;
import net.minecraft.block.BlockState;
import net.minecraft.block.Blocks;
import net.minecraft.command.argument.BlockArgumentParser;
import net.minecraft.registry.Registries;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Immutable asset. Index 0 keeps terrain, 1 explicitly clears, >=2 places. */
public final class Asset {
    public static final int MAX_WIDTH=256, MAX_HEIGHT=384, MAX_LENGTH=256, MAX_VOLUME=8388608;
    public static boolean fitsHeight(int anchorY,int height,int bottomY,int topY){return height>0&&anchorY>=bottomY&&(long)anchorY+height<=topY;}
    public final String revision, hash, id;
    public final String validationNotes;
    public final boolean navigationAcknowledgementRequired;
    public final boolean sceneDesign;
    public final boolean diagnosticOnly;
    public final String designDiagnostics;
    public final int width, height, length, setCount, clearCount;
    private final short[] cells;
    private final BlockState[] palette;
    public Asset(String revision, JsonObject m, byte[] bytes) throws Exception {
        this.revision = revision; id = m.get("id").getAsString(); hash = m.get("assetHash").getAsString();
        var notes=new ArrayList<String>();
        if(m.has("validationNotes")&&m.get("validationNotes").isJsonArray())for(var note:m.getAsJsonArray("validationNotes"))notes.add(note.getAsString());
        validationNotes=String.join("\n",notes);
        navigationAcknowledgementRequired=NavigationReview.required(m);
        diagnosticOnly=m.has("diagnosticOnly")&&m.get("diagnosticOnly").getAsBoolean();
        sceneDesign=m.has("scene");designDiagnostics=sceneDesign&&m.getAsJsonObject("scene").has("diagnostics")?new GsonBuilder().setPrettyPrinting().create().toJson(m.getAsJsonObject("scene").get("diagnostics")):"";
        if (m.get("schemaVersion").getAsInt() != 1 || !m.get("minecraft").getAsString().equals("1.20.1")) throw new IllegalArgumentException("Unsupported asset version");
        JsonObject dimensions = m.getAsJsonObject("dimensions");
        width = dimensions.get("width").getAsInt(); height = dimensions.get("height").getAsInt(); length = dimensions.get("length").getAsInt();
        long volume=(long)width*height*length;
        if (width < 1 || width > MAX_WIDTH || height < 1 || height > MAX_HEIGHT || length < 1 || length > MAX_LENGTH || volume>MAX_VOLUME || bytes.length != volume * 2) throw new IllegalArgumentException("Invalid asset size (max 256x384x256, volume 8388608)");
        if (!sha(bytes).equals(m.get("cellsHash").getAsString())) throw new IllegalArgumentException("Asset cell hash mismatch");
        JsonObject content = m.deepCopy(); content.remove("assetHash");
        if (!sha(canonical(content).getBytes(StandardCharsets.UTF_8)).equals(hash)) throw new IllegalArgumentException("Asset manifest hash mismatch");
        JsonArray p = m.getAsJsonArray("palette");
        if (p.size() < 3 || p.size() > 256 || !p.get(0).getAsString().equals("@keep") || !p.get(1).getAsString().equals("minecraft:air")) throw new IllegalArgumentException("Invalid palette");
        palette = new BlockState[p.size()]; palette[0] = palette[1] = Blocks.AIR.getDefaultState();
        for (int i = 2; i < p.size(); i++) {
            palette[i] = BlockArgumentParser.block(Registries.BLOCK.getReadOnlyWrapper(), p.get(i).getAsString(), false).blockState();
            if (palette[i].isAir() || palette[i].hasBlockEntity() || !palette[i].getFluidState().isEmpty()) throw new IllegalArgumentException("Unsupported material: " + p.get(i));
        }
        cells = new short[bytes.length / 2]; ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(cells);
        int sets = 0, clears = 0;
        for (short c : cells) { int v = Short.toUnsignedInt(c); if (v >= palette.length) throw new IllegalArgumentException("Palette index out of bounds"); if (v >= 2) sets++; if (v == 1) clears++; }
        setCount = sets; clearCount = clears;
        if (sets < 1 || sets > 1000000 || sets != m.get("setCount").getAsInt() || clears != m.get("clearCount").getAsInt()) throw new IllegalArgumentException("Asset count mismatch");
        SpecialBlocks.validate(this);
    }
    public int volume() { return cells.length; }
    public void requireBuildable(){if(diagnosticOnly)throw new IllegalStateException("失败诊断视图不可建造；通行风险确认不能解除此限制");}
    public int cell(int index) { return Short.toUnsignedInt(cells[index]); }
    public int index(int x, int y, int z) { return x + z * width + y * width * length; }
    public BlockState state(int index) { return palette[cell(index)]; }
    public BlockState state(int x, int y, int z) { return x < 0 || y < 0 || z < 0 || x >= width || y >= height || z >= length ? Blocks.AIR.getDefaultState() : state(index(x,y,z)); }
    public static String sha(byte[] value) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value)); }
    public static String canonical(JsonElement e) {
        if (e.isJsonObject()) { var keys = new TreeSet<String>(e.getAsJsonObject().keySet()); var parts = new ArrayList<String>(); for (String k : keys) parts.add(new Gson().toJson(k) + ":" + canonical(e.getAsJsonObject().get(k))); return "{" + String.join(",", parts) + "}"; }
        if (e.isJsonArray()) { var parts = new ArrayList<String>(); for (JsonElement v : e.getAsJsonArray()) parts.add(canonical(v)); return "[" + String.join(",", parts) + "]"; }
        return e.toString();
    }
}
