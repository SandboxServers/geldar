package dev.geldar.ledger.core.ids;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** The Java offline-mode UUID of a login name, as Paper and Velocity derive it. */
public final class OfflineUuid {
    private OfflineUuid() {}

    public static UUID of(String name) {
        return UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(StandardCharsets.UTF_8));
    }
}
