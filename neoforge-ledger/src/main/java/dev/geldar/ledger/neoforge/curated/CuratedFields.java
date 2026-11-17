package dev.geldar.ledger.neoforge.curated;

/**
 * What a reader pulled out of one game event: a position (a block, or the acting player's block), the raw player
 * name, one bounded name ({@code what}: block id, item id or menu class) and the world id. {@code cancelled} is true
 * when another mod cancelled the event. The player name is raw here; {@link CuratedCollector} keeps it only when it is
 * a life id.
 */
public record CuratedFields(int x, int y, int z, String player, String what, String world, boolean cancelled) {}
