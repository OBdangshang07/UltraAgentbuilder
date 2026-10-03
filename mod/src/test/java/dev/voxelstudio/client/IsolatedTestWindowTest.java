package dev.voxelstudio.client;

import org.junit.jupiter.api.Test;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.jupiter.api.Assertions.*;

class IsolatedTestWindowTest {
    @Test void transitionsHideOnlyWhenTheWindowIsVisible(){
        var window=new IsolatedTestWindow("transition");var visible=new AtomicBoolean(true);
        for(int i=0;i<1000;i++)window.maintain(visible::get,()->visible.set(false));
        assertEquals(1,window.hideRequests());
        visible.set(true);window.maintain(visible::get,()->visible.set(false));
        assertEquals(2,window.hideRequests());assertFalse(visible.get());
    }
    @Test void explicitControlCanReproduceThePreviousEveryTickBehavior(){
        var window=new IsolatedTestWindow("every-tick");var visible=new AtomicBoolean(true);
        for(int i=0;i<10;i++)window.maintain(visible::get,()->visible.set(false));
        assertEquals(10,window.hideRequests());assertEquals("every-tick",window.mode());
    }
    @Test void invalidModeAndFailedHidingAreNotSilentlyAccepted(){
        assertThrows(IllegalArgumentException.class,()->new IsolatedTestWindow("offscreen"));
        assertThrows(IllegalStateException.class,()->new IsolatedTestWindow("transition").maintain(()->true,()->{}));
    }
    @Test void explicitVisibleModeNeverHidesAndCannotSilentlyBecomeAnOffscreenPass(){
        var window=new IsolatedTestWindow("visible");
        for(int i=0;i<100;i++)window.maintain(()->true,()->fail("Visible mode must not hide the window"));
        assertEquals(0,window.hideRequests());assertEquals("visible",window.mode());
        assertThrows(IllegalStateException.class,()->window.maintain(()->false,()->{}));
    }
}
