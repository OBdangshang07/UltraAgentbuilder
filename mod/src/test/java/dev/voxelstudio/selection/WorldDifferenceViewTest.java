package dev.voxelstudio.selection;

import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Geometry API conformance only; not a GPU, shader or screenshot test. */
final class WorldDifferenceViewTest {
    @Test void sharedSparseGeometryExposesNoBindingOrPlacementCapability(){
        var methods=new TreeSet<String>();for(var method:WorldDifferenceView.class.getMethods())methods.add(method.getName());
        assertEquals(Set.of("selection","sections","palette","at","checked"),methods);
    }
    @Test void legacyAndWholeViewsShareOriginalCoordinatesAndRowsWithoutSharingIdentityTypes()throws Exception{
        var input=AssemblyPatchFixtures.input(AssemblyPatchFixtures.header("lite"));var whole=AssemblyPatchPreview.from(input);
        WorldDifferenceView original=input.parts().get(0).preview();WorldDifferenceView complete=whole;
        assertEquals(input.binding().selection(),original.selection());assertEquals(original.selection(),complete.selection());
        assertEquals(original.palette(),complete.palette());var filter=whole.all(WorldPatchPreview.Mode.AFTER);assertEquals(filter,complete.checked(filter));
        int count=0;for(var section:complete.sections())for(var row:section.rows()){
            assertEquals(original.at(row.position()),complete.at(row.position()));assertTrue(row.position().x()<0);assertTrue(row.position().y()<0);count++;
        }
        assertEquals(644,count);assertFalse(whole.movable());assertFalse(whole.canAuthorizePlacement());
        assertEquals(AssemblyPatchBinding.class,whole.binding().getClass());assertEquals(WorldPatchPreview.Binding.class,input.parts().get(0).preview().binding().getClass());
    }
}
