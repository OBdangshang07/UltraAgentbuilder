package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import java.lang.reflect.Modifier;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

final class CoupledAssemblyConsentTest {
    private record Owner(String label){}
    private static CoupledAssemblyBinding binding()throws Exception{return CoupledAssemblyTestFixtures.input(CoupledAssemblyTestFixtures.fixture("complete-new-door")).binding();}
    @Test void oneOriginalOwnerPlayerCandidateAndPurposeOnly()throws Exception{
        var b=binding();var owner=new Owner("same label");var player=UUID.randomUUID();var ticket=CoupledAssemblyConsent.issue(owner,player,b,CoupledAssemblyConsent.Purpose.APPLY,100);
        assertFalse(ticket.canAuthorizePlacement());assertFalse(CoupledAssemblyConsent.available(ticket,new Owner("same label"),player,b,CoupledAssemblyConsent.Purpose.APPLY,101));
        assertFalse(CoupledAssemblyConsent.available(ticket,owner,UUID.randomUUID(),b,CoupledAssemblyConsent.Purpose.APPLY,101));
        assertFalse(CoupledAssemblyConsent.available(ticket,owner,player,b,CoupledAssemblyConsent.Purpose.UNDO,101));
        var other=CoupledAssemblyBinding.parse(CoupledAssemblyTestFixtures.fixture("door-crosses-8192").getAsJsonObject("binding"));
        assertFalse(CoupledAssemblyConsent.available(ticket,owner,player,other,CoupledAssemblyConsent.Purpose.APPLY,101));
        assertThrows(IllegalStateException.class,()->CoupledAssemblyConsent.consume(ticket,owner,player,other,CoupledAssemblyConsent.Purpose.APPLY,101));
        assertTrue(CoupledAssemblyConsent.available(ticket,owner,player,b,CoupledAssemblyConsent.Purpose.APPLY,101));
        CoupledAssemblyConsent.consume(ticket,owner,player,b,CoupledAssemblyConsent.Purpose.APPLY,101);
        assertThrows(IllegalStateException.class,()->CoupledAssemblyConsent.consume(ticket,owner,player,b,CoupledAssemblyConsent.Purpose.APPLY,102));
    }
    @Test void finalExpiryClockWrapAndExplicitRevokeNeverGrantModelOrWorldPermission()throws Exception{
        var b=binding();var owner=new Object();var player=UUID.randomUUID();long start=Long.MAX_VALUE-10;
        var ticket=CoupledAssemblyConsent.issue(owner,player,b,CoupledAssemblyConsent.Purpose.UNDO,start);
        assertFalse(CoupledAssemblyConsent.available(ticket,owner,player,b,CoupledAssemblyConsent.Purpose.UNDO,start-1));
        assertTrue(CoupledAssemblyConsent.available(ticket,owner,player,b,CoupledAssemblyConsent.Purpose.UNDO,start+20));
        assertFalse(CoupledAssemblyConsent.available(ticket,owner,player,b,CoupledAssemblyConsent.Purpose.UNDO,start+CoupledAssemblyConsent.TTL_NANOS));
        CoupledAssemblyConsent.revoke(ticket,new Object());assertTrue(CoupledAssemblyConsent.available(ticket,owner,player,b,CoupledAssemblyConsent.Purpose.UNDO,start+20));
        CoupledAssemblyConsent.revoke(ticket,owner);assertFalse(CoupledAssemblyConsent.available(ticket,owner,player,b,CoupledAssemblyConsent.Purpose.UNDO,start+20));
    }
    @Test void concurrentConsumptionHasExactlyOneWinner()throws Exception{
        var b=binding();var owner=new Object();var player=UUID.randomUUID();var ticket=CoupledAssemblyConsent.issue(owner,player,b,CoupledAssemblyConsent.Purpose.APPLY,100);
        var workers=Executors.newFixedThreadPool(2);var start=new CountDownLatch(1);
        try{var results=new ArrayList<Future<Boolean>>();for(int i=0;i<2;i++)results.add(workers.submit(()->{start.await();try{CoupledAssemblyConsent.consume(ticket,owner,player,b,CoupledAssemblyConsent.Purpose.APPLY,101);return true;}catch(IllegalStateException expected){return false;}}));
            start.countDown();int winners=0;for(var result:results)if(result.get(5,TimeUnit.SECONDS))winners++;assertEquals(1,winners);
        }finally{start.countDown();workers.shutdownNow();}
    }
    @Test void originalTicketCannotBeConstructedFromLegacyTicketsOrPublicJson()throws Exception{
        for(var constructor:CoupledAssemblyConsent.Ticket.class.getDeclaredConstructors())assertTrue(Modifier.isPrivate(constructor.getModifiers()));
        var b=binding();var ticket=CoupledAssemblyConsent.issue(new Object(),UUID.randomUUID(),b,CoupledAssemblyConsent.Purpose.APPLY,0);
        assertFalse(AssemblyPatchConsent.Ticket.class.isInstance(ticket));assertFalse(WorldPatchConsent.Ticket.class.isInstance(ticket));
        assertThrows(NullPointerException.class,()->CoupledAssemblyConsent.issue(null,UUID.randomUUID(),b,CoupledAssemblyConsent.Purpose.APPLY,0));
        assertThrows(NullPointerException.class,()->CoupledAssemblyConsent.issue(new Object(),UUID.randomUUID(),b,null,0));
    }
}
