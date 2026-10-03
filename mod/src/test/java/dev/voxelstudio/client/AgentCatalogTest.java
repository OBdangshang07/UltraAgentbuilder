package dev.voxelstudio.client;
import com.google.gson.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class AgentCatalogTest {
    @Test void singleReadySourceIsRecommended(){var c=new AgentCatalog();c.accept(JsonParser.parseString("[{\"id\":\"codex\",\"available\":false,\"state\":\"login-required\"},{\"id\":\"deepseek\",\"available\":true,\"state\":\"configured\"}]").getAsJsonArray());assertEquals("deepseek",c.onlyAvailable());assertTrue(c.label("deepseek").contains("授权未验证"));assertEquals("需要登录",c.label("codex"));}
    @Test void multipleOrZeroSourcesNeverSelectAnAccount(){var c=new AgentCatalog();assertNull(c.onlyAvailable());c.accept(JsonParser.parseString("[{\"id\":\"codex\",\"available\":true,\"state\":\"ready\"},{\"id\":\"claude\",\"available\":true,\"state\":\"ready\"}]").getAsJsonArray());assertNull(c.onlyAvailable());assertEquals(2,c.available());}
    @Test void refreshReplacesStatusAndUnknownSourcesAreIgnored(){var c=new AgentCatalog();c.accept(JsonParser.parseString("[{\"id\":\"other\",\"available\":true,\"state\":\"ready\"},{\"id\":\"codex\",\"available\":false,\"state\":\"timeout\"}]").getAsJsonArray());assertEquals(0,c.available());assertEquals("检测超时",c.label("codex"));assertEquals("尚未检测",c.label("deepseek"));}
}
