package dev.voxelstudio.selection;

import java.util.function.BooleanSupplier;

/** Fixed observation reasons only. The original short-circuit checks and their
 * order remain authoritative; this neither retains nor refreshes a Capture. */
enum SelectionCaptureValidity {
    CURRENT(""),
    WATCH_CHANGED("[selection-watch-changed] 环境方块/区块事件版本已改变；原快照失效，请重新读取"),
    CHUNK_FENCE_CHANGED("[selection-chunk-fence-changed] 区块载入覆盖或实例已改变；原快照失效，请重新读取"),
    LIFETIME_INVALID("[selection-lifetime-invalid] 原快照保留状态或空闲/发送准备期限失效；不能重绑原任务，请重新读取");

    private final String message;
    SelectionCaptureValidity(String message){this.message=message;}
    String message(){return message;}

    static SelectionCaptureValidity check(boolean watchUnchanged,BooleanSupplier chunksCurrent,BooleanSupplier lifetimeCurrent){
        if(!watchUnchanged)return WATCH_CHANGED;
        if(!chunksCurrent.getAsBoolean())return CHUNK_FENCE_CHANGED;
        if(!lifetimeCurrent.getAsBoolean())return LIFETIME_INVALID;
        return CURRENT;
    }
}
