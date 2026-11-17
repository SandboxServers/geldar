package dev.geldar.ledger.core;

import java.util.regex.Pattern;

/** Syntax rules for metric and event names (README section 4). */
public final class NameRules {
    private static final Pattern METRIC = Pattern.compile("^geldar_[a-z0-9_]+$");
    private static final Pattern EVENT = Pattern.compile("^geldar(\\.[a-z0-9_]+)+$");

    private NameRules() {}

    public static boolean isMetricName(String name) {
        return name != null && METRIC.matcher(name).matches();
    }

    public static boolean isEventName(String name) {
        return name != null && EVENT.matcher(name).matches();
    }

    /** Returns the name, or throws {@link IllegalArgumentException}. */
    public static String requireMetricName(String name) {
        if (!isMetricName(name)) {
            throw new IllegalArgumentException("bad metric name: " + name);
        }
        return name;
    }

    /** Returns the name, or throws {@link IllegalArgumentException}. */
    public static String requireEventName(String name) {
        if (!isEventName(name)) {
            throw new IllegalArgumentException("bad event name: " + name);
        }
        return name;
    }
}
