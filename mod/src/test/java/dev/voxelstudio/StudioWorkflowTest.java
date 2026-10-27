package dev.voxelstudio;

import dev.voxelstudio.client.StudioLayout;
import dev.voxelstudio.client.StudioWorkflow;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class StudioWorkflowTest {
    private StudioWorkflow.Guidance next(boolean uncertain,boolean generating,boolean placing,boolean asset,boolean locked,boolean model,boolean prompt) {
        return StudioWorkflow.guidance(new StudioWorkflow.State(uncertain,generating,placing,asset,locked,model,prompt));
    }
    @Test void newcomerCanStartWithASampleBeforeConnectingAnAccount() {
        assertTrue(next(false,false,false,false,false,false,false).next().contains("示例"));
        assertEquals("描述你的建筑",next(false,false,false,false,false,true,false).heading());
        assertEquals("可以开始生成",next(false,false,false,false,false,true,true).heading());
    }
    @Test void oldAssetDoesNotHideAnUncertainOrRunningTask() {
        assertEquals("先查询原任务",next(true,false,false,true,true,true,true).heading());
        assertEquals("建筑制作中",next(false,true,false,true,true,true,true).heading());
        assertEquals("正在建造",next(true,true,true,true,true,true,true).heading());
    }
    @Test void previewAndLockAreSeparateStepsWithoutGrantingWorldConsent() {
        assertEquals("建筑已就绪",next(false,false,false,true,false,false,false).heading());
        assertEquals("位置已锁定",next(false,false,false,true,true,false,false).heading());
        assertTrue(next(false,false,false,true,true,true,true).next().contains("确认"));
    }
    @Test void keyboardNavigationCanRevealEveryControlAndClampAtTheBottom() {
        assertEquals(12,StudioLayout.reveal(80,12,22,600,100));
        assertEquals(292,StudioLayout.reveal(0,370,22,600,100));
        assertEquals(500,StudioLayout.reveal(450,590,22,600,100));
        assertEquals(120,StudioLayout.reveal(120,150,22,600,100));
    }
}
