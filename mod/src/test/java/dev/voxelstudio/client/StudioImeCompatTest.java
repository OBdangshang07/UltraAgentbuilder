package dev.voxelstudio.client;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class StudioImeCompatTest {
    @Test void installedImBlockerBinaryExposesCompatiblePublicProtocolWithoutNativeInitialization()throws Exception{
        String jar=System.getProperty("voxelstudio.imblockerApiJar");org.junit.jupiter.api.Assumptions.assumeTrue(jar!=null,"Optional IMBlocker binary not supplied");
        try(var loader=new java.net.URLClassLoader(new java.net.URL[]{java.nio.file.Path.of(jar).toUri().toURL()},getClass().getClassLoader())){
            Class<?> api=Class.forName("io.github.reserveword.imblocker.IMCheckState",false,loader);
            assertEquals(void.class,api.getMethod("captureTick",Object.class,boolean.class).getReturnType());
            assertEquals(boolean.class,api.getMethod("captureNonPrintable",Object.class,char.class,boolean.class).getReturnType());
        }
    }
    public static final class ApiFixture {
        static Object field;static boolean focused;static int ticks,probes;
        public static void captureTick(Object target,boolean active){field=target;focused=active;ticks++;}
        public static boolean captureNonPrintable(Object target,char chr,boolean active){field=target;probes++;return chr==0&&active;}
    }
    @Test void optionalPublicProtocolNotifiesFocusAndOnlyConsumesProbe()throws Exception{
        var resolved=StudioImeCompat.class.getDeclaredField("resolved");var tick=StudioImeCompat.class.getDeclaredField("captureTick");var probe=StudioImeCompat.class.getDeclaredField("captureNonPrintable");
        resolved.setAccessible(true);tick.setAccessible(true);probe.setAccessible(true);
        boolean previous=resolved.getBoolean(null);Object oldTick=tick.get(null),oldProbe=probe.get(null);
        try{
            resolved.setBoolean(null,true);tick.set(null,ApiFixture.class.getMethod("captureTick",Object.class,boolean.class));probe.set(null,ApiFixture.class.getMethod("captureNonPrintable",Object.class,char.class,boolean.class));
            var field=new Object();StudioImeCompat.tick(field,true);assertSame(field,ApiFixture.field);assertTrue(ApiFixture.focused);
            assertTrue(StudioImeCompat.probe(field,'\0',true));int count=ApiFixture.probes;assertFalse(StudioImeCompat.probe(field,'中',true));assertEquals(count,ApiFixture.probes);
            StudioImeCompat.tick(field,false);assertFalse(ApiFixture.focused);assertFalse(StudioImeCompat.probe(field,'\0',false));
            tick.set(null,null);probe.set(null,null);assertDoesNotThrow(()->StudioImeCompat.tick(field,true));assertFalse(StudioImeCompat.probe(field,'中',true));
        }finally{resolved.setBoolean(null,previous);tick.set(null,oldTick);probe.set(null,oldProbe);}
    }
}
