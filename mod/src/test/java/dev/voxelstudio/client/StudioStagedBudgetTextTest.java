package dev.voxelstudio.client;

import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class StudioStagedBudgetTextTest {
    @Test void everySelectedBudgetShowsItsActualPackagesAndSharedReserve(){
        int[][] cases={{22,4,7},{23,4,8},{24,4,9},{25,4,10},{26,5,10}};
        for(int[] c:cases){
            String text=StudioAssembly.stagedBudgetSummary(c[0]);
            assertTrue(text.contains(c[0]+" 次总预算"));
            assertTrue(text.contains("最多 "+c[1]+" 个制作任务"));
            assertTrue(text.contains("预留 "+c[2]+" 次共享"));
            assertTrue(text.contains("全部计入总预算"));
        }
    }
    @Test void summariesMatchActualNodePreflightRatherThanOnlyDuplicatingArithmetic()throws Exception{
        var fixtures=JsonParser.parseString(java.nio.file.Files.readString(java.nio.file.Path.of("build/test-fixtures/prototype-preflight.json"))).getAsJsonArray();
        int checked=0;
        for(var item:fixtures){
            var f=item.getAsJsonObject();var request=f.getAsJsonObject("request");
            if(!request.get("assemblyPrototypes").getAsString().equals("staged"))continue;
            var assembly=f.getAsJsonObject("policy").getAsJsonObject("assembly");
            String text=StudioAssembly.stagedBudgetSummary(request.get("assemblyCalls").getAsInt());
            assertTrue(text.contains("最多 "+assembly.get("maxPackages").getAsInt()+" 个制作任务"));
            assertTrue(text.contains("预留 "+assembly.getAsJsonObject("prototypes").get("recoveryReserve").getAsInt()+" 次共享"));checked++;
        }
        assertEquals(5,checked);
    }
    @Test void invalidSavedSelectionShowsAWarningWithoutClampingOrCrashingThePanel(){
        for(int calls:new int[]{0,5,21,27}){
            String text=assertDoesNotThrow(()->StudioAssembly.stagedBudgetSummary(calls));
            assertTrue(text.contains("22–26 次总预算"));assertTrue(text.contains("当前 "+calls+" 次不适用"));
            assertFalse(text.contains("个制作任务"));
            assertThrows(IllegalArgumentException.class,()->StudioAssembly.stagedPackageLimit(calls));
        }
    }
}
