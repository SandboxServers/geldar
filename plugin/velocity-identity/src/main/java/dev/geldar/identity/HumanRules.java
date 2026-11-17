package dev.geldar.identity;

import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * The human lane's rules that do not depend on the registry. A human connection is refused when its name looks like an
 * agent's or when its UUID is the offline-mode UUID of its name: a genuine Microsoft account never has that UUID behind
 * an online-mode proxy, so the match means an offline-mode or spoofed login.
 */
final class HumanRules {
    /**
     * An agent name, in any case: the prefix {@code ag_}. The contract's life id, {@code ^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$}
     * (contract/schemas/common.schema.json), lies inside this prefix, so the rule is wider than the contract on purpose.
     * Minecraft names allow no hyphen, so {@code ag-} is not needed.
     */
    private static final Pattern AGENT_NAME = Pattern.compile("(?i)^ag_.*");

    private HumanRules() {}

    /** True when the name carries the reserved agent prefix. The caller checks that the name is a plain username first. */
    static boolean isAgentShaped(String username) {
        return AGENT_NAME.matcher(username).matches();
    }

    /** The UUID an offline-mode proxy gives this name: UUIDv3 of the bytes of {@code OfflinePlayer:} plus the name. */
    static UUID offlineUuid(String username) {
        return UUID.nameUUIDFromBytes(("OfflinePlayer:" + username).getBytes(StandardCharsets.UTF_8));
    }
}
