package dev.geldar.core.proximity;

/** Receives one heard_muffled notice for a listener's agent. Called on the server thread. */
public interface HearingNoticeSink {
    /** The notice for the life {@code lifeId} (its player name): a direction (a compass point, overhead or below) and a distance band. */
    void muffled(String lifeId, String direction, String band);

    /** As above with the hash of the speech that caused the notice (never the text); the default ignores it. */
    default void muffled(String lifeId, String direction, String band, String speechHash) {
        muffled(lifeId, direction, band);
    }
}
