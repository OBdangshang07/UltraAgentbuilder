package dev.voxelstudio;
import com.google.gson.*;
import org.junit.jupiter.api.Test;
import java.nio.charset.StandardCharsets;
import static org.junit.jupiter.api.Assertions.*;
class NativeEvidenceRequestTest {
    private JsonObject source()throws Exception{
        var r=JsonParser.parseString("{\"format\":\"NativeEvidenceRequest\",\"version\":1,\"renderer\":\"minecraft-1.20.1-block-models-v1\",\"sourceHash\":\""+"a".repeat(64)+"\",\"assetHash\":\""+"b".repeat(64)+"\",\"cellsHash\":\""+"c".repeat(64)+"\",\"dimensions\":{\"width\":32,\"height\":224,\"length\":32},\"canAuthorizePlacement\":false,\"views\":[]}").getAsJsonObject();
        for(int i=0;i<4;i++)r.getAsJsonArray("views").add(JsonParser.parseString("{\"id\":\"view-"+i+"\",\"purpose\":\"exterior\",\"yaw\":-35,\"pitch\":25,\"min\":[0,0,0],\"max\":[32,224,32],\"width\":512,\"height\":512}"));return bind(r);
    }
    private JsonObject bind(JsonObject r)throws Exception{r.remove("requestHash");r.addProperty("requestHash",Asset.sha(Asset.canonical(r).getBytes(StandardCharsets.UTF_8)));return r;}
    @Test void exactSubjectAndCamerasAreImmutable()throws Exception{var r=NativeEvidenceRequest.parse(source());assertEquals(224,r.height());assertEquals(4,r.views().size());assertThrows(UnsupportedOperationException.class,()->r.views().get(0).min().set(0,99));}
    @Test void boundedFramingIsHashBoundMetadataNotChangedGeometry()throws Exception{
        var input=source();var plain=NativeEvidenceRequest.parse(input);
        input.getAsJsonArray("views").get(0).getAsJsonObject().addProperty("framing","合成相机构图说明；不代表通行或设计质量验收。");bind(input);
        var described=NativeEvidenceRequest.parse(input);assertNotEquals(plain.hash(),described.hash());assertEquals(plain.views(),described.views());
        input.getAsJsonArray("views").get(0).getAsJsonObject().addProperty("framing","x".repeat(NativeEvidenceRequest.MAX_FRAMING_LENGTH));bind(input);
        assertEquals(plain.views(),NativeEvidenceRequest.parse(input).views());
    }
    @Test void staleHashAndInvalidClipAreRejected()throws Exception{
        var r=source();r.addProperty("sourceHash","d".repeat(64));assertThrows(IllegalArgumentException.class,()->NativeEvidenceRequest.parse(r));
        var b=source();b.getAsJsonArray("views").get(0).getAsJsonObject().getAsJsonArray("max").set(1,new JsonPrimitive(225));bind(b);assertThrows(IllegalArgumentException.class,()->NativeEvidenceRequest.parse(b));
    }
    @Test void noWriteAuthorityFractionalCoordinatesOrDuplicateViews()throws Exception{
        var a=source();a.addProperty("canAuthorizePlacement",true);bind(a);assertThrows(IllegalArgumentException.class,()->NativeEvidenceRequest.parse(a));
        var b=source();b.getAsJsonArray("views").get(0).getAsJsonObject().getAsJsonArray("min").set(0,new JsonPrimitive(.5));bind(b);assertThrows(ArithmeticException.class,()->NativeEvidenceRequest.parse(b));
        var c=source();c.getAsJsonArray("views").get(1).getAsJsonObject().addProperty("id","view-0");bind(c);assertThrows(IllegalArgumentException.class,()->NativeEvidenceRequest.parse(c));
    }
}
