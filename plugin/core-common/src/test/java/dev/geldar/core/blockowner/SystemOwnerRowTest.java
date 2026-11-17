package dev.geldar.core.blockowner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import dev.geldar.core.blockowner.CoreProtectPort.LogRow;
import dev.geldar.core.blockowner.OwnerSource.OwnedBlock;
import dev.geldar.core.blockowner.OwnerSource.Owners;
import java.util.List;
import org.junit.jupiter.api.Test;

/** A gravestone's system placement, as CoreProtect logs it, is an owner the resolver keeps (decision 0195). */
class SystemOwnerRowTest {
    @Test
    void aSystemPlacementRowSurvivesTheResolverAsTheOwner() {
        List<LogRow> newestFirst = List.of(
                new LogRow("world", 4, 64, 5, true, PlacementRecorder.SYSTEM_OWNER, false));

        Owners owners = FirstRowResolver.resolve(newestFirst, "world", 0, 0);

        assertEquals(List.of(new OwnedBlock(4, 64, 5, "geldar-system")), owners.blocks());
        assertFalse(owners.truncated());
    }
}
