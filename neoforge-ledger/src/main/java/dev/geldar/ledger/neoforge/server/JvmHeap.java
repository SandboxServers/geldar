package dev.geldar.ledger.neoforge.server;

import java.util.List;

/** The configured max heap, read from the JVM input arguments only (never an environment variable or a file). */
final class JvmHeap {
    private static final String XMX = "-Xmx";
    private static final String MAX_HEAP = "-XX:MaxHeapSize=";
    private static final String MAX_RAM_PCT = "-XX:MaxRAMPercentage=";
    static final String UNKNOWN = "unknown";

    private JvmHeap() {}

    /**
     * The last {@code -Xmx} or {@code -XX:MaxHeapSize=} wins (both set the same flag, and the JVM takes the last one);
     * without either, the last {@code -XX:MaxRAMPercentage=} is reported as {@code MaxRAMPercentage=<n>}; otherwise
     * {@code unknown}.
     */
    static String describe(List<String> args) {
        String size = null;
        String pct = null;
        for (String a : args) {
            if (a.startsWith(XMX) && a.length() > XMX.length()) {
                size = a.substring(XMX.length());
            } else if (a.startsWith(MAX_HEAP) && a.length() > MAX_HEAP.length()) {
                size = a.substring(MAX_HEAP.length());
            } else if (a.startsWith(MAX_RAM_PCT) && a.length() > MAX_RAM_PCT.length()) {
                pct = a.substring(MAX_RAM_PCT.length());
            }
        }
        if (size != null) {
            return size;
        }
        return pct != null ? "MaxRAMPercentage=" + pct : UNKNOWN;
    }
}
