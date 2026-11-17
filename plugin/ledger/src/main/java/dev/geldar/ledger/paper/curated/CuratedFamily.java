package dev.geldar.ledger.paper.curated;

/** One family of curated events (PT-07a to PT-07f). Registers its events through the registry; reads events, never changes them. */
public interface CuratedFamily {
    void register(CuratedRegistry r);
}
