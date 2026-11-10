package dev.geldar.identity;

import java.io.IOException;
import org.slf4j.Logger;

/**
 * Wraps the life registry's feed and keeps the readiness marker in step with it: the marker exists only while the
 * registry is synced, which needs a live NATS connection and a bucket that replayed. A lost connection (markUnsynced)
 * removes it at once, because the gate is closed then and every login is denied. Once {@link #retire} runs (proxy
 * shutdown) nothing writes the marker again. Without a NATS URL no client feeds this, so no marker is ever written.
 */
final class ReadinessFeed implements RegistryClient.Feed {
    private final RegistryClient.Feed feed;
    private final ReadyMarker marker;
    private final Logger log;
    private boolean retired;

    ReadinessFeed(RegistryClient.Feed feed, ReadyMarker marker, Logger log) {
        this.feed = feed;
        this.marker = marker;
        this.log = log;
    }

    @Override
    public synchronized void beginReplay() {
        feed.beginReplay();
    }

    @Override
    public synchronized void put(String key, byte[] value) {
        feed.put(key, value);
    }

    @Override
    public synchronized void remove(String key) {
        feed.remove(key);
    }

    @Override
    public synchronized void markSynced() {
        feed.markSynced();
        if (retired) {
            return;
        }
        try {
            marker.write();
        } catch (IOException | RuntimeException e) {
            log.error("cannot write the readiness marker; the proxy healthcheck will fail: {}", e.getMessage());
        }
    }

    @Override
    public synchronized void markUnsynced() {
        feed.markUnsynced();
        removeMarker();
    }

    /** Removes the marker and keeps it absent: called once, when the proxy shuts down. */
    synchronized void retire() {
        retired = true;
        removeMarker();
    }

    private void removeMarker() {
        try {
            marker.remove();
        } catch (IOException e) {
            log.warn("cannot remove the readiness marker: {}", e.getMessage());
        }
    }
}
