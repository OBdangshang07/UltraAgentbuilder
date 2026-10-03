package dev.voxelstudio.client;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class IsolatedRandomTickGuardTest {
    @TempDir Path root;
    @Test void restoresOriginalOnNormalAndExceptionalExit()throws Exception {
        for(int original:new int[]{0,3,100}){
            var value=new AtomicInteger(original);Path marker=root.resolve("rule.json");
            try(var guard=IsolatedRandomTickGuard.open(marker,"fixture",value::get,value::set)){
                assertEquals(0,value.get());assertEquals(original,guard.original);assertFalse(guard.recovered);assertTrue(Files.exists(marker));
            }
            assertEquals(original,value.get());assertFalse(Files.exists(marker));
        }
        var value=new AtomicInteger(3);
        assertThrows(IllegalStateException.class,()->{try(var guard=IsolatedRandomTickGuard.open(root.resolve("rule.json"),"fixture",value::get,value::set)){throw new IllegalStateException("test failure");}});
        assertEquals(3,value.get());assertFalse(Files.exists(root.resolve("rule.json")));
    }
    @Test void interruptedRunRecoversItsOriginalRuleWithoutReplacingItWithZero()throws Exception {
        var value=new AtomicInteger(3);Path marker=root.resolve("rule.json");
        IsolatedRandomTickGuard.open(marker,"fixture",value::get,value::set); // Simulate interrupted test.
        try(var next=IsolatedRandomTickGuard.open(marker,"fixture",value::get,value::set)){
            assertTrue(next.recovered);assertEquals(3,next.original);assertEquals(0,value.get());
        }
        assertEquals(3,value.get());assertFalse(Files.exists(marker));
    }
    @Test void wrongWorldAndExternalRuleChangesAreNotOverwritten()throws Exception {
        var value=new AtomicInteger(3);Path marker=root.resolve("rule.json");
        var guard=IsolatedRandomTickGuard.open(marker,"fixture",value::get,value::set);
        assertThrows(Exception.class,()->IsolatedRandomTickGuard.open(marker,"another-world",value::get,value::set));assertEquals(0,value.get());
        value.set(17);assertThrows(Exception.class,guard::close);assertEquals(17,value.get());assertTrue(Files.exists(marker));
        assertThrows(Exception.class,()->IsolatedRandomTickGuard.open(marker,"fixture",value::get,value::set));assertEquals(17,value.get());
    }
}
