package dev.voxelstudio.selection;

import java.util.*;

/** Separate v2, same-owner, one-use final confirmation ledger. A public
 * binding/report, equal replacement owner, SEND or v1 ticket cannot create
 * this private ticket. The future server gateway must still check its LIVE
 * whole lease before/after consuming; this ledger cannot authorize writes. */
final class AssemblyPatchConsent {
    static final long TTL_NANOS=45_000_000_000L;
    static final class Ticket<O> {
        private final O owner;
        private final UUID player;
        private final AssemblyPatchBinding binding;
        private final long issued;
        private boolean used;
        private Ticket(O owner,UUID player,AssemblyPatchBinding binding,long issued){this.owner=owner;this.player=player;this.binding=binding;this.issued=issued;}
        boolean canAuthorizePlacement(){return false;}
    }
    static <O> Ticket<O> issue(O owner,UUID player,AssemblyPatchBinding binding,long now){
        return new Ticket<>(Objects.requireNonNull(owner),Objects.requireNonNull(player),Objects.requireNonNull(binding),now);
    }
    static <O> boolean available(Ticket<O> ticket,O owner,UUID player,AssemblyPatchBinding binding,long now){
        return ticket!=null&&ticket.owner==owner&&ticket.player.equals(player)&&ticket.binding.equals(binding)
                &&!ticket.used&&now-ticket.issued>=0&&now-ticket.issued<TTL_NANOS;
    }
    static <O> void consume(Ticket<O> ticket,O owner,UUID player,AssemblyPatchBinding binding,long now){
        if(!available(ticket,owner,player,binding,now))throw new IllegalStateException("整组最终确认已使用、撤销、过期或不是原玩家完整候选");
        ticket.used=true;
    }
    static <O> void revoke(Ticket<O> ticket,O owner){if(ticket!=null&&ticket.owner==owner)ticket.used=true;}
    private AssemblyPatchConsent(){}
}
