package dev.voxelstudio.client;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
final class WorldPatchPromptPagesTest {
    private void roundtrip(String value){var joined=new StringBuilder();for(int i=0;i<WorldPatchPromptPages.count(value);i++){String page=WorldPatchPromptPages.at(value,i);assertTrue(page.length()<=WorldPatchPromptPages.LIMIT+1);joined.append(page);}assertEquals(value,joined.toString());}
    @Test void emptyAndNominalBoundariesAreBoundedAndExact(){for(int size:new int[]{0,1,9999,10000,10001,20000,20001,1000001})roundtrip("中".repeat(size));assertEquals(1,WorldPatchPromptPages.count(""));assertEquals("",WorldPatchPromptPages.at("",0));}
    @Test void emojiCrossingAnyBoundaryIsNeverOmittedRepeatedOrSplit(){for(int prefix:new int[]{9998,9999,10000,19999}){String value="a".repeat(prefix)+"🏙️ 建筑😀\n"+"b".repeat(20000);roundtrip(value);for(int i=0;i<WorldPatchPromptPages.count(value);i++){String page=WorldPatchPromptPages.at(value,i);if(!page.isEmpty()){assertFalse(Character.isLowSurrogate(page.charAt(0)));assertFalse(Character.isHighSurrogate(page.charAt(page.length()-1)));}}}}
    @Test void loneSurrogateCodeUnitsRemainOriginalWithoutArtificialPairing(){roundtrip("a".repeat(9999)+"\ud800x\udc00"+"b".repeat(20000));}
    @Test void outOfRangeCannotReadOtherContent(){assertThrows(IllegalArgumentException.class,()->WorldPatchPromptPages.at("private",-1));assertThrows(IllegalArgumentException.class,()->WorldPatchPromptPages.at("private",1));assertThrows(IllegalArgumentException.class,()->WorldPatchPromptPages.at("private",Integer.MAX_VALUE));}
}
