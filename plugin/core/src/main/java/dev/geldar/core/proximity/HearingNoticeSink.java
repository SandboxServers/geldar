package dev.geldar.core.proximity;

/** Receives one heard_muffled notice for a listener's agent. Called on the server thread. */
public interface HearingNoticeSink {
    /** The notice for the life {@code lifeId} (its player name): a compass direction and a distance band. */
    void muffled(String lifeId, String direction, String band);
}
