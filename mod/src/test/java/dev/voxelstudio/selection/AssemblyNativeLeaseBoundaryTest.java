package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import java.lang.reflect.Modifier;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** API boundary only; this is not a live-server identity or physics test. */
final class AssemblyNativeLeaseBoundaryTest {
    @Test void wholeLeaseCannotBeConstructedFromPublicReportsOrUsedAsLegacyLease(){
        for(var constructor:SelectionReadService.AssemblyNativeLease.class.getDeclaredConstructors())assertTrue(Modifier.isPrivate(constructor.getModifiers()));
        assertFalse(Modifier.isPublic(SelectionReadService.AssemblyNativeLease.class.getModifiers()));
        assertFalse(SelectionReadService.NativeLease.class.isAssignableFrom(SelectionReadService.AssemblyNativeLease.class));
        var methods=new TreeSet<String>();for(var method:SelectionReadService.AssemblyNativeLease.class.getDeclaredMethods())methods.add(method.getName());
        assertEquals(Set.of("compiled","original","preview","prepare","detach","canAuthorizePlacement","current"),methods);
        assertTrue(Arrays.stream(SelectionReadService.class.getDeclaredMethods()).filter(m->m.getName().equals("assemblyNativeLease")).noneMatch(m->Modifier.isPublic(m.getModifiers())));
    }
    @Test void wholeNativeWorldAndSourceCannotAcceptLegacyOrPublicWorldLease(){
        for(var constructor:SelectionReadService.AssemblyNativeWorld.class.getDeclaredConstructors())assertTrue(Modifier.isPrivate(constructor.getModifiers()));
        assertFalse(Modifier.isPublic(SelectionReadService.AssemblyNativeWorld.class.getModifiers()));
        assertFalse(SelectionReadService.NativeWorld.class.isAssignableFrom(SelectionReadService.AssemblyNativeWorld.class));
        assertTrue(AssemblyPatchExecution.Source.class.isAssignableFrom(AssemblyPatchNativeSource.class));
        assertFalse(WorldPatchExecution.Source.class.isAssignableFrom(AssemblyPatchNativeSource.class));
        for(var constructor:AssemblyPatchNativeSource.class.getDeclaredConstructors()){
            assertFalse(Modifier.isPublic(constructor.getModifiers()));
            assertTrue(Arrays.asList(constructor.getParameterTypes()).contains(SelectionReadService.AssemblyNativeWorld.class));
            assertFalse(Arrays.asList(constructor.getParameterTypes()).contains(SelectionReadService.NativeWorld.class));
        }
    }
    @Test void publicWholeAuditAndBeforeReportsRemainReadOnlyEvenWhenLocallyAuthored()throws Exception{
        var fixture=AssemblyPatchFixtures.header("lite");var binding=AssemblyPatchFixtures.binding(fixture);
        var audit=new SelectionReadService.AssemblyAuditReport(UUID.randomUUID().toString(),binding,binding.totalWrites(),1);
        var result=new AssemblyPatchBeforeCheck.Result(binding,3712,3712,0,3712,1,0);
        var capture=new SelectionReadService.Capture(binding.captureId(),binding.selection(),binding.contextRevision(),fixture.get("payload").getAsString(),null,false);
        var before=new SelectionReadService.AssemblyBeforeReport(UUID.randomUUID().toString(),capture,audit.id(),result);
        assertFalse(audit.canAuthorizePlacement());assertFalse(audit.currentWorldVerified());assertFalse(audit.physicsVerified());assertFalse(before.canAuthorizePlacement());assertFalse(result.canAuthorizePlacement());
    }
}
