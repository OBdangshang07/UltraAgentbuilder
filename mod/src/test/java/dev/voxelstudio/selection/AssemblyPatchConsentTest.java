package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import java.lang.reflect.Modifier;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

final class AssemblyPatchConsentTest {
    private record Owner(String label){}
    @Test void wholeFinalConfirmationIsOneUseAndHasNoWriteAuthorityByItself()throws Exception{
        var binding=AssemblyPatchFixtures.binding(AssemblyPatchFixtures.header("lite"));var owner=new Owner("original");var player=UUID.randomUUID();var ticket=AssemblyPatchConsent.issue(owner,player,binding,100);
        assertFalse(ticket.canAuthorizePlacement());assertTrue(AssemblyPatchConsent.available(ticket,owner,player,binding,101));AssemblyPatchConsent.consume(ticket,owner,player,binding,102);
        assertFalse(AssemblyPatchConsent.available(ticket,owner,player,binding,103));assertThrows(IllegalStateException.class,()->AssemblyPatchConsent.consume(ticket,owner,player,binding,103));
    }
    @Test void equalButReplacedOwnerOtherPlayerAndChangedSourceCannotUseOriginalTicket()throws Exception{
        var fixture=AssemblyPatchFixtures.header("lite");var binding=AssemblyPatchFixtures.binding(fixture);var owner=new Owner("original");var player=UUID.randomUUID();var ticket=AssemblyPatchConsent.issue(owner,player,binding,100);
        assertFalse(AssemblyPatchConsent.available(ticket,new Owner("original"),player,binding,101));assertFalse(AssemblyPatchConsent.available(ticket,owner,UUID.randomUUID(),binding,101));
        for(String field:List.of("sourceHash","currentNativeEvidenceHash","referenceBindingHash","candidateHash")){
            var changed=fixture.deepCopy();changed.getAsJsonObject("metadata").getAsJsonObject("candidate").addProperty(field,"f".repeat(64));var other=AssemblyPatchFixtures.binding(changed);
            assertFalse(AssemblyPatchConsent.available(ticket,owner,player,other,101));assertThrows(IllegalStateException.class,()->AssemblyPatchConsent.consume(ticket,owner,player,other,101),field);
        }
        assertTrue(AssemblyPatchConsent.available(ticket,owner,player,binding,101));
    }
    @Test void fortyFiveSecondExpiryAndRevokeAreStrictAndCannotBeResurrected()throws Exception{
        var binding=AssemblyPatchFixtures.binding(AssemblyPatchFixtures.header("lite"));var owner=new Owner("original");var player=UUID.randomUUID();long started=100;var ticket=AssemblyPatchConsent.issue(owner,player,binding,started);
        assertFalse(AssemblyPatchConsent.available(ticket,owner,player,binding,started-1));assertTrue(AssemblyPatchConsent.available(ticket,owner,player,binding,started+AssemblyPatchConsent.TTL_NANOS-1));
        assertFalse(AssemblyPatchConsent.available(ticket,owner,player,binding,started+AssemblyPatchConsent.TTL_NANOS));
        assertThrows(IllegalStateException.class,()->AssemblyPatchConsent.consume(ticket,owner,player,binding,started+AssemblyPatchConsent.TTL_NANOS));
        AssemblyPatchConsent.revoke(ticket,new Owner("original"));assertTrue(AssemblyPatchConsent.available(ticket,owner,player,binding,started+1));
        AssemblyPatchConsent.revoke(ticket,owner);assertFalse(AssemblyPatchConsent.available(ticket,owner,player,binding,started+1));
    }
    @Test void ticketConstructorAndIdentityAreIndependentOfLegacyV1AndClockWrapIsSafe()throws Exception{
        for(var constructor:AssemblyPatchConsent.Ticket.class.getDeclaredConstructors())assertTrue(Modifier.isPrivate(constructor.getModifiers()));
        var binding=AssemblyPatchFixtures.binding(AssemblyPatchFixtures.header("lite"));var owner=new Owner("original");var player=UUID.randomUUID();long started=Long.MAX_VALUE-10;var ticket=AssemblyPatchConsent.issue(owner,player,binding,started);
        assertFalse(WorldPatchConsent.Ticket.class.isInstance(ticket));assertTrue(AssemblyPatchConsent.available(ticket,owner,player,binding,started+20));assertFalse(AssemblyPatchConsent.available(ticket,owner,player,binding,started+AssemblyPatchConsent.TTL_NANOS));
        assertThrows(NullPointerException.class,()->AssemblyPatchConsent.issue(null,player,binding,0));assertThrows(NullPointerException.class,()->AssemblyPatchConsent.issue(owner,null,binding,0));assertThrows(NullPointerException.class,()->AssemblyPatchConsent.issue(owner,player,null,0));
    }
}
