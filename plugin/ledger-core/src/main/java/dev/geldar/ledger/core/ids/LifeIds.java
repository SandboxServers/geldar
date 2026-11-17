package dev.geldar.ledger.core.ids;

import java.util.regex.Pattern;

/** Life id shape, copied from {@code EventEnvelope.isLifeId} in plugin/core (not a dependency). */
public final class LifeIds {
    private static final Pattern LIFE_ID = Pattern.compile("^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$");

    private LifeIds() {}

    public static boolean isLifeId(String name) {
        return name != null && LIFE_ID.matcher(name).matches();
    }
}
