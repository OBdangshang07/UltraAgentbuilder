package dev.voxelstudio;

import dev.voxelstudio.client.StudioLayout;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class StudioLayoutTest {
    @Test void standardGuiScalesKeepPanelsAndViewportOnScreen(){
        for(int[] size:new int[][]{{320,240},{427,267},{640,360},{640,400},{960,540},{1280,800},{1920,1080}}){
            var l=StudioLayout.of(size[0],size[1]);
            for(var r:new StudioLayout.Rect[]{l.sidebar(),l.content(),l.preview(),l.viewport(),l.footer()}){
                assertTrue(r.x()>=0&&r.y()>=0);assertTrue(r.width()>0&&r.height()>0);assertTrue(r.right()<=size[0]&&r.bottom()<=size[1]);
            }
            assertTrue(l.sidebar().right()<l.preview().x());assertTrue(l.content().bottom()<l.sidebar().bottom()-31);
            assertTrue(l.viewport().bottom()<l.preview().bottom()-29);assertTrue(l.preview().bottom()<l.footer().y());
        }
    }
    @Test void scrollIsClampedAtBothEndsAndHandlesEmptyContent(){
        assertEquals(0,StudioLayout.clampScroll(-30,700,120));assertEquals(580,StudioLayout.clampScroll(900,700,120));
        assertEquals(0,StudioLayout.clampScroll(20,40,120));assertEquals(30,StudioLayout.clampScroll(30,200,100));
    }
    @Test void invalidOrOverflowingCoordinatesAreRejectedBeforePlacement(){
        for(String input:new String[]{"","-","1.5","1e3","1 2","2147483648","-2147483649"})assertThrows(IllegalArgumentException.class,()->StudioLayout.coordinate(input));
        assertEquals(-2147483648,StudioLayout.coordinate("-2147483648"));assertEquals(2147483647,StudioLayout.coordinate("2147483647"));assertEquals(-64,StudioLayout.coordinate("-64"));
    }
}
