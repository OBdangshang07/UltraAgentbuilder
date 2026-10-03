package dev.voxelstudio.client;

import java.util.function.BooleanSupplier;

/** Development harness only. Visible mode requires an explicit caller opt-in. */
final class IsolatedTestWindow {
    private final boolean repeatHide;
    private final boolean visibleMode;
    private int hideRequests;
    IsolatedTestWindow(String mode) {
        if(!"transition".equals(mode)&&!"every-tick".equals(mode)&&!"visible".equals(mode))throw new IllegalArgumentException("Unknown isolated window-hide mode");
        repeatHide="every-tick".equals(mode);
        visibleMode="visible".equals(mode);
    }
    void maintain(BooleanSupplier visible,Runnable hide) {
        if(visibleMode){if(!visible.getAsBoolean())throw new IllegalStateException("Explicit visible test window became hidden");return;}
        if(repeatHide||visible.getAsBoolean()){hide.run();hideRequests++;}
        if(visible.getAsBoolean())throw new IllegalStateException("Isolated test window did not become hidden");
    }
    int hideRequests(){return hideRequests;}
    String mode(){return visibleMode?"visible":repeatHide?"every-tick":"transition";}
}
