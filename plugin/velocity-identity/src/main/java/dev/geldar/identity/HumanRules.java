package dev.geldar.identity;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * The human lane's rules that do not depend on the registry. A human connection is refused when its name looks like an
 * agent's or when its UUID is the offline-mode UUID of its name: a genuine Microsoft account never has that UUID behind
 * an online-mode proxy, so the match means an offline-mode or spoofed login.
 */
final class HumanRules {
    /**
     * The reserved agent prefixes, in lower case and matched in any case: {@code ag_} (the contract's life id,
     * {@code ^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$} in contract/schemas/common.schema.json, lies inside it) and {@code ag-}
     * (the hyphen form that decision 0135 uses for player ids). Minecraft names allow no hyphen, so
     * {@link LifeRegistry#isValidUsername} already refuses an {@code ag-} name; the entry keeps this rule from depending on
     * that validator.
     */
    static final List<String> AGENT_PREFIXES = List.of("ag_", "ag-");

    private HumanRules() {}

    /**
     * True when the name starts with a reserved agent prefix, in any case. Lower-casing uses {@link Locale#ROOT}, so the
     * default locale cannot change the result. The caller checks that the name is a plain username first.
     */
    static boolean isAgentShaped(String username) {
        String lower = username.toLowerCase(Locale.ROOT);
        for (String prefix : AGENT_PREFIXES) {
            if (lower.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }

    /** The UUID an offline-mode proxy gives this name: UUIDv3 of the bytes of {@code OfflinePlayer:} plus the name. */
    static UUID offlineUuid(String username) {
        return UUID.nameUUIDFromBytes(("OfflinePlayer:" + username).getBytes(StandardCharsets.UTF_8));
    }
}
