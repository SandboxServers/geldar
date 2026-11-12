package dev.geldar.core.kino;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

class KinoEntityIdTest {
    @Test
    void idComesFromTheEntityNotItsPositionInThePage() {
        KinoWorld.EntityView bat = new KinoWorld.EntityView(41, "minecraft:bat", null, 1, 1, 1, 0f, 0f);
        KinoWorld.EntityView creeper = new KinoWorld.EntityView(97, "minecraft:creeper", null, 2, 1, 1, 0f, 0f);
        String page1 = KinoMessages.entityPositions(List.of(bat, creeper));
        String page2 = KinoMessages.entityPositions(List.of(creeper));
        assertTrue(page1.contains("\"id\":\"e41\"") && page1.contains("\"id\":\"e97\""));
        assertTrue(page2.contains("\"id\":\"e97\"") && !page2.contains("\"id\":\"e0\""));
        assertEquals(List.of(), KinoSchemaCheck.errors(page1));
    }

    @Test
    void unknownUidFallsBackToThePosition() {
        KinoWorld.EntityView v = new KinoWorld.EntityView("minecraft:cow", null, 1, 1, 1, 0f, 0f);
        assertTrue(KinoMessages.entityPositions(List.of(v)).contains("\"id\":\"e0\""));
    }
}