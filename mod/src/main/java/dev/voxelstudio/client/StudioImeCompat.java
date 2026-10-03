package dev.voxelstudio.client;

import java.lang.reflect.Method;
import net.fabricmc.loader.api.FabricLoader;

/** Optional IMBlocker cooperation, scoped to our focused fields; never changes user config. */
final class StudioImeCompat {
    private static boolean resolved;
    private static Method captureTick,captureNonPrintable;
    private static void resolve(){
        if(resolved)return;resolved=true;
        if(!FabricLoader.getInstance().isModLoaded("imblocker"))return;
        try{
            Class<?> api=Class.forName("io.github.reserveword.imblocker.IMCheckState");
            captureTick=api.getMethod("captureTick",Object.class,boolean.class);
            captureNonPrintable=api.getMethod("captureNonPrintable",Object.class,char.class,boolean.class);
        }catch(ReflectiveOperationException|LinkageError e){disable();}
    }
    private static void disable(){captureTick=null;captureNonPrintable=null;}
    static void tick(Object field,boolean focused){
        resolve();if(captureTick==null)return;
        try{captureTick.invoke(null,field,focused);}catch(ReflectiveOperationException|LinkageError e){disable();}
    }
    static boolean probe(Object field,char chr,boolean focused){
        resolve();if(chr!=0||captureNonPrintable==null)return false;
        try{return Boolean.TRUE.equals(captureNonPrintable.invoke(null,field,chr,focused));}catch(ReflectiveOperationException|LinkageError e){disable();return false;}
    }
    static boolean available(){resolve();return captureTick!=null&&captureNonPrintable!=null;}
}
