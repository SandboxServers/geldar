package dev.geldar.core.provenance;

import com.google.gson.JsonObject;

/** Builds the JSON bodies of provenance messages (contract/schemas/provenance.schema.json). */
public final class ProvenanceJson {
    private ProvenanceJson() {}

    /**
     * A CombatProvenance body with exactly the keys world, actor, target, kind and tick. A null actor is written as
     * JSON null. kind is engaged or killed; target is the mob type without its namespace.
     */
    public static String combatJson(String world, String actor, String target, String kind, long tick) {
        JsonObject body = new JsonObject();
        body.addProperty("world", world);
        body.addProperty("actor", actor);
        body.addProperty("target", target);
        body.addProperty("kind", kind);
        body.addProperty("tick", tick);
        return body.toString();
    }

    /**
     * A TakeProvenance body with exactly the keys world, x, y, z, actor, prior_owner, item, count and tick. A null
     * actor or prior owner is written as JSON null. item is the item key without its namespace.
     */
    public static String takeJson(String world, int x, int y, int z, String actor, String priorOwner, String item,
            int count, long tick) {
        JsonObject body = new JsonObject();
        body.addProperty("world", world);
        body.addProperty("x", x);
        body.addProperty("y", y);
        body.addProperty("z", z);
        body.addProperty("actor", actor);
        body.addProperty("prior_owner", priorOwner);
        body.addProperty("item", item);
        body.addProperty("count", count);
        body.addProperty("tick", tick);
        return body.toString();
    }
}
