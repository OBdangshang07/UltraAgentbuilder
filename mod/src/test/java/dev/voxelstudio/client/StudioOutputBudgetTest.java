package dev.voxelstudio.client;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class StudioOutputBudgetTest {
    @Test void emptyInheritsAndLargeCustomBudgetIsNotClamped(){assertEquals(0,StudioOutputBudgetScreen.parseBudget("  "));assertEquals(262144,StudioOutputBudgetScreen.parseBudget("262144"));assertEquals(1000000,StudioOutputBudgetScreen.parseBudget("1000000"));}
    @Test void rejectsInvalidOrInexactProtocolIntegers(){for(String value:new String[]{"0","-1","2.5","oops","9007199254740992"})assertThrows(IllegalArgumentException.class,()->StudioOutputBudgetScreen.parseBudget(value));}
}
