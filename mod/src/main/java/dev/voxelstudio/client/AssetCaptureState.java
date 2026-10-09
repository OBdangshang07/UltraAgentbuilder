package dev.voxelstudio.client;

import com.mojang.blaze3d.platform.GlStateManager;
import com.mojang.blaze3d.systems.RenderSystem;
import org.lwjgl.opengl.GL11;
import org.lwjgl.opengl.GL30;
import java.util.Objects;

/** Save before allocating a capture framebuffer; restore through vanilla's
 * state cache even when allocation, rendering, readback or deletion fails. */
final class AssetCaptureState implements AutoCloseable {
    record Snapshot(int drawFramebuffer, int readFramebuffer, int[] viewport,
                    boolean scissorEnabled, int[] scissorBox) {
        Snapshot {
            if (viewport.length != 4 || scissorBox.length != 4)
                throw new IllegalArgumentException("Four-component capture state required");
            viewport = viewport.clone(); scissorBox = scissorBox.clone();
        }
        @Override public int[] viewport() { return viewport.clone(); }
        @Override public int[] scissorBox() { return scissorBox.clone(); }
    }

    interface Access {
        Snapshot snapshot();
        Runnable captureDrawState();
        void framebuffers(int draw, int read);
        void viewport(int[] value);
        void scissor(boolean enabled, int[] box);
    }

    private final Access access;
    private final Snapshot snapshot;
    private final Runnable restoreDrawState;
    private boolean closed;

    AssetCaptureState() { this(new OpenGlAccess()); }
    AssetCaptureState(Access access) {
        this.access = Objects.requireNonNull(access);
        snapshot = Objects.requireNonNull(access.snapshot());
        restoreDrawState = Objects.requireNonNull(access.captureDrawState());
    }

    @Override public void close() {
        if (closed) return;
        closed = true;
        Throwable failure = null;
        Runnable[] restoration = {
            restoreDrawState,
            () -> access.framebuffers(snapshot.drawFramebuffer(), snapshot.readFramebuffer()),
            () -> access.viewport(snapshot.viewport()),
            () -> access.scissor(snapshot.scissorEnabled(), snapshot.scissorBox())
        };
        for (Runnable action : restoration) {
            try { action.run(); }
            catch (RuntimeException | Error error) {
                if (failure == null) failure = error;
                else if (error != failure) failure.addSuppressed(error);
            }
        }
        if (failure instanceof RuntimeException error) throw error;
        if (failure instanceof Error error) throw error;
    }

    private static final class OpenGlAccess implements Access {
        @Override public Snapshot snapshot() {
            RenderSystem.assertOnRenderThread();
            int[] viewport = new int[4], box = new int[4];
            GL11.glGetIntegerv(GL11.GL_VIEWPORT, viewport);
            GL11.glGetIntegerv(GL11.GL_SCISSOR_BOX, box);
            return new Snapshot(GL11.glGetInteger(GL30.GL_DRAW_FRAMEBUFFER_BINDING),
                GL11.glGetInteger(GL30.GL_READ_FRAMEBUFFER_BINDING), viewport,
                GL11.glIsEnabled(GL11.GL_SCISSOR_TEST), box);
        }
        @Override public Runnable captureDrawState() {
            var state = new ProjectionRenderState();
            return state::close;
        }
        @Override public void framebuffers(int draw, int read) {
            GlStateManager._glBindFramebuffer(GL30.GL_DRAW_FRAMEBUFFER, draw);
            GlStateManager._glBindFramebuffer(GL30.GL_READ_FRAMEBUFFER, read);
        }
        @Override public void viewport(int[] value) {
            RenderSystem.viewport(value[0], value[1], value[2], value[3]);
        }
        @Override public void scissor(boolean enabled, int[] box) {
            // Raw glEnable/glDisable would leave GlStateManager's BooleanState
            // stale. Preserve the disabled caller's box as well as the bit.
            GlStateManager._scissorBox(box[0], box[1], box[2], box[3]);
            if (enabled) GlStateManager._enableScissorTest();
            else GlStateManager._disableScissorTest();
        }
    }
}
