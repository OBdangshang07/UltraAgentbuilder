package dev.voxelstudio.selection;

import java.util.*;

/** One bounded original Capture, not a task timer or write capability. An
 * explicit SEND retains the SAME object while its outcome may be in flight;
 * a replacement selection/world/chunk or explicit cancellation still revokes
 * it. Idle captures and abandoned dispatch preparations do not become immortal.
 * No polling, disk history or equal hashes can resurrect a revoked owner. */
final class SelectionCaptureLifetime<O> {
    static final long IDLE_NANOS=300_000_000_000L,DISPATCH_PREPARATION_NANOS=120_000_000_000L;
    enum Phase { IDLE,PREPARING,POSSIBLY_SENT,ABANDONED,REVOKED }
    private final O original;private final UUID player;private final long readyAt;
    private SelectionReadService.PatchSendBinding binding;private long preparedAt;
    private Phase phase=Phase.IDLE;
    SelectionCaptureLifetime(O original,UUID player,long readyAt){this.original=Objects.requireNonNull(original);this.player=Objects.requireNonNull(player);this.readyAt=readyAt;}
    private void owner(O original,UUID player){if(this.original!=original||!this.player.equals(player))throw new IllegalStateException("不能重绑原快照或玩家");}
    synchronized void reserve(O original,UUID player,SelectionReadService.PatchSendBinding binding,long now){
        owner(original,player);Objects.requireNonNull(binding);
        if(expired(now))throw new IllegalStateException("原快照或发送准备已过期，不能重新保留");
        if(phase==Phase.PREPARING&&this.binding.equals(binding))return;
        if(phase!=Phase.IDLE)throw new IllegalStateException("同一原快照只保留一个明确 SEND，不能替换或重复派发");
        this.binding=binding;preparedAt=now;phase=Phase.PREPARING;
    }
    synchronized void beforeDispatch(O original,UUID player,SelectionReadService.PatchSendBinding binding,long now){
        owner(original,player);
        if(phase!=Phase.PREPARING||!Objects.equals(this.binding,binding)||expired(now))throw new IllegalStateException("原发送准备已失效、使用或被替换");
    }
    synchronized void attempted(O original,UUID player,SelectionReadService.PatchSendBinding binding,long now){beforeDispatch(original,player,binding,now);phase=Phase.POSSIBLY_SENT;}
    synchronized void releaseIfNotDispatched(O original,UUID player,SelectionReadService.PatchSendBinding binding){
        owner(original,player);if(phase==Phase.PREPARING&&Objects.equals(this.binding,binding))phase=Phase.ABANDONED;
    }
    synchronized boolean expired(long now){
        if(phase==Phase.REVOKED)return true;
        // No hard generation duration. At most ONE owned, quota-checked
        // capture/watch exists per server and is bounded by its live lifecycle.
        if(phase==Phase.POSSIBLY_SENT)return false;
        long age=now-(phase==Phase.PREPARING?preparedAt:readyAt);
        return age<0||age>=(phase==Phase.PREPARING?DISPATCH_PREPARATION_NANOS:IDLE_NANOS);
    }
    synchronized void revoke(){phase=Phase.REVOKED;}
    /** Observation of the one original full SEND, never a new reservation,
     * response certificate, final confirmation or write capability. */
    synchronized void checkedAssembly(O original,UUID player,AssemblyPatchBinding candidate){
        owner(original,player);Objects.requireNonNull(candidate);
        if(phase!=Phase.POSSIBLY_SENT||binding==null
                ||!binding.contextId().equals(candidate.captureId())
                ||binding.contextRevision()!=candidate.contextRevision()
                ||!binding.snapshotHash().equals(candidate.snapshotHash())
                ||!binding.selectionHash().equals(candidate.selectionHash())
                ||!binding.capsuleId().equals(candidate.preparationHash())
                ||!binding.manifestHash().equals(candidate.contextRecordHash())
                ||!binding.submissionHash().equals(candidate.requestHash())
                ||!binding.runtimeHash().equals(candidate.runtimeHash()))throw new IllegalStateException("整组候选不是此玩家仍持有的原完整 SEND；不能重绑或续发");
    }
    synchronized Phase phase(){return phase;}
    boolean canAuthorizePlacement(){return false;}
}
