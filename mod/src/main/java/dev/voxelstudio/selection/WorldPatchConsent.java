package dev.voxelstudio.selection;

import java.util.*;

/** Owner-bound, one-use in-memory consent ledger. No client supplied UUID,
 * JSON report, read-only result or equal-but-replaced owner can mint a ticket.
 * Caller must perform the live server guard even after consuming it. */
final class WorldPatchConsent {
    static final long TTL_NANOS=45_000_000_000L;
    static final class Ticket<O> {
        private final O owner;private final UUID player,nonce=UUID.randomUUID();private final WorldPatchPreview.Binding binding;private final long issued;private boolean used;
        private Ticket(O o,UUID p,WorldPatchPreview.Binding b,long now){owner=o;player=p;binding=b;issued=now;}
        boolean canAuthorizePlacement(){return false;}
    }
    static <O> Ticket<O> issue(O owner,UUID player,WorldPatchPreview.Binding binding,long now){return new Ticket<>(Objects.requireNonNull(owner),Objects.requireNonNull(player),Objects.requireNonNull(binding),now);}
    static <O> boolean available(Ticket<O> ticket,O owner,UUID player,WorldPatchPreview.Binding binding,long now){return ticket!=null&&ticket.owner==owner&&ticket.player.equals(player)&&ticket.binding.equals(binding)&&!ticket.used&&now-ticket.issued>=0&&now-ticket.issued<TTL_NANOS;}
    static <O> void consume(Ticket<O> ticket,O owner,UUID player,WorldPatchPreview.Binding binding,long now){if(!available(ticket,owner,player,binding,now))throw new IllegalStateException("最终确认已使用、撤销、过期或不属于原候选");ticket.used=true;}
    static <O> void revoke(Ticket<O> ticket,O owner){if(ticket!=null&&ticket.owner==owner)ticket.used=true;}
    private WorldPatchConsent(){}
}
