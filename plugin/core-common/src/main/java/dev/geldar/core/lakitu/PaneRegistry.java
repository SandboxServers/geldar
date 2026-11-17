package dev.geldar.core.lakitu;

import dev.geldar.core.Ulid;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.LongSupplier;

/**
 * Allocates panes and enforces the per-session cap (invariant I5). The relay refuses earlier with the same
 * rule; this is the enforcement that counts. A refused open allocates nothing.
 */
public final class PaneRegistry {
    public static final String PANE_CAP_REACHED = "pane_cap_reached";

    public record Pane(String paneId, String sessionId, String targetAgentId, String mode, int radiusChunks) {}

    /** Either a pane or an error code from the schema's LakituErrorCode. */
    public record Opened(Pane pane, String error) {}

    private final int maxPanesPerSession;
    private final int maxRadius;
    private final LongSupplier clockMillis;
    private final Map<String, List<Pane>> bySession = new HashMap<>();

    public PaneRegistry(int maxPanesPerSession, int maxRadius, LongSupplier clockMillis) {
        this.maxPanesPerSession = maxPanesPerSession;
        this.maxRadius = maxRadius;
        this.clockMillis = clockMillis;
    }

    public synchronized Opened open(String sessionId, String targetAgentId, String mode, int radiusChunks) {
        List<Pane> panes = bySession.computeIfAbsent(sessionId, k -> new ArrayList<>());
        if (panes.size() >= maxPanesPerSession) {
            return new Opened(null, PANE_CAP_REACHED);
        }
        int radius = Math.max(1, Math.min(radiusChunks, maxRadius));
        Pane pane = new Pane("pn_" + Ulid.generate(clockMillis.getAsLong()), sessionId, targetAgentId, mode, radius);
        panes.add(pane);
        return new Opened(pane, null);
    }

    /** Frees a pane; returns false when it was not open. */
    public synchronized boolean close(String sessionId, String paneId) {
        List<Pane> panes = bySession.get(sessionId);
        if (panes == null || !panes.removeIf(p -> p.paneId().equals(paneId))) {
            return false;
        }
        if (panes.isEmpty()) {
            bySession.remove(sessionId);
        }
        return true;
    }

    public synchronized int count(String sessionId) {
        List<Pane> panes = bySession.get(sessionId);
        return panes == null ? 0 : panes.size();
    }

    public synchronized List<Pane> all() {
        return bySession.values().stream().flatMap(List::stream).toList();
    }
}
