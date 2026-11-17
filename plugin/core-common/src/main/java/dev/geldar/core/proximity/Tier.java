package dev.geldar.core.proximity;

/** The three hearing tiers of decision 0199, step 2. */
public enum Tier {
    /** Full words are delivered. */
    CLEAR,
    /** No words; a muffled notice (direction and band) is delivered. */
    MUFFLED,
    /** Nothing is delivered. */
    SILENT
}
