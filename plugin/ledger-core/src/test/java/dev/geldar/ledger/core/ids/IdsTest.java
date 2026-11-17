package dev.geldar.ledger.core.ids;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class IdsTest {
    @Test
    void offlineUuidFollowsTheOfflinePlayerRecipe() {
        UUID expected = UUID.nameUUIDFromBytes("OfflinePlayer:Adam".getBytes(StandardCharsets.UTF_8));
        assertEquals(expected, OfflineUuid.of("Adam"));
        assertNotEquals(OfflineUuid.of("Adam"), OfflineUuid.of("adam"));
        assertEquals(3, OfflineUuid.of("Adam").version());
    }

    @Test
    void offlineUuidMatchesIndependentVectors() {
        // Computed outside Java (MD5 of "OfflinePlayer:<name>", version 3, variant 2).
        assertEquals(UUID.fromString("b50ad385-829d-3141-a216-7e7d7539ba7f"), OfflineUuid.of("Notch"));
        assertEquals(UUID.fromString("ad077ebc-226d-3e98-8162-26cfcd17bf22"), OfflineUuid.of("Adam"));
        assertEquals(UUID.fromString("a762f560-4fce-3236-812a-b80efff0b62b"), OfflineUuid.of("jeb_"));
    }

    @Test
    void offlineUuidRejectsNull() {
        assertThrows(NullPointerException.class, () -> OfflineUuid.of(null));
    }

    @Test
    void lifeIdsMatchTheEnvelopePattern() {
        for (String ok : new String[] {"ag_kestrel_01", "ag_a_00", "ag_wren2_123", "ag_abcdefghijklmnop_99"}) {
            assertTrue(LifeIds.isLifeId(ok), ok);
        }
        for (String bad : new String[] {
            "Adam", "ag_kestrel", "ag_kestrel_1", "AG_kestrel_01", "ag_Kestrel_01", "ag_1abc_01",
            "ag_abcdefghijklmnopq_01", "ag_kestrel_01x", " ag_kestrel_01", "ag__01", ""
        }) {
            assertFalse(LifeIds.isLifeId(bad), bad);
        }
        assertFalse(LifeIds.isLifeId(null));
    }
}
