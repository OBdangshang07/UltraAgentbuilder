package dev.voxelstudio.selection;

import java.util.*;

/** Independent owner-bound final UI consent, never SEND/model consent, an
 * old ticket, a public report or a durable replay token. No world API here. */
final class CoupledAssemblyConsent {
    enum Purpose { APPLY,UNDO }
    static final long TTL_NANOS=45_000_000_000L;
    static final class Ticket {
        private final Object owner;private final UUID player;private final CoupledAssemblyBinding binding;
        private final Purpose purpose;private final long issued;private boolean used;
        private Ticket(Object owner,UUID player,CoupledAssemblyBinding binding,Purpose purpose,long issued){this.owner=owner;this.player=player;this.binding=binding;this.purpose=purpose;this.issued=issued;}
        boolean canAuthorizePlacement(){return false;}
    }
    static Ticket issue(Object owner,UUID player,CoupledAssemblyBinding binding,Purpose purpose,long now){
        return new Ticket(Objects.requireNonNull(owner),Objects.requireNonNull(player),Objects.requireNonNull(binding),Objects.requireNonNull(purpose),now);
    }
    static boolean available(Ticket ticket,Object owner,UUID player,CoupledAssemblyBinding binding,Purpose purpose,long now){
        if(ticket==null)return false;synchronized(ticket){return ticket.owner==owner&&ticket.player.equals(player)&&ticket.binding.equals(binding)&&ticket.purpose==purpose
            &&!ticket.used&&now-ticket.issued>=0&&now-ticket.issued<TTL_NANOS;}
    }
    static void consume(Ticket ticket,Object owner,UUID player,CoupledAssemblyBinding binding,Purpose purpose,long now){
        if(ticket==null)throw new IllegalStateException("缺少独立原成组最终确认");synchronized(ticket){
            if(!available(ticket,owner,player,binding,purpose,now))throw new IllegalStateException("原成组最终确认已使用、撤销、过期或原归属/用途不符");ticket.used=true;
        }
    }
    static void revoke(Ticket ticket,Object owner){if(ticket!=null)synchronized(ticket){if(ticket.owner==owner)ticket.used=true;}}
    private CoupledAssemblyConsent(){}
}
