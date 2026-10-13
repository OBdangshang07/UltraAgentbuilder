# Projection mesh upload outcomes

Each queued mesh transfers its CPU buffer and GPU resource at most once. The
worker receives success only after upload, unbind and publication all return.
Java allocation, bind, upload, unbind or publication failures complete the
handoff exceptionally. Unpublished GPU resources are disposed; CPU buffers not
passed to Minecraft's consuming `VertexBuffer.upload` are released explicitly.
The consuming upload itself releases its input, including its exception path.

Cancelled or obsolete queued work cannot create or publish another GPU mesh.
The worker cancels a timed-out handoff and retires the failed build on the render
thread, clearing partial meshes. This does not resend a model request or alter
an asset, placement mask, confirmation or world. Cleanup attempts preserve the
original error, and a missing Java exception message cannot look like readiness.

Synthetic ownership/failure tests do not exercise a driver or certify native
graphics stability. These changes neither identify nor fix an operating-system
or native-library access violation; installed-game and release gates remain
separate.
